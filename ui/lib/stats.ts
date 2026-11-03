// Eval statistics. Mirrors backend/calibrate so the UI can explain numbers the same way.

/** n choose k, as a float. */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** τ-bench pass^k estimator for one scenario: c passes out of n trials. */
export function passHatK(c: number, n: number, k: number): number {
  if (n < k) return c === n ? 1 : 0;
  return choose(c, k) / choose(n, k);
}

/** Mean pass^k and pass@1 across scenarios, each a list of trial outcomes. */
export function summarize(trialsPerScenario: boolean[][], k: number) {
  if (trialsPerScenario.length === 0) return { passK: 0, pass1: 0 };
  let pk = 0;
  let p1 = 0;
  for (const t of trialsPerScenario) {
    const c = t.filter(Boolean).length;
    pk += passHatK(c, t.length, k);
    p1 += c / t.length;
  }
  return { passK: pk / trialsPerScenario.length, pass1: p1 / trialsPerScenario.length };
}

/**
 * Rogan-Gladen correction: the true pass rate given what the judge observed and how often the
 * judge is right on passes (TPR) and on failures (TNR). Clamped to [0, 1].
 */
export function roganGladen(observed: number, tpr: number, tnr: number): number | null {
  const denom = tpr + tnr - 1;
  if (denom <= 0) return null; // judge no better than chance
  return Math.min(1, Math.max(0, (observed + tnr - 1) / denom));
}

/** Trust bar for a judge: both rates must clear it. */
export const TRUST_BAR = 0.9;
export function isTrusted(tpr: number | null, tnr: number | null) {
  return tpr !== null && tnr !== null && tpr >= TRUST_BAR && tnr >= TRUST_BAR;
}

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export const usd = (x: number) => `$${x.toFixed(2)}`;
