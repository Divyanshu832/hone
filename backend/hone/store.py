"""Storage. JSON documents by kind, in one of two places:

- **Supabase** (when SUPABASE_URL and the secret key are set): one typed table per kind, see
  `backend/supabase/schema.sql`. Runs, agent snapshots and recommendations live here so history survives
  and can be queried or charted in Supabase directly.
- **SQLite** (default when running locally, and always for tests): one local file, `data/hone.db`.
- **Memory** (public hosting with no database, or when Supabase can't be reached at startup): nothing is
  written to disk; everything is gone when the server restarts. The UI says so.

Connection credentials (kind "secret": n8n / Retell API keys) never go to Supabase: they stay in the
local file, or in memory in public mode.

Kinds: project, secret, agent, kb, dataset, criteria, run, item, label, gate, snapshot, recommendation.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from typing import Any

import httpx

from .config import settings

_lock = threading.Lock()

# kind -> Supabase table
TABLES = {
    "project": "hone_projects",
    "snapshot": "hone_agent_snapshots",
    "run": "hone_runs",
    "item": "hone_run_items",
    "recommendation": "hone_recommendations",
    "criteria": "hone_criteria",
    "label": "hone_labels",
    "kb": "hone_knowledge",
    "dataset": "hone_datasets",
    "agent": "hone_agents",
    "gate": "hone_gates",
}
LOCAL_ONLY = {"secret"}


class StoreError(RuntimeError):
    pass


# ---------------- SQLite ----------------
def _conn() -> sqlite3.Connection:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(settings.db_path, check_same_thread=False)
    c.execute(
        "create table if not exists docs (kind text, id text, project_id text, body text, "
        "updated_at text default current_timestamp, primary key (kind, id))"
    )
    c.execute("create index if not exists docs_project on docs(kind, project_id)")
    return c


_db = _conn()


def _sq_put(kind: str, id: str, body: Any, project_id: str | None) -> None:
    with _lock:
        _db.execute(
            "insert into docs(kind, id, project_id, body) values (?,?,?,?) "
            "on conflict(kind, id) do update set body=excluded.body, project_id=excluded.project_id, "
            "updated_at=current_timestamp",
            (kind, id, project_id, json.dumps(body)),
        )
        _db.commit()


def _sq_get(kind: str, id: str) -> Any | None:
    row = _db.execute("select body from docs where kind=? and id=?", (kind, id)).fetchone()
    return json.loads(row[0]) if row else None


def _sq_list(kind: str, project_id: str | None) -> list[Any]:
    # rowid breaks ties when several rows share a second-resolution timestamp: newest write first.
    if project_id is None:
        rows = _db.execute("select body from docs where kind=? order by updated_at desc, rowid desc", (kind,)).fetchall()
    else:
        rows = _db.execute(
            "select body from docs where kind=? and project_id=? order by updated_at desc, rowid desc",
            (kind, project_id),
        ).fetchall()
    return [json.loads(r[0]) for r in rows]


# ---------------- Memory ----------------
_mem: dict[str, dict[str, tuple[str | None, Any, int]]] = {}
_tick = 0


def _m_put(kind: str, id: str, body: Any, project_id: str | None) -> None:
    global _tick
    with _lock:
        _tick += 1
        _mem.setdefault(kind, {})[id] = (project_id, json.loads(json.dumps(body)), _tick)


def _m_get(kind: str, id: str) -> Any | None:
    row = _mem.get(kind, {}).get(id)
    return json.loads(json.dumps(row[1])) if row else None


def _m_list(kind: str, project_id: str | None) -> list[Any]:
    rows = sorted(_mem.get(kind, {}).values(), key=lambda r: -r[2])
    return [json.loads(json.dumps(r[1])) for r in rows if project_id is None or r[0] == project_id]


# ---------------- Supabase (PostgREST) ----------------
class _Supabase:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        # New-style secret keys (sb_secret_...) go in `apikey`; legacy service_role JWTs also need Bearer.
        headers = {"apikey": key, "Content-Type": "application/json"}
        if key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {key}"
        self.c = httpx.Client(headers=headers, timeout=20)

    def _check(self, r: httpx.Response) -> httpx.Response:
        if r.status_code >= 400:
            try:
                msg = r.json().get("message", r.text)
            except ValueError:
                msg = r.text
            raise StoreError(f"Supabase storage error ({r.status_code}): {msg[:200]}")
        return r

    def put(self, kind: str, id: str, body: Any, project_id: str | None) -> None:
        row: dict[str, Any] = {"id": id, "doc": body}
        if kind != "project":
            row["project_id"] = project_id
        self._check(self.c.post(f"{self.base}/{TABLES[kind]}", json=row,
                                headers={"Prefer": "resolution=merge-duplicates,return=minimal"}))

    def get(self, kind: str, id: str) -> Any | None:
        r = self._check(self.c.get(f"{self.base}/{TABLES[kind]}", params={"id": f"eq.{id}", "select": "doc"}))
        rows = r.json()
        return rows[0]["doc"] if rows else None

    def list_(self, kind: str, project_id: str | None) -> list[Any]:
        params = {"select": "doc", "order": "updated_at.desc", "limit": "1000"}
        if project_id is not None:
            params["project_id"] = f"eq.{project_id}"
        return [r["doc"] for r in self._check(self.c.get(f"{self.base}/{TABLES[kind]}", params=params)).json()]


def _choose() -> tuple[str, _Supabase | None, str | None]:
    """(backend, supabase client, note). HONE_STORE forces one: supabase | sqlite | memory."""
    forced = os.getenv("HONE_STORE", "").lower()
    local = "memory" if settings.public else "sqlite"
    if forced in ("sqlite", "memory"):
        return forced, None, None
    if settings.supabase_url and settings.supabase_key:
        sb = _Supabase(settings.supabase_url, settings.supabase_key)
        try:
            sb.list_("project", None)
            return "supabase", sb, None
        except (StoreError, httpx.HTTPError) as e:
            return local, None, f"Supabase isn't reachable ({str(e)[:120]}), so results are kept temporarily."
    return local, None, None


BACKEND, _sb, NOTE = _choose()


def _local():
    return (_m_put, _m_get, _m_list) if BACKEND == "memory" or (settings.public and _sb) else (_sq_put, _sq_get, _sq_list)


# ---------------- public API ----------------
def put(kind: str, id: str, body: Any, project_id: str | None = None) -> None:
    if _sb and kind not in LOCAL_ONLY:
        _sb.put(kind, id, body, project_id)
    else:
        _local()[0](kind, id, body, project_id)


def get(kind: str, id: str) -> Any | None:
    if _sb and kind not in LOCAL_ONLY:
        return _sb.get(kind, id)
    return _local()[1](kind, id)


def list_(kind: str, project_id: str | None = None) -> list[Any]:
    if _sb and kind not in LOCAL_ONLY:
        return _sb.list_(kind, project_id)
    return _local()[2](kind, project_id)


def health() -> dict:
    """Which backend is in use, whether data survives a restart, and why if not."""
    out = {"backend": BACKEND, "persistent": BACKEND != "memory", "note": NOTE}
    if _sb:
        try:
            _sb.list_("project", None)
            out["ok"] = True
        except (StoreError, httpx.HTTPError) as e:
            out.update(ok=False, note=f"Supabase isn't answering: {str(e)[:120]}")
    else:
        out["ok"] = True
    return out
