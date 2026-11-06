"""Accounts: sign-in with Supabase Auth (email + password), one organization per person, invite links.

- The browser signs up and signs in with Supabase directly (publishable key) and sends its access token
  as `Authorization: Bearer ...`. Hone checks the token with Supabase and looks up the person's profile.
- Profiles, organizations and invites are tables in Hone's Supabase (see supabase/schema.sql). Only the
  server's secret key can read or write them.
- Sign-in is on when Supabase storage is in use and the publishable key is set. Otherwise Hone works
  without accounts, as before (projects are scoped to the browser).
"""

from __future__ import annotations

import secrets
import time
from datetime import UTC, datetime
from typing import Any

import httpx

from . import store
from .config import settings

ENABLED = bool(store.BACKEND == "supabase" and settings.supabase_url and settings.supabase_publishable)


class AuthError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def config() -> dict:
    """What the browser needs to sign in. The publishable key is designed to be public."""
    if not ENABLED:
        return {"enabled": False}
    return {"enabled": True, "url": settings.supabase_url, "publishableKey": settings.supabase_publishable}


# ---------------- Supabase calls ----------------
_http = httpx.AsyncClient(timeout=15)


def _rest_headers(**extra: str) -> dict:
    key = settings.supabase_key or ""
    h = {"apikey": key, "Content-Type": "application/json", **extra}
    if key.startswith("eyJ"):
        h["Authorization"] = f"Bearer {key}"
    return h


async def _rest(method: str, table: str, params: dict | None = None, json: Any = None, prefer: str = "") -> list[dict]:
    r = await _http.request(method, f"{settings.supabase_url}/rest/v1/{table}", params=params, json=json,
                            headers=_rest_headers(**({"Prefer": prefer} if prefer else {})))
    if r.status_code >= 400:
        raise store.StoreError(f"Supabase error ({r.status_code}): {r.text[:200]}")
    return r.json() if r.content else []


# Token -> (expires, user). Saves a round trip to Supabase on every request; a minute is short enough
# that a signed-out token stops working quickly.
_users: dict[str, tuple[float, dict]] = {}


async def user_for(token: str) -> dict | None:
    hit = _users.get(token)
    if hit and hit[0] > time.time():
        return hit[1]
    r = await _http.get(f"{settings.supabase_url}/auth/v1/user",
                        headers={"apikey": settings.supabase_publishable or "", "Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        return None
    u = r.json()
    user = {"id": u["id"], "email": (u.get("email") or "").lower(), "name": (u.get("user_metadata") or {}).get("name", "")}
    if len(_users) > 2000:
        _users.clear()
    _users[token] = (time.time() + 60, user)
    return user


async def profile(user: dict) -> dict:
    """The person's profile, made on first sign-in from what they gave at sign-up."""
    rows = await _rest("GET", "hone_profiles", {"id": f"eq.{user['id']}", "select": "*"})
    if rows:
        return rows[0]
    row = {"id": user["id"], "email": user["email"], "name": (user.get("name") or "").strip()[:80]}
    return (await _rest("POST", "hone_profiles", json=row, prefer="return=representation"))[0]


async def me(p: dict) -> dict:
    org = None
    if p.get("org_id"):
        rows = await _rest("GET", "hone_orgs", {"id": f"eq.{p['org_id']}", "select": "id,name"})
        org = rows[0] if rows else None
    return {"id": p["id"], "email": p["email"], "name": p["name"], "role": p.get("role"), "org": org}


async def update_name(p: dict, name: str) -> dict:
    name = name.strip()[:80]
    if not name:
        raise AuthError(400, "Add your name.")
    await _rest("PATCH", "hone_profiles", {"id": f"eq.{p['id']}"}, {"name": name})
    return await me({**p, "name": name})


# ---------------- organizations ----------------
async def create_org(p: dict, name: str) -> dict:
    name = name.strip()[:80]
    if not name:
        raise AuthError(400, "Add your organization's name.")
    if p.get("org_id"):
        raise AuthError(400, "You're already in an organization.")
    if not (p.get("name") or "").strip():
        raise AuthError(400, "Add your name first.")
    org = (await _rest("POST", "hone_orgs", json={"name": name, "created_by": p["id"]}, prefer="return=representation"))[0]
    # Only if they still have no organization: two clicks at once must not leave an empty extra one.
    done = await _rest("PATCH", "hone_profiles", {"id": f"eq.{p['id']}", "org_id": "is.null"},
                       {"org_id": org["id"], "role": "owner"}, prefer="return=representation")
    if not done:
        await _rest("DELETE", "hone_orgs", {"id": f"eq.{org['id']}"})
        raise AuthError(400, "You're already in an organization.")
    return await me({**p, "org_id": org["id"], "role": "owner"})


async def rename_org(p: dict, name: str) -> dict:
    _owner(p)
    name = name.strip()[:80]
    if not name:
        raise AuthError(400, "Add your organization's name.")
    await _rest("PATCH", "hone_orgs", {"id": f"eq.{p['org_id']}"}, {"name": name})
    return await me(p)


def _owner(p: dict) -> None:
    if not p.get("org_id"):
        raise AuthError(403, "Create or join an organization first.")
    if p.get("role") != "owner":
        raise AuthError(403, "Only an owner of the organization can do this.")


async def team(p: dict) -> dict:
    members = await _rest("GET", "hone_profiles", {"org_id": f"eq.{p['org_id']}", "select": "id,email,name,role,created_at",
                                                    "order": "created_at.asc"})
    invites = []
    if p.get("role") == "owner":
        invites = await _rest("GET", "hone_invites", {"org_id": f"eq.{p['org_id']}", "accepted_at": "is.null",
                                                      "select": "id,email,role,token,created_at,expires_at",
                                                      "order": "created_at.desc"})
    return {
        "members": [{"id": m["id"], "email": m["email"], "name": m["name"], "role": m["role"], "joinedAt": m["created_at"]}
                    for m in members],
        "invites": [{"id": i["id"], "email": i["email"], "role": i["role"], "token": i["token"],
                     "createdAt": i["created_at"], "expiresAt": i["expires_at"], "expired": _expired(i)} for i in invites],
    }


async def invite(p: dict, email: str, role: str) -> dict:
    _owner(p)
    email = email.strip().lower()
    if "@" not in email or len(email) > 200:
        raise AuthError(400, "That doesn't look like an email address.")
    if role not in ("owner", "member"):
        raise AuthError(400, "Role must be owner or member.")
    taken = await _rest("GET", "hone_profiles", {"email": f"eq.{email}", "select": "org_id"})
    if taken and taken[0].get("org_id") == p["org_id"]:
        raise AuthError(400, "They're already in your organization.")
    # One open invite per email: a new one replaces the old link.
    await _rest("DELETE", "hone_invites", {"org_id": f"eq.{p['org_id']}", "email": f"eq.{email}", "accepted_at": "is.null"})
    row = {"token": secrets.token_urlsafe(24), "org_id": p["org_id"], "email": email, "role": role, "invited_by": p["id"]}
    i = (await _rest("POST", "hone_invites", json=row, prefer="return=representation"))[0]
    return {"id": i["id"], "email": i["email"], "role": i["role"], "token": i["token"],
            "createdAt": i["created_at"], "expiresAt": i["expires_at"], "expired": False}


async def revoke_invite(p: dict, invite_id: str) -> None:
    _owner(p)
    await _rest("DELETE", "hone_invites", {"id": f"eq.{invite_id}", "org_id": f"eq.{p['org_id']}"})


async def remove_member(p: dict, user_id: str) -> None:
    _owner(p)
    if user_id == p["id"]:
        raise AuthError(400, "You can't remove yourself.")
    await _rest("PATCH", "hone_profiles", {"id": f"eq.{user_id}", "org_id": f"eq.{p['org_id']}"}, {"org_id": None, "role": None})


# ---------------- invites ----------------
def _expired(i: dict) -> bool:
    return datetime.fromisoformat(i["expires_at"]) < datetime.now(UTC)


async def _invite_by_token(token: str) -> dict | None:
    rows = await _rest("GET", "hone_invites", {"token": f"eq.{token}", "select": "*,hone_orgs(name)"})
    return rows[0] if rows else None


async def invite_info(token: str) -> dict:
    """What the invite page shows before anyone signs in: the email it's for and the organization."""
    i = await _invite_by_token(token)
    if not i:
        raise AuthError(404, "This invite link isn't valid. Ask for a new one.")
    inviter = await _rest("GET", "hone_profiles", {"id": f"eq.{i['invited_by']}", "select": "name"}) if i.get("invited_by") else []
    status = "used" if i.get("accepted_at") else "expired" if _expired(i) else "open"
    return {"email": i["email"], "role": i["role"], "orgName": (i.get("hone_orgs") or {}).get("name", ""),
            "invitedBy": inviter[0]["name"] if inviter else "", "status": status}


async def accept(p: dict, token: str) -> dict:
    i = await _invite_by_token(token)
    if not i:
        raise AuthError(404, "This invite link isn't valid. Ask for a new one.")
    if i.get("accepted_at"):
        raise AuthError(400, "This invite has already been used.")
    if _expired(i):
        raise AuthError(400, "This invite has expired. Ask for a new one.")
    if i["email"].lower() != p["email"].lower():
        raise AuthError(403, f"This invite is for {i['email']}. Sign in with that email to accept it.")
    if p.get("org_id") and p["org_id"] != i["org_id"]:
        raise AuthError(400, "You're already in another organization.")
    if not (p.get("name") or "").strip():
        raise AuthError(400, "Add your name first.")
    await _rest("PATCH", "hone_profiles", {"id": f"eq.{p['id']}"}, {"org_id": i["org_id"], "role": i["role"]})
    await _rest("PATCH", "hone_invites", {"id": f"eq.{i['id']}"},
                {"accepted_at": datetime.now(UTC).isoformat(), "accepted_by": p["id"]})
    return await me({**p, "org_id": i["org_id"], "role": i["role"]})


# ---------------- model keys ----------------
# The organization's OpenRouter and TypeSafe keys, saved in hone_org_keys. The browser only ever gets them
# masked; the full keys are used on the server for the organization's requests.
KEY_FIELDS = ("openrouter", "typesafe")
_org_keys: dict[str, tuple[float, dict]] = {}


def _mask(k: str | None) -> str:
    return f"{k[:6]}…{k[-4:]}" if k else ""


async def org_keys_raw(org_id: str) -> dict:
    hit = _org_keys.get(org_id)
    if hit and hit[0] > time.time():
        return hit[1]
    rows = await _rest("GET", "hone_org_keys", {"org_id": f"eq.{org_id}", "select": ",".join(KEY_FIELDS)})
    keys = {f: (rows[0].get(f) if rows else None) or None for f in KEY_FIELDS}
    _org_keys[org_id] = (time.time() + 60, keys)
    return keys


async def org_keys(p: dict) -> dict:
    keys = await org_keys_raw(p["org_id"])
    return {f: _mask(keys[f]) for f in KEY_FIELDS}


async def save_org_keys(p: dict, changes: dict[str, str | None]) -> dict:
    """Set or clear the organization's keys. Fields left out stay as they are; an empty value removes one."""
    if not p.get("org_id"):
        raise AuthError(403, "Create or join an organization first.")
    row = {f: (changes[f] or "").strip() or None for f in KEY_FIELDS if f in changes}
    if row:
        await _rest("POST", "hone_org_keys", json={"org_id": p["org_id"], "updated_by": p["id"], **row},
                    prefer="resolution=merge-duplicates,return=minimal")
    _org_keys.pop(p["org_id"], None)
    return await org_keys(p)
