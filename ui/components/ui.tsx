// Small reusable pieces built on Crest classes. Keep them thin: Crest CSS does the styling.

import type { HostKind } from "@/lib/types";
import { pct } from "@/lib/stats";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

export function Badge({
  tone = "neutral",
  dot,
  live,
  children,
  title,
}: {
  tone?: Tone;
  dot?: boolean;
  live?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx("cr-badge", tone !== "neutral" && `cr-badge--${tone}`)}
      data-state={live ? "live" : dot ? "on" : undefined}
    >
      {children}
    </span>
  );
}

/** Every judge-derived number carries one of these. */
export function TrustBadge({ trusted, compact }: { trusted: boolean; compact?: boolean }) {
  return trusted ? (
    <Badge tone="success" dot title="Judges agree with your labels at least 90% of the time">
      {compact ? "Trusted" : "Judges trusted"}
    </Badge>
  ) : (
    <Badge title="Label a few more conversations so Hone can check its judges">
      {compact ? "Not trusted yet" : "Judges not trusted yet"}
    </Badge>
  );
}

/** Pass/fail across k trials, e.g. 2/3. */
export function TrialPill({ trials }: { trials: boolean[] }) {
  const c = trials.filter(Boolean).length;
  const tone: Tone = c === trials.length ? "success" : c === 0 ? "danger" : "neutral";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex gap-[3px]" aria-hidden>
        {trials.map((t, i) => (
          <span
            key={i}
            className={cx("h-2.5 w-2.5 rounded-[3px]", t ? "bg-success" : "bg-danger")}
          />
        ))}
      </span>
      <Badge tone={tone}>
        <span className="num">
          {c}/{trials.length}
        </span>
      </Badge>
    </span>
  );
}

export function Stat({
  label,
  value,
  delta,
  hint,
  children,
}: {
  label: string;
  value: React.ReactNode;
  delta?: number | null;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="cr-stat">
      <span className="cr-stat__label">{label}</span>
      <span className="cr-stat__value">{value}</span>
      {delta !== undefined && delta !== null && (
        <span className={cx("cr-stat__delta", delta < 0 && "cr-stat__delta--down")}>
          {delta >= 0 ? "+" : ""}
          {(delta * 100).toFixed(1)} pts vs last run
        </span>
      )}
      {hint && <span className="text-caption text-ink-2">{hint}</span>}
      {children}
    </div>
  );
}

export function Field({
  label,
  help,
  error,
  htmlFor,
  children,
}: {
  label: string;
  help?: React.ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="cr-field">
      <label className="cr-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <span className="cr-error">{error}</span> : help ? <span className="cr-help">{help}</span> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("cr-skeleton", className)} />;
}

export function PageHeader({
  overline,
  title,
  lede,
  actions,
}: {
  overline?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      {/* React 19 hoists <title> into <head>, so each screen gets its own tab name. */}
      <title>{`${typeof title === "string" ? title : overline ?? "Hone"} · Hone`}</title>
      <div className="grid max-w-[68ch] gap-2">
        {overline && <span className="cr-overline">{overline}</span>}
        <h1 className="cr-h1">{title}</h1>
        {lede && <p className="text-body text-ink-2">{lede}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="cr-alert cr-alert--danger" role="alert">
      <span aria-hidden>!</span>
      <div className="grid gap-2">
        <span>
          <strong>Something went wrong.</strong> {error instanceof Error ? error.message : String(error)}
        </span>
        {retry && (
          <button className="cr-btn cr-btn--secondary cr-btn--sm w-fit" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export const HOST_LABEL: Record<HostKind, string> = { n8n: "n8n", retell: "Retell", custom: "Custom code" };

export function HostMark({ host, size = 28 }: { host: HostKind; size?: number }) {
  const letter = host === "n8n" ? "n8" : host === "retell" ? "Re" : "</>";
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-control border border-line bg-surface-2 font-mono text-ink-2"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {letter}
    </span>
  );
}

export function Pct({ value, digits = 0 }: { value: number; digits?: number }) {
  return <span className="tabular-nums">{pct(value, digits)}</span>;
}

export function timeAgo(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
