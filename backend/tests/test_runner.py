"""End-to-end run with the agent and models faked: exercises simulate → grade → triage → finalize,
the spend cap, and judge calibration."""

import asyncio
import sqlite3

import pytest

from hone import llm, recommend, runner, store


@pytest.fixture
def db(monkeypatch, tmp_path):
    c = sqlite3.connect(tmp_path / "t.db", check_same_thread=False)
    c.execute("create table docs (kind text, id text, project_id text, body text, "
              "updated_at text default current_timestamp, primary key (kind, id))")
    monkeypatch.setattr(store, "_db", c)
    # Keys come per request now (bring your own key); a test sets them the same way the API does.
    llm.use_keys(llm.Keys(openrouter="x", typesafe="x"))

    async def fake_reply(project, secret, transcript, session):
        return "Our Clarity Serum has 5% niacinamide 😀" if "oily" in transcript[-1]["text"] else "Happy to help."

    async def fake_chat(messages, model, spend=None, **kw):
        if spend:
            spend.add(0.001)
        return "[END]"

    async def fake_jev(state, questions, spend=None):
        if spend:
            spend.add(0.0009)
        return {q: 0.9 for q in questions}

    async def fake_read_agent(c):
        return {"name": "Fake", "model": "m", "prompt": "Be nice.", "tools": [], "memory": None, "kbNodes": [],
                "trigger": {"kind": None, "url": None}}

    monkeypatch.setattr(runner, "agent_reply", fake_reply)
    monkeypatch.setattr(runner, "read_agent", fake_read_agent)
    # No test ever reaches a real model: every module that calls one is faked.
    for mod in (runner, recommend):
        monkeypatch.setattr(mod, "chat", fake_chat)
        monkeypatch.setattr(mod, "jev", fake_jev)
    pid = "p1"
    store.put("project", pid, {"id": pid, "host": "custom", "pipeline": {"run": False}, "counts": {}}, pid)
    store.put("criteria", pid, [
        {"id": "C1", "text": "No emojis", "kind": "check", "check": {"type": "no_emoji"}, "status": "approved"},
        {"id": "C2", "text": "Answers match the KB", "kind": "judge", "status": "approved"},
    ], pid)
    store.put("kb", pid, ["Clarity Serum has 5% niacinamide"], pid)
    store.put("dataset", pid, [
        {"id": f"s{i}", "scenario": "x", "source": "real", "split": "dev",
         "opening": "serum for oily skin?" if i % 2 else "hello", "userTurns": []} for i in range(6)
    ], pid)
    return pid


def _run(pid, budget, k=3):
    store.put("run", "r1", {"id": "r1", "projectId": pid, "split": "dev", "k": k, "scenarios": 6, "budgetUsd": budget,
                            "status": "running", "costUsd": 0, "items": []}, pid)
    asyncio.run(runner.execute("r1"))
    return store.get("run", "r1")


def test_full_run(db):
    r = _run(db, budget=5)
    assert r["status"] == "done" and r["scenarios"] == 6
    # Odd scenarios get an emoji reply → fail the code check every trial.
    assert r["passK"] == 0.5 and r["pass1"] == 0.5
    c1 = next(c for c in r["perCriterion"] if c["criterionId"] == "C1")
    assert c1["failures"] == 9 and c1["trusted"] is True
    assert sum(r["triage"].values()) == 3
    assert 0 < r["costUsd"] <= 5
    assert store.get("project", db)["latest"]["passK"] == 0.5


def test_cap_stops_run(db):
    r = _run(db, budget=0.02)
    assert r["status"] == "stopped" and r["costUsd"] <= 0.02


def test_calibration(db):
    _run(db, budget=5)
    # Human agrees with the judge on all C2 trials → perfect TPR, no failures to measure TNR yet.
    for i, item in enumerate(store.get("run", "r1")["items"]):
        store.put("label", f"l{i}", {"id": f"l{i}", "criterionId": "C2", "value": True, "judge": True}, db)
    row = runner.calibration(db)[0]
    assert row["tpr"] == 1.0 and row["tnr"] is None and row["trusted"] is False


def test_not_applicable_is_excluded(db, monkeypatch):
    # C2 only applies when returns come up. The judge says it fails but also that returns never came up:
    # it must not fail the trial or count in its rate.
    crit = store.get("criteria", db)
    crit[1]["text"] = "When asked about returns, does the agent give the 30-day policy"
    crit[1].pop("appliesWhen", None)
    store.put("criteria", db, crit, db)
    async def jev_na(state, questions, spend=None):
        return {q: (0.1 if q.endswith("__applies") else 0.2) for q in questions}

    monkeypatch.setattr(runner, "jev", jev_na)
    r = _run(db, budget=5)
    c2 = next(c for c in r["perCriterion"] if c["criterionId"] == "C2")
    assert c2["applicable"] == 0 and c2["failures"] == 0 and c2["passRate"] == 1.0
    # Only the emoji check fails now, so the even scenarios pass every trial.
    assert r["passK"] == 0.5


def test_unconditional_criteria_always_apply(db, monkeypatch):
    asked = []

    async def spy(state, questions, spend=None):
        asked.extend(questions)
        return {q: 0.9 for q in questions}

    monkeypatch.setattr(runner, "jev", spy)
    _run(db, budget=5)
    assert asked and not any(q.endswith("__applies") for q in asked)


def test_applies_when_parsing():
    from hone.rubric import applies_when

    assert applies_when("When asked about returns, does the agent say 30 days") == "asked about returns"
    assert applies_when("When a customer describes a rash, burn, or infection, does the agent refer them") == \
        "a customer describes a rash, burn, or infection"
    assert applies_when("Does every reply stay under 80 words") is None


def test_improvement_loop(db, monkeypatch):
    """Run 1 fails C1 and recommends a fix. The agent changes; run 2 sees v2, marks the fix applied and
    measures it against run 1."""
    prompt = {"text": "Be nice."}

    async def read_agent(c):
        return {"name": "Fake", "model": "m", "prompt": prompt["text"], "tools": [], "memory": None,
                "kbNodes": [], "trigger": {"kind": None, "url": None}}

    async def rec_chat(messages, model, spend=None, **kw):
        return '{"recommendations": [{"title": "Ban emojis", "change": "Add: never use emojis.", ' \
               '"target": "prompt", "why": "C1 fails on emoji replies", "criterionIds": ["C1"]}]}'

    monkeypatch.setattr(runner, "read_agent", read_agent)
    monkeypatch.setattr(recommend, "chat", rec_chat)
    r1 = _run(db, budget=5)
    assert r1["agentVersion"] == 1 and r1["agentChanged"] is False and not r1["recommending"]
    recs = store.list_("recommendation", db)
    assert len(recs) == 1 and recs[0]["status"] == "open" and recs[0]["baseline"] == {"C1": 0.5}

    # The user edits the prompt. Same reply behaviour, so C1 doesn't move: outcome "no_change".
    prompt["text"] = "Be nice. Never use emojis."
    store.put("run", "r1", {**store.get("run", "r1"), "id": "r1"}, db)
    store.put("run", "r2", {"id": "r2", "projectId": db, "split": "dev", "k": 3, "scenarios": 6, "budgetUsd": 5,
                            "status": "running", "costUsd": 0, "items": []}, db)
    asyncio.run(runner.execute("r2"))
    r2 = store.get("run", "r2")
    assert r2["agentVersion"] == 2 and r2["agentChanged"] and "Prompt +" in r2["changeSummary"]
    rec = store.get("recommendation", recs[0]["id"])
    assert rec["status"] == "applied" and rec["appliedVersion"] == 2
    assert rec["outcome"] == "no_change" and rec["measuredInRun"] == "r2"


def test_snapshot_same_agent_same_version():
    from hone import snapshots

    a = {"name": "A", "model": "m", "prompt": "x", "tools": [{"name": "t", "description": "d"}], "kbNodes": []}
    b = {**a, "tools": [{"name": "t", "description": "d"}, {"name": "u", "description": ""}], "model": "m2"}
    d = snapshots.diff(snapshots.fingerprint(a), snapshots.fingerprint(b))
    assert d["toolsAdded"] == ["u"] and d["model"] == {"from": "m", "to": "m2"} and "prompt" not in d
    assert snapshots.digest(snapshots.fingerprint(a)) == snapshots.digest(snapshots.fingerprint(dict(a)))
    assert snapshots.summarize(d) == "Model m → m2 · tools added: u"


def test_version_recorded_before_run_is_still_checked(db, monkeypatch):
    """Custom-code uploads record the new version right away; the next run must still check it."""
    from hone import snapshots

    async def rec_chat(messages, model, spend=None, **kw):
        return '{"recommendations": [{"title": "Ban emojis", "change": "x", "target": "prompt", "why": "", "criterionIds": ["C1"]}]}'

    monkeypatch.setattr(recommend, "chat", rec_chat)
    _run(db, budget=5)
    new_agent = {"name": "Fake", "model": "m", "prompt": "Be nice. No emojis.", "tools": [], "memory": None, "kbNodes": [],
                 "trigger": {"kind": None, "url": None}}
    snapshots.record(db, new_agent)  # what the upload endpoint does

    async def read_agent(c):
        return new_agent

    monkeypatch.setattr(runner, "read_agent", read_agent)
    store.put("run", "r2", {"id": "r2", "projectId": db, "split": "dev", "k": 3, "scenarios": 6, "budgetUsd": 5,
                            "status": "running", "costUsd": 0, "items": []}, db)
    asyncio.run(runner.execute("r2"))
    r2 = store.get("run", "r2")
    assert r2["agentVersion"] == 2 and r2["agentChanged"] and r2["recsApplied"]


def test_unchanged_agent_reuses_recommendations(db, monkeypatch):
    """Run 2 on the same agent and rubric doesn't pay for new recommendations; it points to run 1's."""
    from hone import snapshots

    calls = {"n": 0}

    async def rec_chat(messages, model, spend=None, **kw):
        calls["n"] += 1
        return '{"recommendations": [{"title": "Ban emojis", "change": "x", "target": "prompt", "why": "", "criterionIds": ["C1"]}]}'

    monkeypatch.setattr(recommend, "chat", rec_chat)
    _run(db, budget=5)
    assert calls["n"] == 1
    agent = {"name": "Fake", "model": "m", "prompt": "Be nice.", "tools": [], "memory": None, "kbNodes": []}
    assert snapshots.compare(db, agent) == {"changed": False, "version": 1, "summary": None}

    store.put("run", "r2", {"id": "r2", "projectId": db, "split": "dev", "k": 3, "scenarios": 6, "budgetUsd": 5,
                            "status": "running", "costUsd": 0, "items": [], "createdAt": "2099-01-01"}, db)
    asyncio.run(runner.execute("r2"))
    r2 = store.get("run", "r2")
    assert calls["n"] == 1, "no second recommendation call"
    assert r2["agentVersion"] == 1 and not r2["agentChanged"]
    assert r2["recommendationsFrom"] == "r1" and "haven't changed" in r2["recommendationsSkipped"]

    # Change the rubric: now new advice is worth paying for.
    crit = store.get("criteria", db) + [{"id": "C3", "text": "Greets", "kind": "judge", "status": "approved"}]
    store.put("criteria", db, crit, db)
    store.put("run", "r3", {"id": "r3", "projectId": db, "split": "dev", "k": 3, "scenarios": 6, "budgetUsd": 5,
                            "status": "running", "costUsd": 0, "items": [], "createdAt": "2099-01-02"}, db)
    asyncio.run(runner.execute("r3"))
    assert calls["n"] == 2

    changed = {**agent, "prompt": "Be nice. No emojis."}
    cmp = snapshots.compare(db, changed)
    assert cmp["changed"] and cmp["version"] == 2 and cmp["summary"].startswith("Prompt")
    assert len(store.list_("snapshot", db)) == 1, "compare saves nothing"


def test_regex_check_accepts_js_unicode_escapes_and_never_crashes():
    from hone.rubric import run_check

    spec = {"type": "regex_absent", "value": "[\\u{1F600}-\\u{1FAFF}\\u{2600}-\\u{27BF}](?<!☺)(?<!🤍)"}
    ok = [{"role": "agent", "text": "Ciao ☺️ 🤍"}]
    bad = [{"role": "agent", "text": "Ciao 😀"}]
    assert run_check(spec, ok)[0] and not run_check(spec, bad)[0]
    assert run_check({"type": "regex_absent", "value": "(unclosed"}, bad)[0]  # invalid pattern: skipped, not a crash


def test_long_prompts_are_clipped_with_a_note_not_mid_sentence():
    from hone.llm import clip_prompt

    long = "\n".join(f"Rule {i}: be kind to the customer at all times." for i in range(2000))
    out = clip_prompt(long, 1000)
    assert out.endswith("characters.]") and "Hone stopped reading here" in out
    assert out.split("\n\n[Hone")[0].endswith("times."), "cut at a line break"
    assert clip_prompt("short") == "short"
