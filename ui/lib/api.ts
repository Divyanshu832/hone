// One client for every screen. Without NEXT_PUBLIC_API_URL it serves fixtures (mock mode) with a
// small delay so loading states are real. With it, the same functions call the FastAPI backend.

import * as fx from "@/fixtures";
import { authHeaders } from "./keys";
import { accessToken, authConfig } from "./auth";
import type {
  AgentInfo,
  AgentSnapshot,
  AgentStatus,
  Health,
  Invite,
  InviteInfo,
  Me,
  Member,
  OrgRole,
  Session,
  Visibility,
  Recommendation,
  RecStatus,
  Criterion,
  GateConfig,
  HostKind,
  ItemDetail,
  JudgeRow,
  LabelTask,
  Project,
  Run,
  RunEvent,
  RunItem,
  OrgKeys,
} from "./types";
import { summarize } from "./stats";

const BASE = process.env.NEXT_PUBLIC_API_URL;
export const MOCK = !BASE;

const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms));

async function headers(): Promise<Record<string, string>> {
  // Every request carries the visitor's own model keys (bring your own key) and, with accounts on,
  // their sign-in token.
  const token = await accessToken();
  return { ...authHeaders(), ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: {
      ...(await headers()),
      ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const j = JSON.parse(text);
      // FastAPI errors: {detail: "..."} or {detail: [{msg}]} for validation.
      detail = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail.map((d: { msg: string }) => d.msg).join("; ") : text;
    } catch {}
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// In mock mode, projects made in the wizard live in memory (and localStorage for reloads).
const LS_KEY = "hone-mock-projects";
function mockProjects(): Project[] {
  let extra: Project[] = [];
  try {
    extra = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {}
  return [...extra, ...fx.projects];
}
function saveMockProject(p: Project) {
  try {
    const extra = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    localStorage.setItem(LS_KEY, JSON.stringify([p, ...extra]));
  } catch {}
}

// ---------- Projects ----------
export async function listProjects(): Promise<Project[]> {
  if (!MOCK) return http("/projects");
  await wait();
  return mockProjects();
}

export async function getProject(id: string): Promise<Project> {
  if (!MOCK) return http(`/projects/${id}`);
  await wait(200);
  const p = mockProjects().find((x) => x.id === id);
  if (!p) throw new Error("Project not found");
  return p;
}

export async function getAgent(id: string): Promise<AgentInfo> {
  if (!MOCK) return http(`/projects/${id}/agent`);
  await wait(200);
  return fx.agents[id] ?? fx.agents["bioceutica-concierge"];
}

// ---------- Wizard ----------
export interface ConnectInput {
  host: HostKind;
  format?: "openai" | "simple";
  baseUrl?: string;
  apiKey?: string;
  sandboxUrl?: string;
  endpointUrl?: string;
  agentRef?: string;
  files?: { name: string; text: string }[];
}

export interface ConnectResult {
  ok: boolean;
  detail: string;
  agents?: { id: string; name: string; meta: string }[];
}

export async function testConnection(input: ConnectInput): Promise<ConnectResult> {
  if (!MOCK) return http("/connections/test", { method: "POST", body: JSON.stringify(input) });
  await wait(900);
  if (input.host === "n8n") {
    if (!input.baseUrl || !/^https?:\/\//.test(input.baseUrl)) return { ok: false, detail: "That base URL doesn't look right. It should start with https://" };
    if (!input.apiKey || input.apiKey.length < 8) return { ok: false, detail: "n8n rejected this API key. Create one under Settings, n8n API." };
    if (!input.sandboxUrl) return { ok: false, detail: "Paste the URL of your sandbox workflow." };
    return { ok: true, detail: "Connected to n8n. Found your sandbox workflow." };
  }
  if (input.host === "retell") {
    if (!input.apiKey || input.apiKey.length < 8) return { ok: false, detail: "Retell rejected this API key." };
    return {
      ok: true,
      detail: "Connected to Retell. Pick the agent to test.",
      agents: [
        { id: "agent_inbound", name: "Inbound voice agent", meta: "1,480 calls in the last 30 days" },
        { id: "agent_outbound", name: "Outbound reminders", meta: "312 calls in the last 30 days" },
      ],
    };
  }
  if (!input.endpointUrl || !/^https?:\/\//.test(input.endpointUrl)) return { ok: false, detail: "Add the endpoint URL Hone should call." };
  return { ok: true, detail: "Your endpoint replied in 840 ms." };
}

export async function readAgent(input: ConnectInput): Promise<AgentInfo> {
  if (!MOCK) return http("/connections/read-agent", { method: "POST", body: JSON.stringify(input) });
  await wait(1100);
  if (input.host === "retell") return fx.agents["voice-agent"];
  if (input.host === "custom") {
    const firstFile = input.files?.[0];
    const promptGuess = firstFile?.text.match(/(?:system_prompt|SYSTEM_PROMPT|instructions)\s*=\s*["'`]{1,3}([\s\S]{20,800}?)["'`]{1,3}/)?.[1];
    return {
      name: firstFile ? firstFile.name.replace(/\.\w+$/, "") : "Custom agent",
      model: firstFile?.text.match(/(gpt-[\w.-]+|claude-[\w.-]+|gemini-[\w.-]+)/)?.[1] ?? "Unknown model",
      prompt: promptGuess ?? "Hone couldn't find a system prompt in the files. You can paste it later.",
      tools: Array.from(new Set(input.files?.flatMap((f) => [...f.text.matchAll(/def (\w+)\(|name:\s*["'](\w+)["']/g)].map((m) => m[1] || m[2])) ?? []))
        .slice(0, 8)
        .map((n) => ({ name: n, description: "Found in your code" })),
      memory: null,
      kbNodes: [],
      trigger: { kind: "webhook", url: input.endpointUrl ?? null },
    };
  }
  const a = fx.agents["bioceutica-concierge"];
  // The sandbox URL containing "no-trigger" lets you preview the guide in mock mode.
  if (input.sandboxUrl?.includes("no-trigger")) return { ...a, trigger: { kind: null, url: null } };
  return a;
}

export async function sendTestMessage(_input: ConnectInput, text: string): Promise<{ reply: string; ms: number }> {
  if (!MOCK) return http("/connections/send-test", { method: "POST", body: JSON.stringify({ ..._input, text }) });
  await wait(1200);
  const t = text.toLowerCase();
  const reply = t.includes("order")
    ? "Happy to check. What's your order number? It starts with BC."
    : t.includes("oily")
      ? "For oily skin I'd start with the Clarity Serum: 5% niacinamide and zinc. Use 2-3 drops after cleansing."
      : "Hi! I'm the Bioceutica concierge. I can help you pick products or check an order.";
  return { reply, ms: 1180 };
}

export async function supabaseTables(_url: string, _key: string): Promise<{ name: string; rows: number; vector: boolean }[]> {
  if (!MOCK) return http("/kb/supabase/tables", { method: "POST", body: JSON.stringify({ url: _url, key: _key }) });
  await wait(800);
  return [
    { name: "kb_chunks", rows: 642, vector: true },
    { name: "products", rows: 38, vector: false },
    { name: "faq_embeddings", rows: 120, vector: true },
    { name: "orders", rows: 9210, vector: false },
  ];
}

export async function supabasePreview(url: string, key: string, table: string): Promise<string[]> {
  if (!MOCK) return http("/kb/supabase/preview", { method: "POST", body: JSON.stringify({ url, key, table }) });
  await wait(500);
  return [
    "Clarity Serum. 5% niacinamide, 1% zinc PCA. For oily and combination skin. Use morning and night.",
    "Retinol and sensitive skin. If you have eczema or rosacea, check with a dermatologist first.",
    "Returns. Unopened products can be returned within 30 days for a full refund.",
  ];
}

export async function importHistory(input: ConnectInput): Promise<{ conversations: number; messages: number; from: string; to: string }> {
  if (!MOCK) return http("/connections/import", { method: "POST", body: JSON.stringify(input) });
  await wait(1500);
  return input.host === "retell"
    ? { conversations: 1480, messages: 31220, from: "2026-10-04", to: "2026-11-02" }
    : { conversations: 212, messages: 2390, from: "2026-09-12", to: "2026-11-02" };
}

export async function createProject(input: {
  name: string;
  host: HostKind;
  agentName: string;
  budgetUsd: number;
  conversations: number;
  generated: number;
  kbDocs: number;
  /** Everything the backend needs to rebuild the setup: credentials, KB and data. */
  setup: {
    connection: ConnectInput & { format?: string };
    kb: { mode: string | null; text: string; files: { name: string; text: string }[]; supabase: { url: string; key: string; table: string | null } | null };
    data: { mode: string | null; rows: Record<string, string>[]; mapping: unknown };
  };
}): Promise<Project> {
  if (!MOCK) {
    const { setup, ...rest } = input;
    return http("/projects", { method: "POST", body: JSON.stringify({ ...rest, ...setup }) });
  }
  await wait(700);
  const id = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Math.random().toString(36).slice(2, 6);
  const p: Project = {
    id,
    name: input.name,
    host: input.host,
    agentName: input.agentName,
    createdAt: new Date().toISOString(),
    budgetUsd: input.budgetUsd,
    pipeline: { connected: true, kb: input.kbDocs > 0, data: input.conversations + input.generated > 0, rubric: false, judges: false, run: false, gate: false },
    counts: { conversations: input.conversations, generated: input.generated, criteria: 0, kbDocs: input.kbDocs },
  };
  saveMockProject(p);
  return p;
}

// ---------- Rubric ----------
export async function listCriteria(projectId: string): Promise<Criterion[]> {
  if (!MOCK) return http(`/projects/${projectId}/criteria`);
  await wait();
  if (fx.criteria[projectId]) return fx.criteria[projectId];
  // New mock project: draft criteria that match its host.
  const host = mockProjects().find((p) => p.id === projectId)?.host;
  const base = host === "retell" ? fx.criteria["voice-agent"] : fx.criteria["bioceutica-concierge"];
  return base.map((c) => ({ ...c, status: "draft" as const }));
}

export async function saveCriteria(projectId: string, criteria: Criterion[]): Promise<Criterion[]> {
  if (!MOCK) return http(`/projects/${projectId}/criteria`, { method: "PUT", body: JSON.stringify(criteria) });
  await wait(250);
  fx.criteria[projectId] = criteria;
  return criteria;
}

export async function health(): Promise<Health | null> {
  if (MOCK) return null;
  return http("/health");
}

/** Test the visitor's keys with one cheap real call each. */
export async function checkKeys(): Promise<Partial<Record<"openrouter" | "typesafe", { ok: boolean; detail: string }>>> {
  if (MOCK) {
    await wait(500);
    return { openrouter: { ok: true, detail: "Demo mode: keys aren't checked." } };
  }
  return http("/keys/check", { method: "POST" });
}

// ---------- History: agent versions and recommendations ----------
export async function listSnapshots(projectId: string): Promise<AgentSnapshot[]> {
  if (!MOCK) return http(`/projects/${projectId}/snapshots`);
  await wait();
  return fx.snapshots[projectId] ?? [];
}

export async function listRecommendations(projectId: string, runId?: string): Promise<Recommendation[]> {
  if (!MOCK) return http(`/projects/${projectId}/recommendations${runId ? `?run_id=${encodeURIComponent(runId)}` : ""}`);
  await wait();
  return (fx.recommendations[projectId] ?? []).filter((r) => !runId || r.runId === runId);
}

/** Custom-code agents: upload the edited files so Hone records the new version (read as text, never run). */
export async function updateAgentFiles(projectId: string, files: { name: string; text: string }[]) {
  if (MOCK) {
    await wait(400);
    return { changed: true, version: 3, changeSummary: "Prompt +2 −0 lines" };
  }
  return http<{ changed: boolean; version: number; changeSummary: string }>(`/projects/${projectId}/agent-files`, {
    method: "PUT",
    body: JSON.stringify({ files }),
  });
}

export async function setRecommendationStatus(id: string, status: RecStatus): Promise<Recommendation> {
  if (!MOCK) return http(`/recommendations/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
  await wait(200);
  const r = Object.values(fx.recommendations).flat().find((x) => x.id === id);
  if (!r) throw new Error("Recommendation not found");
  r.status = status;
  return { ...r };
}

// ---------- Runs ----------
export async function listRuns(projectId: string): Promise<Run[]> {
  if (!MOCK) return http(`/projects/${projectId}/runs`);
  await wait();
  return fx.runs.filter((r) => r.projectId === projectId);
}

export async function getRun(runId: string): Promise<Run> {
  if (!MOCK) return http(`/runs/${runId}`);
  await wait(250);
  const r = fx.runs.find((x) => x.id === runId) ?? liveRuns.get(runId);
  if (!r) throw new Error("Run not found");
  // Copy so React Query sees a change when a live run finishes.
  return { ...r, items: [...r.items] };
}

export async function getItem(runId: string, itemId: string): Promise<ItemDetail> {
  if (!MOCK) return http(`/runs/${runId}/items/${itemId}`);
  await wait(250);
  const run = await getRun(runId);
  const d = fx.itemDetail(run, itemId);
  if (!d) throw new Error("Conversation not found");
  return d;
}

// Live runs started in mock mode, with the plan estimate that sized them.
const liveRuns = new Map<string, Run>();
const liveEst = new Map<string, number>();
const plan_est = (r: Run) => liveEst.get(r.id) ?? r.budgetUsd;

export async function startRun(
  projectId: string,
  plan: { scenarios: number; k: number; budgetUsd: number; estUsd: number; split: "dev" | "test" },
): Promise<string> {
  if (!MOCK) {
    const r = await http<{ id: string }>(`/projects/${projectId}/runs`, { method: "POST", body: JSON.stringify(plan) });
    return r.id;
  }
  await wait(400);
  const template = fx.runs.find((r) => r.projectId === projectId) ?? fx.runs[0];
  const id = `run-${Math.floor(1000 + Math.random() * 8999)}`;
  liveEst.set(id, plan.estUsd);
  liveRuns.set(id, {
    ...template,
    id,
    projectId,
    createdAt: new Date().toISOString(),
    status: "running",
    split: plan.split,
    k: plan.k,
    scenarios: plan.scenarios,
    budgetUsd: plan.budgetUsd,
    costUsd: 0,
    items: [],
  });
  return id;
}

/** Subscribe to run progress. Backend: Server-Sent Events at /runs/{id}/events. */
export function subscribeRun(runId: string, onEvent: (e: RunEvent) => void): () => void {
  if (!MOCK) {
    // fetch instead of EventSource, so the stream can carry the sign-in header.
    const ctrl = new AbortController();
    (async () => {
      const res = await fetch(`${BASE}/api/v1/runs/${runId}/events`, { headers: await headers(), signal: ctrl.signal });
      if (!res.ok || !res.body) return;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) if (p.startsWith("data: ")) onEvent(JSON.parse(p.slice(6)));
      }
    })().catch(() => {});
    return () => ctrl.abort();
  }
  const run = liveRuns.get(runId);
  if (!run || run.status === "done") return () => {};
  const template = fx.runs.find((r) => r.projectId === run.projectId) ?? fx.runs[0];
  const pool = template.items;
  const total = run.scenarios;
  // Spend follows the plan estimate; the hard cap is enforced below.
  const perItemCost = (run.budgetUsd > 0 ? Math.min(run.budgetUsd, plan_est(run)) : 0) / Math.max(1, run.scenarios);
  let done = 0;
  const timer = setInterval(() => {
    const src = pool[done % pool.length];
    const item: RunItem = { ...src, id: `item-${String(done + 1).padStart(3, "0")}`, trials: src.trials.slice(0, run.k) };
    run.items.push(item);
    done++;
    run.costUsd = Number((done * perItemCost).toFixed(2));
    const failed = !item.trials.every(Boolean);
    const atCap = run.costUsd + perItemCost > run.budgetUsd;
    if (done >= total || atCap) {
      clearInterval(timer);
      const s = summarize(run.items.map((i) => i.trials), run.k);
      Object.assign(run, { status: atCap && done < total ? "stopped" : "done", scenarios: done, passK: s.passK, pass1: s.pass1 });
      onEvent({ type: "done", done, total, costUsd: run.costUsd });
    } else {
      onEvent({ type: failed ? "failure" : "progress", done, total, costUsd: run.costUsd, item });
    }
  }, 260);
  return () => clearInterval(timer);
}

// ---------- Labels, judges, gate ----------
export async function labelQueue(projectId: string): Promise<LabelTask[]> {
  if (!MOCK) return http(`/projects/${projectId}/label/next`);
  await wait();
  return fx.labelTasks(projectId);
}

export async function saveLabel(_taskId: string, _value: boolean | null, _note?: string): Promise<void> {
  if (!MOCK) {
    await http("/labels", { method: "POST", body: JSON.stringify({ task_id: _taskId, value: _value, note: _note }) });
    return;
  }
  await wait(80);
}

export async function listJudges(projectId: string): Promise<JudgeRow[]> {
  if (!MOCK) return http(`/projects/${projectId}/judges`);
  await wait();
  return fx.judges[projectId] ?? [];
}

export async function getGate(projectId: string): Promise<GateConfig> {
  if (!MOCK) return http(`/projects/${projectId}/gate`);
  await wait();
  return fx.gates[projectId] ?? { minPassK: 0.8, maxRegression: 0.03, requireTrusted: true, history: [] };
}

export async function saveGate(projectId: string, g: Omit<GateConfig, "history">): Promise<void> {
  if (!MOCK) {
    await http(`/projects/${projectId}/gate`, { method: "PUT", body: JSON.stringify(g) });
    return;
  }
  await wait(300);
  const cur = fx.gates[projectId];
  if (cur) Object.assign(cur, g);
}

// ---------- Accounts ----------
export async function currentSession(): Promise<Session> {
  const c = await authConfig();
  if (!c.enabled) return { enabled: false };
  if (!(await accessToken())) return { enabled: true, me: null };
  try {
    return { enabled: true, me: await http<Me>("/me") };
  } catch (e) {
    if (e instanceof Error && /sign in/i.test(e.message)) return { enabled: true, me: null };
    throw e;
  }
}

export const updateMe = (name: string) => http<Me>("/me", { method: "PATCH", body: JSON.stringify({ name }) });
export const createOrg = (name: string) => http<Me>("/orgs", { method: "POST", body: JSON.stringify({ name }) });
export const renameOrg = (name: string) => http<Me>("/org", { method: "PATCH", body: JSON.stringify({ name }) });
export const listTeam = () => http<{ members: Member[]; invites: Invite[] }>("/org/members");
export const createInvite = (email: string, role: OrgRole) =>
  http<Invite>("/org/invites", { method: "POST", body: JSON.stringify({ email, role }) });
export const revokeInvite = (id: string) => http<{ ok: true }>(`/org/invites/${id}`, { method: "DELETE" });
export const removeMember = (id: string) => http<{ ok: true }>(`/org/members/${id}`, { method: "DELETE" });
export const inviteInfo = (token: string) => http<InviteInfo>(`/invites/${encodeURIComponent(token)}`);
export const acceptInvite = (token: string) => http<Me>(`/invites/${encodeURIComponent(token)}/accept`, { method: "POST" });
export const inviteLink = (token: string) => `${window.location.origin}/invite/${token}`;
/** The organization's model keys, masked. Saving sends only the fields given; "" removes a key. */
export const orgKeys = () => http<OrgKeys>("/org/keys");
export const saveOrgKeys = (k: Partial<OrgKeys>) => http<OrgKeys>("/org/keys", { method: "PUT", body: JSON.stringify(k) });
export const setVisibility = (projectId: string, visibility: Visibility) =>
  http<Project>(`/projects/${projectId}/visibility`, { method: "PATCH", body: JSON.stringify({ visibility }) });

/** Re-reads the agent and compares it with the last saved version. Saves nothing. */
export async function agentStatus(projectId: string): Promise<AgentStatus | null> {
  if (MOCK) return null;
  return http(`/projects/${projectId}/agent-status`);
}

/** Start drafting scenarios and the rubric again after it was interrupted. */
export const redraft = (projectId: string) => http<Project>(`/projects/${projectId}/draft`, { method: "POST" });
