"""Send proactive reminder emails for action items that are due soon or
overdue. See ACTION_ITEMS_IMPLEMENTATION_PLAN.md §4.

There is no running scheduler in this codebase to hook into (no Celery beat,
no cron already wired up) — this is a plain script, matching the existing
`scripts/create_super_admin.py` / `scripts/reconcile_targets_accounts.py`
convention, meant to be triggered by an OS-level scheduler:

  Windows Task Scheduler: run every 30-60 minutes
      python scripts\\send_action_reminders.py
  cron (if ever deployed on Linux):
      */30 * * * * cd /path/to/repo && python scripts/send_action_reminders.py

Idempotent: each (action_item, reminder_type) pair is logged in
`action_item_reminders` and never re-sent — running this script more often
than necessary just means it finds nothing new to send, not duplicate mail.

Usage:
    python scripts/send_action_reminders.py [--due-soon-hours 24] [--dry-run]
"""
import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import email_sender
from db.connection import get_session
from db.models import ActionItem, ActionItemReminder


def _already_sent(session, item_id: int, reminder_type: str, user_id: int) -> bool:
    return session.query(ActionItemReminder).filter_by(
        action_item_id=item_id, reminder_type=reminder_type, sent_to_user_id=user_id,
    ).first() is not None


def _send_reminder(session, item: ActionItem, reminder_type: str, dry_run: bool) -> bool:
    """Returns True if a reminder was (or would have been, in dry-run) sent."""
    if not item.assigned_to or not item.assigned_to.email:
        return False  # nothing to notify — unassigned items just sit until someone takes them
    if _already_sent(session, item.id, reminder_type, item.assigned_to_id):
        return False

    assignee = item.assigned_to
    account_name = item.account.display_name or item.account.legal_name if item.account else "an account"
    due_str = item.due_date.astimezone(timezone.utc).strftime("%b %d, %Y") if item.due_date else "no date"
    is_overdue = reminder_type == "overdue"
    heading = "Action item overdue" if is_overdue else "Action item due soon"

    print(f"{'[DRY RUN] ' if dry_run else ''}Sending '{reminder_type}' reminder to "
          f"{assignee.email} for action item #{item.id} ({item.title!r})")
    if dry_run:
        return True

    email_sender.send_email(
        assignee.email, f"{heading}: {item.title}",
        f"Hi {assignee.full_name or assignee.email},\n\n"
        f"{'This action item is now overdue' if is_overdue else 'This action item is due soon'} "
        f"on {account_name}:\n\n{item.title}\n{item.description or ''}\nDue: {due_str}\n",
        html_body=email_sender.render_html(
            heading,
            [f"Hi {assignee.full_name or assignee.email},",
             f"{'This action item is now overdue' if is_overdue else 'This action item is due soon'} on {account_name}:",
             item.title] + ([item.description] if item.description else []),
            footnote=f"Due: {due_str}",
        ),
    )
    session.add(ActionItemReminder(action_item_id=item.id, reminder_type=reminder_type,
                                    sent_to_user_id=item.assigned_to_id))
    session.commit()
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--due-soon-hours", type=int, default=24,
                         help="how far ahead of the due date to send the 'due soon' reminder (default 24)")
    parser.add_argument("--dry-run", action="store_true", help="print what would be sent without sending or logging it")
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    due_soon_cutoff = now + timedelta(hours=args.due_soon_hours)

    session = get_session()
    try:
        open_items = (session.query(ActionItem)
                      .filter(ActionItem.status.in_(("open", "in_progress")),
                              ActionItem.due_date.isnot(None))
                      .all())

        sent_count = 0
        for item in open_items:
            due = item.due_date if item.due_date.tzinfo else item.due_date.replace(tzinfo=timezone.utc)
            if due < now:
                if _send_reminder(session, item, "overdue", args.dry_run):
                    sent_count += 1
            elif due <= due_soon_cutoff:
                if _send_reminder(session, item, "due_soon", args.dry_run):
                    sent_count += 1

        print(f"\n{'Would send' if args.dry_run else 'Sent'} {sent_count} reminder(s) "
              f"out of {len(open_items)} open item(s) with a due date.")
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    sys.exit(main())
