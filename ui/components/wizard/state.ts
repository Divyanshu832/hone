import type { AgentInfo, HostKind } from "@/lib/types";
import type { ConnectResult } from "@/lib/api";
import type { Mapping, Sufficiency } from "@/lib/csv";

export const STEPS = [
  { key: "host", label: "Where it lives" },
  { key: "connect", label: "Connect" },
  { key: "found", label: "What I found" },
  { key: "kb", label: "Knowledge base" },
  { key: "data", label: "Real conversations" },
  { key: "budget", label: "Budget" },
  { key: "ready", label: "Ready" },
] as const;

export type KbMode = "paste" | "files" | "supabase" | "retell" | "skip";
export type DataMode = "csv" | "import" | "none";

export interface WizardState {
  step: number;
  maxStep: number;
  host: HostKind | null;
  n8n: { baseUrl: string; apiKey: string; sandboxUrl: string; webhookFields: Record<string, string> };
  retell: { apiKey: string; agentId: string };
  custom: { endpointUrl: string; format: "openai" | "simple"; files: { name: string; text: string; size: number }[] };
  connection: ConnectResult | null;
  agent: AgentInfo | null;
  kb: {
    mode: KbMode | null;
    text: string;
    files: { name: string; size: number; text: string }[];
    supabase: { url: string; key: string; table: string | null };
    docs: number;
  };
  data: {
    mode: DataMode | null;
    csv: { fileName: string; columns: string[]; rows: Record<string, string>[]; mapping: Mapping; confirmed: boolean } | null;
    imported: { conversations: number; messages: number; from: string; to: string } | null;
    suff: Sufficiency | null;
  };
  budgetUsd: number;
  name: string;
}

export const initialState: WizardState = {
  step: 0,
  maxStep: 0,
  host: null,
  n8n: { baseUrl: "", apiKey: "", sandboxUrl: "", webhookFields: {} },
  retell: { apiKey: "", agentId: "" },
  custom: { endpointUrl: "", format: "openai", files: [] },
  connection: null,
  agent: null,
  kb: { mode: null, text: "", files: [], supabase: { url: "", key: "", table: null }, docs: 0 },
  data: { mode: null, csv: null, imported: null, suff: null },
  budgetUsd: 5,
  name: "",
};

export type Action =
  | { type: "go"; step: number }
  | { type: "next" }
  | { type: "back" }
  | { type: "patch"; patch: Partial<WizardState> }
  | { type: "kb"; patch: Partial<WizardState["kb"]> }
  | { type: "data"; patch: Partial<WizardState["data"]> };

export function reducer(s: WizardState, a: Action): WizardState {
  switch (a.type) {
    case "go":
      return a.step <= s.maxStep ? { ...s, step: a.step } : s;
    case "next": {
      const step = Math.min(STEPS.length - 1, s.step + 1);
      return { ...s, step, maxStep: Math.max(s.maxStep, step) };
    }
    case "back":
      return { ...s, step: Math.max(0, s.step - 1) };
    case "patch":
      return { ...s, ...a.patch };
    case "kb":
      return { ...s, kb: { ...s.kb, ...a.patch } };
    case "data":
      return { ...s, data: { ...s.data, ...a.patch } };
  }
}

export interface StepProps {
  s: WizardState;
  d: React.Dispatch<Action>;
}

export function connectInput(s: WizardState) {
  return {
    host: s.host!,
    format: s.custom.format,
    baseUrl: s.n8n.baseUrl,
    apiKey: s.host === "retell" ? s.retell.apiKey : s.n8n.apiKey,
    sandboxUrl: s.n8n.sandboxUrl,
    endpointUrl: s.custom.endpointUrl,
    agentRef: s.retell.agentId,
    files: s.custom.files.map((f) => ({ name: f.name, text: f.text })),
    webhookFields: s.n8n.webhookFields,
  };
}
