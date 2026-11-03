// Budget planner: fit scenarios x trials x judges inside a hard $ cap.
// Same logic will live in backend/runner/planner.py; costs here are estimates per call.

import type { RunPlan } from "./types";

export const COST = {
  agentTurn: 0.0016, // one simulated turn against the agent (user-sim LLM + agent model)
  judgeCall: 0.0009, // one binary judge call (Jev or a small model via OpenRouter)
  avgTurns: 6,
};

export function planRun(opts: {
  budgetUsd: number;
  available: number; // scenarios in the chosen split
  judgeCriteria: number; // criteria graded by an LLM judge (code checks are free)
  preferredK?: number;
}): RunPlan {
  const { budgetUsd, available, judgeCriteria } = opts;
  const perTrial = COST.agentTurn * COST.avgTurns + COST.judgeCall * judgeCriteria;
  const kOptions = [opts.preferredK ?? 3, 3, 2, 1].filter((v, i, a) => a.indexOf(v) === i);

  for (const k of kOptions) {
    const maxScenarios = Math.floor(budgetUsd / (perTrial * k));
    if (maxScenarios >= Math.min(available, 20) || k === 1) {
      const scenarios = Math.max(0, Math.min(available, maxScenarios));
      const estUsd = scenarios * k * perTrial;
      const note =
        scenarios === available
          ? `Covers all ${available} scenarios, ${k} times each.`
          : scenarios === 0
            ? "This cap is too small for even one scenario. Raise it a little."
            : `Covers ${scenarios} of ${available} scenarios, ${k} times each. The most important ones go first.`;
      return {
        budgetUsd,
        scenarios,
        k,
        judgeModel: "Jev (TypeSafe)",
        agentCalls: scenarios * k * COST.avgTurns,
        judgeCalls: scenarios * k * judgeCriteria,
        estUsd,
        note,
      };
    }
  }
  throw new Error("unreachable");
}
