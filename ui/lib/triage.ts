import type { TriageKind } from "./types";

// Why a scenario failed. The knowledge base is the answer key, so a scope gap is never the agent's fault.
export const TRIAGE: Record<TriageKind, { label: string; body: string; tone: "warning" | "danger" | "neutral" | "primary" }> = {
  retrieval: { label: "Retrieval failure", body: "The right knowledge-base entry wasn't found.", tone: "neutral" },
  answer: { label: "Answer failure", body: "The right entry was found, but the answer didn't match it.", tone: "neutral" },
  scope_gap: { label: "Scope gap", body: "Your knowledge base has no answer. Add one; this isn't the agent's fault.", tone: "neutral" },
  behaviour: { label: "Behaviour", body: "Broke a rule from the prompt, like tone, length or a missing tool call.", tone: "neutral" },
};
