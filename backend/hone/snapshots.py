"""Agent snapshots: what the agent looked like each time it was tested.

Before every run Hone re-reads the agent (the n8n sandbox workflow, the Retell agent, or the uploaded
custom files) and fingerprints the parts that decide its behaviour: model, prompt, tools, knowledge
sources and, for multi-agent workflows, each part. Same fingerprint as last time = same version. Anything
different = a new version, saved with a readable diff against the previous one.

That's what closes the loop: a run on v3 can say "v3 changed the returns section of the prompt", and a
recommendation from a v2 run can be checked against that diff and against v3's results.
"""

from __future__ import annotations

import difflib
import hashlib
import json
from datetime import UTC, datetime

from . import store

MAX_DIFF_LINES = 400


def fingerprint(agent: dict) -> dict:
    """The behaviour-relevant parts of an AgentInfo, in a stable order."""
    return {
        "name": agent.get("name"),
        "model": agent.get("model"),
        "prompt": (agent.get("prompt") or "").strip(),
        "tools": sorted(({"name": t.get("name"), "description": t.get("description") or ""}
                         for t in agent.get("tools") or []), key=lambda t: t["name"] or ""),
        "kbNodes": sorted(agent.get("kbNodes") or []),
        "memory": agent.get("memory"),
        "parts": [{"name": p.get("name"), "role": p.get("role"), "model": p.get("model"), "tools": sorted(p.get("tools") or [])}
                  for p in agent.get("parts") or []],
    }


def digest(fp: dict) -> str:
    return hashlib.sha256(json.dumps(fp, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def diff(old: dict | None, new: dict) -> dict:
    """What changed between two fingerprints, for people and for the recommendation checker."""
    if old is None:
        return {"first": True}
    out: dict = {"first": False}
    if old.get("model") != new.get("model"):
        out["model"] = {"from": old.get("model"), "to": new.get("model")}
    ol, nl = (old.get("prompt") or "").splitlines(), (new.get("prompt") or "").splitlines()
    if ol != nl:
        lines = list(difflib.unified_diff(ol, nl, "before", "after", n=1, lineterm=""))[2:]
        out["prompt"] = {
            "added": sum(1 for x in lines if x.startswith("+")),
            "removed": sum(1 for x in lines if x.startswith("-")),
            "unified": "\n".join(lines[:MAX_DIFF_LINES]) + ("\n… (diff truncated)" if len(lines) > MAX_DIFF_LINES else ""),
        }
    otools = {t["name"]: t["description"] for t in old.get("tools") or []}
    ntools = {t["name"]: t["description"] for t in new.get("tools") or []}
    if added := sorted(set(ntools) - set(otools)):
        out["toolsAdded"] = added
    if removed := sorted(set(otools) - set(ntools)):
        out["toolsRemoved"] = removed
    if changed := sorted(n for n in set(otools) & set(ntools) if otools[n] != ntools[n]):
        out["toolsChanged"] = changed
    okb, nkb = set(old.get("kbNodes") or []), set(new.get("kbNodes") or [])
    if nkb - okb:
        out["kbAdded"] = sorted(nkb - okb)
    if okb - nkb:
        out["kbRemoved"] = sorted(okb - nkb)
    if old.get("memory") != new.get("memory"):
        out["memory"] = {"from": old.get("memory"), "to": new.get("memory")}
    oparts, nparts = {p["name"] for p in old.get("parts") or []}, {p["name"] for p in new.get("parts") or []}
    if nparts - oparts:
        out["partsAdded"] = sorted(nparts - oparts)
    if oparts - nparts:
        out["partsRemoved"] = sorted(oparts - nparts)
    return out


def summarize(d: dict) -> str:
    """One line, e.g. 'Prompt +12 −3 lines · tools added: coupon_db'."""
    if d.get("first"):
        return "First version Hone saw."
    bits = []
    if m := d.get("model"):
        bits.append(f"Model {m['from']} → {m['to']}")
    if p := d.get("prompt"):
        bits.append(f"Prompt +{p['added']} −{p['removed']} lines")
    for key, label in (("toolsAdded", "tools added"), ("toolsRemoved", "tools removed"), ("toolsChanged", "tools changed"),
                       ("kbAdded", "knowledge added"), ("kbRemoved", "knowledge removed"),
                       ("partsAdded", "parts added"), ("partsRemoved", "parts removed")):
        if d.get(key):
            bits.append(f"{label}: {', '.join(d[key])}")
    if d.get("memory"):
        bits.append("memory changed")
    return " · ".join(bits) or "No behaviour change."


def latest(project_id: str) -> dict | None:
    snaps = store.list_("snapshot", project_id)
    return max(snaps, key=lambda s: s["version"]) if snaps else None


def record(project_id: str, agent: dict) -> dict:
    """Return the snapshot for this agent, creating a new version only if it changed."""
    fp = fingerprint(agent)
    h = digest(fp)
    prev = latest(project_id)
    if prev and prev["hash"] == h:
        return prev
    d = diff(prev["agent"] if prev else None, fp)
    version = (prev["version"] + 1) if prev else 1
    snap = {
        "id": f"{project_id}-v{version}",
        "projectId": project_id,
        "version": version,
        "hash": h,
        "createdAt": datetime.now(UTC).isoformat(),
        "previousId": prev["id"] if prev else None,
        "agent": fp,
        "diff": d,
        "changeSummary": summarize(d),
    }
    store.put("snapshot", snap["id"], snap, project_id)
    return snap


def public(s: dict) -> dict:
    """API shape: the full prompt is large and already on the agent screen, so it's left out of lists."""
    return {k: v for k, v in s.items() if k != "agent"} | {
        "model": s["agent"].get("model"), "tools": [t["name"] for t in s["agent"].get("tools", [])],
        "promptChars": len(s["agent"].get("prompt") or ""),
    }
