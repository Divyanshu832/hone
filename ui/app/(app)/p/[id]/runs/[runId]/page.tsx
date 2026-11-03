"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { getRun, listCriteria, listRecommendations, subscribeRun } from "@/lib/api";
import { RecommendationsCard } from "@/components/recommendations";
import type { Criterion, Run, RunItem, TriageKind } from "@/lib/types";
import { TRIAGE } from "@/lib/triage";
import { pct, usd } from "@/lib/stats";
import { Badge, ErrorState, PageHeader, Pct, Skeleton, Stat, TrialPill, TrustBadge, cx } from "@/components/ui";

function Live({ run }: { run: Run }) {
  const qc = useQueryClient();
  const [done, setDone] = useState(0);
  const [cost, setCost] = useState(0);
  const [fails, setFails] = useState<RunItem[]>([]);
  const [failCount, setFailCount] = useState(0);
  const total = run.scenarios;

  useEffect(() => {
    return subscribeRun(run.id, (e) => {
      setDone(e.done);
      setCost(e.costUsd);
      if (e.type === "failure" && e.item) {
        setFails((f) => [e.item!, ...f].slice(0, 6));
        setFailCount((n) => n + 1);
      }
      if (e.type === "done") qc.invalidateQueries({ queryKey: ["run", run.id] });
    });
  }, [run.id, qc]);

  return (
    <div className="grid gap-6">
      <div className="cr-card grid gap-5 rise">
        <div className="flex items-center justify-between">
          <Badge tone="primary" live>
            Running
          </Badge>
          <span className="num text-ui text-ink-2">
            {done} / {total} scenarios
          </span>
        </div>
        <div className="bar" role="progressbar" aria-valuenow={done} aria-valuemax={total} aria-label="Run progress">
          <span style={{ width: `${(done / total) * 100}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-6">
          <Stat label="Trials played" value={<span className="tabular-nums">{done * run.k}</span>} />
          <Stat label="Spent" value={<span className="tabular-nums">{usd(cost)}</span>} hint={`Cap ${usd(run.budgetUsd)}. Hone stops at the cap.`} />
          <Stat label="Failing so far" value={<span className="tabular-nums">{failCount}</span>} />
        </div>
      </div>
      {fails.length > 0 && (
        <div className="cr-card p-0">
          <h2 className="px-6 pt-5 pb-3 text-body weight-bold">Early failures</h2>
          <ul>
            {fails.map((f) => (
              <li key={f.id} className="flex items-center gap-3 border-t border-line px-6 py-3 rise">
                <TrialPill trials={f.trials} />
                <span className="text-body-sm">{f.scenario}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CriteriaTable({ run, crit }: { run: Run; crit: Criterion[] }) {
  const byId = new Map(crit.map((c) => [c.id, c]));
  const untested = (r: Run["perCriterion"][number]) => r.applicable === 0;
  const rows = [...run.perCriterion].sort(
    (a, b) => Number(untested(a)) - Number(untested(b)) || a.passRate - b.passRate,
  );
  return (
    <div className="cr-card overflow-x-auto p-0">
      <h2 className="px-6 pt-5 pb-3 text-body weight-bold">By criterion</h2>
      <table className="cr-table">
        <thead>
          <tr>
            <th>Criterion</th>
            <th>Pass rate</th>
            <th className="num">Fails</th>
            <th>Grader</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const c = byId.get(r.criterionId);
            return (
              <tr key={r.criterionId}>
                <td>
                  <span className="num mr-2 text-ink-2">{r.criterionId}</span>
                  {c?.text}
                </td>
                <td className="min-w-[160px]">
                  {untested(r) ? (
                    <span className="text-ui text-ink-2">Didn&apos;t come up</span>
                  ) : (
                  <span className="flex items-center gap-3">
                    <span className="bar w-24">
                      <span
                        style={{ width: pct(r.passRate), background: r.passRate < 0.8 ? "var(--danger)" : undefined }}
                      />
                    </span>
                    <Pct value={r.passRate} />
                  </span>
                  )}
                </td>
                <td className="num">{r.failures}</td>
                <td>{c?.kind === "check" ? <Badge>Code check</Badge> : <TrustBadge trusted={r.trusted} compact />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Filter = "all" | "failing" | "flaky";

function Results({ run, crit }: { run: Run; crit: Criterion[] }) {
  const { id } = useParams<{ id: string }>();
  const [filter, setFilter] = useState<Filter>("failing");
  const [triage, setTriage] = useState<TriageKind | null>(null);
  const items = useMemo(() => {
    return run.items.filter((i) => {
      const c = i.trials.filter(Boolean).length;
      if (filter === "failing" && c === i.trials.length) return false;
      if (filter === "flaky" && (c === 0 || c === i.trials.length)) return false;
      if (triage && i.triage !== triage) return false;
      return true;
    });
  }, [run.items, filter, triage]);
  const flaky = run.items.filter((i) => {
    const c = i.trials.filter(Boolean).length;
    return c > 0 && c < i.trials.length;
  }).length;
  const failing = run.items.filter((i) => !i.trials.every(Boolean)).length;
  const recs = useQuery({
    queryKey: ["recommendations", id, run.id],
    queryFn: () => listRecommendations(id, run.id),
    enabled: !run.recommending,
  });

  return (
    <div className="grid gap-6">
      {run.agentVersion && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui text-ink-2">
          <Badge tone={run.agentChanged ? "primary" : "neutral"} dot>
            Agent v{run.agentVersion}
          </Badge>
          <span>
            {run.agentChanged ? `Changed since the last run: ${run.changeSummary}` : "Same agent as the last run."}
          </span>
          <Link href={`/p/${id}/history`} className="text-primary-ink underline">
            See history
          </Link>
          {run.agentReadError && <span className="text-caption">Couldn&apos;t re-read the agent, so this uses the last version Hone saw.</span>}
        </div>
      )}
      <div className="cr-card grid gap-6 rise">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Stat label={`Passes all ${run.k} tries (pass^${run.k})`} value={<Pct value={run.passK} />}>
            <span className="num text-caption text-ink-2">
              95% range {pct(run.ci[0])} - {pct(run.ci[1])}
            </span>
          </Stat>
          <TrustBadge trusted={run.trusted} />
        </div>
        <div className="grid grid-cols-2 gap-6 border-t border-line pt-5 sm:grid-cols-4">
          <Stat label="pass@1" value={<Pct value={run.pass1} />} />
          <Stat label="Flaky scenarios" value={<span className="tabular-nums">{flaky}</span>} hint="Pass sometimes, fail sometimes" />
          <Stat label="Scenarios" value={<span className="tabular-nums">{run.scenarios}</span>} />
          <Stat label="Cost" value={<span className="tabular-nums">{usd(run.costUsd)}</span>} hint={`of ${usd(run.budgetUsd)} cap`} />
        </div>
      </div>

      <div className="grid gap-3">
        <h2 className="text-body weight-bold">Why things failed</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(TRIAGE) as TriageKind[]).map((k) => (
            <button
              key={k}
              aria-pressed={triage === k}
              onClick={() => setTriage(triage === k ? null : k)}
              className={cx("choice gap-1 p-4", triage === k && "border-primary-ink shadow-[0_0_0_3px_var(--primary-soft)]")}
            >
              <span className="flex items-baseline justify-between">
                <span className="text-body-sm weight-bold text-ink">{TRIAGE[k].label}</span>
                <span className="cr-stat__value text-h3">{run.triage[k]}</span>
              </span>
              <span className="text-caption text-ink-2">{TRIAGE[k].body}</span>
            </button>
          ))}
        </div>
      </div>

      <RecommendationsCard recs={recs.data} pending={run.recommending || recs.isPending} skipped={run.recommendationsSkipped} />
      <CriteriaTable run={run} crit={crit} />

      <div className="cr-card overflow-x-auto p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-3">
          <h2 className="text-body weight-bold">Scenarios</h2>
          <div className="cr-seg" role="group" aria-label="Filter scenarios">
            <button aria-pressed={filter === "failing"} onClick={() => setFilter("failing")}>
              Failing <span className="num ml-1 text-ink-2">{failing}</span>
            </button>
            <button aria-pressed={filter === "flaky"} onClick={() => setFilter("flaky")}>
              Flaky <span className="num ml-1 text-ink-2">{flaky}</span>
            </button>
            <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              All <span className="num ml-1 text-ink-2">{run.items.length}</span>
            </button>
          </div>
        </div>
        <table className="cr-table">
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Trials</th>
              <th>Failed on</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link href={`/p/${id}/runs/${run.id}/${i.id}`} className="weight-medium text-ink hover:text-primary-ink">
                    {i.scenario}
                  </Link>
                  {i.source === "generated" && <span className="ml-2 text-caption text-ink-2">generated</span>}
                </td>
                <td>
                  <TrialPill trials={i.trials} />
                </td>
                <td className="num text-ui text-ink-2">{i.failedCriteria.join(", ") || "-"}</td>
                <td>{i.triage ? <Badge tone={TRIAGE[i.triage].tone === "neutral" ? undefined : TRIAGE[i.triage].tone}>{TRIAGE[i.triage].label}</Badge> : "-"}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="text-ink-2">
                  Nothing matches this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RunPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const run = useQuery({
    queryKey: ["run", runId],
    queryFn: () => getRun(runId),
    // Keep checking while Hone writes recommendations after the run.
    refetchInterval: (q) => (q.state.data?.recommending ? 3000 : false),
  });
  const crit = useQuery({ queryKey: ["criteria", id], queryFn: () => listCriteria(id) });

  return (
    <>
      <PageHeader
        overline={
          run.data ? `Run ${run.data.id} · ${run.data.split === "test" ? "Held-out test" : "Dev"} · ${run.data.k} trials each` : "Run"
        }
        title={
          run.data?.status === "running" ? (
            <>
              Running your <em>tests</em>
            </>
          ) : (
            <>
              How the agent <em>did</em>
            </>
          )
        }
        actions={
          <Link href={`/p/${id}/runs`} className="cr-btn cr-btn--secondary">
            All runs
          </Link>
        }
      />
      {run.isError && <ErrorState error={run.error} retry={() => run.refetch()} />}
      {!run.data && !run.isError && <Skeleton className="h-[360px] rounded-card" />}
      {run.data && run.data.status === "running" && <Live run={run.data} />}
      {run.data && run.data.status === "stopped" && (
        <div className="cr-alert cr-alert--warning mb-6">
          <span aria-hidden>!</span>
          <span>
            <strong>Stopped at the spend cap.</strong> {run.data.scenarios} scenarios finished. Results below cover those only.
          </span>
        </div>
      )}
      {run.data && (run.data.status === "done" || run.data.status === "stopped") && crit.data && <Results run={run.data} crit={crit.data} />}
    </>
  );
}
