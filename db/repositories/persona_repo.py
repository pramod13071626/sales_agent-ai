"""Persona Repository — UPSERT operations for the personas table."""

import re
from typing import Dict, List, Optional, Any
from sqlalchemy.orm import Session
from db.models.persona import Persona
from db.models.account import Account
from db.schemas.persona_schema import PersonaSchema


class PersonaRepository:
    """Handles all database operations for the Persona table."""

    def __init__(self, session: Session):
        self.session = session

    def upsert_all(self, account: Account, hierarchy: Dict[str, List[dict]],
                   tree_root: Optional[dict] = None):
        """Replaces all personas for an account from the 4-tier hierarchy."""
        # Clear existing personas
        self.session.query(Persona).filter_by(account_id=account.id).delete()
        self.session.flush()

        # Build tree lookup for hierarchy metadata
        tree_lookup = {}
        if tree_root:
            self._build_tree_lookup(tree_root, tree_lookup)

        count = 0
        for tier_name in ["c_suite", "vp_level", "director_level", "manager_level"]:
            for person_data in (hierarchy.get(tier_name) or []):
                tree_info = tree_lookup.get(person_data.get("name"), {})

                # Validate through schema
                schema = PersonaSchema.from_enriched_json(person_data, tree_info)

                # Create ORM object
                persona = Persona(account_id=account.id, lob_id=None)
                data = schema.model_dump()
                for field, value in data.items():
                    if field in ("id", "account_id", "lob_id", "account", "lob") and value is None:
                        continue
                    if hasattr(persona, field):
                        setattr(persona, field, value)
                persona.account_id = account.id

                self.session.add(persona)
                count += 1

        self.session.flush()
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
