"use client";

import { useRef, useState } from "react";
import { UploadSimple } from "@phosphor-icons/react";

/** Footer with back + primary action. One primary button per view. */
export function StepFooter({
  onBack,
  primary,
  secondary,
}: {
  onBack?: () => void;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
}) {
  return (
    <div className="mt-8 flex items-center gap-3 border-t border-line pt-5">
      {onBack && (
        <button type="button" className="cr-btn cr-btn--ghost" onClick={onBack}>
          Back
        </button>
      )}
      <div className="ml-auto flex items-center gap-3">
        {secondary}
        {primary}
      </div>
    </div>
  );
}

export function StepTitle({ title, lede }: { title: React.ReactNode; lede?: React.ReactNode }) {
  return (
    <div className="mb-7 grid gap-2">
      <h1 className="cr-h2 outline-none" tabIndex={-1}>
        {title}
      </h1>
      {lede && <p className="text-body text-ink-2">{lede}</p>}
    </div>
  );
}

export function Dropzone({
  accept,
  multiple,
  onFiles,
  title,
  hint,
}: {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  hint: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      className="dropzone"
      data-over={over}
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          ref.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      <span className="cr-empty__icon">
        <UploadSimple />
      </span>
      <span className="text-body-sm weight-medium text-ink">{title}</span>
      <span className="text-caption text-ink-2">{hint}</span>
      <input
        ref={ref}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Lines that tick off one by one while Hone works, so waiting feels like progress. */
export function WorkingList({ lines, doneCount }: { lines: string[]; doneCount: number }) {
  return (
    <ul className="grid gap-3" aria-live="polite">
      {lines.map((l, i) => {
        const state = i < doneCount ? "done" : i === doneCount ? "doing" : "todo";
        return (
          <li key={l} className="flex items-center gap-3 text-body-sm">
            <span
              aria-hidden
              className={
                state === "done"
                  ? "grid h-5 w-5 place-items-center rounded-full bg-primary text-[11px] text-on-primary"
                  : state === "doing"
                    ? "h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-primary-ink motion-reduce:animate-none"
                    : "h-5 w-5 rounded-full border-2 border-line"
              }
            >
              {state === "done" ? "✓" : null}
            </span>
            <span className={state === "todo" ? "text-ink-2" : "text-ink"}>{l}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function KeyVal({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 border-b border-line py-3 last:border-0">
      <span className="text-ui text-ink-2">{k}</span>
      <span className="min-w-0 text-body-sm text-ink">{children}</span>
    </div>
  );
}

/** Inline error with an optional retry. Shows the message, never "Error: ...". */
export function ErrorLine({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="cr-alert cr-alert--danger" role="alert">
      <span aria-hidden>!</span>
      <span className="flex flex-wrap items-center gap-3">
        {msg}
        {retry && (
          <button type="button" className="cr-btn cr-btn--secondary cr-btn--sm" onClick={retry}>
            Try again
          </button>
        )}
      </span>
    </div>
  );
}
