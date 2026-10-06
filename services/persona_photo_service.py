"""Persona profile photos: pick the best scraped source and cache a local copy.

Scraped photo URLs (mostly LinkedIn CDN links) carry an `e=` expiry and stop working
within weeks, so the UI never uses them directly. GET /api/personas/{id}/photo serves a
copy saved under output/avatars/, fetched on first view; scripts/cache_persona_photos.py
saves them all up front so links that expire before anyone looks are not lost.

Discovering *new* headshots (Serper image search) is headshot_resolver_service.py's job;
this module only caches URLs already on the persona.
"""
import ipaddress
import socket
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urlparse

import requests

import config

AVATAR_DIR: Path = config.OUTPUT_DIR / "avatars"
TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
MAX_BYTES = 2_000_000
RETRY_SECONDS = 7 * 86400          # after every source failed, wait this long before trying again
_PLACEHOLDERS = ("ghost_person", "ghost-person", "logo", "spacer")


def candidates(p) -> List[str]:
    """Photo URLs for a persona, best source first, scraped placeholders dropped."""
    raw = p.raw_data if isinstance(p.raw_data, dict) else {}
    ext = p.extended_profile if isinstance(getattr(p, "extended_profile", None), dict) else {}
    sub = lambda k: raw.get(k) if isinstance(raw.get(k), dict) else {}
    li_pic = sub("apify_linkedin").get("profilePicture")
    tw = lambda k: (sub(k).get("author") or {}).get("profilePicture") if isinstance(sub(k).get("author"), dict) else None
    urls = [
        getattr(p, "photo_url", None),
        raw.get("photo_url"),
        ext.get("photo_url"),
        sub("apify_linkedin").get("photo"),
        li_pic.get("url") if isinstance(li_pic, dict) else None,
        sub("linkedin").get("photo"),
        sub("diffbot").get("image_url"),
        sub("diffbot").get("image"),
        sub("apollo").get("photo_url"),
        sub("social_profiles").get("photo"),
        sub("persona_dossier").get("photo"),
        tw("apify_twitter"),
        tw("twitter"),
    ]
    out: List[str] = []
    for u in urls:
        if (isinstance(u, str) and u.startswith(("http://", "https://")) and u not in out
                and not any(g in u.lower() for g in _PLACEHOLDERS)):
            out.append(u)
    return out


def cached(persona_id: int) -> Optional[Tuple[Path, str]]:
    for ctype, ext in TYPES.items():
        path = AVATAR_DIR / f"{persona_id}{ext}"
        if path.exists():
            return path, ctype
    return None


def recently_missed(persona_id: int) -> bool:
    miss = AVATAR_DIR / f"{persona_id}.none"
    return miss.exists() and datetime.now().timestamp() - miss.stat().st_mtime < RETRY_SECONDS


def _public_http_url(url: str) -> bool:
    """URLs come from scraped third-party data — never let one point at the internal network."""
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        return False
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80))
    except OSError:
        return False
    return all(ipaddress.ip_address(i[4][0]).is_global for i in infos)


def _fetch(url: str) -> Optional[Tuple[bytes, str]]:
    if not _public_http_url(url):
        return None
    try:
        with requests.get(url, timeout=6, stream=True, allow_redirects=False,
                          headers={"User-Agent": "Mozilla/5.0 (sales-intel avatar cache)"}) as r:
            ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if r.status_code != 200 or ctype not in TYPES:
                return None
            body = b""
            for chunk in r.iter_content(64 * 1024):
                body += chunk
                if len(body) > MAX_BYTES:
                    return None
            return (body, ctype) if body else None
    except requests.RequestException:
        return None


def fetch_and_cache(persona_id: int, urls: List[str]) -> Optional[Tuple[Path, str]]:
    """Save the first source that returns a real image; on total failure leave a
    `.none` marker so the next RETRY_SECONDS of views don't re-hit dead links."""
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    miss = AVATAR_DIR / f"{persona_id}.none"
    for url in urls:
        got = _fetch(url)
        if got:
            body, ctype = got
            for old_ext in TYPES.values():           # a refresh may change the format
                (AVATAR_DIR / f"{persona_id}{old_ext}").unlink(missing_ok=True)
            path = AVATAR_DIR / f"{persona_id}{TYPES[ctype]}"
            path.write_bytes(body)
            miss.unlink(missing_ok=True)
            return path, ctype
    miss.touch()
    return None
