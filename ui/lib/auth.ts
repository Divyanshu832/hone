/**
 * Accounts. The browser signs up and signs in with Supabase Auth directly (email + password); Hone's
 * backend tells it where Supabase is (`/auth/config`), so the UI needs no extra settings to host.
 * Every API request then carries the access token, and the backend checks it.
 *
 * When the backend has no Supabase (or in demo mode), accounts are off and Hone works as before.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BASE = process.env.NEXT_PUBLIC_API_URL;

type AuthConfig = { enabled: false } | { enabled: true; url: string; publishableKey: string };

let configP: Promise<AuthConfig> | null = null;
let client: SupabaseClient | null = null;

export function authConfig(): Promise<AuthConfig> {
  if (!BASE || typeof window === "undefined") return Promise.resolve({ enabled: false });
  configP ??= fetch(`${BASE}/api/v1/auth/config`)
    .then((r) => (r.ok ? r.json() : { enabled: false }))
    .catch(() => {
      configP = null; // try again next time, the backend may just be starting
      return { enabled: false };
    });
  return configP;
}

export async function supa(): Promise<SupabaseClient | null> {
  const c = await authConfig();
  if (!c.enabled) return null;
  client ??= createClient(c.url, c.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "hone-auth" },
  });
  return client;
}

/** The current access token, refreshed by Supabase when it's close to expiring. */
export async function accessToken(): Promise<string | null> {
  const s = await supa();
  if (!s) return null;
  const { data } = await s.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Supabase's messages are mostly fine; these are the ones people hit. */
export function authMessage(e: { message?: string; code?: string } | null | undefined): string {
  const m = e?.message ?? "Something went wrong.";
  if (/invalid login credentials/i.test(m)) return "That email and password don't match.";
  if (/already registered|already been registered/i.test(m)) return "There's already an account with this email. Log in instead.";
  if (/signups not allowed|signup is disabled/i.test(m)) return "New sign-ups are turned off on this Hone.";
  if (/email not confirmed/i.test(m)) return "Confirm your email first, then log in.";
  return m;
}

export async function signOut() {
  const s = await supa();
  await s?.auth.signOut();
}
