"""Shared bits for connectors: one HTTP client config and a friendly error type."""

from __future__ import annotations

import httpx

TIMEOUT = httpx.Timeout(30.0, connect=10.0)
USER_AGENT = "hone-eval/0.1"


class ConnectorError(Exception):
    """An error with a message safe to show the user (never contains secrets)."""


def client(**kw) -> httpx.AsyncClient:
    headers = {"user-agent": USER_AGENT, **kw.pop("headers", {})}
    return httpx.AsyncClient(timeout=TIMEOUT, headers=headers, **kw)


def explain(resp: httpx.Response, service: str) -> ConnectorError:
    if resp.status_code in (401, 403):
        return ConnectorError(f"{service} rejected this API key.")
    if resp.status_code == 404:
        return ConnectorError(f"{service} couldn't find that. Check the URL or ID.")
    return ConnectorError(f"{service} returned an error ({resp.status_code}).")


def agent_info(
    name: str,
    model: str,
    prompt: str,
    tools: list[dict],
    memory: str | None,
    kb_nodes: list[str],
    trigger_kind: str | None,
    trigger_url: str | None,
) -> dict:
    """The AgentInfo shape from ui/lib/types.ts."""
    return {
        "name": name,
        "model": model,
        "prompt": prompt,
        "tools": tools,
        "memory": memory,
        "kbNodes": kb_nodes,
        "trigger": {"kind": trigger_kind, "url": trigger_url},
    }


def extract_reply(data: object) -> str:
    """Pull the agent's reply out of common response shapes."""
    if isinstance(data, str):
        return data
    if isinstance(data, list) and data:
        return extract_reply(data[0])
    if isinstance(data, dict):
        if "choices" in data:  # OpenAI chat format
            try:
                return data["choices"][0]["message"]["content"] or ""
            except (KeyError, IndexError, TypeError):
                pass
        for key in ("output", "reply", "response", "text", "message", "answer", "content"):
            v = data.get(key)
            if isinstance(v, str):
                return v
            if isinstance(v, dict | list):
                return extract_reply(v)
    return ""
