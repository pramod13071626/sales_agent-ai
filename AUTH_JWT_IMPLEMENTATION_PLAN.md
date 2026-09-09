# JWT Auth, Roles & Super Admin — Implementation Plan

Scope: add login, JWT-based authentication, role-based authorization
(`super_admin` grants access to `user` accounts), and lock down the existing
API. This is a plan only — nothing has been built yet.

**Decisions confirmed:**
- Roles: just `super_admin` + `user` (no middle `admin` tier for now).
- Login: password only — no Azure AD SSO integration.
- Password reset: **self-serve email reset** (not manual super-admin reset) — see §7.5.

## 0. Starting point (what's actually in this codebase today)

- **No auth exists anywhere.** Grepped the whole repo for JWT/bcrypt/`User`
  model/`OAuth2PasswordBearer` — zero hits. Every one of `api.py`'s ~80+
  endpoints is currently wide open.
- **CORS is already misconfigured for cookie-based auth**: `api.py` sets
  `allow_origins=["*"]` together with `allow_credentials=True`. Browsers
  reject that combination once real credentialed requests (cookies) are in
  play — this has to be fixed to a concrete origin list as part of Phase 1,
  not deferred, or the refresh-token cookie approach below won't work at all.
- **No migration framework** — no Alembic; `db/create_tables.py` just runs
  `Base.metadata.create_all` plus a few hand-written `ALTER TABLE ... IF NOT
  EXISTS` statements. New tables follow that same pattern.
- **Config convention**: everything reads from `.env` via `os.getenv(...)` in
  `config.py` (`DATABASE_URL`, `*_API_KEY`, etc.) — new secrets (`JWT_SECRET_KEY`)
  follow the same pattern.
- Redis + Celery are already a dependency (`requirements.txt`) — usable for
  rate-limiting/lockout counters instead of adding a new piece of infra.

## 1. Roles

Two roles for now, modeled so a third (`admin`) can be added later without a
schema change:

- `super_admin` — can create/deactivate/delete user accounts, assign roles,
  reset passwords, see the audit log. There should be at least one, seeded
  outside the app (see §6) — never "first user to sign up becomes admin".
- `user` — normal access to the sales dashboard/API, no user-management
  rights.

Store as a plain string column (`role`), not a Postgres enum type — easier to
extend later, and consistent with how this codebase already treats
`personas.tier`/`decision_authority` as free-text columns rather than DB enums.

## 2. Data model (new `db/models/user.py`, `db/models/refresh_token.py`)

**`users`**
| column | type | notes |
|---|---|---|
| id | Integer PK | |
| email | String, unique, not null | login identifier |
| hashed_password | String, not null | never store plaintext or a reversible hash |
| full_name | String | |
| role | String, not null, default `'user'` | `'super_admin' \| 'user'` |
| is_active | Boolean, default true | super admin revokes access by flipping this — no delete needed, preserves audit trail |
| failed_login_count | Integer, default 0 | for lockout (§8) |
| locked_until | DateTime, nullable | |
| created_by_id | Integer, FK → users.id, nullable | which super admin created this account |
| last_login_at | DateTime, nullable | |
| created_at / updated_at | DateTime | matches existing model convention (`default=lambda: datetime.now(timezone.utc)`) |

**`refresh_tokens`** (server-side, revocable — see §3 for why not to go fully stateless)
| column | type | notes |
|---|---|---|
| id | Integer PK | |
| user_id | FK → users.id, cascade delete | |
| token_hash | String, not null | store a hash of the refresh token, never the raw token |
| expires_at | DateTime, not null | |
| revoked_at | DateTime, nullable | set on logout / rotation / admin-forced revoke |
| created_at | DateTime | |
| user_agent / ip | String, nullable | optional, for the audit log and "log out all sessions" |

**`audit_log`** (optional but cheap, and directly relevant to "super admin
grants access to users" — you'll want to know who did what)
| column | type | notes |
|---|---|---|
| id | Integer PK | |
| actor_user_id | FK → users.id | who performed the action |
| action | String | e.g. `user_created`, `role_changed`, `access_revoked`, `password_reset` |
| target_user_id | FK → users.id, nullable | who it was done to |
| details | JSONB, nullable | e.g. `{"old_role": "user", "new_role": "super_admin"}` |
| created_at | DateTime | |

Add both new models to `db/models/__init__.py`'s exports, same as every
existing model.

## 3. Password hashing & token design

- **Hashing**: `passlib[bcrypt]` (mature, simple `passlib.context.CryptContext`
  API) or `argon2-cffi` (stronger modern default, slightly more setup).
  Recommendation: **argon2** — it's the current OWASP-recommended default and
  the extra dependency is small.
- **JWT library**: `PyJWT` (lighter than `python-jose`, actively maintained,
  does everything needed here — HS256 signing is enough at this scale; RS256
  asymmetric keys are a later upgrade if you ever need multiple services to
  verify tokens independently).
- **Access token**: short-lived (10–15 min). Claims: `sub` (user id), `role`,
  `iat`, `exp`, `jti`. Never put anything sensitive (password hash, etc.) in
  the payload — JWTs are signed, not encrypted, and are readable by anyone
  holding one.
- **Refresh token**: long-lived (7–30 days), **stored server-side as a hash**
  in `refresh_tokens` (not purely stateless) specifically so a super admin
  revoking a user's access takes effect immediately — a stateless refresh
  token would stay valid until it naturally expired even after
  `is_active = false`. Rotate on every use (issue a new refresh token, revoke
  the old one) so a stolen-and-reused old token is detectable.
- **Where tokens live in the browser**: refresh token in an
  `HttpOnly; Secure; SameSite=Lax` cookie (not reachable by JS, so an XSS bug
  can't exfiltrate it); access token kept in memory only (a JS module
  variable, not `localStorage`) and re-minted via `/api/auth/refresh` on page
  load. This is the standard tradeoff for a browser SPA — accept slightly
  more plumbing in exchange for meaningfully better XSS resistance than
  "both tokens in localStorage".
- `JWT_SECRET_KEY` goes in `.env` (both root and `apps/content_pipeline/.env`
  don't need it — only the main `api.py` process issues/verifies tokens).
  Generate with `python -c "import secrets; print(secrets.token_urlsafe(64))"`,
  never hardcode it, never commit it.

## 4. Auth endpoints (new `auth.py` module, mounted into `api.py`)

| Endpoint | Method | Notes |
|---|---|---|
| `/api/auth/login` | POST | email+password → access token (JSON body) + refresh token (Set-Cookie). Rate-limited (§8). |
| `/api/auth/refresh` | POST | reads refresh cookie, validates hash+expiry+not-revoked in DB, rotates it, returns a new access token. |
| `/api/auth/logout` | POST | revokes the current refresh token row, clears the cookie. |
| `/api/auth/me` | GET | returns the current user's id/email/role — frontend uses this to decide whether to show the Admin nav item. |

FastAPI dependency chain:
```python
def get_current_user(token: str = Depends(oauth2_scheme), session=Depends(get_session)) -> User:
    # decode + verify JWT, 401 on any failure (expired, bad signature, malformed)
    # load user by id, 401 if missing or is_active is False
    ...

def require_role(*roles):
    def dep(user: User = Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(403, "Not authorized")
        return user
    return dep
```

## 5. Locking down the existing API

`api.py` currently has no per-route auth, and retrofitting 80+ endpoints one
by one is both slow and easy to miss one. Instead:

- Group the existing routes under an `APIRouter` (or attach at
  `app.include_router(..., dependencies=[Depends(get_current_user)])`) so
  auth is enforced at the router level, once, not per-endpoint.
- Explicit allowlist of routes that must stay public: `/api/auth/login`,
  `/api/auth/refresh`, `/api/auth/forgot-password`, `/api/auth/reset-password`,
  `/`, `/profile`, static `/css` `/js` mounts (the pages render fine
  unauthenticated and their own API calls will 401 → redirect to login — or
  gate the pages themselves, see §7).
- Roll this out behind an `.env` flag (`AUTH_ENFORCED=true|false`) for the
  first deploy — if something is missed, flip it off instantly instead of a
  hotfix under pressure.

## 6. Bootstrapping the first Super Admin

No self-registration for `super_admin`. Add `scripts/create_super_admin.py`
(matches the existing `scripts/` convention, e.g.
`reconcile_targets_accounts.py`):

```
python scripts/create_super_admin.py --email you@company.com --password ...
```

Hashes the password, inserts the row with `role='super_admin'`. Run once,
manually, after the migration — not part of any HTTP-reachable code path.

## 7. Super Admin user-management endpoints & UI

| Endpoint | Method | Access |
|---|---|---|
| `/api/admin/users` | GET | list all users (id, email, role, is_active, last_login_at) |
| `/api/admin/users` | POST | create a user + assign role (super admin sets a temp password or the app emails a set-password link) |
| `/api/admin/users/{id}` | PATCH | change role, activate/deactivate |
| `/api/admin/users/{id}/reset-password` | POST | force a password reset |
| `/api/admin/users/{id}` | DELETE | hard delete — prefer `is_active=false` for anything with history |

All behind `Depends(require_role("super_admin"))`.

Frontend: a new `/admin` page (same pattern as the `/profile` page already
built this session — its own Jinja2 template + JS entry point, fetching
`/api/admin/users*`), plus:
- A login page/form posting to `/api/auth/login`.
- `fetch-instrumentation.js` (already the single choke point patching
  `window.fetch` globally, per its own header comment) is where to (a)
  attach `Authorization: Bearer <accessToken>` to every call, (b) on a 401,
  attempt one silent `/api/auth/refresh` and retry, else redirect to
  `/login`.
- Topbar: show the logged-in user + Logout button; only render the "Admin"
  nav link when `GET /api/auth/me` reports `role === 'super_admin'`.

## 7.5. Self-serve password reset

New table **`password_reset_tokens`**: `id`, `user_id` (FK), `token_hash`
(store a hash, not the raw token — same reasoning as refresh tokens),
`expires_at` (short-lived, ~30–60 min), `used_at` (nullable — a token is
single-use).

| Endpoint | Method | Notes |
|---|---|---|
| `/api/auth/forgot-password` | POST | body: `{email}`. Always returns 200 with a generic message regardless of whether the email exists — never reveal whether an account exists (user-enumeration prevention). If it does exist: generate a token, store its hash, email a reset link (`/reset-password?token=...`). |
| `/api/auth/reset-password` | POST | body: `{token, new_password}`. Look up by hash, check `expires_at`/`used_at`, hash the new password, mark the token used, and **revoke every refresh token for that user** (§3) — a password reset should end all existing sessions, including one an attacker may already hold. |

**Email sending — a real constraint, not a detail.** The only existing mail
sender in this codebase is `apps/content_pipeline/mailer.py`'s `send_email()`,
which sends via Microsoft Graph as **one specific interactively-logged-in
mailbox** (`janak@stradit.com`, via a cached MSAL device-flow token — see
`mailer.py --login`). That's fine for the occasional manual "Send Mail"
button click it currently serves, but it's a weak foundation for a
security-critical, must-always-work flow like password reset:
- It lives in a different app (`apps/content_pipeline/`) than `api.py` —
  reusing it means either a cross-app import (same pattern already used for
  `db.get_person_bio` reading across app boundaries) or copying the sender.
- Its token cache can go stale and needs a human to re-run the interactive
  `--login` device flow — there's no unattended app-only refresh today.

Two honest options, pick based on how much this matters in practice:
1. **Reuse it as-is** — acceptable for a small internal team where "reset
   email didn't arrive, ping IT" is a tolerable fallback, and where whoever
   maintains this already re-runs `--login` periodically for the existing
   Send Mail feature.
2. **Add a proper app-only sender** — either switch the Graph call to the
   client-credentials flow (an Azure AD app registration with `Mail.Send`
   *application* permission, no human login required, no cache to go stale)
   or use a transactional email provider (SendGrid/SES/Postmark). Worth
   doing before this is relied on for real account-recovery, since a stuck
   token cache would silently break every password reset until someone
   notices.

## 8. Security hardening checklist

- Fix CORS (`allow_origins`) to the real frontend origin(s) — required for
  the cookie-based refresh token to work at all, not optional (§0).
- Cookie flags: `HttpOnly`, `Secure` (HTTPS only in prod), `SameSite=Lax`.
- Rate-limit `/api/auth/login` — Redis is already a dependency here, so a
  simple fixed-window counter per IP+email (or `slowapi`) is enough; no new
  infra needed.
- Account lockout: increment `failed_login_count` on bad password, set
  `locked_until` after N failures, reset on success.
- Password policy enforced server-side on create/reset (minimum length at
  least; a full complexity checker is optional for an internal tool).
- Populate `audit_log` on every admin action (`user_created`, `role_changed`,
  `access_revoked`, `password_reset`) — this is the actual point of "super
  admin grants access to users," so it should be provable after the fact.
- Never log the Authorization header, raw tokens, or passwords.
- HTTPS in production; without it, none of the above (cookies, bearer
  tokens) are meaningfully protected in transit.
- Rate-limit `/api/auth/forgot-password` too (per email + per IP) — without
  it, it's a free tool to spam an arbitrary inbox with reset emails.

## 9. Phased rollout

1. **Phase 0 — foundation.** Add `PyJWT`, `argon2-cffi` to
   `requirements.txt`; add `User`/`RefreshToken`/`PasswordResetToken`/
   `AuditLog` models; extend `db/create_tables.py`; seed the first super
   admin via the CLI script.
2. **Phase 1 — auth endpoints, not yet enforced.** Build `auth.py` and the
   `/api/auth/*` routes (login/refresh/logout/forgot-password/reset-password),
   the login + reset-password pages, and the `fetch-instrumentation.js`
   token plumbing. Decide the email-sending approach for password reset
   (§7.5) before this ships, since the flow is a no-op without it. Deploy
   with `AUTH_ENFORCED=false` — verify the whole loop end-to-end (including
   an actual reset email) while the rest of the app stays reachable, so
   this can be tested without locking anyone out.
3. **Phase 2 — user management.** Ship `/api/admin/users*` + the `/admin`
   page. Super admin creates real accounts for the team.
4. **Phase 3 — flip the switch.** Set `AUTH_ENFORCED=true`; attach
   `Depends(get_current_user)` at the router level; confirm the frontend's
   401→refresh→retry flow actually works before announcing the cutover.
5. **Phase 4 — hardening.** Rate limiting, lockout, audit log wiring, CORS
   lock-down, cookie flags for the real deployment target.
