"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef } from "react";
import { X } from "@phosphor-icons/react";
import { cx, HOST_LABEL } from "@/components/ui";
import { initialState, reducer, STEPS } from "./state";
import { StepConnect, StepFound, StepHost } from "./steps-connect";
import { StepBudget, StepData, StepKb, StepReady } from "./steps-data";

export function Wizard() {
  const [s, d] = useReducer(reducer, initialState);
  const panel = useRef<HTMLDivElement>(null);

  // Move focus to the new step so keyboard and screen-reader users land on it.
  useEffect(() => {
    const root = panel.current;
    if (!root) return;
    // Leave focus alone if a field in the new step already took it (autoFocus); else focus the heading.
    if (!root.contains(document.activeElement)) root.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }, [s.step]);

  const Step = [StepHost, StepConnect, StepFound, StepKb, StepData, StepBudget, StepReady][s.step];

  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr]">
      <header className="flex h-[var(--topbar-height)] items-center gap-4 border-b border-line px-5 md:px-8">
        <Link href="/" className="font-display text-[24px] leading-none tracking-[-0.02em]">
          H<em>one</em>
        </Link>
        <span className="text-ui text-ink-2">Test a new agent</span>
        <Link href="/" className="cr-btn cr-btn--ghost cr-btn--sm ml-auto" aria-label="Exit setup">
          <X /> Exit
        </Link>
      </header>

      <div className="mx-auto grid w-full max-w-[1040px] grid-cols-1 gap-10 px-5 py-10 md:grid-cols-[220px_1fr] md:px-8 md:py-14">
        {/* Progress rail */}
        <nav aria-label="Setup steps" className="hidden md:block">
          <ol className="sticky top-10 grid gap-1">
            {STEPS.map((st, i) => {
              const state = i < s.step ? "done" : i === s.step ? "current" : i <= s.maxStep ? "reachable" : "todo";
              const clickable = i <= s.maxStep && i !== s.step;
              return (
                <li key={st.key}>
                  <button
                    disabled={!clickable}
                    onClick={() => d({ type: "go", step: i })}
                    aria-current={state === "current" ? "step" : undefined}
                    className={cx(
                      "flex h-9 w-full items-center gap-3 rounded-control px-2 text-left text-body-sm transition-colors duration-[var(--duration-fast)]",
                      clickable && "cursor-pointer hover:bg-surface-2",
                      state === "current" ? "weight-bold text-ink" : state === "todo" ? "text-ink-2" : "text-ink-2",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cx(
                        "num grid h-6 w-6 shrink-0 place-items-center rounded-full text-caption",
                        state === "done" && "bg-primary text-on-primary",
                        state === "current" && "border-2 border-accent text-ink",
                        (state === "todo" || state === "reachable") && "border border-line-strong",
                      )}
                    >
                      {state === "done" ? "✓" : i + 1}
                    </span>
                    {st.label}
                    {i === 0 && s.host && state === "done" && (
                      <span className="ml-auto text-caption text-ink-2">{HOST_LABEL[s.host]}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="md:hidden">
          <div className="mb-2 flex justify-between text-caption text-ink-2">
            <span>{STEPS[s.step].label}</span>
            <span className="num">
              {s.step + 1} / {STEPS.length}
            </span>
          </div>
          <div className="bar">
            <span style={{ width: `${((s.step + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>

        <section ref={panel} className="max-w-[640px]" aria-label={STEPS[s.step].label}>
          <div key={s.step} className="rise">
            <Step s={s} d={d} />
          </div>
        </section>
      </div>
    </div>
  );
}
