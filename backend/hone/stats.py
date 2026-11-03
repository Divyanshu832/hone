"""Eval statistics: pass^k, judge calibration, corrected pass rate with a bootstrap range.

Mirrors ui/lib/stats.ts so the UI and backend explain numbers the same way.
"""

from __future__ import annotations

import random
from math import comb

TRUST_BAR = 0.9


def pass_hat_k(c: int, n: int, k: int) -> float:
    """τ-bench estimator: probability that k trials drawn from n (c passed) all pass."""
    if n < k:
        return 1.0 if c == n else 0.0
    return comb(c, k) / comb(n, k)


def summarize(trials: list[list[bool]], k: int) -> tuple[float, float]:
    """Mean pass^k and pass@1 across scenarios."""
    if not trials:
        return 0.0, 0.0
    pk = sum(pass_hat_k(sum(t), len(t), k) for t in trials) / len(trials)
    p1 = sum(sum(t) / len(t) for t in trials) / len(trials)
    return pk, p1


def bootstrap_ci(trials: list[list[bool]], k: int, iters: int = 1000, seed: int = 0) -> tuple[float, float]:
    """95% range for pass^k by resampling scenarios."""
    if not trials:
        return 0.0, 0.0
    rnd = random.Random(seed)
    vals = []
    for _ in range(iters):
        sample = [trials[rnd.randrange(len(trials))] for _ in trials]
        vals.append(summarize(sample, k)[0])
    vals.sort()
    return vals[int(0.025 * iters)], vals[int(0.975 * iters) - 1]


def judge_rates(pairs: list[tuple[bool, bool]]) -> tuple[float | None, float | None]:
    """TPR and TNR of a judge from (human, judge) label pairs. Pass = True."""
    pos = [j for h, j in pairs if h]
    neg = [j for h, j in pairs if not h]
    tpr = sum(pos) / len(pos) if pos else None
    tnr = sum(not j for j in neg) / len(neg) if neg else None
    return tpr, tnr


def rogan_gladen(observed: float, tpr: float, tnr: float) -> float | None:
    """True pass rate given the judge's observed rate and its error rates. None if judge ≈ chance."""
    denom = tpr + tnr - 1
    if denom <= 0:
        return None
    return min(1.0, max(0.0, (observed + tnr - 1) / denom))


def corrected_with_ci(
    pairs: list[tuple[bool, bool]], judge_passes: list[bool], iters: int = 1000, seed: int = 0
) -> tuple[float | None, tuple[float, float] | None]:
    """Corrected pass rate on unlabeled judge outputs, with uncertainty from both label and test sets
    (the approach in Shankar & Husain's `judgy`)."""
    tpr, tnr = judge_rates(pairs)
    if tpr is None or tnr is None or not judge_passes:
        return None, None
    observed = sum(judge_passes) / len(judge_passes)
    point = rogan_gladen(observed, tpr, tnr)
    rnd = random.Random(seed)
    vals = []
    for _ in range(iters):
        lp = [pairs[rnd.randrange(len(pairs))] for _ in pairs]
        jp = [judge_passes[rnd.randrange(len(judge_passes))] for _ in judge_passes]
        t, n = judge_rates(lp)
        if t is None or n is None:
            continue
        v = rogan_gladen(sum(jp) / len(jp), t, n)
        if v is not None:
            vals.append(v)
    if not vals:
        return point, None
    vals.sort()
    return point, (vals[int(0.025 * len(vals))], vals[max(0, int(0.975 * len(vals)) - 1)])


def is_trusted(tpr: float | None, tnr: float | None) -> bool:
    return tpr is not None and tnr is not None and tpr >= TRUST_BAR and tnr >= TRUST_BAR
