"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useRef, useState } from "react";
import { Play, X } from "@phosphor-icons/react";
import { agentStatus, getProject, listCriteria, listRuns, startRun } from "@/lib/api";
import { planRun } from "@/lib/planner";
import { usd } from "@/lib/stats";
import type { AgentStatus, Project, Split } from "@/lib/types";
import { ErrorState, PageHeader, Pct, Skeleton, TrustBadge, timeAgo } from "@/components/ui";
import { ErrorLine, KeyVal } from "@/components/wizard/parts";
import { MoneyInput } from "@/components/money-input";

/** Tells you, before spending anything, whether this run tests a new version of the agent. */
function AgentChange({ s, loading, projectId }: { s: AgentStatus | null | undefined; loading: boolean; projectId: string }) {
  if (loading)
    return (
      <p className="text-ui text-ink-2" role="status">
        Checking whether the agent changed…
      </p>
    );
  if (!s) return null;
  if (s.changed && s.previousVersion)
    return (
      <div className="cr-alert cr-alert--success">
        <span aria-hidden>↑</span>
        <span>
          <strong>Agent changed since v{s.previousVersion}.</strong> {s.summary}. This run tests v{s.version}, checks which
          recommendations you applied and measures them.
        </span>
      </div>
    );
  if (s.changed || !s.lastRun) return null; // first version: nothing to compare with
  return (
    <div className="cr-alert cr-alert--warning">
      <span aria-hidden>=</span>
      <span>
        <strong>No changes since the last run.</strong> The agent is still v{s.version}
        {s.lastRun.passK != null && (
          <>
            {" "}(last run{" "}
            <Link href={`/p/${projectId}/runs/${s.lastRun.id}`} className="underline">
              {Math.round(s.lastRun.passK * 100)}% pass^k
            </Link>
            , {timeAgo(s.lastRun.at)})
          </>
        )}
        . Running again only re-measures the same agent. Unless you changed the rubric, Hone won&apos;t pay for new recommendations
        {s.openRecommendations ? ` (${s.openRecommendations} are still waiting to be applied)` : ""}.
        {s.readError && <> Couldn&apos;t re-read the agent: {s.readError}</>}
      </span>
    </div>
  );
}

function PlanDialog({ p, onClose }: { p: Project; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [budget, setBudget] = useState(p.budgetUsd);
  const [split, setSplit] = useState<Split>("dev");
  const crit = useQuery({ queryKey: ["criteria", p.id], queryFn: () => listCriteria(p.id) });
  const status = useQuery({ queryKey: ["agent-status", p.id], queryFn: () => agentStatus(p.id), staleTime: 0 });
  const total = p.counts.conversations + p.counts.generated || 100;
  const available = split === "dev" ? Math.round(total * 0.8) : Math.round(total * 0.2);
  const judged = crit.data?.filter((c) => c.kind === "judge").length ?? 5;
  const plan = planRun({ budgetUsd: budget, available, judgeCriteria: judged });
  const start = useMutation({
    mutationFn: () => startRun(p.id, { scenarios: plan.scenarios, k: plan.k, budgetUsd: budget, estUsd: plan.estUsd, split }),
    onSuccess: (runId) => router.push(`/p/${p.id}/runs/${runId}`),
  });

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="plan-title"
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-card border border-line bg-surface p-0 text-ink shadow-3 backdrop:bg-[color-mix(in_srgb,var(--pine-950)_45%,transparent)]"
    >
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <h2 className="cr-h3" id="plan-title">
          Plan a <em>run</em>
        </h2>
        <button className="cr-btn cr-btn--ghost cr-btn--icon cr-btn--sm" aria-label="Close" onClick={() => ref.current?.close()}>
          <X />
        </button>
      </div>
      <div className="grid gap-5 px-6 py-5">
        <AgentChange s={status.data} loading={status.isPending} projectId={p.id} />
        <div className="grid gap-2">
          <span className="cr-label">Which conversations</span>
          <div className="cr-seg w-fit" role="group" aria-label="Split">
            <button aria-pressed={split === "dev"} onClick={() => setSplit("dev")}>
              Dev ({Math.round(total * 0.8)})
            </button>
            <button aria-pressed={split === "test"} onClick={() => setSplit("test")}>
              Held-out test ({Math.round(total * 0.2)})
            </button>
          </div>
          <span className="cr-help">
            {split === "dev"
              ? "Use dev while you're changing the agent."
              : "Use the held-out test for the number you report. Run it sparingly so it stays honest."}
          </span>
        </div>
        <div className="cr-field">
          <span className="cr-label">Spend cap for this run</span>
          <MoneyInput value={budget} onChange={setBudget} label="Spend cap in dollars" />
        </div>
        <div className="rounded-card border border-line px-4 py-1">
          <KeyVal k="Scenarios">
            <span className="num">{plan.scenarios}</span> of <span className="num">{available}</span>
          </KeyVal>
          <KeyVal k="Trials each">
            <span className="num">{plan.k}</span>
          </KeyVal>
          <KeyVal k="Judge">{plan.judgeModel}</KeyVal>
          <KeyVal k="Estimated cost">
            <span className="num">{usd(plan.estUsd)}</span> <span className="text-ink-2">of {usd(budget)}</span>
          </KeyVal>
        </div>
        <p className="text-body-sm text-ink-2">{plan.note}</p>
        {start.isError && <ErrorLine error={start.error} />}
      </div>
      <div className="flex justify-end gap-3 border-t border-line px-6 py-4">
        <button className="cr-btn cr-btn--ghost" onClick={() => ref.current?.close()}>
          Cancel
        </button>
        <button className="cr-btn cr-btn--primary" disabled={plan.scenarios === 0 || start.isPending} aria-busy={start.isPending} onClick={() => start.mutate()}>
          <Play weight="fill" /> Start run
        </button>
      </div>
    </dialog>
  );
}

function RunsInner() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const [planning, setPlanning] = useState(sp.get("plan") === "1");
  const p = useQuery({ queryKey: ["project", id], queryFn: () => getProject(id) });
  const runs = useQuery({ queryKey: ["runs", id], queryFn: () => listRuns(id) });

  return (
    <>
      <PageHeader
        overline="Runs"
        title={
          <>
            Every run, <em>side by side</em>
          </>
        }
        lede="Each run plays every scenario several times inside your spend cap."
        actions={
          runs.data && runs.data.length > 0 ? (
            <button className="cr-btn cr-btn--primary" onClick={() => setPlanning(true)} disabled={!p.data}>
              <Play weight="fill" /> Plan a run
            </button>
          ) : null
        }
      />
      {runs.isError && <ErrorState error={runs.error} retry={() => runs.refetch()} />}
      {runs.isPending && <Skeleton className="h-[260px] rounded-card" />}
      {runs.data && runs.data.length === 0 && (
        <div className="cr-empty">
          <span className="cr-empty__icon">
            <Play />
          </span>
          <h2 className="cr-h3">No runs yet</h2>
          <p>Hone plans the first run to fit your budget. You see the cost before it starts.</p>
          <button className="cr-btn cr-btn--primary" onClick={() => setPlanning(true)}>
            Plan the first run
          </button>
        </div>
      )}
      {runs.data && runs.data.length > 0 && (
        <div className="cr-card overflow-x-auto p-0 rise">
          <table className="cr-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Split</th>
                <th className="num">Scenarios</th>
                <th className="num">pass^k</th>
                <th className="num">pass@1</th>
                <th>Judges</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/p/${id}/runs/${r.id}`} className="num weight-medium text-ink hover:text-primary-ink">
                      {r.id}
                    </Link>
                    <span className="ml-2 text-caption text-ink-2">{timeAgo(r.createdAt)}</span>
                  </td>
                  <td>{r.split === "test" ? "Held-out test" : "Dev"}</td>
                  <td className="num">
                    {r.scenarios} × {r.k}
                  </td>
                  <td className="num">
                    <Pct value={r.passK} />
                  </td>
                  <td className="num">
                    <Pct value={r.pass1} />
                  </td>
                  <td>
                    <TrustBadge trusted={r.trusted} compact />
                  </td>
                  <td className="num">
                    {usd(r.costUsd)} <span className="text-ink-2">/ {usd(r.budgetUsd)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {planning && p.data && (
        <PlanDialog
          p={p.data}
          onClose={() => {
            setPlanning(false);
            if (sp.get("plan")) router.replace(`/p/${id}/runs`);
          }}
        />
      )}
    </>
  );
}

export default function RunsPage() {
  return (
    <Suspense>
      <RunsInner />
    </Suspense>
  );
}
