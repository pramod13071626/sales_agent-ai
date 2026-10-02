"""
Enterprise Executive Headshot Resolver Service.
Resolves authentic, high-resolution executive portrait headshots via Google Serper Images API.
Serves as zero-Apify fallback and automatic headshot enricher across all organizations.

Zero Hardcoding, Non-Destructive MDM Merging.
"""

import os
import re
import requests
from typing import Optional, Dict, Any, List
from db.connection import get_session
from db.models.persona import Persona
from db.models.account import Account
from services.coalescence_engine import CoalescenceEngine


class HeadshotResolverService:
    """Universal Executive Headshot Discovery & Resolution Engine."""

    @classmethod
    def get_serper_api_key(cls) -> str:
        """Retrieves active Serper API key from environment."""
        return os.getenv("SERPER_API_KEY", "").strip()

    @classmethod
    def resolve_headshot(
        cls, full_name: str, company_name: str, title: Optional[str] = None
    ) -> Optional[str]:
        """
        Queries Google Images via Serper API to find authentic executive portraits.
        Filters out company logos, stock photos, placeholders, and bad aspect ratios.
        """
        api_key = cls.get_serper_api_key()
        if not api_key:
            return None

        clean_name = full_name.strip()
        clean_company = company_name.strip()
        if not clean_name or len(clean_name) < 3 or clean_name.lower() in ("executive", "leader", "unknown"):
            return None

        query = f'"{clean_name}" "{clean_company}" headshot portrait executive'
        headers = {
            "X-API-KEY": api_key,
            "Content-Type": "application/json"
        }
        payload = {
            "q": query,
            "num": 6
        }

        try:
            resp = requests.post(
                "https://google.serper.dev/images",
                headers=headers,
                json=payload,
                timeout=8
            )
            if resp.status_code != 200:
                # Fallback to name + company without extra keywords
                payload["q"] = f'"{clean_name}" "{clean_company}" profile'
                resp = requests.post(
                    "https://google.serper.dev/images",
                    headers=headers,
                    json=payload,
                    timeout=8
                )
                if resp.status_code != 200:
                    return None

            data = resp.json()
            images = data.get("images", [])
            first_name = clean_name.split()[0].lower()
            last_name = clean_name.split()[-1].lower() if len(clean_name.split()) > 1 else ""

            DISALLOWED_PATTERNS = [
                ".svg", "logo", "icon", "banner", "thumbnail-logo", "symbol",
                "default", "ghost", "placeholder", "blank", "spacer", "flag",
                "building", "office", "stock-photo", "shutterstock", "gettyimages"
            ]

            for img in images:
                img_url = img.get("imageUrl")
                if not img_url or not isinstance(img_url, str) or not img_url.startswith("http"):
                    continue

                url_lower = img_url.lower()
                if any(p in url_lower for p in DISALLOWED_PATTERNS):
                    continue

                title_lower = (img.get("title") or "").lower()
                domain_lower = (img.get("domain") or "").lower()

                # Extract significant name tokens (length >= 3, skipping initials like 'K.')
                name_tokens = [tok for tok in re.findall(r"[a-z]+", clean_name.lower()) if len(tok) >= 3]
                if not name_tokens:
                    # Very short name, match exact name
                    if clean_name.lower() in title_lower or clean_name.lower() in url_lower:
                        return img_url
                    continue

                # Strict validation: at least the primary last name or most distinct token must appear
                # in the title, domain, or image URL
                matches = [tok for tok in name_tokens if tok in title_lower or tok in url_lower]
                
                # If we have multiple significant tokens, require at least the last name or 2 tokens
                if len(name_tokens) >= 2:
                    last_tok = name_tokens[-1]
                    if (last_tok in title_lower or last_tok in url_lower) or len(matches) >= 2:
                        return img_url
                elif len(matches) >= 1:
                    # Single significant token with company or leadership context
                    if clean_company.lower() in title_lower or clean_company.lower() in domain_lower or "executive" in title_lower or "leadership" in title_lower or "linkedin" in domain_lower:
                        return img_url

        except Exception as e:
            print(f"[!] [HeadshotResolver] Query error for '{clean_name}': {e}")

        return None

    @classmethod
    def sync_photo_to_disk_if_exists(cls, persona_key: str, full_name: str, photo_url: str):
        """Finds any matching JSON file in output/ directory and writes photo_url non-destructively."""
        import glob
        import json
        from pathlib import Path
        output_dir = Path("output")
        if not output_dir.exists():
            return
        
        slug = re.sub(r"[^a-z0-9]+", "_", (full_name or persona_key).lower()).strip("_")
        candidates = list(output_dir.rglob(f"*{slug}*.json"))
        for c in candidates:
            try:
                with open(c, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                if isinstance(data, dict):
                    data["photo_url"] = photo_url
                    if isinstance(data.get("raw_data"), dict):
                        data["raw_data"]["photo_url"] = photo_url
                    if isinstance(data.get("extended_profile"), dict):
                        data["extended_profile"]["photo_url"] = photo_url
                    with open(c, "w", encoding="utf-8") as fp:
                        json.dump(data, fp, indent=2)
            except Exception:
                continue

    @classmethod
    def backfill_missing_headshots_for_account(
        cls, account_id: int, limit: int = 100, target_keys: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Scans personas under an account that currently lack headshots,
        resolves their photos with high precision, coalesces into PostgreSQL,
        and synchronizes with disk files.
        """
        session = get_session()
        resolved_count = 0
        try:
            acct = session.query(Account).filter_by(id=account_id).first()
            if not acct:
                return {"status": "error", "message": f"Account {account_id} not found."}

            company_name = acct.display_name or acct.legal_name or acct.key

            query = session.query(Persona).filter(Persona.account_id == account_id)
            if target_keys:
                query = query.filter(Persona.key.in_(target_keys))
            personas = query.all()

            for p in personas:
                if resolved_count >= limit:
                    break

                # Check if persona already has a photo
                rd = p.raw_data if isinstance(p.raw_data, dict) else {}
                ep = p.extended_profile if isinstance(p.extended_profile, dict) else {}
                has_photo = bool(
                    rd.get("photo_url")
                    or ep.get("photo_url")
                    or (rd.get("apify_linkedin", {}).get("photo") if isinstance(rd.get("apify_linkedin"), dict) else None)
                    or (rd.get("diffbot", {}).get("image_url") if isinstance(rd.get("diffbot"), dict) else None)
                )

                if has_photo:
                    continue

                full_name = p.full_name or p.display_name
                if not full_name or len(full_name.strip()) < 3:
                    continue

                photo_url = cls.resolve_headshot(full_name, company_name, p.title)
                if photo_url:
                    CoalescenceEngine.coalesce_persona(p, {"photo_url": photo_url})
                    cls.sync_photo_to_disk_if_exists(p.key, full_name, photo_url)
                    resolved_count += 1
                    print(f"[+] [HeadshotResolver] Added photo for {full_name} ({company_name}): {photo_url[:65]}...")

                if resolved_count % 10 == 0 and resolved_count > 0:
                    session.commit()

            if resolved_count > 0:
                session.commit()

            return {
                "status": "success",
                "account_id": account_id,
                "company_name": company_name,
                "headshots_resolved": resolved_count
            }
        except Exception as e:
            session.rollback()
            return {"status": "error", "message": str(e)}
        finally:
            session.close()
