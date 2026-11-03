"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { checkKeys, health, MOCK } from "@/lib/api";
import { clearKeys, getKeys, isRemembered, mask, saveKeys, subscribeKeys } from "@/lib/keys";
import { Badge, PageHeader } from "@/components/ui";
import { useSession } from "@/components/auth-gate";
import { AccountCard, TeamCard } from "@/components/team";

const EMPTY = { openrouter: "", typesafe: "" };

const FIELDS = [
  {
    id: "openrouter" as const,
    label: "OpenRouter",
    hint: "Plays the customer, writes rubrics and recommendations. Get one at openrouter.ai/keys.",
    placeholder: "sk-or-v1-…",
  },
  {
    id: "typesafe" as const,
    label: "TypeSafe (Jev)",
    hint: "Grades conversations with a yes/no probability. Optional: without it, OpenRouter grades instead.",
    placeholder: "apik_…",
  },
];

const STORAGE: Record<string, string> = {
  supabase: "Supabase",
  sqlite: "This computer (SQLite file)",
  memory: "Temporary (server memory)",
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const saved = useSyncExternalStore(subscribeKeys, getKeys, () => EMPTY);
  const [draft, setDraft] = useState<typeof EMPTY | null>(null);
  // Read from storage the same way as the keys, so the server render and the browser agree.
  const remembered = useSyncExternalStore(subscribeKeys, isRemembered, () => false);
  const [rememberChoice, setRemember] = useState<boolean | null>(null);
  const remember = rememberChoice ?? remembered;
  const h = useQuery({ queryKey: ["health"], queryFn: health, enabled: !MOCK });
  const check = useMutation({ mutationFn: checkKeys });
  const session = useSession();
  const me = session.data?.enabled ? session.data.me : null;
  const editing = draft !== null || (!saved.openrouter && !saved.typesafe);
  const form = draft ?? saved;

  function save(e: React.FormEvent) {
    e.preventDefault();
    saveKeys(form, remember);
    setDraft(null);
    qc.invalidateQueries();
    check.mutate();
  }

  return (
    <>
      <title>Settings · Hone</title>
      <PageHeader
        overline="Settings"
        title={me ? "Account and keys" : "Your keys"}
        lede="Hone runs on your own model keys. They stay in this browser and go only to Hone's server with each request. It never saves them."
      />
      <div className="grid max-w-[760px] gap-6">
        {me?.org && (
          <>
            <AccountCard me={me} />
            <TeamCard me={me} />
          </>
        )}
        <form className="cr-card grid gap-5" onSubmit={save}>
          <h2 className="text-body weight-bold">Model keys</h2>
          {FIELDS.map((f) => (
            <label key={f.id} className="cr-field">
              <span className="cr-label flex items-center gap-2">
                {f.label}
                {check.data?.[f.id] && (
                  <Badge tone={check.data[f.id]!.ok ? "success" : "danger"} dot>
                    {check.data[f.id]!.ok ? "Works" : "Didn't work"}
                  </Badge>
                )}
              </span>
              {editing ? (
                <input
                  className="cr-input num"
                  type="password"
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  spellCheck={false}
                  placeholder={f.placeholder}
                  value={form[f.id]}
                  onChange={(e) => setDraft({ ...form, [f.id]: e.target.value })}
                />
              ) : (
                <span className="num text-body-sm text-ink">{saved[f.id] ? mask(saved[f.id]) : <span className="text-ink-2">Not set</span>}</span>
              )}
              <span className="cr-help">
                {check.data?.[f.id] && !check.data[f.id]!.ok ? check.data[f.id]!.detail : f.hint}
              </span>
            </label>
          ))}
          {editing ? (
            <>
              <label className="cr-check flex-wrap text-ui text-ink">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember on this device
                <span className="text-ink-2">(otherwise they&apos;re forgotten when you close the tab)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button className="cr-btn cr-btn--primary" disabled={!form.openrouter.trim() && !form.typesafe.trim()}>
                  Save and test keys
                </button>
                {draft !== null && (saved.openrouter || saved.typesafe) && (
                  <button type="button" className="cr-btn cr-btn--ghost" onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="cr-btn cr-btn--secondary" onClick={() => setDraft({ ...saved })}>
                Change keys
              </button>
              <button type="button" className="cr-btn cr-btn--ghost" aria-busy={check.isPending} onClick={() => check.mutate()}>
                Test keys
              </button>
              <button
                type="button"
                className="cr-btn cr-btn--ghost ml-auto"
                onClick={() => {
                  clearKeys();
                  check.reset();
                  qc.invalidateQueries();
                }}
              >
                Remove from this browser
              </button>
            </div>
          )}
          {check.isError && <span className="cr-error" role="alert">{check.error.message}</span>}
        </form>

        {h.data && (
          <div className="cr-card grid gap-3">
            <h2 className="text-body weight-bold">Where results are saved</h2>
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={h.data.storage.persistent && h.data.storage.ok ? "success" : "warning"} dot>
                {STORAGE[h.data.storage.backend]}
              </Badge>
              <span className="text-ui text-ink-2">
                {h.data.storage.persistent
                  ? "Runs, agent versions and recommendations are kept, so you can compare over time."
                  : "Results last until the server restarts. Fine for a quick test; nothing is kept long-term."}
              </span>
            </div>
            {h.data.storage.note && <p className="text-caption text-ink-2">{h.data.storage.note}</p>}
            {!saved.openrouter && !saved.typesafe && h.data.serverKeys && (
              <p className="text-caption text-ink-2">This server also has its own keys, used when you don&apos;t add yours.</p>
            )}
          </div>
        )}

        {MOCK && (
          <div className="cr-alert cr-alert--warning">
            <span aria-hidden>!</span>
            <span>
              <strong>You&apos;re looking at demo data.</strong> Start the backend and set <span className="num">NEXT_PUBLIC_API_URL</span> in{" "}
              <span className="num">ui/.env.local</span> to use your real agents.
            </span>
          </div>
        )}
      </div>
    </>
  );
}
