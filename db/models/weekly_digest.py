"""WeeklyDigestSnapshot ORM Model — Archived history of the per-account weekly sales update
email digest. The `digests` table only keeps the latest snapshot per target_key (overwritten
on every pipeline run), so this table preserves each week's version once it is first observed."""

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from db.models.base import Base


class WeeklyDigestSnapshot(Base):
    __tablename__ = "weekly_digest_snapshots"
    __table_args__ = (
        UniqueConstraint("account_id", "generated_at", name="uq_weekly_digest_snapshot"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    target_key = Column(String(255), nullable=False)
    week_of = Column(Date, nullable=False, index=True)
    generated_at = Column(DateTime(timezone=True), nullable=False)

    subject = Column(Text)
    body = Column(Text)
    priority = Column(String(50))
    confidence = Column(String(50))
    data_gaps = Column(JSONB, default=list)
    do_not_say = Column(JSONB, default=list)
    raw_email = Column(JSONB, default=dict)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    def __repr__(self):
        return f"<WeeklyDigestSnapshot(account_id={self.account_id}, week_of={self.week_of})>"
