"""Draft binary pass/fail criteria from the agent's prompt, knowledge base and real conversations,
and run the deterministic ones.

Each criterion is a yes/no question. `kind="check"` criteria carry a small `check` spec that code
evaluates for free; everything else goes to an LLM judge.
"""

from __future__ import annotations

import re

from .config import settings
from .connectors.base import ConnectorError
from .llm import Spend, chat, clip_prompt, parse_json

CHECK_TYPES = {
    "max_words": "every agent reply has at most `value` words",
    "max_chars": "every agent reply has at most `value` characters",
    "no_emoji": "no agent reply contains an emoji",
    "forbidden_phrase": "no agent reply contains `value` (case-insensitive)",
    "required_phrase": "at least one agent reply contains `value` (case-insensitive)",
    "regex_absent": "no agent reply matches the regex `value`",
}

_EMOJI = re.compile("[\U0001f300-\U0001faff\U00002600-\U000027bf\U0001f000-\U0001f2ff]")


def _regex(pattern: str) -> re.Pattern:
    """Compile a check's pattern. Models often write JavaScript-style \\u{1F600}; Python wants \\U0001F600."""
    pattern = re.sub(r"\\u\{([0-9a-fA-F]{1,6})\}", lambda m: f"\\U{int(m.group(1), 16):08x}", pattern)
    return re.compile(pattern, re.IGNORECASE)


def run_check(spec: dict, transcript: list[dict]) -> tuple[bool, str]:
    """Evaluate a deterministic check on agent turns. Returns (pass, reason)."""
    replies = [t["text"] for t in transcript if t["role"] == "agent"]
    kind, value = spec.get("type"), spec.get("value")
    if kind == "max_words":
        worst = max((len(r.split()) for r in replies), default=0)
        return worst <= int(value), f"Longest reply: {worst} words (limit {value})."
    if kind == "max_chars":
        worst = max((len(r) for r in replies), default=0)
        return worst <= int(value), f"Longest reply: {worst} characters (limit {value})."
    if kind == "no_emoji":
        bad = [r for r in replies if _EMOJI.search(r)]
        return not bad, "No emojis." if not bad else f"Emoji in: “{bad[0][:80]}”"
    if kind == "forbidden_phrase":
        bad = [r for r in replies if str(value).lower() in r.lower()]
        return not bad, "Not said." if not bad else f"Said “{value}”."
    if kind == "required_phrase":
        ok = any(str(value).lower() in r.lower() for r in replies)
        return ok, "Said it." if ok else f"Never said “{value}”."
    if kind == "regex_absent":
        try:
            rx = _regex(str(value))
        except re.error as e:
            return True, f"This check's pattern isn't valid ({e}); edit it in the rubric. Skipped."
        bad = [r for r in replies if rx.search(r)]
        return not bad, "No match." if not bad else f"Matched in: “{bad[0][:80]}”"
    return True, f"Unknown check type {kind!r}; skipped."


PROMPT = """You write evaluation rubrics for AI agents. Read the agent's system prompt, a sample of its
knowledge base and a few real conversations. Write 6-10 binary pass/fail criteria that a reviewer
would actually care about.

Rules:
- Each criterion is ONE yes/no question about the agent's behaviour in a conversation.
- Prefer criteria grounded in the prompt's explicit rules, in facts from the knowledge base, and in
  failure patterns visible in the real conversations.
- If a criterion can be checked by simple code, make it kind "check" and give a check spec using
  only these types: {check_types}. Otherwise kind "judge".
- Never write criteria that blame the knowledge base. It is the source of truth.
- The grader sees ONLY the conversation text, plus short fields the agent returns next to each reply
  (shown like "[status: Alert]"). It cannot see tool calls, retrieved documents, CRM writes or any
  internal step. Write every criterion so it can be decided from what is visible; e.g. "the price the
  agent quotes matches the price list", not "the price came from a tool call".
- A "check" criterion's text must say exactly what its one check tests (e.g. "Is every reply at most
  400 characters?"). If a rule has several parts, split it, or make it a "judge" criterion.
- severity: high (wrong facts, safety, money, privacy), medium, low (style).
- source: "prompt", "kb" or "data".
- appliesWhen: if the criterion only matters in some conversations, the situation in a few plain words,
  e.g. "the customer asks about returns". null if it applies to every conversation.

Return JSON: {{"criteria": [{{"text": str, "kind": "check"|"judge", "check": {{"type": str, "value": any}} | null,
"source": str, "severity": str, "appliesWhen": str | null, "passExample": str, "failExample": str}}]}}

SYSTEM PROMPT:
{prompt}

KNOWLEDGE BASE SAMPLE:
{kb}

REAL CONVERSATIONS (redacted):
{convs}
"""


_COND = re.compile(r"^\s*(?:when|whenever|if)\s+(.+?),\s*(?:does|do|is|the agent|agent|it|they)\b", re.IGNORECASE)


def applies_when(text: str) -> str | None:
    """'When asked about returns, does the agent...' -> 'asked about returns'. None means it always applies."""
    m = _COND.match(text)
    return m.group(1).strip() if m else None


def _fallback(prompt: str) -> list[dict]:
    """No LLM key: turn explicit rule lines in the prompt into judge criteria."""
    parts = re.split(r"\n|(?<=[.!?])\s+", prompt)
    lines = [re.sub(r"^[-*\d.)\s]+", "", line).strip() for line in parts]
    rules = [line for line in lines if 12 < len(line) < 200 and re.search(r"\b(never|always|only|must|don't|do not)\b", line, re.IGNORECASE)]
    out = [{"text": r.rstrip("."), "kind": "judge", "check": None, "source": "prompt", "severity": "medium",
            "passExample": "", "failExample": ""} for r in rules[:8]]
    out.append({"text": "Answers match the knowledge base", "kind": "judge", "check": None, "source": "kb",
                "severity": "high", "passExample": "", "failExample": ""})
    return out


async def draft(prompt: str, kb_chunks: list[str], conversations: list[dict], spend: Spend | None = None) -> list[dict]:
    kb = "\n".join(f"- {c[:300]}" for c in kb_chunks[:25]) or "(none)"
    convs = "\n\n".join(
        "\n".join(f"{m['role']}: {m['content'][:300]}" for m in c["messages"][:8]) for c in conversations[:6]
    ) or "(none)"
    try:
        text = await chat(
            [{"role": "user", "content": PROMPT.format(check_types=CHECK_TYPES, prompt=clip_prompt(prompt), kb=kb, convs=convs)}],
            settings.rubric_model, spend, json_mode=True, temperature=0.2, max_tokens=8000, reasoning="medium",
        )
        items = parse_json(text)
        items = items.get("criteria", []) if isinstance(items, dict) else items
    except (ConnectorError, ValueError, KeyError):
        items = _fallback(prompt)
    out = []
    for i, c in enumerate(items, 1):
        kind = "check" if c.get("kind") == "check" and (c.get("check") or {}).get("type") in CHECK_TYPES else "judge"
        out.append({
            "id": f"C{i}",
            "text": str(c.get("text", "")).strip().rstrip("?"),
            "kind": kind,
            "check": c.get("check") if kind == "check" else None,
            "source": c.get("source") if c.get("source") in ("prompt", "kb", "data") else "prompt",
            "severity": c.get("severity") if c.get("severity") in ("high", "medium", "low") else "medium",
            "status": "draft",
            "appliesWhen": (str(c.get("appliesWhen") or "").strip() or applies_when(str(c.get("text", "")))),
            "passExample": c.get("passExample", ""),
            "failExample": c.get("failExample", ""),
        })
    return [c for c in out if c["text"]]
