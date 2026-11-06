// Domain types shared by every screen. The FastAPI backend will return these exact shapes.

export type HostKind = "n8n" | "retell" | "custom";
export type Split = "dev" | "test";
export type TriageKind = "retrieval" | "answer" | "scope_gap" | "behaviour";

export type PipelineStep = "connected" | "kb" | "data" | "rubric" | "judges" | "run" | "gate";

export interface Project {
  id: string;
  name: string;
  host: HostKind;
  agentName: string;
  createdAt: string;
  budgetUsd: number;
  pipeline: Record<PipelineStep, boolean>;
  latest?: {
    runId: string;
    split?: Split;
    passK: number;
    pass1: number;
    k: number;
    trusted: boolean;
    deltaPassK: number | null;
    at: string;
  };
  counts: { conversations: number; generated: number; criteria: number; kbDocs: number };
  /** True while the backend generates gap scenarios and drafts the rubric. */
  drafting?: boolean;
  /** Drafting stopped part way (the server restarted). The rubric page offers "Draft again". */
  draftInterrupted?: boolean;
  /** With accounts: "private" = only the owner sees it; "org" = everyone in their organization. */
  visibility?: Visibility;
  ownerId?: string;
  ownerName?: string;
  /** The signed-in person made this project (only they can change who sees it). */
  mine?: boolean;
}

export type Visibility = "private" | "org";

/** An organization's saved model keys, masked ("sk-or-…a1b2"); "" when not set. */
export interface OrgKeys {
  openrouter: string;
  typesafe: string;
}

export interface AgentTool {
  name: string;
  description: string;
}

export interface AgentInfo {
  name: string;
  model: string;
  prompt: string;
  tools: AgentTool[];
  memory: string | null;
  kbNodes: string[];
  /** fields: what an n8n Webhook reads from the request body ($json.body.X). */
  trigger: { kind: "webhook" | "chat" | null; url: string | null; fields?: string[] };
  /** Each agent and router in a multi-agent workflow. */
  parts?: AgentPart[];
}

export interface AgentPart {
  name: string;
  role: "agent" | "router";
  model: string | null;
  tools: string[];
  routes?: string[];
  promptChars: number;
}

export interface Criterion {
  id: string;
  text: string;
  kind: "check" | "judge";
  source: "prompt" | "kb" | "data";
  severity: "high" | "medium" | "low";
  status: "draft" | "approved";
  /** The situation it applies to, e.g. "the customer asks about returns". Null or absent: every conversation. */
  appliesWhen?: string | null;
  passExample: string;
  failExample: string;
}

export interface CriterionResult {
  criterionId: string;
  passRate: number;
  trusted: boolean;
  failures: number;
  /** Trials where the criterion applied. 0 means it never came up, so it wasn't tested. */
  applicable?: number;
}

export interface RunItem {
  id: string;
  scenario: string;
  source: "real" | "generated";
  trials: boolean[];
  failedCriteria: string[];
  triage: TriageKind | null;
}

export interface Run {
  id: string;
  projectId: string;
  createdAt: string;
  split: Split;
  k: number;
  scenarios: number;
  status: "queued" | "running" | "done" | "stopped";
  costUsd: number;
  budgetUsd: number;
  passK: number;
  pass1: number;
  ci: [number, number];
  trusted: boolean;
  perCriterion: CriterionResult[];
  triage: Record<TriageKind, number>;
  items: RunItem[];
  /** Agent version this run tested, and whether it changed since the previous run. */
  agentVersion?: number;
  agentChanged?: boolean;
  changeSummary?: string | null;
  agentReadError?: string;
  /** True while Hone writes recommendations after the run. */
  recommending?: boolean;
  recommendations?: string[];
  recommendationsSkipped?: string;
  /** Same agent and rubric as this earlier run, so its recommendations are reused. */
  recommendationsFrom?: string;
  /** The project's first run: nothing earlier to compare with. */
  firstRun?: boolean;
}

export interface Turn {
  role: "user" | "agent" | "tool";
  text: string;
  at?: string;
  tool?: { name: string; args: string };
  kb?: { table: string; doc: string };
  /** Short fields the agent returned next to this reply (e.g. status), which judges also see. */
  fields?: Record<string, string | number | boolean>;
}

export interface CheckResult {
  criterionId: string;
  trials: { pass: boolean; reason: string; na?: boolean }[];
}

export interface ItemDetail {
  item: RunItem;
  transcript: Turn[];
  /** One transcript per trial (real backend). */
  transcripts?: Turn[][];
  checks: CheckResult[];
  kb: { doc: string; retrieved: boolean | null; usedCorrectly: boolean | null }[];
}

export interface JudgeRow {
  criterionId: string;
  judge: string;
  labels: number;
  target: number;
  tpr: number | null;
  tnr: number | null;
  rawPass: number;
  corrected: number | null;
  ci: [number, number] | null;
  trusted: boolean;
}

export interface LabelTask {
  id: string;
  criterionId: string;
  question: string;
  transcript: Turn[];
  progress: { done: number; target: number; fails: number };
}

export interface GateConfig {
  minPassK: number;
  maxRegression: number;
  requireTrusted: boolean;
  history: { runId: string; at: string; passK: number; passed: boolean; reason: string }[];
}

export interface RunPlan {
  budgetUsd: number;
  scenarios: number;
  k: number;
  judgeModel: string;
  judgeCalls: number;
  agentCalls: number;
  estUsd: number;
  note: string;
}

export interface RunEvent {
  type: "progress" | "failure" | "done";
  done: number;
  total: number;
  costUsd: number;
  item?: RunItem;
}

/** One version of the agent as Hone saw it before a run. */
export interface AgentSnapshot {
  id: string;
  projectId: string;
  version: number;
  hash: string;
  createdAt: string;
  previousId: string | null;
  model: string | null;
  tools: string[];
  promptChars: number;
  changeSummary: string;
  diff: {
    first: boolean;
    model?: { from: string | null; to: string | null };
    prompt?: { added: number; removed: number; unified: string };
    toolsAdded?: string[];
    toolsRemoved?: string[];
    toolsChanged?: string[];
    kbAdded?: string[];
    kbRemoved?: string[];
    partsAdded?: string[];
    partsRemoved?: string[];
  };
}

export type RecStatus = "open" | "applied" | "dismissed";
export type RecOutcome = "improved" | "no_change" | "worse";

/** A change Hone recommended after a run, and what happened to it. */
export interface Recommendation {
  id: string;
  projectId: string;
  runId: string;
  agentVersion: number | null;
  split: Split;
  createdAt: string;
  title: string;
  change: string;
  target: string;
  why: string;
  criterionIds: string[];
  baseline: Record<string, number>;
  status: RecStatus;
  appliedVersion: number | null;
  applyConfidence: number | null;
  outcome: RecOutcome | null;
  measuredInRun: string | null;
  after: Record<string, number> | null;
  delta?: number;
}

export interface Health {
  ok: boolean;
  openrouter: boolean;
  typesafe: boolean;
  public: boolean;
  storage: { backend: "supabase" | "sqlite" | "memory"; persistent: boolean; ok: boolean; note: string | null };
  accounts?: boolean;
}

// ---------- Accounts ----------
export type OrgRole = "owner" | "member";

export interface Me {
  id: string;
  email: string;
  name: string;
  role: OrgRole | null;
  org: { id: string; name: string } | null;
}

/** null: accounts are off on this Hone (no Supabase, or demo mode). */
export type Session = { enabled: false } | { enabled: true; me: Me | null };

export interface Member {
  id: string;
  email: string;
  name: string;
  role: OrgRole;
  joinedAt: string;
}

export interface Invite {
  id: string;
  email: string;
  role: OrgRole;
  token: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

export interface InviteInfo {
  email: string;
  role: OrgRole;
  orgName: string;
  invitedBy: string;
  status: "open" | "used" | "expired";
}

/** Before a run: has the agent changed since the version Hone last saved? */
export interface AgentStatus {
  changed: boolean;
  version: number;
  previousVersion?: number | null;
  summary: string | null;
  readError: string | null;
  lastRun: { id: string; version: number | null; passK: number | null; split: Split; at: string } | null;
  openRecommendations: number;
}
