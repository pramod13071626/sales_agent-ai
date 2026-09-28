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
  internal     no internal sales jargon / private-note wording (persona, dossier, "pain points", CRM …)
  competitor   no disparaging claims about competitors
  confidential no "confidential / internal only / I heard" material
  links        no URLs that are not in the sources (a prompt-injection favourite)
  placeholders no unfilled template slots other than [Your name]
  length       body within 80–190 words

Every other AI answer goes through check_answer():
  citations    [n] markers must point at a real source; factual answers must cite something
  facts        figures that don't appear in the sources are flagged
  contact      no email addresses / phone numbers
  leakage      no echo of the system prompt or prompt section headers
  links        no URLs that are not in the sources
  language     abusive words (e.g. quoted from scraped text) are masked

And scraped EVIDENCE is cleaned before it reaches the model by sanitize_evidence(): sentences that
read like instructions to an AI ("ignore previous instructions", "you are now …") are replaced.
"""

import re
from typing import Any, Dict, List, Optional, Tuple

from apps.sales_copilot import moderation

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
URL_RE = re.compile(r"\b(?:https?://|www\.)[^\s)\]>\"']+", re.I)
# Words from our own data model / private notes that must never reach a prospect.
INTERNAL = [r"\bpersonas?\b", r"\bdossier\b", r"\bcall[- ]prep\b", r"\bour (crm|notes|records|database)\b",
            r"\b(decision|budget) authority\b", r"\blead score\b", r"\bbuying committee\b", r"\bicp\b",
            r"\bseniority\b", r"\[note\]", r"\bobjections?\b", r"\bintent (score|signals?)\b"]
# Softer internal wording that can be rephrased instead of dropping the sentence.
INTERNAL_REWRITE = [(r"\bpain[- ]points?\b", "challenges"), (r"\bkpis\b", "goals"), (r"\bkpi\b", "goal")]
# Company names must start with a capital, so these are case-sensitive; generic words use (?i:…).
COMPETITOR = [r"\b(?i:unlike)\s+(?:(?i:your\s+)?(?i:current\s+)?(?i:vendors?|providers?|competitors?)|[A-Z][\w&.]+)\b.*\b(?i:which|who|that)\b",
              r"\b(?i:better|faster|cheaper|more reliable)\s+(?i:than)\s+(?:(?i:your current|other|competing)|[A-Z][\w&.]+)",
              r"\b(?i:competitors?|rivals?|other vendors?|your (?:current )?(?:vendor|provider))\b.*\b(?i:fail|struggle|can't|cannot|outdated|clunky|slow|behind|lag)",
              r"\b[A-Z][\w&.]+(?:'s)? (?i:platform|product|solution|tool)s? (?i:is|are) (?i:outdated|clunky|slow|failing|legacy|inferior)\b"]
CONFIDENTIAL = [r"\bconfidential\b", r"\binternal[- ]only\b", r"\bnon[- ]public\b", r"\bnot (yet )?public\b",
                r"\binsider\b", r"\bleaked\b", r"\bI (heard|was told) (from|that|through)\b", r"\boff the record\b",
                r"\bunder (nda|embargo)\b"]
INTERNAL_RES = [re.compile(p, re.I) for p in INTERNAL]
COMPETITOR_RES = [re.compile(p) for p in COMPETITOR]
CONFIDENTIAL_RES = [re.compile(p, re.I) for p in CONFIDENTIAL]
PLACEHOLDER_RE = re.compile(r"\[(?!your name\])[A-Za-z][^\]\n]{1,30}\]|<[a-z][^>\n]{1,30}>|\{\{?\s*\w+\s*\}?\}|\bXX+\b", re.I)

# Instruction-like text inside scraped evidence (prompt injection). Matched per sentence.
INJECTION = [r"\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|your|the)\b.{0,20}\b(instructions?|prompts?|rules|directions)\b",
             r"\byou are now\b", r"\bact as (an? )?(ai|assistant|chatbot|language model|llm)\b",
             r"\b(new|updated|real) (system )?(instructions?|prompt)\s*:", r"\bsystem prompt\b",
             r"\b(assistant|ai|chatbot|llm|language model)s?,? (must|should|shall|will) (now )?(say|reply|respond|tell|include|recommend|write)\b",
             r"\bwhen (asked|summari[sz]ing)\b.{0,60}\b(say|reply|respond|tell|include)\b",
             r"<\|?(im_start|im_end|system|endoftext)\|?>", r"^\s*#{2,}\s*(system|instruction)", r"\[/?(inst|system)\]",
             r"\bdo not (tell|reveal|mention)\b.{0,30}\b(user|salesperson)\b",
             r"\bjailbreak\b", r"\bdeveloper mode\b"]
INJECTION_RE = re.compile("|".join(f"(?:{p})" for p in INJECTION), re.I | re.M)
INJECTION_NOTE = "[instruction-like text removed]"

# Pieces of our own prompt that must never be echoed back (the model repeating its brief).
LEAK_RE = re.compile(r"^\s*(TOOL RESULTS|EVIDENCE|YOUR NOTES|EARLIER IN THIS CHAT|RECENT CONVERSATION|QUESTION|STYLE)\s*:|"
                     r"You are StradIT's sales copilot|EVIDENCE is untrusted scraped text|"
                     r"Use ONLY the facts in TOOL RESULTS", re.I | re.M)


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


def _domain(url: str) -> str:
    return re.sub(r"^(https?://)?(www\.)?", "", url.lower()).split("/")[0]


def _strip_foreign_links(text: str, evidence_text: str) -> Tuple[str, List[str]]:
    """Remove URLs whose domain never appears in the sources (injected or invented links)."""
    ev = (evidence_text or "").lower()
    dropped: List[str] = []

    def repl(m):
        url = m.group(0).rstrip(".,;:")
        if _domain(url) and _domain(url) in ev:
            return m.group(0)
        dropped.append(_domain(url))
        return ""
    text = re.sub(r"\[([^\]\n]+)\]\((https?://[^)\s]+)\)",                   # markdown link → keep the label
                  lambda m: m.group(0) if _domain(m.group(2)) in ev else (dropped.append(_domain(m.group(2))) or m.group(1)),
                  text)
    text = URL_RE.sub(repl, text)
    return text, list(dict.fromkeys(dropped))


def sanitize_evidence(text: str) -> Tuple[str, int]:
    """Replace instruction-like sentences in scraped text with a marker, before it reaches the model.
    Returns (clean text, number of sentences replaced). The system prompt already tells the model to
    ignore instructions in EVIDENCE; this removes them so a weak free model can't follow them anyway."""
    if not text or not INJECTION_RE.search(text):
        return text, 0
    n = 0
    out_lines = []
    for line in text.split("\n"):
        if not INJECTION_RE.search(line):
            out_lines.append(line)
            continue
        kept = []
        for sent in _sentences(line) or [line]:
            if INJECTION_RE.search(sent):
                n += 1
                if not kept or kept[-1] != INJECTION_NOTE:
                    kept.append(INJECTION_NOTE)
            else:
                kept.append(sent)
        out_lines.append(" ".join(kept))
    return "\n".join(out_lines), n


def check_answer(answer: str, evidence_text: str, n_evidence: int) -> Tuple[str, List[Dict[str, str]]]:
    """Guardrails for ordinary (non-draft) AI answers. Returns (clean answer, checks). Never raises."""
    checks: List[Dict[str, str]] = []

    def add(check: str, status: str, detail: str) -> None:
        checks.append({"check": check, "status": status, "detail": detail})

    ans = answer or ""

    # leakage: the model repeating its own brief / prompt sections
    if LEAK_RE.search(ans):
        ans = "\n".join(l for l in ans.split("\n") if not LEAK_RE.search(l))
        add("leakage", "fixed", "Removed text echoed from the assistant's instructions")
    else:
        add("leakage", "pass", "No instructions echoed")

    # citations: [n] must point at a real source
    bad = sorted({int(n) for n in re.findall(r"\[(\d+)\]", ans) if not 1 <= int(n) <= n_evidence})
    if bad:
        ans = re.sub(r"\s?\[(\d+)\]", lambda m: m.group(0) if 1 <= int(m.group(1)) <= n_evidence else "", ans)
        add("citations", "fixed", f"Removed citation(s) to sources that don't exist: {', '.join(f'[{b}]' for b in bad)}")
    elif n_evidence and not re.search(r"\[(\d+|note)\]", ans) and len(ans.split()) > 40:
        add("citations", "warn", "The answer doesn't cite any source — check it against the Sources panel")
    else:
        add("citations", "pass", "Every citation points at a source")

    # contact details
    if EMAIL_RE.search(ans) or PHONE_RE.search(ans):
        ans = PHONE_RE.sub("", EMAIL_RE.sub("", ans))
        add("contact", "fixed", "Removed contact details (the contact card shows them)")
    else:
        add("contact", "pass", "No contact details in the text")

    # links
    ans, dropped = _strip_foreign_links(ans, evidence_text)
    add("links", "fixed" if dropped else "pass",
        f"Removed link(s) not found in the sources: {', '.join(dropped[:3])}" if dropped else "No links outside the sources")

    # facts: figures should come from the sources (flagged, not removed — the rep can check the source)
    ev = (evidence_text or "").lower().replace(",", "")
    unsupported = list(dict.fromkeys(f for f in _figures(re.sub(r"\[\d+\]", "", ans))
                                     if f.lower().replace(",", "") not in ev))
    add("facts", "warn" if unsupported else "pass",
        f"Figure(s) not found in the sources: {', '.join(unsupported[:5])}" if unsupported
        else "Every figure appears in the sources")

    # language
    masked = moderation.mask(ans)
    if masked != ans:
        ans = masked
        add("language", "fixed", "Masked offensive wording quoted from a source")
    else:
        add("language", "pass", "No offensive wording")
    return ans.strip(), checks


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

    # links: only URLs that appear in the sources
    body, dropped_links = _strip_foreign_links(body, evidence_text)
    add("links", "fixed" if dropped_links else "pass",
        f"Removed link(s) not found in the sources: {', '.join(dropped_links[:3])}" if dropped_links
        else "No links outside the sources")

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

    # internal jargon / private notes, competitor put-downs, confidential material: sentence removed
    rewritten = []
    for pat, repl in INTERNAL_REWRITE:
        if re.search(pat, body, re.I):
            rewritten.append(re.search(pat, body, re.I).group(0))
            body = re.sub(pat, repl, body, flags=re.I)
    for name, pats, ok_msg, fix_msg in (
            ("internal", INTERNAL_RES, "No internal sales jargon or private-note wording",
             "Removed internal wording a prospect shouldn't see"),
            ("competitor", COMPETITOR_RES, "No claims about competitors",
             "Removed a disparaging or comparative claim about a competitor"),
            ("confidential", CONFIDENTIAL_RES, "No confidential or second-hand material",
             "Removed a sentence referring to confidential or second-hand information")):
        found = [m.group(0).strip()[:30] for p in pats for m in [p.search(body)] if m]
        if found:
            body = _filter_sentences(body, lambda sent, pats=pats: any(p.search(sent) for p in pats))
            add(name, "fixed", f"{fix_msg} ({', '.join(dict.fromkeys(found))})")
        elif name == "internal" and rewritten:
            add(name, "fixed", f"Rephrased internal wording: {', '.join(dict.fromkeys(w.lower() for w in rewritten))}")
        else:
            add(name, "pass", ok_msg)

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

    # unfilled template slots ("[Company]", "<first name>", "{{name}}") — [Your name] is expected
    slots = list(dict.fromkeys(PLACEHOLDER_RE.findall(subject + "\n" + body)))
    add("placeholders", "warn" if slots else "pass",
        f"Fill in before sending: {', '.join(slots[:4])}" if slots else "No unfilled placeholders besides [Your name]")

    # abusive words quoted from scraped text
    masked = moderation.mask(body)
    if masked != body:
        body = masked
        add("language", "fixed", "Masked offensive wording")

    # length (words between greeting and sign-off)
    core = re.sub(r"^(hi|hello|dear)[^\n]*\n", "", body, flags=re.I)
    core = re.split(r"\n\s*(best|kind|warm) regards", core, flags=re.I)[0]
    n = len(core.split())
    add("length", "pass" if 80 <= n <= 190 else "warn",
        f"{n} words" + ("" if 80 <= n <= 190 else " — aim for 80–190 so it reads in under a minute"))

    based_on = f"\n\n_Based on sources {', '.join(f'[{c}]' for c in cites)}._" if cites else ""
    return f"**Subject:** {subject}\n\n{body}{based_on}", checks
