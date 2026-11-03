"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Scales } from "@phosphor-icons/react";
import { listCriteria, listJudges } from "@/lib/api";
import { pct, TRUST_BAR } from "@/lib/stats";
import { Badge, ErrorState, PageHeader, Skeleton, TrustBadge } from "@/components/ui";

function Rate({ v }: { v: number | null }) {
  if (v === null) return <span className="text-ink-2">-</span>;
  return <span className={v < TRUST_BAR ? "num text-danger-ink" : "num"}>{pct(v)}</span>;
}

export default function JudgesPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["judges", id], queryFn: () => listJudges(id) });
  const crit = useQuery({ queryKey: ["criteria", id], queryFn: () => listCriteria(id) });
  const byId = new Map((crit.data ?? []).map((c) => [c.id, c]));

  return (
    <>
      <PageHeader
        overline="Judges"
        title={
          <>
            Can you <em>trust</em> the grades?
          </>
        }
        lede={`Each LLM judge is compared with your labels. It's trusted when it agrees on both passes and fails at least ${pct(TRUST_BAR)} of the time.`}
        actions={
          q.data && q.data.length > 0 ? (
            <Link href={`/p/${id}/label`} className="cr-btn cr-btn--primary">
              Label more
            </Link>
          ) : null
        }
      />
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {!q.data && !q.isError && <Skeleton className="h-[300px] rounded-card" />}
      {q.data && q.data.length === 0 && (
        <div className="cr-empty">
          <span className="cr-empty__icon">
            <Scales />
          </span>
          <h2 className="cr-h3">No labels yet</h2>
          <p>Label about 60 conversations per judged criterion. Hone then measures each judge against you.</p>
          <Link href={`/p/${id}/label`} className="cr-btn cr-btn--primary">
            Start labeling
          </Link>
        </div>
      )}
      {q.data && q.data.length > 0 && (
        <>
          <div className="cr-card overflow-x-auto p-0 rise">
            <table className="cr-table">
              <thead>
                <tr>
                  <th>Criterion</th>
                  <th>Judge</th>
                  <th className="num">Labels</th>
                  <th className="num" title="Of the conversations you passed, how many the judge passed">
                    Agrees on passes
                  </th>
                  <th className="num" title="Of the conversations you failed, how many the judge failed">
                    Agrees on fails
                  </th>
                  <th className="num">Judge says</th>
                  <th className="num">Corrected</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((j) => (
                  <tr key={j.criterionId}>
                    <td className="max-w-[260px]">
                      <span className="num mr-2 text-ink-2">{j.criterionId}</span>
                      {byId.get(j.criterionId)?.text}
                    </td>
                    <td className="text-ui text-ink-2">{j.judge}</td>
                    <td className="num">
                      {j.labels}
                      <span className="text-ink-2">/{j.target}</span>
                    </td>
                    <td className="num">
                      <Rate v={j.tpr} />
                    </td>
                    <td className="num">
                      <Rate v={j.tnr} />
                    </td>
                    <td className="num">{pct(j.rawPass)}</td>
                    <td className="num">
                      {j.corrected !== null && j.ci ? (
                        <span title={`95% range ${pct(j.ci[0])} - ${pct(j.ci[1])}`}>
                          {pct(j.corrected)}
                          <span className="ml-1 text-ink-2">±{Math.round(((j.ci[1] - j.ci[0]) / 2) * 100)}</span>
                        </span>
                      ) : (
                        <span className="text-ink-2">-</span>
                      )}
                    </td>
                    <td>
                      {j.labels < 40 ? <Badge>Needs {40 - j.labels} more labels</Badge> : <TrustBadge trusted={j.trusted} compact />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="cr-card grid gap-2">
              <h2 className="text-body weight-bold">What &quot;corrected&quot; means</h2>
              <p className="text-body-sm text-ink-2">
                No judge is perfect. If a judge misses some fails, its raw pass rate is too high. Hone uses how often the judge agrees
                with you to correct the rate (the Rogan-Gladen method) and shows a range, because a few dozen labels can&apos;t give an
                exact number.
              </p>
            </div>
            <div className="cr-card grid gap-2">
              <h2 className="text-body weight-bold">When a judge isn&apos;t trusted</h2>
              <p className="text-body-sm text-ink-2">
                Its scores still show, marked &quot;not trusted yet&quot;, but the gate ignores them. Label more fails, or switch that
                criterion to a different judge model in the rubric.
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
