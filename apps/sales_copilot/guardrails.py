"""Guardrails for AI-drafted outreach (emails / LinkedIn messages).

The model is briefed (chat.DRAFT_INSTRUCTION), but a brief is not a guarantee, so
every draft is checked in code before the rep sees it. Each check reports
pass / fixed / warn, and the result is shown under the draft so the rep can see
what was verified. No extra LLM requests.

Checks
  structure    subject line, greeting, sign-off present (added when missing)
  citations    no [n] markers inside the email body (moved to a "Based on" line)
  facts        every figure (numbers, %, $) must appear in the evidence (unsupported sentences removed)
  attribution  no claims that the recipient personally led/drove/launched something unless
               the evidence names them as the author (softened to neutral phrasing)
  overclaim    no guarantees, invented clients or results ("guarantee", "risk-free", "we helped X")
  contact      no email addresses / phone numbers in the body
  tone         no spammy or pushy phrases; greeting uses first name
  length       body within 80–190 words
"""

import re
from typing import Any, Dict, List, Optional, Tuple

CITE_RE = re.compile(r"\s*\[(\d{1,2})\]")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(?<!\w)\+?\d[\d\s().-]{7,}\d")
FIGURE_RE = re.compile(r"(?<![\w-])(\$?\d[\d,.]*\s?(?:%|percent|x|k|m|bn|billion|million|thousand)?)(?![\w-])", re.I)

SPAM = ["act now", "limited time", "risk-free", "risk free", "guarantee", "guaranteed", "100%", "no obligation",
        "click here", "urgent", "!!!", "free trial", "best in class", "world-class", "revolutionary", "game-changer",
        "game changer", "synergy", "circle back", "touch base", "just checking in", "i hope this email finds you well"]
OVERCLAIM = [r"\bwe (have )?helped [A-Z][\w&.]+", r"\bour clients (include|such as)\b", r"\bproven to\b",
             r"\bwill (save|cut|reduce|increase|double|triple)\b.*\d", r"\bguarantee",
             # implied track record the data can't back ("how we've supported similar initiatives at global banks")
             r"\b(how )?we(?:'ve| have)? (supported|helped|worked with|partnered with|delivered for)\b",
             r"\bsimilar (initiatives|programs|firms|institutions|organizations|clients) (at|like|such as)\b",
             r"\b(leading|top|major|global|other) (banks|firms|financial institutions|asset managers|clients)\b"]
DEFAULT_ASK = "Would you be open to a 20-minute conversation in the next two weeks to see whether any of this is useful for your team?"
ASK_RE = re.compile(r"\b(conversation|call|chat|meeting|minutes|connect)\b", re.I)
ATTRIBUTION = [r"\bcongratulations on (your |you )?(driving|leading|launching|spearheading|building|delivering)\b",
               r"\byou (drove|led|launched|spearheaded|built|delivered|championed|pioneered)\b",
               r"\byour (recent )?(launch|report|initiative) of\b"]


def _sentences(text: str) -> List[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]


def _figures(s: str) -> List[str]:
    out = []
    for m in FIGURE_RE.finditer(s):
        f = m.group(1).strip()
        digits = re.sub(r"[^\d]", "", f)
        plain = not re.search(r"%|\$|percent|x\b|k\b|m\b|bn|billion|million|thousand", f, re.I)
        if not digits or (plain and len(digits) <= 2) or (plain and re.fullmatch(r"(19|20)\d\d", digits)):
            continue          # small plain numbers ("15 minutes") and years ("2026") are not claims
        out.append(f)
    return out


def _filter_sentences(body: str, drop) -> str:
    """Drop sentences for which drop(sentence) is true, keeping paragraph and line (bullet) structure."""
    out_paras = []
    for para in re.split(r"\n\s*\n", body):
        out_lines = []
        for line in para.split("\n"):
            m = re.match(r"^(\s*(?:[-*•]|\d+[.)])\s+)(.*)$", line)
            prefix, content = (m.group(1), m.group(2)) if m else ("", line)
            kept = [s for s in _sentences(content) if not drop(s)]
            if kept:
                out_lines.append(prefix + " ".join(kept))
        if out_lines:
            out_paras.append("\n".join(out_lines))
    return "\n\n".join(out_paras)


def _split_email(draft: str) -> Tuple[str, List[str]]:
    lines = [l.rstrip() for l in draft.strip().splitlines()]
    subject = ""
    body: List[str] = []
    for l in lines:
        m = re.match(r"^\s*\**\s*subject\s*\**\s*:\s*\**\s*(.+?)\**\s*$", l, re.I)
        if m and not subject:
            subject = m.group(1).strip()
        else:
            body.append(l)
    return subject, body


def check_draft(draft: str, evidence_text: str, first_name: str, recipient_is_author: bool,
                offering_hint: Optional[str] = None) -> Tuple[str, List[Dict[str, str]]]:
    """Returns (clean draft, checks). Never raises; worst case returns the input with warnings."""
    checks: List[Dict[str, str]] = []

    def add(check: str, status: str, detail: str) -> None:
        checks.append({"check": check, "status": status, "detail": detail})

    subject, body_lines = _split_email(draft)
    body = "\n".join(body_lines).strip()
    # The trailing "Sources: [1], [3]" line (as briefed): keep its numbers, rebuild the line ourselves.
    tail = re.search(r"\n\s*(sources?|based on)\s*:.*$", body, flags=re.I | re.S)
    listed = {int(n) for n in CITE_RE.findall(tail.group(0))} if tail else set()
    if tail:
        body = body[:tail.start()].strip()

    # citations
    inline_cites = {int(n) for n in CITE_RE.findall(body)}
    cites = sorted(listed | inline_cites)
    if inline_cites:
        body = CITE_RE.sub("", body)
        add("citations", "fixed", "Source markers moved out of the email body")
    else:
        add("citations", "pass", "No source markers in the body")

    # contact details
    if EMAIL_RE.search(body) or PHONE_RE.search(body):
        body = PHONE_RE.sub("", EMAIL_RE.sub("", body))
        add("contact", "fixed", "Removed contact details from the body")
    else:
        add("contact", "pass", "No contact details in the body")

    # facts: figures must exist in evidence
    ev = evidence_text.lower()
    removed: List[str] = []

    def unsupported(sent: str) -> bool:
        bad = [f for f in _figures(sent) if f.lower().replace(",", "") not in ev.replace(",", "")]
        if bad:
            removed.append(", ".join(bad))
        return bool(bad)
    body = _filter_sentences(body, unsupported)
    add("facts", "fixed" if removed else "pass",
        f"Removed unsupported figure(s): {'; '.join(removed)}" if removed else "Every figure appears in the sources")

    # attribution
    if not recipient_is_author:
        hit = False
        for pat in ATTRIBUTION:
            if re.search(pat, body, re.I):
                hit = True
                body = re.sub(r"\bcongratulations on (your |you )?(driving|leading|launching|spearheading|building|delivering)\b",
                              "I noticed", body, flags=re.I)
                body = re.sub(r"\byou (drove|led|launched|spearheaded|built|delivered|championed|pioneered)\b",
                              "your team's work on", body, flags=re.I)
        add("attribution", "fixed" if hit else "pass",
            "Softened a claim that the recipient personally led something the sources don't attribute to them" if hit
            else "No unsupported personal credit")
    else:
        add("attribution", "pass", "Recipient is named as the author in the sources")

    # overclaim + spam
    over = [p for p in OVERCLAIM if re.search(p, body, re.I)]
    if over:
        replaced_ask = []

        def overclaims(sent: str) -> bool:
            return any(re.search(o, sent, re.I) for o in over)
        # An overclaiming call-to-action is replaced with a neutral ask rather than dropped.
        paras = re.split(r"\n\s*\n", body)
        for i, para in enumerate(paras):
            if ASK_RE.search(para) and overclaims(para) and "\n" not in para.strip():
                paras[i] = DEFAULT_ASK
                replaced_ask.append(1)
        body = _filter_sentences("\n\n".join(paras), overclaims)
        add("overclaim", "fixed", "Removed claims the sources can't back (e.g. implied client track record)"
            + ("; replaced the ask with a neutral one" if replaced_ask else ""))
    else:
        add("overclaim", "pass", "No guarantees or invented results")
    spam = [w for w in SPAM if w in body.lower()]          # after overclaim removal: report each problem once
    if re.search(r"\b([A-Z]{2,5}s|leaders|people) like you\b", body):
        body = re.sub(r"\bI (help|work with) ([A-Z]{2,5}s|leaders|people) like you\b", r"I \1 technology leaders", body)
        body = re.sub(r"\b([A-Z]{2,5}s|leaders|people) like you\b", "technology leaders", body)
        add("tone", "fixed", 'Replaced generic "…like you" phrasing')
    if spam:
        for w in spam:
            body = re.sub(re.escape(w), "", body, flags=re.I)
        add("tone", "fixed", f"Removed pushy/spammy wording: {', '.join(spam)}")
    if not any(c["check"] == "tone" for c in checks):
        add("tone", "pass", "Professional tone, no pushy phrases")

    # small grammar fixes common in model drafts
    for wrong, right in (("could we spare", "could you spare"), ("would we be open", "would you be open")):
        body = re.sub(rf"\b{wrong}\b", lambda m, r=right: r[0].upper() + r[1:] if m.group(0)[0].isupper() else r,
                      body, flags=re.I)
    body = re.sub(r"[ \t]{2,}", " ", body).replace(" ,", ",").replace(" .", ".").strip()

    # A bare "[Your name]" / "StradIT" tail without "regards" is an incomplete sign-off: replace it with ours
    if not re.search(r"(best|kind|warm) regards|sincerely|thanks,|thank you,|best,", body, re.I):
        body = re.sub(r"(\n\s*(\[your name\]|stradit)\s*)+$", "", body, flags=re.I).rstrip()

    # structure: greeting + sign-off
    greet = f"Hi {first_name}," if first_name else "Hello,"
    if not re.match(r"^(hi|hello|dear|good (morning|afternoon))\b", body, re.I):
        body = f"{greet}\n\n{body}"
        add("structure", "fixed", "Added a greeting")
    if not re.search(r"(best|kind|warm) regards|sincerely|thanks,|thank you,|best,", body, re.I):
        body = body.rstrip() + "\n\nBest regards,\n[Your name]\nStradIT"
        add("structure", "fixed", "Added a sign-off")
    elif "stradit" not in body.lower()[-80:]:
        body = body.rstrip() + "\nStradIT"
    if not subject:
        subject = f"{offering_hint or 'An idea'} for your team"
        add("structure", "fixed", "Added a subject line")
    elif len(subject.split()) > 10:
        subject = " ".join(subject.split()[:10])
        add("structure", "fixed", "Shortened the subject line")
    if not any(c["check"] == "structure" for c in checks):
        add("structure", "pass", "Subject, greeting and sign-off present")

    # length (words between greeting and sign-off)
    core = re.sub(r"^(hi|hello|dear)[^\n]*\n", "", body, flags=re.I)
    core = re.split(r"\n\s*(best|kind|warm) regards", core, flags=re.I)[0]
    n = len(core.split())
    add("length", "pass" if 80 <= n <= 190 else "warn",
        f"{n} words" + ("" if 80 <= n <= 190 else " — aim for 80–190 so it reads in under a minute"))

    based_on = f"\n\n_Based on sources {', '.join(f'[{c}]' for c in cites)}._" if cites else ""
    return f"**Subject:** {subject}\n\n{body}{based_on}", checks
