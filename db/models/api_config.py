"""SystemApiConfig ORM Model — Encrypted external API keys, LLM models, and runtime config."""

from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from db.models.base import Base


class SystemApiConfig(Base):
    __tablename__ = "system_api_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    config_key = Column(String(100), unique=True, nullable=False, index=True)
    category = Column(String(50), nullable=False, index=True)  # 'llm', 'enrichment', 'email', 'system'
    display_name = Column(String(150), nullable=False)
    encrypted_value = Column(Text, nullable=True)
    is_secret = Column(Boolean, default=True, nullable=False)
    extra_metadata = Column(JSONB, nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    updater = relationship("User", foreign_keys=[updated_by])

    def __repr__(self):
        return f"<SystemApiConfig(key='{self.config_key}', category='{self.category}', is_secret={self.is_secret})>"
