"""Persona Repository — UPSERT operations for the personas table."""

import re
import json
import pathlib
from typing import Dict, List, Optional, Any
from sqlalchemy.orm import Session
from db.models.persona import Persona
from db.models.account import Account
from db.schemas.persona_schema import PersonaSchema

# Root path of the pipeline (two levels up from this file: db/repositories/ → db/ → pipeline/)
_PIPELINE_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
_ENRICHED_PERSONA_BASE = _PIPELINE_ROOT / "output" / "enriched" / "personas"


class PersonaRepository:
    """Handles all database operations for the Persona table."""

    def __init__(self, session: Session):
        self.session = session
        # Per-call index: {account_display_name_slug: {external_id/key/name_slug → enriched_json_dict}}
        # Built lazily the first time upsert_all() runs for a given account.
        self._enriched_index: Dict[str, Dict[str, Any]] = {}

    # ──────────────────────────────────────────────────────────────────────────
    # Per-persona enriched JSON resolution helpers
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _slug(text: str) -> str:
        """Lowercase alphanumeric slug, spaces → underscore, for filename matching."""
        return re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")

    def _build_enriched_index(self, account_display_name: str) -> Dict[str, Any]:
        """
        Scans output/enriched/personas/<account_slug>/ and builds a lookup dict:
            external_id  → enriched_dict
            key          → enriched_dict
            name_slug    → enriched_dict   (first_last slug, e.g. "jake_kindberg")
        Returns empty dict if the folder doesn't exist (graceful degradation).
        """
        acc_slug = self._slug(account_display_name)
        if acc_slug in self._enriched_index:
            return self._enriched_index[acc_slug]

        index: Dict[str, Any] = {}
        # Try all account-slug subdirectories (the folder name may not match exactly)
        if _ENRICHED_PERSONA_BASE.exists():
            for folder in _ENRICHED_PERSONA_BASE.iterdir():
                if not folder.is_dir():
                    continue
                folder_slug = self._slug(folder.name)
                # Accept if account slug is contained in folder slug or vice-versa
                if acc_slug not in folder_slug and folder_slug not in acc_slug:
                    continue
                for jf in folder.glob("*_enriched.json"):
                    try:
                        with open(jf, encoding="utf-8") as f:
                            d = json.load(f)
                        # Index by external_id
                        ext_id = d.get("external_id") or d.get("id")
                        if ext_id:
                            index[str(ext_id)] = d
                        # Index by key (e.g. "persona_54a460137...")
                        key_val = d.get("key")
                        if key_val:
                            index[key_val] = d
                        # Index by first_last slug
                        fn = self._slug(d.get("first_name") or "")
                        ln = self._slug(d.get("last_name") or "")
                        if fn and ln:
                            index[f"{fn}_{ln}"] = d
                        # Also index by full_name slug
                        full = self._slug(d.get("full_name") or d.get("name") or "")
                        if full:
                            index[full] = d
                    except Exception:
                        pass  # Skip unreadable files silently

        self._enriched_index[acc_slug] = index
        found = len({id(v) for v in index.values()})  # unique files
        if found:
            print(f"[*] [PersonaRepo] Enriched persona index built: {found} files for '{account_display_name}'")
        return index

    def _merge_enriched_persona(self, person_data: Dict[str, Any], index: Dict[str, Any]) -> Dict[str, Any]:
        """
        Looks up the enriched persona JSON for this person_data entry and merges it in.
        Enriched JSON values TAKE PRECEDENCE over the shallow person_data values,
        except for id/account_id/lob_id which are DB-managed.
        Returns a merged dict (non-destructive — does not modify person_data in place).
        """
        # Build lookup keys from person_data
        ext_id = str(person_data.get("id") or person_data.get("external_id") or "")
        key_val = person_data.get("key") or ""
        fn = self._slug(person_data.get("first_name") or "")
        ln = self._slug(person_data.get("last_name") or "")
        name_slug = f"{fn}_{ln}" if fn and ln else ""
        full_slug = self._slug(person_data.get("name") or person_data.get("full_name") or "")

        enriched = None
        for probe in [ext_id, key_val, name_slug, full_slug]:
            if probe and probe in index:
                enriched = index[probe]
                break

        if not enriched:
            return person_data  # No enriched file found — return as-is

        # Merge: enriched JSON is authoritative for non-null values
        SKIP = {"id", "account_id", "lob_id"}
        merged = dict(person_data)  # Start from base
        for k, v in enriched.items():
            if k in SKIP:
                continue
            if v is not None and v != "" and v != [] and v != {}:
                merged[k] = v  # Enriched value wins over empty/None base value
        return merged

    def upsert_all(self, account: Account, hierarchy: Dict[str, List[dict]],
                   tree_root: Optional[dict] = None):
        """
        Non-destructively upserts personas for an account from the 4-tier hierarchy.
        For each person, attempts to merge the corresponding per-persona enriched JSON
        from output/enriched/personas/ so all 89 columns are populated in the DB.
        Preserves existing personas, merges incoming data into matches, inserts new ones.
        """
        # Build tree lookup for hierarchy metadata
        tree_lookup = {}
        if tree_root:
            self._build_tree_lookup(tree_root, tree_lookup)

        # Build enriched-persona index for this account (lazy, cached per call)
        enriched_index = self._build_enriched_index(account.display_name or account.key or "")

        count = 0
        for tier_name in ["c_suite", "vp_level", "director_level", "manager_level"]:
            for person_data in (hierarchy.get(tier_name) or []):
                tree_info = tree_lookup.get(person_data.get("name"), {})

                # ── Merge per-persona enriched JSON if available ───────────────
                person_data = self._merge_enriched_persona(person_data, enriched_index)

                # Validate through schema
                schema = PersonaSchema.from_enriched_json(person_data, tree_info)
                p_dict = schema.model_dump()

                # Deduplicate: check if persona already exists in DB for this account
                existing = self.resolve_existing_persona(
                    account_id=account.id,
                    external_id=p_dict.get("external_id"),
                    key=p_dict.get("key"),
                    email=p_dict.get("email"),
                    full_name=p_dict.get("full_name") or person_data.get("name"),
                    first_name=p_dict.get("first_name"),
                    last_name=p_dict.get("last_name"),
                    title=p_dict.get("title"),
                    linkedin_url=p_dict.get("linkedin_url"),
                )

                if existing:
                    self.coalesce_into_master(existing, p_dict)
                else:
                    persona = Persona(account_id=account.id, lob_id=None)
                    for field, value in p_dict.items():
                        if field in ("id", "account_id", "lob_id", "account", "lob") and value is None:
                            continue
                        if hasattr(persona, field):
                            setattr(persona, field, value)
                    persona.account_id = account.id

                    # E3: Auto-route lob_id by title if not already assigned via LOB-specific scrape
                    if persona.lob_id is None and p_dict.get("title"):
                        try:
                            from services.persona_service import PersonaLOBRouter
                            routed_lob_id = PersonaLOBRouter.route(
                                title=p_dict["title"],
                                account_id=account.id,
                                session=self.session,
                            )
                            if routed_lob_id is not None:
                                persona.lob_id = routed_lob_id
                        except Exception as router_err:
                            # Non-fatal: lob routing is best-effort, never blocks import
                            print(f"[!] [PersonaLOBRouter] Routing notice for '{p_dict.get('full_name')}': {router_err}")

                    self.session.add(persona)

                count += 1

        self.session.flush()
        return count

    def upsert_all_from_enriched_folder(self, account: Account, enriched_folder: pathlib.Path) -> int:
        """
        Imports ALL per-persona enriched JSON files from a folder directly into the DB.
        Used for backfill: when the main account enriched JSON has no enrichment data
        but per-persona JSONs exist in output/enriched/personas/<account_slug>/.

        Each file is treated as a standalone persona record — no hierarchy dict needed.
        Returns count of personas upserted.
        """
        if not enriched_folder.exists():
            print(f"[!] [PersonaRepo] Enriched folder not found: {enriched_folder}")
            return 0

        json_files = list(enriched_folder.glob("*_enriched.json"))
        print(f"[*] [PersonaRepo] Backfill import: {len(json_files)} enriched JSONs from {enriched_folder.name}")

        count = 0
        for jf in json_files:
            try:
                with open(jf, encoding="utf-8") as f:
                    person_data = json.load(f)

                # Skip if no useful data
                if not person_data.get("full_name") and not person_data.get("name"):
                    continue

                schema = PersonaSchema.from_enriched_json(person_data)
                p_dict = schema.model_dump()

                existing = self.resolve_existing_persona(
                    account_id=account.id,
                    external_id=p_dict.get("external_id"),
                    key=p_dict.get("key"),
                    email=p_dict.get("email"),
                    full_name=p_dict.get("full_name") or person_data.get("name"),
                    first_name=p_dict.get("first_name"),
                    last_name=p_dict.get("last_name"),
                    title=p_dict.get("title"),
                    linkedin_url=p_dict.get("linkedin_url"),
                )

                if existing:
                    self.coalesce_into_master(existing, p_dict)
                else:
                    persona = Persona(account_id=account.id, lob_id=None)
                    for field, value in p_dict.items():
                        if field in ("id", "account_id", "lob_id", "account", "lob") and value is None:
                            continue
                        if hasattr(persona, field):
                            setattr(persona, field, value)
                    persona.account_id = account.id

                    if persona.lob_id is None and p_dict.get("title"):
                        try:
                            from services.persona_service import PersonaLOBRouter
                            routed_lob_id = PersonaLOBRouter.route(
                                title=p_dict["title"],
                                account_id=account.id,
                                session=self.session,
                            )
                            if routed_lob_id is not None:
                                persona.lob_id = routed_lob_id
                        except Exception:
                            pass

                    self.session.add(persona)

                count += 1
                if count % 50 == 0:
                    self.session.flush()
                    print(f"    ...flushed {count}/{len(json_files)} personas")

            except Exception as pe:
                print(f"[!] [PersonaRepo] Backfill error for {jf.name}: {pe}")

        self.session.flush()
        print(f"[+] [PersonaRepo] Backfill complete: {count} personas upserted from {enriched_folder.name}")
        return count


    def resolve_existing_persona(
        self,
        account_id: int,
        external_id: Optional[str] = None,
        key: Optional[str] = None,
        email: Optional[str] = None,
        full_name: Optional[str] = None,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        title: Optional[str] = None,
        linkedin_url: Optional[str] = None,
    ) -> Optional[Persona]:
        """
        Enterprise Deduplication Mapping Layer:
        Resolves an incoming persona to an existing record using a prioritized multi-strategy hierarchy:
        1. Exact external_id match (Apollo/DKG global UID)
        2. Direct verified email match
        3. Canonical LinkedIn profile URL match (/in/{handle})
        4. Key match (including base key if key has subsidiary suffix)
        5. Full name match (exact and middle-initial normalized)
        6. First name + prefix/initial last name match with title correlation
        """
        if not account_id:
            return None

        # 1. External ID match (Highest fidelity)
        if external_id and str(external_id).strip():
            ext = str(external_id).strip()
            match = self.session.query(Persona).filter(
                Persona.account_id == account_id,
                Persona.external_id == ext
            ).first()
            if match:
                return match

        # 2. Email match (Unique per executive)
        if email and "@" in email and not email.startswith(".@"):
            em = email.strip().lower()
            match = self.session.query(Persona).filter(
                Persona.account_id == account_id,
                Persona.email.ilike(em)
            ).first()
            if match:
                return match

        # 3. Canonical LinkedIn profile match (/in/{handle})
        if linkedin_url and "/in/" in str(linkedin_url):
            clean_li = str(linkedin_url).strip().lower()
            m = re.search(r'linkedin\.com/in/([^/?#\s]+)', clean_li)
            if m:
                handle = m.group(1).rstrip('/')
                match = self.session.query(Persona).filter(
                    Persona.account_id == account_id,
                    Persona.linkedin_url.ilike(f"%linkedin.com/in/{handle}%")
                ).first()
                if match:
                    return match

        # 4. Key match (including base key without subsidiary suffix)
        if key and str(key).strip():
            k = str(key).strip()
            match = self.session.query(Persona).filter(
                Persona.account_id == account_id,
                Persona.key == k
            ).first()
            if match:
                return match
            
            # Check if key contains a subsidiary slug (e.g. "_harborwalk", "_talf", etc.)
            for delim in ["_harborwalk", "_talf", "_limited", "_fund", "_llc", "_inc", "_corp", "_owns_"]:
                if delim in k:
                    base_k = k.split(delim)[0]
                    if base_k:
                        match = self.session.query(Persona).filter(
                            Persona.account_id == account_id,
                            Persona.key == base_k
                        ).first()
                        if match:
                            return match

        # 5. Full Name match (exact & middle-initial normalized)
        if full_name and len(full_name.strip()) > 3 and "***" not in full_name:
            fn = full_name.strip()
            match = self.session.query(Persona).filter(
                Persona.account_id == account_id,
                Persona.full_name.ilike(fn)
            ).first()
            if match:
                return match

            # Middle-initial insensitive match (e.g. "Robert S. Kapito" <=> "Robert Kapito")
            words = [w for w in re.split(r'\s+', fn) if w]
            if len(words) >= 2:
                norm_fn = re.sub(r'\b[a-zA-Z]\.?\s+', ' ', fn).strip()
                norm_fn = ' '.join(norm_fn.split())
                tokens = norm_fn.split()
                if len(tokens) >= 2 and len(tokens[0]) >= 2 and len(tokens[-1]) >= 2:
                    first_t = tokens[0]
                    last_t = tokens[-1]
                    candidates = self.session.query(Persona).filter(
                        Persona.account_id == account_id,
                        Persona.full_name.ilike(f"{first_t}%{last_t}")
                    ).all()
                    for cand in candidates:
                        cand_norm = re.sub(r'\b[a-zA-Z]\.?\s+', ' ', cand.full_name or '').strip()
                        cand_norm = ' '.join(cand_norm.split())
                        if cand_norm.lower() == norm_fn.lower():
                            return cand

        # 6. First + Last name fuzzy/initial correlation
        if first_name and last_name:
            fn = first_name.strip().lower()
            ln = last_name.strip().replace(".", "").lower()
            candidates = self.session.query(Persona).filter(
                Persona.account_id == account_id,
                Persona.first_name.ilike(fn)
            ).all()
            for cand in candidates:
                cand_last = (cand.last_name or "").strip().replace(".", "").lower()
                if not cand_last:
                    continue
                # Initial or prefix match
                is_initial = (
                    (len(ln) <= 2 and cand_last.startswith(ln)) or
                    (len(cand_last) <= 2 and ln.startswith(cand_last)) or
                    (cand_last == ln)
                )
                is_title_match = bool(
                    title and cand.title and cand.title[:12].lower() == title[:12].lower()
                )
                if is_initial and (is_title_match or len(cand_last) > 2 or len(ln) > 2):
                    return cand

        return None

    def coalesce_into_master(
        self, master: Persona, incoming_data: Dict[str, Any], lob_id: Optional[int] = None
    ) -> Persona:
        """
        Lossless Non-Destructive Merger:
        Enriches the master persona with any non-null, non-empty data from the incoming record.
        Never overwrites valid existing values with nulls, empty values, or masked placeholders.
        """
        for field, val in incoming_data.items():
            if field in ("id", "account_id", "account", "lob"):
                continue
            if val is None or val == "" or val == [] or val == {}:
                continue

            current_val = getattr(master, field, None)
            
            # If master is missing this field, populate it
            if current_val is None or current_val == "" or current_val == [] or current_val == {}:
                if hasattr(master, field):
                    setattr(master, field, val)
                    if field in ("osint_feed_manifest", "extended_profile", "raw_data", "employment_history", "education_history", "target_kpis", "operational_pain_points", "key_objections", "skills", "past_companies", "previous_titles"):
                        from sqlalchemy.orm.attributes import flag_modified
                        flag_modified(master, field)
                continue

            # Special field rules
            if field == "is_manually_verified":
                if val is True:
                    master.is_manually_verified = True
                continue

            if field == "full_name":
                # Prefer unmasked full names over initials/asterisks
                if "***" in str(current_val) and "***" not in str(val):
                    master.full_name = val
                elif len(str(val)) > len(str(current_val)) and not str(val).endswith("."):
                    master.full_name = val
                continue

            if field == "last_name":
                # Upgrade initial (e.g. 'P.' or 'P') to full last name (e.g. 'Patrick')
                clean_curr = str(current_val).strip().replace(".", "")
                clean_val = str(val).strip().replace(".", "")
                if len(clean_curr) <= 2 and len(clean_val) > len(clean_curr):
                    master.last_name = val
                continue

            if field == "display_name":
                # Prefer display name with full name over initial
                if len(str(val)) > len(str(current_val)):
                    master.display_name = val
                continue

            if field == "email":
                # Prefer verified or full name email over initial/synthesized email
                incoming_status = incoming_data.get("email_status")
                master_status = getattr(master, "email_status", None)
                if incoming_status == "verified" and master_status != "verified":
                    master.email = val
                    master.email_status = "verified"
                elif (master_status in ("synthesized", "unverified", None) or "@" not in str(current_val)) and ("@" in str(val)):
                    master.email = val
                    if incoming_status:
                        master.email_status = incoming_status
                continue

            if field == "linkedin_url":
                # Prefer direct personal profiles (/in/) over generic search URLs
                if "/in/" in str(val) and "/in/" not in str(current_val):
                    master.linkedin_url = val
                continue

            if field == "title":
                # Prefer more detailed title if current is very short
                if len(str(val)) > len(str(current_val)) and "associate" not in str(val).lower():
                    master.title = val
                continue

            if field == "osint_feed_manifest":
                if val and isinstance(val, dict) and val.get("feeds"):
                    master.osint_feed_manifest = val
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(master, "osint_feed_manifest")
                continue

            if field == "extended_profile":
                if val and isinstance(val, dict):
                    master.extended_profile = val
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(master, "extended_profile")
                continue

            if field == "raw_data":
                if val and isinstance(val, dict):
                    master.raw_data = val
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(master, "raw_data")
                continue

            if field in (
                "degree", "institution", "headline", "value_proposition", "personalized_icebreaker",
                "tier", "seniority_raw", "city", "state", "country", "phone", "direct_mobile_phone",
                "personal_email", "sec_cik", "crunchbase_permalink", "crunchbase_url", "youtube_channel_id",
                "reddit_query", "news_query", "patents_query", "career_trajectory_score", "current_role_tenure_months",
                "prior_company"
            ):
                if val and (current_val is None or current_val == "" or len(str(val)) > len(str(current_val))):
                    setattr(master, field, val)
                continue

            if field in (
                "skills", "past_companies", "previous_titles", "target_kpis",
                "operational_pain_points", "key_objections"
            ):
                if val:
                    if isinstance(current_val, list) and isinstance(val, list):
                        # Additive non-destructive merge: preserve existing, append newly discovered unique items
                        merged_list = list(current_val)
                        for item in val:
                            if item and item not in merged_list:
                                merged_list.append(item)
                        setattr(master, field, merged_list)
                    else:
                        setattr(master, field, val or current_val)
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(master, field)
                continue

            if field in ("employment_history", "education_history"):
                if val:
                    if isinstance(current_val, list) and isinstance(val, list):
                        # Non-destructive merge of career records by company/institution/role
                        merged_records = list(current_val)
                        existing_keys = {
                            (str(r.get("company") or r.get("institution") or r.get("school") or r.get("title") or "")).strip().lower()
                            for r in current_val if isinstance(r, dict)
                        }
                        for r in val:
                            if isinstance(r, dict):
                                r_key = (str(r.get("company") or r.get("institution") or r.get("school") or r.get("title") or "")).strip().lower()
                                if r_key and r_key not in existing_keys:
                                    merged_records.append(r)
                                    existing_keys.add(r_key)
                            elif r not in merged_records:
                                merged_records.append(r)
                        setattr(master, field, merged_records)
                    else:
                        setattr(master, field, val or current_val)
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(master, field)
                continue

            if field.endswith("_url"):
                if val and (current_val is None or current_val == "" or "/search" in str(current_val) or "query=" in str(current_val) or len(str(val)) > len(str(current_val))):
                    setattr(master, field, val)
                continue

        if lob_id and not master.lob_id:
            master.lob_id = lob_id

        return master

    def upsert_lob_personas(
        self, account: Account, lob_id: int, hierarchy: Dict[str, List[dict]]
    ) -> int:
        """Appends personas belonging to a specific LOB with foreign key lob_id, resolving duplicates to master."""
        count = 0
        for tier_name in ["c_suite", "vp_level", "director_level", "manager_level"]:
            for person_data in (hierarchy.get(tier_name) or []):
                schema = PersonaSchema.from_enriched_json(person_data)
                data = schema.model_dump()
                
                # Check Deduplication Mapping Layer
                existing = self.resolve_existing_persona(
                    account_id=account.id,
                    external_id=schema.external_id or person_data.get("external_id") or person_data.get("id"),
                    key=schema.key or person_data.get("key"),
                    email=schema.email or person_data.get("email"),
                    full_name=schema.full_name or person_data.get("full_name") or person_data.get("name"),
                    first_name=schema.first_name or person_data.get("first_name"),
                    last_name=schema.last_name or person_data.get("last_name"),
                    title=schema.title or person_data.get("title"),
                    linkedin_url=schema.linkedin_url or person_data.get("linkedin_url"),
                )
                
                if existing:
                    self.coalesce_into_master(existing, data, lob_id=lob_id)
                    continue

                persona = Persona(account_id=account.id, lob_id=lob_id)
                for field, value in data.items():
                    if field in ("id", "account_id", "lob_id", "account", "lob") and value is None:
                        continue
                    if hasattr(persona, field):
                        setattr(persona, field, value)
                persona.account_id = account.id
                persona.lob_id = lob_id

                self.session.add(persona)
                count += 1

        self.session.flush()
        return count

    def upsert(self, schema: PersonaSchema) -> Persona:
        """Upsert a single Persona from PersonaSchema using Deduplication Mapping Layer."""
        existing = None
        if schema.id:
            existing = self.session.query(Persona).filter_by(id=schema.id).first()
        if not existing:
            existing = self.resolve_existing_persona(
                account_id=schema.account_id,
                external_id=schema.external_id,
                key=schema.key,
                email=schema.email,
                full_name=schema.full_name,
                first_name=schema.first_name,
                last_name=schema.last_name,
                title=schema.title,
                linkedin_url=schema.linkedin_url,
            )

        data = schema.model_dump()
        if existing:
            persona = self.coalesce_into_master(existing, data, lob_id=schema.lob_id)
        else:
            persona = Persona(account_id=schema.account_id)
            self.session.add(persona)
            for field, value in data.items():
                if field == "id" and value is None:
                    continue
                if field in ("account", "lob", "account_id", "lob_id"):
                    continue
                if hasattr(persona, field):
                    setattr(persona, field, value)
            if schema.account_id:
                persona.account_id = schema.account_id
            if schema.lob_id:
                persona.lob_id = schema.lob_id

        self.session.flush()
        return persona

    def get_by_account(self, account_id: int) -> list[Persona]:
        """Get all personas for an account."""
        return self.session.query(Persona).filter_by(account_id=account_id).all()

    def get_by_tier(self, account_id: int, tier: str) -> list[Persona]:
        """Get personas by tier for an account."""
        return self.session.query(Persona).filter_by(
            account_id=account_id, tier=tier
        ).all()

    def count(self) -> int:
        """Count total personas."""
        return self.session.query(Persona).count()

    @staticmethod
    def _build_tree_lookup(node: dict, lookup: dict):
        """Recursively indexes the hierarchy tree by full_name."""
        name = node.get("full_name")
        if name:
            lookup[name] = {
                "hierarchy_level": node.get("hierarchy_level"),
                "decision_authority": node.get("decision_authority"),
                "budget_authority": node.get("budget_authority"),
            }
        for child in (node.get("direct_reports") or []):
            PersonaRepository._build_tree_lookup(child, lookup)
        for child in (node.get("sub_lob_business_unit_leads") or []):
            PersonaRepository._build_tree_lookup(child, lookup)
