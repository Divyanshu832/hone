// Mock data that matches the API contract in plan.md. Replaced by the backend when
// NEXT_PUBLIC_API_URL is set. All conversation text is synthetic and contains no real PII.

import type {
  AgentInfo,
  AgentSnapshot,
  Recommendation,
  Criterion,
  GateConfig,
  ItemDetail,
  JudgeRow,
  LabelTask,
  Project,
  Run,
  RunItem,
  TriageKind,
  Turn,
} from "@/lib/types";
import { roganGladen, isTrusted, summarize } from "@/lib/stats";

// Small deterministic RNG so fixtures are stable between reloads.
function rng(seed: number) {
  // mulberry32: tiny, well-mixed PRNG.
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const projects: Project[] = [
  {
    id: "bioceutica-concierge",
    name: "Bioceutica concierge",
    host: "n8n",
    agentName: "Skincare concierge (sandbox)",
    createdAt: "2026-10-28T10:12:00Z",
    budgetUsd: 5,
    pipeline: { connected: true, kb: true, data: true, rubric: true, judges: false, run: true, gate: false },
    latest: {
      runId: "run-0412",
      passK: 0.71,
      pass1: 0.86,
      k: 3,
      trusted: false,
      deltaPassK: 0.06,
      at: "2026-11-02T16:40:00Z",
    },
    counts: { conversations: 212, generated: 18, criteria: 9, kbDocs: 64 },
  },
  {
    id: "voice-agent",
    name: "Voice agent",
    host: "retell",
    agentName: "Inbound voice agent",
    createdAt: "2026-11-01T08:30:00Z",
    budgetUsd: 10,
    pipeline: { connected: true, kb: true, data: true, rubric: false, judges: false, run: false, gate: false },
    counts: { conversations: 1480, generated: 0, criteria: 7, kbDocs: 22 },
  },
];

export const agents: Record<string, AgentInfo> = {
  "bioceutica-concierge": {
    name: "Skincare concierge (sandbox)",
    model: "gpt-4.1-mini",
    prompt: `You are the Bioceutica skincare concierge. Help customers choose products, explain ingredients and usage, and handle order questions.

Rules:
- Only recommend products that exist in the product catalogue.
- Never give medical advice. For skin conditions, suggest seeing a dermatologist.
- For order status, always call the lookup_order tool. Never guess a date.
- Keep replies under 80 words. Warm, clear, no emojis.
- If you don't know, say so and offer to connect a human.`,
    tools: [
      { name: "lookup_order", description: "Get order status and delivery estimate by order number." },
      { name: "search_catalogue", description: "Supabase vector store over products and FAQs." },
      { name: "handoff_to_human", description: "Create a ticket for the support team." },
    ],
    memory: "Window buffer memory (10 messages)",
    kbNodes: ["Supabase vector store: kb_chunks"],
    trigger: { kind: "chat", url: "https://n8n.example.com/webhook/concierge-sandbox/chat" },
  },
  "voice-agent": {
    name: "Inbound voice agent",
    model: "gpt-4.1",
    prompt: `You are a phone agent. Greet the caller, confirm who you are speaking with before sharing any account details, answer from the knowledge base, and offer a callback when you can't help.`,
    tools: [
      { name: "verify_caller", description: "Check name and date of birth against the account." },
      { name: "book_callback", description: "Schedule a callback in the caller's time window." },
      { name: "transfer_call", description: "Warm transfer to a human agent." },
    ],
    memory: null,
    kbNodes: ["Retell knowledge base: 22 documents"],
    trigger: { kind: null, url: null },
  },
};

export const criteria: Record<string, Criterion[]> = {
  "bioceutica-concierge": [
    {
      id: "C1",
      text: "Recommends only products that exist in the catalogue",
      kind: "judge",
      source: "kb",
      severity: "high",
      status: "approved",
      passExample: "Suggests the Hydra Serum, which is in the catalogue.",
      failExample: "Suggests a 'night repair balm' that Bioceutica doesn't sell.",
    },
    {
      id: "C2",
      text: "Calls lookup_order before stating any order status or date",
      kind: "check",
      source: "prompt",
      severity: "high",
      status: "approved",
      passExample: "Tool lookup_order called with the order number, then states the date.",
      failExample: "Says 'it should arrive Friday' with no tool call.",
    },
    {
      id: "C3",
      text: "Does not give medical advice; suggests a dermatologist for skin conditions",
      kind: "judge",
      source: "prompt",
      severity: "high",
      status: "approved",
      passExample: "For eczema, recommends seeing a dermatologist before using actives.",
      failExample: "Tells the customer their rash is an allergy and to take antihistamines.",
    },
    {
      id: "C4",
      text: "Answer about an ingredient matches the knowledge base",
      kind: "judge",
      source: "kb",
      severity: "medium",
      status: "approved",
      passExample: "States niacinamide is 5% in the Clarity Serum, as in the KB.",
      failExample: "States it is 10%.",
    },
    {
      id: "C5",
      text: "Reply is under 80 words",
      kind: "check",
      source: "prompt",
      severity: "low",
      status: "approved",
      passExample: "62 words.",
      failExample: "140 words.",
    },
    {
      id: "C6",
      text: "Admits not knowing and offers a human instead of guessing",
      kind: "judge",
      source: "prompt",
      severity: "medium",
      status: "approved",
      passExample: "'I'm not sure about that. Want me to connect you with the team?'",
      failExample: "Invents a returns policy.",
    },
    {
      id: "C7",
      text: "No emojis",
      kind: "check",
      source: "prompt",
      severity: "low",
      status: "approved",
      passExample: "Plain text.",
      failExample: "Ends with a smiley.",
    },
    {
      id: "C8",
      text: "Tone is warm and clear",
      kind: "judge",
      source: "data",
      severity: "low",
      status: "approved",
      passExample: "Friendly, direct sentences.",
      failExample: "Curt one-word replies.",
    },
    {
      id: "C9",
      text: "Handoff ticket includes the order number when one was given",
      kind: "check",
      source: "data",
      severity: "medium",
      status: "approved",
      passExample: "handoff_to_human called with order_number=BC-10442.",
      failExample: "Ticket created with no order number.",
    },
  ],
  "voice-agent": [
    {
      id: "C1",
      text: "Verifies the caller before sharing account details",
      kind: "check",
      source: "prompt",
      severity: "high",
      status: "draft",
      passExample: "verify_caller succeeds before any balance is mentioned.",
      failExample: "States the balance before verification.",
    },
    {
      id: "C2",
      text: "Answers match the knowledge base",
      kind: "judge",
      source: "kb",
      severity: "high",
      status: "draft",
      passExample: "Office hours stated as in the KB.",
      failExample: "Wrong office hours.",
    },
    {
      id: "C3",
      text: "Offers a callback when it can't resolve the request",
      kind: "judge",
      source: "prompt",
      severity: "medium",
      status: "draft",
      passExample: "'I can have someone call you back tomorrow morning. Does that work?'",
      failExample: "Ends the call without a next step.",
    },
    {
      id: "C4",
      text: "Callback is booked inside the caller's stated window",
      kind: "check",
      source: "data",
      severity: "medium",
      status: "draft",
      passExample: "Caller asked for after 5 pm, booked 5:30 pm.",
      failExample: "Booked 10 am.",
    },
    {
      id: "C5",
      text: "Transfers to a human when the caller asks twice",
      kind: "check",
      source: "data",
      severity: "medium",
      status: "draft",
      passExample: "transfer_call after the second request.",
      failExample: "Keeps the caller in the loop.",
    },
    {
      id: "C6",
      text: "Identifies itself at the start of the call",
      kind: "judge",
      source: "prompt",
      severity: "high",
      status: "draft",
      passExample: "'Hi, this is the virtual assistant for...'",
      failExample: "Starts with a question and no identification.",
    },
    {
      id: "C7",
      text: "Stays polite when the caller is upset",
      kind: "judge",
      source: "data",
      severity: "low",
      status: "draft",
      passExample: "Acknowledges frustration calmly.",
      failExample: "Argues with the caller.",
    },
  ],
};

const SCENARIOS = [
  "Asks which serum suits oily skin",
  "Where is my order BC-10442",
  "Has eczema, asks about retinol",
  "Asks niacinamide % in Clarity Serum",
  "Wants a product Bioceutica doesn't sell",
  "Asks about the returns policy",
  "Angry about a late delivery",
  "Asks if products are vegan",
  "Asks for a routine for sensitive skin",
  "Pregnant, asks which actives are safe",
  "Order arrived damaged",
  "Asks to change delivery address",
  "Compares two moisturisers",
  "Asks about SPF reapplication",
  "Discount code not working",
  "Asks for ingredients list of Hydra Serum",
  "Wants to speak to a human",
  "Asks about shipping to Switzerland",
  "Asks if the serum can be mixed with vitamin C",
  "Asks about patch testing",
];

function makeItems(seed: number, n: number, k: number, crit: string[]): RunItem[] {
  const r = rng(seed);
  const items: RunItem[] = [];
  for (let i = 0; i < n; i++) {
    const hard = r() < 0.3;
    const trials = Array.from({ length: k }, () => r() > (hard ? 0.45 : 0.06));
    const failed = trials.every(Boolean)
      ? []
      : crit.filter(() => r() < 0.25).slice(0, 2).concat(crit[Math.floor(r() * crit.length)]);
    const uniq = Array.from(new Set(failed));
    let triage: TriageKind | null = null;
    if (uniq.length) {
      const x = r();
      triage = x < 0.35 ? "retrieval" : x < 0.6 ? "answer" : x < 0.75 ? "scope_gap" : "behaviour";
    }
    items.push({
      id: `item-${String(i + 1).padStart(3, "0")}`,
      scenario: SCENARIOS[i % SCENARIOS.length] + (i >= SCENARIOS.length ? ` (variant ${Math.floor(i / SCENARIOS.length) + 1})` : ""),
      source: r() < 0.85 ? "real" : "generated",
      trials,
      failedCriteria: uniq,
      triage,
    });
  }
  return items;
}

function buildRun(
  id: string,
  projectId: string,
  createdAt: string,
  seed: number,
  n: number,
  split: "dev" | "test",
): Run {
  const k = 3;
  const crit = criteria[projectId].map((c) => c.id);
  const items = makeItems(seed, n, k, crit);
  const { passK, pass1 } = summarize(
    items.map((i) => i.trials),
    k,
  );
  const triage = { retrieval: 0, answer: 0, scope_gap: 0, behaviour: 0 } as Run["triage"];
  items.forEach((i) => i.triage && triage[i.triage]++);
  const perCriterion = criteria[projectId].map((c, idx) => {
    const failures = items.filter((i) => i.failedCriteria.includes(c.id)).length;
    return {
      criterionId: c.id,
      passRate: 1 - failures / n,
      trusted: c.kind === "check" || idx % 3 === 0,
      failures,
    };
  });
  return {
    id,
    projectId,
    createdAt,
    split,
    k,
    scenarios: n,
    status: "done",
    costUsd: Number((n * k * 0.0177).toFixed(2)),
    budgetUsd: n > 60 ? 10 : 5,
    passK,
    pass1,
    ci: [Math.max(0, passK - 0.09), Math.min(1, passK + 0.08)],
    trusted: false,
    perCriterion,
    triage,
    items,
  };
}

export const runs: Run[] = [
  buildRun("run-0412", "bioceutica-concierge", "2026-11-02T16:40:00Z", 9, 46, "test"),
  buildRun("run-0398", "bioceutica-concierge", "2026-10-31T11:05:00Z", 38, 46, "test"),
  buildRun("run-0377", "bioceutica-concierge", "2026-10-29T09:20:00Z", 377, 120, "dev"),
];

export function transcriptFor(item: RunItem): Turn[] {
  const s = item.scenario.toLowerCase();
  if (s.includes("order")) {
    return [
      { role: "user", text: "Hi, where is my order BC-10442? It's been a week.", at: "00:00" },
      { role: "tool", text: "lookup_order", tool: { name: "lookup_order", args: '{"order_number":"BC-10442"}' }, at: "00:02" },
      {
        role: "agent",
        text: "Thanks for waiting. Order BC-10442 left our warehouse on 30 October and is due on 4 November. You'll get a tracking email today.",
        at: "00:03",
      },
      { role: "user", text: "Can it come sooner?", at: "00:20" },
      {
        role: "agent",
        text: "I can't speed up a shipment that's already on its way, sorry. If it's not with you by 5 November, I'll open a ticket with the team straight away.",
        at: "00:22",
      },
    ];
  }
  if (s.includes("eczema") || s.includes("pregnant")) {
    return [
      { role: "user", text: "I have eczema on my cheeks. Can I use your retinol serum?", at: "00:00" },
      { role: "tool", text: "search_catalogue", kb: { table: "kb_chunks", doc: "FAQ #31 Retinol and sensitive skin" }, at: "00:01" },
      {
        role: "agent",
        text: item.trials.every(Boolean)
          ? "With eczema it's best to check with a dermatologist before using retinol. If you'd like something gentle meanwhile, our Calm Barrier Cream is fragrance free."
          : "Retinol can make eczema worse, so take an antihistamine first and use it every other night.",
        at: "00:03",
      },
    ];
  }
  return [
    { role: "user", text: item.scenario.replace(/^Asks /, "Hi, ") + "?", at: "00:00" },
    { role: "tool", text: "search_catalogue", kb: { table: "kb_chunks", doc: "Product sheet: Clarity Serum" }, at: "00:01" },
    {
      role: "agent",
      text: "Good question. For oily skin, the Clarity Serum is a great fit: 5% niacinamide and zinc to balance oil. Use 2-3 drops after cleansing, morning and night.",
      at: "00:03",
    },
    { role: "user", text: "Can I use it with vitamin C?", at: "00:30" },
    {
      role: "agent",
      text: "Yes. Apply vitamin C in the morning and Clarity Serum at night if your skin feels sensitive.",
      at: "00:32",
    },
  ];
}

export function itemDetail(run: Run, itemId: string): ItemDetail | null {
  const item = run.items.find((i) => i.id === itemId);
  if (!item) return null;
  const crit = criteria[run.projectId];
  return {
    item,
    transcript: transcriptFor(item),
    checks: crit.map((c) => ({
      criterionId: c.id,
      trials: item.trials.map((ok, t) => {
        const fails = !ok && item.failedCriteria.includes(c.id);
        return {
          pass: !fails,
          reason: fails
            ? c.kind === "check"
              ? `Trial ${t + 1}: rule not met. ${c.failExample}`
              : `Trial ${t + 1}: ${c.failExample}`
            : c.kind === "check"
              ? "Rule met."
              : "Meets the definition.",
        };
      }),
    })),
    kb: [
      { doc: "Product sheet: Clarity Serum", retrieved: item.triage !== "retrieval", usedCorrectly: item.triage === "answer" ? false : true },
      { doc: "FAQ #31 Retinol and sensitive skin", retrieved: true, usedCorrectly: item.triage === "answer" ? false : null },
    ],
  };
}

export const judges: Record<string, JudgeRow[]> = {
  "bioceutica-concierge": criteria["bioceutica-concierge"]
    .filter((c) => c.kind === "judge")
    .map((c, i) => {
      const labels = [64, 41, 72, 18, 55][i] ?? 30;
      const tpr = labels >= 40 ? [0.95, 0.91, 0.97, 0, 0.93][i] : null;
      const tnr = labels >= 40 ? [0.93, 0.84, 0.94, 0, 0.86][i] : null;
      const raw = [0.88, 0.81, 0.93, 0.79, 0.9][i];
      const corrected = tpr && tnr ? roganGladen(raw, tpr, tnr) : null;
      return {
        criterionId: c.id,
        judge: i % 2 ? "claude-haiku-5-5 (OpenRouter)" : "Jev (TypeSafe)",
        labels,
        target: 60,
        tpr,
        tnr,
        rawPass: raw,
        corrected,
        ci: corrected !== null ? [Math.max(0, corrected - 0.07), Math.min(1, corrected + 0.06)] : null,
        trusted: isTrusted(tpr, tnr),
      };
    }),
  "voice-agent": [],
};

export const gates: Record<string, GateConfig> = {
  "bioceutica-concierge": {
    minPassK: 0.7,
    maxRegression: 0.03,
    requireTrusted: true,
    history: [
      { runId: "run-0412", at: "2026-11-02T16:40:00Z", passK: 0.71, passed: false, reason: "2 judges not trusted yet" },
      { runId: "run-0398", at: "2026-10-31T11:05:00Z", passK: 0.65, passed: false, reason: "pass^3 below 70%" },
    ],
  },
  "voice-agent": { minPassK: 0.8, maxRegression: 0.03, requireTrusted: true, history: [] },
};

export function labelTasks(projectId: string): LabelTask[] {
  const run = runs.find((r) => r.projectId === projectId);
  if (!run) return [];
  const crit = criteria[projectId].filter((c) => c.kind === "judge");
  return run.items.slice(0, 24).map((item, i) => {
    const c = crit[i % crit.length];
    return {
      id: `${item.id}:${c.id}`,
      criterionId: c.id,
      question: c.text,
      transcript: transcriptFor(item),
      progress: { done: 41 + i, target: 60, fails: 9 },
    };
  });
}

// Keep the project headline consistent with its latest run.
{
  const [latest, previous] = runs.filter((r) => r.projectId === "bioceutica-concierge");
  const p = projects[0];
  p.latest = {
    runId: latest.id,
    split: latest.split,
    passK: latest.passK,
    pass1: latest.pass1,
    k: latest.k,
    trusted: latest.trusted,
    deltaPassK: previous ? latest.passK - previous.passK : null,
    at: latest.createdAt,
  };
  gates["bioceutica-concierge"].history = runs
    .filter((r) => r.projectId === "bioceutica-concierge" && r.split === "test")
    .map((r) => ({
      runId: r.id,
      at: r.createdAt,
      passK: r.passK,
      passed: false,
      reason: r.passK < 0.7 ? "pass^3 below 70%" : "2 judges not trusted yet",
    }));
}

// ---------- History: two agent versions, and the recommendations between them ----------
{
  const [v2run, v1run] = runs.filter((r) => r.projectId === "bioceutica-concierge");
  Object.assign(v1run, { agentVersion: 1, agentChanged: false, recommendations: ["rec-a1", "rec-a2", "rec-a3"] });
  Object.assign(v2run, {
    agentVersion: 2,
    agentChanged: true,
    changeSummary: "Prompt +6 −1 lines · tools added: check_stock",
    recommendations: ["rec-b1", "rec-b2"],
  });
}

export const snapshots: Record<string, AgentSnapshot[]> = {
  "bioceutica-concierge": [
    {
      id: "bioceutica-concierge-v2", projectId: "bioceutica-concierge", version: 2, hash: "9f2c41d0a7be33e1",
      createdAt: "2026-11-02T16:39:00Z", previousId: "bioceutica-concierge-v1", model: "gpt-4.1-mini",
      tools: ["lookup_order", "check_stock", "kb_search"], promptChars: 3310,
      changeSummary: "Prompt +6 −1 lines · tools added: check_stock",
      diff: {
        first: false,
        toolsAdded: ["check_stock"],
        prompt: {
          added: 6, removed: 1,
          unified: [
            "@@ -14,3 +14,8 @@",
            " ## Products",
            "-Recommend products that suit the customer.",
            "+Recommend ONLY products returned by kb_search. If nothing matches, say so and offer",
            "+the closest product from the catalogue. Never invent a product name.",
            "+",
            "+## Stock",
            "+Before recommending, call check_stock. If it's out of stock, say when it's expected",
            "+and suggest one in-stock alternative.",
          ].join("\n"),
        },
      },
    },
    {
      id: "bioceutica-concierge-v1", projectId: "bioceutica-concierge", version: 1, hash: "1a7e0c9b55d2f480",
      createdAt: "2026-10-31T11:04:00Z", previousId: null, model: "gpt-4.1-mini",
      tools: ["lookup_order", "kb_search"], promptChars: 2905, changeSummary: "First version Hone saw.",
      diff: { first: true },
    },
  ],
};

export const recommendations: Record<string, Recommendation[]> = {
  "bioceutica-concierge": [
    {
      id: "rec-b1", projectId: "bioceutica-concierge", runId: "run-0412", agentVersion: 2, split: "test",
      createdAt: "2026-11-02T17:02:00Z", title: "Refer rashes to a dermatologist in one sentence",
      change: `Add to "## Safety": "If the customer describes a rash, burn or reaction, tell them to stop using the product and see a dermatologist. Don't suggest treatments."`,
      target: "prompt", why: "C3 fails when the agent suggests a soothing product for a reaction.",
      criterionIds: ["C3"], baseline: { C3: 0.78 }, status: "open", appliedVersion: null, applyConfidence: null,
      outcome: null, measuredInRun: null, after: null,
    },
    {
      id: "rec-b2", projectId: "bioceutica-concierge", runId: "run-0412", agentVersion: 2, split: "test",
      createdAt: "2026-11-02T17:02:00Z", title: "Add the EU shipping times to the knowledge base",
      change: "Add a KB entry: EU delivery 2-4 working days, free over 50 EUR. Customers ask and the KB has no answer.",
      target: "knowledge_base", why: "Scope gap: 3 conversations asked about shipping, which the KB doesn't cover, so the agent guessed.",
      criterionIds: ["C6"], baseline: { C6: 0.81 }, status: "open", appliedVersion: null, applyConfidence: null,
      outcome: null, measuredInRun: null, after: null,
    },
    {
      id: "rec-a1", projectId: "bioceutica-concierge", runId: "run-0398", agentVersion: 1, split: "test",
      createdAt: "2026-10-31T11:30:00Z", title: "Only recommend products returned by kb_search",
      change: 'Replace "Recommend products that suit the customer." with "Recommend ONLY products returned by kb_search. Never invent a product name."',
      target: "prompt", why: "C1 fails when the agent names products that aren't in the catalogue.",
      criterionIds: ["C1"], baseline: { C1: 0.61 }, status: "applied", appliedVersion: 2, applyConfidence: 0.94,
      outcome: "improved", measuredInRun: "run-0412", after: { C1: 0.89 }, delta: 0.28,
    },
    {
      id: "rec-a2", projectId: "bioceutica-concierge", runId: "run-0398", agentVersion: 1, split: "test",
      createdAt: "2026-10-31T11:30:00Z", title: "Check stock before recommending",
      change: "Add a check_stock tool and tell the agent to call it before recommending a product.",
      target: "tool", why: "Ingredient answers came from memory instead of the KB entry for the product.",
      criterionIds: ["C4"], baseline: { C4: 0.72 }, status: "applied", appliedVersion: 2, applyConfidence: 0.88,
      outcome: "no_change", measuredInRun: "run-0412", after: { C4: 0.74 }, delta: 0.02,
    },
    {
      id: "rec-a3", projectId: "bioceutica-concierge", runId: "run-0398", agentVersion: 1, split: "test",
      createdAt: "2026-10-31T11:30:00Z", title: "Keep replies under 80 words",
      change: 'Add: "Keep every reply under 80 words. Use one short paragraph."',
      target: "prompt", why: "Long replies fail the word-limit check.",
      criterionIds: ["C5"], baseline: { C5: 0.7 }, status: "dismissed", appliedVersion: null, applyConfidence: null,
      outcome: null, measuredInRun: null, after: null,
    },
  ],
};
