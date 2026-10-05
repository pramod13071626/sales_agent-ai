"""Abusive-language check for the copilot (no AI, no network).

check(text) → Verdict(abusive, masked, terms)
    Detects profanity, slurs and direct insults in English and Hindi / Hinglish, including common
    disguises: leetspeak (f4ck, $h1t), symbols inside words (f*ck, b!tch), spaced letters (f u c k)
    and stretched letters (fuuuck). Matches whole normalised words (plus a few unambiguous roots for
    compounds like "fucking", "motherfucker") so names and business words are not flagged
    (Scunthorpe, assessment, Dickson, cocktail, class, Niger, "BC province" …).
mask(text) → text with every flagged word replaced by its first letter + asterisks; spacing is kept.

Used by apps/sales_copilot/chat.py: an abusive message is answered with a fixed, polite refusal, is
stored masked, never searched and never sent to the AI. The AI's own output is masked the same way.
"""

import re
from dataclasses import dataclass, field
from typing import List

LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
                      "@": "a", "$": "s", "!": "i", "|": "i", "€": "e"})

# Whole words, compared after normalising and squeezing repeated letters ("fuuuck" → "fuck", "asshole" → "ashole").
WORDS = {
    # English profanity / insults
    "fuck", "fuk", "fck", "fuq", "fuc", "phuck", "fucker", "fucking", "fuckin", "fucked", "fucks", "mofo", "wtf", "stfu",
    "shit", "shite", "shity", "bulshit", "bitch", "bitches", "biatch", "bastard", "bastards", "ashole", "arsehole",
    "dickhead", "cunt", "cunts", "twat", "wanker", "slut", "whore", "prick", "retard", "retarded", "douche", "douchebag",
    "jackas", "dumbas", "dipshit", "pisoff", "moron", "idiot", "idiots",
    # starred / vowel-dropped spellings once the symbols are removed (f*cking → fcking, f**k → fk, sh*t → sht)
    "fk", "fking", "fkin", "fcking", "fckin", "fcked", "fcker", "fkd", "sht", "btch", "bstard", "cnt",
    # Slurs (the n-word is matched un-squeezed via RAW_ROOTS so the country "Niger" is not flagged)
    "fag", "faget", "niga", "nigas", "tranny", "spastic",
    # Hindi / Hinglish
    "chutiya", "chutia", "chotiya", "chutiye", "bhenchod", "behenchod", "bhanchod", "benchod", "bencho", "bhencho",
    "madarchod", "maderchod", "madarchot", "mc", "bc", "bsdk", "bhosdike", "bhosadike", "bhosdi", "bhosda", "gandu",
    "randi", "harami", "haramkhor", "kamina", "kamine", "kamini", "lodu", "lauda", "lavda", "loda", "lund", "jhant",
    "chodu", "kute", "kuta", "kutiya", "tati", "suar", "suwar", "ulu",
}
# "mc" / "bc" are abusive only in lower case and in a short message (never "BC province", "MC of the event").
SHORT_ABBREV = {"mc", "bc"}
# Unambiguous roots that also catch compounds ("motherfucking", "bullshitting", "chutiyapa").
ROOTS = ("fuck", "motherf", "bitch", "bulshit", "chutiy", "bhenchod", "behenchod", "benchod", "madarchod", "bhosd")
RAW_ROOTS = ("nigg",)                    # checked before squeezing repeated letters
# Insulting phrases aimed at the assistant or a person.
PHRASES = [r"\bshut\s*up\b", r"\bscrew\s+you\b", r"\bgo\s+to\s+hell\b", r"\byou\s+suck\b",
           r"\bstupid\s+(bot|ai|copilot|tool)\b", r"\buseless\s+(bot|ai|copilot|tool)\b",
           r"\byou('?re|\s+are)\s+(so\s+)?(stupid|useless|dumb|an?\s+idiot)\b",
           r"\bteri\s+(maa|ma|behen)\b", r"\bmaa\s+ki\b", r"\bbehen\s+ki\b"]
PHRASE_RE = re.compile("|".join(PHRASES), re.I)
SPACED_RE = re.compile(r"(?:\b[a-zA-Z0-9@$!*]\b[\s._\-]*){3,}")      # "f u c k", "f.u.c.k"
SPLIT_RE = re.compile(r"(?<=[a-zA-Z])[,;:?.](?=[a-zA-Z])")           # "idiot,you" → two words

REFUSAL = ("I can't help with messages that contain abusive or offensive language. "
           "Let's keep it professional — ask me about an account, a contact, a deal or your pipeline and I'll dig in.")


@dataclass
class Verdict:
    abusive: bool
    masked: str
    terms: List[str] = field(default_factory=list)


def _raw(tok: str) -> str:
    return re.sub(r"[^a-z]", "", tok.lower().translate(LEET))          # f*ck → fck, b.i.t.c.h → bitch


def _norm(tok: str) -> str:
    return re.sub(r"(.)\1+", r"\1", _raw(tok))                        # fuuuck → fuck


def _is_bad(tok: str, short_message: bool) -> bool:
    raw, norm = _raw(tok), _norm(tok)
    if any(r in raw for r in RAW_ROOTS):
        return True
    if not norm:
        return False
    if norm in SHORT_ABBREV:
        return short_message and not tok.strip(".,!?;:").isupper()
    if norm in WORDS:
        return True
    return len(norm) >= 5 and any(r in norm for r in ROOTS)


def _star(word: str) -> str:
    core = re.sub(r"^\W+|\W+$", "", word)
    return word.replace(core, core[:1] + "*" * max(2, len(core) - 1)) if core else word


def check(text: str) -> Verdict:
    text = text or ""
    short = len(re.findall(r"\S+", text)) <= 4
    terms: List[str] = []

    def per_token(m):
        tok = m.group(0)
        bad = [p for p in SPLIT_RE.split(tok) if _is_bad(p, short)]
        if not bad:
            return tok
        terms.extend(_norm(p) for p in bad)
        return _star(tok)

    masked = re.sub(r"\S+", per_token, text)                       # keeps the original spacing / indentation

    def per_spaced(m):
        if _is_bad(m.group(0), True):
            terms.append(_norm(m.group(0)))
            return "***" + (" " if m.group(0).endswith(" ") else "")
        return m.group(0)
    masked = SPACED_RE.sub(per_spaced, masked)

    for m in PHRASE_RE.finditer(text):
        terms.append(m.group(0).lower())
        masked = masked.replace(m.group(0), _star(m.group(0)))
    return Verdict(bool(terms), masked if terms else text, list(dict.fromkeys(terms)))


def mask(text: str) -> str:
    """Mask abusive words in text we show (e.g. the AI's answer quoting scraped content). Line breaks are kept."""
    if not text:
        return text
    return "\n".join(check(line).masked for line in text.split("\n"))
