"use client";

import { useParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Copy } from "@phosphor-icons/react";
import { getGate, saveGate } from "@/lib/api";
import type { GateConfig } from "@/lib/types";
import { pct } from "@/lib/stats";
import { Badge, ErrorState, Field, PageHeader, Skeleton, timeAgo } from "@/components/ui";
import { useToast } from "@/components/toast";

function snippet(projectId: string, g: Omit<GateConfig, "history">) {
  return `# .github/workflows/hone.yml
name: hone-gate
on: [pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pipx install hone-eval
      - run: hone gate --project ${projectId} --split test \\
          --min-pass-k ${g.minPassK} --max-regression ${g.maxRegression}${g.requireTrusted ? " --require-trusted" : ""}
        env:
          HONE_API_URL: \${{ secrets.HONE_API_URL }}
          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
          TYPESAFE_API_KEY: \${{ secrets.TYPESAFE_API_KEY }}`;
}

function GateForm({ id, initial }: { id: string; initial: GateConfig }) {
  const toast = useToast();
  const [g, setG] = useState({ minPassK: initial.minPassK, maxRegression: initial.maxRegression, requireTrusted: initial.requireTrusted });
  const save = useMutation({ mutationFn: () => saveGate(id, g), onSuccess: () => toast({ text: "Gate saved." }) });
  const code = snippet(id, g);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid min-w-0 content-start gap-6">
        <div className="cr-card grid gap-5">
          <Field label="Minimum pass^k on the held-out test" htmlFor="minpk" help="Below this, the gate fails.">
            <span className="flex items-center gap-3">
              <input
                id="minpk"
                type="range"
                min={0.5}
                max={1}
                step={0.01}
                value={g.minPassK}
                onChange={(e) => setG({ ...g, minPassK: Number(e.target.value) })}
                aria-valuetext={pct(g.minPassK)}
                className="w-full accent-[var(--primary)]"
              />
              <span className="num w-12 text-right">{pct(g.minPassK)}</span>
            </span>
          </Field>
          <Field label="Biggest drop allowed vs the last passing run" htmlFor="maxreg" help="Catches regressions even above the minimum.">
            <span className="flex items-center gap-3">
              <input
                id="maxreg"
                type="range"
                min={0}
                max={0.1}
                step={0.01}
                value={g.maxRegression}
                onChange={(e) => setG({ ...g, maxRegression: Number(e.target.value) })}
                aria-valuetext={`${Math.round(g.maxRegression * 100)} points`}
                className="w-full accent-[var(--primary)]"
              />
              <span className="num w-12 text-right">{Math.round(g.maxRegression * 100)} pts</span>
            </span>
          </Field>
          <label className="cr-switch">
            <input type="checkbox" checked={g.requireTrusted} onChange={(e) => setG({ ...g, requireTrusted: e.target.checked })} />
            Only count judges you&apos;ve trusted
          </label>
          <button className="cr-btn cr-btn--primary w-fit" aria-busy={save.isPending} disabled={save.isPending} onClick={() => save.mutate()}>
            Save gate
          </button>
        </div>

        <div className="cr-card p-0">
          <h2 className="px-6 pt-5 pb-3 text-body weight-bold">History</h2>
          {initial.history.length === 0 ? (
            <p className="border-t border-line px-6 py-4 text-body-sm text-ink-2">No gated runs yet.</p>
          ) : (
            <div className="overflow-x-auto">
            <table className="cr-table">
              <thead className="sr-only">
                <tr>
                  <th>Run</th>
                  <th>When</th>
                  <th>pass^k</th>
                  <th>Result</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {initial.history.map((h) => (
                  <tr key={h.runId}>
                    <td className="num">{h.runId}</td>
                    <td className="text-ink-2">{timeAgo(h.at)}</td>
                    <td className="num">{pct(h.passK)}</td>
                    <td>
                      {h.passed ? (
                        <Badge tone="success" dot>
                          Passed
                        </Badge>
                      ) : (
                        <Badge tone="danger" dot title={h.reason}>
                          Blocked
                        </Badge>
                      )}
                    </td>
                    <td className="text-ui text-ink-2">{h.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

      <div className="cr-card grid min-w-0 content-start gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-body weight-bold">Add it to GitHub</h2>
          <button
            className="cr-btn cr-btn--secondary cr-btn--sm"
            onClick={() => {
              void navigator.clipboard?.writeText(code);
              toast({ text: "Copied the workflow." });
            }}
          >
            <Copy /> Copy
          </button>
        </div>
        <p className="text-body-sm text-ink-2">Every pull request runs the held-out test and fails if the agent got worse.</p>
        <pre className="code" tabIndex={0} aria-label="GitHub Action workflow">{code}</pre>
      </div>
    </div>
  );
}

export default function GatePage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["gate", id], queryFn: () => getGate(id) });
  return (
    <>
      <PageHeader
        overline="Gate"
        title={
          <>
            Never ship a <em>worse</em> agent
          </>
        }
        lede="The gate runs the held-out test on every change and blocks it if the score drops."
      />
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {!q.data && !q.isError && <Skeleton className="h-[360px] rounded-card" />}
      {q.data && <GateForm id={id} initial={q.data} />}
    </>
  );
}
