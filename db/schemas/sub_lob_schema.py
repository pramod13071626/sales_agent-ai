"""SubLob Pydantic Schema — Validates SubLob fields for Level 3 entities."""

from typing import Any, Optional
from datetime import datetime
from pydantic import BaseModel


class SubLobSchema(BaseModel):
    """Validates and maps SubLob data → SubLob ORM fields."""

    name: Optional[str] = None
    legal_name: Optional[str] = None
    lei_code: Optional[str] = None
    jurisdiction: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    relationship_type: Optional[str] = None
    status: Optional[str] = "ACTIVE"
    entity_level: Optional[str] = "Level 3 (Operating Sub-LOB)"
    parent_lob_lei: Optional[str] = None
    parent_lob_name: Optional[str] = None
    domain: Optional[str] = None
    website_url: Optional[str] = None
    is_manually_verified: Optional[bool] = False
    manually_verified_at: Optional[datetime] = None
    metadata_: Optional[Any] = None

    model_config = {"from_attributes": True}

    @classmethod
    def from_raw(cls, sub: Any) -> "SubLobSchema":
        """Factory: builds SubLobSchema from a dict or string."""
        if isinstance(sub, dict):
            raw_meta = sub.get("metadata") if isinstance(sub.get("metadata"), dict) else {}
            s_name = (
                sub.get("name")
                or sub.get("legal_name")
                or sub.get("lob_name")
                or raw_meta.get("name")
                or raw_meta.get("legal_name")
            )
            juris = sub.get("jurisdiction") or raw_meta.get("jurisdiction")
            country = (
                sub.get("country")
                or raw_meta.get("country")
                or (juris.split("-")[0].strip() if juris else None)
            )
            return cls(
                name=s_name,
                legal_name=sub.get("legal_name") or raw_meta.get("legal_name") or s_name,
                lei_code=(
                    sub.get("lei")
                    or sub.get("lei_code")
                    or raw_meta.get("lei")
                    or raw_meta.get("lei_code")
                ),
                jurisdiction=juris,
                country=country,
                city=sub.get("city") or raw_meta.get("city"),
                relationship_type=(
                    sub.get("relationship_type")
                    or raw_meta.get("relationship_type")
                    or "Level 3: Operating Sub-LOB / Grandchild"
                ),
                status=sub.get("status") or "ACTIVE",
                entity_level=sub.get("entity_level") or "Level 3 (Operating Sub-LOB)",
                parent_lob_lei=sub.get("parent_lob_lei") or raw_meta.get("parent_lob_lei"),
                parent_lob_name=(
                    sub.get("parent_lob_name")
                    or sub.get("parent_legal_name")
                    or raw_meta.get("parent_lob_name")
                ),
                domain=sub.get("domain") or raw_meta.get("domain"),
                website_url=sub.get("website_url") or sub.get("website") or raw_meta.get("website_url"),
                is_manually_verified=bool(sub.get("is_manually_verified", False)),
                manually_verified_at=sub.get("manually_verified_at"),
                metadata_=sub,
            )
        elif isinstance(sub, str):
            return cls(name=sub.strip(), legal_name=sub.strip(), metadata_={"name": sub.strip()})
        return cls()
