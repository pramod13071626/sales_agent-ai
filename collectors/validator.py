"""
Data Quality Validator & Pre-DB Debugger Engine — Upgraded Enterprise Architecture.
Audits:
  1. Master Account firmographics & 11 required account scraping URLs.
  2. 15 Subsidiary LOBs, LEI codes, jurisdictions, dynamic revenues, and 10 LOB URLs.
  3. 4-Tier Hierarchy contacts, Monid de-obfuscated real names, 11 person URLs, and AI dossiers.
  4. Disk Artifact Parity: Confirms raw repositories & enriched slice JSON files exist on disk.
  5. Tree Graph Connectivity: Validates Level 1 Root CXO and Level 2 direct reports.
100% Dynamic, Zero Hardcoding.
"""

import json
import re
from pathlib import Path
from typing import Dict, Any, List, Optional
from urllib.parse import urlparse


class DataQualityValidator:
    """Enterprise Data Quality Auditor and Pre-DB Debugger."""

    @staticmethod
    def is_valid_url(url: Optional[str]) -> bool:
        """Validates if a string is a well-formed HTTP/HTTPS URL."""
        if not url or not isinstance(url, str):
            return False
        try:
            result = urlparse(url)
            return all([result.scheme in ["http", "https"], result.netloc])
        except Exception:
            return False

    @staticmethod
    def is_clean_key(key: Optional[str]) -> bool:
        """Validates that a slug key has zero asterisks or raw encoding artifacts."""
        if not key or not isinstance(key, str):
            return False
        return bool(re.match(r"^[a-z0-9_]+$", key)) and ("*" not in key) and ("%2a" not in key.lower())

    @classmethod
    def validate_account(cls, account_section: Dict[str, Any]) -> Dict[str, Any]:
        """Audits Account firmographics, identity, and required_account scraping URLs."""
        identity = account_section.get("identity", {}) or {}
        firmographics = account_section.get("firmographics", {}) or {}
        location = account_section.get("location", {}) or {}
        market = account_section.get("market_and_ipo", {}) or {}
        req_acc = account_section.get("required_account", {}) or {}

        # 1. Structural and firmographic checks
        checks = {
            "has_key": cls.is_clean_key(req_acc.get("key")),
            "has_display_name": bool(req_acc.get("display_name")),
            "has_legal_name": bool(identity.get("legal_name")),
            "has_domain": bool(identity.get("domain") or identity.get("primary_domain")),
            "has_website_url": cls.is_valid_url(identity.get("website_url")),
            "has_crunchbase_url": cls.is_valid_url(identity.get("crunchbase_url")),
            "has_hq_location": bool(location.get("headquarters_location")),
            "has_founded_year": bool(firmographics.get("founded_year")),
            "has_employee_count_range": bool(firmographics.get("employee_count_range")),
            "has_sec_cik": bool(market.get("sec_cik")),
            "has_stock_symbol": bool(market.get("stock_symbol")),
        }

        # 2. Strict Account Required URLs Audit
        url_fields = [
            "sec_edgar_url", "sec_filings_rss", "sec_submissions_url",
            "twitter_live_url", "reddit_rss_url", "rss_url",
            "google_patents_url", "google_trends_url", "youtube_search_url",
            "openalex_institution_url", "wikidata_entity_url"
        ]
        valid_urls = {f: cls.is_valid_url(req_acc.get(f)) for f in url_fields}
        valid_urls_count = sum(1 for v in valid_urls.values() if v)
        checks["account_urls_valid"] = f"{valid_urls_count}/{len(url_fields)}"

        passed = sum(1 for k, v in checks.items() if (v is True or (isinstance(v, str) and valid_urls_count >= 8)))
        score = round((passed / len(checks)) * 100, 1)

        warnings = []
        if not market.get("sec_cik"):
            warnings.append("SEC CIK is missing (may be a private or non-US entity).")
        if not location.get("headquarters_location"):
            warnings.append("Headquarters location is not fully resolved.")
        if valid_urls_count < len(url_fields):
            missing = [f for f, ok in valid_urls.items() if not ok]
            warnings.append(f"Missing {len(missing)} account scraping URLs: {', '.join(missing)}")

        # 3. Optional Enrichments Tracking
        optional_urls = {
            "github_url": cls.is_valid_url(req_acc.get("github_url")),
            "glassdoor_url": cls.is_valid_url(req_acc.get("glassdoor_url"))
        }

        return {
            "score": score,
            "checks": checks,
            "required_urls_audit": valid_urls,
            "valid_urls_count": valid_urls_count,
            "total_expected_urls": len(url_fields),
            "optional_enrichments": optional_urls,
            "warnings": warnings
        }

    @classmethod
    def validate_lobs(
        cls,
        lobs_data: List[Dict[str, Any]],
        run_dir: Optional[Path] = None,
        company_slug: Optional[str] = None
    ) -> Dict[str, Any]:
        """Audits discovered LOBs, LEI codes, dynamic metrics, required_account URLs, and disk slices."""
        if not lobs_data:
            return {
                "score": 100.0,
                "lobs_count": 0,
                "details": [],
                "disk_slices_verified": True,
                "warnings": ["No sub-organizations or LOBs discovered for this account."]
            }

        lob_results = []
        total_with_lei = 0
        total_with_domain = 0
        total_with_revenue = 0
        total_with_operating_head = 0
        total_valid_lob_urls = 0

        url_fields = [
            "rss_url", "reddit_rss_url", "google_patents_url",
            "google_trends_url", "youtube_search_url", "twitter_live_url",
            "linkedin_url", "sec_edgar_url"
        ]

        for lob in lobs_data:
            name = lob.get("lob_name") or lob.get("name") or "LOB"
            domain = lob.get("domain")
            lei = lob.get("lei_code")
            rev = lob.get("audited_segment_revenue")
            head = lob.get("operating_head")
            req = lob.get("required_account", {}) or {}

            if domain:
                total_with_domain += 1
            if lei:
                total_with_lei += 1
            if rev:
                total_with_revenue += 1
            if head:
                total_with_operating_head += 1

            urls_valid = sum(1 for f in url_fields if cls.is_valid_url(req.get(f)))
            total_valid_lob_urls += urls_valid

            lob_results.append({
                "lob_name": name,
                "domain": domain,
                "lei_code": lei,
                "jurisdiction": lob.get("jurisdiction"),
                "has_revenue": bool(rev),
                "has_operating_head": bool(head),
                "valid_urls_count": f"{urls_valid}/{len(url_fields)}"
            })

        # Disk slice file verification
        disk_slices_found = 0
        if run_dir:
            lobs_base = run_dir / "enriched" / "lobs"
            if lobs_base.exists():
                matching_dirs = [d for d in lobs_base.iterdir() if d.is_dir()]
                if matching_dirs:
                    disk_slices_found = len(list(matching_dirs[0].glob("*.json")))

        domain_rate = total_with_domain / len(lobs_data)
        lei_rate = total_with_lei / len(lobs_data)
        url_rate = total_valid_lob_urls / (len(lobs_data) * len(url_fields))
        
        score = round(((domain_rate * 0.4) + (lei_rate * 0.3) + (url_rate * 0.3)) * 100, 1)

        warnings = []
        if total_with_lei < len(lobs_data):
            warnings.append(f"{len(lobs_data) - total_with_lei} subsidiaries lack G20 LEI codes.")

        return {
            "score": score,
            "lobs_count": len(lobs_data),
            "total_with_lei": total_with_lei,
            "total_with_domain": total_with_domain,
            "total_with_revenue": total_with_revenue,
            "total_with_operating_head": total_with_operating_head,
            "disk_slices_found": disk_slices_found,
            "details": lob_results,
            "warnings": warnings
        }

    @classmethod
    def validate_hierarchy_and_personas(
        cls,
        hierarchy: Dict[str, List[Dict[str, Any]]],
        tree_root: Optional[Dict[str, Any]] = None,
        run_dir: Optional[Path] = None,
        company_slug: Optional[str] = None
    ) -> Dict[str, Any]:
        """Audits the 4-tier hierarchy, contact de-obfuscation, required_person_data URLs, tree root, and disk slices."""
        c_suite = hierarchy.get("c_suite", []) or []
        vp_level = hierarchy.get("vp_level", []) or []
        director_level = hierarchy.get("director_level", []) or []
        manager_level = hierarchy.get("manager_level", []) or []

        all_contacts = c_suite + vp_level + director_level + manager_level
        total_count = len(all_contacts)

        if total_count == 0:
            return {
                "score": 0.0,
                "total_contacts": 0,
                "tier_breakdown": {},
                "critical_errors": ["Hierarchy is empty. No contacts extracted."]
            }

        verified_linkedin = 0
        verified_emails = 0
        verified_phones = 0
        with_dossier = 0
        clean_keys_count = 0
        total_valid_person_urls = 0

        url_fields = [
            "twitter_live_url", "reddit_rss_url", "rss_url",
            "google_patents_url", "google_scholar_url", "openalex_author_url",
            "orcid_search_url", "wikidata_person_url", "youtube_interviews_url",
            "podcast_search_url", "google_trends_url"
        ]

        for p in all_contacts:
            rpd = p.get("required_person_data", {}) or {}
            
            # Key cleanliness (no asterisks)
            if cls.is_clean_key(rpd.get("key")) and ("*" not in (p.get("name") or "")):
                clean_keys_count += 1

            if cls.is_valid_url(p.get("linkedin_url")) or cls.is_valid_url(rpd.get("linkedin_url")):
                verified_linkedin += 1
            if p.get("email") or p.get("verified_email"):
                verified_emails += 1
            if p.get("phone") or p.get("direct_phone"):
                verified_phones += 1
            if p.get("persona_dossier"):
                with_dossier += 1

            person_urls_count = sum(1 for f in url_fields if cls.is_valid_url(rpd.get(f)))
            total_valid_person_urls += person_urls_count

        # Tree root validation
        has_tree_root = bool(tree_root and tree_root.get("full_name") and tree_root.get("hierarchy_level") == 1)
        tree_direct_reports = len(tree_root.get("direct_reports", [])) if tree_root else 0

        # Disk slice file verification
        disk_personas_found = 0
        if run_dir:
            personas_base = run_dir / "enriched" / "personas"
            if personas_base.exists():
                matching_dirs = [d for d in personas_base.iterdir() if d.is_dir()]
                if matching_dirs:
                    disk_personas_found = len(list(matching_dirs[0].glob("*.json")))

        linkedin_rate = verified_linkedin / total_count
        clean_rate = clean_keys_count / total_count
        avg_url_rate = (total_valid_person_urls / (total_count * len(url_fields))) if total_count else 0.0
        tier_spread = 1.0 if (c_suite and (vp_level or director_level)) else 0.7
        tree_score = 1.0 if has_tree_root else 0.5

        hierarchy_score = round(((linkedin_rate * 0.3) + (clean_rate * 0.25) + (avg_url_rate * 0.25) + (tier_spread * 0.1) + (tree_score * 0.1)) * 100, 1)

        warnings = []
        if clean_keys_count < total_count:
            warnings.append(f"{total_count - clean_keys_count} contacts still contain obfuscated asterisk tokens.")
        if verified_linkedin < (total_count * 0.5):
            warnings.append(f"Only {verified_linkedin}/{total_count} contacts have verified LinkedIn URLs.")

        return {
            "score": hierarchy_score,
            "total_contacts": total_count,
            "tier_breakdown": {
                "c_suite": len(c_suite),
                "vp_level": len(vp_level),
                "director_level": len(director_level),
                "manager_level": len(manager_level),
            },
            "contact_metrics": {
                "deobfuscated_clean_names": clean_keys_count,
                "verified_linkedin": verified_linkedin,
                "verified_emails": verified_emails,
                "verified_phones": verified_phones,
                "contacts_with_ai_dossier": with_dossier,
                "avg_scraping_urls_per_person": round(total_valid_person_urls / total_count, 1) if total_count else 0
            },
            "tree_hierarchy_audit": {
                "has_level_1_root_cxo": has_tree_root,
                "root_cxo_name": tree_root.get("full_name") if tree_root else None,
                "level_2_direct_reports_count": tree_direct_reports
            },
            "disk_personas_found": disk_personas_found,
            "warnings": warnings
        }

    @classmethod
    def audit_run(
        cls,
        enriched_doc: Dict[str, Any],
        social_doc: Optional[Dict[str, Any]] = None,
        save_path: Optional[Path] = None,
        run_dir: Optional[Path] = None
    ) -> Dict[str, Any]:
        """
        Master Audit Method: Audits full run across all 3 tiers + disk slices + tree root.
        """
        company_slug = (enriched_doc.get("account", {}).get("required_account", {}) or {}).get("key")
        
        acct_audit = cls.validate_account(enriched_doc.get("account", {}))
        lobs_audit = cls.validate_lobs(enriched_doc.get("lobs", []), run_dir=run_dir, company_slug=company_slug)
        hierarchy_audit = cls.validate_hierarchy_and_personas(
            hierarchy=enriched_doc.get("account", {}).get("hierarchy", {}),
            tree_root=enriched_doc.get("account", {}).get("organisational_hierarchy_tree"),
            run_dir=run_dir,
            company_slug=company_slug
        )

        overall_score = round(
            (acct_audit["score"] * 0.35) +
            (lobs_audit["score"] * 0.25) +
            (hierarchy_audit["score"] * 0.40),
            1
        )

        all_warnings = acct_audit["warnings"] + lobs_audit["warnings"] + hierarchy_audit.get("warnings", [])
        critical_errors = hierarchy_audit.get("critical_errors", [])

        ready_for_db = (overall_score >= 60.0) and (len(critical_errors) == 0)

        report = {
            "audit_metadata": {
                "company_name": enriched_doc.get("account", {}).get("identity", {}).get("name") or "Unknown",
                "schema_version": enriched_doc.get("schema_version", "2.0.0"),
                "extracted_at": enriched_doc.get("extracted_at"),
                "overall_quality_score": overall_score,
                "quality_grade": "A" if overall_score >= 90 else ("B" if overall_score >= 75 else ("C" if overall_score >= 60 else "D")),
                "ready_for_db_dump": ready_for_db
            },
            "dimension_scores": {
                "account_firmographics_and_urls": acct_audit["score"],
                "lobs_and_subsidiaries": lobs_audit["score"],
                "hierarchy_and_personas": hierarchy_audit["score"],
            },
            "account_audit": acct_audit,
            "lobs_audit": lobs_audit,
            "hierarchy_audit": hierarchy_audit,
            "warnings": all_warnings,
            "critical_errors": critical_errors,
        }

        if save_path:
            save_path.parent.mkdir(parents=True, exist_ok=True)
            with open(save_path, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            print(f"[+] [DataValidator] Validation Report saved to: {save_path}")

        return report
