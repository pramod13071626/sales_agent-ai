"""UserAccountAccess ORM Model — Per-user, per-account access grants.

A user with zero rows here has no account access at all once this is
enforced (Phase 3, AUTH_ENFORCED) — "super admin grants access" is meant
literally: a brand-new user starts with nothing until a super admin picks
which accounts they can see. super_admin itself bypasses this table
entirely (sees every account) — see auth.py's user_accessible_account_ids().
"""

from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import relationship
from db.models.base import Base


class UserAccountAccess(Base):
    __tablename__ = "user_account_access"
    __table_args__ = (
        UniqueConstraint("user_id", "account_id", name="uq_user_account_access"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    granted_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    granted_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", foreign_keys=[user_id])
    account = relationship("Account")
    granted_by = relationship("User", foreign_keys=[granted_by_id])

    def __repr__(self):
        return f"<UserAccountAccess(user_id={self.user_id}, account_id={self.account_id})>"
