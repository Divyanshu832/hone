"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Flask } from "@phosphor-icons/react";
import { listProjects } from "@/lib/api";
import { ErrorState, HostMark, HOST_LABEL, PageHeader, Pct, Skeleton, TrustBadge, timeAgo } from "@/components/ui";
import type { Project } from "@/lib/types";
import { VisibilityBadge } from "@/components/visibility";

function nextStep(p: Project): string {
  const s = p.pipeline;
  if (!s.rubric) return "Review the rubric";
  if (!s.run) return "Plan the first run";
  if (!s.judges) return "Label a few conversations";
  if (!s.gate) return "Turn on the gate";
  return "All set";
}

function ProjectCard({ p }: { p: Project }) {
  return (
    <Link href={`/p/${p.id}`} className="cr-card cr-card--interactive grid gap-5 no-underline">
      <div className="flex items-start gap-3">
        <HostMark host={p.host} size={36} />
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-body weight-bold text-ink">{p.name}</span>
          <span className="truncate text-ui text-ink-2">
            {HOST_LABEL[p.host]} · {p.agentName}
          </span>
        </div>
      </div>
      {p.visibility && (
        <div className="-mt-2">
          <VisibilityBadge p={p} />
        </div>
      )}

      {p.latest ? (
        <div className="flex items-end justify-between gap-4">
          <div className="grid gap-1">
            <span className="text-caption text-ink-2">Passes every time (pass^{p.latest.k})</span>
            <span className="font-display text-[34px] leading-none tracking-[-0.02em]">
              <Pct value={p.latest.passK} />
            </span>
          </div>
          <TrustBadge trusted={p.latest.trusted} compact />
        </div>
      ) : (
        <div className="grid gap-1">
          <span className="text-caption text-ink-2">No runs yet</span>
          <span className="font-display text-[34px] leading-none text-ink-2">-</span>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line pt-4 text-ui">
        <span className="text-ink-2">
          <span className="num">{p.counts.conversations.toLocaleString("en-US")}</span> real conversations
        </span>
        <span className="weight-medium text-primary-ink">{nextStep(p)}</span>
      </div>
      {p.latest && <span className="sr-only">Last run {timeAgo(p.latest.at)}</span>}
    </Link>
  );
}

export default function ProjectsPage() {
  const q = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  return (
    <>
      <PageHeader
        overline="Projects"
        title={
          <>
            Agents you&apos;re <em>testing</em>
          </>
        }
        lede="One project per agent. Hone keeps its rubric, runs and judges together."
        actions={
          q.data && q.data.length > 0 ? (
            <Link href="/new" className="cr-btn cr-btn--primary">
              <Plus /> Test a new agent
            </Link>
          ) : null
        }
      />

      {q.isPending && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[210px] rounded-card" />
          ))}
        </div>
      )}
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && (
        <div className="cr-empty">
          <span className="cr-empty__icon">
            <Flask />
          </span>
          <h2 className="cr-h3">Nothing tested yet</h2>
          <p>Connect your first agent. It takes about three minutes and Hone guides every step.</p>
          <Link href="/new" className="cr-btn cr-btn--primary">
            Test my first agent
          </Link>
        </div>
      )}
      {q.data && q.data.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((p, i) => (
            <div key={p.id} className={i === 0 ? "rise" : i === 1 ? "rise-2" : "rise-3"}>
              <ProjectCard p={p} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
