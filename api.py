"""
Sales AI Intelligence Pipeline — Granular REST API Server.
Provides dedicated Fetch / Validate / Dump lifecycle endpoints for:
1. Account Level (Tab 1)
2. Lines of Business (LOB) & Sub-LOB Level (Tab 2 & 3)
3. Person & Persona Level — Individual & Batch (Tab 4)
4. Full Composite Pipeline

Workflow for each level:
    [Fetch / Pull Button] ──► Staged into memory/JSON (NO DB Write)
          │
    [Validate Button Appears] ──► Quality Audit & Health Scores (0-100%)
          │
    [Dump DB Button Appears] ──► User-approved UPSERT into PostgreSQL (sales_ai)

100% Dynamic, Zero Hardcoding.
"""

import sys
import os
import re
import json
import math
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta

# Ensure project root is on sys.path
PIPELINE_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPELINE_ROOT))

from subprocess import run

import config
from collectors.account_collector import (
    fetch_latest_10k_chunks,
    extract_full_patents,
    fetch_sec_exhibit_21_subsidiaries,
    fetch_gleif_ownership_tree,
    fetch_wikipedia_dbpedia_intel,
    fetch_fec_political_intel,
    fetch_diffbot_organization_intel,
)
from collectors.sublob_collector import scrape_sublobs
from collectors.lob_enricher import enrich_lob_segments
from collectors.hierarchy_collector import scrape_hierarchy
from collectors.persona_enricher import build_persona_dossier
from collectors.validator import DataQualityValidator
from serializer import MasterSerializer
from serializers.account_serializer import slugify

from sqlalchemy import or_
from sqlalchemy.orm import selectinload
from db.connection import get_session
from db.models import (
    Account,
    Lob,
    SubLob,
    Persona,
    Post,
    Digest,
    OpportunitySignal,
    WeeklyDigestSnapshot,
    LinkedInJob,
    CxoMovement,
    User,
    AuditLog,
    ActionItem,
    ActionItemReminder,
)

from db.schemas import AccountSchema, LobSchema, PersonaSchema
from db.repositories import (
    AccountRepository,
    LobRepository,
    PersonaRepository,
)
from db.repositories.pipeline_run_repository import PipelineRunRepository
from services.account_service import AccountService
from services.lob_service import LobService, LobValidator
from services.persona_service import PersonaService, PersonaValidator
from pdf_export import build_persona_profile_pdf, build_psychological_profile_pdf
import auth
import email_sender
from main import run_pipeline

import uvicorn
try:
    from fastapi import (
        FastAPI,
        APIRouter,
        HTTPException,
        Query,
        Body,
        Response,
        Request,
        Depends,
        BackgroundTasks,
    )
    from fastapi.responses import FileResponse, HTMLResponse
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.staticfiles import StaticFiles
    from fastapi.templating import Jinja2Templates
    from pydantic import BaseModel
    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False


if FASTAPI_AVAILABLE:
    app = FastAPI(
        title="Sales AI Enterprise Intelligence API",
        description=(
            "Granular REST API for Frontend UI Tabs: "
            "Account, LOBs, Sub-LOBs, and Personas (Fetch -> Validate -> Dump)"
        ),
        version="2.2.0",
    )

    # allow_origins=["*"] together with allow_credentials=True is rejected by
    # browsers once real credentialed requests (the refresh-token cookie) are
    # in play — see AUTH_JWT_IMPLEMENTATION_PLAN.md §0. A concrete origin
    # list is required for auth to work at all.
    _cors_origins = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
    # Browsers only send Secure cookies over HTTPS — false for plain-http
    # local dev (localhost included, to work reliably with curl/tools too),
    # true once this is actually deployed behind HTTPS.
    _COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").strip().lower() == "true"
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins or ["http://localhost:8000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ══════════════════════════════════════════════════════
    # AUTHENTICATION (see AUTH_JWT_IMPLEMENTATION_PLAN.md)
    # ══════════════════════════════════════════════════════
    class LoginRequest(BaseModel):
        email: str
        password: str

    class ForgotPasswordRequest(BaseModel):
        email: str

    class ResetPasswordRequest(BaseModel):
        token: str
        new_password: str

    class CreateUserRequest(BaseModel):
        email: str
        full_name: Optional[str] = None
        password: str
        role: str = "user"

    class UpdateUserRequest(BaseModel):
        full_name: Optional[str] = None
        email: Optional[str] = None
        role: Optional[str] = None
        is_active: Optional[bool] = None
        password: Optional[str] = None

    def _user_public(u: User) -> Dict[str, Any]:
        return {
            "id": u.id, "email": u.email, "full_name": u.full_name,
            "role": u.role, "is_active": u.is_active,
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }

    @app.post("/api/auth/login", tags=["0. Authentication"])
    def login(body: LoginRequest, request: Request, response: Response):
        session = get_session()
        try:
            email = body.email.strip().lower()
            user = session.query(User).filter(User.email.ilike(email)).first()
            # Same generic error whether the email doesn't exist or the
            # password is wrong — never reveal which one it was.
            invalid = HTTPException(status_code=401, detail="Invalid email or password")
            if not user or not user.is_active:
                raise invalid
            if auth.is_locked_out(user):
                raise HTTPException(status_code=423, detail="Account temporarily locked due to repeated failed logins")
            if not auth.verify_password(body.password, user.hashed_password):
                auth.register_failed_login(session, user)
                raise invalid

            auth.register_successful_login(session, user)
            access_token = auth.create_access_token(user)
            refresh_token = auth.issue_refresh_token(session, user, request)
            auth.log_audit(session, user.id, "login")

            response.set_cookie(
                "refresh_token", refresh_token, httponly=True, secure=_COOKIE_SECURE, samesite="lax",
                max_age=auth.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600, path="/api/auth",
            )
            return {"access_token": access_token, "token_type": "bearer", "user": _user_public(user)}
        finally:
            session.close()

    @app.post("/api/auth/refresh", tags=["0. Authentication"])
    def refresh_access_token(request: Request, response: Response):
        raw_refresh = request.cookies.get("refresh_token")
        if not raw_refresh:
            raise HTTPException(status_code=401, detail="No refresh token")
        session = get_session()
        try:
            new_raw, user = auth.verify_and_rotate_refresh_token(session, raw_refresh, request)
            access_token = auth.create_access_token(user)
            response.set_cookie(
                "refresh_token", new_raw, httponly=True, secure=_COOKIE_SECURE, samesite="lax",
                max_age=auth.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600, path="/api/auth",
            )
            return {"access_token": access_token, "token_type": "bearer", "user": _user_public(user)}
        finally:
            session.close()

    @app.post("/api/auth/logout", tags=["0. Authentication"])
    def logout(request: Request, response: Response):
        raw_refresh = request.cookies.get("refresh_token")
        if raw_refresh:
            session = get_session()
            try:
                auth.revoke_refresh_token(session, raw_refresh)
            finally:
                session.close()
        response.delete_cookie("refresh_token", path="/api/auth")
        return {"ok": True}

    @app.get("/api/auth/me", tags=["0. Authentication"])
    def get_me(user: User = Depends(auth.get_current_user)):
        return _user_public(user)

    @app.post("/api/auth/forgot-password", tags=["0. Authentication"])
    def forgot_password(body: ForgotPasswordRequest, background_tasks: BackgroundTasks):
        """Always returns the same generic response whether or not the
        email exists — prevents account enumeration via this endpoint."""
        session = get_session()
        try:
            user = session.query(User).filter(User.email.ilike(body.email.strip().lower())).first()
            if user and user.is_active:
                reset_token = auth.issue_password_reset_token(session, user)
                auth.log_audit(session, None, "password_reset_requested", target_user_id=user.id)
                reset_link = f"{os.getenv('APP_BASE_URL', 'http://localhost:8000')}/reset-password?token={reset_token}"
                # Sent after the response goes out, not before — a live SMTP
                # round-trip (real-world: a few seconds against Office365)
                # must never be what the caller's HTTP request is waiting on.
                background_tasks.add_task(
                    email_sender.send_email,
                    user.email, "Reset your Sales Intelligence password",
                    f"Hi {user.full_name or user.email},\n\n"
                    "A password reset was requested for your account. If this wasn't you, "
                    "you can safely ignore this email.\n\n"
                    f"Reset your password here (expires in {auth.RESET_TOKEN_EXPIRE_MINUTES} minutes):\n{reset_link}\n",
                    html_body=email_sender.render_html(
                        "Reset your password",
                        [f"Hi {user.full_name or user.email},",
                         "A password reset was requested for your account. If this wasn't you, "
                         "you can safely ignore this email — your password will stay unchanged."],
                        cta_label="Reset Password", cta_url=reset_link,
                        footnote=f"This link expires in {auth.RESET_TOKEN_EXPIRE_MINUTES} minutes.",
                    ),
                )
            return {"message": "If that email exists, a reset link has been sent."}
        finally:
            session.close()

    @app.post("/api/auth/reset-password", tags=["0. Authentication"])
    def reset_password(body: ResetPasswordRequest):
        session = get_session()
        try:
            user = auth.consume_password_reset_token(session, body.token)
            user.hashed_password = auth.hash_password(body.new_password)
            session.commit()
            # A password reset should end every existing session, including
            # one an attacker may already hold.
            auth.revoke_all_refresh_tokens_for_user(session, user.id)
            auth.log_audit(session, user.id, "password_reset_completed", target_user_id=user.id)
            return {"message": "Password updated. Please log in again."}
        finally:
            session.close()

    # ── Super Admin: user management ─────────────────────────────
    @app.get("/api/admin/users", tags=["0. Authentication"])
    def list_users(current: User = Depends(auth.require_role("super_admin"))):
        session = get_session()
        try:
            users = session.query(User).order_by(User.created_at.desc()).all()
            return {"users": [_user_public(u) for u in users]}
        finally:
            session.close()

    @app.post("/api/admin/users", tags=["0. Authentication"])
    def create_user(
        body: CreateUserRequest,
        background_tasks: BackgroundTasks,
        current: User = Depends(auth.require_role("super_admin")),
    ):
        if body.role not in ("super_admin", "user"):
            raise HTTPException(status_code=400, detail="role must be 'super_admin' or 'user'")
        session = get_session()
        try:
            email = body.email.strip().lower()
            if session.query(User).filter(User.email.ilike(email)).first():
                raise HTTPException(status_code=409, detail="A user with this email already exists")
            new_user = User(
                email=email,
                full_name=body.full_name,
                role=body.role,
                hashed_password=auth.hash_password(body.password),
                created_by_id=current.id,
            )
            session.add(new_user)
            session.commit()
            auth.log_audit(
                session,
                current.id,
                "user_created",
                target_user_id=new_user.id,
                details={"role": body.role},
            )

            base_url = os.getenv("APP_BASE_URL", "http://localhost:8000")
            access_note = (
                "As a super_admin, you have access to every account by default."
                if new_user.role == "super_admin" else
                "No accounts have been assigned to you yet — a super admin will "
                "grant access to specific accounts shortly; ask them if you need "
                "one urgently."
            )
            background_tasks.add_task(
                email_sender.send_email,
                new_user.email,
                "Welcome to Sales Intelligence",
                (
                    f"Hi {new_user.full_name or new_user.email},\n\n"
                    f"An account has been created for you on Sales Intelligence by "
                    f"{current.full_name or current.email}.\n\n"
                    f"Email: {new_user.email}\nRole: {new_user.role}\n\n"
                    f"Access: {access_note}\n\n"
                    f"Sign in here: {base_url}/login\n"
                    "You'll receive a separate email shortly to set your own password.\n"
                ),
                html_body=email_sender.render_html(
                    "Welcome to Sales Intelligence",
                    [f"Hi {new_user.full_name or new_user.email},",
                     f"An account has been created for you by {current.full_name or current.email}.",
                     f"Email: {new_user.email}  •  Role: {new_user.role}",
                     access_note],
                    cta_label="Sign In", cta_url=f"{base_url}/login",
                    footnote="You'll receive a separate email shortly to set your own password.",
                ),
            )

            # An admin-set temp password is a worse first-run experience
            # than the user picking their own — and never having to see the
            # temp password anywhere (audit log, admin's clipboard) is a
            # small but real security win.
            reset_token = auth.issue_password_reset_token(session, new_user)
            reset_link = f"{base_url}/reset-password?token={reset_token}"
            background_tasks.add_task(
                email_sender.send_email,
                new_user.email, "Set your Sales Intelligence password",
                f"Hi {new_user.full_name or new_user.email},\n\n"
                "Set your password to finish setting up your account "
                f"(expires in {auth.RESET_TOKEN_EXPIRE_MINUTES} minutes):\n{reset_link}\n",
                html_body=email_sender.render_html(
                    "Set your password",
                    [f"Hi {new_user.full_name or new_user.email},",
                     "One last step to finish setting up your account — choose your own password."],
                    cta_label="Set Password", cta_url=reset_link,
                    footnote=f"This link expires in {auth.RESET_TOKEN_EXPIRE_MINUTES} minutes.",
                ),
            )
            return _user_public(new_user)
        finally:
            session.close()

    @app.patch("/api/admin/users/{user_id}", tags=["0. Authentication"])
    def update_user(
        user_id: int, body: UpdateUserRequest, current: User = Depends(auth.require_role("super_admin"))
    ):
        session = get_session()
        try:
            target = session.query(User).filter_by(id=user_id).first()
            if not target:
                raise HTTPException(status_code=404, detail="User not found")
            if target.id == current.id and body.is_active is False:
                raise HTTPException(status_code=400, detail="You cannot deactivate your own account")

            details = {}
            if body.full_name is not None:
                stripped_name = body.full_name.strip() if body.full_name else None
                if stripped_name != target.full_name:
                    details["full_name"] = {"old": target.full_name, "new": stripped_name}
                    target.full_name = stripped_name

            if body.email is not None:
                new_email = body.email.strip().lower()
                if not new_email:
                    raise HTTPException(status_code=400, detail="Email cannot be empty")
                if new_email != target.email:
                    existing = session.query(User).filter(User.email == new_email, User.id != target.id).first()
                    if existing:
                        raise HTTPException(status_code=400, detail="A user with this email address already exists")
                    details["email"] = {"old": target.email, "new": new_email}
                    target.email = new_email

            if body.role is not None and body.role != target.role:
                if body.role not in ("super_admin", "user"):
                    raise HTTPException(status_code=400, detail="role must be 'super_admin' or 'user'")
                if target.id == current.id and body.role != "super_admin":
                    raise HTTPException(status_code=400, detail="You cannot demote your own account from super_admin")
                details["role"] = {"old": target.role, "new": body.role}
                target.role = body.role

            if body.is_active is not None and body.is_active != target.is_active:
                details["is_active"] = {"old": target.is_active, "new": body.is_active}
                target.is_active = body.is_active
                if not body.is_active:
                    auth.revoke_all_refresh_tokens_for_user(session, target.id)

            if body.password:
                if len(body.password) < 6:
                    raise HTTPException(status_code=400, detail="Password must be at least 6 characters long")
                target.password_hash = auth.hash_password(body.password)
                auth.revoke_all_refresh_tokens_for_user(session, target.id)
                details["password_changed"] = True

            session.commit()
            if details:
                auth.log_audit(session, current.id, "user_updated", target_user_id=target.id, details=details)
            return _user_public(target)
        finally:
            session.close()

    @app.delete("/api/admin/users/{user_id}", tags=["0. Authentication"])
    def delete_user(user_id: int, current: User = Depends(auth.require_role("super_admin"))):
        if user_id == current.id:
            raise HTTPException(status_code=400, detail="You cannot delete your own account")
        session = get_session()
        try:
            target = session.query(User).filter_by(id=user_id).first()
            if not target:
                raise HTTPException(status_code=404, detail="User not found")
            email = target.email
            # Logged before the delete since AuditLog.target_user_id turns
            # NULL once the row is gone (ondelete="SET NULL") — the action
            # should still say who it was after the fact.
            auth.log_audit(session, current.id, "user_deleted", target_user_id=None, details={"email": email})
            session.delete(target)
            session.commit()
            return {"ok": True}
        finally:
            session.close()

    @app.get("/api/admin/users/{user_id}/accounts", tags=["0. Authentication"])
    def list_user_account_access(user_id: int, current: User = Depends(auth.require_role("super_admin"))):
        """Every account, flagged with whether this user currently has
        access — the full picker list, not just their current grants."""
        session = get_session()
        try:
            target = session.query(User).filter_by(id=user_id).first()
            if not target:
                raise HTTPException(status_code=404, detail="User not found")
            granted_ids = set(auth.get_accessible_account_ids(session, user_id))
            accounts = session.query(Account).order_by(Account.display_name).all()
            return {
                "user_id": user_id,
                "role": target.role,
                "accounts": [
                    {
                        "id": a.id,
                        "name": a.display_name or a.legal_name or a.key,
                        "granted": a.id in granted_ids,
                    }
                    for a in accounts
                ],
            }
        finally:
            session.close()

    @app.post("/api/admin/users/{user_id}/accounts/{account_id}", tags=["0. Authentication"])
    def grant_user_account_access(
        user_id: int, account_id: int, current: User = Depends(auth.require_role("super_admin"))
    ):
        session = get_session()
        try:
            target = session.query(User).filter_by(id=user_id).first()
            if not target:
                raise HTTPException(status_code=404, detail="User not found")
            account = session.query(Account).filter_by(id=account_id).first()
            if not account:
                raise HTTPException(status_code=404, detail="Account not found")
            created = auth.grant_account_access(session, user_id, account_id, current.id)
            if created:
                auth.log_audit(
                    session, current.id, "account_access_granted", target_user_id=user_id,
                    details={"account_id": account_id, "account_name": account.display_name}
                )
            return {"ok": True}
        finally:
            session.close()

    @app.delete("/api/admin/users/{user_id}/accounts/{account_id}", tags=["0. Authentication"])
    def revoke_user_account_access(
        user_id: int, account_id: int, current: User = Depends(auth.require_role("super_admin"))
    ):
        session = get_session()
        try:
            removed = auth.revoke_account_access(session, user_id, account_id)
            if removed:
                auth.log_audit(
                    session, current.id, "account_access_revoked", target_user_id=user_id,
                    details={"account_id": account_id}
                )
            return {"ok": True}
        finally:
            session.close()

    @app.get("/api/admin/stats", tags=["0. Authentication"])
    def admin_dashboard_stats(current: User = Depends(auth.require_role("super_admin"))):
        """Usage summary for the admin dashboard: headline counts, most
        recently active users, and the latest audit trail entries."""
        session = get_session()
        try:
            total_users = session.query(User).count()
            active_users = session.query(User).filter_by(is_active=True).count()
            super_admin_count = session.query(User).filter_by(role="super_admin").count()
            total_accounts = session.query(Account).count()
            open_action_items = session.query(ActionItem).filter(
                ActionItem.status.in_(("open", "in_progress"))
            ).count()
            overdue_action_items = session.query(ActionItem).filter(
                ActionItem.status.in_(("open", "in_progress")),
                ActionItem.due_date.isnot(None),
                ActionItem.due_date < datetime.now(timezone.utc),
            ).count()

            recent_logins = (
                session.query(User)
                .filter(User.last_login_at.isnot(None))
                .order_by(User.last_login_at.desc())
                .limit(10)
                .all()
            )
            recent_audit = (
                session.query(AuditLog)
                .order_by(AuditLog.created_at.desc())
                .limit(20)
                .all()
            )
            user_ids_in_audit = (
                {e.actor_user_id for e in recent_audit if e.actor_user_id}
                | {e.target_user_id for e in recent_audit if e.target_user_id}
            )
            names_by_id = {
                u.id: (u.full_name or u.email)
                for u in session.query(User).filter(User.id.in_(user_ids_in_audit)).all()
            } if user_ids_in_audit else {}

            return {
                "total_users": total_users,
                "active_users": active_users,
                "inactive_users": total_users - active_users,
                "super_admin_count": super_admin_count,
                "total_accounts": total_accounts,
                "open_action_items": open_action_items,
                "overdue_action_items": overdue_action_items,
                "recent_logins": [
                    {
                        "id": u.id, "email": u.email, "full_name": u.full_name,
                        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None
                    }
                    for u in recent_logins
                ],
                "recent_audit": [
                    {
                        "action": e.action,
                        "actor": names_by_id.get(e.actor_user_id, "system"),
                        "target": names_by_id.get(e.target_user_id) if e.target_user_id else None,
                        "details": e.details,
                        "created_at": e.created_at.isoformat() if e.created_at else None,
                    }
                    for e in recent_audit
                ],
            }
        finally:
            session.close()

    @app.get("/api/admin/audit-logs", tags=["0. Authentication"])
    def list_admin_audit_logs(
        limit: int = Query(5, ge=1, le=100),
        offset: int = Query(0, ge=0),
        current: User = Depends(auth.require_role("super_admin"))
    ):
        """Paginated audit trail endpoint so large audit histories load efficiently in small chunks."""
        session = get_session()
        try:
            total_count = session.query(AuditLog).count()
            logs = (
                session.query(AuditLog)
                .order_by(AuditLog.created_at.desc())
                .offset(offset)
                .limit(limit)
                .all()
            )
            user_ids = (
                {e.actor_user_id for e in logs if e.actor_user_id}
                | {e.target_user_id for e in logs if e.target_user_id}
            )
            names_by_id = {
                u.id: (u.full_name or u.email)
                for u in session.query(User).filter(User.id.in_(user_ids)).all()
            } if user_ids else {}

            return {
                "total": total_count,
                "limit": limit,
                "offset": offset,
                "has_more": (offset + len(logs)) < total_count,
                "audit_logs": [
                    {
                        "id": e.id,
                        "action": e.action,
                        "actor": names_by_id.get(e.actor_user_id, "system"),
                        "target": names_by_id.get(e.target_user_id) if e.target_user_id else None,
                        "details": e.details,
                        "created_at": e.created_at.isoformat() if e.created_at else None,
                    }
                    for e in logs
                ]
            }
        finally:
            session.close()

    # ══════════════════════════════════════════════════════
    # REQUEST / RESPONSE MODELS
    # ══════════════════════════════════════════════════════
    class AccountCreateRequest(BaseModel):
        company_name: str
        domain: Optional[str] = None

    class AccountFetchRequest(BaseModel):
        company_name: str
        target_url: Optional[str] = None

    class AccountDumpRequest(BaseModel):
        account_data: Dict[str, Any]

    class Sec10kRequest(BaseModel):
        sec_cik: str
        chunk_size: int = 1500
        overlap: int = 200

    class PatentsRequest(BaseModel):
        company_name: str
        max_results: int = 10

    class LobsFetchRequest(BaseModel):
        company_name: str
        account_id: Optional[int] = None
        lob_name: Optional[str] = None
        lob_domain: Optional[str] = None

    class LobsDumpRequest(BaseModel):
        account_id: int
        lobs_data: List[Dict[str, Any]]

    class PersonaCardFetchRequest(BaseModel):
        """
        Exact payload structure sent by frontend when user clicks 'Fetch' on a Person card:
        {
          "key": "jane_doe",
          "display_name": "Jane Doe (CEO, Example Co)",
          "linkedin_url": "https://www.linkedin.com/in/janedoe/",
          "twitter_handle": null,
          "reddit_query": "\"Jane Doe\"",
          "sec_cik": null,
          "news_query": "\"Jane Doe\"",
          "patents_query": "Jane Doe",
          "youtube_channel_id": null,
          "rss_url": null,
          "account_id": null,
          "company_name": null,
          "title": null,
          "enrich_ai_dossier": true
        }
        """

        key: Optional[str] = None
        display_name: Optional[str] = None
        name: Optional[str] = None
        title: Optional[str] = None
        company_name: Optional[str] = None
        account_id: Optional[int] = None
        linkedin_url: Optional[str] = None
        twitter_handle: Optional[str] = None
        reddit_query: Optional[str] = None
        sec_cik: Optional[str] = None
        news_query: Optional[str] = None
        patents_query: Optional[str] = None
        youtube_channel_id: Optional[str] = None
        rss_url: Optional[str] = None
        enrich_ai_dossier: bool = True

    class PersonDumpRequest(BaseModel):
        account_id: int
        person_data: Dict[str, Any]

    class HierarchyFetchRequest(BaseModel):
        company_domain: str
        company_name: Optional[str] = None
        sec_cik: Optional[str] = None
        enrich_csuite_dossiers: bool = True

    class HierarchyDumpRequest(BaseModel):
        account_id: int
        hierarchy: Dict[str, List[Dict[str, Any]]]

    class PipelineRunRequest(BaseModel):
        company_name: str
        target_url: Optional[str] = None

    class PipelineDumpDbRequest(BaseModel):
        run_dir: Optional[str] = None
        file: Optional[str] = None
        require_validation: bool = True

    class OpportunitySignalItem(BaseModel):
        """One currently-detected growth-theme or domain-expansion suggestion, as computed client-side."""

        signal_key: str
        title: str
        details: Dict[str, Any] = {}

    class OpportunitySignalSyncRequest(BaseModel):
        category: str  # 'growth_theme' | 'domain_expansion'
        items: List[OpportunitySignalItem] = []

    class WeeklyDigestSyncRequest(BaseModel):
        """The `digest.email` object already produced weekly per-account by the content pipeline
        (see Digest.digest['email']), forwarded here so a snapshot of it gets archived."""

        target_key: str
        generated_at: Optional[str] = None
        subject: Optional[str] = None
        body: Optional[str] = None
        priority: Optional[str] = None
        confidence: Optional[str] = None
        data_gaps: List[str] = []
        do_not_say: List[str] = []

    class ActionItemCreateRequest(BaseModel):
        title: str
        description: Optional[str] = None
        persona_id: Optional[int] = None
        priority: str = "medium"  # high | medium | low
        due_date: Optional[str] = None  # ISO 8601
        assigned_to_id: Optional[int] = None

    class ActionItemUpdateRequest(BaseModel):
        title: Optional[str] = None
        description: Optional[str] = None
        persona_id: Optional[int] = None
        status: Optional[str] = None  # open | in_progress | done | cancelled
        priority: Optional[str] = None
        due_date: Optional[str] = None
        assigned_to_id: Optional[int] = None

    # ══════════════════════════════════════════════════════
    # TAB 1: ACCOUNT LEVEL ENDPOINTS
    # ══════════════════════════════════════════════════════
    account_router = APIRouter(prefix="/api/account", tags=["1. Account Level"])

    @account_router.post("/create")
    def create_account_stub(req: AccountCreateRequest):
        """[Tab 1 - Add Account Modal]: Creates or fetches an Account row in PostgreSQL with an official ID."""
        session = get_session()
        try:
            clean_name = req.company_name.strip()
            slug = slugify(clean_name)
            clean_dom = (
                req.domain.replace("https://", "").replace("http://", "").split("/")[0].strip().lower()
                if req.domain
                else None
            )

            # Check if account already exists by key, name, or domain
            filters = [
                Account.key == slug,
                Account.display_name.ilike(clean_name),
            ]
            if clean_dom:
                filters.extend(
                    [
                        Account.domain == clean_dom,
                        Account.primary_domain == clean_dom,
                    ]
                )

            existing = session.query(Account).filter(or_(*filters)).first()
            if existing:
                return {
                    "status": "exists",
                    "account_id": existing.id,
                    "key": existing.key,
                    "name": existing.display_name,
                    "domain": existing.primary_domain or existing.domain,
                    "message": (
                        f"Account '{existing.display_name}' already registered "
                        f"in database (ID: {existing.id})."
                    ),
                }

            # Create new minimal account row
            new_account = Account(
                key=slug,
                display_name=clean_name,
                legal_name=clean_name,
                domain=clean_dom,
                primary_domain=clean_dom,
                website_url=f"https://{clean_dom}" if clean_dom else None,
            )
            session.add(new_account)
            session.commit()
            session.refresh(new_account)

            return {
                "status": "created",
                "account_id": new_account.id,
                "key": new_account.key,
                "name": new_account.display_name,
                "domain": new_account.primary_domain,
                "message": (
                    f"Account '{new_account.display_name}' created successfully "
                    f"in database (ID: {new_account.id})."
                ),
            }
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"Account creation failed: {str(e)}")
        finally:
            session.close()

    @account_router.post("/fetch")
    def fetch_account_data(req: AccountFetchRequest):
        """[Tab 1 - Fetch Button]: Enterprise 11-source account intelligence collection.
        Uses AccountService.collect() with: SEC EDGAR, GLEIF, OpenCorporates, FMP, CourtListener,
        Finnhub, Apify Crunchbase (curious_coder/crunchbase-url-scraper), Apify Glassdoor
        (memo23/glassdoor-scraper), Diffbot KG, Serper, Wikipedia, FEC — plus standalone
        connectors: 10-K chunks, USPTO patents, SEC Exhibit 21 subsidiaries, GLEIF ownership tree.
        """
        try:
            account_data = AccountService.collect(
                company_name=req.company_name,
                domain=req.target_url,
            )

            # Attach known LOBs and personas already in DB for this account
            session = get_session()
            try:
                existing = (
                    session.query(Account)
                    .filter(
                        or_(
                            Account.domain == req.target_url,
                            Account.primary_domain == req.target_url,
                            Account.display_name.ilike(f"%{req.company_name}%"),
                        )
                    )
                    .first()
                )
                if existing:
                    account_data["known_lobs"] = [
                        {"id": lob_item.id, "name": lob_item.lob_name, "domain": lob_item.domain}
                        for lob_item in (existing.lobs or [])
                    ]
                    account_data["known_personas"] = [
                        {"id": p.id, "name": p.full_name, "title": p.title, "tier": p.tier}
                        for p in (existing.personas or [])
                    ]
                    account_data["lobs_count"] = len(account_data["known_lobs"])
                    account_data["total_contacts_captured"] = len(account_data["known_personas"])
            except Exception as db_err:
                print(f"[!] DB lookup for known LOBs/personas notice: {db_err}")
            finally:
                session.close()

            # Build the required_account sub-key so AccountSchema.from_enriched_json() finds OSINT URLs
            required_account = {
                "key": account_data.get("key"),
                "display_name": account_data.get("display_name"),
                "sec_edgar_url": account_data.get("sec_edgar_url"),
                "sec_filings_rss": account_data.get("sec_filings_rss"),
                "sec_submissions_url": account_data.get("sec_submissions_url"),
                "twitter_live_url": account_data.get("twitter_live_url"),
                "reddit_query": account_data.get("reddit_query"),
                "reddit_rss_url": account_data.get("reddit_rss_url"),
                "news_query": account_data.get("news_query"),
                "rss_url": account_data.get("rss_url"),
                "google_patents_url": account_data.get("google_patents_url"),
                "google_trends_url": account_data.get("google_trends_url"),
                "youtube_search_url": account_data.get("youtube_search_url"),
                "openalex_institution_url": account_data.get("openalex_institution_url"),
                "wikidata_entity_url": account_data.get("wikidata_entity_url"),
                "blog_url": account_data.get("blog_url"),
                "github_url": account_data.get("github_url"),
                "glassdoor_url": account_data.get("glassdoor_url"),
                "youtube_channel_id": account_data.get("youtube_channel_id"),
            }

            wrapped = {
                **account_data,
                "required_account": required_account,
                # Mirror all fields into nested sub-dicts that from_enriched_json() reads
                "identity": account_data,
                "firmographics": account_data,
                "location": account_data,
                "contact_and_social": account_data,
                "financials_and_funding": account_data,
                "market_and_ipo": account_data,
                "acquisitions_and_suborgs": account_data,
                "web_traffic_and_growth": account_data,
                "tech_and_patents": account_data,
                "key_people": account_data,
            }

            return {"status": "staged", "company_name": req.company_name, "account": wrapped}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Account fetch failed: {str(e)}")

    @account_router.post("/validate")
    def validate_account_data(account_data: Dict[str, Any] = Body(...)):
        """[Tab 1 - Validate Button]: Validates staged account data."""
        try:
            report = DataQualityValidator.validate_account(account_data)
            return {
                "status": "validated",
                "score": report["score"],
                "checks": report["checks"],
                "warnings": report["warnings"],
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Account validation failed: {str(e)}")

    @account_router.post("/dump-db")
    def dump_account_to_db(req: AccountDumpRequest):
        """[Tab 1 - Dump DB Button]: Commits validated account data into PostgreSQL `accounts` table."""
        session = get_session()
        try:
            wrapper_doc = {"account": req.account_data}
            schema = AccountSchema.from_enriched_json(wrapper_doc)
            repo = AccountRepository(session)
            acct = repo.upsert(schema)
            session.commit()
            return {
                "status": "success",
                "account_id": acct.id,
                "key": acct.key,
                "legal_name": acct.legal_name,
                "message": f"Account '{acct.key}' successfully saved to database.",
            }
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"Account DB dump failed: {str(e)}")
        finally:
            session.close()

    def _serialize_persona_full(p: Persona) -> Dict[str, Any]:
        return {
            "id": p.id,
            "key": p.key,
            "name": p.full_name,
            "full_name": p.full_name,
            "first_name": p.first_name,
            "last_name": p.last_name,
            "title": p.title,
            "tier": p.tier,
            "seniority_raw": p.seniority_raw,
            "departments": p.departments or ["Executive"],
            "email": p.email,
            "email_status": p.email_status,
            "phone": p.phone,
            "linkedin_url": p.linkedin_url,
            "city": p.city,
            "state": p.state,
            "country": p.country,
            "hierarchy_level": p.hierarchy_level,
            "decision_authority": p.decision_authority,
            "budget_authority": p.budget_authority,
            "twitter_handle": p.twitter_handle,
            "twitter_live_url": p.twitter_live_url,
            "reddit_query": p.reddit_query,
            "reddit_rss_url": p.reddit_rss_url,
            "sec_cik": p.sec_cik,
            "sec_insider_trades_url": p.sec_insider_trades_url,
            "news_query": p.news_query,
            "rss_url": p.rss_url,
            "patents_query": p.patents_query,
            "google_patents_url": p.google_patents_url,
            "google_scholar_url": p.google_scholar_url,
            "openalex_author_url": p.openalex_author_url,
            "orcid_search_url": p.orcid_search_url,
            "wikidata_person_url": p.wikidata_person_url,
            "youtube_interviews_url": p.youtube_interviews_url,
            "podcast_search_url": p.podcast_search_url,
            "google_trends_url": p.google_trends_url,
            "youtube_channel_id": p.youtube_channel_id,
            "skills": p.skills or [],
            "target_kpis": p.target_kpis or [],
            "operational_pain_points": p.operational_pain_points or [],
            "key_objections": p.key_objections or [],
            "degree": p.degree,
            "institution": p.institution,
            "prior_company": p.prior_company,
            "communication_style": p.communication_style,
            "engagement_rate": p.engagement_rate,
            "value_proposition": p.value_proposition,
            "personalized_icebreaker": p.personalized_icebreaker,
            "social_platform": p.social_platform,
            "social_profile_url": p.social_profile_url,
            "social_presence_level": p.social_presence_level,
            "raw_data": p.raw_data,
        }

    def _serialize_persona_summary(p: Persona) -> Dict[str, Any]:
        # Trimmed for the account-list view: only what nav-tree/digest/topbar's
        # cross-account rollups (target-key resolution, tier labeling, C-suite
        # detection) actually read. Full dossier fields (raw_data, icebreakers,
        # KPIs, every enrichment URL, ...) are only fetched once an account is
        # opened, via _serialize_persona_full.
        return {
            "id": p.id,
            "key": p.key,
            "name": p.full_name,
            "full_name": p.full_name,
            "title": p.title,
            "tier": p.tier,
            "hierarchy_level": p.hierarchy_level,
        }

    def _distribute_personas_across_lobs(raw_lobs, personas_list):
        """Synthetic C-suite + VP-cohort split across LOBs for display grouping —
        not the DB's real Persona.lob_id relationship, just how the UI has always
        grouped contacts per division. Shared by the full and summary serializers
        so both agree on the same per-LOB counts/lists."""
        c_suite_personas = [
            p for p in personas_list if p.get("tier") == "C-Suite" or p.get("hierarchy_level") in [1, 2]
        ]
        vp_personas = [p for p in personas_list if p not in c_suite_personas]
        total_lobs = len(raw_lobs) or 1
        assignments = []
        for idx, lob_item in enumerate(raw_lobs):
            chunk_size = max(1, len(vp_personas) // total_lobs) if vp_personas else 0
            start_i = idx * chunk_size
            end_i = start_i + chunk_size if idx < total_lobs - 1 else len(vp_personas)
            assignments.append((lob_item, c_suite_personas[:2] + vp_personas[start_i:end_i]))
        return assignments

    def _serialize_lob_full(lob_item: Lob, assigned_personas: List[Dict[str, Any]]) -> Dict[str, Any]:
        sub_lobs_formatted = [
            {"id": s.id, "name": s.name, "desc": f"Specialized unit under {lob_item.lob_name}"}
            for s in (lob_item.sub_lobs or [])
        ]
        return {
            "id": lob_item.id,
            "name": lob_item.lob_name,
            "lob_name": lob_item.lob_name,
            "domain": lob_item.domain,
            "website_url": lob_item.website_url,
            "desc": lob_item.overview,
            "overview": lob_item.overview,
            "revenue": lob_item.audited_segment_revenue,
            "audited_segment_revenue": lob_item.audited_segment_revenue,
            "head": lob_item.operating_head,
            "operating_head": lob_item.operating_head,
            "headcount": lob_item.segment_headcount,
            "segment_headcount": lob_item.segment_headcount,
            "lei_code": lob_item.lei_code,
            "jurisdiction": lob_item.jurisdiction,
            "technologies": lob_item.technologies or [],
            "competitors": lob_item.competitors or [],
            "financial_snippets": lob_item.financial_snippets or [],
            "patents": lob_item.patents or [],
            "logo_url": lob_item.logo_url,
            "google_news_rss_url": lob_item.google_news_rss_url,
            "reddit_rss_url": lob_item.reddit_rss_url,
            "google_patents_url": lob_item.google_patents_url,
            "google_trends_url": lob_item.google_trends_url,
            "youtube_search_url": lob_item.youtube_search_url,
            "subLobs": sub_lobs_formatted,
            "sub_lobs": sub_lobs_formatted,
            "personas": assigned_personas,
        }

    def _serialize_lob_summary(lob_item: Lob, assigned_personas_count: int) -> Dict[str, Any]:
        # Trimmed: keeps technologies/competitors (read by computeSignals() for
        # EVERY account on every nav-tree/topbar render) and subLobs (nav-tree
        # renders sub-LOB names in the expanded row), drops financial_snippets/
        # patents/deep URLs which are only read once an account is opened.
        sub_lobs_formatted = [{"id": s.id, "name": s.name} for s in (lob_item.sub_lobs or [])]
        return {
            "id": lob_item.id,
            "name": lob_item.lob_name,
            "lob_name": lob_item.lob_name,
            "technologies": lob_item.technologies or [],
            "competitors": lob_item.competitors or [],
            "subLobs": sub_lobs_formatted,
            "sub_lobs": sub_lobs_formatted,
            "personas_count": assigned_personas_count,
        }

    def _serialize_account_full(acct: Account) -> Dict[str, Any]:
        personas_list = [_serialize_persona_full(p) for p in (acct.personas or [])]
        raw_lobs = acct.lobs or []
        lobs_list = [
            _serialize_lob_full(lob_item, assigned)
            for lob_item, assigned in _distribute_personas_across_lobs(raw_lobs, personas_list)
        ]

        acct_name = acct.legal_name or acct.display_name or acct.key
        acct_loc = acct.headquarters_location or (f"{acct.city}, {acct.country}" if acct.city else None)
        acct_desc = acct.short_description or acct.full_description

        return {
            "id": acct.id,
            "key": acct.key,
            "name": acct_name,
            "display_name": acct.display_name or acct_name,
            "legal_name": acct.legal_name or acct_name,
            "ticker": acct.stock_symbol,
            "stock_symbol": acct.stock_symbol,
            "revenue": acct.estimated_revenue_range or "Revenue N/A",
            "location": acct_loc,
            "desc": acct_desc,
            "domain": acct.domain,
            "primary_domain": acct.primary_domain or acct.domain,
            "website_url": acct.website_url,
            "crunchbase_url": acct.crunchbase_url,
            "operating_status": acct.operating_status,
            "company_type": acct.company_type,
            "founded_year": acct.founded_year,
            "employee_count_range": acct.employee_count_range,
            "short_description": acct_desc,
            "full_description": acct.full_description or acct_desc,
            "headquarters_location": acct_loc,
            "city": acct.city,
            "state": acct.state,
            "country": acct.country,
            "postal_code": acct.postal_code,
            "phone_number": acct.phone_number,
            "sanitized_phone": acct.sanitized_phone,
            "contact_email": acct.contact_email,
            "linkedin_url": acct.linkedin_url,
            "twitter_url": acct.twitter_url,
            "twitter_handle": acct.twitter_handle,
            "stock_exchange": acct.stock_exchange,
            "sec_cik": acct.sec_cik,
            "sec_edgar_url": acct.sec_edgar_url,
            "sec_filings_rss": acct.sec_filings_rss,
            "sec_submissions_url": acct.sec_submissions_url,
            "twitter_live_url": acct.twitter_live_url,
            "reddit_query": acct.reddit_query,
            "reddit_rss_url": acct.reddit_rss_url,
            "news_query": acct.news_query,
            "rss_url": acct.rss_url,
            "google_patents_url": acct.google_patents_url,
            "google_trends_url": acct.google_trends_url,
            "youtube_search_url": acct.youtube_search_url,
            "openalex_institution_url": acct.openalex_institution_url,
            "wikidata_entity_url": acct.wikidata_entity_url,
            "github_url": acct.github_url,
            "glassdoor_url": acct.glassdoor_url,
            "blog_url": acct.blog_url,
            "industries": acct.industries or [],
            "keywords": acct.keywords or [],
            "lobs_count": len(lobs_list),
            "total_contacts_captured": len(personas_list),
            "lobs": lobs_list,
            "personas": personas_list,
            "multi_source_intelligence": acct.multi_source_intelligence,
            "organisational_hierarchy_tree": acct.organisational_hierarchy_tree,
            "extracted_at": acct.extracted_at.isoformat() if acct.extracted_at else None,
            # ── Engagement / opportunity signals (previously captured but never exposed) ──
            "heat_score": acct.heat_score,
            "trend_score_90d": acct.trend_score_90d,
            "active_tech_count": acct.active_tech_count,
            "it_spend": acct.it_spend,
            "patents_granted": acct.patents_granted,
            "trademarks_registered": acct.trademarks_registered,
            "total_funding_amount_usd": acct.total_funding_amount_usd,
            "total_funding_currency": acct.total_funding_currency,
            "last_funding_type": acct.last_funding_type,
            "last_funding_date": acct.last_funding_date.isoformat() if acct.last_funding_date else None,
            "num_funding_rounds": acct.num_funding_rounds,
            "funding_status": acct.funding_status,
            "ipo_status": acct.ipo_status,
            "ipo_date": acct.ipo_date.isoformat() if acct.ipo_date else None,
            "num_suborganizations": acct.num_suborganizations,
            "num_acquisitions": acct.num_acquisitions,
            "global_traffic_rank": acct.global_traffic_rank,
            "monthly_visits": acct.monthly_visits,
            "bounce_rate": acct.bounce_rate,
            "visit_duration": acct.visit_duration,
            "page_views_per_visit": acct.page_views_per_visit,
            "c_suite_count": acct.c_suite_count
            or len(
                [
                    p
                    for p in personas_list
                    if (p.get("tier") or "").lower() in ["c-suite", "c_suite", "c"]
                    or any(
                        w in (p.get("title") or "").lower()
                        for w in ["chief", "president", "ceo", "chairman", "board"]
                    )
                ]
            ),
            "vp_count": acct.vp_count
            or len(
                [
                    p
                    for p in personas_list
                    if "vp" in (p.get("tier") or "").lower()
                    or "vice president" in (p.get("title") or "").lower()
                ]
            ),
            "director_count": acct.director_count
            or len(
                [
                    p
                    for p in personas_list
                    if "director" in (p.get("tier") or "").lower()
                    or "director" in (p.get("title") or "").lower()
                ]
            ),
            "manager_count": acct.manager_count
            or len(
                [
                    p
                    for p in personas_list
                    if "manager" in (p.get("tier") or "").lower()
                    or "manager" in (p.get("title") or "").lower()
                ]
            ),
        }

    def _serialize_account_summary(acct: Account) -> Dict[str, Any]:
        # Trimmed for the account-LIST view (nav tree, digest, topbar ticker).
        # Keeps every field those cross-account rollups actually read — traced
        # via computeSignals() (signals.js), computeDomainExpansionOpportunities()
        # (opportunities.js), resolveAccountTargetKey()/resolvePersonaTargetKey()
        # (utils.js) and nav-tree.js/topbar.js/digest.js directly — and drops the
        # rest (descriptive text, contact/social URLs, org chart tree, and each
        # persona's full dossier / each LOB's deep intelligence fields), which are
        # only needed once a specific account is opened, via _serialize_account_full.
        personas_list = [_serialize_persona_summary(p) for p in (acct.personas or [])]
        raw_lobs = acct.lobs or []
        lobs_list = [
            _serialize_lob_summary(lob_item, len(assigned))
            for lob_item, assigned in _distribute_personas_across_lobs(raw_lobs, personas_list)
        ]

        acct_name = acct.legal_name or acct.display_name or acct.key
        acct_loc = acct.headquarters_location or (f"{acct.city}, {acct.country}" if acct.city else None)

        return {
            "id": acct.id,
            "key": acct.key,
            "name": acct_name,
            "display_name": acct.display_name or acct_name,
            "legal_name": acct.legal_name or acct_name,
            "ticker": acct.stock_symbol,
            "stock_symbol": acct.stock_symbol,
            "location": acct_loc,
            "headquarters_location": acct_loc,
            "city": acct.city,
            "state": acct.state,
            "country": acct.country,
            "company_type": acct.company_type,
            "employee_count_range": acct.employee_count_range,
            "linkedin_url": acct.linkedin_url,
            "stock_exchange": acct.stock_exchange,
            "sec_cik": acct.sec_cik,
            "industries": acct.industries or [],
            "lobs_count": len(lobs_list),
            "total_contacts_captured": len(personas_list),
            "lobs": lobs_list,
            "personas": personas_list,
            "multi_source_intelligence": acct.multi_source_intelligence,
            "extracted_at": acct.extracted_at.isoformat() if acct.extracted_at else None,
            "heat_score": acct.heat_score,
            "trend_score_90d": acct.trend_score_90d,
            "active_tech_count": acct.active_tech_count,
            "it_spend": acct.it_spend,
            "patents_granted": acct.patents_granted,
            "trademarks_registered": acct.trademarks_registered,
            "total_funding_amount_usd": acct.total_funding_amount_usd,
            "last_funding_type": acct.last_funding_type,
            "last_funding_date": acct.last_funding_date.isoformat() if acct.last_funding_date else None,
            "num_funding_rounds": acct.num_funding_rounds,
            "funding_status": acct.funding_status,
            "ipo_status": acct.ipo_status,
            "ipo_date": acct.ipo_date.isoformat() if acct.ipo_date else None,
            "num_acquisitions": acct.num_acquisitions,
            "global_traffic_rank": acct.global_traffic_rank,
            "monthly_visits": acct.monthly_visits,
            "bounce_rate": acct.bounce_rate,
            "visit_duration": acct.visit_duration,
            "page_views_per_visit": acct.page_views_per_visit,
            "c_suite_count": acct.c_suite_count
            or len(
                [
                    p
                    for p in personas_list
                    if (p.get("tier") or "").lower() in ["c-suite", "c_suite", "c"]
                    or any(
                        w in (p.get("title") or "").lower()
                        for w in ["chief", "president", "ceo", "chairman", "board"]
                    )
                ]
            ),
            "vp_count": acct.vp_count
            or len(
                [
                    p
                    for p in personas_list
                    if "vp" in (p.get("tier") or "").lower()
                    or "vice president" in (p.get("title") or "").lower()
                ]
            ),
            "director_count": acct.director_count
            or len(
                [
                    p
                    for p in personas_list
                    if "director" in (p.get("tier") or "").lower()
                    or "director" in (p.get("title") or "").lower()
                ]
            ),
            "manager_count": acct.manager_count
            or len(
                [
                    p
                    for p in personas_list
                    if "manager" in (p.get("tier") or "").lower()
                    or "manager" in (p.get("title") or "").lower()
                ]
            ),
        }

    @account_router.get("")
    def list_all_accounts_with_hierarchy(response: Response, user: User = Depends(auth.get_current_user)):
        """
        [Page Initialization (loadData())]:
        Queries PostgreSQL (accounts, lobs, sub_lobs, personas) and returns a
        trimmed summary dossier per account — enough for the nav tree, digest,
        and topbar ticker's cross-account rollups. Full per-account detail
        (persona dossiers, LOB financials/patents, org chart) is fetched
        on-demand via GET /api/accounts/{account_id} once that account is opened.

        A super_admin sees every account; anyone else sees only accounts a
        super_admin has explicitly granted them (see user_account_access) —
        a user with zero grants sees an empty list, not an error.
        """
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        session = get_session()
        try:
            query = session.query(Account).options(
                selectinload(Account.personas),
                selectinload(Account.lobs).selectinload(Lob.sub_lobs)
            )
            if user.role != "super_admin":
                accessible_ids = auth.get_accessible_account_ids(session, user.id)
                query = query.filter(Account.id.in_(accessible_ids)) if accessible_ids else query.filter(False)
            accounts = query.order_by(Account.id.desc()).all()
            return {"accounts": [_serialize_account_summary(acct) for acct in accounts]}

        finally:
            session.close()

    @app.get("/api/accounts", tags=["1. Account Level"])
    def list_all_accounts_alias(response: Response, user: User = Depends(auth.get_current_user)):
        """Plural alias for /api/account list endpoint."""
        return list_all_accounts_with_hierarchy(response, user)

    @account_router.get("/{account_id}")
    def get_account_from_db(account_id: int, user: User = Depends(auth.require_account_access)):
        """Retrieves one account's full dossier from DB — complete LOBs and
        personas — fetched on demand when that account is opened."""
        session = get_session()
        try:
            acct = (
                session.query(Account)
                .options(
                    selectinload(Account.personas), selectinload(Account.lobs).selectinload(Lob.sub_lobs)
                )
                .filter_by(id=account_id)
                .first()
            )
            if not acct:
                raise HTTPException(status_code=404, detail="Account not found.")
            return _serialize_account_full(acct)
        finally:
            session.close()

    @account_router.post("/sec-10k-chunks")
    def extract_sec_10k_chunks(req: Sec10kRequest):
        """
        [Real-time SEC 10-K Chunker]:
        Fetches the latest official 10-K filing from SEC EDGAR, extracts Item 1 (Business),
        Item 1A (Risk Factors), and Item 7 (MD&A), and chunks text for AI RAG/Vector embeddings.
        """
        try:
            return fetch_latest_10k_chunks(
                sec_cik=req.sec_cik, chunk_size=req.chunk_size, overlap=req.overlap
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"10-K Chunking failed: {str(e)}")

    @account_router.post("/patents")
    def get_full_patents(req: PatentsRequest):
        """
        [Full Patent Text Extractor]:
        Queries USPTO and open patent registries for granted patents and abstracts.
        """
        try:
            return extract_full_patents(company_name=req.company_name, max_results=req.max_results)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Patent extraction failed: {str(e)}")

    @account_router.post("/sec-exhibit-21")
    def get_sec_exhibit_21_subsidiaries(req: Sec10kRequest):
        """
        [SEC EDGAR Exhibit 21 (Subsidiaries of Registrant) Extractor]:
        Fetches the official legal Exhibit 21 filed with Form 10-K, returning
        all legally registered subsidiaries and their jurisdictions of incorporation.
        """
        try:
            return fetch_sec_exhibit_21_subsidiaries(sec_cik=req.sec_cik)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Exhibit 21 extraction failed: {str(e)}")

    @account_router.post("/gleif")
    def get_gleif_ownership_tree(req: PatentsRequest):
        """
        [GLEIF Corporate Ownership Graph Resolver]:
        Queries the official G20 LEI database for legal registered name,
        LEI code, direct/ultimate parent entities, and global child subsidiaries.
        """
        try:
            return fetch_gleif_ownership_tree(company_name=req.company_name, max_children=req.max_results)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"GLEIF extraction failed: {str(e)}")

    @account_router.post("/wikipedia")
    def get_wikipedia_intel(req: PatentsRequest):
        """
        [Wikipedia & DBpedia Open Knowledge Graph Extractor]:
        Queries Wikipedia REST API & DBpedia for executive summary, founding date, and logo.
        """
        try:
            return fetch_wikipedia_dbpedia_intel(company_name=req.company_name)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Wikipedia extraction failed: {str(e)}")

    @account_router.post("/fec")
    def get_fec_political_intel(req: PatentsRequest):
        """
        [FEC Federal Election Commission Political Giving API]:
        Queries OpenFEC via data.gov API key for corporate PAC contributions & executive donations.
        """
        try:
            return fetch_fec_political_intel(entity_name=req.company_name, max_records=req.max_results)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"FEC extraction failed: {str(e)}")

    @account_router.post("/diffbot")
    def get_diffbot_intel(req: AccountFetchRequest):
        """
        [Diffbot Knowledge Graph (DKG) Enhancer]:
        Queries Diffbot AI Knowledge Graph for verified firmographics, logo, technologies,
        competitors, subsidiaries, parent organizations, and board members.
        """
        try:
            return fetch_diffbot_organization_intel(company_name=req.company_name, website_url=req.target_url)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Diffbot extraction failed: {str(e)}")

    # ══════════════════════════════════════════════════════
    # TAB 2 & 3: LOB & SUB-LOB LEVEL ENDPOINTS
    # ══════════════════════════════════════════════════════
    lobs_router = APIRouter(prefix="/api/lobs", tags=["2. LOB & Sub-LOB Level"])

    @lobs_router.post("/fetch")
    def fetch_lobs_data(req: LobsFetchRequest):
        """[Tab 2 - Fetch Button]: Discovers sub-organizations and enriches
        segment revenues (single LOB or full company)."""
        try:
            if req.lob_name:
                single_lob = LobService.enrich_single_lob(
                    lob_name=req.lob_name,
                    parent_company=req.company_name,
                    account_id=req.account_id,
                    lob_domain=req.lob_domain,
                )
                return {
                    "status": "staged",
                    "company_name": req.company_name,
                    "lob": single_lob,
                    "lobs": [single_lob],
                    "total_lobs": 1,
                }
            else:
                raw_sublobs = scrape_sublobs(req.company_name)
                enriched_lobs = enrich_lob_segments(req.company_name, raw_sublobs)
                return {
                    "status": "staged",
                    "company_name": req.company_name,
                    "total_lobs": len(enriched_lobs),
                    "lobs": enriched_lobs,
                }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"LOB fetch failed: {str(e)}")

    @lobs_router.post("/validate")
    def validate_lobs_data(lobs_data: List[Dict[str, Any]] = Body(...)):
        """[Tab 2 - Validate Button]: Validates LOB and Sub-LOB data."""
        try:
            report = DataQualityValidator.validate_lobs(lobs_data)
            return {
                "status": "validated",
                "score": report["score"],
                "lobs_count": report["lobs_count"],
                "total_with_domain": report["total_with_domain"],
                "details": report["details"],
                "warnings": report["warnings"],
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"LOB validation failed: {str(e)}")

    @lobs_router.post("/validate-single")
    def validate_single_lob(lob_data: Dict[str, Any] = Body(...)):
        """[Tab 2 - Individual Validate Button]: Validates a single LOB entity."""
        try:
            audit = LobValidator.validate_lob(lob_data)
            warnings = []
            if not lob_data.get("domain") and not lob_data.get("website_url"):
                warnings.append("Domain/Website URL is missing.")
            if not lob_data.get("operating_head"):
                warnings.append("Operating head not identified.")
            if not lob_data.get("technologies"):
                warnings.append("Technology stack not detected.")
            return {
                "status": "validated",
                "score": audit.get("score", 85),
                "grade": audit.get("grade", "B"),
                "ready_for_db": audit.get("ready_for_db", True),
                "warnings": warnings,
                "missing_critical": audit.get("missing_critical", []),
                "missing_important": audit.get("missing_important", []),
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"LOB validation failed: {str(e)}")

    @lobs_router.post("/dump-single-db")
    def dump_single_lob_to_db(req: Dict[str, Any] = Body(...)):
        """[Tab 2 - Individual Dump DB Button]: Commits a single validated LOB into PostgreSQL `lobs` table."""
        session = get_session()
        try:
            account_id = req.get("account_id")
            lob_data = req.get("lob_data") or req
            acct = session.query(Account).filter_by(id=account_id).first()
            if not acct:
                raise HTTPException(status_code=404, detail=f"Account ID {account_id} not found in DB.")

            lob_repo = LobRepository(session)
            saved = lob_repo.upsert_single_lob(acct.id, lob_data)
            session.commit()
            return {
                "status": "success",
                "lob_id": getattr(saved, "id", None),
                "message": f"LOB '{lob_data.get('name') or lob_data.get('lob_name')}' saved to database.",
            }
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"LOB DB dump failed: {str(e)}")
        finally:
            session.close()

    @lobs_router.post("/dump-db")
    def dump_lobs_to_db(req: LobsDumpRequest):
        """[Tab 2 - Dump DB Button]: Commits validated LOBs and Sub-LOBs to
        PostgreSQL `lobs` & `sub_lobs` tables."""
        session = get_session()
        try:
            acct = session.query(Account).filter_by(id=req.account_id).first()
            if not acct:
                raise HTTPException(status_code=404, detail=f"Account ID {req.account_id} not found in DB.")

            lob_repo = LobRepository(session)
            lob_map = lob_repo.upsert_all(acct, req.lobs_data)
            session.commit()
            return {
                "status": "success",
                "account_id": acct.id,
                "lobs_saved": len(lob_map),
                "lob_mapping": lob_map,
                "message": f"Saved {len(lob_map)} LOBs for Account '{acct.key}'.",
            }
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"LOB DB dump failed: {str(e)}")
        finally:
            session.close()

    @lobs_router.get("")
    def get_lobs_for_account(account_id: int = Query(...)):
        """Retrieves stored LOBs and sub-lobs for an account."""
        session = get_session()
        try:
            lobs = session.query(Lob).filter_by(account_id=account_id).all()
            return [
                {
                    "id": lob_item.id,
                    "account_id": lob_item.account_id,
                    "lob_name": lob_item.lob_name,
                    "domain": lob_item.domain,
                    "website_url": lob_item.website_url,
                    "audited_segment_revenue": lob_item.audited_segment_revenue,
                    "operating_head": lob_item.operating_head,
                    "segment_headcount": lob_item.segment_headcount,
                    "google_news_rss_url": lob_item.google_news_rss_url,
                    "reddit_rss_url": lob_item.reddit_rss_url,
                    "google_patents_url": lob_item.google_patents_url,
                    "youtube_search_url": lob_item.youtube_search_url,
                    "sub_lobs": [{"id": s.id, "name": s.name} for s in (lob_item.sub_lobs or [])],
                }
                for lob_item in lobs
            ]
        finally:
            session.close()

    # ══════════════════════════════════════════════════════
    # TAB 4: PERSONAS LEVEL (INDIVIDUAL & BATCH LIFECYCLE)
    # ══════════════════════════════════════════════════════
    personas_router = APIRouter(prefix="/api/personas", tags=["3. Personas Level"])

    @personas_router.post("/fetch")
    def fetch_persona_from_card(card: PersonaCardFetchRequest):
        """
        [Tab 4 - Person Card 'Fetch' Button]:
        Accepts the incoming person card payload from frontend, dynamically resolves identity,
        generates all 18 official scraping URLs, and synthesizes neural AI dossier.
        """
        try:
            # 1. Dynamically parse name, title, and company from incoming payload
            raw_display = card.display_name or ""
            parsed_name = card.name
            parsed_title = card.title
            parsed_company = card.company_name

            # Dynamic extraction from display_name if explicit fields are omitted
            # (e.g. "Jane Doe (CEO, Example Co)")
            if not parsed_name and raw_display:
                parsed_name = re.sub(r"\s*\(.*?\)", "", raw_display).strip()
            if not parsed_name and card.key:
                parsed_name = card.key.replace("_", " ").title()

            if raw_display and "(" in raw_display:
                match = re.search(r"\((.*?)\)", raw_display)
                if match:
                    parts = match.group(1).split(",")
                    if not parsed_title and len(parts) >= 1:
                        parsed_title = parts[0].strip()
                    if not parsed_company and len(parts) >= 2:
                        parsed_company = parts[1].strip()

            parsed_name = parsed_name or "Executive"
            parsed_title = parsed_title or "Leadership"
            parsed_company = parsed_company or ""

            # If company not in payload but account_id provided, look up company from DB
            if not parsed_company and card.account_id:
                session = get_session()
                try:
                    acct = session.query(Account).filter_by(id=card.account_id).first()
                    if acct:
                        parsed_company = acct.legal_name or acct.display_name or acct.key
                finally:
                    session.close()

            # 2. Enrich via Enterprise PersonaService (FullEnrich + Exa + Apollo + Serper + SEC + ORCID + OpenAlex)
            person_entry = PersonaService.enrich_single_persona(
                full_name=parsed_name,
                company_name=parsed_company,
                title=parsed_title,
                account_id=card.account_id,
                linkedin_url=card.linkedin_url,
            )

            # 3. Auto-save single persona slice into raw/enriched run folder
            company_slug = slugify(parsed_company) if parsed_company else "general"
            person_slug = slugify(parsed_name)
            run_dirs = config.get_run_output_dirs(parsed_company or "persona_run")
            person_file = (
                run_dirs["enriched_personas_company_dir"]
                / f"{company_slug}_corporate_{person_slug}_enriched.json"
            )
            MasterSerializer.save_json(person_entry, person_file)

            return {
                "status": "staged",
                "message": f"Successfully fetched and enriched persona for '{parsed_name}'.",
                "saved_file": str(person_file),
                "person": person_entry,
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Persona fetch failed: {str(e)}")

    @personas_router.post("/validate-single")
    def validate_single_persona(person_data: Dict[str, Any] = Body(...)):
        """
        [Tab 4 - Individual Validate Button]:
        Validates a single person's contact data, scraping URLs, and AI dossier.
        """
        try:
            audit = PersonaValidator.validate_persona(person_data)

            warnings = []
            if not person_data.get("linkedin_url"):
                warnings.append("LinkedIn URL is missing or unverified.")
            if not person_data.get("email"):
                warnings.append("Email address not verified.")
            if not person_data.get("value_proposition"):
                warnings.append("AI Persona Dossier has not been synthesized.")

            return {
                "status": "validated",
                "score": audit.get("score", 90),
                "grade": audit.get("grade", "A"),
                "person_name": person_data.get("display_name")
                or person_data.get("name")
                or person_data.get("full_name"),
                "has_verified_linkedin": bool(person_data.get("linkedin_url")),
                "has_verified_email": bool(person_data.get("email")),
                "has_ai_dossier": bool(person_data.get("value_proposition")),
                "warnings": warnings,
                "missing_critical": audit.get("missing_critical", []),
                "missing_important": audit.get("missing_important", []),
                "ready_for_db": audit.get("ready_for_db", True),
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Persona validation failed: {str(e)}")

    @personas_router.post("/dump-single-db")
    def dump_single_persona_to_db(req: PersonDumpRequest):
        """
        [Tab 4 - Individual Dump DB Button]: Commits a single validated persona into PostgreSQL `personas` table.
        """
        session = get_session()
        try:
            acct = session.query(Account).filter_by(id=req.account_id).first()
            if not acct:
                raise HTTPException(status_code=404, detail=f"Account ID {req.account_id} not found in DB.")

            schema = PersonaSchema.from_enriched_json(req.person_data)

            # Check if persona with same key exists for account
            existing = session.query(Persona).filter_by(account_id=acct.id, key=schema.key).first()
            if existing:
                persona = existing
            else:
                persona = Persona(account_id=acct.id)
                session.add(persona)

            data = schema.model_dump()
            for field, value in data.items():
                if hasattr(persona, field):
                    setattr(persona, field, value)

            session.commit()
            return {
                "status": "success",
                "persona_id": persona.id,
                "full_name": persona.full_name,
                "title": persona.title,
                "tier": persona.tier,
                "message": f"Persona '{persona.full_name}' saved to database.",
            }
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"Persona DB dump failed: {str(e)}")
        finally:
            session.close()

    @personas_router.post("/fetch-hierarchy")
    def fetch_full_hierarchy(req: HierarchyFetchRequest):
        """[Tab 4 - Full Org Hierarchy Fetch Button]: Pulls live 4-tier organization hierarchy."""
        try:
            hierarchy = scrape_hierarchy(
                company_domain=req.company_domain, company_name=req.company_name, sec_cik=req.sec_cik
            )

            if req.enrich_csuite_dossiers and hierarchy.get("c_suite"):
                for p in hierarchy["c_suite"][:2]:
                    p["persona_dossier"] = build_persona_dossier(
                        p.get("name"),
                        p.get("title"),
                        req.company_name or req.company_domain,
                        p.get("linkedin_url"),
                    )

            total = sum(
                len(hierarchy.get(k, [])) for k in ["c_suite", "vp_level", "director_level", "manager_level"]
            )
            return {
                "status": "staged",
                "total_contacts": total,
                "tier_counts": {
                    k: len(hierarchy.get(k, []))
                    for k in ["c_suite", "vp_level", "director_level", "manager_level"]
                },
                "hierarchy": hierarchy,
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Hierarchy fetch failed: {str(e)}")

    @personas_router.post("/validate")
    def validate_personas(hierarchy: Dict[str, List[Dict[str, Any]]] = Body(...)):
        """[Tab 4 - Hierarchy Validate Button]: Validates 4-tier hierarchy."""
        try:
            report = DataQualityValidator.validate_hierarchy_and_personas(hierarchy)
            return {
                "status": "validated",
                "score": report["score"],
                "total_contacts": report["total_contacts"],
                "tier_breakdown": report["tier_breakdown"],
                "contact_metrics": report["contact_metrics"],
                "warnings": report["warnings"],
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Personas validation failed: {str(e)}")

    @personas_router.post("/dump-hierarchy-db")
    def dump_hierarchy_to_db(req: HierarchyDumpRequest):
        """[Tab 4 - Batch Hierarchy Dump DB Button]: Commits full 4-tier hierarchy to PostgreSQL."""
        session = get_session()
        try:
            acct = session.query(Account).filter_by(id=req.account_id).first()
            if not acct:
                raise HTTPException(status_code=404, detail=f"Account ID {req.account_id} not found in DB.")

            repo = PersonaRepository(session)
            count = repo.upsert_all(acct, req.hierarchy)
            session.commit()
            return {
                "status": "success",
                "account_id": acct.id,
                "total_personas_saved": count,
                "message": f"Saved {count} personas for Account '{acct.key}'.",
            }
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"Hierarchy DB dump failed: {str(e)}")
        finally:
            session.close()

    @personas_router.get("")
    def get_personas_from_db(account_id: int = Query(...), tier: Optional[str] = Query(None)):
        """Retrieves stored personas for an account, with optional tier filter."""
        session = get_session()
        try:
            query = session.query(Persona).filter_by(account_id=account_id)
            if tier:
                query = query.filter_by(tier=tier)
            personas = query.order_by(Persona.id).all()
            return [
                {
                    "id": p.id,
                    "account_id": p.account_id,
                    "full_name": p.full_name,
                    "title": p.title,
                    "tier": p.tier,
                    "email": p.email,
                    "phone": p.phone,
                    "linkedin_url": p.linkedin_url,
                    "degree": p.degree,
                    "institution": p.institution,
                    "prior_company": p.prior_company,
                    "communication_style": p.communication_style,
                    "skills": p.skills,
                    "target_kpis": p.target_kpis,
                    "operational_pain_points": p.operational_pain_points,
                    "key_objections": p.key_objections,
                    "twitter_live_url": p.twitter_live_url,
                    "sec_insider_trades_url": p.sec_insider_trades_url,
                    "rss_url": p.rss_url,
                    "google_scholar_url": p.google_scholar_url,
                    "youtube_interviews_url": p.youtube_interviews_url,
                    "podcast_search_url": p.podcast_search_url,
                }
                for p in personas
            ]
        finally:
            session.close()

    # ══════════════════════════════════════════════════════
    # FULL COMPOSITE PIPELINE ENDPOINTS
    # ══════════════════════════════════════════════════════
    pipeline_router = APIRouter(prefix="/api/pipeline", tags=["0. Full Composite Pipeline"])

    @pipeline_router.post("/run")
    def trigger_full_pipeline(req: PipelineRunRequest):
        """Triggers complete live pipeline. Staged, NO DB write."""
        try:
            res = run_pipeline(company_name=req.company_name, target_url=req.target_url)
            return {
                "status": "staged",
                "company_name": req.company_name,
                "run_dirs": {k: str(v) for k, v in res["run_dirs"].items()},
                "validation_score": res["validation_report"]["audit_metadata"]["overall_quality_score"],
                "ready_for_db_dump": res["validation_report"]["audit_metadata"]["ready_for_db_dump"],
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Pipeline execution failed: {str(e)}")

    @pipeline_router.post("/validate")
    def validate_composite_run(req: PipelineDumpDbRequest):
        """Audits an entire staged run directory or file."""
        target_path = Path(req.run_dir or req.file or "")
        if not target_path.exists():
            raise HTTPException(status_code=404, detail=f"Path not found: {target_path}")

        if target_path.is_dir():
            files = (
                list(target_path.glob("enriched/*_enriched*.json"))
                or list(target_path.glob("*_enriched*.json"))
                or list(target_path.rglob("*_enriched*.json"))
            )
            if not files:
                raise HTTPException(status_code=400, detail=f"No enriched JSON in: {target_path}")
            target_path = files[0]

        try:
            with open(target_path, "r", encoding="utf-8") as f:
                doc = json.load(f)
            return DataQualityValidator.audit_run(doc)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Validation failed: {str(e)}")

    @pipeline_router.get("/runs")
    def list_pipeline_runs(limit: int = 50):
        """Lists recent execution runs from PostgreSQL pipeline_runs table."""
        session = get_session()
        try:
            repo = PipelineRunRepository(session)
            runs = repo.list_recent_runs(limit=limit)
            return [
                {
                    "id": r.id,
                    "run_id": r.run_id,
                    "company_name": r.company_name,
                    "status": r.status,
                    "quality_score": float(r.quality_score or 0.0),
                    "quality_grade": r.quality_grade,
                    "started_at": r.started_at.isoformat() if r.started_at else None,
                    "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                    "duration_seconds": float(r.duration_seconds or 0.0),
                    "total_credits_used": r.total_credits_used,
                    "entities_extracted": r.entities_extracted,
                }
                for r in runs
            ]
        finally:
            session.close()

    @pipeline_router.get("/runs/{run_id}")
    def get_pipeline_run_detail(run_id: str):
        """Retrieves full execution details, credit breakdown, and logs for a specific run."""
        session = get_session()
        try:
            repo = PipelineRunRepository(session)
            r = repo.get_by_run_id(run_id)
            if not r:
                raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found.")
            return {
                "id": r.id,
                "run_id": r.run_id,
                "company_name": r.company_name,
                "target_url": r.target_url,
                "status": r.status,
                "quality_score": float(r.quality_score or 0.0),
                "quality_grade": r.quality_grade,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "duration_seconds": float(r.duration_seconds or 0.0),
                "total_credits_used": r.total_credits_used,
                "credits_breakdown": r.credits_breakdown,
                "entities_extracted": r.entities_extracted,
                "execution_logs": r.execution_logs,
                "raw_storage_dir": r.raw_storage_dir,
                "enriched_storage_dir": r.enriched_storage_dir,
                "error_message": r.error_message,
            }
        finally:
            session.close()

    @pipeline_router.get("/credits/summary")
    def get_credits_summary():
        """Returns aggregate credit consumption metrics across all vendors."""
        session = get_session()
        try:
            repo = PipelineRunRepository(session)
            return repo.get_credits_summary()
        finally:
            session.close()

    # Include all sub-routers
    app.include_router(pipeline_router)
    app.include_router(account_router)
    app.include_router(lobs_router)
    app.include_router(personas_router)

    # ══════════════════════════════════════════════════════
    # SOLID REST API ENDPOINTS
    # ══════════════════════════════════════════════════════

    @app.get("/api/accounts/{account_id}", tags=["1. Accounts"])
    def get_account_by_id(account_id: int, user: User = Depends(auth.require_account_access)):
        """Retrieve a specific enterprise account with its complete profile."""
        return get_account_from_db(account_id, user)

    @app.get("/api/accounts/{account_id}/lobs", tags=["2. Lines of Business"])
    def get_account_lines_of_business(account_id: int, user: User = Depends(auth.require_account_access)):
        """Retrieve all Lines of Business (LOBs) and nested sub-divisions for an account."""
        session = get_session()
        try:
            lobs = session.query(Lob).filter_by(account_id=account_id).all()
            result = []
            for lob_item in lobs:
                sublobs = session.query(SubLob).filter_by(lob_id=lob_item.id).all()
                result.append(
                    {
                        "id": lob_item.id,
                        "account_id": lob_item.account_id,
                        "name": lob_item.lob_name,
                        "lob_name": lob_item.lob_name,
                        "key": lob_item.key,
                        "domain": lob_item.domain,
                        "website_url": lob_item.website_url,
                        "desc": lob_item.overview,
                        "overview": lob_item.overview,
                        "revenue": lob_item.audited_segment_revenue,
                        "audited_segment_revenue": lob_item.audited_segment_revenue,
                        "head": lob_item.operating_head,
                        "operating_head": lob_item.operating_head,
                        "headcount": lob_item.segment_headcount,
                        "segment_headcount": lob_item.segment_headcount,
                        "lei_code": lob_item.lei_code,
                        "jurisdiction": lob_item.jurisdiction,
                        "technologies": lob_item.technologies or [],
                        "competitors": lob_item.competitors or [],
                        "financial_snippets": lob_item.financial_snippets or [],
                        "patents": lob_item.patents or [],
                        "logo_url": lob_item.logo_url,
                        "google_news_rss_url": lob_item.google_news_rss_url,
                        "reddit_rss_url": lob_item.reddit_rss_url,
                        "google_patents_url": lob_item.google_patents_url,
                        "google_trends_url": lob_item.google_trends_url,
                        "youtube_search_url": lob_item.youtube_search_url,
                        "sub_lobs": [{"id": s.id, "name": s.name, "metadata": s.metadata_} for s in sublobs],
                        "subLobs": [{"id": s.id, "name": s.name, "metadata": s.metadata_} for s in sublobs],
                    }
                )
            return {"account_id": account_id, "total_lobs": len(result), "lobs": result}
        finally:
            session.close()

    @app.get("/api/lobs/{lob_id}", tags=["2. Lines of Business"])
    def get_single_line_of_business(lob_id: int):
        """Retrieve details for a single Line of Business by its ID."""
        session = get_session()
        try:
            lob_item = session.query(Lob).filter_by(id=lob_id).first()
            if not lob_item:
                raise HTTPException(status_code=404, detail="Line of Business not found.")
            sublobs = session.query(SubLob).filter_by(lob_id=lob_item.id).all()
            return {
                "id": lob_item.id,
                "account_id": lob_item.account_id,
                "name": lob_item.lob_name,
                "lob_name": lob_item.lob_name,
                "key": lob_item.key,
                "domain": lob_item.domain,
                "website_url": lob_item.website_url,
                "overview": lob_item.overview,
                "audited_segment_revenue": lob_item.audited_segment_revenue,
                "operating_head": lob_item.operating_head,
                "segment_headcount": lob_item.segment_headcount,
                "lei_code": lob_item.lei_code,
                "jurisdiction": lob_item.jurisdiction,
                "technologies": lob_item.technologies or [],
                "competitors": lob_item.competitors or [],
                "financial_snippets": lob_item.financial_snippets or [],
                "patents": lob_item.patents or [],
                "google_news_rss_url": lob_item.google_news_rss_url,
                "reddit_rss_url": lob_item.reddit_rss_url,
                "google_patents_url": lob_item.google_patents_url,
                "google_trends_url": lob_item.google_trends_url,
                "youtube_search_url": lob_item.youtube_search_url,
                "sub_lobs": [{"id": s.id, "name": s.name, "metadata": s.metadata_} for s in sublobs],
                "subLobs": [{"id": s.id, "name": s.name, "metadata": s.metadata_} for s in sublobs],
            }
        finally:
            session.close()

    @app.get("/api/accounts/{account_id}/personas", tags=["3. Personas & Buying Committee"])
    def get_account_buying_committee(account_id: int, user: User = Depends(auth.require_account_access)):
        """Retrieve all executive personas and decision makers mapped to an account."""
        session = get_session()
        try:
            personas = session.query(Persona).filter_by(account_id=account_id).all()
            result = []
            for p in personas:
                result.append(
                    {
                        "id": p.id,
                        "account_id": p.account_id,
                        "lob_id": p.lob_id,
                        "key": p.key,
                        "name": p.full_name or p.display_name or "Executive",
                        "full_name": p.full_name or p.display_name or "Executive",
                        "first_name": p.first_name,
                        "last_name": p.last_name,
                        "title": p.title,
                        "job_title": p.title,
                        "tier": p.tier,
                        "seniority_tier": p.tier,
                        "seniority_raw": p.seniority_raw,
                        "email": p.email,
                        "phone": p.phone,
                        "city": p.city,
                        "state": p.state,
                        "country": p.country,
                        "decision_authority": p.decision_authority,
                        "budget_authority": p.budget_authority,
                        "departments": p.departments or ["Executive"],
                        "linkedin_url": p.linkedin_url,
                        "twitter_url": p.twitter_live_url
                        or (f"https://twitter.com/{p.twitter_handle}" if p.twitter_handle else None),
                        "skills": p.skills or [],
                        "target_kpis": p.target_kpis or [],
                        "operational_pain_points": p.operational_pain_points or [],
                        "key_objections": p.key_objections or [],
                        "degree": p.degree,
                        "institution": p.institution,
                        "prior_company": p.prior_company,
                        "communication_style": p.communication_style,
                        "engagement_rate": p.engagement_rate,
                        "value_proposition": p.value_proposition,
                        "personalized_icebreaker": p.personalized_icebreaker,
                        "social_platform": p.social_platform,
                        "social_profile_url": p.social_profile_url,
                        "social_presence_level": p.social_presence_level,
                        "raw_data": p.raw_data,
                    }
                )
            return {"account_id": account_id, "total_personas": len(result), "personas": result}
        finally:
            session.close()

    @app.get("/api/personas/{persona_id}", tags=["3. Personas & Buying Committee"])
    def get_single_persona_profile(persona_id: int, user: User = Depends(auth.require_persona_account_access)):
        """Retrieve full details and 58-column AI dossier for a specific executive persona."""
        session = get_session()
        try:
            p = session.query(Persona).filter_by(id=persona_id).first()
            if not p:
                raise HTTPException(status_code=404, detail="Persona not found.")
            return {
                "id": p.id,
                "account_id": p.account_id,
                "lob_id": p.lob_id,
                "name": p.full_name or p.display_name or "Executive",
                "title": p.title,
                "tier": p.tier,
                "email": p.email,
                "phone": p.phone,
                "location": f"{p.city or ''}, {p.country or ''}".strip(", "),
                "decision_authority": p.decision_authority,
                "budget_authority": p.budget_authority,
                "linkedin_url": p.linkedin_url,
                "degree": p.degree,
                "institution": p.institution,
                "prior_company": p.prior_company,
                "communication_style": p.communication_style,
                "personalized_icebreaker": p.personalized_icebreaker,
                "value_proposition": p.value_proposition,
                "operational_pain_points": p.operational_pain_points or [],
                "target_kpis": p.target_kpis or [],
                "raw_data": p.raw_data,
            }
        finally:
            session.close()

    @app.get("/api/personas/{persona_id}/profile.pdf", tags=["3. Personas & Buying Committee"])
    def download_persona_profile_pdf(persona_id: int, user: User = Depends(auth.require_persona_account_access)):
        """Server-side "Download PDF" for a contact's full profile (contact
        info, career history, AI call-prep dossier, Personality Profile, and
        every captured post) — generated fresh from the database each time
        with ReportLab, not a client-side screenshot of whatever happens to
        be on screen."""
        session = get_session()
        try:
            p = session.query(Persona).filter_by(id=persona_id).first()
            if not p:
                raise HTTPException(status_code=404, detail="Persona not found.")
            acct = session.query(Account).filter_by(id=p.account_id).first()
            target_key = p.key or slugify(p.full_name or "")

            digest_row = (
                session.query(Digest).filter_by(target_key=target_key).first() if target_key else None
            )
            posts = (
                (session.query(Post).filter_by(target_key=target_key).order_by(Post.channel, Post.rank).all())
                if target_key
                else []
            )
            movements = (
                (
                    session.query(CxoMovement)
                    .filter(CxoMovement.person_name.ilike(f"%{p.full_name}%"))
                    .order_by(CxoMovement.effective_date.desc().nullslast())
                    .all()
                )
                if p.full_name
                else []
            )

            persona_dict = {
                "name": p.full_name or p.display_name or "Executive",
                "title": p.title,
                "email": p.email,
                "phone": p.phone,
                "linkedin_url": p.linkedin_url,
                "city": p.city,
                "state": p.state,
                "country": p.country,
                "decision_authority": p.decision_authority,
                "budget_authority": p.budget_authority,
                "seniority_raw": p.seniority_raw,
                "skills": p.skills or [],
                "personalized_icebreaker": p.personalized_icebreaker,
                "value_proposition": p.value_proposition,
                "communication_style": p.communication_style,
                "target_kpis": p.target_kpis or [],
                "operational_pain_points": p.operational_pain_points or [],
                "key_objections": p.key_objections or [],
            }
            account_dict = {"name": acct.display_name or acct.legal_name} if acct else None
            posts_list = [
                {
                    "channel": post.channel,
                    "published_at": post.published_at,
                    "body": post.body,
                    "post_url": post.post_url,
                }
                for post in posts
            ]
            career_events = [
                {
                    "event_type": m.event_type,
                    "designation": m.designation,
                    "previous_role": m.previous_role,
                    "effective_date": m.effective_date,
                    "context": m.context,
                }
                for m in movements
            ]

            pdf_bytes = build_persona_profile_pdf(
                persona_dict,
                account_dict,
                digest_row.digest if digest_row else None,
                posts_list,
                career_events,
            )
            filename = f"{slugify(persona_dict['name'])}-personality-report.pdf"
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        finally:
            session.close()

    def _slugify_dropping_initials(name: str) -> str:
        """Same idea as frontend/js/modules/utils.js's slugifyDroppingInitials
        — a person registered in people_targets.py under a short key (e.g.
        "ranjit_samra") won't match a slug of their full display name if it
        includes a middle initial ("Ranjit S. Samra" -> "ranjit_s_samra")."""
        if not name:
            return ""
        tokens = [t for t in name.strip().split() if len(re.sub(r"[^a-zA-Z0-9]", "", t)) > 1]
        return slugify(" ".join(tokens))

    def _resolve_persona_digest(session, p: "Persona"):
        """Tries p.key, then slugify(full_name), then that slug with middle
        initials dropped, against real Digest rows — mirrors
        resolvePersonaTargetKey() on the frontend so the API and UI agree on
        which digest belongs to this persona. Returns the Digest row or None."""
        candidates = [p.key, slugify(p.full_name or ""), _slugify_dropping_initials(p.full_name or "")]
        for c in candidates:
            if not c:
                continue
            row = session.query(Digest).filter_by(target_key=c).first()
            if row:
                return row
        return None

    @app.get("/api/personas/{persona_id}/psychological-profile", tags=["3. Personas & Buying Committee"])
    def get_persona_psychological_profile(persona_id: int, user: User = Depends(auth.require_persona_account_access)):
        """Retrieve the compiled Psychological & Leadership Profile for a persona.

        Returns profile=None (not a fabricated placeholder) when nothing has
        been generated yet — the frontend shows an honest "not generated"
        state for that rather than plausible-looking canned text, same
        principle as the Personality Profile endpoint/renderer."""
        session = get_session()
        try:
            p = session.query(Persona).filter_by(id=persona_id).first()
            if not p:
                raise HTTPException(status_code=404, detail="Persona not found.")
            digest_row = _resolve_persona_digest(session, p)

            profile = None
            if digest_row and digest_row.digest and isinstance(digest_row.digest, dict):
                profile = digest_row.digest.get("psychological_profile")
            if not profile and p.raw_data and isinstance(p.raw_data, dict):
                profile = p.raw_data.get("psychological_profile")

            return {
                "persona_id": p.id,
                "persona_name": p.full_name,
                "title": p.title,
                "profile": profile,
            }
        finally:
            session.close()

    @app.post("/api/personas/{persona_id}/psychological-profile/generate", tags=["3. Personas & Buying Committee"])
    def generate_persona_psychological_profile(persona_id: int, user: User = Depends(auth.require_persona_account_access)):
        """Trigger on-demand live generation of the psychological profile using LLM synthesis."""
        session = get_session()
        try:
            p = session.query(Persona).filter_by(id=persona_id).first()
            if not p:
                raise HTTPException(status_code=404, detail="Persona not found.")

            from apps.content_pipeline.people_targets import ALIASES as PEOPLE_ALIASES

            existing = _resolve_persona_digest(session, p)
            candidates = [existing.target_key] if existing else []
            candidates += [p.key, slugify(p.full_name or ""), _slugify_dropping_initials(p.full_name or "")]
            target_key = next((c for c in candidates if c and c in PEOPLE_ALIASES), None)
            if not target_key:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{p.full_name}' isn't registered in people_targets.py under any key this resolves "
                    f"({', '.join(c for c in candidates if c)}) — add them there before generating a profile.",
                )

            # profiles_only=True: this is a UI-triggered on-demand generation for
            # exactly one profile, not a full scheduled digest run — no reason to
            # also pay for the sales-email rollup call nobody asked for here.
            from apps.content_pipeline.digest import pipeline as digest_pipeline
            digest_res = digest_pipeline.run(company_key=target_key, kind="person", cap=25, profiles_only=True)
            psych = digest_res.get("psychological_profile")
            if not psych:
                raise HTTPException(status_code=500, detail="Synthesis did not produce a psychological profile.")

            return {
                "status": "success",
                "persona_id": p.id,
                "profile": psych
            }
        finally:
            session.close()

    @app.get("/api/personas/{persona_id}/psychological-profile.pdf", tags=["3. Personas & Buying Committee"])
    def download_persona_psychological_profile_pdf(persona_id: int, user: User = Depends(auth.require_persona_account_access)):
        """Download high-impact executive PDF briefing for the Psychological Profile."""
        session = get_session()
        try:
            p = session.query(Persona).filter_by(id=persona_id).first()
            if not p:
                raise HTTPException(status_code=404, detail="Persona not found.")
            acct = session.query(Account).filter_by(id=p.account_id).first()
            target_key = p.key or slugify(p.full_name or "")
            digest_row = session.query(Digest).filter_by(target_key=target_key).first() if target_key else None

            persona_dict = {
                "full_name": p.full_name, "title": p.title,
                "account_name": acct.display_name or acct.legal_name if acct else "",
                "city": p.city, "state": p.state, "country": p.country,
                "communication_style": p.communication_style
            }

            pdf_bytes = build_psychological_profile_pdf(
                persona_dict,
                digest_row.digest if digest_row else None
            )
            filename = f"{slugify(p.full_name or 'executive')}-psychological-profile.pdf"
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        finally:
            session.close()

    @app.get("/api/accounts/{account_id}/signals", tags=["1. Accounts"])
    def get_account_intelligence_signals(account_id: int, user: User = Depends(auth.require_account_access)):
        """Retrieve multi-source intelligence, firmographics, heat scores, and traffic telemetry."""
        session = get_session()
        try:
            acct = session.query(Account).filter_by(id=account_id).first()
            if not acct:
                raise HTTPException(status_code=404, detail="Account not found.")
            return {
                "account_id": acct.id,
                "account_name": acct.legal_name or acct.display_name,
                "heat_score": acct.heat_score,
                "trend_score_90d": acct.trend_score_90d,
                "active_tech_count": acct.active_tech_count,
                "it_spend": acct.it_spend,
                "patents_granted": acct.patents_granted,
                "trademarks_registered": acct.trademarks_registered,
                "funding": {
                    "total_usd": acct.total_funding_amount_usd,
                    "currency": acct.total_funding_currency,
                    "last_type": acct.last_funding_type,
                    "last_date": acct.last_funding_date.isoformat() if acct.last_funding_date else None,
                    "num_rounds": acct.num_funding_rounds,
                    "status": acct.funding_status,
                },
                "ipo": {
                    "status": acct.ipo_status,
                    "date": acct.ipo_date.isoformat() if acct.ipo_date else None,
                },
                "traffic": {
                    "global_rank": acct.global_traffic_rank,
                    "monthly_visits": acct.monthly_visits,
                    "bounce_rate": acct.bounce_rate,
                    "visit_duration": acct.visit_duration,
                    "page_views_per_visit": acct.page_views_per_visit,
                },
                "leadership_counts": {
                    "c_suite": acct.c_suite_count,
                    "vp": acct.vp_count,
                    "director": acct.director_count,
                    "manager": acct.manager_count,
                },
                "multi_source_intelligence": acct.multi_source_intelligence,
            }
        finally:
            session.close()

    def _serialize_opportunity_signal(sig: OpportunitySignal, now: datetime) -> Dict[str, Any]:
        return {
            "id": sig.id,
            "category": sig.category,
            "signal_key": sig.signal_key,
            "title": sig.title,
            "details": sig.details or {},
            "status": sig.status,
            "first_seen": sig.first_seen.isoformat() if sig.first_seen else None,
            "last_seen": sig.last_seen.isoformat() if sig.last_seen else None,
            "is_new": bool(sig.first_seen and (now - sig.first_seen).days < 3),
        }

    @app.get("/api/accounts/{account_id}/opportunities", tags=["1. Accounts"])
    def get_account_opportunity_signals(account_id: int, user: User = Depends(auth.require_account_access)):
        """Retrieve the persisted history of growth-whitespace themes and domain-expansion
        product ideas detected for an account, including ones no longer actively recurring."""
        session = get_session()
        try:
            now = datetime.now(timezone.utc)
            signals = (
                session.query(OpportunitySignal)
                .filter_by(account_id=account_id)
                .order_by(OpportunitySignal.first_seen.desc())
                .all()
            )
            by_category: Dict[str, List[Dict[str, Any]]] = {"growth_theme": [], "domain_expansion": []}
            for s in signals:
                by_category.setdefault(s.category, []).append(_serialize_opportunity_signal(s, now))
            return {"account_id": account_id, **by_category}
        finally:
            session.close()

    @app.post("/api/accounts/{account_id}/opportunities/sync", tags=["1. Accounts"])
    def sync_account_opportunity_signals(
        account_id: int,
        req: OpportunitySignalSyncRequest,
        user: User = Depends(auth.require_account_access),
    ):
        """Upsert the currently-detected opportunity signals for one category (growth_theme or
        domain_expansion). Signals no longer present in `items` are marked inactive rather than
        deleted, so the account keeps a full history of what has been suggested over time."""
        if req.category not in ("growth_theme", "domain_expansion"):
            raise HTTPException(
                status_code=400, detail="category must be 'growth_theme' or 'domain_expansion'."
            )
        session = get_session()
        try:
            now = datetime.now(timezone.utc)
            existing = (
                session.query(OpportunitySignal).filter_by(account_id=account_id, category=req.category).all()
            )
            existing_by_key = {s.signal_key: s for s in existing}
            seen_keys = set()
            for item in req.items:
                seen_keys.add(item.signal_key)
                sig = existing_by_key.get(item.signal_key)
                if sig:
                    sig.title = item.title
                    sig.details = item.details
                    sig.status = "active"
                    sig.last_seen = now
                else:
                    sig = OpportunitySignal(
                        account_id=account_id,
                        category=req.category,
                        signal_key=item.signal_key,
                        title=item.title,
                        details=item.details,
                        status="active",
                        first_seen=now,
                        last_seen=now,
                    )
                    session.add(sig)
                    existing_by_key[item.signal_key] = sig
            for key, sig in existing_by_key.items():
                if key not in seen_keys and sig.status != "inactive":
                    sig.status = "inactive"
            session.commit()
            signals = (
                session.query(OpportunitySignal)
                .filter_by(account_id=account_id, category=req.category)
                .order_by(OpportunitySignal.first_seen.desc())
                .all()
            )
            return {
                "account_id": account_id,
                "category": req.category,
                "signals": [_serialize_opportunity_signal(s, now) for s in signals],
            }
        except HTTPException:
            raise
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"Opportunity signal sync failed: {str(e)}")
        finally:
            session.close()

    def _serialize_weekly_digest(snap: WeeklyDigestSnapshot) -> Dict[str, Any]:
        return {
            "id": snap.id,
            "target_key": snap.target_key,
            "week_of": snap.week_of.isoformat() if snap.week_of else None,
            "generated_at": snap.generated_at.isoformat() if snap.generated_at else None,
            "subject": snap.subject,
            "body": snap.body,
            "priority": snap.priority,
            "confidence": snap.confidence,
            "data_gaps": snap.data_gaps or [],
            "do_not_say": snap.do_not_say or [],
        }

    @app.get("/api/accounts/{account_id}/weekly-updates", tags=["1. Accounts"])
    def get_account_weekly_updates(account_id: int, user: User = Depends(auth.require_account_access)):
        """Retrieve the archived history of weekly sales update emails for an account, newest first."""
        session = get_session()
        try:
            snapshots = (
                session.query(WeeklyDigestSnapshot)
                .filter_by(account_id=account_id)
                .order_by(WeeklyDigestSnapshot.generated_at.desc())
                .all()
            )
            return {"account_id": account_id, "updates": [_serialize_weekly_digest(s) for s in snapshots]}
        finally:
            session.close()

    @app.post("/api/accounts/{account_id}/weekly-updates/sync", tags=["1. Accounts"])
    def sync_account_weekly_update(
        account_id: int,
        req: WeeklyDigestSyncRequest,
        user: User = Depends(auth.require_account_access),
    ):
        """Archive the current weekly sales update email as a snapshot, if this generation hasn't
        been captured yet. The live `digests` row is overwritten every pipeline run, so this is what
        preserves past weeks' versions instead of losing them."""
        if not req.generated_at:
            raise HTTPException(
                status_code=400, detail="generated_at is required to archive a weekly update snapshot."
            )
        try:
            generated_at = datetime.fromisoformat(req.generated_at)
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"generated_at is not a valid ISO datetime: {req.generated_at}"
            )
        week_of = generated_at.date() - timedelta(days=generated_at.weekday())
        session = get_session()
        try:
            existing = (
                session.query(WeeklyDigestSnapshot)
                .filter_by(account_id=account_id, generated_at=generated_at)
                .first()
            )
            if not existing:
                session.add(
                    WeeklyDigestSnapshot(
                        account_id=account_id,
                        target_key=req.target_key,
                        week_of=week_of,
                        generated_at=generated_at,
                        subject=req.subject,
                        body=req.body,
                        priority=req.priority,
                        confidence=req.confidence,
                        data_gaps=req.data_gaps,
                        do_not_say=req.do_not_say,
                    )
                )
                session.commit()
            snapshots = (
                session.query(WeeklyDigestSnapshot)
                .filter_by(account_id=account_id)
                .order_by(WeeklyDigestSnapshot.generated_at.desc())
                .all()
            )
            return {"account_id": account_id, "updates": [_serialize_weekly_digest(s) for s in snapshots]}
        except HTTPException:
            raise
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"Weekly update sync failed: {str(e)}")
        finally:
            session.close()

    # ══════════════════════════════════════════════════════
    # ACTION ITEMS — client-specific work-list (see
    # ACTION_ITEMS_IMPLEMENTATION_PLAN.md)
    # ══════════════════════════════════════════════════════
    def _serialize_action_item(item: ActionItem) -> Dict[str, Any]:
        now = datetime.now(timezone.utc)
        due = item.due_date
        is_overdue = bool(
            due and item.status not in ("done", "cancelled")
            and (due if due.tzinfo else due.replace(tzinfo=timezone.utc)) < now
        )
        return {
            "id": item.id,
            "account_id": item.account_id,
            "persona_id": item.persona_id,
            "persona_name": item.persona.full_name if item.persona else None,
            "title": item.title,
            "description": item.description,
            "status": item.status,
            "priority": item.priority,
            "due_date": item.due_date.isoformat() if item.due_date else None,
            "is_overdue": is_overdue,
            "assigned_to_id": item.assigned_to_id,
            "assigned_to_name": (item.assigned_to.full_name or item.assigned_to.email) if item.assigned_to else None,
            "created_by_id": item.created_by_id,
            "created_by_name": (item.created_by.full_name or item.created_by.email) if item.created_by else None,
            "source": item.source,
            "source_ref_id": item.source_ref_id,
            "completed_at": item.completed_at.isoformat() if item.completed_at else None,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        }

    def _parse_due_date(raw: Optional[str]) -> Optional[datetime]:
        if not raw:
            return None
        try:
            dt = datetime.fromisoformat(raw)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"due_date is not a valid ISO datetime: {raw}")
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    @app.get("/api/accounts/{account_id}/action-items", tags=["8. Action Items"])
    def list_account_action_items(
        account_id: int,
        status: Optional[str] = None,
        assigned_to_id: Optional[int] = None,
        persona_id: Optional[int] = None,
        user: User = Depends(auth.require_account_access),
    ):
        """List this account's work-list items, optionally filtered by
        status, assignee, or a specific contact."""
        session = get_session()
        try:
            query = (session.query(ActionItem)
                     .options(selectinload(ActionItem.persona), selectinload(ActionItem.assigned_to),
                              selectinload(ActionItem.created_by))
                     .filter_by(account_id=account_id))
            if status:
                query = query.filter(ActionItem.status == status)
            if assigned_to_id:
                query = query.filter(ActionItem.assigned_to_id == assigned_to_id)
            if persona_id:
                query = query.filter(ActionItem.persona_id == persona_id)
            items = query.order_by(ActionItem.due_date.asc().nullslast(), ActionItem.created_at.desc()).all()
            return {"account_id": account_id, "action_items": [_serialize_action_item(i) for i in items]}
        finally:
            session.close()

    @app.post("/api/accounts/{account_id}/action-items", tags=["8. Action Items"])
    def create_account_action_item(
        account_id: int, body: ActionItemCreateRequest,
        user: User = Depends(auth.require_account_access),
    ):
        if body.priority not in ("high", "medium", "low"):
            raise HTTPException(status_code=400, detail="priority must be 'high', 'medium', or 'low'")
        session = get_session()
        try:
            if body.persona_id is not None:
                persona = session.query(Persona).filter_by(id=body.persona_id, account_id=account_id).first()
                if not persona:
                    raise HTTPException(status_code=400, detail="persona_id does not belong to this account")
            item = ActionItem(
                account_id=account_id, persona_id=body.persona_id, title=body.title,
                description=body.description, priority=body.priority,
                due_date=_parse_due_date(body.due_date), assigned_to_id=body.assigned_to_id,
                created_by_id=user.id, source="manual",
            )
            session.add(item)
            session.commit()
            session.refresh(item)
            item = (session.query(ActionItem)
                    .options(selectinload(ActionItem.persona), selectinload(ActionItem.assigned_to),
                             selectinload(ActionItem.created_by))
                    .filter_by(id=item.id).first())
            return _serialize_action_item(item)
        except HTTPException:
            raise
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"Could not create action item: {e}")
        finally:
            session.close()

    @app.patch("/api/action-items/{item_id}", tags=["8. Action Items"])
    def update_action_item(
        item_id: int, body: ActionItemUpdateRequest, background_tasks: BackgroundTasks,
        user: User = Depends(auth.require_action_item_account_access),
    ):
        session = get_session()
        try:
            item = (session.query(ActionItem)
                    .options(selectinload(ActionItem.persona), selectinload(ActionItem.assigned_to),
                             selectinload(ActionItem.created_by))
                    .filter_by(id=item_id).first())
            if not item:
                raise HTTPException(status_code=404, detail="Action item not found")

            if body.status is not None:
                # 'pending_review' is deliberately excluded here — it's only
                # ever set by the LLM-suggestion write path, and only ever
                # left via the dedicated /approve or /reject endpoints below,
                # never a generic field edit. See
                # ACTION_ITEMS_LLM_SUGGESTIONS_PLAN.md §1.
                if body.status not in ("open", "in_progress", "done", "cancelled"):
                    raise HTTPException(status_code=400, detail="status must be open, in_progress, done, or cancelled")
                item.status = body.status
                item.completed_at = datetime.now(timezone.utc) if body.status == "done" else None
            if body.priority is not None:
                if body.priority not in ("high", "medium", "low"):
                    raise HTTPException(status_code=400, detail="priority must be 'high', 'medium', or 'low'")
                item.priority = body.priority
            if body.title is not None:
                item.title = body.title
            if body.description is not None:
                item.description = body.description
            if body.due_date is not None:
                item.due_date = _parse_due_date(body.due_date)
            if body.persona_id is not None:
                persona = (
                    session.query(Persona)
                    .filter_by(id=body.persona_id, account_id=item.account_id)
                    .first()
                )
                if not persona:
                    raise HTTPException(status_code=400, detail="persona_id does not belong to this account")
                item.persona_id = body.persona_id

            reassigned = body.assigned_to_id is not None and body.assigned_to_id != item.assigned_to_id
            if body.assigned_to_id is not None:
                item.assigned_to_id = body.assigned_to_id

            session.commit()
            session.refresh(item)

            if reassigned and item.assigned_to and item.assigned_to.email:
                base_url = os.getenv("APP_BASE_URL", "http://localhost:8000")
                due_line = f" Due {item.due_date.date().isoformat()}." if item.due_date else ""
                background_tasks.add_task(
                    email_sender.send_email,
                    item.assigned_to.email,
                    f"Action item assigned to you: {item.title}",
                    (
                        f"Hi {item.assigned_to.full_name or item.assigned_to.email},\n\n"
                        f"You've been assigned an action item on "
                        f"{item.account.display_name or item.account.legal_name}.\n\n"
                        f"{item.title}\n{item.description or ''}\n{due_line}\n\n"
                        f"View it here: {base_url}/?account={item.account_id}\n"
                    ),
                    html_body=email_sender.render_html(
                        "New action item assigned to you",
                        [
                            f"Hi {item.assigned_to.full_name or item.assigned_to.email},",
                            f"You've been assigned an action item on "
                            f"{item.account.display_name or item.account.legal_name}:",
                            item.title,
                        ] + ([item.description] if item.description else []),
                        cta_label="View Account",
                        cta_url=f"{base_url}/?account={item.account_id}",
                        footnote=due_line.strip() or None,
                    ),
                )
                s2 = get_session()
                try:
                    s2.add(
                        ActionItemReminder(
                            action_item_id=item.id,
                            reminder_type="assigned",
                            sent_to_user_id=item.assigned_to_id,
                        )
                    )
                    s2.commit()
                except Exception:
                    s2.rollback()
                finally:
                    s2.close()

            return _serialize_action_item(item)
        except HTTPException:
            raise
        except Exception as e:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"Could not update action item: {e}")
        finally:
            session.close()

    @app.post("/api/action-items/{item_id}/approve", tags=["8. Action Items"])
    def approve_action_item(item_id: int, user: User = Depends(auth.require_action_item_account_access)):
        """Turns an LLM-suggested item (status='pending_review') into a real
        task, assigned to whoever approved it. See
        ACTION_ITEMS_LLM_SUGGESTIONS_PLAN.md §1 — approval is a dedicated
        endpoint, not a generic status PATCH, so it's always one deliberate
        action rather than a side effect of an unrelated field edit."""
        session = get_session()
        try:
            item = (session.query(ActionItem)
                    .options(selectinload(ActionItem.persona), selectinload(ActionItem.assigned_to),
                             selectinload(ActionItem.created_by))
                    .filter_by(id=item_id).first())
            if not item:
                raise HTTPException(status_code=404, detail="Action item not found")
            if item.status != "pending_review":
                raise HTTPException(status_code=400, detail="Only a pending-review item can be approved")
            item.status = "open"
            item.assigned_to_id = user.id
            session.commit()
            session.refresh(item)
            return _serialize_action_item(item)
        finally:
            session.close()

    @app.post("/api/action-items/{item_id}/reject", tags=["8. Action Items"])
    def reject_action_item(item_id: int, user: User = Depends(auth.require_action_item_account_access)):
        """Dismisses an LLM-suggested item without ever making it a real
        task — sets status='cancelled' so it's excluded from every existing
        open/overdue query with no schema change, rather than deleting it
        outright (keeps a record of what the model suggested)."""
        session = get_session()
        try:
            item = (session.query(ActionItem)
                    .options(selectinload(ActionItem.persona), selectinload(ActionItem.assigned_to),
                             selectinload(ActionItem.created_by))
                    .filter_by(id=item_id).first())
            if not item:
                raise HTTPException(status_code=404, detail="Action item not found")
            if item.status != "pending_review":
                raise HTTPException(status_code=400, detail="Only a pending-review item can be rejected")
            item.status = "cancelled"
            session.commit()
            session.refresh(item)
            return _serialize_action_item(item)
        finally:
            session.close()

    @app.post("/api/action-items/{item_id}/complete", tags=["8. Action Items"])
    def complete_action_item(item_id: int, user: User = Depends(auth.require_action_item_account_access)):
        session = get_session()
        try:
            item = (session.query(ActionItem)
                    .options(selectinload(ActionItem.persona), selectinload(ActionItem.assigned_to),
                             selectinload(ActionItem.created_by))
                    .filter_by(id=item_id).first())
            if not item:
                raise HTTPException(status_code=404, detail="Action item not found")
            item.status = "done"
            item.completed_at = datetime.now(timezone.utc)
            session.commit()
            session.refresh(item)
            return _serialize_action_item(item)
        finally:
            session.close()

    @app.post("/api/action-items/{item_id}/send-reminder", tags=["8. Action Items"])
    def send_action_item_reminder(item_id: int, user: User = Depends(auth.require_action_item_account_access)):
        """On-demand reminder email for one action item — same email
        template and action_item_reminders log as the scheduled sweep
        (scripts/send_action_reminders.py), but sent immediately (e.g. from
        the Command Center 'Due soon' widget's Send reminder button)
        instead of waiting for that script's next scheduled run. Unlike the
        sweep, a deliberate manual click is allowed to re-send even if that
        reminder stage was already logged — updates the existing log row's
        sent_at instead of trying to insert a second one (which would hit
        the table's unique constraint)."""
        session = get_session()
        try:
            item = (session.query(ActionItem)
                    .options(selectinload(ActionItem.assigned_to), selectinload(ActionItem.account))
                    .filter_by(id=item_id).first())
            if not item:
                raise HTTPException(status_code=404, detail="Action item not found")
            if item.status in ("done", "cancelled"):
                raise HTTPException(status_code=400, detail="This task is already closed")
            if not item.assigned_to or not item.assigned_to.email:
                raise HTTPException(status_code=400, detail="This task has no assignee to notify")

            assignee = item.assigned_to
            now = datetime.now(timezone.utc)
            due = item.due_date
            due_utc = due.replace(tzinfo=timezone.utc) if due and not due.tzinfo else due
            is_overdue = bool(due_utc and due_utc < now)
            reminder_type = "overdue" if is_overdue else "due_soon"
            account_name = (item.account.display_name or item.account.legal_name) if item.account else "an account"
            due_str = due_utc.strftime("%b %d, %Y") if due_utc else "no date"
            heading = "Action item overdue" if is_overdue else "Action item due soon"
            lead_line = f"{'This action item is now overdue' if is_overdue else 'This action item is due soon'} on {account_name}:"

            sent = email_sender.send_email(
                assignee.email, f"{heading}: {item.title}",
                f"Hi {assignee.full_name or assignee.email},\n\n{lead_line}\n\n{item.title}\n{item.description or ''}\nDue: {due_str}\n",
                html_body=email_sender.render_html(
                    heading,
                    [f"Hi {assignee.full_name or assignee.email},", lead_line, item.title] + ([item.description] if item.description else []),
                    footnote=f"Due: {due_str}",
                ),
            )
            if not sent:
                raise HTTPException(status_code=502, detail="Could not send the reminder email — check SMTP configuration (.env SMTP_* vars).")

            existing = session.query(ActionItemReminder).filter_by(
                action_item_id=item.id, reminder_type=reminder_type, sent_to_user_id=item.assigned_to_id,
            ).first()
            if existing:
                existing.sent_at = now
            else:
                session.add(ActionItemReminder(action_item_id=item.id, reminder_type=reminder_type, sent_to_user_id=item.assigned_to_id))
            session.commit()
            return {"ok": True, "sent_to": assignee.email, "reminder_type": reminder_type}
        except HTTPException:
            raise
        finally:
            session.close()

    @app.delete("/api/action-items/{item_id}", tags=["8. Action Items"])
    def delete_action_item(item_id: int, user: User = Depends(auth.require_action_item_account_access)):
        session = get_session()
        try:
            item = session.query(ActionItem).filter_by(id=item_id).first()
            if not item:
                raise HTTPException(status_code=404, detail="Action item not found")
            session.delete(item)
            session.commit()
            return {"ok": True}
        finally:
            session.close()

    @app.get("/api/me/action-items", tags=["8. Action Items"])
    def list_my_action_items(status: Optional[str] = None, user: User = Depends(auth.get_current_user)):
        """Cross-account 'My Tasks' — every action item assigned to the
        caller, restricted to accounts they can actually see (super_admin
        gets everything; anyone else only what's been granted to them)."""
        session = get_session()
        try:
            query = (session.query(ActionItem)
                     .options(selectinload(ActionItem.persona), selectinload(ActionItem.assigned_to),
                              selectinload(ActionItem.created_by), selectinload(ActionItem.account))
                     .filter(ActionItem.assigned_to_id == user.id))
            if user.role != "super_admin":
                accessible_ids = auth.get_accessible_account_ids(session, user.id)
                if accessible_ids:
                    query = query.filter(ActionItem.account_id.in_(accessible_ids))
                else:
                    query = query.filter(False)
            if status:
                query = query.filter(ActionItem.status == status)
            items = query.order_by(ActionItem.due_date.asc().nullslast(), ActionItem.created_at.desc()).all()
            results = []
            for i in items:
                d = _serialize_action_item(i)
                d["account_name"] = i.account.display_name or i.account.legal_name if i.account else None
                results.append(d)
            return {"action_items": results}
        finally:
            session.close()

    @app.get("/api/content", tags=["4. Content Intelligence"])
    def get_content_intelligence():
        """Retrieve aggregated social listening posts and LLM channel digests."""
        session = get_session()
        try:
            digests_by_key = {}
            try:
                for d in session.query(Digest).all():
                    digests_by_key[d.target_key] = {
                        "target_key": d.target_key,
                        "kind": d.kind,
                        "priority": d.priority,
                        "llm": d.llm,
                        "posts_considered": d.posts_considered,
                        "generated_at": d.generated_at.isoformat() if d.generated_at else None,
                        "digest": d.digest,
                    }
            except Exception:
                digests_by_key = {}

            posts_by_key = {}
            try:
                for p in session.query(Post).order_by(Post.target_key, Post.channel, Post.rank).all():
                    posts_by_key.setdefault(p.target_key, []).append(
                        {
                            "id": p.id,
                            "channel": p.channel,
                            "post_key": p.post_key,
                            "rank": p.rank,
                            "post_url": p.post_url,
                            "body": p.body,
                            "author": p.author,
                            "published_at": p.published_at,
                            "engagement": p.engagement,
                            "media": p.media,
                            "new_in_last_run": p.new_in_last_run,
                            "first_seen": p.first_seen.isoformat() if p.first_seen else None,
                            "last_seen": p.last_seen.isoformat() if p.last_seen else None,
                        }
                    )
            except Exception:
                posts_by_key = {}

            jobs_by_key = {}
            try:
                jobs_query = session.query(LinkedInJob).order_by(
                    LinkedInJob.target_key, LinkedInJob.first_seen.desc().nullslast()
                )
                for j in jobs_query.all():
                    jobs_by_key.setdefault(j.target_key, []).append(
                        {
                            "id": j.id,
                            "target_key": j.target_key,
                            "job_key": j.job_key,
                            "title": j.title,
                            "company_name": j.company_name,
                            "location": j.location,
                            "employment_type": j.employment_type,
                            "workplace_type": j.workplace_type,
                            "posted_date": j.posted_date,
                            "applicants": j.applicants,
                            "views": j.views,
                            "salary": j.salary,
                            "job_url": j.job_url,
                            "description": j.description,
                            "new_in_last_run": j.new_in_last_run,
                            "first_seen": j.first_seen.isoformat() if j.first_seen else None,
                            "last_seen": j.last_seen.isoformat() if j.last_seen else None,
                        }
                    )
            except Exception:
                jobs_by_key = {}

            return {"digests": digests_by_key, "posts": posts_by_key, "jobs": jobs_by_key}
        finally:
            session.close()

    # ══════════════════════════════════════════════════════
    # LINKEDIN JOB POSTINGS — bulk cross-account endpoint
    # ══════════════════════════════════════════════════════
    JOB_CATEGORY_RULES = [
        (
            "Engineering & Technology",
            (
                r"software|engineer|developer|architect|devops|\bsre\b|platform|"
                r"infrastructure|\bcloud\b|\bit\b|technology|full[- ]stack|backend|front[- ]end"
            ),
        ),
        (
            "Data & AI",
            (
                r"data scientist|data engineer|machine learning|\bai\b|analytics|"
                r"data governance|data platform|business intelligence|\bml\b"
            ),
        ),
        ("Finance & Accounting", r"finance|accounting|audit|controller|treasury|financial reporting|\btax\b"),
        (
            "Sales & Business Development",
            r"\bsales\b|business development|account executive|relationship manager|client coverage",
        ),
        ("Marketing & Communications", r"marketing|communications|\bbrand\b|content\b|social media"),
        ("Product Management", r"product manager|product owner|product lead"),
        ("Human Resources", r"human resources|\bhr\b|talent acquisition|\brecruit|people operations"),
        ("Legal & Compliance", r"\blegal\b|compliance|regulatory|counsel|risk management"),
        ("Customer Success & Support", r"customer success|customer support|client service"),
        ("Operations", r"operations|operational|process improvement|program manager|project manager"),
        ("Executive & Leadership", r"\bvp\b|vice president|\bdirector\b|head of|\bchief\b|managing director"),
    ]

    def categorize_job_title(title: Optional[str]) -> str:
        if not title:
            return "Other"
        for label, pattern in JOB_CATEGORY_RULES:
            if re.search(pattern, title, re.IGNORECASE):
                return label
        return "Other"

    def _build_target_key_to_account_map(session) -> Dict[str, Account]:
        mapping: Dict[str, Account] = {}
        for a in session.query(Account).all():
            for candidate in (
                a.key,
                (a.stock_symbol or "").lower() or None,
                slugify(a.display_name) if a.display_name else None,
                slugify(a.legal_name) if a.legal_name else None,
            ):
                if candidate:
                    mapping[candidate] = a
        return mapping

    def _job_summary_dict(j: "LinkedInJob", acct: Optional[Account], job_category: str) -> Dict[str, Any]:
        return {
            "id": j.id,
            "target_key": j.target_key,
            "job_key": j.job_key,
            "title": j.title,
            "company_name": j.company_name,
            "location": j.location,
            "employment_type": j.employment_type,
            "workplace_type": j.workplace_type,
            "posted_date": j.posted_date,
            "applicants": j.applicants,
            "views": j.views,
            "salary": j.salary,
            "job_url": j.job_url,
            "has_description": bool(j.description),
            "new_in_last_run": j.new_in_last_run,
            "first_seen": j.first_seen.isoformat() if j.first_seen else None,
            "last_seen": j.last_seen.isoformat() if j.last_seen else None,
            "category": job_category,
            "account_id": acct.id if acct else None,
            "account_name": (acct.legal_name or acct.display_name) if acct else j.company_name,
        }

    @app.get("/api/linkedin-jobs", tags=["5. LinkedIn Jobs"])
    def get_all_linkedin_jobs(
        category: Optional[str] = None,
        account_id: Optional[int] = None,
        q: Optional[str] = None,
        employment_type: Optional[str] = None,
        workplace_type: Optional[str] = None,
        sort: str = "newest",
        page: int = 1,
        page_size: int = 24,
    ):
        """Retrieve scraped LinkedIn job postings across all accounts, each resolved to its
        owning account and tagged with a heuristic job category. Supports free-text search,
        category/employment/workplace filters, sorting, and server-side pagination so the
        Global Accounts Dashboard's 'View All' job browser stays fast as the dataset grows.
        The list payload omits the (potentially large) job description — fetch
        GET /api/linkedin-jobs/{id} for the full detail of a single posting."""
        session = get_session()
        try:
            page = max(1, page)
            page_size = max(1, min(page_size, 100))
            q_norm = (q or "").strip().lower()

            key_to_account = _build_target_key_to_account_map(session)
            jobs_query = session.query(LinkedInJob).order_by(LinkedInJob.first_seen.desc().nullslast())

            employment_types_set, workplace_types_set = set(), set()
            # Matches every account/search/employment/workplace filter but NOT category,
            # so the UI can show an accurate job count per category chip.
            pre_category: List[Dict[str, Any]] = []

            for j in jobs_query.all():
                acct = key_to_account.get(j.target_key)
                if j.employment_type:
                    employment_types_set.add(j.employment_type)
                if j.workplace_type:
                    workplace_types_set.add(j.workplace_type)

                if account_id is not None and (not acct or acct.id != account_id):
                    continue
                if employment_type and j.employment_type != employment_type:
                    continue
                if workplace_type and j.workplace_type != workplace_type:
                    continue
                if q_norm:
                    haystack = " ".join(filter(None, [j.title, j.company_name, j.location])).lower()
                    if q_norm not in haystack:
                        continue

                job_category = categorize_job_title(j.title)
                pre_category.append(_job_summary_dict(j, acct, job_category))

            category_counts: Dict[str, int] = {}
            for row in pre_category:
                category_counts[row["category"]] = category_counts.get(row["category"], 0) + 1

            results = [r for r in pre_category if not category or r["category"] == category]

            sort_key = {
                "newest": lambda r: r["first_seen"] or "",
                "applicants": lambda r: r["applicants"] if r["applicants"] is not None else -1,
                "views": lambda r: r["views"] if r["views"] is not None else -1,
            }.get(sort, None)
            if sort_key:
                results.sort(key=sort_key, reverse=True)

            total = len(results)
            total_pages = max(1, math.ceil(total / page_size))
            page = min(page, total_pages)
            start = (page - 1) * page_size
            page_results = results[start : start + page_size]

            all_categories = [label for label, _ in JOB_CATEGORY_RULES] + ["Other"]
            return {
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
                "categories": all_categories,
                "category_counts": category_counts,
                "employment_types": sorted(employment_types_set),
                "workplace_types": sorted(workplace_types_set),
                "jobs": page_results,
            }
        finally:
            session.close()

    @app.get("/api/linkedin-jobs/{job_id}", tags=["5. LinkedIn Jobs"])
    def get_linkedin_job_detail(job_id: int):
        """Retrieve the full detail (including description) for a single LinkedIn job posting."""
        session = get_session()
        try:
            j = session.query(LinkedInJob).filter(LinkedInJob.id == job_id).first()
            if not j:
                raise HTTPException(status_code=404, detail="Job posting not found")
            acct = _build_target_key_to_account_map(session).get(j.target_key)
            job_category = categorize_job_title(j.title)
            detail = _job_summary_dict(j, acct, job_category)
            detail["description"] = j.description
            return detail
        finally:
            session.close()

    # ══════════════════════════════════════════════════════
    # CXO MOVEMENTS & TRANSITIONS ENDPOINTS
    # ══════════════════════════════════════════════════════
    def _serialize_cxo_movement(m: CxoMovement, acct: Optional[Account] = None) -> Dict[str, Any]:
        return {
            "id": m.id,
            "target_key": m.target_key,
            "company_name": m.company_name,
            "person_name": m.person_name,
            "designation": m.designation,
            "event_type": (m.event_type or "").lower().strip(),
            "effective_date": m.effective_date,
            "previous_role": m.previous_role,
            "new_company": m.new_company,
            "context": m.context,
            "source": m.source,
            "publisher_domain": m.publisher_domain,
            "article_title": m.article_title,
            "article_url": m.article_url,
            "extraction_status": m.extraction_status,
            "published_at": m.published_at,
            "first_seen": m.first_seen.isoformat() if m.first_seen else None,
            "last_seen": m.last_seen.isoformat() if m.last_seen else None,
            "new_in_last_run": m.new_in_last_run,
            "account_id": acct.id if acct else None,
            "account_name": (acct.legal_name or acct.display_name) if acct else m.company_name,
        }

    @app.get("/api/cxo-movements", tags=["6. CXO Movements"])
    def get_cxo_movements(
        response: Response,
        target_key: Optional[str] = None,
        event_type: Optional[str] = None,
        q: Optional[str] = None,
        limit: int = 100,
    ):
        """Retrieve executive transitions (joined, resigned, retired, promoted) across accounts."""
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        session = get_session()
        try:
            query = session.query(CxoMovement)
            if target_key:
                query = query.filter(CxoMovement.target_key == target_key)
            if event_type and event_type.lower() != "all":
                query = query.filter(CxoMovement.event_type.ilike(event_type))
            if q and q.strip():
                term = f"%{q.strip()}%"
                query = query.filter(
                    (CxoMovement.person_name.ilike(term))
                    | (CxoMovement.company_name.ilike(term))
                    | (CxoMovement.designation.ilike(term))
                    | (CxoMovement.context.ilike(term))
                    | (CxoMovement.previous_role.ilike(term))
                    | (CxoMovement.new_company.ilike(term))
                )

            all_records = query.order_by(CxoMovement.first_seen.desc().nullslast()).limit(limit).all()
            target_map = _build_target_key_to_account_map(session)

            counts = {"all": len(all_records), "joined": 0, "resigned": 0, "retired": 0, "promoted": 0}
            serialized = []
            for r in all_records:
                evt = (r.event_type or "").lower().strip()
                if evt in counts:
                    counts[evt] += 1
                acct = target_map.get(r.target_key)
                serialized.append(_serialize_cxo_movement(r, acct))

            return {"total": len(serialized), "counts": counts, "movements": serialized}
        finally:
            session.close()

    @app.get("/api/accounts/{account_id}/cxo-movements", tags=["6. CXO Movements"])
    def get_account_cxo_movements(account_id: int, user: User = Depends(auth.require_account_access)):
        """Retrieve executive transitions for a specific account."""
        session = get_session()
        try:
            acct = session.query(Account).filter_by(id=account_id).first()
            if not acct:
                raise HTTPException(status_code=404, detail="Account not found.")
            keys = [
                acct.key,
                (acct.stock_symbol or "").lower(),
                slugify(acct.display_name),
                slugify(acct.legal_name),
            ]
            keys = [k for k in keys if k]
            movements = (
                session.query(CxoMovement)
                .filter(CxoMovement.target_key.in_(keys))
                .order_by(CxoMovement.first_seen.desc().nullslast())
                .all()
            )
            return {
                "account_id": account_id,
                "account_name": acct.legal_name or acct.display_name,
                "total": len(movements),
                "movements": [_serialize_cxo_movement(m, acct) for m in movements],
            }
        finally:
            session.close()

    @app.get("/api/accounts/{account_id}/content", tags=["4. Content Intelligence"])
    def get_account_content_intelligence(account_id: int, user: User = Depends(auth.require_account_access)):
        """Retrieve social listening posts, LLM channel digests, and LinkedIn jobs
        scoped to one account — the on-demand counterpart to /api/content, fetched
        when that account's Social/Content/Jobs tab is opened rather than pulling
        every account's content up front."""
        session = get_session()
        try:
            acct = session.query(Account).filter_by(id=account_id).first()
            if not acct:
                raise HTTPException(status_code=404, detail="Account not found.")
            # Persona-level content (per-contact digests like the Personality
            # Profile, and their own captured posts) is stored under each
            # person's own target_key (e.g. "robin_vince"), not the account's
            # — without including those here, the contact drawer's Recent
            # Social Media Activity / Personality Profile sections always
            # found nothing, no matter how much persona-level data existed.
            persona_keys = [p.key or slugify(p.full_name) for p in (acct.personas or [])]
            keys = [
                acct.key,
                (acct.stock_symbol or "").lower(),
                slugify(acct.display_name),
                slugify(acct.legal_name),
                *persona_keys,
            ]
            keys = [k for k in keys if k]

            digests_by_key = {}
            try:
                for d in session.query(Digest).filter(Digest.target_key.in_(keys)).all():
                    digests_by_key[d.target_key] = {
                        "target_key": d.target_key,
                        "kind": d.kind,
                        "priority": d.priority,
                        "llm": d.llm,
                        "posts_considered": d.posts_considered,
                        "generated_at": d.generated_at.isoformat() if d.generated_at else None,
                        "digest": d.digest,
                    }
            except Exception:
                digests_by_key = {}

            posts_by_key = {}
            try:
                posts_query = (
                    session.query(Post)
                    .filter(Post.target_key.in_(keys))
                    .order_by(Post.target_key, Post.channel, Post.rank)
                )
                for p in posts_query.all():
                    posts_by_key.setdefault(p.target_key, []).append(
                        {
                            "id": p.id,
                            "channel": p.channel,
                            "post_key": p.post_key,
                            "rank": p.rank,
                            "post_url": p.post_url,
                            "body": p.body,
                            "author": p.author,
                            "published_at": p.published_at,
                            "engagement": p.engagement,
                            "media": p.media,
                            "new_in_last_run": p.new_in_last_run,
                            "first_seen": p.first_seen.isoformat() if p.first_seen else None,
                            "last_seen": p.last_seen.isoformat() if p.last_seen else None,
                        }
                    )
            except Exception:
                posts_by_key = {}

            jobs_by_key = {}
            try:
                jobs_query = (
                    session.query(LinkedInJob)
                    .filter(LinkedInJob.target_key.in_(keys))
                    .order_by(LinkedInJob.target_key, LinkedInJob.first_seen.desc().nullslast())
                )
                for j in jobs_query.all():
                    jobs_by_key.setdefault(j.target_key, []).append(
                        {
                            "id": j.id,
                            "target_key": j.target_key,
                            "job_key": j.job_key,
                            "title": j.title,
                            "company_name": j.company_name,
                            "location": j.location,
                            "employment_type": j.employment_type,
                            "workplace_type": j.workplace_type,
                            "posted_date": j.posted_date,
                            "applicants": j.applicants,
                            "views": j.views,
                            "salary": j.salary,
                            "job_url": j.job_url,
                            "description": j.description,
                            "new_in_last_run": j.new_in_last_run,
                            "first_seen": j.first_seen.isoformat() if j.first_seen else None,
                            "last_seen": j.last_seen.isoformat() if j.last_seen else None,
                        }
                    )
            except Exception:
                jobs_by_key = {}

            return {"digests": digests_by_key, "posts": posts_by_key, "jobs": jobs_by_key}
        finally:
            session.close()

    @app.get("/api/database/download", tags=["7. Database Operations"])
    @app.get("/api/database/download/sql", tags=["7. Database Operations"])
    def download_database_sql():
        """Download the complete PostgreSQL SQL database dump file."""
        sql_path = PIPELINE_ROOT / "sales_ai_database_export.sql"
        if not sql_path.exists():
            # Regenerate if missing
            try:
                run([sys.executable, str(PIPELINE_ROOT / "export_db.py")], check=True)
            except Exception:
                pass
        if not sql_path.exists():
            raise HTTPException(status_code=404, detail="Database export file not found.")
        return FileResponse(
            path=str(sql_path), filename="sales_ai_database_export.sql", media_type="application/sql"
        )

    @app.get("/api/database/download/json", tags=["7. Database Operations"])
    def download_database_json():
        """Download the complete database in JSON format."""
        json_path = PIPELINE_ROOT / "sales_ai_database_export.json"
        if not json_path.exists():
            raise HTTPException(status_code=404, detail="Database JSON export file not found.")
        return FileResponse(
            path=str(json_path), filename="sales_ai_database_export.json", media_type="application/json"
        )

    # ══════════════════════════════════════════════════════
    # FRONTEND UI: Jinja2-templated shell + static assets
    # ══════════════════════════════════════════════════════
    # The dashboard shell (frontend/templates/index.html) is composed from
    # partials (topbar/nav/drawer/modal) and rendered server-side; everything
    # it actually renders (accounts, digest sections, etc.) still comes from
    # the JSON APIs below via frontend/js/modules/. CSS/JS/the separate
    # Account Explorer app stay plain static files — only the shell itself
    # needed templating, so we mount those under their own sub-paths instead
    # of the old single mount at "/" (which would now collide with the
    # explicit "/" route below).
    frontend_dir = Path(__file__).resolve().parent / "frontend"
    if frontend_dir.exists():
        templates = Jinja2Templates(directory=str(frontend_dir / "templates"))

        @app.get("/", response_class=HTMLResponse, include_in_schema=False)
        async def dashboard_home(request: Request):
            return templates.TemplateResponse(request, "index.html")

        @app.get("/login", response_class=HTMLResponse, include_in_schema=False)
        async def login_page(request: Request):
            return templates.TemplateResponse(request, "login.html")

        @app.get("/reset-password", response_class=HTMLResponse, include_in_schema=False)
        async def reset_password_page(request: Request):
            return templates.TemplateResponse(request, "reset-password.html")

        @app.get("/admin", response_class=HTMLResponse, include_in_schema=False)
        async def admin_page(request: Request):
            """Super-admin dashboard shell — the page itself renders for
            anyone (no server-side session to gate on), but every
            /api/admin/* call it makes is independently protected by
            Depends(auth.require_role("super_admin"))."""
            return templates.TemplateResponse(request, "admin.html")

        @app.get("/profile", response_class=HTMLResponse, include_in_schema=False)
        async def contact_profile_page(request: Request):
            """Standalone full-page contact profile — opened via the contact
            drawer's "View Profile" button (?account=<id>&persona_id=<id>).
            Reuses the same drawer markup/rendering as the dashboard's
            sliding drawer; see frontend/js/modules/profile-page.js."""
            return templates.TemplateResponse(request, "profile.html")

        @app.get("/command-center", response_class=HTMLResponse, include_in_schema=False)
        async def sales_command_center_page(request: Request):
            """Action-first rep/manager/exec dashboard — KPI strip, account
            priority matrix, priority signal feed, playbook and exec
            movements timeline. Currently runs on mock seed data; see
            frontend/js/modules/command-center/data.js."""
            return templates.TemplateResponse(request, "command-center.html")

        @app.get("/tasks", response_class=HTMLResponse, include_in_schema=False)
        async def tasks_page(request: Request):
            """Personal, cross-account Task Management page — every action
            item assigned to the caller (GET /api/me/action-items), with
            status/priority/account filtering and sorting. See
            TASK_MANAGEMENT_README.md. A team/manager-wide view is a
            deliberately deferred v2 (no endpoint for it exists yet)."""
            return templates.TemplateResponse(request, "tasks.html")

        css_dir = frontend_dir / "css"
        js_dir = frontend_dir / "js"
        pipline_dir = frontend_dir / "pipline"
        if css_dir.exists():
            app.mount("/css", StaticFiles(directory=str(css_dir)), name="frontend-css")
        if js_dir.exists():
            app.mount("/js", StaticFiles(directory=str(js_dir)), name="frontend-js")
        if pipline_dir.exists():
            app.mount("/pipline", StaticFiles(directory=str(pipline_dir), html=True), name="frontend-pipline")


if __name__ == "__main__":
    if FASTAPI_AVAILABLE:
        print("=" * 70)
        print("[*] Starting Sales AI Granular REST API Server on http://0.0.0.0:8000")
        print("[*] Interactive Swagger API Documentation: http://localhost:8000/docs")
        print("=" * 70)
        uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
    else:
        print("[!] FastAPI/uvicorn not installed. Run: pip install -r requirements.txt")
