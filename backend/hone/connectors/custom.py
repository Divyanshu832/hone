"""Custom-code agents. Hone reads the uploaded files as plain text to find the prompt and tools,
then talks to the agent only through the endpoint URL the user gives. Uploaded code is never run.
"""

from __future__ import annotations

import re
import time

from .base import ConnectorError, agent_info, client, explain, extract_reply

_PROMPT = re.compile(
    r"(?:system_prompt|SYSTEM_PROMPT|systemPrompt|instructions|system_message)\s*[:=]\s*"
    r"(?:f|r)?(\"\"\"|'''|`|\"|')([\s\S]{20,6000}?)\1"
)
_MODEL = re.compile(r"\b(gpt-[\w.-]+|o\d-[\w.-]+|claude-[\w.-]+|gemini-[\w.-]+|llama-[\w.-]+|mistral-[\w.-]+)")
_PY_TOOL = re.compile(r"@(?:\w+\.)?tool\b[^\n]*\n\s*(?:async\s+)?def\s+(\w+)\(")
_JSON_TOOL = re.compile(r"[\"']?name[\"']?\s*:\s*[\"'](\w+)[\"'][\s\S]{0,200}?[\"']?description[\"']?\s*:\s*[\"']([^\"']{3,200})")


def read(files: list[dict], endpoint_url: str | None) -> dict:
    text = "\n".join(f.get("text", "") for f in files)
    prompt_m = _PROMPT.search(text)
    tools = [{"name": n, "description": "Found in your code"} for n in dict.fromkeys(_PY_TOOL.findall(text))]
    tools += [{"name": n, "description": d} for n, d in _JSON_TOOL.findall(text) if n not in {t["name"] for t in tools}]
    name = files[0]["name"].rsplit(".", 1)[0] if files else "Custom agent"
    return agent_info(
        name,
        m.group(1) if (m := _MODEL.search(text)) else "Unknown model",
        prompt_m.group(2).strip() if prompt_m else "Hone couldn't find a system prompt in the files. You can paste it later.",
        tools[:12],
        None,
        [],
        "webhook" if endpoint_url else None,
        endpoint_url,
    )


async def send(endpoint_url: str, fmt: str, history: list[dict], session_id: str) -> tuple[str, int]:
    """Send the conversation so far; return (reply, latency ms)."""
    if fmt == "openai":
        body = {"messages": [{"role": "assistant" if m["role"] == "agent" else "user", "content": m["content"]}
                             for m in history]}
    else:
        body = {"message": history[-1]["content"], "session_id": session_id}
    t0 = time.perf_counter()
    async with client() as c:
        try:
            r = await c.post(endpoint_url, json=body)
        except Exception as e:  # connection refused, DNS, timeout
            raise ConnectorError(f"Couldn't reach your endpoint ({type(e).__name__}).") from e
    ms = int((time.perf_counter() - t0) * 1000)
    if r.status_code >= 400:
        raise explain(r, "Your endpoint")
    try:
        reply = extract_reply(r.json())
    except ValueError:
        reply = r.text
    if not reply:
        raise ConnectorError("Your endpoint replied, but Hone couldn't find the reply text in the response.")
    return reply, ms
