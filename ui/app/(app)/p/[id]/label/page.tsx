"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Confetti } from "@phosphor-icons/react";
import { labelQueue, saveLabel } from "@/lib/api";
import { ErrorState, PageHeader, Skeleton } from "@/components/ui";
import { Transcript } from "@/components/transcript";
import { useToast } from "@/components/toast";

export default function LabelPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const q = useQuery({ queryKey: ["label", id], queryFn: () => labelQueue(id) });
  const [idx, setIdx] = useState(0);
  const [note, setNote] = useState("");
  const [count, setCount] = useState({ yes: 0, no: 0 });
  const [history, setHistory] = useState<{ idx: number; value: boolean | null }[]>([]);

  const task = q.data?.[idx];

  const answer = useCallback(
    (v: boolean | null) => {
      if (!task) return;
      void saveLabel(task.id, v, note || undefined);
      if (v !== null) setCount((c) => ({ yes: c.yes + (v ? 1 : 0), no: c.no + (v ? 0 : 1) }));
      setHistory((h) => [...h, { idx, value: v }]);
      setNote("");
      setIdx((i) => i + 1);
    },
    [task, note, idx],
  );

  const undo = useCallback(() => {
    const prev = history.at(-1);
    if (prev === undefined) return;
    setHistory((h) => h.slice(0, -1));
    if (prev.value !== null) setCount((c) => ({ yes: c.yes - (prev.value ? 1 : 0), no: c.no - (prev.value ? 0 : 1) }));
    setIdx(prev.idx);
    toast({ text: "Went back one. Your earlier answer will be replaced." });
  }, [history, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return;
      if (el && (["TEXTAREA", "INPUT", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "y") answer(true);
      else if (k === "n") answer(false);
      else if (k === "s") answer(null);
      else if (k === "z") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, undo]);

  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[480px] rounded-card" />;

  if (!task) {
    return (
      <div className="cr-empty mx-auto mt-10 max-w-[560px]">
        <span className="cr-empty__icon">
          <Confetti />
        </span>
        <h2 className="cr-h3">Queue done</h2>
        <p>
          You labeled {count.yes + count.no} conversations ({count.no} fails). Hone has updated how far it can trust each judge.
        </p>
        <Link href={`/p/${id}/judges`} className="cr-btn cr-btn--primary">
          See your judges
        </Link>
      </div>
    );
  }

  const done = task.progress.done + count.yes + count.no;

  return (
    <>
      <PageHeader
        overline="Label"
        title={
          <>
            Your call, <em>not the judge&apos;s</em>
          </>
        }
        lede="Answer one yes/no question per conversation. The judge's answer stays hidden so it can't sway you. About 60 per criterion is enough."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="cr-card max-h-[70dvh] overflow-y-auto" tabIndex={0} role="region" aria-label="Conversation">
          <Transcript turns={task.transcript} />
        </div>
        <div className="grid content-start gap-5">
          <div className="cr-card grid gap-5">
            <div className="grid gap-2">
              <span className="cr-overline">
                Criterion <span className="num">{task.criterionId}</span>
              </span>
              <p className="font-display text-[24px] leading-[1.2] tracking-[-0.01em]">{task.question}?</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button className="cr-btn cr-btn--secondary cr-btn--lg" onClick={() => answer(true)}>
                Yes, passes <kbd className="cr-kbd ml-1">Y</kbd>
              </button>
              <button className="cr-btn cr-btn--secondary cr-btn--lg" onClick={() => answer(false)}>
                No, fails <kbd className="cr-kbd ml-1">N</kbd>
              </button>
            </div>
            <textarea
              className="cr-textarea min-h-[64px]"
              placeholder="Optional note: why it fails"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Note"
            />
            <div className="flex items-center justify-between text-ui text-ink-2">
              <button className="cr-btn cr-btn--ghost cr-btn--sm" onClick={() => answer(null)}>
                Skip <kbd className="cr-kbd">S</kbd>
              </button>
              <button className="cr-btn cr-btn--ghost cr-btn--sm" onClick={undo} disabled={!history.length}>
                Undo <kbd className="cr-kbd">Z</kbd>
              </button>
            </div>
          </div>
          <div className="cr-card grid gap-3">
            <div className="flex justify-between text-ui">
              <span className="text-ink-2">This criterion</span>
              <span className="num">
                {done} / {task.progress.target}
              </span>
            </div>
            <div className="bar">
              <span style={{ width: `${Math.min(100, (done / task.progress.target) * 100)}%` }} />
            </div>
            <span className="text-caption text-ink-2">
              <span className="num">{task.progress.fails + count.no}</span> fails so far. Fails matter most: they show whether the judge
              catches problems.
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
