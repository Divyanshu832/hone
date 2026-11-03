"""Supabase knowledge base. Lists tables through PostgREST's OpenAPI document, previews rows and
reads KB chunks. Read only.
"""

from __future__ import annotations

from urllib.parse import urlparse

from .base import ConnectorError, client, explain

TEXT_COLS = ("content", "text", "body", "chunk", "page_content", "document", "answer")


def _base(url: str) -> str:
    p = urlparse(url.strip())
    if p.scheme != "https" or not p.netloc:
        raise ConnectorError("That Supabase URL doesn't look right (https://<project>.supabase.co).")
    return f"https://{p.netloc}/rest/v1"


def _h(key: str) -> dict:
    return {"apikey": key, "Authorization": f"Bearer {key}"}


async def tables(url: str, key: str) -> list[dict]:
    base = _base(url)
    async with client(headers=_h(key)) as c:
        r = await c.get(f"{base}/", headers={"Accept": "application/openapi+json"})
        if r.status_code != 200:
            raise explain(r, "Supabase")
        defs = r.json().get("definitions", {})
        out = []
        for name, d in defs.items():
            props = d.get("properties", {})
            vector = any("vector" in (p.get("format") or "") or k in ("embedding", "embeddings") for k, p in props.items())
            hr = await c.head(f"{base}/{name}", params={"select": "*"}, headers={"Prefer": "count=exact"})
            rng = hr.headers.get("content-range", "*/0")
            rows = int(rng.split("/")[-1]) if rng.split("/")[-1].isdigit() else 0
            out.append({"name": name, "rows": rows, "vector": vector})
    return sorted(out, key=lambda t: (not t["vector"], t["name"]))


def _text_of(row: dict) -> str:
    for k in TEXT_COLS:
        if isinstance(row.get(k), str):
            return row[k]
    strings = [v for v in row.values() if isinstance(v, str)]
    return max(strings, key=len) if strings else ""


async def rows(url: str, key: str, table: str, limit: int = 1000) -> list[str]:
    async with client(headers=_h(key)) as c:
        r = await c.get(f"{_base(url)}/{table}", params={"select": "*", "limit": str(limit)})
    if r.status_code != 200:
        raise explain(r, "Supabase")
    return [t for t in (_text_of(x) for x in r.json()) if t]
