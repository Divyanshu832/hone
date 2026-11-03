"""n8n connector. Reads workflows through the n8n public API and talks to the user's *sandbox* copy
through its Chat Trigger or Webhook node. Never writes to any workflow.

API: header `X-N8N-API-KEY`, base `{n8n}/api/v1`. Not available on the n8n Cloud free trial.
"""

from __future__ import annotations

import json
import re
import uuid
from urllib.parse import urlparse

from .base import ConnectorError, agent_info, client, explain, extract_reply

AGENT_TYPE = "@n8n/n8n-nodes-langchain.agent"
CHAT_TRIGGER = "@n8n/n8n-nodes-langchain.chatTrigger"
WEBHOOK = "n8n-nodes-base.webhook"


def workflow_id_from_url(url: str) -> str:
    m = re.search(r"/workflow/([A-Za-z0-9]+)", url)
    if not m:
        raise ConnectorError("That sandbox URL doesn't look like an n8n workflow link (…/workflow/<id>).")
    return m.group(1)


def _base(base_url: str) -> str:
    p = urlparse(base_url.strip())
    if p.scheme not in ("http", "https") or not p.netloc:
        raise ConnectorError("That n8n URL doesn't look right. It should start with https://")
    return f"{p.scheme}://{p.netloc}"


def _rl(v: object) -> str | None:
    """n8n 'resource locator' params are either plain strings or {mode, value}."""
    if isinstance(v, dict):
        return v.get("value") or v.get("cachedResultName")
    return v if isinstance(v, str) else None


CLASSIFIER = "@n8n/n8n-nodes-langchain.textClassifier"
# Tool nodes that only read data are knowledge sources, not actions.
_KB_TOOLS = {"n8n-nodes-base.supabaseTool": "Supabase table", "n8n-nodes-base.googleSheetsTool": "Google Sheet",
             "n8n-nodes-base.postgresTool": "Postgres table", "n8n-nodes-base.airtableTool": "Airtable"}
_READ_OPS = {None, "", "get", "getAll", "read", "search", "select", "executeQuery"}
_BODY_FIELD = re.compile(r"\$json\.body\.(\w+)")


def _name(v: object) -> str | None:
    """Human name of a resource locator (a sheet's title, not 'gid=0')."""
    if isinstance(v, dict):
        return v.get("cachedResultName") or v.get("value") or None
    return v if isinstance(v, str) and v else None


def _text(v: object) -> str:
    """n8n marks expression strings with a leading '='; it isn't part of the prompt."""
    s = v if isinstance(v, str) else ""
    return s.removeprefix("=")


def _wired_into(wf: dict, nodes: dict, target: str) -> list[tuple[str, dict]]:
    """(connection type, node) for every ai_* sub-node attached to `target`."""
    out = []
    for src, outs in (wf.get("connections") or {}).items():
        for ctype, groups in outs.items():
            if ctype.startswith("ai_") and any(link.get("node") == target for g in groups or [] for link in g or []):
                out.append((ctype, nodes.get(src, {"name": src})))
    return out


def parse_workflow(wf: dict, base_url: str) -> dict:
    """Find every AI Agent node (and any router/classifier) and everything wired into them.

    Multi-agent workflows (a classifier routing to several agents) are common, so each agent becomes
    one section of the combined prompt, which is what the rubric is drafted from.
    """
    nodes = {n["name"]: n for n in wf.get("nodes", []) if not n.get("disabled")}
    agents = [n for n in nodes.values() if n.get("type") == AGENT_TYPE]
    if not agents:
        raise ConnectorError("No AI Agent node found in this workflow.")

    parts, models, tools, kb, memory = [], [], {}, [], None
    for n in nodes.values():
        if n.get("type") == CLASSIFIER:
            p = n.get("parameters", {})
            cats = [c.get("category") for c in (p.get("categories") or {}).get("categories", []) if c.get("category")]
            parts.append({"name": n["name"], "role": "router", "model": None, "tools": [],
                          "prompt": _text(p.get("inputText")) or _text((p.get("options") or {}).get("systemPromptTemplate")),
                          "routes": cats})
    for a in agents:
        p = a.get("parameters", {})
        part = {"name": a["name"], "role": "agent", "model": None, "tools": [],
                "prompt": _text((p.get("options") or {}).get("systemMessage")) or _text(p.get("systemMessage")) or _text(p.get("text"))}
        for ctype, node in _wired_into(wf, nodes, a["name"]):
            np = node.get("parameters", {})
            if ctype == "ai_languageModel":
                part["model"] = _rl(np.get("model")) or _rl(np.get("modelName")) or node.get("type", "").split(".")[-1]
            elif ctype == "ai_memory":
                memory = node.get("name")
            elif ctype == "ai_tool":
                t = node.get("type", "")
                if t in _KB_TOOLS and np.get("operation") in _READ_OPS:
                    src = _name(np.get("tableId")) or _name(np.get("documentId")) or _name(np.get("table")) or node["name"]
                    kb.append(f"{_KB_TOOLS[t]}: {src}")
                tools.setdefault(node["name"], _text(np.get("toolDescription")) or _text(np.get("description"))
                                 or f"{_KB_TOOLS.get(t, t.split('.')[-1])} lookup")
                part["tools"].append(node["name"])
        if part["model"]:
            models.append(part["model"])
        parts.append(part)
    for n in nodes.values():
        t = n.get("type", "")
        if "vectorStore" in t:
            table = _rl(n.get("parameters", {}).get("tableName"))
            kind = "Supabase vector store" if "Supabase" in t else t.split(".")[-1]
            kb.append(f"{kind}: {table}" if table else kind)

    if len(parts) == 1:
        prompt = parts[0]["prompt"]
    else:
        # Agents in one workflow usually share most of their prompt. Keep each paragraph once, under the
        # first part that has it, so the rubric drafter sees every distinct rule instead of 7 copies.
        seen, sections = set(), []
        for x in sorted(parts, key=lambda x: x["role"] == "router"):  # agents first, router last
            fresh = [para for para in re.split(r"\n\s*\n", x["prompt"]) if para.strip() and para.strip() not in seen]
            seen.update(para.strip() for para in fresh)
            if fresh:
                note = "" if len(sections) == 0 else " (only what differs from the parts above)"
                sections.append(f"## {x['name']} ({x['role']}){note}\n" + "\n\n".join(fresh))
        prompt = "\n\n".join(sections)

    trigger_kind, trigger_url = None, None
    base = _base(base_url)
    for n in nodes.values():
        if n.get("type") == CHAT_TRIGGER and n.get("webhookId"):
            trigger_kind, trigger_url = "chat", f"{base}/webhook/{n['webhookId']}/chat"
            break
        if n.get("type") == WEBHOOK:
            path = n.get("parameters", {}).get("path") or n.get("webhookId")
            if path:
                trigger_kind, trigger_url = "webhook", f"{base}/webhook/{path}"
                break

    fields = list(dict.fromkeys(_BODY_FIELD.findall(json.dumps(wf.get("nodes", []))))) if trigger_kind == "webhook" else []
    info = agent_info(wf.get("name", "n8n agent"), ", ".join(dict.fromkeys(models)) or "Unknown model", prompt,
                      [{"name": k, "description": v} for k, v in tools.items()], memory, list(dict.fromkeys(kb)),
                      trigger_kind, trigger_url)
    info["trigger"]["fields"] = fields
    return info | {"active": bool(wf.get("active")),
                   "parts": [{k: v for k, v in x.items() if k != "prompt"} | {"promptChars": len(x["prompt"])} for x in parts]}


async def test(base_url: str, api_key: str, sandbox_url: str) -> dict:
    wid = workflow_id_from_url(sandbox_url)
    async with client(headers={"X-N8N-API-KEY": api_key}) as c:
        r = await c.get(f"{_base(base_url)}/api/v1/workflows/{wid}")
    if r.status_code != 200:
        raise explain(r, "n8n")
    wf = r.json()
    if not any(n.get("type") == AGENT_TYPE for n in wf.get("nodes", [])):
        raise ConnectorError("Connected, but this workflow has no AI Agent node.")
    return {"ok": True, "detail": f"Connected to n8n. Found “{wf.get('name')}”."}


async def read(base_url: str, api_key: str, sandbox_url: str) -> dict:
    wid = workflow_id_from_url(sandbox_url)
    async with client(headers={"X-N8N-API-KEY": api_key}) as c:
        r = await c.get(f"{_base(base_url)}/api/v1/workflows/{wid}")
    if r.status_code != 200:
        raise explain(r, "n8n")
    return parse_workflow(r.json(), base_url)


async def send(trigger: dict, text: str, session_id: str | None = None, history: list[dict] | None = None,
               extra: dict | None = None) -> str:
    """One turn against the sandbox.

    Chat Trigger: n8n's chat protocol; the workflow's memory node keeps the thread.
    Webhook: many workflows keep no memory and expect the earlier chat in the body, so Hone also sends
    `history` and a plain-text `summary`, plus any fixed sample fields the user set (name, cart...).
    """
    if not trigger.get("url"):
        raise ConnectorError("The sandbox has no Chat Trigger or Webhook to call.")
    sid = session_id or f"hone-{uuid.uuid4().hex[:12]}"
    if trigger.get("kind") == "chat":
        body = {"action": "sendMessage", "sessionId": sid, "chatInput": text}
    else:
        prior = (history or [])[:-1]
        summary = "\n".join(f"{'Customer' if m['role'] == 'user' else 'Agent'}: {m['text']}" for m in prior)
        body = {**(extra or {}), "message": text, "chatInput": text, "sessionId": sid,
                "history": [{"role": m["role"], "content": m["text"]} for m in prior], "summary": summary}
    async with client() as c:
        r = await c.post(trigger["url"], json=body)
    if r.status_code == 404:
        raise ConnectorError("The sandbox trigger isn't reachable. Is the sandbox workflow active?")
    if r.status_code >= 400:
        raise explain(r, "Your sandbox")
    try:
        return extract_reply(r.json())
    except ValueError:
        return r.text


async def executions(base_url: str, api_key: str, workflow_id: str, limit: int = 250) -> list[dict]:
    """Past executions with data, turned into {session, user, agent} turns (best effort)."""
    out: list[dict] = []
    cursor = None
    async with client(headers={"X-N8N-API-KEY": api_key}) as c:
        while len(out) < limit:
            params = {"workflowId": workflow_id, "includeData": "true", "limit": 100}
            if cursor:
                params["cursor"] = cursor
            r = await c.get(f"{_base(base_url)}/api/v1/executions", params=params)
            if r.status_code != 200:
                raise explain(r, "n8n")
            body = r.json()
            for ex in body.get("data", []):
                turn = _turn_from_execution(ex)
                if turn:
                    out.append(turn)
            cursor = body.get("nextCursor")
            if not cursor:
                break
    return out[:limit]


def _turn_from_execution(ex: dict) -> dict | None:
    run = (((ex.get("data") or {}).get("resultData") or {}).get("runData")) or {}
    user, agent, session = None, None, None
    for runs in run.values():
        for item in runs or []:
            for branch in ((item.get("data") or {}).get("main") or []):
                for row in branch or []:
                    j = row.get("json") or {}
                    if user is None and isinstance(j.get("chatInput"), str):
                        user, session = j["chatInput"], j.get("sessionId")
                    if isinstance(j.get("output"), str):
                        agent = j["output"]
    if not user or not agent:
        return None
    return {"session": session or ex.get("id"), "user": user, "agent": agent, "at": ex.get("startedAt")}
