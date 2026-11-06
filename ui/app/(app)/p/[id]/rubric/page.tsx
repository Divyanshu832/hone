"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { ArrowRight, CaretDown, Code, Scales } from "@phosphor-icons/react";
import { getProject, listCriteria, redraft, saveCriteria } from "@/lib/api";
import type { Criterion } from "@/lib/types";
import { Badge, ErrorState, PageHeader, Skeleton, cx } from "@/components/ui";
import { WorkingList } from "@/components/wizard/parts";
import { useToast } from "@/components/toast";

const SOURCE: Record<Criterion["source"], string> = { prompt: "From the prompt", kb: "From the knowledge base", data: "From your conversations" };
const DRAFT_LINES = ["Reading the system prompt", "Reading the knowledge base", "Looking for patterns in your conversations", "Writing pass/fail criteria"];

function CriterionRow({
  c,
  open,
  onToggle,
  onChange,
}: {
  c: Criterion;
  open: boolean;
  onToggle: () => void;
  onChange: (c: Criterion) => void;
}) {
  return (
    <li className="border-t border-line first:border-t-0">
      <button
        className="grid w-full grid-cols-[44px_1fr_auto] items-center gap-3 px-5 py-4 text-left hover:bg-surface-2"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="num text-ui text-ink-2">{c.id}</span>
        <span className="grid gap-1">
          <span className="text-body-sm weight-medium text-ink">{c.text}</span>
          <span className="flex flex-wrap items-center gap-2 text-caption text-ink-2">
            <span className="inline-flex items-center gap-1">
              {c.kind === "check" ? <Code size={14} /> : <Scales size={14} />}
              {c.kind === "check" ? "Code check" : "LLM judge"}
            </span>
            <span aria-hidden>·</span>
            <span>{SOURCE[c.source]}</span>
            {c.appliesWhen && (
              <>
                <span aria-hidden>·</span>
                <span>Only when {c.appliesWhen}</span>
              </>
            )}
            {c.severity === "high" && (
              <>
                <span aria-hidden>·</span>
                <span className="text-danger-ink">High impact</span>
              </>
            )}
          </span>
        </span>
        <span className="flex items-center gap-3">
          {c.status === "approved" ? (
            <Badge tone="success" dot>
              Approved
            </Badge>
          ) : (
            <Badge>Draft</Badge>
          )}
          <CaretDown size={16} className={cx("text-ink-2 transition-transform duration-[var(--duration-base)]", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className="grid gap-4 bg-surface-2/40 px-5 pt-1 pb-5 pl-[76px] rise">
          <label className="cr-field">
            <span className="cr-label">Criterion</span>
            <input className="cr-input" value={c.text} onChange={(e) => onChange({ ...c, text: e.target.value, status: "draft" })} />
          </label>
          <label className="cr-field">
            <span className="cr-label">Only checked when</span>
            <input
              className="cr-input"
              placeholder="Every conversation"
              value={c.appliesWhen ?? ""}
              onChange={(e) => onChange({ ...c, appliesWhen: e.target.value || null, status: "draft" })}
            />
            <span className="cr-help">
              Leave empty if it applies to every conversation. Otherwise it&apos;s skipped, not failed, when this doesn&apos;t happen.
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="cr-field">
              <span className="cr-label text-success-ink">Passes when</span>
              <textarea className="cr-textarea min-h-[72px]" value={c.passExample} onChange={(e) => onChange({ ...c, passExample: e.target.value })} />
            </label>
            <label className="cr-field">
              <span className="cr-label text-danger-ink">Fails when</span>
              <textarea className="cr-textarea min-h-[72px]" value={c.failExample} onChange={(e) => onChange({ ...c, failExample: e.target.value })} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="cr-seg" role="group" aria-label="How it is graded">
              <button aria-pressed={c.kind === "check"} onClick={() => onChange({ ...c, kind: "check" })}>
                Code check
              </button>
              <button aria-pressed={c.kind === "judge"} onClick={() => onChange({ ...c, kind: "judge" })}>
                LLM judge
              </button>
            </div>
            <div className="cr-seg" role="group" aria-label="Impact">
              {(["high", "medium", "low"] as const).map((sv) => (
                <button key={sv} aria-pressed={c.severity === sv} onClick={() => onChange({ ...c, severity: sv })}>
                  {sv[0].toUpperCase() + sv.slice(1)}
                </button>
              ))}
            </div>
            {c.status === "draft" && (
              <button className="cr-btn cr-btn--secondary cr-btn--sm ml-auto" onClick={() => onChange({ ...c, status: "approved" })}>
                Approve
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function RubricInner() {
  const { id } = useParams<{ id: string }>();
  const isNew = useSearchParams().get("new") === "1";
  const toast = useToast();
  const qc = useQueryClient();
  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id),
    refetchInterval: (q) => (q.state.data?.drafting ? 2000 : false),
  });
  const backendDrafting = !!project.data?.drafting;
  const q = useQuery({
    queryKey: ["criteria", id],
    queryFn: () => listCriteria(id),
    refetchInterval: backendDrafting ? 2000 : false,
  });
  const [items, setItems] = useState<Criterion[] | null>(null);
  const save = useMutation({
    mutationFn: (list: Criterion[]) => saveCriteria(id, list),
    onSuccess: (list) => {
      qc.setQueryData(["criteria", id], list);
      qc.invalidateQueries({ queryKey: ["project", id] });
      setItems(null);
    },
  });
  const dirty = items !== null;

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const [open, setOpen] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(isNew ? 0 : -1);

  // For a brand new project, show Hone drafting before the list appears.
  useEffect(() => {
    if (drafting < 0) return;
    if (drafting >= DRAFT_LINES.length) {
      const t = setTimeout(() => setDrafting(-1), 300);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setDrafting((n) => n + 1), 650);
    return () => clearTimeout(t);
  }, [drafting]);

  const list = items ?? q.data ?? null;
  const drafts = list?.filter((c) => c.status === "draft").length ?? 0;
  const update = (c: Criterion) => setItems((list ?? []).map((x) => (x.id === c.id ? c : x)));

  if (project.data?.draftInterrupted && !q.data?.length) return <DraftInterrupted projectId={id} />;

  if (drafting >= 0 || (backendDrafting && !(q.data?.length))) {
    return (
      <div className="mx-auto max-w-[560px] py-16">
        <h1 className="cr-h2 mb-2">
          Drafting your <em>tests</em>
        </h1>
        <p className="mb-8 text-body text-ink-2">A few seconds. You&apos;ll review every criterion before anything runs.</p>
        <WorkingList lines={DRAFT_LINES} doneCount={drafting < 0 ? DRAFT_LINES.length - 1 : Math.min(drafting, DRAFT_LINES.length - 1)} />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        overline="Rubric"
        title={
          <>
            What <em>good</em> looks like
          </>
        }
        lede="Each criterion is a yes/no question. Code checks run first and cost nothing; LLM judges handle the rest."
        actions={
          dirty && drafts === 0 ? (
            <button className="cr-btn cr-btn--primary" aria-busy={save.isPending} disabled={save.isPending} onClick={() => save.mutate(list ?? [])}>
              Save changes
            </button>
          ) : drafts > 0 ? (
            <button
              className="cr-btn cr-btn--primary"
              aria-busy={save.isPending}
              disabled={save.isPending || (list ?? []).some((c) => !c.text.trim())}
              onClick={() =>
                save.mutate(
                  (list ?? []).map((c) => ({ ...c, status: "approved" })),
                  { onSuccess: () => toast({ text: `Approved ${drafts} criteria. You can plan a run now.` }) },
                )
              }
            >
              Approve all {drafts}
            </button>
          ) : (
            list && (
              <Link href={`/p/${id}/runs?plan=1`} className="cr-btn cr-btn--primary">
                Plan a run <ArrowRight />
              </Link>
            )
          )
        }
      />
      {q.isError && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {save.isError && <ErrorState error={save.error} />}
      {!list && !q.isError && <Skeleton className="h-[400px] rounded-card" />}
      {list && (
        <>
          <div className="mb-4 flex flex-wrap gap-2 text-ui text-ink-2">
            <span>
              <span className="num">{list.length}</span> criteria
            </span>
            <span aria-hidden>·</span>
            <span>
              <span className="num">{list.filter((c) => c.kind === "check").length}</span> code checks
            </span>
            <span aria-hidden>·</span>
            <span>
              <span className="num">{list.filter((c) => c.kind === "judge").length}</span> judged
            </span>
          </div>
          <ul className="cr-card overflow-hidden p-0 rise">
            {list.map((c) => (
              <CriterionRow key={c.id} c={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} onChange={update} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export default function RubricPage() {
  return (
    <Suspense>
      <RubricInner />
    </Suspense>
  );
}

function DraftInterrupted({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => redraft(projectId),
    onSuccess: (p) => qc.setQueryData(["project", projectId], p),
  });
  return (
    <div className="mx-auto grid max-w-[560px] gap-4 py-16">
      <h1 className="cr-h2">
        Drafting was <em>interrupted</em>
      </h1>
      <p className="text-body text-ink-2">
        Hone stopped before it finished writing your scenarios and criteria (the server restarted). Nothing was lost; start
        it again.
      </p>
      <button className="cr-btn cr-btn--primary w-fit" aria-busy={m.isPending} onClick={() => m.mutate()}>
        Draft again
      </button>
      {m.isError && <span className="cr-error" role="alert">{m.error.message}</span>}
    </div>
  );
}
