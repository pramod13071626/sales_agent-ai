"""SubLob ORM Model — 4 columns. Nested child divisions under a LOB."""

from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from db.models.base import Base


class SubLob(Base):
    __tablename__ = "sub_lobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lob_id = Column(Integer, ForeignKey("lobs.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(500))
    metadata_ = Column("metadata", JSONB)

    # ── Relationships ──
    lob = relationship("Lob", back_populates="sub_lobs")

    def __repr__(self):
        return f"<SubLob(id={self.id}, name='{self.name}')>"
