"""CSV ingest: column mapping, grouping into conversations, PII redaction, sufficiency, 80/20 split."""

from __future__ import annotations

import csv
import hashlib
import io
import re
from dataclasses import dataclass, field

AGENT_WORDS = ("agent", "bot", "ai", "assistant", "system", "outbound", "model", "outgoing")


def normalise_role(v: str | None) -> str:
    x = (v or "").strip().lower()
    return "agent" if any(x == w or x.startswith(w) for w in AGENT_WORDS) else "user"


# --- PII redaction -------------------------------------------------------------------------------
# Applied before any text reaches a third-party model. Deliberately conservative: it over-redacts.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("EMAIL", re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")),
    ("CARD", re.compile(r"\b(?:\d[ -]?){13,19}\b")),
    ("SSN", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    ("PHONE", re.compile(r"(?<!\w)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}(?!\w)")),
    ("IBAN", re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b")),
    ("POSTCODE", re.compile(r"\b\d{5}(?:-\d{4})?\b")),
]
_NAME_INTRO = re.compile(r"\b(my name is|this is|i am|i'm|speaking with|mr\.?|mrs\.?|ms\.?)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)")


def redact(text: str) -> str:
    out = text
    for label, pat in _PATTERNS:
        out = pat.sub(f"[{label}]", out)
    out = _NAME_INTRO.sub(lambda m: f"{m.group(1)} [NAME]", out)
    return out


def pseudonym(value: str) -> str:
    """Stable, non-reversible ID so grouping survives redaction."""
    return "c_" + hashlib.sha256(value.encode()).hexdigest()[:10]


# --- Parsing and grouping ------------------------------------------------------------------------
@dataclass
class Mapping:
    group_by: str
    group_kind: str  # "conversation" | "customer"
    role: str
    content: str
    created_at: str | None = None


@dataclass
class Conversation:
    id: str
    messages: list[dict] = field(default_factory=list)  # {role, content, at}


def read_csv(data: bytes) -> tuple[list[str], list[dict[str, str]]]:
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows = [r for r in reader if any((v or "").strip() for v in r.values())]
    return list(reader.fieldnames or []), rows


_CANDS = {
    "conversation": ["conversationid", "conversation", "convid", "threadid", "sessionid", "callid", "chatid", "ticketid"],
    "customer": ["customerid", "customer", "userid", "contactid", "phone", "clientid", "leadid"],
    "role": ["role", "sender", "speaker", "from", "author", "who", "type", "direction"],
    "content": ["content", "message", "text", "body", "utterance", "transcript", "msg"],
    "created_at": ["createdat", "timestamp", "time", "date", "datetime", "sentat", "created"],
}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def _find(cols: list[str], names: list[str]) -> str | None:
    for c in cols:
        if _norm(c) in names:
            return c
    for c in cols:
        if any(n in _norm(c) for n in names):
            return c
    return None


def guess_mapping(cols: list[str], rows: list[dict[str, str]]) -> Mapping:
    conv, cust = _find(cols, _CANDS["conversation"]), _find(cols, _CANDS["customer"])
    content = _find(cols, _CANDS["content"])
    if not content:
        sample = rows[:50]
        content = max(cols, key=lambda c: sum(len(r.get(c) or "") for r in sample))
    return Mapping(
        group_by=conv or cust or cols[0],
        group_kind="conversation" if conv or not cust else "customer",
        role=_find(cols, _CANDS["role"]) or cols[1],
        content=content,
        created_at=_find(cols, _CANDS["created_at"]),
    )


def group(rows: list[dict[str, str]], m: Mapping, redact_text: bool = True) -> list[Conversation]:
    by: dict[str, Conversation] = {}
    for r in rows:
        gid = (r.get(m.group_by) or "").strip()
        content = (r.get(m.content) or "").strip()
        if not gid or not content:
            continue
        cid = pseudonym(gid)
        conv = by.setdefault(cid, Conversation(cid))
        conv.messages.append({
            "role": normalise_role(r.get(m.role)),
            "content": redact(content) if redact_text else content,
            "at": r.get(m.created_at) if m.created_at else None,
        })
    if m.created_at:
        for c in by.values():
            c.messages.sort(key=lambda x: x["at"] or "")
    return list(by.values())


@dataclass
class Sufficiency:
    conversations: int
    usable: int
    decision: str  # enough | fill_gaps | mostly_generated
    generate: int
    dev: int
    test: int
    sentence: str


def sufficiency(convs: list[Conversation], target: int = 100) -> Sufficiency:
    usable = sum(1 for c in convs if len(c.messages) >= 2 and any(x["role"] == "agent" for x in c.messages))
    generate = max(0, target - usable)
    decision = "enough" if usable >= target else "fill_gaps" if usable >= 20 else "mostly_generated"
    total = usable + generate
    test = round(total * 0.2)
    sentence = {
        "enough": f"You have {usable} usable conversations. That's enough, so I won't generate any.",
        "fill_gaps": f"You have {usable} usable conversations. I'll generate {generate} more to cover the gaps, "
        "using yours as the reference.",
        "mostly_generated": f"You have {usable} usable conversations. I'll generate {generate}, styled on yours "
        "and grounded in your knowledge base.",
    }[decision]
    return Sufficiency(len(convs), usable, decision, generate, total - test, test, sentence)


def split(ids: list[str], test_share: float = 0.2) -> tuple[list[str], list[str]]:
    """Deterministic 80/20 split by hashing the ID, so a conversation never moves between splits."""
    test = [i for i in ids if int(hashlib.sha256(i.encode()).hexdigest(), 16) % 100 < test_share * 100]
    tset = set(test)
    return [i for i in ids if i not in tset], test
