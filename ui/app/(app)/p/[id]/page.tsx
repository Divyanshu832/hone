"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check } from "@phosphor-icons/react";
import { getAgent, getProject, listRuns } from "@/lib/api";
import type { PipelineStep, Project } from "@/lib/types";
import { ErrorState, HOST_LABEL, HostMark, PageHeader, Pct, Skeleton, Stat, TrustBadge, cx, timeAgo } from "@/components/ui";
import { usd } from "@/lib/stats";
import { VisibilitySwitch } from "@/components/visibility";

const STEPS: { key: PipelineStep; label: string; body: string; href: string; cta: string }[] = [
  { key: "connected", label: "Agent connected", body: "Hone can read and call the agent.", href: "", cta: "" },
  { key: "kb", label: "Knowledge base added", body: "The answer key for facts.", href: "", cta: "" },
  { key: "data", label: "Conversations ready", body: "Real ones first, generated only for gaps.", href: "", cta: "" },
  { key: "rubric", label: "Rubric approved", body: "Pass/fail criteria you agreed with.", href: "/rubric", cta: "Review the rubric" },
  { key: "run", label: "First run", body: "Every scenario, several times.", href: "/runs?plan=1", cta: "Plan a run" },
  { key: "judges", label: "Judges trusted", body: "Label a few so Hone can check its judges.", href: "/label", cta: "Start labeling" },
  { key: "gate", label: "Gate on", body: "Block changes that make the agent worse.", href: "/gate", cta: "Turn on the gate" },
];

function Checklist({ p }: { p: Project }) {
  const next = STEPS.find((s) => !p.pipeline[s.key]);
  return (
    <div className="cr-card p-0">
      <div className="flex items-center justify-between px-6 pt-5 pb-3">
        <h2 className="text-body weight-bold">Setup</h2>
        <span className="num text-ui text-ink-2">
          {STEPS.filter((s) => p.pipeline[s.key]).length}/{STEPS.length}
        </span>
      </div>
      <ol>
        {STEPS.map((s) => {
          const done = p.pipeline[s.key];
          const isNext = next?.key === s.key;
          return (
            <li
              key={s.key}
              className={cx(
                "grid grid-cols-[28px_1fr_auto] items-center gap-3 border-t border-line px-6 py-3",
                isNext && "bg-accent-soft",
              )}
            >
              <span
                aria-hidden
                className={cx(
                  "grid h-6 w-6 place-items-center rounded-full",
                  done ? "bg-primary text-on-primary" : isNext ? "border-2 border-accent" : "border border-line-strong",
                )}
              >
                {done && <Check size={13} weight="bold" />}
              </span>
              <span className="grid">
                <span className={cx("text-body-sm weight-medium", done ? "text-ink-2" : "text-ink")}>{s.label}</span>
                {isNext && <span className="text-ui text-ink-2">{s.body}</span>}
              </span>
              {isNext && s.href && (
                <Link href={`/p/${p.id}${s.href}`} className="cr-btn cr-btn--primary cr-btn--sm">
                  {s.cta} <ArrowRight />
                </Link>
              )}
              {done && <span className="sr-only">done</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function Overview() {
  const { id } = useParams<{ id: string }>();
  const p = useQuery({ queryKey: ["project", id], queryFn: () => getProject(id) });
  const agent = useQuery({ queryKey: ["agent", id], queryFn: () => getAgent(id) });
  const runs = useQuery({ queryKey: ["runs", id], queryFn: () => listRuns(id) });

  if (p.isError) return <ErrorState error={p.error} retry={() => p.refetch()} />;
  if (!p.data) return <Skeleton className="h-[420px] rounded-card" />;
  const proj = p.data;
  const l = proj.latest;

  return (
    <>
      <PageHeader
        overline={`${HOST_LABEL[proj.host]} · ${proj.agentName}`}
        title={proj.name}
        lede={
          l ? (
            <>Last run {timeAgo(l.at)}. Budget {usd(proj.budgetUsd)} per run.</>
          ) : (
            <>Nothing has run yet. Follow the setup steps, one at a time.</>
          )
        }
        actions={<VisibilitySwitch p={proj} />}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <div className="cr-card grid grid-cols-1 gap-6 rise">
            {l ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <Stat
                    label={`${l.k === 1 ? "Passes (1 try each)" : `Passes all ${l.k} tries (pass^${l.k})`} on the ${l.split === "test" ? "held-out test set" : "dev set"}`}
                    value={<Pct value={l.passK} />}
                    delta={l.deltaPassK}
                  />
                  <TrustBadge trusted={l.trusted} />
                </div>
                <div className="grid grid-cols-2 gap-6 border-t border-line pt-5 sm:grid-cols-3">
                  <Stat label="Passes on a single try (pass@1)" value={<Pct value={l.pass1} />} />
                  <Stat label="Real conversations" value={<span className="tabular-nums">{proj.counts.conversations.toLocaleString("en-US")}</span>} />
                  <Stat label="Criteria" value={<span className="tabular-nums">{proj.counts.criteria}</span>} />
                </div>
                {!l.trusted && (
                  <p className="text-ui text-ink-2">
                    The gap between pass@1 and pass^{l.k} is how often the agent is right only some of the time. Scores stay
                    provisional until your judges are trusted.{" "}
                    <Link href={`/p/${id}/label`} className="cr-link">
                      Label a few conversations
                    </Link>
                    .
                  </p>
                )}
              </>
            ) : (
              <div className="grid gap-2 py-6 text-center">
                <span className="font-display text-[44px] leading-none text-ink-2">-</span>
                <span className="text-body-sm text-ink-2">Your score appears here after the first run.</span>
              </div>
            )}
          </div>

          <div className="cr-card p-0 rise-2">
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <h2 className="text-body weight-bold">Recent runs</h2>
              <Link href={`/p/${id}/runs`} className="cr-link text-ui">
                All runs
              </Link>
            </div>
            {runs.data && runs.data.length > 0 ? (
              <div className="overflow-x-auto">
              <table className="cr-table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Split</th>
                    <th className="num">pass^k</th>
                    <th className="num">pass@1</th>
                    <th className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data.slice(0, 4).map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/p/${id}/runs/${r.id}`} className="num text-ink">
                          {r.id}
                        </Link>
                        <span className="ml-2 text-caption text-ink-2">{timeAgo(r.createdAt)}</span>
                      </td>
                      <td>{r.split === "test" ? "Held-out test" : "Dev"}</td>
                      <td className="num">
                        <Pct value={r.passK} />
                      </td>
                      <td className="num">
                        <Pct value={r.pass1} />
                      </td>
                      <td className="num">{usd(r.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <p className="border-t border-line px-6 py-5 text-body-sm text-ink-2">No runs yet.</p>
            )}
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <div className="rise-2">
            <Checklist p={proj} />
          </div>
          <div className="cr-card grid gap-3 rise-3">
            <div className="flex items-center gap-3">
              <HostMark host={proj.host} />
              <div className="grid">
                <span className="text-body-sm weight-bold">{agent.data?.name ?? proj.agentName}</span>
                <span className="num text-caption text-ink-2">{agent.data?.model}</span>
              </div>
            </div>
            {agent.data && (
              <ul className="grid gap-1 text-ui text-ink-2">
                {agent.data.tools.map((t) => (
                  <li key={t.name} className="num">
                    {t.name}
                  </li>
                ))}
                {agent.data.kbNodes.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
