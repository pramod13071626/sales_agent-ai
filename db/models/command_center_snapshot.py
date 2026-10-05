"""CommandCenterSnapshot ORM Model — One saved run of the Command Center
generator (services/command_center_service.py): the Priority Signal Feed,
This Week's Playbook and signal-velocity numbers, as of `generated_at`.
Kept per user because each user only sees the accounts they're granted."""

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from db.models.base import Base


class CommandCenterSnapshot(Base):
    __tablename__ = "command_center_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    generated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    signals = Column(JSONB, nullable=False, default=list)
    playbook = Column(JSONB, nullable=False, default=list)
    velocity = Column(JSONB, nullable=False, default=dict)
    source_counts = Column(JSONB, nullable=False, default=dict)

    def __repr__(self):
        return f"<CommandCenterSnapshot(id={self.id}, user_id={self.user_id}, generated_at={self.generated_at})>"
