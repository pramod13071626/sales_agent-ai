// Session-scoped cache for GET /api/accounts, shared by every page that
// renders an account list (the Global Dashboard's left nav in nav-tree.js,
// and Command Center/Tasks' left nav in accounts-nav.js via real-accounts.js).
//
// This is a multi-page app — every nav-tree click / sidebar link is a full
// browser navigation, not a client-side route change. Before this module,
// each page's own in-memory cache (main.js's `state.accounts`, real-accounts.js's
// module-level `accountsPromise`) reset to nothing on every single page load,
// so the left nav silently refetched /api/accounts on every navigation —
// that's not a bug in either of those, it's just what a plain JS variable can
// buy you in an MPA. sessionStorage survives navigation within the same tab
// (fixing that), but still disappears when the tab/browser closes, so a
// stale list can't outlive the browsing session even if nothing else clears
// it — and auth-client.js explicitly clears this key on both login() and
// logout() so one user's cached list can never bleed into another user's
// session on a shared/reused tab.
const KEY = 'sa:accounts:v1';
const DEFAULT_TTL_MS = 60_000;

export function clearAccountsCache() {
  try { sessionStorage.removeItem(KEY); } catch (e) { /* storage unavailable — nothing to clear */ }
}

function readCache(ttlMs) {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !Array.isArray(entry.accounts) || typeof entry.ts !== 'number') return null;
    if (Date.now() - entry.ts > ttlMs) return null;
    return entry.accounts;
  } catch (e) {
    return null; // corrupt entry or storage unavailable (private mode, etc.) — just refetch
  }
}

function writeCache(accounts) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ accounts, ts: Date.now() }));
  } catch (e) { /* storage full/unavailable — caching is a nice-to-have, not required */ }
}

// Thrown on a 401 so callers can tell "please log in again" apart from a
// network/server error — window.fetch is already patched (fetch-instrumentation.js)
// to silently refresh the access token and retry once, so a 401 reaching here
// means that already failed and the caller genuinely needs to redirect to /login.
export class AccountsAuthError extends Error {}

let inFlight = null;

/** Returns the account list — from sessionStorage if still fresh, otherwise
 * fetches GET /api/accounts once (de-duped across concurrent callers on the
 * same page) and caches the result. Pass { force: true } to bypass the cache
 * (e.g. after an action that changes the account list). Throws
 * AccountsAuthError on an unrecoverable 401. */
export async function loadAccountsCached({ ttlMs = DEFAULT_TTL_MS, force = false } = {}) {
  if (!force) {
    const cached = readCache(ttlMs);
    if (cached) return cached;
  }
  if (!inFlight) {
    inFlight = fetch('/api/accounts')
      .then(async (res) => {
        if (res.status === 401) throw new AccountsAuthError('Not authenticated');
        if (!res.ok) throw new Error(`Failed to load accounts (${res.status})`);
        const data = await res.json();
        const accounts = data.accounts || [];
        writeCache(accounts);
        return accounts;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}
