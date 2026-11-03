"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  Database,
  FileText,
  Info,
  Sparkle,
  DownloadSimple,
  ArrowsClockwise,
  ClipboardText,
} from "@phosphor-icons/react";
import { createProject, importHistory, supabasePreview, supabaseTables } from "@/lib/api";
import { group, guessMapping, normaliseRole, parseCsv, sufficiency, type Mapping } from "@/lib/csv";
import { planRun } from "@/lib/planner";
import { usd } from "@/lib/stats";
import { Badge, Field, HOST_LABEL, cx } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { connectInput, type KbMode, type StepProps } from "./state";
import { Dropzone, ErrorLine, KeyVal, StepFooter, StepTitle } from "./parts";

// ---------------- Step 4: knowledge base ----------------

function KbSupabase({ s, d }: StepProps) {
  const sb = s.kb.supabase;
  const setSb = (patch: Partial<typeof sb>) => d({ type: "kb", patch: { supabase: { ...sb, ...patch } } });
  const tables = useMutation({ mutationFn: () => supabaseTables(sb.url, sb.key) });
  const preview = useMutation({ mutationFn: (t: string) => supabasePreview(sb.url, sb.key, t) });
  const suggested = s.agent?.kbNodes.join(" ").match(/:\s*(\w+)/)?.[1];

  useEffect(() => {
    if (tables.data && !sb.table) {
      const pick = tables.data.find((t) => t.name === suggested) ?? tables.data.find((t) => t.vector);
      if (pick) {
        setSb({ table: pick.name });
        d({ type: "kb", patch: { docs: pick.rows } });
        preview.mutate(pick.name);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.data]);

  return (
    <div className="grid gap-5">
      {suggested && (
        <div className="cr-alert">
          <Info />
          <span>
            Your workflow searches the Supabase table <span className="num">{suggested}</span>. Connect it and Hone reads the same
            content.
          </span>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project URL" htmlFor="sb-url">
          <input id="sb-url" type="url" autoComplete="off" className="cr-input" placeholder="https://xyz.supabase.co" value={sb.url} onChange={(e) => setSb({ url: e.target.value.trim() })} />
        </Field>
        <Field label="Service key" htmlFor="sb-key" help="Read only is enough.">
          <input id="sb-key" className="cr-input" type="password" autoComplete="new-password" data-1p-ignore data-lpignore="true" value={sb.key} onChange={(e) => setSb({ key: e.target.value.trim() })} />
        </Field>
      </div>
      {!tables.data && (
        <button
          className="cr-btn cr-btn--secondary w-fit"
          disabled={!sb.url || !sb.key}
          aria-busy={tables.isPending}
          onClick={() => tables.mutate()}
        >
          <Database /> Show my tables
        </button>
      )}
      {tables.isError && <ErrorLine error={tables.error} retry={() => tables.mutate()} />}
      {preview.isError && <ErrorLine error={preview.error} />}
      {tables.data && (
        <div role="radiogroup" aria-label="Knowledge base table" className="grid gap-2 rise">
          <span className="cr-label">Which table is this agent&apos;s knowledge base?</span>
          {tables.data.map((t) => (
            <button
              key={t.name}
              role="radio"
              aria-checked={sb.table === t.name}
              className="choice grid-cols-[1fr_auto] items-center py-3"
              onClick={() => {
                setSb({ table: t.name });
                d({ type: "kb", patch: { docs: t.rows } });
                preview.mutate(t.name);
              }}
            >
              <span className="flex items-center gap-2">
                <span className="num text-body-sm text-ink">{t.name}</span>
                {t.name === suggested && <Badge tone="primary">Used by your agent</Badge>}
              </span>
              <span className="flex items-center gap-2">
                {t.vector && <Badge>vectors</Badge>}
                <span className="num text-ui text-ink-2">{t.rows.toLocaleString("en-US")} rows</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {preview.data && (
        <div className="grid gap-2 rise">
          <span className="cr-label">First rows</span>
          {preview.data.map((r) => (
            <p key={r} className="rounded-control bg-surface-2 px-3 py-2 text-ui text-ink-2">
              {r}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function StepKb(p: StepProps) {
  const { s, d } = p;
  const retellKb = s.host === "retell" && s.agent?.kbNodes.length;
  const hasSupabase = s.agent?.kbNodes.some((k) => /supabase/i.test(k));
  const tabs: { key: KbMode; label: string }[] = [
    ...(retellKb ? [{ key: "retell" as const, label: "Retell knowledge base" }] : []),
    { key: "supabase", label: "Supabase" },
    { key: "files", label: "Upload files" },
    { key: "paste", label: "Paste text" },
  ];
  const mode = s.kb.mode ?? (retellKb ? "retell" : hasSupabase ? "supabase" : "files");
  const setMode = (m: KbMode) => d({ type: "kb", patch: { mode: m } });

  const docs =
    mode === "retell"
      ? 22
      : mode === "supabase"
        ? s.kb.supabase.table
          ? s.kb.docs
          : 0
        : mode === "files"
          ? s.kb.files.length
          : s.kb.text.trim().length > 40
            ? Math.max(1, Math.round(s.kb.text.split(/\n\s*\n/).length))
            : 0;

  return (
    <>
      <StepTitle
        title={
          <>
            What should the agent <em>know</em>?
          </>
        }
        lede="Your knowledge base is the answer key. Hone checks answers against it and never blames it for a failure."
      />
      <div className="cr-seg mb-6 flex-wrap" role="group" aria-label="Knowledge base source">
        {tabs.map((t) => (
          <button key={t.key} aria-pressed={mode === t.key} onClick={() => setMode(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {mode === "retell" && (
        <div className="cr-alert cr-alert--success">
          <CheckCircle weight="fill" />
          <span>Your Retell agent has a knowledge base with 22 documents. Hone will use it as is.</span>
        </div>
      )}
      {mode === "supabase" && <KbSupabase {...p} />}
      {mode === "files" && (
        <div className="grid gap-3">
          <Dropzone
            multiple
            accept=".md,.txt,.csv,.json,.html"
            onFiles={async (files) => {
              const read = await Promise.all(
                files.filter((f) => f.size < 2_000_000).map(async (f) => ({ name: f.name, size: f.size, text: await f.text() })),
              );
              const names = new Set(read.map((f) => f.name));
              d({ type: "kb", patch: { files: [...s.kb.files.filter((f) => !names.has(f.name)), ...read].slice(0, 50) } });
            }}
            title="Drop FAQs, product sheets or policies"
            hint="Markdown, text, CSV, JSON or HTML. Up to 50 files. For PDFs, paste the text instead."
          />
          {s.kb.files.map((f) => (
            <div key={f.name} className="flex items-center gap-2 rounded-control bg-surface-2 px-3 py-2 text-ui">
              <FileText size={16} className="text-ink-2" aria-hidden />
              <span className="truncate">{f.name}</span>
              <span className="num ml-auto text-ink-2">{(f.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                className="cr-btn cr-btn--ghost cr-btn--sm cr-btn--icon"
                onClick={() => d({ type: "kb", patch: { files: s.kb.files.filter((x) => x.name !== f.name) } })}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {mode === "paste" && (
        <Field label="Paste your FAQs or facts" htmlFor="kb-text" help="Separate entries with a blank line.">
          <textarea
            id="kb-text"
            className="cr-textarea min-h-[220px]"
            placeholder={"Returns. Unopened products can be returned within 30 days.\n\nShipping. EU orders arrive in 3-5 working days."}
            value={s.kb.text}
            onChange={(e) => d({ type: "kb", patch: { text: e.target.value } })}
          />
        </Field>
      )}

      <StepFooter
        onBack={() => d({ type: "back" })}
        secondary={
          <button
            className="cr-btn cr-btn--ghost"
            onClick={() => {
              d({ type: "kb", patch: { mode: "skip", docs: 0 } });
              d({ type: "next" });
            }}
          >
            Skip for now
          </button>
        }
        primary={
          <button
            className="cr-btn cr-btn--primary"
            disabled={docs === 0}
            onClick={() => {
              d({ type: "kb", patch: { mode, docs } });
              d({ type: "next" });
            }}
          >
            Use this knowledge base
          </button>
        }
      />
    </>
  );
}

// ---------------- Step 5: real conversations ----------------

function ColumnSelect({
  columns,
  id,
  value,
  onChange,
  optional,
}: {
  columns: string[];
  id: string;
  value: string | null;
  onChange: (v: string | null) => void;
  optional?: boolean;
}) {
  return (
    <select id={id} className="cr-select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {optional && <option value="">Not in this file</option>}
      {columns.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function MappingEditor({ s, d }: StepProps) {
  const csv = s.data.csv!;
  const m = csv.mapping;
  const setMap = (patch: Partial<Mapping>) => {
    const mapping = { ...m, ...patch };
    const suff = sufficiency(group(csv.rows, mapping));
    d({ type: "data", patch: { csv: { ...csv, mapping, confirmed: false }, suff } });
  };
  const convs = useMemo(() => group(csv.rows, m), [csv.rows, m]);
  const agentValues = useMemo(() => {
    const vals = new Set(csv.rows.slice(0, 500).map((r) => r[m.role]).filter(Boolean));
    return [...vals].slice(0, 6).map((v) => ({ v, role: normaliseRole(v) }));
  }, [csv.rows, m.role]);

  return (
    <div className="grid gap-6 rise">
      <div className="flex items-center gap-2 text-ui text-ink-2">
        <FileText size={16} />
        <span className="num">{csv.fileName}</span>
        <span>
          · <span className="num">{csv.rows.length.toLocaleString("en-US")}</span> rows · <span className="num">{csv.columns.length}</span> columns
        </span>
        <button
          className="cr-btn cr-btn--ghost cr-btn--sm ml-auto"
          onClick={() => d({ type: "data", patch: { csv: null, suff: null } })}
        >
          <ArrowsClockwise /> Use another file
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Who is speaking" htmlFor="map-role" help={agentValues.map((x) => `${x.v} → ${x.role}`).join(", ")}>
          <ColumnSelect columns={csv.columns} id="map-role" value={m.role} onChange={(v) => v && setMap({ role: v })} />
        </Field>
        <Field label="Message text" htmlFor="map-content">
          <ColumnSelect columns={csv.columns} id="map-content" value={m.content} onChange={(v) => v && setMap({ content: v })} />
        </Field>
        <Field label="Time (optional)" htmlFor="map-time" help="Keeps messages in the right order.">
          <ColumnSelect columns={csv.columns} id="map-time" value={m.createdAt} optional onChange={(v) => setMap({ createdAt: v })} />
        </Field>
        <Field label="Group messages by" htmlFor="map-group">
          <ColumnSelect columns={csv.columns} id="map-group" value={m.groupBy} onChange={(v) => v && setMap({ groupBy: v })} />
        </Field>
      </div>

      {/* The one question Hone must ask: how are conversations grouped? */}
      <div className={cx("rounded-card border p-5", csv.confirmed ? "border-success-line bg-success-soft" : "border-primary-line bg-primary-soft")}>
        <p className="text-body text-ink">
          Each conversation is grouped by <span className="num weight-bold">{m.groupBy}</span>, which looks like a{" "}
          <strong>{m.groupKind} ID</strong>. That gives <span className="num weight-bold">{convs.length.toLocaleString("en-US")}</span>{" "}
          {m.groupKind === "customer" ? "customers" : "conversations"}. Is that right?
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="cr-seg" role="group" aria-label="Group kind">
            <button aria-pressed={m.groupKind === "conversation"} onClick={() => setMap({ groupKind: "conversation" })}>
              Conversation ID
            </button>
            <button aria-pressed={m.groupKind === "customer"} onClick={() => setMap({ groupKind: "customer" })}>
              Customer ID
            </button>
          </div>
          {csv.confirmed ? (
            <Badge tone="success" dot>
              Confirmed
            </Badge>
          ) : (
            <button className="cr-btn cr-btn--secondary cr-btn--sm" onClick={() => d({ type: "data", patch: { csv: { ...csv, confirmed: true } } })}>
              Yes, that&apos;s right
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3">
        <span className="cr-label">Preview</span>
        {convs.slice(0, 2).map((c) => (
          <div key={c.id} className="grid gap-2 rounded-card border border-line bg-surface p-4">
            <span className="num text-caption text-ink-2">{c.id}</span>
            {c.messages.slice(0, 4).map((msg, i) => (
              <div key={i} className={cx("flex", msg.role === "agent" ? "justify-end" : "justify-start")}>
                <div className={cx("bubble", msg.role === "agent" ? "bubble--agent" : "bubble--user")}>{msg.content}</div>
              </div>
            ))}
            {c.messages.length > 4 && <span className="text-caption text-ink-2">+{c.messages.length - 4} more messages</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SufficiencyPanel({ s }: { s: StepProps["s"] }) {
  const f = s.data.suff;
  if (!f) return null;
  return (
    <div className="cr-card grid gap-4 rise">
      <div className="flex items-start gap-3">
        <span className="cr-empty__icon shrink-0">
          <Sparkle />
        </span>
        <p className="text-body text-ink">{f.sentence}</p>
      </div>
      <div className="grid grid-cols-3 gap-4 border-t border-line pt-4">
        <div className="cr-stat">
          <span className="cr-stat__label">Real</span>
          <span className="cr-stat__value text-h3">{f.usable.toLocaleString("en-US")}</span>
        </div>
        <div className="cr-stat">
          <span className="cr-stat__label">To generate</span>
          <span className="cr-stat__value text-h3">{f.generate}</span>
        </div>
        <div className="cr-stat">
          <span className="cr-stat__label">Dev / held-out test</span>
          <span className="cr-stat__value text-h3">
            {f.dev} / {f.test}
          </span>
        </div>
      </div>
      <p className="text-caption text-ink-2">
        80% is for exploring. 20% is kept aside and only used to report the final score, so the number stays honest.
      </p>
    </div>
  );
}

export function StepData(p: StepProps) {
  const { s, d } = p;
  const [err, setErr] = useState<string | null>(null);
  const imp = useMutation({
    mutationFn: () => importHistory(connectInput(s)),
    onSuccess: (r) => {
      const fake = Array.from({ length: r.conversations }, (_, i) => ({
        id: String(i),
        messages: [
          { role: "user" as const, content: "x", at: null },
          { role: "agent" as const, content: "y", at: null },
        ],
      }));
      d({ type: "data", patch: { imported: r, suff: sufficiency(fake) } });
    },
  });
  const canImport = s.host !== "custom";
  const mode = s.data.mode ?? (s.host === "retell" ? "import" : "csv");
  const setMode = (m: typeof mode) => {
    d({ type: "data", patch: { mode: m, suff: m === "none" ? sufficiency([]) : m === "csv" ? (s.data.csv ? s.data.suff : null) : s.data.imported ? s.data.suff : null } });
  };

  async function onCsv(files: File[]) {
    setErr(null);
    try {
      const parsed = await parseCsv(files[0]);
      const mapping = guessMapping(parsed.columns, parsed.rows);
      d({
        type: "data",
        patch: {
          mode: "csv",
          csv: { fileName: files[0].name, ...parsed, mapping, confirmed: false },
          suff: sufficiency(group(parsed.rows, mapping)),
        },
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read that file.");
    }
  }

  const ready = mode === "none" || (mode === "csv" && s.data.csv?.confirmed) || (mode === "import" && s.data.imported);

  return (
    <>
      <StepTitle
        title={
          <>
            Got <em>real</em> conversations?
          </>
        }
        lede="Real conversations make the best tests. If you have enough, Hone generates nothing. If not, it fills only the gaps."
      />
      <div className="cr-seg mb-6" role="group" aria-label="Data source">
        <button aria-pressed={mode === "csv"} onClick={() => setMode("csv")}>
          Upload a CSV
        </button>
        {canImport && (
          <button aria-pressed={mode === "import"} onClick={() => setMode("import")}>
            {s.host === "retell" ? "Pull past calls" : "Pull past executions"}
          </button>
        )}
        <button aria-pressed={mode === "none"} onClick={() => setMode("none")}>
          I don&apos;t have any
        </button>
      </div>

      <div className="grid gap-6">
        {mode === "csv" && !s.data.csv && (
          <>
            <Dropzone
              accept=".csv,text/csv"
              onFiles={onCsv}
              title="Drop a CSV of conversations"
              hint="One row per message. Columns for conversation or customer ID, who spoke, and the text."
            />
            {err && <span className="cr-error">{err}</span>}
            <a href="/sample-conversations.csv" download className="cr-link flex w-fit items-center gap-1.5 text-ui">
              <DownloadSimple size={16} /> Download a sample CSV
            </a>
          </>
        )}
        {mode === "csv" && s.data.csv && <MappingEditor {...p} />}

        {mode === "import" && !s.data.imported && (
          <div className="cr-card grid gap-3">
            <p className="text-body-sm text-ink">
              Hone will read the last 30 days of {s.host === "retell" ? "calls (transcripts only)" : "executions of your production workflow"} from{" "}
              {HOST_LABEL[s.host!]}. Names, phone numbers and IDs are redacted before anything reaches a model.
            </p>
            <button className="cr-btn cr-btn--secondary w-fit" aria-busy={imp.isPending} onClick={() => imp.mutate()}>
              <ClipboardText /> {s.host === "retell" ? "Pull my calls" : "Pull my executions"}
            </button>
          </div>
        )}
        {mode === "import" && imp.isError && <ErrorLine error={imp.error} retry={() => imp.mutate()} />}
        {mode === "import" && s.data.imported && (
          <div className="cr-alert cr-alert--success">
            <CheckCircle weight="fill" />
            <span>
              Pulled <span className="num">{s.data.imported.conversations.toLocaleString("en-US")}</span> conversations (
              <span className="num">{s.data.imported.messages.toLocaleString("en-US")}</span> messages) from{" "}
              <span className="num">{s.data.imported.from}</span> to <span className="num">{s.data.imported.to}</span>.
            </span>
          </div>
        )}

        {(mode === "none" || (mode === "csv" && s.data.csv?.confirmed) || (mode === "import" && s.data.imported)) && <SufficiencyPanel s={s} />}
      </div>

      <StepFooter
        onBack={() => d({ type: "back" })}
        primary={
          <button
            className="cr-btn cr-btn--primary"
            disabled={!ready}
            onClick={() => {
              d({ type: "data", patch: { mode } });
              d({ type: "next" });
            }}
          >
            Continue
          </button>
        }
      />
    </>
  );
}

// ---------------- Step 6: budget ----------------

const PRESETS = [2, 5, 10];

export function StepBudget({ s, d }: StepProps) {
  const [custom, setCustom] = useState(!PRESETS.includes(s.budgetUsd));
  const available = s.data.suff?.dev ?? 80;
  const plan = planRun({ budgetUsd: s.budgetUsd, available, judgeCriteria: 5 });

  return (
    <>
      <StepTitle
        title={
          <>
            How much can one test run <em>spend</em>?
          </>
        }
        lede="A hard cap. Hone plans the run to fit inside it and stops if it ever gets there."
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="cr-seg" role="group" aria-label="Budget">
          {PRESETS.map((v) => (
            <button
              key={v}
              aria-pressed={!custom && s.budgetUsd === v}
              onClick={() => {
                setCustom(false);
                d({ type: "patch", patch: { budgetUsd: v } });
              }}
            >
              <span className="num">${v}</span>
            </button>
          ))}
          <button aria-pressed={custom} onClick={() => setCustom(true)}>
            Custom
          </button>
        </div>
        {custom && (
          <MoneyInput value={s.budgetUsd} onChange={(v) => d({ type: "patch", patch: { budgetUsd: v } })} label="Custom budget in dollars" autoFocus />
        )}
      </div>

      <div className="cr-card mt-6 grid gap-1 p-0">
        <div className="flex items-center justify-between px-5 pt-5">
          <span className="cr-overline">Hone&apos;s plan for {usd(s.budgetUsd)}</span>
          <span className="num text-ui text-ink-2">est. {usd(plan.estUsd)}</span>
        </div>
        <div className="px-5 pb-2">
          <KeyVal k="Scenarios">
            <span className="num">{plan.scenarios}</span> of <span className="num">{available}</span> in dev
          </KeyVal>
          <KeyVal k="Trials each">
            <span className="num">{plan.k}</span> (agents are random, so each scenario runs more than once)
          </KeyVal>
          <KeyVal k="Judge">{plan.judgeModel}. Code checks are free and run first.</KeyVal>
          <KeyVal k="Calls">
            <span className="num">{plan.agentCalls.toLocaleString("en-US")}</span> agent turns, <span className="num">{plan.judgeCalls.toLocaleString("en-US")}</span> judge calls
          </KeyVal>
        </div>
        <p className="border-t border-line px-5 py-4 text-body-sm text-ink">{plan.note}</p>
      </div>

      <StepFooter
        onBack={() => d({ type: "back" })}
        primary={
          <button className="cr-btn cr-btn--primary" disabled={plan.scenarios === 0} onClick={() => d({ type: "next" })}>
            Set the cap
          </button>
        }
      />
    </>
  );
}

// ---------------- Step 7: ready ----------------

function SummaryRow({ k, step, onEdit, children }: { k: string; step: number; onEdit: (step: number) => void; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr_auto] items-start gap-4 border-b border-line py-3 last:border-0">
      <span className="text-ui text-ink-2">{k}</span>
      <span className="text-body-sm text-ink">{children}</span>
      <button className="cr-btn cr-btn--ghost cr-btn--sm" onClick={() => onEdit(step)} aria-label={`Edit ${k.toLowerCase()}`}>
        Edit
      </button>
    </div>
  );
}

export function StepReady({ s, d }: StepProps) {
  const router = useRouter();
  const m = useMutation({
    mutationFn: () =>
      createProject({
        name: s.name.trim() || "My agent",
        host: s.host!,
        agentName: s.agent?.name ?? "Agent",
        budgetUsd: s.budgetUsd,
        conversations: s.data.suff?.usable ?? 0,
        generated: s.data.suff?.generate ?? 0,
        kbDocs: s.kb.docs,
        setup: {
          connection: connectInput(s),
          kb: {
            mode: s.kb.mode,
            text: s.kb.text,
            files: s.kb.files.map((f) => ({ name: f.name, text: f.text })),
            supabase: s.kb.mode === "supabase" ? s.kb.supabase : null,
          },
          data: {
            mode: s.data.mode,
            rows: s.data.mode === "csv" ? s.data.csv?.rows ?? [] : [],
            mapping: s.data.mode === "csv" ? s.data.csv?.mapping ?? null : null,
          },
        },
      }),
    onSuccess: (p) => router.push(`/p/${p.id}/rubric?new=1`),
  });
  const kbText =
    s.kb.mode === "skip" || !s.kb.mode
      ? "Skipped. Facts won't be checked against a source."
      : s.kb.mode === "supabase"
        ? `Supabase table ${s.kb.supabase.table} (${s.kb.docs.toLocaleString("en-US")} rows)`
        : s.kb.mode === "retell"
          ? "Retell knowledge base (22 documents)"
          : s.kb.mode === "files"
            ? `${s.kb.files.length} uploaded file${s.kb.files.length === 1 ? "" : "s"}`
            : `${s.kb.docs} pasted entr${s.kb.docs === 1 ? "y" : "ies"}`;
  const f = s.data.suff;

  return (
    <>
      <StepTitle
        title={
          <>
            Ready to draft your <em>tests</em>
          </>
        }
        lede="Hone writes pass/fail criteria from your agent's prompt, knowledge base and conversations. You review them before anything runs."
      />
      <div className="grid gap-6">
        <Field label="Project name" htmlFor="pname">
          <input id="pname" className="cr-input" value={s.name} onChange={(e) => d({ type: "patch", patch: { name: e.target.value } })} />
        </Field>
        <div className="cr-card px-5 py-1">
          <SummaryRow onEdit={(step) => d({ type: "go", step })} k="Agent" step={2}>
            {s.agent?.name} on {HOST_LABEL[s.host!]}
          </SummaryRow>
          <SummaryRow onEdit={(step) => d({ type: "go", step })} k="Knowledge base" step={3}>
            {kbText}
          </SummaryRow>
          <SummaryRow onEdit={(step) => d({ type: "go", step })} k="Conversations" step={4}>
            {f ? (
              <>
                <span className="num">{f.usable.toLocaleString("en-US")}</span> real
                {f.generate > 0 && (
                  <>
                    , <span className="num">{f.generate}</span> to generate
                  </>
                )}
                . Split <span className="num">{f.dev}</span> / <span className="num">{f.test}</span>.
              </>
            ) : (
              "None"
            )}
          </SummaryRow>
          <SummaryRow onEdit={(step) => d({ type: "go", step })} k="Budget" step={5}>
            <span className="num">{usd(s.budgetUsd)}</span> per run, hard cap
          </SummaryRow>
        </div>
        {m.isError && <ErrorLine error={m.error} retry={() => m.mutate()} />}
      </div>
      <StepFooter
        onBack={() => d({ type: "back" })}
        primary={
          <button className="cr-btn cr-btn--primary cr-btn--lg" aria-busy={m.isPending} disabled={!s.name.trim()} onClick={() => m.mutate()}>
            Draft my tests
          </button>
        }
      />
    </>
  );
}
