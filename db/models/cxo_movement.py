"""CXO Movement ORM Model — Tracks executive leadership transitions (joined, resigned, retired, promoted)."""

from datetime import datetime, timezone
from sqlalchemy import Column, BigInteger, Text, Boolean, DateTime, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import JSONB
from db.models.base import Base


class CxoMovement(Base):
    __tablename__ = "cxo_movements"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    target_key = Column(Text, nullable=False, index=True)
    company_name = Column(Text, nullable=False, index=True)
    person_name = Column(Text, nullable=False)
    designation = Column(Text)
    event_type = Column(Text, nullable=False, index=True)
    effective_date = Column(Text)
    previous_role = Column(Text)
    new_company = Column(Text)
    context = Column(Text)
    source = Column(Text)
    publisher_domain = Column(Text)
    article_title = Column(Text)
    article_url = Column(Text, nullable=False)
    article_body = Column(Text)
    extraction_status = Column(Text, default="ok")
    published_at = Column(Text)
    first_seen = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_seen = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                       onupdate=lambda: datetime.now(timezone.utc))
    new_in_last_run = Column(Boolean, default=True)
    raw = Column(JSONB)

    __table_args__ = (
        UniqueConstraint("target_key", "person_name", "event_type", "article_url", name="unique_person_movement"),
        Index("idx_cxo_movements_published", published_at.desc()),
    )

    def __repr__(self):
        return f"<CxoMovement(id={self.id}, person='{self.person_name}', company='{self.company_name}', event='{self.event_type}')>"
