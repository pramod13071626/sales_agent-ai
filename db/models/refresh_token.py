"""RefreshToken ORM Model — Server-side, revocable refresh tokens.

Deliberately not a purely stateless JWT: storing (a hash of) each issued
refresh token here means a super admin deactivating a user (users.is_active)
or an explicit logout takes effect immediately, instead of waiting out
whatever the token's natural expiry happens to be. Rotated on every use
(old row revoked, new row issued) so a stolen-and-reused old token is
detectable rather than silently accepted.
"""

from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from db.models.base import Base


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(255), nullable=False, unique=True, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True))
    user_agent = Column(String(500))
    ip_address = Column(String(64))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User")

    def __repr__(self):
        return f"<RefreshToken(id={self.id}, user_id={self.user_id}, revoked={self.revoked_at is not None})>"
