"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle, XCircle, MinusCircle, ArrowLeft, Tag } from "@phosphor-icons/react";
import { getItem, listCriteria } from "@/lib/api";
import { TRIAGE } from "@/lib/triage";
import { Badge, ErrorState, PageHeader, Skeleton, TrialPill, cx } from "@/components/ui";
import { Transcript } from "@/components/transcript";

export default function ItemPage() {
  const { id, runId, item } = useParams<{ id: string; runId: string; item: string }>();
  const q = useQuery({ queryKey: ["item", runId, item], queryFn: () => getItem(runId, item) });
  const crit = useQuery({ queryKey: ["criteria", id], queryFn: () => listCriteria(id) });
  const [trial, setTrial] = useState(0);

  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data || !crit.data) return <Skeleton className="h-[480px] rounded-card" />;
  const d = q.data;
  const byId = new Map(crit.data.map((c) => [c.id, c]));
  // Failed first, then passed, then the ones that didn't come up in this trial.
  const rank = (c: (typeof d.checks)[number]) => (c.trials[trial]?.na ? 2 : c.trials[trial]?.pass ? 1 : 0);
  const failingFirst = [...d.checks].sort((a, b) => rank(a) - rank(b));

  return (
    <>
      <Link href={`/p/${id}/runs/${runId}`} className="cr-btn cr-btn--ghost cr-btn--sm mb-4">
        <ArrowLeft /> Back to run
      </Link>
      <PageHeader
        overline={`${d.item.source === "real" ? "Real conversation" : "Generated scenario"} · ${d.item.id}`}
        title={d.item.scenario}
        actions={
          <>
            {d.item.triage && <Badge tone={TRIAGE[d.item.triage].tone === "neutral" ? undefined : TRIAGE[d.item.triage].tone}>{TRIAGE[d.item.triage].label}</Badge>}
            <TrialPill trials={d.item.trials} />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="cr-card grid content-start gap-5">
          <div className="flex items-center justify-between">
            <h2 className="text-body weight-bold">Transcript</h2>
            <div className="cr-seg" role="group" aria-label="Trial">
              {d.item.trials.map((ok, t) => (
                <button key={t} aria-pressed={trial === t} onClick={() => setTrial(t)}>
                  <span className={cx("mr-1.5 inline-block h-2 w-2 rounded-full", ok ? "bg-success" : "bg-danger")} aria-hidden />
                  Trial {t + 1}
                </button>
              ))}
            </div>
          </div>
          <Transcript turns={d.transcripts?.[trial] ?? d.transcript} />
          <p className="border-t border-line pt-4 text-caption text-ink-2">
            Names, phone numbers and order IDs are redacted before any model sees them.
          </p>
        </div>

        <div className="grid content-start gap-6">
          <div className="cr-card p-0">
            <h2 className="px-5 pt-5 pb-3 text-body weight-bold">Checks on trial {trial + 1}</h2>
            <ul>
              {failingFirst.map((c) => {
                const r = c.trials[trial];
                const meta = byId.get(c.criterionId);
                return (
                  <li key={c.criterionId} className="grid grid-cols-[20px_1fr] gap-3 border-t border-line px-5 py-3">
                    {r.na ? (
                      <MinusCircle size={20} weight="fill" className="text-ink-3" role="img" aria-label="Not applicable" />
                    ) : r.pass ? (
                      <CheckCircle size={20} weight="fill" className="text-success" role="img" aria-label="Passed" />
                    ) : (
                      <XCircle size={20} weight="fill" className="text-danger" role="img" aria-label="Failed" />
                    )}
                    <div className="grid gap-1">
                      <span className="text-body-sm text-ink">
                        <span className="num mr-1.5 text-ink-2">{c.criterionId}</span>
                        {meta?.text}
                      </span>
                      {(!r.pass || r.na) && <span className="text-ui text-ink-2">{r.reason}</span>}
                      <span className="text-caption text-ink-2">{meta?.kind === "check" ? "Code check" : "LLM judge"}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="cr-card grid gap-3">
            <h2 className="text-body weight-bold">Relevant knowledge base</h2>
            {d.kb.map((k) => (
              <div key={k.doc} className="grid gap-1 rounded-control bg-surface-2 px-3 py-2">
                <span className="text-ui text-ink">{k.doc}</span>
                <span className="flex flex-wrap gap-2">
                  {k.retrieved !== null && (
                    <Badge tone={k.retrieved ? "success" : "warning"}>{k.retrieved ? "Retrieved" : "Not retrieved"}</Badge>
                  )}
                  {k.usedCorrectly === false && <Badge tone="danger">Answer didn&apos;t match</Badge>}
                  {k.usedCorrectly === true && k.retrieved && <Badge>Answer matched</Badge>}
                </span>
              </div>
            ))}
          </div>

          <Link href={`/p/${id}/label`} className="cr-btn cr-btn--secondary">
            <Tag /> Label conversations like this
          </Link>
        </div>
      </div>
    </>
  );
}
