"""OpportunitySignal ORM Model — Persisted history of detected growth-whitespace themes and
domain-expansion product ideas per account, so past suggestions stay visible even after they
stop actively recurring in fresh content."""

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from db.models.base import Base


class OpportunitySignal(Base):
    __tablename__ = "opportunity_signals"
    __table_args__ = (
        UniqueConstraint("account_id", "category", "signal_key", name="uq_opportunity_signal"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    category = Column(String(50), nullable=False)  # 'growth_theme' | 'domain_expansion'
    signal_key = Column(String(255), nullable=False)
    title = Column(Text, nullable=False)
    details = Column(JSONB, nullable=False, default=dict)
    status = Column(String(20), nullable=False, default="active")  # 'active' | 'inactive'

    first_seen = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    last_seen = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    def __repr__(self):
        return (f"<OpportunitySignal(account_id={self.account_id}, category='{self.category}', "
                f"signal_key='{self.signal_key}', status='{self.status}')>")
