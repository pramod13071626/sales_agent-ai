"""
Persona Photo Caching & Avatar Service.
Fetches, caches locally under output/avatars/, and serves persona headshots/avatars.
Prevents third-party CDN expiration (e.g. LinkedIn signed media URLs).
"""

import os
import time
import requests
from typing import Optional, Tuple, List, Dict, Any

AVATARS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "output", "avatars"))
os.makedirs(AVATARS_DIR, exist_ok=True)

# In-memory negative cache to prevent repeated 404 hammering
_MISS_CACHE: Dict[int, float] = {}
_MISS_TTL_SECONDS = 300  # 5 minutes


def _get_avatar_path(persona_id: int) -> Optional[Tuple[str, str]]:
    for ext, ctype in [(".jpg", "image/jpeg"), (".jpeg", "image/jpeg"), (".png", "image/png"), (".webp", "image/webp")]:
        path = os.path.join(AVATARS_DIR, f"{persona_id}{ext}")
        if os.path.isfile(path) and os.path.getsize(path) > 0:
            return path, ctype
    return None


def cached(persona_id: int) -> Optional[Tuple[str, str]]:
    """Returns (filepath, content_type) if an avatar is already cached locally, else None."""
    return _get_avatar_path(persona_id)


def recently_missed(persona_id: int) -> bool:
    """Returns True if this persona recently failed photo resolution."""
    ts = _MISS_CACHE.get(persona_id)
    if not ts:
        return False
    if time.time() - ts < _MISS_TTL_SECONDS:
        return True
    _MISS_CACHE.pop(persona_id, None)
    return False


def candidates(persona: Any) -> List[str]:
    """Extracts candidate photo URLs from a Persona model or dict."""
    urls = []
    if hasattr(persona, "photo_url") and persona.photo_url:
        urls.append(persona.photo_url)
    if hasattr(persona, "linkedin_photo_url") and persona.linkedin_photo_url:
        urls.append(persona.linkedin_photo_url)
    if hasattr(persona, "headshot_url") and persona.headshot_url:
        urls.append(persona.headshot_url)
    if hasattr(persona, "profile_data") and isinstance(persona.profile_data, dict):
        p_data = persona.profile_data
        for k in ["photo_url", "profile_pic_url", "avatar_url", "headshot", "picture"]:
            if p_data.get(k):
                urls.append(p_data[k])
    return [u for u in urls if u and isinstance(u, str) and u.startswith("http")]


def fetch_and_cache(persona_id: int, urls: List[str]) -> Optional[Tuple[str, str]]:
    """Attempts to download and cache the first reachable image from urls."""
    existing = _get_avatar_path(persona_id)
    if existing:
        return existing

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    for url in urls:
        try:
            resp = requests.get(url, headers=headers, timeout=5)
            if resp.status_code == 200 and resp.content:
                ctype = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip().lower()
                ext = ".jpg"
                if "png" in ctype:
                    ext = ".png"
                    ctype = "image/png"
                elif "webp" in ctype:
                    ext = ".webp"
                    ctype = "image/webp"
                else:
                    ctype = "image/jpeg"

                save_path = os.path.join(AVATARS_DIR, f"{persona_id}{ext}")
                with open(save_path, "wb") as f:
                    f.write(resp.content)
                _MISS_CACHE.pop(persona_id, None)
                return save_path, ctype
        except Exception:
            continue

    _MISS_CACHE[persona_id] = time.time()
    return None
