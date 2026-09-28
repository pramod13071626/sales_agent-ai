"""
Generate high-quality Executive PDF Document for Sales AI Chatbot Architecture Blueprint.
Uses ReportLab with an elegant, modern executive briefing styling.
"""

import sys
from pathlib import Path
from datetime import datetime
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
)
from reportlab.pdfgen import canvas

# Palettes
C_DARK = colors.HexColor("#0F172A")       # Slate 900
C_PRIMARY = colors.HexColor("#1E3A8A")    # Blue 900
C_ACCENT = colors.HexColor("#2563EB")     # Blue 600
C_BODY = colors.HexColor("#334155")       # Slate 700
C_MUTED = colors.HexColor("#64748B")      # Slate 500
C_LIGHT_BG = colors.HexColor("#F8FAFC")   # Slate 50
C_BORDER = colors.HexColor("#CBD5E1")     # Slate 300
C_WHITE = colors.HexColor("#FFFFFF")
C_ALERT_BG = colors.HexColor("#EFF6FF")   # Blue 50
C_SUCCESS_BG = colors.HexColor("#ECFDF5") # Emerald 50
C_SUCCESS_BORDER = colors.HexColor("#10B981")


class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(C_MUTED)

        # Header (pages 2+)
        if self._pageNumber > 1:
            self.drawString(54, 750, "Sales AI Enterprise Chatbot — Architecture & Execution Blueprint")
            self.drawRightString(612 - 54, 750, "CONFIDENTIAL & PROPRIETARY")
            self.setStrokeColor(C_BORDER)
            self.setLineWidth(0.5)
            self.line(54, 742, 612 - 54, 742)

        # Footer (all pages)
        self.setStrokeColor(C_BORDER)
        self.setLineWidth(0.5)
        self.line(54, 45, 612 - 54, 45)
        self.drawString(54, 32, f"Generated on {datetime.now().strftime('%B %d, %Y')} | Sales AI Intelligence Engine v2.2")
        self.drawRightString(612 - 54, 32, f"Page {self._pageNumber} of {page_count}")
        self.restoreState()


def generate_pdf(output_path: str):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54,
    )

    styles = getSampleStyleSheet()

    # Custom typography
    style_title = ParagraphStyle(
        "DocTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=26,
        textColor=C_DARK,
        spaceAfter=4,
    )
    style_subtitle = ParagraphStyle(
        "DocSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=11,
        leading=15,
        textColor=C_ACCENT,
        spaceAfter=10,
    )
    style_h1 = ParagraphStyle(
        "Heading1_Custom",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=17,
        textColor=C_PRIMARY,
        spaceBefore=10,
        spaceAfter=5,
        keepWithNext=True,
    )
    style_h2 = ParagraphStyle(
        "Heading2_Custom",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=14,
        textColor=C_DARK,
        spaceBefore=8,
        spaceAfter=4,
        keepWithNext=True,
    )
    style_body = ParagraphStyle(
        "Body_Custom",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=12.5,
        textColor=C_BODY,
        spaceAfter=5,
    )
    style_bullet = ParagraphStyle(
        "Bullet_Custom",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=12,
        textColor=C_BODY,
        leftIndent=14,
        firstLineIndent=-10,
        spaceAfter=3,
    )
    style_callout = ParagraphStyle(
        "Callout_Text",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=12.5,
        textColor=C_DARK,
    )
    style_th = ParagraphStyle(
        "TableHead",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=C_WHITE,
    )
    style_td = ParagraphStyle(
        "TableCell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=10.5,
        textColor=C_BODY,
    )
    style_td_bold = ParagraphStyle(
        "TableCellBold",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=10.5,
        textColor=C_DARK,
    )

    story = []

    # Title & Metadata Header
    story.append(Paragraph("Sales AI Enterprise Copilot", style_title))
    story.append(Paragraph("Chatbot Architecture, Real-Time Database Grounding & Execution Blueprint", style_subtitle))
    story.append(HRFlowable(width="100%", thickness=1.5, color=C_ACCENT, spaceBefore=0, spaceAfter=8))

    # Meta Table
    meta_data = [
        [
            Paragraph("<b>Target System:</b> Sales AI Agent (sales_ai)", style_td),
            Paragraph(f"<b>Date:</b> {datetime.now().strftime('%B %d, %Y')}", style_td),
            Paragraph("<b>Status:</b> Architectural Spec & Execution", style_td),
        ],
        [
            Paragraph("<b>Core Engine:</b> FastAPI + Gemini / OpenAI Gateway", style_td),
            Paragraph("<b>Ground Truth:</b> PostgreSQL Relational Database", style_td),
            Paragraph("<b>Security:</b> Full RBAC & Guardrails Layer", style_td),
        ],
    ]
    meta_table = Table(meta_data, colWidths=[170, 160, 174])
    meta_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), C_LIGHT_BG),
        ("BOX", (0, 0), (-1, -1), 0.5, C_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, C_BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 8))

    # Section 1: Executive Overview
    story.append(Paragraph("1. Executive Objective & Core Philosophy", style_h1))
    story.append(Paragraph(
        "The <b>Sales AI Enterprise Copilot</b> is an intelligent, real-time conversational agent designed to provide instant executive intelligence, "
        "account dossiers, line-of-business (LOB) breakdowns, persona leadership profiles, and live signals to sales representatives and sales executives.",
        style_body
    ))
    
    # Core Principle Box
    callout_data = [[
        Paragraph("<b>THE GROUNDING PRINCIPLE: ZERO HALLUCINATIONS, 100% DATABASE-BACKED</b><br/>"
                  "The LLM is strictly prohibited from generating hardcoded or fabricated facts. It operates as an "
                  "<b>Intelligent Query Parser, Context Router, and Conversational Synthesizer</b>, while the "
                  "<b>PostgreSQL database</b> remains the single authoritative source of truth. Raw numbers, funding dates, "
                  "LOB segments, and CXO bios are fetched directly from relational tables and converted into natural, high-impact executive prose.",
                  style_callout)
    ]]
    callout_table = Table(callout_data, colWidths=[504])
    callout_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), C_ALERT_BG),
        ("BOX", (0, 0), (-1, -1), 1, C_ACCENT),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(callout_table)
    story.append(Spacer(1, 8))

    # Section 2: End-to-End System Architecture
    story.append(Paragraph("2. End-to-End Architecture & Data Flow", style_h1))
    story.append(Paragraph(
        "The architecture decouples query parsing, data retrieval, security guardrails, and conversational synthesis into a high-performance 5-stage pipeline:",
        style_body
    ))

    arch_data = [
        [Paragraph("Pipeline Stage", style_th), Paragraph("Component", style_th), Paragraph("Function & Execution Details", style_th)],
        [
            Paragraph("<b>Stage 1: Intent & Entity Parsing</b>", style_td),
            Paragraph("Query Router", style_td),
            Paragraph("Parses user input (e.g., <i>'Show BlackRock investment data'</i>), extracts target entity (BlackRock), and identifies required data domains (Funding, LOBs, Personas).", style_td),
        ],
        [
            Paragraph("<b>Stage 2: Entity Resolution & RBAC</b>", style_td),
            Paragraph("Account Matcher + auth.py", style_td),
            Paragraph("Performs fuzzy & trigram matching against accounts table (resolving to ID=14). Verifies caller has explicit permission to view this account via UserAccountAccess.", style_td),
        ],
        [
            Paragraph("<b>Stage 3: Database Extraction</b>", style_td),
            Paragraph("PostgreSQL ORM Engine", style_td),
            Paragraph("Executes parameterized, read-only queries pulling Account financials, LOB capabilities, Persona dossiers, and Opportunity signals.", style_td),
        ],
        [
            Paragraph("<b>Stage 4: Context Assembly</b>", style_td),
            Paragraph("Token Optimizer", style_td),
            Paragraph("Converts relational rows and JSONB payloads into clean, token-efficient structured markdown and injects master system prompts.", style_td),
        ],
        [
            Paragraph("<b>Stage 5: LLM Synthesis & Stream</b>", style_td),
            Paragraph("Gemini Gateway + SSE", style_td),
            Paragraph("Transforms raw strings/numbers into structured conversational narrative with bullet points, strategic sales implications, citations, and streams via SSE to the browser.", style_td),
        ],
    ]
    arch_table = Table(arch_data, colWidths=[120, 110, 274])
    arch_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), C_PRIMARY),
        ("BOX", (0, 0), (-1, -1), 0.5, C_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, C_BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [C_WHITE, C_LIGHT_BG]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(arch_table)
    story.append(Spacer(1, 8))

    # Section 3: Data Ingestion & Model Interaction
    story.append(Paragraph("3. Real-Time Data Model Ingestion Pipeline", style_h1))
    story.append(Paragraph(
        "To ensure 100% precision, collected database models map directly into contextual payloads consumed by the model:",
        style_body
    ))

    data_points = [
        "<b>Account Entity (accounts):</b> Firmographics, headquarters, stock symbol/CIK, total funding amount USD, last funding round date, estimated revenue range, employee ranges.",
        "<b>Lines of Business (lobs & sub_lobs):</b> Segment names, market capabilities, competitor grids, and custom engineering growth themes.",
        "<b>Personas & Buying Committee (personas):</b> Executive names, verified titles, LinkedIn profiles, AI personality profiles, and pain point indicators.",
        "<b>Live Signals & Radar (opportunity_signals & linkedin_jobs):</b> Real-time hiring trend radar, funding history events, and CXO movements.",
        "<b>User Action Items (action_items):</b> User-assigned tasks, due dates, priority tiers, and follow-up notes.",
    ]
    for dp in data_points:
        story.append(Paragraph(f"• {dp}", style_bullet))
    story.append(Spacer(1, 8))

    # Section 4: Conversational Transformation Strategy
    story.append(Paragraph("4. LLM In-Context Learning & Conversational Transformation", style_h1))
    story.append(Paragraph(
        "Rather than static fine-tuning (which risks knowledge staleness when database rows update), the Copilot employs <b>In-Context RAG Engineering</b>. "
        "The model is instructed with strict formatting guidelines to convert raw database numbers into sales intelligence:",
        style_body
    ))

    transform_data = [
        [Paragraph("Raw Database Field / Value", style_th), Paragraph("Conversational Executive Output", style_th)],
        [
            Paragraph("<code>total_funding_amount_usd: 1500000000<br/>last_funding_type: Series E<br/>last_funding_date: 2024-05-12</code>", style_td),
            Paragraph("<i>'BlackRock holds <b>$1.5B in total funding</b>, with their latest capital event being a <b>Series E round</b> completed on <b>May 12, 2024</b>.'</i>", style_td),
        ],
        [
            Paragraph("<code>hiring_count: 42<br/>focus: 'AI & Cloud Platform'</code>", style_td),
            Paragraph("<i>'We detected a strong hiring spike with <b>42 active engineering roles</b> focused on AI Infrastructure and Cloud Operations.'</i>", style_td),
        ],
        [
            Paragraph("<code>persona_tier: 'Tier 1'<br/>name: 'Rob Goldstein'<br/>title: 'COO & Head of Aladdin'</code>", style_td),
            Paragraph("<i>'Key decision-maker: <b>Rob Goldstein (COO & Head of Aladdin)</b>. Leadership traits indicate a decisive, tech-first operational focus.'</i>", style_td),
        ],
    ]
    transform_table = Table(transform_data, colWidths=[200, 304])
    transform_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), C_PRIMARY),
        ("BOX", (0, 0), (-1, -1), 0.5, C_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, C_BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [C_WHITE, C_LIGHT_BG]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(transform_table)
    story.append(Spacer(1, 8))

    # Section 5: Security, RBAC & Guardrails
    story.append(Paragraph("5. Enterprise Security, RBAC & Guardrails Framework", style_h1))
    story.append(Paragraph(
        "A multi-tier defense system guarantees security, tenant isolation, and factual grounding:",
        style_body
    ))

    guard_data = [
        "<b>Inbound Guardrails:</b> Prompt injection filtering, SQL parameterization, and strict session token authentication via <code>auth.get_current_user</code>.",
        "<b>Role-Based Access Control (RBAC):</b> If a sales rep lacks access to an account, the query is blocked at the ORM layer with a polite restricted notice.",
        "<b>Execution Safety:</b> Chat engine operates exclusively on read-only transactions. Write operations (e.g. creating a task) require explicit API confirmation.",
        "<b>Outbound Grounding Verifier:</b> Financial figures and named entities generated by the LLM are checked against the retrieved database payload to prevent factual drift.",
    ]
    for gd in guard_data:
        story.append(Paragraph(f"• {gd}", style_bullet))
    story.append(Spacer(1, 8))

    # Section 6: UI/UX & Backend Implementation
    story.append(Paragraph("6. UI/UX Copilot & Backend Specifications", style_h1))
    story.append(Paragraph(
        "<b>Backend REST & Streaming Endpoints:</b><br/>"
        "• <code>POST /api/chat/stream</code>: Server-Sent Events (SSE) endpoint providing low-latency token streaming.<br/>"
        "• <code>GET /api/chat/sessions</code> & <code>GET /api/chat/sessions/{id}</code>: Conversation history and context state.<br/>"
        "• <code>POST /api/chat/suggested-prompts</code>: Contextual quick-prompts based on the user's active account tab.<br/>"
        "<b>Frontend Copilot Drawer Experience:</b><br/>"
        "• Floating AI action button (FAB) located in bottom-right corner, opening an expandable 420px glassmorphic drawer.<br/>"
        "• Rich renderers for Markdown, financial metric badges, and one-click action buttons (<i>'Open Account Dossier'</i>, <i>'Assign Follow-up Task'</i>).",
        style_body
    ))
    story.append(Spacer(1, 8))

    # Section 7: Roadmap
    story.append(Paragraph("7. Execution & Implementation Roadmap", style_h1))
    roadmap_data = [
        [Paragraph("Phase", style_th), Paragraph("Deliverables", style_th), Paragraph("Key Validation Metrics", style_th)],
        [
            Paragraph("<b>Phase 1</b>", style_td_bold),
            Paragraph("Query Parser, Fuzzy Account Resolver & Database Context Assembler", style_td),
            Paragraph("100% entity resolution accuracy on top 50 enterprise accounts.", style_td),
        ],
        [
            Paragraph("<b>Phase 2</b>", style_td_bold),
            Paragraph("Gemini LLM Synthesis Engine + SSE Streaming Endpoint (api.py)", style_td),
            Paragraph("Sub-second initial token latency (<800ms) over SSE.", style_td),
        ],
        [
            Paragraph("<b>Phase 3</b>", style_td_bold),
            Paragraph("RBAC Access Filter & Grounding/Hallucination Guardrails", style_td),
            Paragraph("Zero unauthorized account data access across user roles.", style_td),
        ],
        [
            Paragraph("<b>Phase 4</b>", style_td_bold),
            Paragraph("Frontend Sliding Copilot Drawer & Interactive Markdown UI", style_td),
            Paragraph("Seamless multi-device UI, dark/light theme alignment.", style_td),
        ],
    ]
    roadmap_table = Table(roadmap_data, colWidths=[70, 240, 194])
    roadmap_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), C_PRIMARY),
        ("BOX", (0, 0), (-1, -1), 0.5, C_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, C_BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [C_WHITE, C_LIGHT_BG]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(roadmap_table)

    # Build PDF
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"[SUCCESS] PDF generated at: {output_path}")


if __name__ == "__main__":
    out_file = sys.argv[1] if len(sys.argv) > 1 else "output/Sales_AI_Chatbot_Architecture_Blueprint.pdf"
    Path(out_file).parent.mkdir(parents=True, exist_ok=True)
    generate_pdf(out_file)
