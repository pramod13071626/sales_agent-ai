"""Seed the first super_admin account.

Deliberately a manual, HTTP-unreachable script rather than a "first user to
register becomes admin" flow — see AUTH_JWT_IMPLEMENTATION_PLAN.md §6.

Usage:
    python scripts/create_super_admin.py --email you@company.com --password "..." [--name "Your Name"]

If a user with that email already exists, promotes them to super_admin and
resets their password instead of failing, so this is also the recovery path
if you ever lock yourself out.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import auth
from db.connection import get_session
from db.models import User


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--name", default=None)
    args = parser.parse_args()

    if len(args.password) < 8:
        print("Refusing a password under 8 characters.")
        return 1

    email = args.email.strip().lower()
    session = get_session()
    try:
        user = session.query(User).filter(User.email.ilike(email)).first()
        hashed = auth.hash_password(args.password)
        if user:
            user.hashed_password = hashed
            user.role = "super_admin"
            user.is_active = True
            user.failed_login_count = 0
            user.locked_until = None
            if args.name:
                user.full_name = args.name
            session.commit()
            print(f"Updated existing user {email} -> role=super_admin, password reset.")
        else:
            user = User(email=email, full_name=args.name, role="super_admin", hashed_password=hashed)
            session.add(user)
            session.commit()
            print(f"Created super_admin {email} (id={user.id}).")
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    sys.exit(main())
