"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Lightbulb } from "@phosphor-icons/react";
import { setRecommendationStatus } from "@/lib/api";
import type { Recommendation, RecStatus } from "@/lib/types";
import { pct } from "@/lib/stats";
import { Badge, cx } from "./ui";

const TARGET: Record<string, string> = { prompt: "Prompt", knowledge_base: "Knowledge base", tool: "Tool" };

function targetLabel(t: string) {
  if (t.startsWith("prompt:")) return `Prompt · ${t.slice(7)}`;
  return TARGET[t] ?? t;
}

/** Where a recommendation is in the loop: suggested → applied in vN → measured. */
export function RecState({ r }: { r: Recommendation }) {
  if (r.status === "dismissed") return <Badge>Dismissed</Badge>;
  if (r.status === "open") return <Badge>Not applied yet</Badge>;
  if (!r.outcome)
    return (
      <Badge tone="primary" dot>
        {r.appliedVersion ? `Applied in v${r.appliedVersion} · measuring next run` : "Marked applied · waiting for the next version"}
      </Badge>
    );
  const tone = r.outcome === "improved" ? "success" : r.outcome === "worse" ? "danger" : "neutral";
  const word = r.outcome === "improved" ? "Helped" : r.outcome === "worse" ? "Made it worse" : "No clear change";
  return (
    <Badge tone={tone} dot>
      {word} in v{r.appliedVersion}
    </Badge>
  );
}

function Movement({ r }: { r: Recommendation }) {
  if (!r.after) return null;
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-2">
      {r.criterionIds
        .filter((c) => c in r.baseline && c in r.after!)
        .map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            <span className="num">{c}</span>
            <span className="tabular-nums">{pct(r.baseline[c])}</span>
            <ArrowRight size={12} aria-label="to" />
            <span className={cx("tabular-nums weight-medium", r.after![c] > r.baseline[c] ? "text-success-ink" : r.after![c] < r.baseline[c] ? "text-danger-ink" : "text-ink")}>
              {pct(r.after![c])}
            </span>
          </span>
        ))}
    </span>
  );
}

export function RecommendationList({ recs, compact = false }: { recs: Recommendation[]; compact?: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: ({ id, status }: { id: string; status: RecStatus }) => setRecommendationStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recommendations"] }),
  });
  return (
    <ul>
      {recs.map((r) => (
        <li key={r.id} className="grid gap-2 border-t border-line px-6 py-4 first:border-t-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <span className="text-body-sm weight-bold text-ink">{r.title}</span>
            <RecState r={r} />
          </div>
          {!compact && r.change && <p className="code whitespace-pre-wrap">{r.change}</p>}
          <span className="flex flex-wrap items-center gap-2 text-caption text-ink-2">
            <Badge>{targetLabel(r.target)}</Badge>
            {r.criterionIds.length > 0 && <span className="num">Fixes {r.criterionIds.join(", ")}</span>}
            {r.why && <span>· {r.why}</span>}
          </span>
          <Movement r={r} />
          {!compact && (
            <div className="flex flex-wrap gap-2">
              {r.status === "open" && (
                <>
                  <button
                    className="cr-btn cr-btn--secondary cr-btn--sm"
                    aria-busy={m.isPending && m.variables?.id === r.id}
                    onClick={() => m.mutate({ id: r.id, status: "applied" })}
                  >
                    I applied this
                  </button>
                  <button className="cr-btn cr-btn--ghost cr-btn--sm" onClick={() => m.mutate({ id: r.id, status: "dismissed" })}>
                    Dismiss
                  </button>
                </>
              )}
              {r.status !== "open" && !r.outcome && (
                <button className="cr-btn cr-btn--ghost cr-btn--sm" onClick={() => m.mutate({ id: r.id, status: "open" })}>
                  Undo
                </button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function RecommendationsCard({ recs, pending, skipped }: { recs: Recommendation[] | undefined; pending?: boolean; skipped?: string }) {
  return (
    <div className="cr-card p-0">
      <div className="grid gap-1 px-6 pt-5 pb-3">
        <h2 className="flex items-center gap-2 text-body weight-bold">
          <Lightbulb size={18} aria-hidden /> What to change next
        </h2>
        <p className="text-ui text-ink-2">
          Apply a change to your agent and run again. Hone spots the new version, works out which of these you applied,
          and measures whether it helped.
        </p>
      </div>
      {pending && (
        <p className="border-t border-line px-6 py-4 text-ui text-ink-2" role="status">
          Writing recommendations from this run…
        </p>
      )}
      {!pending && recs && recs.length === 0 && (
        <p className="border-t border-line px-6 py-4 text-ui text-ink-2">
          {skipped ?? "Nothing to recommend: every criterion that came up passed."}
        </p>
      )}
      {recs && recs.length > 0 && (
        <div className="border-t border-line">
          <RecommendationList recs={recs} />
        </div>
      )}
    </div>
  );
}
