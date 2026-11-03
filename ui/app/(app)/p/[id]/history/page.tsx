"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getProject, listRecommendations, listRuns, listSnapshots, updateAgentFiles } from "@/lib/api";
import type { AgentSnapshot, Recommendation, Run } from "@/lib/types";
import { RecommendationList } from "@/components/recommendations";
import { Badge, ErrorState, PageHeader, Pct, Skeleton, Stat, TrustBadge, cx, timeAgo } from "@/components/ui";

function DiffView({ s }: { s: AgentSnapshot }) {
  const d = s.diff;
  if (d.first) return null;
  const lists: [string, string[] | undefined][] = [
    ["Tools added", d.toolsAdded],
    ["Tools removed", d.toolsRemoved],
    ["Tool descriptions changed", d.toolsChanged],
    ["Knowledge added", d.kbAdded],
    ["Knowledge removed", d.kbRemoved],
    ["Parts added", d.partsAdded],
    ["Parts removed", d.partsRemoved],
  ];
  return (
    <div className="grid gap-3">
      {d.model && (
        <p className="text-ui text-ink">
          Model <span className="num">{d.model.from}</span> → <span className="num">{d.model.to}</span>
        </p>
      )}
      {lists
        .filter(([, v]) => v?.length)
        .map(([k, v]) => (
          <p key={k} className="text-ui text-ink">
            {k}: <span className="num">{v!.join(", ")}</span>
          </p>
        ))}
      {d.prompt && (
        <details className="group">
          <summary className="cursor-pointer list-none text-ui weight-medium text-primary-ink">
            <span className="group-open:hidden">Show prompt changes</span>
            <span className="hidden group-open:inline">Hide prompt changes</span>
            <span className="num ml-2 text-ink-2">
              +{d.prompt.added} −{d.prompt.removed}
            </span>
          </summary>
          <pre className="code mt-3 max-h-[420px] overflow-auto">
            {d.prompt.unified.split("\n").map((line, i) => (
              <span
                key={i}
                className={cx(
                  "block",
                  line.startsWith("+") && "bg-success-soft text-success-ink",
                  line.startsWith("-") && "bg-danger-soft text-danger-ink",
                  line.startsWith("@@") && "text-ink-2",
                )}
              >
                {line || " "}
              </span>
            ))}
          </pre>
        </details>
      )}
    </div>
  );
}

function RunRow({ r, prev, projectId }: { r: Run; prev?: Run; projectId: string }) {
  const delta = prev && prev.split === r.split ? r.passK - prev.passK : null;
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-line py-3 first:border-t-0">
      <Link href={`/p/${projectId}/runs/${r.id}`} className="grid gap-0.5 hover:underline">
        <span className="text-body-sm text-ink">
          {r.split === "test" ? "Held-out test" : "Dev"} · {r.scenarios} scenarios × {r.k}
        </span>
        <span className="text-caption text-ink-2">{timeAgo(r.createdAt)}</span>
      </Link>
      <span className="flex items-center gap-3">
        {delta !== null && Math.abs(delta) >= 0.005 && (
          <span className={cx("num text-caption", delta > 0 ? "text-success-ink" : "text-danger-ink")}>
            {delta > 0 ? "+" : ""}
            {Math.round(delta * 100)} pts
          </span>
        )}
        <span className="text-body-sm weight-bold">
          <Pct value={r.passK} />
        </span>
        <TrustBadge trusted={r.trusted} compact />
      </span>
    </li>
  );
}

function VersionCard({ s, runs, applied, allRuns, projectId }: {
  s: AgentSnapshot; runs: Run[]; applied: Recommendation[]; allRuns: Run[]; projectId: string;
}) {
  return (
    <li className="cr-card grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="flex items-center gap-2 text-body weight-bold">
            Agent v{s.version}
            {s.version === 1 && <Badge>First seen</Badge>}
          </h2>
          <span className="text-ui text-ink-2">{s.changeSummary}</span>
        </div>
        <span className="text-caption text-ink-2">
          {timeAgo(s.createdAt)} · <span className="num">{s.model}</span>
        </span>
      </div>
      <DiffView s={s} />
      {applied.length > 0 && (
        <div className="grid gap-2">
          <h3 className="cr-overline">Recommendations applied in this version</h3>
          <div className="rounded-card border border-line">
            <RecommendationList recs={applied} compact />
          </div>
        </div>
      )}
      <div className="grid gap-1">
        <h3 className="cr-overline">Runs on this version</h3>
        {runs.length ? (
          <ul>
            {runs.map((r) => (
              <RunRow key={r.id} r={r} prev={allRuns[allRuns.indexOf(r) + 1]} projectId={projectId} />
            ))}
          </ul>
        ) : (
          <p className="text-ui text-ink-2">Not tested yet. The next run will test this version.</p>
        )}
      </div>
    </li>
  );
}

/** n8n and Retell agents are re-read before every run. Custom code is only seen through uploads. */
function UploadNewVersion({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async (list: FileList) =>
      updateAgentFiles(projectId, await Promise.all([...list].map(async (f) => ({ name: f.name, text: await f.text() })))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshots", projectId] }),
  });
  return (
    <div className="cr-card grid gap-2">
      <h2 className="text-body weight-bold">Changed your agent&apos;s code?</h2>
      <p className="text-ui text-ink-2">
        Upload the edited files and Hone records a new version. Files are read as text, never run.
      </p>
      <label className="cr-btn cr-btn--secondary w-fit cursor-pointer" aria-busy={m.isPending}>
        Upload new files
        <input type="file" multiple className="sr-only" onChange={(e) => e.target.files?.length && m.mutate(e.target.files)} />
      </label>
      {m.data && (
        <p className="text-ui text-ink" role="status">
          {m.data.changed ? `Saved as v${m.data.version}: ${m.data.changeSummary}. Start a run to test it.` : "No change from the current version."}
        </p>
      )}
      {m.isError && <span className="cr-error" role="alert">{m.error.message}</span>}
    </div>
  );
}

export default function HistoryPage() {
  const { id } = useParams<{ id: string }>();
  const snaps = useQuery({ queryKey: ["snapshots", id], queryFn: () => listSnapshots(id) });
  const runs = useQuery({ queryKey: ["runs", id], queryFn: () => listRuns(id) });
  const recs = useQuery({ queryKey: ["recommendations", id], queryFn: () => listRecommendations(id) });
  const project = useQuery({ queryKey: ["project", id], queryFn: () => getProject(id) });
  const error = snaps.error || runs.error || recs.error;
  const ready = snaps.data && runs.data && recs.data;

  const finished = (runs.data ?? [])
    .filter((r) => r.status === "done" || r.status === "stopped")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = (recs.data ?? []).filter((r) => r.status === "open" || (r.status === "applied" && !r.appliedVersion));
  const measured = (recs.data ?? []).filter((r) => r.outcome);
  const helped = measured.filter((r) => r.outcome === "improved").length;
  const untracked = finished.filter((r) => !r.agentVersion);

  return (
    <>
      <PageHeader
        overline="History"
        title={
          <>
            How the agent <em>changed</em>
          </>
        }
        lede="Every version of the agent Hone has tested, what changed in it, and whether the recommended changes helped."
      />
      {error && <ErrorState error={error} retry={() => { snaps.refetch(); runs.refetch(); recs.refetch(); }} />}
      {!ready && !error && <Skeleton className="h-[360px] rounded-card" />}
      {ready && (
        <div className="grid gap-6">
          <div className="cr-card grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Agent versions" value={<span className="tabular-nums">{snaps.data!.length}</span>} />
            <Stat label="Runs" value={<span className="tabular-nums">{finished.length}</span>} />
            <Stat label="Changes recommended" value={<span className="tabular-nums">{recs.data!.length}</span>} />
            <Stat
              label="Applied and measured"
              value={<span className="tabular-nums">{measured.length}</span>}
              hint={measured.length ? `${helped} helped` : "Apply one and run again"}
            />
          </div>

          {project.data?.host === "custom" && <UploadNewVersion projectId={id} />}

          {open.length > 0 && (
            <div className="cr-card p-0">
              <div className="grid gap-1 px-6 pt-5 pb-3">
                <h2 className="text-body weight-bold">Waiting to be applied</h2>
                <p className="text-ui text-ink-2">
                  Make the change in your agent, then start a run. Hone will see the new version and check which of these
                  it carries out.
                </p>
              </div>
              <div className="border-t border-line">
                <RecommendationList recs={open} />
              </div>
            </div>
          )}

          {snaps.data!.length === 0 ? (
            <p className="text-body-sm text-ink-2">
              No versions yet. Hone saves one each time it tests the agent.{" "}
              <Link href={`/p/${id}/runs?plan=1`} className="text-primary-ink underline">
                Start a run
              </Link>
            </p>
          ) : (
            <ol className="grid gap-4">
              {snaps.data!.map((s) => (
                <VersionCard
                  key={s.id}
                  s={s}
                  runs={finished.filter((r) => r.agentVersion === s.version)}
                  applied={recs.data!.filter((r) => r.appliedVersion === s.version && r.status === "applied")}
                  allRuns={finished}
                  projectId={id}
                />
              ))}
            </ol>
          )}

          {untracked.length > 0 && (
            <div className="cr-card grid gap-1">
              <h2 className="text-body weight-bold">Before versions were tracked</h2>
              <ul>
                {untracked.map((r) => (
                  <RunRow key={r.id} r={r} prev={finished[finished.indexOf(r) + 1]} projectId={id} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
