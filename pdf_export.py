"""Classy, executive-memo PDF generation for the Executive Personality Report.

Designed with a bespoke, monochrome/slate executive briefing aesthetic:
- Clean, unified Helvetica typography with proportional leading
- Refined section dividers and balanced whitespace
- High-contrast charcoal and slate text without loud colors
- Precise alignment and professional tabular/bullet formatting
"""
from datetime import datetime
from io import BytesIO
from typing import Any, Dict, List, Optional
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    ListFlowable,
    ListItem,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# ── Executive Monochrome / Slate Palette ──────────────────────
COLOR_PRIMARY = colors.HexColor("#111827")   # Deep Obsidian
COLOR_SECONDARY = colors.HexColor("#374151") # Charcoal
COLOR_BODY = colors.HexColor("#374151")      # Rich Text Body
COLOR_MUTED = colors.HexColor("#6B7280")     # Slate Gray
COLOR_LINE = colors.HexColor("#E5E7EB")      # Clean Hairline Divider
COLOR_LINE_DARK = colors.HexColor("#9CA3AF") # Section Divider
COLOR_BG_CARD = colors.HexColor("#F9FAFB")   # Subtle Background

EVIDENCE_SECTIONS = [
    ("leadership_character", "Leadership Character & Governance"),
    ("decision_making_style", "Strategic Decision-Making Framework"),
    ("values_and_motivation", "Core Values & Professional Motivators"),
    ("public_reputation", "Public Standing & Industry Reputation"),
]

_CHAR_MAP = {
    "‐": "-", "‑": "-", "‒": "-", "―": " - ", "—": " - ", "–": "-",
    "−": "-", "​": "", "﻿": "", "“": '"', "”": '"', "’": "'", "‘": "'",
    "&mdash;": " - ", "&bull;": " • ",
}


def _clean(text: str) -> str:
    for bad, good in _CHAR_MAP.items():
        if bad in text:
            text = text.replace(bad, good)
    return text


def _esc(text: Optional[str]) -> str:
    return escape(_clean(text or ""))


def _styles():
    ss = getSampleStyleSheet()

    # Document Header
    ss.add(ParagraphStyle(
        "Kicker",
        parent=ss["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=COLOR_MUTED,
        spaceAfter=4,
    ))
    ss.add(ParagraphStyle(
        "DocTitle",
        parent=ss["Title"],
        fontName="Helvetica-Bold",
        fontSize=16,
        leading=20,
        textColor=COLOR_PRIMARY,
        spaceAfter=3,
        alignment=TA_LEFT
    ))
    ss.add(ParagraphStyle(
        "DocSubtitle",
        parent=ss["Normal"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=13,
        textColor=COLOR_SECONDARY,
        spaceAfter=4
    ))
    ss.add(ParagraphStyle(
        "DocMetadata",
        parent=ss["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=11,
        textColor=COLOR_MUTED,
        spaceAfter=6
    ))

    # Section Headings
    ss.add(ParagraphStyle(
        "SectionHeader",
        parent=ss["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=14,
        textColor=COLOR_PRIMARY,
        spaceBefore=10,
        spaceAfter=4
    ))
    ss.add(ParagraphStyle(
        "SubSectionHeader",
        parent=ss["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=12,
        textColor=COLOR_PRIMARY,
        spaceBefore=6,
        spaceAfter=2
    ))

    # Text & Content (Unified 9pt / 13pt line-height)
    ss.add(ParagraphStyle(
        "ExecutiveSummary",
        parent=ss["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=13.5,
        textColor=COLOR_BODY,
        alignment=TA_LEFT
    ))
    ss.add(ParagraphStyle(
        "DocBodyText",
        parent=ss["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=13.5,
        textColor=COLOR_BODY,
        alignment=TA_LEFT,
        spaceAfter=4
    ))
    ss.add(ParagraphStyle(
        "BulletItem",
        parent=ss["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=13.5,
        textColor=COLOR_BODY,
        leftIndent=12,
        firstLineIndent=-12,
        spaceAfter=3
    ))
    ss.add(ParagraphStyle(
        "CitationItem",
        parent=ss["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=12,
        textColor=COLOR_MUTED,
        leftIndent=12,
        firstLineIndent=-12,
        spaceAfter=2
    ))

    return ss


def _header_footer(canvas, doc, persona_name: str, org_name: str):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(COLOR_MUTED)
    
    # Running Top Header (Pages 2+)
    if doc.page > 1:
        header_text = f"{persona_name}" + (f" | {org_name}" if org_name else "") + " - Executive Personality Report"
        canvas.drawString(20 * mm, A4[1] - 12 * mm, header_text)
        canvas.setStrokeColor(COLOR_LINE)
        canvas.setLineWidth(0.5)
        canvas.line(20 * mm, A4[1] - 14 * mm, A4[0] - 20 * mm, A4[1] - 14 * mm)

    # Running Bottom Footer
    canvas.drawString(20 * mm, 12 * mm, "CONFIDENTIAL - FOR INTERNAL SALES & STRATEGY USE ONLY")
    canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, f"Page {doc.page}")
    canvas.setStrokeColor(COLOR_LINE)
    canvas.setLineWidth(0.5)
    canvas.line(20 * mm, 15 * mm, A4[0] - 20 * mm, 15 * mm)
    canvas.restoreState()


def build_persona_profile_pdf(
    persona: Dict[str, Any],
    account: Optional[Dict[str, Any]],
    digest: Optional[Dict[str, Any]],
    posts: Optional[List[Dict[str, Any]]] = None,
    career_events: Optional[List[Dict[str, Any]]] = None,
) -> bytes:
    """Generates a refined, executive-grade PDF briefing document."""
    styles = _styles()
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        topMargin=18 * mm,
        bottomMargin=20 * mm,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        title=f"{persona.get('name', 'Executive')} - Executive Personality Report",
    )
    story: List[Any] = []

    p_name = persona.get("name") or "Executive Profile"
    acct_name = (account.get("name") or "") if account else ""
    p_title = persona.get("title") or "Executive"
    location = ", ".join(v for v in [persona.get("city"), persona.get("state"), persona.get("country")] if v)
    now_str = datetime.now().strftime("%B %d, %Y")

    # ── Document Header ─────────────────────────────────────────
    kicker_text = (acct_name.upper() + " • ") if acct_name else ""
    kicker_text += "EXECUTIVE INTELLIGENCE BRIEFING"
    story.append(Paragraph(_esc(kicker_text), styles["Kicker"]))

    story.append(Paragraph(_esc(p_name), styles["DocTitle"]))
    
    sub_title = p_title + (f" - {acct_name}" if acct_name else "")
    story.append(Paragraph(_esc(sub_title), styles["DocSubtitle"]))

    meta_parts = [f"Generated: {now_str}"]
    if location:
        meta_parts.append(f"Location: {location}")
    if persona.get("decision_authority"):
        meta_parts.append(f"Authority: {persona['decision_authority']}")
    story.append(Paragraph(" &nbsp;|&nbsp; ".join(_esc(m) for m in meta_parts), styles["DocMetadata"]))

    story.append(HRFlowable(width="100%", color=COLOR_PRIMARY, thickness=1, spaceAfter=8, spaceBefore=0))

    # ── Executive Summary ───────────────────────────────────────
    profile = (digest or {}).get("personality_profile") or {}
    exec_summary = profile.get("executive_summary") or (
        f"{p_name} is an established enterprise executive with extensive experience driving strategic "
        f"growth, operational rigor, and modernization across complex institutional environments. "
        "Their leadership demonstrates structured governance and a proven track record navigating regulated markets."
    )

    summary_box = Table(
        [[
            Paragraph(f"<b>Executive Overview:</b> {_esc(exec_summary)}", styles["ExecutiveSummary"])
        ]],
        colWidths=[170 * mm]
    )
    summary_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), COLOR_BG_CARD),
        ("BOX", (0, 0), (-1, -1), 0.5, COLOR_LINE),
        ("LINEBEFORE", (0, 0), (0, -1), 2.5, COLOR_PRIMARY),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
    ]))
    story.append(summary_box)
    story.append(Spacer(1, 6))

    # ── Personality & Leadership Dimensions ─────────────────────
    story.append(Paragraph("Leadership & Behavioral Dimensions", styles["SectionHeader"]))
    story.append(HRFlowable(width="100%", color=COLOR_LINE_DARK, thickness=0.5, spaceAfter=6, spaceBefore=0))

    exec_profile = profile.get("executive_profile") or {}
    default_sections = {
        "leadership_character": {
            "title": "Leadership Character & Governance",
            "summary": "Demonstrates disciplined, execution-focused leadership. Fosters organizational alignment, celebrates cross-functional achievements, and empowers teams across large-scale transformations.",
        },
        "decision_making_style": {
            "title": "Strategic Decision-Making Framework",
            "summary": "Pragmatic and systems-oriented. Evaluates vendor partnerships through the lens of institutional scalability, regulatory robustness, and verifiable client impact.",
        },
        "values_and_motivation": {
            "title": "Core Values & Professional Motivators",
            "summary": "Motivators center on long-term institutional stability, customer outcomes, and building high-performing organizations rather than short-term disruption.",
        },
        "public_reputation": {
            "title": "Public Standing & Industry Reputation",
            "summary": "Maintains a respected public presence characterized by measured commentary, industry leadership, and positive stakeholder engagement.",
        }
    }

    for key, title in EVIDENCE_SECTIONS:
        sec = exec_profile.get(key) or default_sections.get(key)
        if not sec:
            continue

        story.append(Paragraph(_esc(title), styles["SubSectionHeader"]))

        if sec.get("summary"):
            story.append(Paragraph(_esc(sec["summary"]), styles["DocBodyText"]))

        basis = sec.get("basis") or []
        if basis:
            for b in basis:
                pt = _esc(b.get("point") or "")
                u = b.get("source_url")
                if u and u != "bio":
                    txt = f"<font color='{COLOR_MUTED.hexval()}'>•</font> {pt} - <u>Source</u>"
                else:
                    txt = f"<font color='{COLOR_MUTED.hexval()}'>•</font> {pt} - <i>from biographical record</i>" if u == "bio" else f"<font color='{COLOR_MUTED.hexval()}'>•</font> {pt}"
                story.append(Paragraph(txt, styles["CitationItem"]))

        story.append(Spacer(1, 4))

    # ── Executive Engagement & Meeting Strategy ─────────────────
    comm_style = persona.get("communication_style") or "Strategic, executive-level, ROI & shareholder-value oriented"
    story.append(Spacer(1, 4))
    story.append(Paragraph("Executive Engagement Strategy", styles["SectionHeader"]))
    story.append(HRFlowable(width="100%", color=COLOR_LINE_DARK, thickness=0.5, spaceAfter=6, spaceBefore=0))

    playbook_items = [
        f"<b>Structural Clarity:</b> Lead with concrete ROI, scalable architecture, and measurable business outcomes.",
        f"<b>Executive Tone:</b> {_esc(comm_style)}. Focus on enterprise impact rather than raw technical jargon.",
        f"<b>Stakeholder Alignment:</b> Highlight how the solution enhances operational efficiency and empowers key teams."
    ]
    for item in playbook_items:
        story.append(Paragraph(f"<font color='{COLOR_MUTED.hexval()}'>•</font> {item}", styles["BulletItem"]))

    # ── Observation Caveats ─────────────────────────────────────
    caveats = profile.get("caveats") or []
    if caveats:
        story.append(Spacer(1, 4))
        story.append(Paragraph("Observation Caveats & Data Notes", styles["SubSectionHeader"]))
        for c in caveats:
            story.append(Paragraph(f"<font color='{COLOR_MUTED.hexval()}'>•</font> {_esc(c)}", styles["CitationItem"]))

    def _on_page(canvas, doc_):
        _header_footer(canvas, doc_, p_name, acct_name)

    doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
    return buf.getvalue()
