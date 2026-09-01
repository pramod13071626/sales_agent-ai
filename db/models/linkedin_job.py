"""LinkedInJob ORM Model — Scraped LinkedIn job postings per target_key (imported from the
Neon content-pipeline DB dump; target_key is a loose text reference, matching how Post/Digest
already treat it — this database has no `targets` table to foreign-key against)."""

from datetime import datetime, timezone
from sqlalchemy import Column, BigInteger, Text, Integer, Boolean, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from db.models.base import Base


class LinkedInJob(Base):
    __tablename__ = "linkedin_jobs"
    __table_args__ = (
        UniqueConstraint("target_key", "job_key", name="linkedin_jobs_target_key_job_key_key"),
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    target_key = Column(Text, nullable=False, index=True)
    job_key = Column(Text, nullable=False)
    title = Column(Text)
    company_name = Column(Text)
    location = Column(Text)
    employment_type = Column(Text)
    workplace_type = Column(Text)
    posted_date = Column(Text)
    applicants = Column(Integer)
    views = Column(Integer)
    salary = Column(JSONB)
    job_url = Column(Text)
    description = Column(Text)
    first_seen = Column(DateTime(timezone=True))
    last_seen = Column(DateTime(timezone=True))
    new_in_last_run = Column(Boolean)
    raw = Column(JSONB, nullable=False)

    def __repr__(self):
        return f"<LinkedInJob(target_key='{self.target_key}', title='{self.title}')>"
