"""Post ORM Model — Individually scraped social/news/content items (LinkedIn, news, blog, X, Reddit, SEC mentions)."""

from sqlalchemy import Column, BigInteger, Text, Integer, Boolean, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from db.models.base import Base


class Post(Base):
    __tablename__ = "posts"
    # Matches the source pipeline's raw-SQL schema (data_scrapper's db.py),
    # which upserts with ON CONFLICT (target_key, channel, post_key) — that
    # requires this exact constraint to exist on whichever DB it targets.
    __table_args__ = (
        UniqueConstraint("target_key", "channel", "post_key", name="posts_target_key_channel_post_key_key"),
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    target_key = Column(Text, nullable=False)
    kind = Column(Text, nullable=False)
    channel = Column(Text, nullable=False)
    post_key = Column(Text, nullable=False)
    rank = Column(Integer)
    post_url = Column(Text)
    body = Column(Text)
    author = Column(Text)
    published_at = Column(Text)
    engagement = Column(JSONB)
    media = Column(JSONB)
    extra = Column(JSONB)
    first_seen = Column(DateTime(timezone=True))
    last_seen = Column(DateTime(timezone=True))
    new_in_last_run = Column(Boolean)
    raw = Column(JSONB, nullable=False)

    def __repr__(self):
        return f"<Post(id={self.id}, target_key='{self.target_key}', channel='{self.channel}')>"
