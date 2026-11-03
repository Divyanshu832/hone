"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  FlowArrow,
  Phone,
  Code,
  Info,
  CheckCircle,
  WarningCircle,
  PaperPlaneRight,
  FileText,
  X,
  Sparkle,
} from "@phosphor-icons/react";
import { readAgent, sendTestMessage, testConnection } from "@/lib/api";
import type { HostKind } from "@/lib/types";
import { Badge, Field, cx } from "@/components/ui";
import { connectInput, type StepProps } from "./state";
import { Dropzone, ErrorLine, KeyVal, StepFooter, StepTitle, WorkingList } from "./parts";

// ---------------- Step 1: where is it hosted ----------------

const HOSTS: { key: HostKind; title: string; body: string; icon: React.ElementType }[] = [
  { key: "n8n", title: "n8n", body: "A workflow with an AI Agent node. Hone tests a sandbox copy.", icon: FlowArrow },
  { key: "retell", title: "Retell", body: "A voice agent. Hone reads the agent and its past calls.", icon: Phone },
  { key: "custom", title: "Custom code", body: "Your own agent behind an HTTP endpoint.", icon: Code },
];

export function StepHost({ s, d }: StepProps) {
  const pick = (host: HostKind) => {
    const changed = host !== s.host;
    d({ type: "patch", patch: changed ? { host, connection: null, agent: null, maxStep: 1 } : { host } });
    // Choosing is the answer: move on without an extra click.
    setTimeout(() => d({ type: "next" }), 220);
  };
  return (
    <>
      <StepTitle
        title={
          <>
            Where is your agent <em>hosted</em>?
          </>
        }
        lede="Pick one. Hone adapts every next step to it."
      />
      <div role="radiogroup" aria-label="Agent host" className="grid gap-3">
        {HOSTS.map((h) => (
          <button
            key={h.key}
            role="radio"
            aria-checked={s.host === h.key}
            className="choice grid-cols-[44px_1fr] items-center gap-4"
            onClick={() => pick(h.key)}
          >
            <span className="grid h-11 w-11 place-items-center rounded-control bg-surface-2 text-ink-2">
              <h.icon size={22} />
            </span>
            <span className="grid gap-0.5">
              <span className="text-body weight-bold text-ink">{h.title}</span>
              <span className="text-body-sm text-ink-2">{h.body}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-5 text-ui text-ink-2">
        Using Vapi, Bolna or LangGraph? Pick Custom code. Anything with an endpoint works.
      </p>
    </>
  );
}

// ---------------- Step 2: connect ----------------

function useConnect({ s, d }: StepProps, autoNext = true) {
  return useMutation({
    mutationFn: () => testConnection(connectInput(s)),
    onSuccess: (r) => {
      d({ type: "patch", patch: { connection: r, agent: null } });
      if (r.ok && autoNext && !r.agents) setTimeout(() => d({ type: "next" }), 700);
    },
  });
}

function ConnResult({ r }: { r: { ok: boolean; detail: string } | null | undefined }) {
  if (!r) return null;
  return (
    <div className={cx("cr-alert rise", r.ok ? "cr-alert--success" : "cr-alert--danger")} role="status">
      {r.ok ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}
      <span>{r.detail}</span>
    </div>
  );
}

function ConnectN8n(p: StepProps) {
  const { s, d } = p;
  const m = useConnect(p);
  const set = (patch: Partial<typeof s.n8n>) => d({ type: "patch", patch: { n8n: { ...s.n8n, ...patch }, connection: null } });
  const ready = s.n8n.baseUrl && s.n8n.apiKey && s.n8n.sandboxUrl;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) m.mutate();
      }}
    >
      <StepTitle title={<>Connect <em>n8n</em></>} lede="Three things and you're done. Hone only reads your workflows and calls the sandbox." />
      <div className="grid gap-5">
        <Field label="n8n URL" htmlFor="n8n-url" help="The address you open n8n at.">
          <input
            id="n8n-url"
            name="hone-n8n-base"
            type="url"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            className="cr-input"
            placeholder="https://your-team.app.n8n.cloud"
            value={s.n8n.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value.trim() })}
            autoFocus
          />
        </Field>
        <Field label="API key" htmlFor="n8n-key" help="In n8n: Settings, n8n API, Create an API key. Self-hosted or a paid Cloud plan.">
          <input
            id="n8n-key"
            className="cr-input"
            type="password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            placeholder="n8n_api_…"
            value={s.n8n.apiKey}
            onChange={(e) => set({ apiKey: e.target.value.trim() })}
          />
        </Field>
        <Field label="Sandbox workflow URL" htmlFor="n8n-sandbox" help="Duplicate your agent's workflow in n8n, then paste the copy's URL here.">
          <input
            id="n8n-sandbox"
            type="url"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            className="cr-input"
            placeholder="https://your-team.app.n8n.cloud/workflow/AbC123"
            value={s.n8n.sandboxUrl}
            onChange={(e) => set({ sandboxUrl: e.target.value.trim() })}
          />
        </Field>

        <div className="cr-alert">
          <Info />
          <span>
            <strong>Why a sandbox?</strong> Tests send real messages. In a copy, tools like email or CRM can point at test
            accounts, so no real customer gets touched.
          </span>
        </div>

        <div className="choice grid-cols-[1fr_auto] items-center" aria-disabled="true">
          <span className="grid gap-0.5">
            <span className="text-body-sm weight-bold text-ink-2">Let Hone create the sandbox</span>
            <span className="text-ui text-ink-2">Hone copies the workflow and adds the test trigger for you.</span>
          </span>
          <Badge>Coming soon</Badge>
        </div>

        <ConnResult r={s.connection ?? (m.error ? { ok: false, detail: m.error.message } : null)} />
      </div>
      <StepFooter
        onBack={() => d({ type: "back" })}
        primary={
          <button type="submit" className="cr-btn cr-btn--primary" disabled={!ready} aria-busy={m.isPending}>
            Test connection
          </button>
        }
      />
    </form>
  );
}

function ConnectRetell(p: StepProps) {
  const { s, d } = p;
  const m = useConnect(p);
  const agents = s.connection?.ok ? s.connection.agents ?? [] : [];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (agents.length && s.retell.agentId) d({ type: "next" });
        else if (s.retell.apiKey) m.mutate();
      }}
    >
      <StepTitle title={<>Connect <em>Retell</em></>} lede="Hone reads your agent and its past calls. It never places a call." />
      <div className="grid gap-5">
        <Field label="Retell API key" htmlFor="retell-key" help="In Retell: Settings, API Keys.">
          <input
            id="retell-key"
            className="cr-input"
            type="password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            placeholder="key_…"
            value={s.retell.apiKey}
            onChange={(e) => d({ type: "patch", patch: { retell: { apiKey: e.target.value.trim(), agentId: "" }, connection: null } })}
            autoFocus
          />
        </Field>
        <ConnResult r={s.connection} />
        {agents.length > 0 && (
          <div role="radiogroup" aria-label="Retell agent" className="grid gap-2 rise">
            <span className="cr-label">Which agent?</span>
            {agents.map((a) => (
              <button
                type="button"
                key={a.id}
                role="radio"
                aria-checked={s.retell.agentId === a.id}
                className="choice"
                onClick={() => {
                  d({ type: "patch", patch: { retell: { ...s.retell, agentId: a.id }, agent: null } });
                  setTimeout(() => d({ type: "next" }), 220);
                }}
              >
                <span className="text-body-sm weight-bold text-ink">{a.name}</span>
                <span className="text-ui text-ink-2">{a.meta}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <StepFooter
        onBack={() => d({ type: "back" })}
        primary={
          agents.length ? (
            <button type="submit" className="cr-btn cr-btn--primary" disabled={!s.retell.agentId}>
              Continue
            </button>
          ) : (
            <button type="submit" className="cr-btn cr-btn--primary" disabled={!s.retell.apiKey} aria-busy={m.isPending}>
              Find my agents
            </button>
          )
        }
      />
    </form>
  );
}

const TEXT_EXT = /\.(py|ts|tsx|js|mjs|json|ya?ml|md|txt|toml)$/i;

function ConnectCustom(p: StepProps) {
  const { s, d } = p;
  const m = useConnect(p);
  const [fileError, setFileError] = useState<string | null>(null);
  const setCustom = (patch: Partial<typeof s.custom>) => d({ type: "patch", patch: { custom: { ...s.custom, ...patch }, connection: null } });

  async function addFiles(files: File[]) {
    setFileError(null);
    const ok = files.filter((f) => TEXT_EXT.test(f.name) && f.size < 512_000);
    if (ok.length < files.length) setFileError("Some files were skipped. Hone reads code and config files under 500 KB.");
    const read = await Promise.all(ok.map(async (f) => ({ name: f.name, size: f.size, text: await f.text() })));
    const names = new Set(read.map((f) => f.name));
    setCustom({ files: [...s.custom.files.filter((f) => !names.has(f.name)), ...read] });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (s.custom.endpointUrl) m.mutate();
      }}
    >
      <StepTitle
        title={<>Connect your <em>agent</em></>}
        lede="Drop the files that hold the prompt and tools so Hone understands the agent. Then tell Hone where to send test messages."
      />
      <div className="grid gap-5">
        <Dropzone
          multiple
          accept=".py,.ts,.tsx,.js,.mjs,.json,.yaml,.yml,.md,.txt,.toml"
          onFiles={addFiles}
          title="Drop your agent's files"
          hint="Prompt, tools, config. Read only: Hone never runs your code."
        />
        {fileError && <span className="cr-error">{fileError}</span>}
        {s.custom.files.length > 0 && (
          <ul className="grid gap-1">
            {s.custom.files.map((f) => (
              <li key={f.name} className="flex items-center gap-2 rounded-control bg-surface-2 px-3 py-2 text-ui">
                <FileText size={16} className="text-ink-2" />
                <span className="num truncate">{f.name}</span>
                <span className="num text-ink-2">{(f.size / 1024).toFixed(1)} KB</span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  className="cr-btn cr-btn--ghost cr-btn--sm cr-btn--icon ml-auto"
                  onClick={() => setCustom({ files: s.custom.files.filter((x) => x.name !== f.name) })}
                >
                  <X />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Field label="Endpoint URL" htmlFor="ep" help="Local or deployed. Hone POSTs a conversation and reads the reply.">
          <input
            id="ep"
            type="url"
            inputMode="url"
            spellCheck={false}
            className="cr-input"
            placeholder="http://localhost:8000/chat"
            value={s.custom.endpointUrl}
            onChange={(e) => setCustom({ endpointUrl: e.target.value.trim() })}
          />
        </Field>
        <Field label="Message format" htmlFor="fmt">
          <select
            id="fmt"
            className="cr-select"
            value={s.custom.format}
            onChange={(e) => setCustom({ format: e.target.value as "openai" | "simple" })}
          >
            <option value="openai">OpenAI chat format: {"{ messages: [...] }"}</option>
            <option value="simple">Simple: {"{ message, session_id }"} returns {"{ reply }"}</option>
          </select>
        </Field>
        <ConnResult r={s.connection} />
      </div>
      <StepFooter
        onBack={() => d({ type: "back" })}
        primary={
          <button type="submit" className="cr-btn cr-btn--primary" disabled={!s.custom.endpointUrl} aria-busy={m.isPending}>
            Test endpoint
          </button>
        }
      />
    </form>
  );
}

export function StepConnect(p: StepProps) {
  if (p.s.host === "n8n") return <ConnectN8n {...p} />;
  if (p.s.host === "retell") return <ConnectRetell {...p} />;
  return <ConnectCustom {...p} />;
}

// ---------------- Step 3: what Hone found ----------------

const READ_LINES: Record<HostKind, string[]> = {
  n8n: ["Opening the sandbox workflow", "Reading the AI Agent node", "Finding tools and memory", "Looking for a knowledge base", "Checking the trigger"],
  retell: ["Reading the agent", "Reading its prompt and tools", "Counting past calls"],
  custom: ["Reading your files", "Looking for a system prompt", "Finding tools"],
};

function TestBox(p: StepProps) {
  const [text, setText] = useState("Hi, which serum is best for oily skin?");
  const [log, setLog] = useState<{ role: "user" | "agent"; text: string; ms?: number }[]>([]);
  const m = useMutation({
    mutationFn: (t: string) => sendTestMessage(connectInput(p.s), t),
    onSuccess: (r) => setLog((l) => [...l, { role: "agent", text: r.reply, ms: r.ms }]),
  });
  const failed = m.isError ? m.error.message : null;
  return (
    <div className="grid gap-3 rounded-card border border-line bg-surface-2/50 p-4">
      <span className="cr-label">Send a test message</span>
      {log.length > 0 && (
        <div className="grid gap-2">
          {log.map((l, i) => (
            <div key={i} className={cx("flex", l.role === "agent" ? "justify-end" : "justify-start")}>
              <div className={cx("bubble rise", l.role === "agent" ? "bubble--agent" : "bubble--user")}>
                {l.text}
                {l.ms && <span className="num mt-1 block text-caption text-ink-2">{l.ms} ms</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {failed && <span className="cr-error" role="alert">The agent didn&apos;t reply: {failed}</span>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          setLog((l) => [...l, { role: "user", text }]);
          m.mutate(text);
          setText("");
        }}
      >
        <input className="cr-input" value={text} onChange={(e) => setText(e.target.value)} aria-label="Test message" />
        <button className="cr-btn cr-btn--secondary" aria-busy={m.isPending} disabled={!text.trim()}>
          <PaperPlaneRight /> Send test
        </button>
      </form>
    </div>
  );
}

// Fields Hone fills itself on every turn.
const AUTO_FIELDS = new Set(["message", "chatInput", "sessionId", "summary", "history"]);

/** The webhook reads extra fields (name, cart...). Let the user give fixed sample values for tests. */
function WebhookFields({ s, d }: StepProps) {
  const extra = (s.agent?.trigger.fields ?? []).filter((f) => !AUTO_FIELDS.has(f));
  if (!extra.length) return null;
  const set = (k: string, v: string) =>
    d({ type: "patch", patch: { n8n: { ...s.n8n, webhookFields: { ...s.n8n.webhookFields, [k]: v } } } });
  return (
    <div className="cr-card grid gap-4">
      <div className="grid gap-1">
        <h2 className="text-body weight-bold">Your webhook reads a few more fields</h2>
        <p className="text-ui text-ink-2">
          Hone fills <span className="num">message</span> and <span className="num">summary</span> (the chat so far) on
          every turn. Give sample values for the rest, or leave them empty. Use made-up details, not a real customer&apos;s.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {extra.map((f) => (
          <label key={f} className="cr-field">
            <span className="cr-label num">{f}</span>
            <input className="cr-input" value={s.n8n.webhookFields[f] ?? ""} onChange={(e) => set(f, e.target.value)} spellCheck={false} />
          </label>
        ))}
      </div>
    </div>
  );
}

function TriggerGuide({ onRecheck, busy }: { onRecheck: () => void; busy: boolean }) {
  return (
    <div className="cr-alert cr-alert--warning rise">
      <WarningCircle weight="fill" />
      <div className="grid gap-3">
        <span>
          <strong>Your sandbox has no way for Hone to send it a message yet.</strong> Two quick steps in n8n:
        </span>
        <ol className="grid list-decimal gap-1 pl-5">
          <li>
            Open the sandbox and add a <strong>Chat Trigger</strong> (or a Webhook node) in front of the AI Agent node.
          </li>
          <li>Save and activate the sandbox workflow.</li>
        </ol>
        <button className="cr-btn cr-btn--secondary cr-btn--sm w-fit" onClick={onRecheck} aria-busy={busy}>
          Check again
        </button>
      </div>
    </div>
  );
}

export function StepFound(p: StepProps) {
  const { s, d } = p;
  const [ticks, setTicks] = useState(0);
  const lines = READ_LINES[s.host!];
  const m = useMutation({
    mutationFn: () => readAgent(connectInput(s)),
    onSuccess: (agent) => d({ type: "patch", patch: { agent, name: s.name || agent.name.replace(/\s*\(sandbox\)/i, "") } }),
  });

  useEffect(() => {
    if (!s.agent && m.isIdle) m.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (s.agent || m.isError) return;
    const t = setInterval(() => setTicks((n) => Math.min(lines.length - 1, n + 1)), 260);
    return () => clearInterval(t);
  }, [s.agent, m.isError, lines.length]);

  if (!s.agent) {
    return (
      <>
        <StepTitle title={<>Reading your <em>agent</em></>} lede="This takes a few seconds." />
        <WorkingList lines={lines} doneCount={ticks} />
        {m.isError && (
          <div className="mt-5">
            <ErrorLine error={m.error} retry={() => m.mutate()} />
          </div>
        )}
      </>
    );
  }

  const a = s.agent;
  const needsTrigger = s.host === "n8n" && !a.trigger.kind;
  const canTest = s.host !== "retell" && !needsTrigger;

  return (
    <>
      <StepTitle
        title={
          <>
            Here&apos;s what I <em>found</em>
          </>
        }
        lede="Check this looks right. Hone writes your tests from it."
      />
      <div className="grid gap-5">
        {needsTrigger && <TriggerGuide onRecheck={() => m.mutate()} busy={m.isPending} />}
        <div className="cr-card p-0">
          <div className="px-5">
            <KeyVal k="Agent">{a.name}</KeyVal>
            {a.parts && a.parts.length > 1 && (
              <KeyVal k="Parts">
                <ul className="grid gap-1.5">
                  {a.parts.map((pt) => (
                    <li key={pt.name}>
                      <span className="num text-ink">{pt.name}</span>
                      <span className="text-ink-2">
                        {" "}
                        · {pt.role === "router" ? `routes to ${pt.routes?.length ?? 0} paths` : `${pt.tools.length} tools`}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-caption text-ink-2">
                  Hone tests the workflow as a whole and writes criteria from every part&apos;s prompt.
                </p>
              </KeyVal>
            )}
            <KeyVal k="Model">
              <span className="num">{a.model}</span>
            </KeyVal>
            <KeyVal k="Tools">
              {a.tools.length ? (
                <ul className="grid gap-1.5">
                  {a.tools.map((t) => (
                    <li key={t.name}>
                      <span className="num text-ink">{t.name}</span>
                      <span className="text-ink-2"> · {t.description}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-ink-2">None found</span>
              )}
            </KeyVal>
            <KeyVal k="Memory">{a.memory ?? <span className="text-ink-2">None</span>}</KeyVal>
            <KeyVal k="Knowledge base">
              {a.kbNodes.length ? a.kbNodes.join(", ") : <span className="text-ink-2">None found. You can add one next.</span>}
            </KeyVal>
            {s.host !== "retell" && (
              <KeyVal k="Test trigger">
                {a.trigger.kind ? (
                  <Badge tone="success" dot>
                    {a.trigger.kind === "chat" ? "Chat Trigger" : "Webhook"} ready
                  </Badge>
                ) : (
                  <Badge tone="warning" dot>
                    Missing
                  </Badge>
                )}
              </KeyVal>
            )}
          </div>
          <details className="group border-t border-line px-5 py-3">
            <summary className="cursor-pointer list-none text-ui weight-medium text-primary-ink">
              <span className="group-open:hidden">Show system prompt</span>
              <span className="hidden group-open:inline">Hide system prompt</span>
            </summary>
            <pre className="code mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap">{a.prompt}</pre>
          </details>
        </div>
        {s.host === "n8n" && a.trigger.kind === "webhook" && <WebhookFields {...p} />}
        {canTest && <TestBox {...p} />}
        {s.host === "retell" && (
          <div className="cr-alert">
            <Sparkle />
            <span>Voice agents are tested from their call transcripts. No calls are placed and no audio is used.</span>
          </div>
        )}
      </div>
      <StepFooter
        onBack={() => d({ type: "back" })}
        primary={
          <button className="cr-btn cr-btn--primary" disabled={needsTrigger} onClick={() => d({ type: "next" })}>
            Looks right
          </button>
        }
      />
    </>
  );
}
