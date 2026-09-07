"""ActionItemReminder ORM Model — Log of reminder emails actually sent for
an action item. A log table rather than a single timestamp column on
ActionItem so distinct reminder stages (due-soon vs. overdue) are each
tracked once and never double-sent — see
ACTION_ITEMS_IMPLEMENTATION_PLAN.md §1/§4.
"""

from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship
from db.models.base import Base


class ActionItemReminder(Base):
    __tablename__ = "action_item_reminders"
    __table_args__ = (
        # 'assigned' is intentionally excluded from this constraint — an
        # item can be reassigned more than once, and each reassignment
        # should be able to notify its new assignee.
        UniqueConstraint("action_item_id", "reminder_type", "sent_to_user_id",
                          name="uq_action_item_reminder_stage"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    action_item_id = Column(Integer, ForeignKey("action_items.id", ondelete="CASCADE"), nullable=False, index=True)
    reminder_type = Column(String(30), nullable=False)  # due_soon | overdue | assigned
    sent_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    sent_to_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    action_item = relationship("ActionItem")
    sent_to = relationship("User")

    def __repr__(self):
        return f"<ActionItemReminder(action_item_id={self.action_item_id}, type='{self.reminder_type}')>"
