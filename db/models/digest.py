"""Digest ORM Model — LLM-generated per-target content digest (channel summaries, sales angles, hooks, post ideas)."""

from datetime import datetime, timezone
from sqlalchemy import Column, Text, Integer, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from db.models.base import Base


class Digest(Base):
    __tablename__ = "digests"

    target_key = Column(Text, primary_key=True)
    kind = Column(Text, nullable=False)
    generated_at = Column(DateTime(timezone=True))
    llm = Column(Text)
    posts_considered = Column(Integer)
    priority = Column(Text)
    digest = Column(JSONB, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    def __repr__(self):
        return f"<Digest(target_key='{self.target_key}', kind='{self.kind}')>"
