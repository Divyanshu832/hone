"""Fit scenarios x trials x judge calls inside a hard $ cap. Same logic as ui/lib/planner.ts."""

from __future__ import annotations

from dataclasses import dataclass

AGENT_TURN_USD = 0.0016  # one simulated turn: user-sim LLM + agent model
JUDGE_CALL_USD = 0.0009  # one binary judge call
AVG_TURNS = 6


@dataclass
class Plan:
    budget_usd: float
    scenarios: int
    k: int
    judge_model: str
    agent_calls: int
    judge_calls: int
    est_usd: float
    note: str


def plan_run(budget_usd: float, available: int, judge_criteria: int, preferred_k: int = 3,
             judge_model: str = "Jev (TypeSafe)") -> Plan:
    per_trial = AGENT_TURN_USD * AVG_TURNS + JUDGE_CALL_USD * judge_criteria
    ks = list(dict.fromkeys([preferred_k, 3, 2, 1]))
    for k in ks:
        max_scen = int(budget_usd // (per_trial * k))
        if max_scen >= min(available, 20) or k == 1:
            scen = max(0, min(available, max_scen))
            if scen == available:
                note = f"Covers all {available} scenarios, {k} times each."
            elif scen == 0:
                note = "This cap is too small for even one scenario. Raise it a little."
            else:
                note = f"Covers {scen} of {available} scenarios, {k} times each. The most important ones go first."
            return Plan(budget_usd, scen, k, judge_model, scen * k * AVG_TURNS, scen * k * judge_criteria,
                        round(scen * k * per_trial, 4), note)
    raise AssertionError("unreachable")
