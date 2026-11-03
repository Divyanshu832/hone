"use client";

import { useState } from "react";

/** Dollar amount input that keeps what you type and only commits a valid number. */
export function MoneyInput({
  value,
  onChange,
  id,
  label,
  autoFocus,
}: {
  value: number;
  onChange: (v: number) => void;
  id?: string;
  label: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  return (
    <span className="flex items-center gap-2">
      <span className="text-ink-2" aria-hidden>
        $
      </span>
      <input
        id={id}
        inputMode="decimal"
        className="cr-input num w-28"
        value={draft}
        aria-label={label}
        autoFocus={autoFocus}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.]/g, "");
          setDraft(v);
          const n = Number(v);
          if (v !== "" && Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => setDraft(String(value))}
      />
    </span>
  );
}
