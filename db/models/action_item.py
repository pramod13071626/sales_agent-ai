"""ActionItem ORM Model — Client-specific work-list entries: a task tied to
an account (and optionally a specific contact) with status, priority, an
assignee, and a due date. See ACTION_ITEMS_IMPLEMENTATION_PLAN.md.
"""

from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from db.models.base import Base


class ActionItem(Base):
    __tablename__ = "action_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    persona_id = Column(Integer, ForeignKey("personas.id", ondelete="SET NULL"), nullable=True, index=True)

    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="open")  # open | in_progress | done | cancelled
    priority = Column(String(20), nullable=False, default="medium")  # high | medium | low
    due_date = Column(DateTime(timezone=True), nullable=True)

    assigned_to_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Where this item came from — 'manual' unless auto-generated from a
    # signal already sitting in this database (see plan §5/§6.1).
    source = Column(String(50), nullable=False, default="manual")
    source_ref_id = Column(Integer, nullable=True)

    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    account = relationship("Account")
    persona = relationship("Persona")
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])
    created_by = relationship("User", foreign_keys=[created_by_id])

    def __repr__(self):
        return f"<ActionItem(id={self.id}, account_id={self.account_id}, status='{self.status}', title='{self.title}')>"
