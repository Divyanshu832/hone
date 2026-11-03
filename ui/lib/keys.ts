/**
 * Bring your own key. The visitor's OpenRouter and TypeSafe keys live in this browser only:
 * - by default in sessionStorage (gone when the tab closes),
 * - or in localStorage if they tick "Remember on this device".
 * They're sent with each request to Hone's backend as headers and never stored on the server.
 *
 * The workspace ID is a random ID per browser. On a public host, the server only lists projects made
 * with the same workspace ID, so visitors don't see each other's projects.
 */

export interface Keys {
  openrouter: string;
  typesafe: string;
}

const KEYS = "hone-keys";
const WS = "hone-workspace";
const listeners = new Set<() => void>();

function safe<T>(f: () => T, fallback: T): T {
  try {
    return f();
  } catch {
    return fallback;
  }
}

let cache: Keys | null = null;

export function getKeys(): Keys {
  if (cache) return cache;
  if (typeof window === "undefined") return { openrouter: "", typesafe: "" };
  const raw = safe(() => sessionStorage.getItem(KEYS) ?? localStorage.getItem(KEYS), null);
  cache = { openrouter: "", typesafe: "", ...safe(() => (raw ? JSON.parse(raw) : {}), {}) };
  return cache!;
}

export function isRemembered(): boolean {
  return typeof window !== "undefined" && safe(() => localStorage.getItem(KEYS) !== null, false);
}

export function saveKeys(k: Keys, remember: boolean) {
  const clean = { openrouter: k.openrouter.trim(), typesafe: k.typesafe.trim() };
  cache = clean;
  safe(() => {
    sessionStorage.setItem(KEYS, JSON.stringify(clean));
    if (remember) localStorage.setItem(KEYS, JSON.stringify(clean));
    else localStorage.removeItem(KEYS);
  }, undefined);
  listeners.forEach((l) => l());
}

export function clearKeys() {
  cache = { openrouter: "", typesafe: "" };
  safe(() => {
    sessionStorage.removeItem(KEYS);
    localStorage.removeItem(KEYS);
  }, undefined);
  listeners.forEach((l) => l());
}

export function subscribeKeys(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function workspaceId(): string {
  if (typeof window === "undefined") return "";
  return safe(() => {
    let id = localStorage.getItem(WS);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "");
      localStorage.setItem(WS, id);
    }
    return id;
  }, "");
}

/** Headers for every backend request. */
export function authHeaders(): Record<string, string> {
  const k = getKeys();
  const h: Record<string, string> = {};
  if (k.openrouter) h["x-openrouter-key"] = k.openrouter;
  if (k.typesafe) h["x-typesafe-key"] = k.typesafe;
  const ws = workspaceId();
  if (ws) h["x-hone-workspace"] = ws;
  return h;
}

/** Show only the last few characters, e.g. "sk-or-…a1b2". */
export function mask(key: string): string {
  return key ? `${key.slice(0, 6)}…${key.slice(-4)}` : "";
}
