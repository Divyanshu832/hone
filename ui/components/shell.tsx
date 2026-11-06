"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Gauge,
  ListChecks,
  Play,
  Tag,
  Scales,
  ShieldCheck,
  GearSix,
  SquaresFour,
  Plus,
  Sun,
  Moon,
  Desktop,
  ClockCounterClockwise,
  Key,
} from "@phosphor-icons/react";
import { Suspense, useSyncExternalStore } from "react";
import { getProject, health, orgKeys } from "@/lib/api";
import { getKeys, subscribeKeys } from "@/lib/keys";
import { cx, HostMark } from "./ui";
import { useSession } from "./auth-gate";
import { ContactSalesLink, SALES_EMAIL } from "./contact-sales";
import { MOCK } from "@/lib/api";

const PROJECT_NAV = [
  { href: "", label: "Overview", icon: Gauge },
  { href: "/rubric", label: "Rubric", icon: ListChecks },
  { href: "/runs", label: "Runs", icon: Play },
  { href: "/history", label: "History", icon: ClockCounterClockwise },
  { href: "/label", label: "Label", icon: Tag },
  { href: "/judges", label: "Judges", icon: Scales },
  { href: "/gate", label: "Gate", icon: ShieldCheck },
];

function NavLink({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-9 items-center gap-3 rounded-control px-3 text-body-sm weight-medium transition-colors duration-[var(--duration-fast)]",
        active ? "bg-surface text-ink shadow-1" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon size={20} weight={active ? "fill" : "regular"} className={active ? "text-primary-ink" : ""} />
      {children}
    </Link>
  );
}

type Theme = "auto" | "light" | "dark";
const themeListeners = new Set<() => void>();
function readTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "auto";
}
function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("hone-theme", t);
  } catch {}
  themeListeners.forEach((l) => l());
}
function subscribeTheme(l: () => void) {
  themeListeners.add(l);
  return () => themeListeners.delete(l);
}

function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "auto" as Theme);
  const set = applyTheme;
  const opts = [
    { v: "light", icon: Sun, label: "Light" },
    { v: "auto", icon: Desktop, label: "System" },
    { v: "dark", icon: Moon, label: "Dark" },
  ] as const;
  return (
    <div className="cr-seg w-full" role="group" aria-label="Theme">
      {opts.map((o) => (
        <button
          key={o.v}
          aria-pressed={theme === o.v}
          aria-label={o.label}
          title={o.label}
          onClick={() => set(o.v)}
          className="flex flex-1 items-center justify-center"
        >
          <o.icon size={16} />
        </button>
      ))}
    </div>
  );
}

function useProjectContext() {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const id = params?.id;
  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id!),
    enabled: !!id,
  });
  return { pathname, id, project, base: id ? `/p/${id}` : "" };
}

function Sidebar() {
  const { pathname, id, project, base } = useProjectContext();
  return (
    <>
      <nav className="grid gap-1" aria-label="Main">
        <NavLink href="/" active={pathname === "/"} icon={SquaresFour}>
          Projects
        </NavLink>
      </nav>

      {id && (
        <div className="grid gap-2">
          <div className="flex items-center gap-2 px-2">
            {project && <HostMark host={project.host} size={22} />}
            <span className="truncate text-ui weight-bold text-ink">{project?.name ?? "Project"}</span>
          </div>
          <nav className="grid gap-1" aria-label="Project">
            {PROJECT_NAV.map((n) => {
              const href = base + n.href;
              const active = n.href === "" ? pathname === base : pathname.startsWith(href);
              return (
                <NavLink key={n.label} href={href} active={active} icon={n.icon}>
                  {n.label}
                </NavLink>
              );
            })}
          </nav>
        </div>
      )}

      <div className="mt-auto grid gap-3">
        <Link href="/new" className="cr-btn cr-btn--secondary w-full">
          <Plus /> Test a new agent
        </Link>
        <NavLink href="/settings" active={pathname === "/settings"} icon={GearSix}>
          Settings
        </NavLink>
        <WhoAmI />
        <ThemeSwitch />
      </div>
    </>
  );
}

/** Who's signed in and which organization they're working in. */
function WhoAmI() {
  const s = useSession();
  const me = s.data?.enabled ? s.data.me : null;
  if (!me?.org) return null;
  return (
    <Link href="/settings" className="flex items-center gap-3 rounded-control px-2 py-1.5 hover:bg-surface-2">
      <span className="cr-avatar" aria-hidden>
        {(me.name || me.email).slice(0, 1).toUpperCase()}
      </span>
      <span className="grid min-w-0 leading-tight">
        <span className="truncate text-ui weight-medium text-ink">{me.name || me.email}</span>
        <span className="truncate text-caption text-ink-2">{me.org.name}</span>
      </span>
    </Link>
  );
}

function MobileNav() {
  const { id, base, pathname } = useProjectContext();
  if (!id) return null;
  return (
    <nav className="ml-auto flex gap-1 overflow-x-auto" aria-label="Project">
      {PROJECT_NAV.map((n) => {
        const href = base + n.href;
        const active = n.href === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={n.label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx("cr-btn cr-btn--ghost cr-btn--sm shrink-0", active && "bg-surface-2 text-ink")}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

const NO_KEYS = { openrouter: "", typesafe: "" };

/** Tells visitors what they need to know before running anything: their keys, and whether results last. */
function Notices() {
  const k = useSyncExternalStore(subscribeKeys, getKeys, () => NO_KEYS);
  const h = useQuery({ queryKey: ["health"], queryFn: health, enabled: !MOCK, staleTime: 60_000 });
  const pathname = usePathname();
  const session = useSession();
  const inOrg = !!(session.data?.enabled && session.data.me?.org);
  const ok = useQuery({ queryKey: ["org-keys"], queryFn: orgKeys, enabled: inOrg, staleTime: 60_000 });
  if (MOCK || !h.data) return null;
  // Signed in, the organization's saved keys count; otherwise the ones in this browser.
  const haveKeys = inOrg ? !!(ok.data?.openrouter || ok.data?.typesafe) : !!(k.openrouter || k.typesafe);
  const needKeys = !haveKeys && pathname !== "/settings" && (!inOrg || ok.isSuccess);
  const temporary = !h.data.storage.persistent || !h.data.storage.ok;
  if (!needKeys && !temporary) return null;
  return (
    <div className="grid gap-2 px-5 pt-4 md:px-10">
      {needKeys && (
        <div className="cr-alert">
          <Key aria-hidden />
          <span>
            <strong>Add your keys to run tests.</strong> Hone runs on your OpenRouter or TypeSafe key.{" "}
            <Link href="/settings" className="underline">
              Add keys
            </Link>
            {SALES_EMAIL && (
              <>
                {" "}or <ContactSalesLink org={session.data?.enabled ? session.data.me?.org?.name : undefined} /> for the managed plan.
              </>
            )}
          </span>
        </div>
      )}
      {temporary && (
        <div className="cr-alert cr-alert--warning">
          <span aria-hidden>!</span>
          <span>
            <strong>Results are temporary.</strong> There&apos;s no database connected, so they last until the server restarts.
          </span>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[var(--sidebar-width)_1fr]">
      <a href="#main" className="cr-btn cr-btn--secondary sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line bg-bg px-4 py-5 md:flex">
        <Link href="/" className="flex items-baseline gap-2 px-2">
          <span className="font-display text-[26px] leading-none tracking-[-0.02em]">
            H<em>one</em>
          </span>
          {MOCK && <span className="cr-overline ml-auto">demo data</span>}
        </Link>
        <Suspense>
          <Sidebar />
        </Suspense>
      </aside>

      <div className="min-w-0">
        <div className="flex h-[var(--topbar-height)] items-center gap-3 border-b border-line px-4 md:hidden">
          <Link href="/" className="font-display text-[22px]">
            H<em>one</em>
          </Link>
          <Suspense>
            <MobileNav />
          </Suspense>
        </div>
        <Suspense>
          <Notices />
        </Suspense>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1180px] px-5 py-8 md:px-10 md:py-10">
          <Suspense fallback={<div className="cr-skeleton h-[420px] rounded-card" />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}
