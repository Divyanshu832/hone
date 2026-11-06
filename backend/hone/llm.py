"""Model clients.

- OpenRouter: any chat model with one key. We ask for `usage.include` so every response carries its
  real cost in USD, which is what the budget cap is enforced against.
- TypeSafe Jev: typed yes/no judgments (`noul` = probability of yes). One call can ask many
  questions about the same transcript, so all LLM-judged criteria for a trial cost one call.

Keys (bring your own key): with accounts on, each organization's keys are saved in Supabase
(hone_org_keys) and loaded for every request. Without accounts, the browser sends them in the
`X-OpenRouter-Key` and `X-TypeSafe-Key` headers. Either way they're held in a context variable for that
request and the background work it starts (drafting, runs). The web app never falls back to the server's
.env keys; only the command-line tool (no request, so no context) uses them.
"""

from __future__ import annotations

import json
import re
from contextvars import ContextVar, Token
from dataclasses import dataclass

from .config import settings
from .connectors.base import ConnectorError, client

OPENROUTER = "https://openrouter.ai/api/v1/chat/completions"
TYPESAFE = "https://api.typesafe.ai/v1/systemone"
JEV_EST_USD_PER_CALL = 0.0009  # used until TypeSafe pricing is confirmed; planner uses the same figure


@dataclass(frozen=True)
class Keys:
    openrouter: str | None = None
    typesafe: str | None = None


_keys: ContextVar[Keys | None] = ContextVar("hone_keys", default=None)


def keys() -> Keys:
    """The keys for the current request (the user's own). Outside a request (the CLI): the server's .env."""
    return _keys.get() or Keys(settings.openrouter_key, settings.typesafe_key)


def use_keys(k: Keys) -> Token:
    return _keys.set(k)


def reset_keys(t: Token) -> None:
    _keys.reset(t)


@dataclass
class Spend:
    usd: float = 0.0

    def add(self, x: float) -> None:
        self.usd += x


async def chat(messages: list[dict], model: str, spend: Spend | None = None, json_mode: bool = False,
               temperature: float = 0.7, max_tokens: int = 800, reasoning: str | None = "low") -> str:
    """One OpenRouter chat call; returns the reply text and adds the real cost to `spend`.

    `reasoning` caps hidden thinking on reasoning models (GLM, DeepSeek, GPT-5...): their thinking counts
    against max_tokens, and unbounded it can use all of it and return an empty reply. Non-reasoning
    models ignore it. None = the model's default.
    """
    key = keys().openrouter
    if not key:
        raise ConnectorError("No OpenRouter key. Add yours in Settings.")
    body: dict = {"model": model, "messages": messages, "temperature": temperature,
                  "max_tokens": max_tokens, "usage": {"include": True}}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    if reasoning:
        body["reasoning"] = {"effort": reasoning, "exclude": True}
    async with client(headers={"Authorization": f"Bearer {key}",
                               "X-Title": "Hone"}) as c:
        r = await c.post(OPENROUTER, json=body)
    if r.status_code >= 400:
        raise ConnectorError(f"OpenRouter error {r.status_code}: {r.text[:200]}")
    data = r.json()
    if spend is not None:
        spend.add(float((data.get("usage") or {}).get("cost") or 0.0))
    return data["choices"][0]["message"]["content"] or ""


def parse_json(text: str) -> dict | list:
    """Models sometimes wrap JSON in prose or fences; take the first JSON value."""
    m = re.search(r"```(?:json)?\s*([\s\S]+?)```", text)
    s = m.group(1) if m else text
    start = min([i for i in (s.find("{"), s.find("[")) if i >= 0], default=0)
    return json.loads(s[start:])


async def jev(state: dict | str, questions: dict[str, dict], spend: Spend | None = None) -> dict[str, float]:
    """Ask Jev several yes/no questions about one state. Returns {question_id: P(yes)}."""
    key = keys().typesafe
    if not key:
        raise ConnectorError("No TypeSafe key. Add yours in Settings.")
    body = {
        "model": settings.jev_model,
        "state": state,
        "questions": {qid: {"type": "noul", **q} for qid, q in questions.items()},
    }
    async with client(headers={"Authorization": f"Bearer {key}"}) as c:
        r = await c.post(TYPESAFE, json=body)
    if r.status_code >= 400:
        raise ConnectorError(f"TypeSafe error {r.status_code}: {r.text[:200]}")
    if spend is not None:
        spend.add(JEV_EST_USD_PER_CALL)
    return {qid: float(a.get("noul", 0.0)) for qid, a in (r.json().get("answers") or {}).items()}


# GLM 5.3 reads up to 1M tokens (~4M characters). A million characters is far past any real agent
# prompt, so in practice the whole prompt is read; the cut below is only a safety net.
PROMPT_CHARS = 1_000_000


def clip_prompt(text: str, limit: int = PROMPT_CHARS) -> str:
    """An agent prompt for a model to read. Long prompts are cut at a line break with a clear note, so the
    reader never mistakes Hone's cut for a sentence missing from the agent's prompt."""
    if len(text) <= limit:
        return text
    cut = text.rfind("\n", 0, limit)
    cut = cut if cut > limit * 0.8 else limit
    return text[:cut] + f"\n\n[Hone stopped reading here: the prompt continues for another {len(text) - cut:,} characters.]"
