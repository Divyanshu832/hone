"""Settings from the environment. Keys live in the repo-root .env / .env.local (both gitignored) and are
never returned by the API."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / ".env.local")


def _env(*names: str) -> str | None:
    """First non-empty value among several accepted names (e.g. SUPABASE_SECRET_KEY or supa_secret_key)."""
    for n in names:
        if v := (os.getenv(n) or "").strip().strip('"'):
            return v
    return None


def _base_url(url: str | None) -> str | None:
    """Accept https://<ref>.supabase.co with or without a path like /rest/v1/, and tolerate a pasted
    prefix such as 'NEXT_PUBLIC_SUPABASE_URL=https://...'."""
    if not url:
        return None
    if "http" in url:
        url = url[url.index("http"):]
    from urllib.parse import urlparse

    u = urlparse(url if "://" in url else f"https://{url}")
    return f"{u.scheme}://{u.netloc}"


@dataclass(frozen=True)
class Settings:
    openrouter_key: str | None = os.getenv("OPENROUTER_API_KEY") or None
    typesafe_key: str | None = os.getenv("TYPESAFE_API_KEY") or None
    # OpenRouter models, chosen on a live benchmark (2026-11-04) for quality per dollar:
    # - GLM 5.3 (medium reasoning) writes rubrics, test scenarios and recommendations: few calls, needs judgement.
    # - GLM 5.3 FlashX (low reasoning) plays the customer and is the fallback judge: many short calls.
    sim_model: str = os.getenv("HONE_SIM_MODEL", "z-ai/glm-5.3-flashx")
    rubric_model: str = os.getenv("HONE_RUBRIC_MODEL", "z-ai/glm-5.3")
    judge_model: str = os.getenv("HONE_JUDGE_MODEL", "z-ai/glm-5.3-flashx")  # only when no Jev key
    jev_model: str = os.getenv("HONE_JEV_MODEL", "jev-latest")
    db_path: Path = Path(os.getenv("HONE_DB", str(ROOT / "data" / "hone.db")))
    # Optional Supabase storage for projects, runs, agent snapshots and recommendations. When both are set,
    # Hone stores everything there (connection credentials still stay in the local file).
    supabase_url: str | None = _base_url(_env("SUPABASE_URL", "supa_url", "supa_project_url"))
    supabase_key: str | None = _env("SUPABASE_SECRET_KEY", "supa_secret_key")
    # Sign-in (Supabase Auth, email + password). The publishable key is safe in a browser; with it set and
    # Supabase storage in use, every API call needs a signed-in person who belongs to an organization.
    supabase_publishable: str | None = _env("SUPABASE_PUBLISHABLE_KEY", "supa_publishable_key")
    # Hosted for the public: every visitor brings their own keys, sees only their own projects, and with no
    # database configured, data is kept in memory only (gone when the server restarts).
    public: bool = os.getenv("HONE_PUBLIC", "").lower() in ("1", "true", "yes")
    cors_origins: tuple[str, ...] = tuple(
        os.getenv("HONE_CORS", "http://localhost:3000,http://localhost:3100").split(",")
    )


settings = Settings()
