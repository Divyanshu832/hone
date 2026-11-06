// CSV ingest: guess the column mapping, group messages into conversations, decide if the data is
// enough. Runs in the browser for an instant preview; the backend repeats it (plus PII redaction)
// on upload.

import Papa from "papaparse";

export type GroupKind = "conversation" | "customer";

export interface Mapping {
  groupBy: string;
  groupKind: GroupKind;
  role: string;
  content: string;
  createdAt: string | null;
}

export interface ParsedCsv {
  columns: string[];
  rows: Record<string, string>[];
}

export function parseCsv(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (r) => {
        const columns = r.meta.fields ?? [];
        if (columns.length < 2) reject(new Error("This file needs a header row with at least two columns."));
        else resolve({ columns, rows: r.data });
      },
      error: (e) => reject(e),
    });
  });
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

const CANDIDATES = {
  conversation: ["conversationid", "conversation", "convid", "threadid", "sessionid", "callid", "chatid", "ticketid"],
  customer: ["customerid", "customer", "userid", "contactid", "phone", "clientid", "leadid"],
  role: ["role", "sender", "speaker", "from", "author", "who", "type", "direction"],
  content: ["content", "message", "text", "body", "utterance", "transcript", "msg"],
  createdAt: ["createdat", "timestamp", "time", "date", "datetime", "sentat", "created"],
};

function find(columns: string[], names: string[]) {
  return columns.find((c) => names.includes(norm(c))) ?? columns.find((c) => names.some((n) => norm(c).includes(n)));
}

/** Hone's best guess at which column is which. */
export function guessMapping(columns: string[], rows: Record<string, string>[]): Mapping {
  const conv = find(columns, CANDIDATES.conversation);
  const cust = find(columns, CANDIDATES.customer);
  const role = find(columns, CANDIDATES.role) ?? columns[1];
  let content = find(columns, CANDIDATES.content);
  if (!content) {
    // Fall back to the column with the longest average text.
    content = [...columns].sort((a, b) => avgLen(rows, b) - avgLen(rows, a))[0];
  }
  const groupBy = conv ?? cust ?? columns[0];
  return {
    groupBy,
    groupKind: conv ? "conversation" : cust ? "customer" : "conversation",
    role,
    content,
    createdAt: find(columns, CANDIDATES.createdAt) ?? null,
  };
}

function avgLen(rows: Record<string, string>[], col: string) {
  const sample = rows.slice(0, 50);
  return sample.reduce((s, r) => s + (r[col]?.length ?? 0), 0) / Math.max(1, sample.length);
}

const AGENT_WORDS = ["agent", "bot", "ai", "assistant", "system", "outbound", "model", "outgoing"];
export function normaliseRole(v: string | undefined): "user" | "agent" {
  const x = (v ?? "").toLowerCase().trim();
  return AGENT_WORDS.some((w) => x === w || x.startsWith(w)) ? "agent" : "user";
}

export interface Conversation {
  id: string;
  messages: { role: "user" | "agent"; content: string; at: string | null }[];
}

export function group(rows: Record<string, string>[], m: Mapping): Conversation[] {
  const by = new Map<string, Conversation>();
  for (const r of rows) {
    const id = (r[m.groupBy] ?? "").trim();
    const content = (r[m.content] ?? "").trim();
    if (!id || !content) continue;
    if (!by.has(id)) by.set(id, { id, messages: [] });
    by.get(id)!.messages.push({ role: normaliseRole(r[m.role]), content, at: m.createdAt ? r[m.createdAt] ?? null : null });
  }
  const list = [...by.values()];
  if (m.createdAt) {
    for (const c of list) c.messages.sort((a, b) => Date.parse(a.at ?? "") - Date.parse(b.at ?? "") || 0);
  }
  return list;
}

export interface Sufficiency {
  conversations: number;
  usable: number;
  decision: "enough" | "fill_gaps" | "mostly_generated";
  generate: number;
  dev: number;
  test: number;
  sentence: string;
}

/** Thresholds: 100+ usable conversations is enough; 20-99 fill gaps; below 20 mostly generated. */
export function sufficiency(convs: Conversation[], targetScenarios = 100): Sufficiency {
  const usable = convs.filter((c) => c.messages.length >= 2 && c.messages.some((m) => m.role === "agent")).length;
  const generate = Math.max(0, targetScenarios - usable);
  const decision = usable >= targetScenarios ? "enough" : usable >= 20 ? "fill_gaps" : "mostly_generated";
  const total = usable + generate;
  const test = Math.round(total * 0.2);
  const sentence =
    decision === "enough"
      ? `You have ${usable} usable conversations. That's enough, so I won't generate any.`
      : decision === "fill_gaps"
        ? `You have ${usable} usable conversations. I'll generate ${generate} more to cover the gaps, using yours as the reference.`
        : usable === 0
          ? `No usable conversations yet, so I'll generate ${generate} from the agent's prompt and knowledge base.`
          : `You have ${usable} usable conversations. I'll generate ${generate}, styled on yours and grounded in your knowledge base.`;
  return { conversations: convs.length, usable, decision, generate, dev: total - test, test, sentence };
}
