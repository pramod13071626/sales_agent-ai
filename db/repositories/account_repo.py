"""Account Repository — UPSERT operations for the accounts table."""

from datetime import datetime, timezone
from sqlalchemy.orm import Session
from db.models.account import Account
from db.schemas.account_schema import AccountSchema


class AccountRepository:
    """Handles all database operations for the Account table."""

    def __init__(self, session: Session):
        self.session = session

    def upsert(self, schema: AccountSchema) -> Account:
        """Upsert an account. Updates if key exists, inserts if new."""
        existing = self.session.query(Account).filter_by(key=schema.key).first()

        if existing:
            acct = existing
        else:
            acct = Account(key=schema.key)
            self.session.add(acct)

        # Map all schema fields → ORM model fields
        data = schema.model_dump(exclude={"extracted_at"})
        for field, value in data.items():
            if hasattr(acct, field):
                setattr(acct, field, value)

        acct.extracted_at = datetime.now(timezone.utc)
        acct.updated_at = datetime.now(timezone.utc)

        self.session.flush()
        return acct

    def get_by_key(self, key: str) -> Account | None:
        """Retrieve an account by its unique key."""
        return self.session.query(Account).filter_by(key=key).first()

    def get_all(self) -> list[Account]:
        """Retrieve all accounts."""
        return self.session.query(Account).all()

    def count(self) -> int:
        """Count total accounts."""
        return self.session.query(Account).count()
