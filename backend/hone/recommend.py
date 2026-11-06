"""Recommended changes and the improvement loop.

1. After a run, `suggest` writes 3-5 concrete changes aimed at the failing criteria (one LLM call). Each
   remembers the pass rates of its target criteria at that moment: the baseline.
2. When a later run finds a new agent version, `check_applied` asks the judge, for every open
   recommendation, whether that version's diff carries it out. Yes -> status "applied" in that version.
3. When a run finishes on a version where recommendations were applied, `measure` compares their target
   criteria with the baseline (same split only) and records the outcome: improved, no change or worse.

The knowledge base is the source of truth: recommendations may say "add this missing answer to the KB"
(a scope gap), never "the KB is wrong".
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from . import store
from .config import settings
from .connectors.base import ConnectorError
from .llm import Spend, chat, clip_prompt, jev, keys, parse_json

SUGGEST_USD = 0.03  # reserved from the run's cap before suggesting
MOVE = 0.05  # a pass-rate change smaller than this counts as "no change"

PROMPT = """You improve AI agents. Below is an agent's prompt, its knowledge base (the source of truth,
never wrong), the criteria it failed in an evaluation with pass rates, why failures happened, and a few
failing conversations.

Write 3 to 5 recommended changes, most impactful first. Each must be concrete enough to apply in a few
minutes: quote or write the exact text to add or change. Target one place: "prompt" (or "prompt:<part
name>" for a multi-agent workflow), "knowledge_base" (only to ADD a missing answer for a scope gap), or
"tool". Don't recommend changes for criteria that passed.

Return JSON {{"recommendations": [{{"title": short imperative, "change": exact change, "target": str,
"why": one sentence tied to the evidence, "criterionIds": [ids it should fix]}}]}}

PROMPT:
{prompt}

KNOWLEDGE BASE (first entries):
{kb}

FAILING CRITERIA (pass rate over the conversations where each applied):
{failing}

WHY THINGS FAILED: {triage}

FAILING CONVERSATIONS:
{examples}

ALREADY RECOMMENDED AND NOT YET APPLIED (don't repeat these; suggest something different or skip):
{already}
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _failing(run: dict, criteria: dict[str, dict]) -> list[dict]:
    rows = [p for p in run.get("perCriterion", []) if p.get("applicable", 1) and p["passRate"] < 1]
    return [{"id": p["criterionId"], "text": criteria.get(p["criterionId"], {}).get("text", ""),
             "passRate": p["passRate"]} for p in sorted(rows, key=lambda p: p["passRate"])]


def _examples(run: dict, n: int = 3) -> str:
    out = []
    for item in run["items"]:
        if all(item["trials"]) or len(out) >= n:
            continue
        d = store.get("item", f"{run['id']}:{item['id']}") or {"details": []}
        t = next((t for t in d["details"] if not t["pass"]), None)
        if not t:
            continue
        convo = "\n".join(f"{'Customer' if m['role'] == 'user' else 'Agent'}: {m['text'][:400]}" for m in t["transcript"][:8])
        fails = ", ".join(cid for cid, r in t["results"].items() if not r["pass"])
        out.append(f"[{item['scenario']}] failed {fails}\n{convo}")
    return "\n\n".join(out) or "(none)"


async def suggest(run: dict, spend: Spend) -> list[dict]:
    """Write recommendations for a finished run and store them."""
    project_id = run["projectId"]
    criteria = {c["id"]: c for c in run.get("criteria") or store.get("criteria", project_id) or []}
    failing = _failing(run, criteria)
    if not failing or not keys().openrouter:
        return []
    agent = store.get("agent", project_id) or {}
    kb = store.get("kb", project_id) or []
    pending = [r for r in store.list_("recommendation", project_id) if r["status"] == "open"]
    text = await chat([{"role": "user", "content": PROMPT.format(
        prompt=clip_prompt(agent.get("prompt") or "(not available)"),
        kb="\n".join(f"- {c[:300]}" for c in kb[:30]) or "(none)",
        failing="\n".join(f"{f['id']} ({f['passRate']:.0%}): {f['text']}" for f in failing),
        triage=json.dumps(run.get("triage", {})),
        examples=_examples(run),
        already="\n".join(f"- {r['title']}" for r in pending) or "(none)",
    )}], settings.rubric_model, spend, json_mode=True, temperature=0.2, max_tokens=6000, reasoning="medium")
    items = parse_json(text)
    items = items.get("recommendations", []) if isinstance(items, dict) else items
    rates = {p["criterionId"]: p["passRate"] for p in run["perCriterion"] if p.get("applicable", 1)}
    out = []
    for r in items[:5]:
        if not isinstance(r, dict) or not r.get("title"):
            continue
        cids = [c for c in r.get("criterionIds") or [] if c in criteria]
        rec = {
            "id": f"rec-{uuid.uuid4().hex[:12]}",
            "projectId": project_id,
            "runId": run["id"],
            "snapshotId": run.get("snapshotId"),
            "agentVersion": run.get("agentVersion"),
            "split": run["split"],
            "createdAt": _now(),
            "title": str(r["title"])[:160],
            "change": str(r.get("change", ""))[:2000],
            "target": str(r.get("target", "prompt"))[:80],
            "why": str(r.get("why", ""))[:400],
            "criterionIds": cids,
            "baseline": {c: rates[c] for c in cids if c in rates},
            "status": "open",
            "appliedInSnapshot": None,
            "appliedVersion": None,
            "applyConfidence": None,
            "outcome": None,
            "measuredInRun": None,
            "after": None,
        }
        store.put("recommendation", rec["id"], rec, project_id)
        out.append(rec)
    return out


def _diff_text(snap: dict) -> str:
    d = snap.get("diff") or {}
    parts = [snap.get("changeSummary", "")]
    if p := d.get("prompt"):
        parts.append(p["unified"][:6000])
    for k in ("model", "toolsAdded", "toolsRemoved", "toolsChanged", "kbAdded", "kbRemoved", "partsAdded", "partsRemoved"):
        if d.get(k):
            parts.append(f"{k}: {d[k]}")
    return "\n".join(parts)


async def check_applied(project_id: str, snap: dict, spend: Spend) -> list[dict]:
    """For a new agent version, mark which open recommendations its changes carry out."""
    if snap["diff"].get("first"):
        return []
    recs = store.list_("recommendation", project_id)
    applied = []
    # Marked "applied" by hand before this version existed: this is the version they went into.
    for r in recs:
        if r["status"] == "applied" and not r.get("appliedInSnapshot"):
            r.update(appliedInSnapshot=snap["id"], appliedVersion=snap["version"])
            store.put("recommendation", r["id"], r, project_id)
            applied.append(r)
    open_recs = [r for r in recs if r["status"] == "open"]
    if not open_recs or not keys().typesafe and not keys().openrouter:
        return applied
    change = _diff_text(snap)
    qs = {r["id"]: {"instructions": "Does this change to the agent carry out the recommendation, fully or mostly? "
                                    f"Recommendation: {r['title']}. {r['change'][:800]}"} for r in open_recs}
    try:
        if keys().typesafe:
            probs = await jev({"change_to_agent": change}, qs, spend)
        else:
            raw = parse_json(await chat([{"role": "user", "content":
                f"CHANGE TO THE AGENT:\n{change}\n\nFor each recommendation id, the probability 0-1 that this change "
                f"carries it out. JSON {{id: p}}.\n" + json.dumps({k: v["instructions"] for k, v in qs.items()})}],
                settings.judge_model, spend, json_mode=True, temperature=0, max_tokens=800))
            probs = {k: float(v) for k, v in raw.items()}
    except (ConnectorError, ValueError):
        return applied
    for r in open_recs:
        p = probs.get(r["id"], 0.0)
        if p >= 0.5:
            r.update(status="applied", appliedInSnapshot=snap["id"], appliedVersion=snap["version"],
                     applyConfidence=round(p, 2), appliedAt=_now())
            store.put("recommendation", r["id"], r, project_id)
            applied.append(r)
    return applied


def measure(run: dict) -> list[dict]:
    """After a run, record how applied recommendations moved their target criteria."""
    rates = {p["criterionId"]: p["passRate"] for p in run.get("perCriterion", []) if p.get("applicable", 1)}
    done = []
    for r in store.list_("recommendation", run["projectId"]):
        if (r["status"] != "applied" or r.get("outcome") or r.get("appliedInSnapshot") != run.get("snapshotId")
                or r.get("split") != run["split"]):
            continue
        pairs = [(r["baseline"][c], rates[c]) for c in r["criterionIds"] if c in r["baseline"] and c in rates]
        if not pairs:
            continue
        delta = sum(after - before for before, after in pairs) / len(pairs)
        r.update(after={c: rates[c] for c in r["criterionIds"] if c in rates}, measuredInRun=run["id"],
                 delta=round(delta, 4), outcome="improved" if delta > MOVE else "worse" if delta < -MOVE else "no_change")
        store.put("recommendation", r["id"], r, run["projectId"])
        done.append(r)
    return done


def set_status(rec_id: str, status: str) -> dict:
    """Manual override: mark a recommendation applied, open again, or dismissed."""
    r = store.get("recommendation", rec_id)
    if not r:
        raise KeyError(rec_id)
    r["status"] = status
    if status == "applied" and not r.get("appliedInSnapshot"):
        # Tied to the next agent version Hone sees, which is where the change will show up.
        r.update(applyConfidence=None, appliedAt=_now())
    if status == "open":
        r.update(appliedInSnapshot=None, appliedVersion=None, applyConfidence=None, outcome=None, measuredInRun=None, after=None)
    store.put("recommendation", r["id"], r, r["projectId"])
    return r
