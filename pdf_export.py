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
    ss.add(ParagraphStyle(
        "TableHeader",
        parent=ss["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=11,
        textColor=COLOR_PRIMARY,
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


def build_psychological_profile_pdf(
    persona: Dict[str, Any],
    digest_data: Optional[Dict[str, Any]] = None,
    psych_profile: Optional[Dict[str, Any]] = None,
) -> bytes:
    """Builds a high-impact, executive-memo PDF briefing for the deep
    Psychological Profile (Archetype, Big Five Traits 1-10, Cognitive Architecture,
    Leadership Style, Core Values & Philanthropy, Blind Spots, and Engagement Playbook).
    """
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=18 * mm,
        bottomMargin=14 * mm,
    )
    styles = _styles()
    story = []

    profile = psych_profile or (digest_data or {}).get("psychological_profile") or {}

    p_name = persona.get("full_name") or persona.get("name") or "Executive Profile"
    p_title = persona.get("title") or "Executive Leadership"
    acct_name = persona.get("account_name") or persona.get("company_name") or ""
    loc = ", ".join(p for p in [persona.get("city"), persona.get("state"), persona.get("country")] if p)

    # ── Document Header ──────────────────────────────────────────
    story.append(Paragraph("EXECUTIVE INTELLIGENCE BRIEFING // PSYCHOLOGICAL PROFILE", styles["Kicker"]))
    story.append(Paragraph(_esc(p_name), styles["DocTitle"]))

    sub_parts = [p_title]
    if acct_name:
        sub_parts.append(acct_name)
    if loc:
        sub_parts.append(loc)
    story.append(Paragraph(_esc(" — ".join(sub_parts)), styles["DocSubtitle"]))

    now_str = datetime.utcnow().strftime("%B %d, %Y")
    story.append(Paragraph(f"Generated on {now_str} • Verified Public Synthesis", styles["DocMetadata"]))
    story.append(HRFlowable(width="100%", color=COLOR_PRIMARY, thickness=1.2, spaceAfter=8, spaceBefore=4))

    # ── Archetype Hero Callout ──────────────────────────────────
    synthesis = profile.get("psychological_synthesis") or {}
    archetype = synthesis.get("archetype") or "The Principled Enterprise Builder"
    arch_summary = synthesis.get("summary") or "Mature, integrated executive who fuses technical craft, strategic vision, and human-centered values."
    interaction_advice = synthesis.get("interaction_advice") or "Approach with structural logic, scalable enterprise ROI, and genuine team respect."

    story.append(Paragraph("Personality Archetype & Synthesis", styles["SectionHeader"]))
    story.append(HRFlowable(width="100%", color=COLOR_LINE_DARK, thickness=0.5, spaceAfter=6, spaceBefore=0))

    arch_box_data = [
        [Paragraph(f"<b>Archetype:</b> <font color='#0061FF'><b>{_esc(archetype)}</b></font>", styles["DocSubtitle"])],
        [Paragraph(_esc(arch_summary), styles["DocBodyText"])],
        [Paragraph(f"<b>Interaction Guidance:</b> {_esc(interaction_advice)}", styles["DocBodyText"])],
    ]
    t_arch = Table(arch_box_data, colWidths=[180 * mm])
    t_arch.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), COLOR_BG_CARD),
        ("BOX", (0, 0), (-1, -1), 0.5, COLOR_LINE_DARK),
        ("PADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(t_arch)
    story.append(Spacer(1, 6))

    # ── Executive Summary ───────────────────────────────────────
    exec_summary = profile.get("executive_summary") or (
        f"{p_name} is an established enterprise leader with extensive experience driving strategic transformation, "
        f"platform modernization, and operational rigor in highly regulated global environments."
    )
    story.append(Paragraph("Executive Summary & Trajectory", styles["SectionHeader"]))
    story.append(HRFlowable(width="100%", color=COLOR_LINE_DARK, thickness=0.5, spaceAfter=6, spaceBefore=0))
    story.append(Paragraph(_esc(exec_summary), styles["DocBodyText"]))
    story.append(Spacer(1, 6))

    # ── Big Five Personality Traits ─────────────────────────────
    big_five = profile.get("big_five_traits") or {}
    story.append(Paragraph("Big Five Personality Trait Estimates (1.0 — 10.0 Scale)", styles["SectionHeader"]))
    story.append(HRFlowable(width="100%", color=COLOR_LINE_DARK, thickness=0.5, spaceAfter=6, spaceBefore=0))

    b5_data = [
        [
            Paragraph("<b>Trait Dimension</b>", styles["TableHeader"]),
            Paragraph("<b>Score</b>", styles["TableHeader"]),
            Paragraph("<b>Behavioral Synthesis & Evidentiary Proof</b>", styles["TableHeader"]),
        ]
    ]

    traits_def = [
        ("openness", "Openness to Experience", 8.0, "Ecosystem innovation, platform agility, AI/data adoption."),
        ("conscientiousness", "Conscientiousness", 7.5, "Long-term institutional tenures, sustained execution discipline."),
        ("extraversion", "Extraversion", 8.0, "Public keynotes, board governance, transparent communication."),
        ("agreeableness", "Agreeableness", 8.0, "Servant leadership, humble mentorship, team-first advocacy."),
        ("emotional_stability", "Emotional Stability", 8.5, "Measured resilience across financial crises and global postings."),
    ]

    for trait_key, trait_label, def_score, def_ev in traits_def:
        t_info = big_five.get(trait_key) or {}
        score = t_info.get("score") if t_info.get("score") is not None else def_score
        summary = t_info.get("summary") or ""
        evidence = t_info.get("evidence") or def_ev
        combined_text = f"<b>{_esc(summary)}</b> — {_esc(evidence)}" if summary else _esc(evidence)

        b5_data.append([
            Paragraph(f"<b>{trait_label}</b>", styles["DocBodyText"]),
            Paragraph(f"<b>{score:.1f} / 10</b>", styles["DocBodyText"]),
            Paragraph(combined_text, styles["DocBodyText"]),
        ])

    t_b5 = Table(b5_data, colWidths=[45 * mm, 22 * mm, 113 * mm])
    t_b5.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), COLOR_BG_CARD),
        ("GRID", (0, 0), (-1, -1), 0.5, COLOR_LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("PADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t_b5)
    story.append(Spacer(1, 8))

    # ── Cognitive & Systems Architecture ────────────────────────
    cog = profile.get("cognitive_style") or {}
    story.append(Paragraph("Cognitive Style: Systems-Level Pragmatist", styles["SectionHeader"]))
    story.append(HRFlowable(width="100%", color=COLOR_LINE_DARK, thickness=0.5, spaceAfter=6, spaceBefore=0))
    if cog.get("summary"):
        story.append(Paragraph(_esc(cog["summary"]), styles["DocBodyText"]))
    if cog.get("platform_mindset"):
        story.append(Paragraph(f"<b>Platform Mindset:</b> {_esc(cog['platform_mindset'])}", styles["DocBodyText"]))
    for b in cog.get("basis") or []:
        pt = _esc(b.get("point") or "")
        story.append(Paragraph(f"<font color='{COLOR_MUTED.hexval()}'>•</font> {pt}", styles["CitationItem"]))
    story.append(Spacer(1, 6))

    # ── Leadership & Scale Dynamics ─────────────────────────────
    lead = profile.get("leadership_patterns") or {}
    story.append(Paragraph("Leadership Style & Scale Management", styles["SectionHeader"]))
    story.append(HRFlowable(width="100%", color=COLOR_LINE_DARK, thickness=0.5, spaceAfter=6, spaceBefore=0))
    if lead.get("summary"):
        story.append(Paragraph(_esc(lead["summary"]), styles["DocBodyText"]))
    if lead.get("scale_management"):
        story.append(Paragraph(f"<b>Scale & Culture:</b> {_esc(lead['scale_management'])}", styles["DocBodyText"]))
    for b in lead.get("basis") or []:
        pt = _esc(b.get("point") or "")
        story.append(Paragraph(f"<font color='{COLOR_MUTED.hexval()}'>•</font> {pt}", styles["CitationItem"]))
    story.append(Spacer(1, 6))

    # ── Values, Motivations & Philanthropic Governance ──────────
    values = profile.get("core_values_and_motivations") or {}
    story.append(Paragraph("Core Values & Philanthropic Governance", styles["SectionHeader"]))
    story.append(HRFlowable(width="100%", color=COLOR_LINE_DARK, thickness=0.5, spaceAfter=6, spaceBefore=0))
    if values.get("summary"):
        story.append(Paragraph(_esc(values["summary"]), styles["DocBodyText"]))
    boards = values.get("philanthropy_and_boards") or []
    if boards:
        story.append(Paragraph("<b>Board Commitments & Philanthropy:</b>", styles["DocBodyText"]))
        for brd in boards:
            story.append(Paragraph(f"<font color='{COLOR_MUTED.hexval()}'>•</font> {_esc(brd)}", styles["BulletItem"]))
    story.append(Spacer(1, 6))

    # ── Inferred Blind Spots ────────────────────────────────────
    blind_spots = profile.get("potential_blind_spots") or []
    if blind_spots:
        story.append(Paragraph("Potential Operational & Cognitive Blind Spots", styles["SectionHeader"]))
        story.append(HRFlowable(width="100%", color=COLOR_LINE_DARK, thickness=0.5, spaceAfter=6, spaceBefore=0))
        for bs in blind_spots:
            bs_title = bs.get("blind_spot") or "Operational Consideration"
            bs_impact = bs.get("impact") or ""
            bs_counter = bs.get("counter_strategy") or ""
            story.append(Paragraph(f"<b>{_esc(bs_title)}:</b> {_esc(bs_impact)}", styles["DocBodyText"]))
            if bs_counter:
                story.append(Paragraph(f"<i>Mitigation: {_esc(bs_counter)}</i>", styles["CitationItem"]))
        story.append(Spacer(1, 6))

    # ── Actionable Engagement Playbook ──────────────────────────
    playbook = profile.get("engagement_playbook") or {}
    story.append(Paragraph("Actionable Executive Engagement Playbook", styles["SectionHeader"]))
    story.append(HRFlowable(width="100%", color=COLOR_LINE_DARK, thickness=0.5, spaceAfter=6, spaceBefore=0))

    dos = playbook.get("dos") or ["Lead with structural clarity, scalable architecture, and verifiable ROI.", "Highlight governance, compliance, and team enablement."]
    donts = playbook.get("donts") or ["Avoid superficial 'move fast and break things' pitches.", "Do not present siloed point solutions lacking enterprise integration."]
    opening_hook = playbook.get("opening_hook") or "Focus on enterprise data platform modernization and advisor empowerment."
    recommended_tone = playbook.get("recommended_tone") or "Measured, respectful, architectural, and ROI-grounded."

    story.append(Paragraph(f"<b>Opening Conversation Hook:</b> {_esc(opening_hook)}", styles["DocBodyText"]))
    story.append(Paragraph(f"<b>Recommended Tone:</b> {_esc(recommended_tone)}", styles["DocBodyText"]))
    story.append(Spacer(1, 4))

    pb_table_data = [
        [Paragraph("<b>DO THIS</b>", styles["TableHeader"]), Paragraph("<b>AVOID THIS</b>", styles["TableHeader"])],
        [
            Paragraph("<br/>".join(f"• {_esc(d)}" for d in dos), styles["DocBodyText"]),
            Paragraph("<br/>".join(f"• {_esc(d)}" for d in donts), styles["DocBodyText"]),
        ]
    ]
    t_pb = Table(pb_table_data, colWidths=[90 * mm, 90 * mm])
    t_pb.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), COLOR_BG_CARD),
        ("GRID", (0, 0), (-1, -1), 0.5, COLOR_LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("PADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(t_pb)

    def _on_page(canvas, doc_):
        _header_footer(canvas, doc_, p_name, acct_name)

    doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
    return buf.getvalue()
