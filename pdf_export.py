"""Server-side PDF generation for a contact's full profile — the
"Download PDF" button in the contact drawer / full-page profile view.

Built with ReportLab (Platypus flowables) rather than a client-side
screenshot capture: real selectable text, proper multi-page pagination, and
free to include more than whatever happens to be rendered on screen (e.g.
career history from cxo_movements, and every captured post, not a preview
slice).
"""
from datetime import datetime
from io import BytesIO
from typing import Any, Dict, List, Optional
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

BRAND = colors.HexColor("#0061FF")
MUTED = colors.HexColor("#6B7280")
BORDER = colors.HexColor("#E5E7EB")

_STRENGTH_COLOR = {
    "strong": colors.HexColor("#0F9D58"),
    "moderate": colors.HexColor("#B7791F"),
    "weak": colors.HexColor("#B91C1C"),
}

EVIDENCE_SECTIONS = [
    ("leadership_character", "Leadership Character"),
    ("decision_making_style", "Decision-Making Style"),
    ("values_and_motivation", "Values and Motivation"),
    ("public_reputation", "Public Reputation"),
]


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle("ProfileTitle", parent=ss["Title"], fontSize=20, textColor=colors.HexColor("#1A1D23"), spaceAfter=2))
    ss.add(ParagraphStyle("ProfileSubtitle", parent=ss["Normal"], fontSize=11, textColor=MUTED, spaceAfter=10))
    ss.add(ParagraphStyle("SectionHeading", parent=ss["Heading2"], fontSize=13, textColor=BRAND, spaceBefore=16, spaceAfter=6))
    ss.add(ParagraphStyle("SubHeading", parent=ss["Heading3"], fontSize=10.5, textColor=colors.HexColor("#1A1D23"), spaceBefore=8, spaceAfter=3))
    ss.add(ParagraphStyle("Body", parent=ss["Normal"], fontSize=9.5, leading=14, alignment=TA_LEFT))
    ss.add(ParagraphStyle("Meta", parent=ss["Normal"], fontSize=8.5, textColor=MUTED, leading=12))
    ss.add(ParagraphStyle("Quote", parent=ss["Normal"], fontSize=9.5, leading=14, textColor=colors.HexColor("#374151"), leftIndent=10))
    ss.add(ParagraphStyle("Citation", parent=ss["Normal"], fontSize=8, textColor=MUTED, leading=11))
    ss.add(ParagraphStyle("Footer", parent=ss["Normal"], fontSize=7.5, textColor=MUTED))
    return ss


# reportlab's base-14 fonts (Helvetica) only cover WinAnsi/Latin-1 — a few
# punctuation marks LLM output favors (non-breaking hyphen, minus sign, ...)
# fall outside that and render as a missing-glyph box otherwise.
_CHAR_MAP = {
    "‐": "-", "‑": "-", "‒": "-", "―": "—",
    "−": "-", "​": "", "﻿": "",
}


def _clean(text: str) -> str:
    for bad, good in _CHAR_MAP.items():
        if bad in text:
            text = text.replace(bad, good)
    return text


def _esc(text: Optional[str]) -> str:
    return escape(_clean(text or ""))


def _p(text: Optional[str], style) -> Paragraph:
    return Paragraph(_esc(text), style)


def _basis_list(basis: List[Dict[str, Any]], styles) -> Optional[ListFlowable]:
    if not basis:
        return None
    items = []
    for b in basis:
        point = _esc(b.get("point") or "")
        url = b.get("source_url")
        if url and url != "bio":
            text = f'{point} &mdash; <link href="{_esc(url)}" color="#0061FF">source</link>'
        else:
            text = f"{point} &mdash; <i>from biographical record</i>" if url == "bio" else point
        items.append(ListItem(Paragraph(text, styles["Citation"]), leftIndent=6, spaceAfter=2))
    return ListFlowable(items, bulletType="bullet", start="circle", leftIndent=12)


def _evidence_badge(strength: Optional[str]) -> str:
    if not strength:
        return ""
    color = _STRENGTH_COLOR.get(strength, MUTED)
    return f'&nbsp;&nbsp;<font color="{color.hexval()}"><b>[{_esc(strength).upper()} EVIDENCE]</b></font>'


def _header_footer(canvas, doc, persona_name: str):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(20 * mm, 12 * mm, f"{persona_name} — AI-synthesized profile, not a verified assessment")
    canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build_persona_profile_pdf(
    persona: Dict[str, Any],
    account: Optional[Dict[str, Any]],
    digest: Optional[Dict[str, Any]],
    posts: List[Dict[str, Any]],
    career_events: List[Dict[str, Any]],
) -> bytes:
    """Returns PDF bytes for one persona's full profile.

    `digest` is the raw `digests.digest` JSONB (channels/personality_profile),
    or None if this contact has no digest yet. `posts` is every captured post
    for this persona's target_key, unsliced. `career_events` come from
    cxo_movements, newest first.
    """
    styles = _styles()
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=18 * mm, bottomMargin=18 * mm, leftMargin=20 * mm, rightMargin=20 * mm,
        title=f"{persona.get('name', 'Contact')} — Profile",
    )
    story: List[Any] = []

    # ── Header ──────────────────────────────────────────────
    story.append(_p(persona.get("name") or "Unnamed Contact", styles["ProfileTitle"]))
    subtitle_bits = [persona.get("title"), account.get("name") if account else None]
    story.append(_p(" — ".join(b for b in subtitle_bits if b), styles["ProfileSubtitle"]))
    story.append(HRFlowable(width="100%", color=BORDER, thickness=1))
    story.append(Spacer(1, 10))

    # ── Contact Info ────────────────────────────────────────
    contact_rows = []
    for label, val in [
        ("Email", persona.get("email")), ("Phone", persona.get("phone")),
        ("LinkedIn", persona.get("linkedin_url")),
        ("Location", ", ".join(v for v in [persona.get("city"), persona.get("state"), persona.get("country")] if v)),
        ("Decision authority", persona.get("decision_authority")),
        ("Budget authority", persona.get("budget_authority")),
        ("Seniority", persona.get("seniority_raw")),
    ]:
        if val:
            contact_rows.append([Paragraph(f"<b>{_esc(label)}</b>", styles["Meta"]), _p(str(val), styles["Body"])])
    if contact_rows:
        story.append(_p("Contact Info", styles["SectionHeading"]))
        t = Table(contact_rows, colWidths=[35 * mm, None])
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
        ]))
        story.append(t)

    if persona.get("skills"):
        story.append(_p("Skills & Focus Areas", styles["SubHeading"]))
        story.append(_p(" • ".join(persona["skills"]), styles["Body"]))

    # ── Career History (cxo_movements) — not shown on-screen anywhere ──
    if career_events:
        story.append(_p("Career History", styles["SectionHeading"]))
        for ev in career_events:
            bits = [ev.get("effective_date"), (ev.get("event_type") or "").upper(), ev.get("designation")]
            headline = " — ".join(b for b in bits if b)
            story.append(_p(headline, styles["SubHeading"]))
            if ev.get("previous_role"):
                story.append(_p(f"Previously: {ev['previous_role']}", styles["Meta"]))
            if ev.get("context"):
                story.append(_p(ev["context"], styles["Body"]))
            story.append(Spacer(1, 4))

    # ── AI Call-Prep Dossier ────────────────────────────────
    has_dossier = any(persona.get(k) for k in (
        "personalized_icebreaker", "value_proposition", "communication_style",
        "target_kpis", "operational_pain_points", "key_objections"
    ))
    if has_dossier:
        story.append(_p("AI Call-Prep Dossier", styles["SectionHeading"]))
        if persona.get("personalized_icebreaker"):
            story.append(_p(f"“{persona['personalized_icebreaker']}”", styles["Quote"]))
            story.append(Spacer(1, 4))
        if persona.get("value_proposition"):
            story.append(_p("Value Proposition", styles["SubHeading"]))
            story.append(_p(persona["value_proposition"], styles["Body"]))
        if persona.get("communication_style"):
            story.append(_p("Communication Style", styles["SubHeading"]))
            story.append(_p(persona["communication_style"], styles["Body"]))
        for label, key in [("Target KPIs", "target_kpis"), ("Operational Pain Points", "operational_pain_points"), ("Likely Objections", "key_objections")]:
            if persona.get(key):
                story.append(_p(label, styles["SubHeading"]))
                story.append(ListFlowable(
                    [ListItem(_p(item, styles["Body"]), leftIndent=6) for item in persona[key]],
                    bulletType="bullet", leftIndent=12,
                ))

    # ── Personality Profile ─────────────────────────────────
    profile = (digest or {}).get("personality_profile")
    story.append(PageBreak())
    story.append(_p("Personality Profile", styles["SectionHeading"]))
    story.append(_p(
        "AI-synthesized from public posts, filings, and career history — hedged and cited, not a verified psychological assessment.",
        styles["Meta"],
    ))
    story.append(Spacer(1, 6))
    if not profile:
        story.append(_p("Not available — no digest with a Personality Profile has been generated yet for this contact.", styles["Body"]))
    else:
        if profile.get("executive_summary"):
            story.append(_p("Executive Summary", styles["SubHeading"]))
            story.append(_p(profile["executive_summary"], styles["Body"]))
            story.append(Spacer(1, 6))
        exec_profile = profile.get("executive_profile") or {}
        for key, title in EVIDENCE_SECTIONS:
            section = exec_profile.get(key)
            if not section or not (section.get("summary") or section.get("basis")):
                continue
            badge = _evidence_badge(section.get("evidence_strength"))
            story.append(Paragraph(f"{_esc(title)}{badge}", styles["SubHeading"]))
            if section.get("summary"):
                story.append(_p(section["summary"], styles["Body"]))
            basis_list = _basis_list(section.get("basis") or [], styles)
            if basis_list:
                story.append(basis_list)
            story.append(Spacer(1, 4))
        if profile.get("caveats"):
            story.append(_p("Caveats", styles["SubHeading"]))
            story.append(ListFlowable(
                [ListItem(_p(c, styles["Body"]), leftIndent=6) for c in profile["caveats"]],
                bulletType="bullet", leftIndent=12,
            ))

    # ── Recent Social Media Activity ────────────────────────
    channels = (digest or {}).get("channels") or []
    story.append(PageBreak())
    story.append(_p("Recent Social Media Activity", styles["SectionHeading"]))
    if channels:
        for ch in channels:
            badge = _evidence_badge(ch.get("evidence_strength"))
            label = ch.get("channel_label") or ch.get("channel") or "Channel"
            story.append(Paragraph(f"{_esc(label)}{badge}", styles["SubHeading"]))
            if ch.get("summary"):
                story.append(_p(ch["summary"], styles["Body"]))
            if ch.get("themes"):
                story.append(_p("Themes: " + ", ".join(ch["themes"]), styles["Meta"]))
            story.append(Spacer(1, 4))
    else:
        story.append(_p("No AI channel digest available yet for this contact.", styles["Body"]))

    # ── Full post log — every captured post, not a preview slice ───
    if posts:
        story.append(Spacer(1, 8))
        story.append(_p(f"All Captured Posts ({len(posts)})", styles["SubHeading"]))
        rows = [[Paragraph("<b>Channel</b>", styles["Meta"]), Paragraph("<b>Date</b>", styles["Meta"]), Paragraph("<b>Content</b>", styles["Meta"])]]
        for post in posts:
            snippet = (post.get("body") or "")[:220]
            url = post.get("post_url")
            cell = _esc(snippet)
            if url:
                cell += f' &mdash; <link href="{_esc(url)}" color="#0061FF">open</link>'
            rows.append([
                Paragraph(_esc(post.get("channel") or ""), styles["Citation"]),
                Paragraph(_esc((post.get("published_at") or "")[:16]), styles["Citation"]),
                Paragraph(cell, styles["Citation"]),
            ])
        t = Table(rows, colWidths=[22 * mm, 24 * mm, None], repeatRows=1)
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F3F4F6")),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(t)

    def _on_page(canvas, doc_):
        _header_footer(canvas, doc_, persona.get("name") or "Contact")

    doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
    return buf.getvalue()
