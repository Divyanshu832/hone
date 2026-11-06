"""Hone API (FastAPI). Every response matches the shapes in ui/lib/types.ts.

Run:  uv run uvicorn hone.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import auth, ingest, recommend, rubric, runner, snapshots, store
from .config import settings
from .connectors import custom, n8n, retell, supabase
from .connectors.base import ConnectorError
from .llm import Keys, Spend, keys, reset_keys, use_keys

app = FastAPI(title="Hone", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["*"], allow_headers=["*"])

API = "/api/v1"
log = logging.getLogger("hone")
_workspace: ContextVar[str | None] = ContextVar("hone_workspace", default=None)
_me: ContextVar[dict | None] = ContextVar("hone_me", default=None)


_OPEN = (f"{API}/health", f"{API}/auth/config")


def _deny(status: int, msg: str):
    from fastapi.responses import JSONResponse

    return JSONResponse({"detail": msg}, status_code=status)


def _owns_doc(p: dict) -> bool:
    """Who can see a project.
    - With accounts: its owner, and, if it's shared with the organization, everyone in that organization.
      Nobody in another organization, ever. Projects with no owner are hidden.
    - Without accounts: the browser workspace that made it (projects made before workspaces existed stay
      visible locally, never on a public host)."""
    me = _me.get()
    if auth.ENABLED:
        if not me or not p.get("ownerId"):
            return False
        return p["ownerId"] == me["id"] or (
            p.get("visibility") == "org" and bool(me.get("org_id")) and p.get("orgId") == me["org_id"])
    ws = p.get("workspace")
    return ws == _workspace.get() or (not ws and not settings.public)


def _owns(pid: str | None) -> bool:
    """Projects belong to an organization (when signed in) or a browser workspace (without accounts).
    Projects made before either existed stay visible locally, never on a public host."""
    p = store.get("project", pid) if pid else None
    return not p or _owns_doc(p)  # a missing project gets the route's own 404


def _project_of(path: str) -> str | None:
    if m := re.match(rf"{API}/projects/([^/]+)", path):
        return m.group(1)
    if m := re.match(rf"{API}/runs/([^/]+)", path):
        return (store.get("run", m.group(1)) or {}).get("projectId")
    if m := re.match(rf"{API}/recommendations/([^/]+)", path):
        return (store.get("recommendation", m.group(1)) or {}).get("projectId")
    return None


@app.middleware("http")
async def bring_your_own_key(request: Request, call_next):
    """Model keys for this request (and the background work it starts): the organization's saved keys when
    signed in, else the keys the browser sends in headers. No fallback to the server's keys.

    With accounts on, every call (except health, sign-in config and reading an invite) needs a signed-in
    person, and their organization is the workspace. Without accounts, the browser's workspace header is."""
    path = request.url.path
    ws = request.headers.get("x-hone-workspace") or None
    t3 = _me.set(None)
    if auth.ENABLED and path.startswith(API) and request.method != "OPTIONS" and path not in _OPEN \
            and not (request.method == "GET" and path.startswith(f"{API}/invites/")):
        token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        try:
            user = await auth.user_for(token) if token else None
            prof = await auth.profile(user) if user else None
        except (store.StoreError, httpx.HTTPError) as e:
            log.warning("sign-in check failed: %s", e)
            _me.reset(t3)
            return _deny(503, "Can't reach the sign-in service right now. Try again in a moment.")
        if not prof:
            _me.reset(t3)
            return _deny(401, "Sign in to continue.")
        _me.set(prof)
        ws = prof.get("org_id")
        if not ws and path not in (f"{API}/me", f"{API}/orgs") and not path.startswith(f"{API}/invites/"):
            _me.reset(t3)
            return _deny(403, "Create or join an organization first.")
    # Bring your own key, always: signed in, the organization's saved keys; otherwise the keys the browser
    # sends. The server's own .env keys are never used for web requests (only by the command-line tool).
    if _me.get() and ws:
        try:
            ok = await auth.org_keys_raw(ws)
        except (store.StoreError, httpx.HTTPError) as e:
            log.warning("loading organization keys failed: %s", e)
            ok = {}
        k = Keys(ok.get("openrouter"), ok.get("typesafe"))
    else:
        k = Keys(request.headers.get("x-openrouter-key") or None, request.headers.get("x-typesafe-key") or None)
    t1, t2 = use_keys(k), _workspace.set(ws)
    try:
        # Browsers send a CORS preflight (OPTIONS, no credentials) before every call: let CORS answer it.
        if request.method != "OPTIONS" and not _owns(_project_of(path)):
            return _deny(404, "Not found")
        return await call_next(request)
    finally:
        reset_keys(t1)
        _workspace.reset(t2)
        _me.reset(t3)


@app.exception_handler(ConnectorError)
async def _connector_error(_, exc: ConnectorError):
    from fastapi.responses import PlainTextResponse

    return PlainTextResponse(str(exc), status_code=400)


@app.exception_handler(auth.AuthError)
async def _auth_error(_, exc: auth.AuthError):
    return _deny(exc.status, str(exc))


@app.exception_handler(store.StoreError)
async def _store_error(_, exc: store.StoreError):
    from fastapi.responses import PlainTextResponse

    return PlainTextResponse(str(exc), status_code=503)


def now() -> str:
    return datetime.now(UTC).isoformat()


# ---------------- connections (wizard) ----------------
class ConnectIn(BaseModel):
    host: str
    baseUrl: str | None = None
    apiKey: str | None = None
    sandboxUrl: str | None = None
    endpointUrl: str | None = None
    format: str = "openai"
    agentRef: str | None = None
    files: list[dict] = Field(default_factory=list)
    webhookFields: dict[str, str] = Field(default_factory=dict)  # fixed sample values for an n8n Webhook body


@app.get(f"{API}/health")
async def health():
    k = keys()
    return {"ok": True, "openrouter": bool(k.openrouter), "typesafe": bool(k.typesafe),
            "public": settings.public,
            "storage": store.health(), "accounts": auth.ENABLED}


# ---------------- accounts ----------------
@app.get(f"{API}/auth/config")
async def auth_config():
    return auth.config()


def _profile() -> dict:
    p = _me.get()
    if not p:
        raise HTTPException(400, "Accounts aren't turned on for this Hone.")
    return p


class NameIn(BaseModel):
    name: str


class InviteIn(BaseModel):
    email: str
    role: str = "member"


@app.get(f"{API}/me")
async def get_me():
    return await auth.me(_profile())


@app.patch(f"{API}/me")
async def update_me(body: NameIn):
    return await auth.update_name(_profile(), body.name)


@app.post(f"{API}/orgs")
async def create_org(body: NameIn):
    return await auth.create_org(_profile(), body.name)


@app.patch(f"{API}/org")
async def rename_org(body: NameIn):
    return await auth.rename_org(_profile(), body.name)


@app.get(f"{API}/org/members")
async def org_members():
    return await auth.team(_profile())


@app.post(f"{API}/org/invites")
async def create_invite(body: InviteIn):
    return await auth.invite(_profile(), body.email, body.role)


@app.delete(f"{API}/org/invites/{{iid}}")
async def revoke_invite(iid: str):
    await auth.revoke_invite(_profile(), iid)
    return {"ok": True}


@app.delete(f"{API}/org/members/{{uid}}")
async def remove_member(uid: str):
    await auth.remove_member(_profile(), uid)
    return {"ok": True}


class OrgKeysIn(BaseModel):
    openrouter: str | None = None
    typesafe: str | None = None


@app.get(f"{API}/org/keys")
async def get_org_keys():
    return await auth.org_keys(_profile())


@app.put(f"{API}/org/keys")
async def put_org_keys(body: OrgKeysIn):
    return await auth.save_org_keys(_profile(), body.model_dump(exclude_unset=True))


@app.get(f"{API}/invites/{{token}}")
async def invite_info(token: str):
    if not auth.ENABLED:
        raise HTTPException(404, "Accounts aren't turned on for this Hone.")
    return await auth.invite_info(token)


@app.post(f"{API}/invites/{{token}}/accept")
async def accept_invite(token: str):
    return await auth.accept(_profile(), token)


@app.post(f"{API}/keys/check")
async def check_keys():
    """Test the visitor's keys with the cheapest real call each service allows."""
    import httpx

    k, out = keys(), {}
    if k.openrouter:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.get("https://openrouter.ai/api/v1/key", headers={"Authorization": f"Bearer {k.openrouter}"})
        out["openrouter"] = {"ok": r.status_code == 200,
                             "detail": "Key works." if r.status_code == 200 else f"OpenRouter said {r.status_code}."}
    if k.typesafe:
        try:
            from .llm import jev

            await jev("A short test.", {"t": {"instructions": "Is this a test?"}})
            out["typesafe"] = {"ok": True, "detail": "Key works."}
        except ConnectorError as e:
            out["typesafe"] = {"ok": False, "detail": str(e)[:160]}
    return out


@app.post(f"{API}/connections/test")
async def test_connection(c: ConnectIn):
    try:
        if c.host == "n8n":
            return await n8n.test(c.baseUrl or "", c.apiKey or "", c.sandboxUrl or "")
        if c.host == "retell":
            agents = await retell.list_agents(c.apiKey or "")
            return {"ok": True, "detail": "Connected to Retell. Pick the agent to test.", "agents": agents}
        if not c.endpointUrl:
            return {"ok": False, "detail": "Add the endpoint URL Hone should call."}
        _, ms = await custom.send(c.endpointUrl, c.format, [{"role": "user", "content": "Hi"}], "hone-test")
        return {"ok": True, "detail": f"Your endpoint replied in {ms} ms."}
    except ConnectorError as e:
        return {"ok": False, "detail": str(e)}


async def _read_agent(c: ConnectIn) -> dict:
    return await runner.read_agent(c.model_dump())


@app.post(f"{API}/connections/read-agent")
async def read_agent(c: ConnectIn):
    return await _read_agent(c)


class SendIn(ConnectIn):
    text: str


@app.post(f"{API}/connections/send-test")
async def send_test(c: SendIn):
    import time

    t0 = time.perf_counter()
    if c.host == "n8n":
        agent = await n8n.read(c.baseUrl or "", c.apiKey or "", c.sandboxUrl or "")
        reply = await n8n.send(agent["trigger"], c.text, extra=c.webhookFields)
    elif c.host == "custom":
        reply, _ = await custom.send(c.endpointUrl or "", c.format, [{"role": "user", "content": c.text}], "hone-test")
    else:
        raise HTTPException(400, "Voice agents are tested from call transcripts.")
    return {"reply": reply, "ms": int((time.perf_counter() - t0) * 1000)}


class SupabaseIn(BaseModel):
    url: str
    key: str
    table: str | None = None


@app.post(f"{API}/kb/supabase/tables")
async def sb_tables(b: SupabaseIn):
    return await supabase.tables(b.url, b.key)


@app.post(f"{API}/kb/supabase/preview")
async def sb_preview(b: SupabaseIn):
    return (await supabase.rows(b.url, b.key, b.table or "", limit=3))[:3]


@app.post(f"{API}/connections/import")
async def import_preview(c: ConnectIn):
    convs = await _import(c)
    msgs = sum(len(x["messages"]) for x in convs)
    return {"conversations": len(convs), "messages": msgs, "from": "", "to": ""}


async def _import(c: ConnectIn) -> list[dict]:
    if c.host == "retell":
        return await retell.calls(c.apiKey or "", c.agentRef or "")
    if c.host == "n8n":
        # Past executions of the workflow the sandbox was copied from aren't known; read the sandbox's.
        turns = await n8n.executions(c.baseUrl or "", c.apiKey or "", n8n.workflow_id_from_url(c.sandboxUrl or ""))
        by: dict[str, list] = {}
        for t in sorted(turns, key=lambda x: x.get("at") or ""):
            by.setdefault(t["session"], []).extend([
                {"role": "user", "content": t["user"], "at": t["at"]},
                {"role": "agent", "content": t["agent"], "at": t["at"]},
            ])
        return [{"id": k, "messages": v} for k, v in by.items()]
    raise HTTPException(400, "Import isn't available for custom agents. Upload a CSV instead.")


# ---------------- projects ----------------
class KbIn(BaseModel):
    mode: str | None = None  # paste | files | supabase | retell | skip
    text: str = ""
    files: list[dict] = Field(default_factory=list)  # {name, text}
    supabase: SupabaseIn | None = None


class DataIn(BaseModel):
    mode: str | None = None  # csv | import | none
    rows: list[dict[str, str]] = Field(default_factory=list)
    mapping: dict | None = None  # {groupBy, groupKind, role, content, createdAt}


class ProjectIn(BaseModel):
    name: str
    host: str
    agentName: str
    budgetUsd: float
    connection: ConnectIn
    kb: KbIn = Field(default_factory=KbIn)
    data: DataIn = Field(default_factory=DataIn)


def _slug(s: str) -> str:
    # The random part makes project links unguessable: on a public host the link is the access.
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] + "-" + uuid.uuid4().hex[:12]


def _chunks(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if len(p.strip()) > 10]


@app.post(f"{API}/projects")
async def create_project(p: ProjectIn, bg: BackgroundTasks):
    agent = await _read_agent(p.connection)
    pid = _slug(p.name)

    # Knowledge base: the answer key.
    kb: list[str] = []
    if p.kb.mode == "paste":
        kb = _chunks(p.kb.text)
    elif p.kb.mode == "files":
        for f in p.kb.files:
            kb += _chunks(f.get("text", ""))
    elif p.kb.mode == "supabase" and p.kb.supabase and p.kb.supabase.table:
        kb = await supabase.rows(p.kb.supabase.url, p.kb.supabase.key, p.kb.supabase.table)

    # Real conversations, redacted and pseudonymised.
    convs: list[dict] = []
    if p.data.mode == "csv" and p.data.rows and p.data.mapping:
        m = p.data.mapping
        mapping = ingest.Mapping(m["groupBy"], m.get("groupKind", "conversation"), m["role"], m["content"], m.get("createdAt"))
        convs = [{"id": c.id, "messages": c.messages} for c in ingest.group(p.data.rows, mapping)]
    elif p.data.mode == "import":
        convs = [{"id": ingest.pseudonym(str(c["id"])),
                  "messages": [{**msg, "content": ingest.redact(msg["content"])} for msg in c["messages"]]}
                 for c in await _import(p.connection)]

    suff = ingest.sufficiency([ingest.Conversation(c["id"], c["messages"]) for c in convs])
    _dev_ids, test_ids = ingest.split([c["id"] for c in convs])
    test_set = set(test_ids)
    scenarios = []
    for c in convs:
        user_turns = [m["content"] for m in c["messages"] if m["role"] == "user"]
        if not user_turns or not any(m["role"] == "agent" for m in c["messages"]):
            continue
        scenarios.append({
            "id": c["id"], "scenario": user_turns[0][:80], "source": "real",
            "split": "test" if c["id"] in test_set else "dev",
            "opening": user_turns[0], "userTurns": user_turns, "persona": None,
            "transcript": [{"role": m["role"], "text": m["content"]} for m in c["messages"]],
        })

    project = {
        "id": pid, "name": p.name, "host": p.host, "agentName": p.agentName or agent["name"],
        "createdAt": now(), "budgetUsd": p.budgetUsd, "trigger": agent.get("trigger"), **_ownership(),
        "pipeline": {"connected": True, "kb": bool(kb), "data": bool(scenarios) or suff.generate > 0,
                     "rubric": False, "judges": False, "run": False, "gate": False},
        "counts": {"conversations": len(scenarios), "generated": 0, "criteria": 0, "kbDocs": len(kb)},
        "drafting": True,
    }
    # The project row first: in Supabase every other table references it.
    store.put("project", pid, project, pid)
    store.put("secret", pid, p.connection.model_dump(), pid)
    store.put("kb", pid, kb, pid)
    store.put("dataset", pid, scenarios, pid)
    store.put("criteria", pid, [], pid)
    store.put("agent", pid, agent, pid)
    snapshots.record(pid, agent)
    store.put("gate", pid, {"minPassK": 0.8, "maxRegression": 0.03, "requireTrusted": True, "history": []}, pid)
    project.update(draftStartedAt=now(), draftBoot=BOOT)
    store.put("project", pid, project, pid)
    bg.add_task(_prepare, pid, suff.generate if p.host != "retell" else 0, keys())
    return _public(project)


async def _prepare(pid: str, generate_n: int, k: Keys | None = None) -> None:
    """Background: generate gap scenarios, then draft the rubric."""
    project, agent = store.get("project", pid), store.get("agent", pid)
    kb, scenarios = store.get("kb", pid) or [], store.get("dataset", pid) or []
    spend = Spend()
    if k:
        use_keys(k)  # background task: carry the visitor's keys explicitly
    try:
        if generate_n and keys().openrouter:
            gen = await runner.generate(agent["prompt"], kb, [s["opening"] for s in scenarios], generate_n, spend)
            ids = [f"gen-{i:03d}" for i in range(len(gen))]
            _dev, test = ingest.split(ids)
            test_set = set(test)
            for sid, g in zip(ids, gen, strict=False):
                scenarios.append({"id": sid, "scenario": g.get("scenario", g["opening"])[:80], "source": "generated",
                                  "split": "test" if sid in test_set else "dev", "opening": g["opening"],
                                  "userTurns": [g["opening"]], "persona": g.get("persona")})
            store.put("dataset", pid, scenarios, pid)
            project["counts"]["generated"] = len(gen)
        crit = await rubric.draft(agent["prompt"], kb, [{"messages": [{"role": t["role"], "content": t["text"]} for t in s.get("transcript", [])]} for s in scenarios if s.get("transcript")], spend)
        store.put("criteria", pid, crit, pid)
        project["counts"]["criteria"] = len(crit)
    finally:
        project["drafting"] = False
        project["setupCostUsd"] = round(spend.usd, 4)
        store.put("project", pid, project, pid)


def _ownership() -> dict:
    """New projects are private to the person who makes them."""
    me = _me.get()
    if me:
        return {"ownerId": me["id"], "ownerName": me.get("name") or me["email"], "orgId": me.get("org_id"),
                "visibility": "private"}
    return {"workspace": _workspace.get()}


DRAFT_STALE_S = 600
BOOT = uuid.uuid4().hex[:12]  # this server process; a draft started by another one was killed by a restart


def _draft_interrupted(p: dict) -> bool:
    """Drafting runs in the background in this process, so a restart kills it. Interrupted when it was
    started by an earlier process, or (as a safety net) when it's been going for ten minutes."""
    if not p.get("drafting"):
        return False
    if p.get("draftBoot") != BOOT:
        return True
    try:
        started = datetime.fromisoformat(p.get("draftStartedAt") or p["createdAt"])
    except (KeyError, ValueError):
        return True
    return (datetime.now(UTC) - started).total_seconds() > DRAFT_STALE_S


def _public(p: dict) -> dict:
    me = _me.get()
    out = {k: v for k, v in p.items() if k not in ("trigger", "workspace", "orgId", "draftBoot")}
    if _draft_interrupted(p):
        out["drafting"], out["draftInterrupted"] = False, True
    if me:
        out["mine"] = p.get("ownerId") == me["id"]
    return out


@app.post(f"{API}/projects/{{pid}}/draft")
async def redraft(pid: str, bg: BackgroundTasks):
    """Start drafting again after it was interrupted: generate scenarios if none were made, then the rubric."""
    p = store.get("project", pid)
    if not p:
        raise HTTPException(404, "Project not found")
    if p.get("drafting") and not _draft_interrupted(p):
        raise HTTPException(409, "Hone is already drafting this project.")
    if not keys().openrouter:
        raise HTTPException(400, "Add your OpenRouter key in Settings first.")
    scenarios = store.get("dataset", pid) or []
    generate = 0 if p["host"] == "retell" or any(s.get("source") == "generated" for s in scenarios) else max(0, 100 - len(scenarios))
    p.update(drafting=True, draftStartedAt=now(), draftBoot=BOOT)
    store.put("project", pid, p, pid)
    bg.add_task(_prepare, pid, generate, keys())
    return _public(p)


@app.get(f"{API}/projects")
async def list_projects():
    """Only this organization's (or, without accounts, this browser's) projects."""
    return [_public(p) for p in store.list_("project") if _owns_doc(p)]


@app.get(f"{API}/projects/{{pid}}")
async def get_project(pid: str):
    p = store.get("project", pid)
    if not p:
        raise HTTPException(404, "Project not found")
    return _public(p)


class VisibilityIn(BaseModel):
    visibility: str


@app.patch(f"{API}/projects/{{pid}}/visibility")
async def set_visibility(pid: str, body: VisibilityIn):
    """Only the owner decides: 'private' (just them) or 'org' (everyone in their organization)."""
    p, me = store.get("project", pid), _me.get()
    if not p:
        raise HTTPException(404, "Project not found")
    if not me or p.get("ownerId") != me["id"]:
        raise HTTPException(403, "Only the person who made this project can change who sees it.")
    if body.visibility not in ("private", "org"):
        raise HTTPException(400, "Visibility must be private or org.")
    p["visibility"] = body.visibility
    p["orgId"] = me.get("org_id")
    store.put("project", pid, p, pid)
    return _public(p)


@app.get(f"{API}/projects/{{pid}}/agent")
async def get_agent(pid: str):
    a = store.get("agent", pid)
    if not a:
        raise HTTPException(404, "Agent not found")
    return a


# ---------------- rubric ----------------
@app.get(f"{API}/projects/{{pid}}/criteria")
async def get_criteria(pid: str):
    return store.get("criteria", pid) or []


@app.put(f"{API}/projects/{{pid}}/criteria")
async def put_criteria(pid: str, criteria: list[dict]):
    for c in criteria:
        if not str(c.get("text", "")).strip():
            raise HTTPException(400, f"Criterion {c.get('id')} is empty.")
    store.put("criteria", pid, criteria, pid)
    p = store.get("project", pid)
    p["pipeline"]["rubric"] = bool(criteria) and all(c["status"] == "approved" for c in criteria)
    p["counts"]["criteria"] = len(criteria)
    store.put("project", pid, p, pid)
    return criteria


# ---------------- runs ----------------
class RunIn(BaseModel):
    scenarios: int
    k: int = 3
    budgetUsd: float
    estUsd: float = 0
    split: str = "dev"


@app.get(f"{API}/projects/{{pid}}/runs")
async def list_runs(pid: str):
    return store.list_("run", pid)


@app.post(f"{API}/projects/{{pid}}/runs")
async def start_run(pid: str, r: RunIn):
    p = store.get("project", pid)
    if not p:
        raise HTTPException(404, "Project not found")
    if not keys().openrouter and not keys().typesafe:
        raise HTTPException(400, "Add your OpenRouter or TypeSafe key in Settings before running.")
    if p["host"] != "retell" and not store.get("secret", pid):
        raise HTTPException(400, "Hone no longer has this agent's connection details (they're kept only "
                                 "temporarily on a public server). Create the project again to reconnect.")
    rid = f"run-{uuid.uuid4().hex[:12]}"
    run = {"id": rid, "projectId": pid, "createdAt": now(), "split": r.split, "k": r.k, "scenarios": r.scenarios,
           "status": "running", "costUsd": 0.0, "budgetUsd": r.budgetUsd, "passK": 0, "pass1": 0, "ci": [0, 0],
           "trusted": False, "perCriterion": [], "triage": {"retrieval": 0, "answer": 0, "scope_gap": 0, "behaviour": 0},
           "items": []}
    store.put("run", rid, run, pid)
    asyncio.create_task(runner.execute(rid))
    return {"id": rid}


@app.get(f"{API}/runs/{{rid}}")
async def get_run(rid: str):
    r = store.get("run", rid)
    if not r:
        raise HTTPException(404, "Run not found")
    return r


@app.get(f"{API}/runs/{{rid}}/items/{{iid}}")
async def get_item(rid: str, iid: str):
    d = store.get("item", f"{rid}:{iid}")
    if not d:
        raise HTTPException(404, "Conversation not found")
    crit_ids = sorted({cid for t in d["details"] for cid in t["results"]})
    first_fail = next((t for t in d["details"] if not t["pass"]), d["details"][0])
    return {
        "item": d["item"],
        "transcript": first_fail["transcript"],
        "transcripts": [t["transcript"] for t in d["details"]],
        "checks": [{"criterionId": cid, "trials": [{"pass": t["results"].get(cid, {"pass": True})["pass"],
                                                     "reason": t["results"].get(cid, {}).get("reason", ""),
                                                     "na": bool(t["results"].get(cid, {}).get("na"))}
                                                    for t in d["details"]]} for cid in crit_ids],
        "kb": [{"doc": c[:90], "retrieved": None, "usedCorrectly": None} for c in first_fail.get("kb", [])[:5]],
    }


@app.get(f"{API}/runs/{{rid}}/events")
async def run_events(rid: str):
    async def gen():
        async for e in runner.stream(rid):
            yield f"data: {json.dumps(e)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


# ---------------- history: agent versions and recommendations ----------------
@app.get(f"{API}/projects/{{pid}}/agent-status")
async def agent_status(pid: str):
    """Before a run: has the agent changed since the version Hone last tested? Reads the agent, saves nothing."""
    if not store.get("project", pid):
        raise HTTPException(404, "Project not found")
    secret = store.get("secret", pid) or {}
    read_error = None
    try:
        agent = await runner.read_agent(secret)
    except ConnectorError as e:
        agent, read_error = store.get("agent", pid) or {}, str(e)[:200]
    out = snapshots.compare(pid, agent)
    runs = sorted(store.list_("run", pid), key=lambda r: r.get("createdAt", ""), reverse=True)
    last = next((r for r in runs if r.get("status") in ("done", "stopped")), None)
    out["readError"] = read_error
    out["lastRun"] = ({"id": last["id"], "version": last.get("agentVersion"), "passK": last.get("passK"),
                       "split": last.get("split"), "at": last.get("createdAt")} if last else None)
    out["openRecommendations"] = sum(1 for r in store.list_("recommendation", pid) if r["status"] == "open")
    return out


@app.get(f"{API}/projects/{{pid}}/snapshots")
async def list_snapshots(pid: str):
    """Every agent version Hone has tested, newest first, each with what changed."""
    return [snapshots.public(s) for s in sorted(store.list_("snapshot", pid), key=lambda s: -s["version"])]


@app.get(f"{API}/projects/{{pid}}/recommendations")
async def list_recommendations(pid: str, run_id: str | None = None):
    recs = sorted(store.list_("recommendation", pid), key=lambda r: r["createdAt"], reverse=True)
    return [r for r in recs if run_id is None or r["runId"] == run_id]


class FilesIn(BaseModel):
    files: list[dict]  # {name, text}


@app.put(f"{API}/projects/{{pid}}/agent-files")
async def update_agent_files(pid: str, body: FilesIn):
    """Custom-code agents: Hone only sees the code through uploads, so after editing it the user uploads
    the new files. They're read as text, never run. The next run records the new version."""
    sec = store.get("secret", pid)
    if not sec or sec.get("host") != "custom":
        raise HTTPException(400, "Only custom-code agents take file uploads. n8n and Retell agents are re-read automatically.")
    sec["files"] = [{"name": str(f.get("name", "agent.txt"))[:120], "text": str(f.get("text", ""))[:400_000]} for f in body.files]
    store.put("secret", pid, sec, pid)
    agent = custom.read(sec["files"], sec.get("endpointUrl"))
    prev = snapshots.latest(pid)
    snap = snapshots.record(pid, agent)
    store.put("agent", pid, agent, pid)
    return {"changed": not prev or prev["id"] != snap["id"], "version": snap["version"], "changeSummary": snap["changeSummary"]}


class RecStatusIn(BaseModel):
    status: str


@app.patch(f"{API}/recommendations/{{rid}}")
async def update_recommendation(rid: str, body: RecStatusIn):
    if body.status not in ("open", "applied", "dismissed"):
        raise HTTPException(400, "Status must be open, applied or dismissed.")
    try:
        return recommend.set_status(rid, body.status)
    except KeyError:
        raise HTTPException(404, "Recommendation not found") from None


# ---------------- labels, judges, gate ----------------
@app.get(f"{API}/projects/{{pid}}/label/next")
async def label_queue(pid: str, limit: int = 30):
    criteria = {c["id"]: c for c in (store.get("criteria", pid) or []) if c["kind"] == "judge"}
    done = {lab["id"] for lab in store.list_("label", pid)}
    counts: dict[str, list[Any]] = {cid: [lab for lab in store.list_("label", pid) if lab["criterionId"] == cid] for cid in criteria}
    tasks = []
    for run in store.list_("run", pid):
        for i in run["items"]:
            d = store.get("item", f"{run['id']}:{i['id']}") or {"details": []}
            for t_idx, t in enumerate(d["details"]):
                for cid, res in t["results"].items():
                    tid = f"{run['id']}:{i['id']}:{t_idx}:{cid}"
                    if cid not in criteria or tid in done or res.get("na"):
                        continue
                    labs = counts[cid]
                    tasks.append({"id": tid, "criterionId": cid, "question": criteria[cid]["text"],
                                  "transcript": t["transcript"], "_judge": res["pass"],
                                  "progress": {"done": len(labs), "target": 60,
                                               "fails": sum(1 for x in labs if x["value"] is False)}})
    # Judge-failed items first: fails are rarer and matter most for calibration.
    tasks.sort(key=lambda t: t["_judge"])
    return [{k: v for k, v in t.items() if k != "_judge"} for t in tasks[:limit]]


class LabelIn(BaseModel):
    task_id: str
    value: bool | None
    note: str | None = None


@app.post(f"{API}/labels")
async def save_label(lab: LabelIn):
    run_id, item_id, t_idx, cid = lab.task_id.split(":")
    run = store.get("run", run_id)
    if not run or not _owns(run["projectId"]):
        raise HTTPException(404, "Not found")
    d = store.get("item", f"{run_id}:{item_id}")
    judge_pass = d["details"][int(t_idx)]["results"][cid]["pass"]
    store.put("label", lab.task_id, {"id": lab.task_id, "criterionId": cid, "value": lab.value, "judge": judge_pass,
                                     "note": lab.note, "at": now()}, run["projectId"])
    return {"ok": True}


@app.get(f"{API}/projects/{{pid}}/judges")
async def judges(pid: str):
    rows = runner.calibration(pid)
    p = store.get("project", pid)
    if p and rows:
        p["pipeline"]["judges"] = all(r["trusted"] for r in rows)
        store.put("project", pid, p, pid)
    return rows


@app.get(f"{API}/projects/{{pid}}/gate")
async def get_gate(pid: str):
    return store.get("gate", pid) or {"minPassK": 0.8, "maxRegression": 0.03, "requireTrusted": True, "history": []}


class GateIn(BaseModel):
    minPassK: float
    maxRegression: float
    requireTrusted: bool


@app.put(f"{API}/projects/{{pid}}/gate")
async def put_gate(pid: str, g: GateIn):
    cur = await get_gate(pid)
    cur.update(g.model_dump())
    store.put("gate", pid, cur, pid)
    p = store.get("project", pid)
    p["pipeline"]["gate"] = True
    store.put("project", pid, p, pid)
    return cur


@app.post(f"{API}/projects/{{pid}}/gate/check")
async def gate_check(pid: str, run_id: str):
    """Decide pass/blocked for a finished run and record it in the gate history."""
    gate, run = await get_gate(pid), store.get("run", run_id)
    passed_before = [h for h in gate["history"] if h["passed"]]
    reasons = []
    if run["passK"] < gate["minPassK"]:
        reasons.append(f"pass^{run['k']} {run['passK']:.0%} is below {gate['minPassK']:.0%}")
    if passed_before and passed_before[0]["passK"] - run["passK"] > gate["maxRegression"]:
        reasons.append(f"dropped {(passed_before[0]['passK'] - run['passK']) * 100:.1f} pts vs the last passing run")
    if gate["requireTrusted"] and not run["trusted"]:
        reasons.append("some judges aren't trusted yet")
    entry = {"runId": run_id, "at": now(), "passK": run["passK"], "passed": not reasons,
             "reason": "; ".join(reasons) or "All thresholds met"}
    gate["history"].insert(0, entry)
    store.put("gate", pid, gate, pid)
    return entry
