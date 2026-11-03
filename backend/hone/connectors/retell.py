"""Retell connector. Reads agents, their LLM prompt and tools, and past call transcripts.
Never places calls. Auth: `Authorization: Bearer <key>`, base https://api.retellai.com.
"""

from __future__ import annotations

from .base import ConnectorError, agent_info, client, explain

BASE = "https://api.retellai.com"


def _h(key: str) -> dict:
    return {"Authorization": f"Bearer {key}"}


async def list_agents(api_key: str) -> list[dict]:
    async with client(headers=_h(api_key)) as c:
        r = await c.get(f"{BASE}/list-agents")
    if r.status_code != 200:
        raise explain(r, "Retell")
    seen: dict[str, dict] = {}
    for a in r.json():  # list-agents returns one row per version; keep the latest
        aid = a.get("agent_id")
        if aid and (aid not in seen or a.get("version", 0) > seen[aid].get("version", 0)):
            seen[aid] = a
    return [
        {"id": a["agent_id"], "name": a.get("agent_name") or a["agent_id"], "meta": a.get("voice_id", "")}
        for a in seen.values()
    ]


async def read(api_key: str, agent_id: str) -> dict:
    async with client(headers=_h(api_key)) as c:
        r = await c.get(f"{BASE}/get-agent/{agent_id}")
        if r.status_code != 200:
            raise explain(r, "Retell")
        agent = r.json()
        engine = agent.get("response_engine") or {}
        prompt, model, tools, kbs = "", engine.get("type", "unknown"), [], []
        if engine.get("type") == "retell-llm" and engine.get("llm_id"):
            lr = await c.get(f"{BASE}/get-retell-llm/{engine['llm_id']}")
            if lr.status_code == 200:
                llm = lr.json()
                prompt = llm.get("general_prompt") or ""
                model = llm.get("model") or model
                tools = [
                    {"name": t.get("name", "tool"), "description": t.get("description", t.get("type", ""))}
                    for t in llm.get("general_tools") or []
                ]
                kbs = llm.get("knowledge_base_ids") or []
    kb_nodes = [f"Retell knowledge base: {len(kbs)} linked"] if kbs else []
    return agent_info(agent.get("agent_name") or agent_id, model, prompt, tools, None, kb_nodes, None, None)


async def calls(api_key: str, agent_id: str, limit: int = 1000) -> list[dict]:
    """Ended calls with transcripts → conversations [{id, messages:[{role, content, at}]}]."""
    out: list[dict] = []
    pagination_key = None
    async with client(headers=_h(api_key)) as c:
        while len(out) < limit:
            body: dict = {"filter_criteria": {"agent_id": [agent_id]}, "limit": min(1000, limit - len(out))}
            if pagination_key:
                body["pagination_key"] = pagination_key
            r = await c.post(f"{BASE}/v2/list-calls", json=body)
            if r.status_code != 200:
                raise explain(r, "Retell")
            page = r.json()
            if not page:
                break
            for call in page:
                msgs = [
                    {"role": "agent" if t.get("role") == "agent" else "user", "content": t.get("content", ""), "at": None}
                    for t in call.get("transcript_object") or []
                    if t.get("content")
                ]
                if msgs:
                    out.append({"id": call.get("call_id"), "messages": msgs})
            pagination_key = page[-1].get("call_id")
            if len(page) < body["limit"]:
                break
    if not out:
        raise ConnectorError("No calls with transcripts found for this agent.")
    return out
