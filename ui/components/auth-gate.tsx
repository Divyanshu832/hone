"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { currentSession, MOCK } from "@/lib/api";
import { supa } from "@/lib/auth";

export const PUBLIC_PATHS = ["/login", "/signup"];
const isPublic = (p: string) => PUBLIC_PATHS.includes(p) || p.startsWith("/invite/");

export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: currentSession, enabled: !MOCK, staleTime: 5 * 60_000, retry: 1 });
}

/** With accounts on, every screen needs a signed-in person who's in an organization. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const s = useSession();
  const open = isPublic(pathname);

  // Signing in or out anywhere (another tab too) refreshes who we are; signing out drops cached data.
  useEffect(() => {
    let off = () => {};
    supa().then((c) => {
      if (!c) return;
      const { data } = c.auth.onAuthStateChange((event) => {
        // resetQueries (not clear) so screens that are showing refetch as the new person.
        if (event === "SIGNED_OUT") qc.resetQueries();
        if (event === "SIGNED_IN" || event === "USER_UPDATED") qc.invalidateQueries({ queryKey: ["session"] });
      });
      off = () => data.subscription.unsubscribe();
    });
    return () => off();
  }, [qc]);

  const need =
    MOCK || open || !s.data || !s.data.enabled ? null : !s.data.me ? "login" : !s.data.me.org ? "org" : null;
  useEffect(() => {
    if (need === "login") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    if (need === "org") router.replace("/signup");
  }, [need, pathname, router]);

  if (MOCK || open) return <>{children}</>;
  if (s.isError) return <>{children}</>; // the screens show their own error if the backend is down
  if (!s.data || need) return <div className="min-h-dvh" aria-busy="true" />;
  return <>{children}</>;
}
