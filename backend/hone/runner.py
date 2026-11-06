"""Run scenarios k times against the agent, grade every trial, triage failures, stream progress.

Flow per trial:
  1. Simulated customer (OpenRouter model) opens with the scenario's first message and continues
     in the style of the real customer, for up to MAX_TURNS turns.
  2. The agent replies through its connector (n8n sandbox trigger or custom endpoint).
  3. Deterministic checks run first (free). LLM-judged criteria go to Jev in ONE call per trial
     (or an OpenRouter judge if no TypeSafe key).
  4. A failed trial is triaged against the knowledge base: scope gap / answer / retrieval / behaviour.
Retell agents are graded offline on their real call transcripts (one trial per call, no simulation).

The $ cap is hard: before each trial the runner checks spend + estimated trial cost <= budget.
"""

from __future__ import annotations

import asyncio
import re
import uuid
from collections import defaultdict
from datetime import UTC, datetime

from . import recommend, snapshots, store
from .config import settings
from .connectors import custom, n8n, retell
from .connectors.base import ConnectorError
from .llm import Spend, chat, clip_prompt, jev, keys, parse_json
from .planner import AGENT_TURN_USD, AVG_TURNS, JUDGE_CALL_USD
from .rubric import applies_when, run_check
from .stats import bootstrap_ci, summarize

MAX_TURNS = 4
CONCURRENCY = 4

# run_id -> list of events; listeners wait on the condition.
_events: dict[str, list[dict]] = defaultdict(list)
_cond: dict[str, asyncio.Condition] = defaultdict(asyncio.Condition)


async def emit(run_id: str, event: dict) -> None:
    async with _cond[run_id]:
        _events[run_id].append(event)
        _cond[run_id].notify_all()


async def stream(run_id: str):
    """Yield events from the start; ends after 'done'."""
    i = 0
    while True:
        async with _cond[run_id]:
            while i >= len(_events[run_id]):
                await _cond[run_id].wait()
            batch = _events[run_id][i:]
            i = len(_events[run_id])
        for e in batch:
            yield e
            if e["type"] == "done":
                return


# ---------------- knowledge base retrieval (for grading and triage) ----------------
_WORD = re.compile(r"[a-z0-9]{3,}")


def relevant_kb(kb: list[str], text: str, n: int = 5) -> list[str]:
    q = set(_WORD.findall(text.lower()))
    if not q or not kb:
        return []
    scored = sorted(((len(q & set(_WORD.findall(c.lower()))), c) for c in kb), key=lambda x: -x[0])
    return [c for s, c in scored[:n] if s > 0]


# ---------------- simulated customer ----------------
SIM = """You are role-playing a CUSTOMER talking to a company's assistant. Stay in character.
Goal and style: {persona}
Reference messages from the real customer (match their intent and tone, not word for word):
{reference}

Reply with the customer's next message only. If the customer's need is resolved or they would end
the chat, reply exactly [END]. Keep it short, like a real chat message."""


async def next_user_turn(scn: dict, transcript: list[dict], spend: Spend) -> str | None:
    convo = [{"role": "assistant" if t["role"] == "user" else "user", "content": t["text"]}
             for t in transcript if t["role"] != "tool"]
    text = await chat(
        [{"role": "system", "content": SIM.format(persona=scn.get("persona") or scn["scenario"],
                                                  reference="\n".join(scn.get("userTurns", [])[:6]) or "(none)")},
         *convo],
        settings.sim_model, spend, temperature=0.8, max_tokens=500,
    )
    text = text.strip()
    return None if not text or "[END]" in text else text


async def read_agent(c: dict) -> dict:
    """Re-read the agent from its host, using the stored connection."""
    host = c.get("host")
    if host == "n8n":
        return await n8n.read(c.get("baseUrl") or "", c.get("apiKey") or "", c.get("sandboxUrl") or "")
    if host == "retell":
        return await retell.read(c.get("apiKey") or "", c.get("agentRef") or "")
    return custom.read(c.get("files") or [], c.get("endpointUrl"))


async def snapshot_for_run(run: dict, project: dict, secret: dict, spend: Spend) -> dict:
    """Which agent version this run tests. Re-reads the agent so edits made since the last run are seen;
    if the host can't be reached, falls back to the last version Hone read and says so on the run."""
    try:
        agent = await read_agent(secret)
        store.put("agent", project["id"], agent, project["id"])
        if agent.get("trigger", {}).get("url"):
            project["trigger"] = agent["trigger"]
            store.put("project", project["id"], project, project["id"])
        fresh = True
    except ConnectorError as e:
        agent = store.get("agent", project["id"]) or {}
        fresh = False
        run["agentReadError"] = str(e)[:200]
    snap = snapshots.record(project["id"], agent)
    # "Changed" means: different from the version the previous run tested. The version itself may have
    # been recorded earlier (e.g. when new custom-code files were uploaded).
    prev_run = next((r for r in store.list_("run", project["id"]) if r["id"] != run["id"] and r.get("snapshotId")), None)
    changed = bool(prev_run) and prev_run["snapshotId"] != snap["id"]
    run.update(snapshotId=snap["id"], agentVersion=snap["version"], agentChanged=changed, agentFresh=fresh,
               firstRun=prev_run is None,
               changeSummary=snap["changeSummary"] if changed else None)
    # The first run on a new version checks which open recommendations that version carries out.
    if not snap["diff"].get("first") and not snap.get("recsChecked"):
        run["recsApplied"] = [r["id"] for r in await recommend.check_applied(project["id"], snap, spend)]
        snap["recsChecked"] = True
        store.put("snapshot", snap["id"], snap, project["id"])
    store.put("run", run["id"], run, project["id"])
    return snap


async def agent_reply(project: dict, secret: dict, transcript: list[dict], session: str) -> str | tuple[str, dict]:
    if project["host"] == "n8n":
        return await n8n.send_full(project["trigger"], transcript[-1]["text"], session, transcript, secret.get("webhookFields"))
    if project["host"] == "custom":
        hist = [{"role": t["role"], "content": t["text"]} for t in transcript if t["role"] != "tool"]
        reply, _ = await custom.send(secret["endpointUrl"], secret.get("format", "openai"), hist, session)
        return reply
    raise ConnectorError("Retell agents are graded from their call transcripts, not simulated.")


async def simulate(project: dict, secret: dict, scn: dict, spend: Spend) -> list[dict]:
    session = f"hone-{uuid.uuid4().hex[:10]}"
    transcript = [{"role": "user", "text": scn["opening"]}]
    for turn in range(MAX_TURNS):
        try:
            reply = await agent_reply(project, secret, transcript, session)
        except ConnectorError:
            # One retry: a single flaky reply (timeout, empty body) shouldn't fail the whole trial.
            await asyncio.sleep(1)
            reply = await agent_reply(project, secret, transcript, session)
        spend.add(AGENT_TURN_USD / 2)  # the agent's own model cost isn't visible to us; estimate it
        reply, fields = reply if isinstance(reply, tuple) else (reply, {})
        transcript.append({"role": "agent", "text": reply, **({"fields": fields} if fields else {})})
        if turn == MAX_TURNS - 1:
            break
        nxt = await next_user_turn(scn, transcript, spend)
        if not nxt:
            break
        transcript.append({"role": "user", "text": nxt})
    return transcript


# ---------------- grading ----------------
def _render(transcript: list[dict]) -> str:
    """The conversation as the judge sees it: reply text, plus any fields returned with a reply."""
    def line(t: dict) -> str:
        meta = " ".join(f"[{k}: {v}]" for k, v in (t.get("fields") or {}).items())
        return f"{'Customer' if t['role'] == 'user' else 'Agent'}: {t['text']}" + (f" {meta}" if meta else "")
    return "\n".join(line(t) for t in transcript if t["role"] != "tool")


def _condition(c: dict) -> str | None:
    return c["appliesWhen"] if "appliesWhen" in c else applies_when(c["text"])


async def judge(criteria: list[dict], transcript: list[dict], kb: list[str], spend: Spend) -> dict[str, dict]:
    """LLM-judged criteria for one trial -> {criterion_id: {pass, reason, p, na}}.

    A criterion with a condition ("when asked about returns") also gets a second question: does that
    situation happen here? If not, it is marked not applicable instead of failing. The condition is asked
    on its own because judges answer "does X happen?" far more reliably than "does this rule apply?".
    """
    if not criteria:
        return {}
    state = {"conversation": _render(transcript), "knowledge_base": kb or ["(no knowledge base provided)"]}
    if keys().typesafe:
        qs = {}
        for c in criteria:
            q: dict = {"instructions": f"In this conversation, does the agent meet this requirement: {c['text']}? "
                                       "Treat the knowledge base as the source of truth for facts."}
            if c.get("passExample") and c.get("failExample"):
                q["criteria"] = {"true": c["passExample"], "false": c["failExample"]}
            qs[c["id"]] = q
            if cond := _condition(c):
                qs[f"{c['id']}__applies"] = {"instructions": f"Does this happen in the conversation: {cond}?"}
        probs = await jev(state, qs, spend)
        out = {}
        for c in criteria:
            p, applies = probs.get(c["id"], 0.0), probs.get(f"{c['id']}__applies", 1.0)
            if applies < 0.5:
                out[c["id"]] = {"pass": True, "reason": "Doesn't come up in this conversation.", "p": p, "na": True}
            else:
                out[c["id"]] = {"pass": p >= 0.5, "reason": f"Jev: {p:.0%} likely to pass.", "p": p, "na": False}
        return out
    prompt = (
        "You grade an AI agent's conversation. For each criterion first decide whether it applies (a criterion "
        "with an 'applies when' situation applies only if that situation happens; others always apply), then pass true/false "
        "with a one-sentence reason quoting the conversation. The knowledge base is the source of truth.\n\n"
        f"KNOWLEDGE BASE:\n{chr(10).join(kb) or '(none)'}\n\nCONVERSATION:\n{state['conversation']}\n\nCRITERIA:\n"
        + "\n".join(f"{c['id']}: {c['text']}" + (f" (applies when: {w})" if (w := _condition(c)) else "")
                    for c in criteria)
        + '\n\nReturn JSON {"<id>": {"applies": bool, "pass": bool, "reason": str}}'
    )
    out = parse_json(await chat([{"role": "user", "content": prompt}], settings.judge_model, spend,
                                json_mode=True, temperature=0, max_tokens=3000))
    res = {}
    conditional = {c["id"] for c in criteria if _condition(c)}
    for cid, v in (out or {}).items():
        if not isinstance(v, dict):
            continue
        if v.get("applies") is False and cid in conditional:
            res[cid] = {"pass": True, "reason": "Doesn't come up in this conversation.", "p": 1.0, "na": True}
        else:
            ok = bool(v.get("pass"))
            res[cid] = {"pass": ok, "reason": str(v.get("reason", "")), "p": 1.0 if ok else 0.0, "na": False}
    return res


async def triage(transcript: list[dict], kb: list[str], spend: Spend) -> str:
    """Why a failed trial failed. The KB is never blamed: missing knowledge is a scope gap."""
    if not kb:
        return "behaviour"
    state = {"conversation": _render(transcript), "knowledge_base": kb}
    qs = {
        "kb_has_answer": {"instructions": "Does the knowledge base contain the information needed to answer what the customer asked?"},
        "contradicts": {"instructions": "Does any agent reply state a fact that contradicts the knowledge base?"},
        "uses_kb": {"instructions": "Do the agent's replies use the relevant facts from the knowledge base?"},
    }
    try:
        if keys().typesafe:
            p = await jev(state, qs, spend)
        else:
            raw = parse_json(await chat([{"role": "user", "content":
                f"{state}\nAnswer each with a probability 0-1 as JSON {{id: p}}: " + str({k: v['instructions'] for k, v in qs.items()})}],
                settings.judge_model, spend, json_mode=True, temperature=0, max_tokens=800))
            p = {k: float(v) for k, v in raw.items()}
    except (ConnectorError, ValueError):
        return "behaviour"
    if p.get("kb_has_answer", 1) < 0.5:
        return "scope_gap"
    if p.get("contradicts", 0) >= 0.5:
        return "answer"
    if p.get("uses_kb", 1) < 0.5:
        return "retrieval"
    return "behaviour"


async def grade_trial(criteria: list[dict], transcript: list[dict], kb_all: list[str], spend: Spend) -> dict:
    kb = relevant_kb(kb_all, " ".join(t["text"] for t in transcript))
    results: dict[str, dict] = {}
    for c in criteria:
        if c["kind"] == "check" and c.get("check"):
            ok, why = run_check(c["check"], transcript)
            results[c["id"]] = {"pass": ok, "reason": why, "p": 1.0 if ok else 0.0, "na": False}
    judged = [c for c in criteria if c["id"] not in results]
    results.update(await judge(judged, transcript, kb, spend))
    passed = all(v["pass"] for v in results.values())
    return {
        "pass": passed,
        "results": results,
        "triage": None if passed else await triage(transcript, kb, spend),
        "kb": kb,
    }


# ---------------- the run ----------------
def trial_estimate(judge_criteria: int, offline: bool) -> float:
    agent = 0 if offline else AGENT_TURN_USD * AVG_TURNS
    return agent + JUDGE_CALL_USD * (1 if keys().typesafe else judge_criteria) * 2


async def execute(run_id: str) -> None:
    run = store.get("run", run_id)
    project = store.get("project", run["projectId"])
    secret = store.get("secret", project["id"]) or {}
    criteria = [c for c in (store.get("criteria", project["id"]) or []) if c.get("status") == "approved"] or (
        store.get("criteria", project["id"]) or [])
    kb_all = store.get("kb", project["id"]) or []
    scenarios = [s for s in (store.get("dataset", project["id"]) or []) if s["split"] == run["split"]]
    scenarios = scenarios[: run["scenarios"]]
    offline = project["host"] == "retell"
    k = 1 if offline else run["k"]
    spend = Spend()
    run["criteria"] = criteria  # the rubric this run used, kept with the run for history
    try:
        await snapshot_for_run(run, project, secret, spend)
    except Exception as e:  # noqa: BLE001 -- recording the version must never block a run
        run["agentReadError"] = f"Couldn't record the agent version ({type(e).__name__})."
    est = trial_estimate(sum(c["kind"] == "judge" for c in criteria), offline)
    sem = asyncio.Semaphore(CONCURRENCY)
    done = 0
    stopped = False
    reserved = 0.0  # estimated cost of trials in flight, so parallel trials can't overshoot the cap
    lock = asyncio.Lock()

    async def one(scn: dict) -> None:
        nonlocal done, stopped, reserved
        trials, details = [], []
        async with sem:
            for _ in range(k):
                async with lock:
                    if stopped or spend.usd + reserved + est > run["budgetUsd"]:
                        stopped = True
                        break
                    reserved += est
                try:
                    transcript = scn["transcript"] if offline else await simulate(project, secret, scn, spend)
                    g = await grade_trial(criteria, transcript, kb_all, spend)
                except ConnectorError as e:
                    transcript, g = [{"role": "agent", "text": f"[error] {e}"}], {"pass": False, "results": {}, "triage": "behaviour", "kb": []}
                finally:
                    async with lock:
                        reserved -= est
                trials.append(g["pass"])
                details.append({"transcript": transcript, **g})
        if not trials:
            return
        failed = sorted({cid for d in details for cid, r in d["results"].items() if not r["pass"]})
        item = {
            "id": scn["id"],
            "scenario": scn["scenario"],
            "source": scn["source"],
            "trials": trials,
            "failedCriteria": failed,
            "triage": next((d["triage"] for d in details if d["triage"]), None),
        }
        store.put("item", f"{run_id}:{scn['id']}", {"item": item, "details": details}, project["id"])
        async with lock:
            run["items"].append(item)
            done += 1
            run["costUsd"] = round(spend.usd, 4)
        await emit(run_id, {"type": "failure" if not all(trials) else "progress", "done": done,
                            "total": len(scenarios), "costUsd": run["costUsd"], "item": item})

    await asyncio.gather(*(one(s) for s in scenarios))
    run["recommending"] = True
    finalize(run, criteria, k, stopped)
    await emit(run_id, {"type": "done", "done": done, "total": len(scenarios), "costUsd": run["costUsd"]})
    await close_loop(run, spend)


async def close_loop(run: dict, spend: Spend) -> None:
    """After a run: measure applied recommendations, then suggest new ones if the cap allows."""
    try:
        run["recsMeasured"] = [r["id"] for r in recommend.measure(run)]
        same = same_as_before(run)
        if same:
            # Same agent and same rubric as a run that already has recommendations: asking again would
            # cost tokens for the same advice. Point to the earlier ones instead.
            run["recommendations"], run["recommendationsFrom"] = [], same["id"]
            run["recommendationsSkipped"] = (f"The agent and rubric haven't changed since {same['id']}, so its "
                                             "recommendations still apply. Apply one, then run again.")
        elif spend.usd + recommend.SUGGEST_USD <= run["budgetUsd"]:
            run["recommendations"] = [r["id"] for r in await recommend.suggest(run, spend)]
        else:
            run["recommendations"], run["recommendationsSkipped"] = [], "Not enough budget left to write recommendations."
    except (ConnectorError, ValueError, KeyError) as e:
        run["recommendations"], run["recommendationsSkipped"] = [], f"Couldn't write recommendations ({type(e).__name__})."
    run["recommending"] = False
    run["costUsd"] = round(spend.usd, 4)
    store.put("run", run["id"], run, run["projectId"])


def _rubric_key(criteria: list[dict] | None) -> list:
    return sorted((c.get("id"), c.get("text"), c.get("kind"), c.get("appliesWhen")) for c in criteria or [])


def same_as_before(run: dict) -> dict | None:
    """The latest earlier run on the same agent version and rubric that wrote recommendations, if any."""
    if not run.get("snapshotId") or run.get("agentChanged"):
        return None
    runs = sorted(store.list_("run", run["projectId"]), key=lambda r: r.get("createdAt", ""), reverse=True)
    for r in runs:
        if r["id"] == run["id"] or r.get("status") not in ("done", "stopped"):
            continue
        if r.get("snapshotId") != run["snapshotId"]:
            return None  # an older version: this run is the first on the current one
        if r.get("recommendations") and _rubric_key(r.get("criteria")) == _rubric_key(run.get("criteria")):
            return r
        if r.get("recommendationsFrom"):
            src = store.get("run", r["recommendationsFrom"])
            if src and _rubric_key(src.get("criteria")) == _rubric_key(run.get("criteria")):
                return src
    return None


def finalize(run: dict, criteria: list[dict], k: int, stopped: bool) -> None:
    items = run["items"]
    trials = [i["trials"] for i in items]
    pk, p1 = summarize(trials, k)
    lo, hi = bootstrap_ci(trials, k)
    judges = {j["criterionId"]: j for j in calibration(run["projectId"])}
    per = []
    details = [t for i in items for t in (store.get("item", f"{run['id']}:{i['id']}") or {"details": []})["details"]]
    for c in criteria:
        rs = [t["results"][c["id"]] for t in details if c["id"] in t["results"] and not t["results"][c["id"]].get("na")]
        fails = sum(1 for r in rs if not r["pass"])
        per.append({"criterionId": c["id"], "passRate": round(1 - fails / len(rs), 4) if rs else 1.0,
                    "applicable": len(rs),
                    "trusted": c["kind"] == "check" or judges.get(c["id"], {}).get("trusted", False), "failures": fails})
    triage_counts = {"retrieval": 0, "answer": 0, "scope_gap": 0, "behaviour": 0}
    for i in items:
        if i["triage"]:
            triage_counts[i["triage"]] += 1
    run.update({
        "status": "stopped" if stopped else "done",
        "scenarios": len(items),
        "k": k,
        "passK": pk,
        "pass1": p1,
        "ci": [lo, hi],
        "perCriterion": per,
        "triage": triage_counts,
        "trusted": all(p["trusted"] for p in per) if per else False,
    })
    store.put("run", run["id"], run, run["projectId"])
    project = store.get("project", run["projectId"])
    prev = project.get("latest")
    project["latest"] = {"runId": run["id"], "split": run["split"], "agentVersion": run.get("agentVersion"), "passK": pk, "pass1": p1, "k": k, "trusted": run["trusted"],
                         "deltaPassK": (pk - prev["passK"]) if prev else None,
                         "at": datetime.now(UTC).isoformat()}
    project["pipeline"]["run"] = True
    store.put("project", project["id"], project, project["id"])


# ---------------- calibration ----------------
def calibration(project_id: str) -> list[dict]:
    """Per judged criterion: TPR/TNR vs human labels, corrected pass rate on the latest run."""
    from .stats import corrected_with_ci, is_trusted, judge_rates

    criteria = store.get("criteria", project_id) or []
    labels = store.list_("label", project_id)
    runs = [r for r in store.list_("run", project_id) if r.get("status") in ("done", "stopped")]
    latest = runs[0] if runs else None
    out = []
    for c in criteria:
        if c["kind"] != "judge":
            continue
        pairs = [(lab["value"], lab["judge"]) for lab in labels if lab["criterionId"] == c["id"] and lab["value"] is not None]
        judge_passes: list[bool] = []
        if latest:
            for i in latest["items"]:
                d = store.get("item", f"{latest['id']}:{i['id']}") or {"details": []}
                judge_passes += [t["results"][c["id"]]["pass"] for t in d["details"]
                                 if c["id"] in t["results"] and not t["results"][c["id"]].get("na")]
        tpr, tnr = judge_rates(pairs) if pairs else (None, None)
        corrected, ci = corrected_with_ci(pairs, judge_passes) if pairs and judge_passes else (None, None)
        out.append({
            "criterionId": c["id"],
            "judge": "Jev (TypeSafe)" if keys().typesafe else f"{settings.judge_model} (OpenRouter)",
            "labels": len(pairs), "target": 60, "tpr": tpr, "tnr": tnr,
            "rawPass": (sum(judge_passes) / len(judge_passes)) if judge_passes else 0.0,
            "corrected": corrected, "ci": list(ci) if ci else None,
            "trusted": len(pairs) >= 40 and is_trusted(tpr, tnr),
        })
    return out


# ---------------- scenario generation for gaps ----------------
GEN = """Write {n} realistic test scenarios for this AI agent. Ground every scenario in the knowledge base
or the agent's rules, and cover what the real conversations below do NOT already cover (edge cases,
unhappy customers, out-of-scope asks, multi-step requests). Return JSON
{{"scenarios": [{{"scenario": short title, "opening": customer's first message, "persona": one line on goal and tone}}]}}

AGENT PROMPT:
{prompt}

KNOWLEDGE BASE:
{kb}

REAL CONVERSATIONS ALREADY COVERED (first messages):
{covered}"""


async def generate(prompt: str, kb: list[str], covered: list[str], n: int, spend: Spend | None = None) -> list[dict]:
    if n <= 0:
        return []
    out: list[dict] = []
    while len(out) < n:
        batch = min(25, n - len(out))
        text = await chat([{"role": "user", "content": GEN.format(
            n=batch, prompt=clip_prompt(prompt), kb="\n".join(f"- {c[:200]}" for c in kb[:40]) or "(none)",
            covered="\n".join(f"- {c[:120]}" for c in covered[:60]) or "(none)")}],
            settings.rubric_model, spend, json_mode=True, temperature=0.9, max_tokens=8000)
        items = parse_json(text)
        items = items.get("scenarios", []) if isinstance(items, dict) else items
        if not items:
            break
        out += [s for s in items if s.get("opening")]
    return out[:n]
