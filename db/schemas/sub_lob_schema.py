"""SubLob Pydantic Schema — Validates SubLob fields."""

from typing import Any, Optional
from pydantic import BaseModel


class SubLobSchema(BaseModel):
    """Validates and maps SubLob data → SubLob ORM fields."""

    name: Optional[str] = None
    metadata_: Optional[Any] = None

    model_config = {"from_attributes": True}

    @classmethod
    def from_raw(cls, sub: Any) -> "SubLobSchema":
        """Factory: builds SubLobSchema from a dict or string."""
        if isinstance(sub, dict):
            return cls(name=sub.get("name"), metadata_=sub)
        elif isinstance(sub, str):
            return cls(name=sub)
        return cls()
