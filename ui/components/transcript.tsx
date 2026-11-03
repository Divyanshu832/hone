import { BookOpen, Wrench } from "@phosphor-icons/react/dist/ssr";
import type { Turn } from "@/lib/types";
import { cx } from "./ui";

/** Redacted conversation: user left, agent right, tool calls and KB lookups as inline chips. */
export function Transcript({ turns }: { turns: Turn[] }) {
  return (
    <ol className="grid gap-3">
      {turns.map((t, i) =>
        t.role === "tool" ? (
          <li key={i} className="flex justify-center">
            <span className="inline-flex max-w-full items-center gap-2 rounded-pill border border-line bg-surface px-3 py-1 text-caption text-ink-2">
              {t.kb ? <BookOpen size={14} /> : <Wrench size={14} />}
              {t.kb ? (
                <>
                  searched <span className="num">{t.kb.table}</span> → {t.kb.doc}
                </>
              ) : (
                <>
                  called <span className="num">{t.tool?.name}</span>
                  <span className="num truncate text-ink-2">{t.tool?.args}</span>
                </>
              )}
            </span>
          </li>
        ) : (
          <li key={i} className={cx("flex flex-col gap-1", t.role === "agent" ? "items-end" : "items-start")}>
            <span className="text-caption text-ink-2">
              {t.role === "agent" ? "Agent" : "Customer"}
              {t.at && <span className="num ml-2">{t.at}</span>}
            </span>
            <div className={cx("bubble", t.role === "agent" ? "bubble--agent" : "bubble--user")}>{t.text}</div>
          </li>
        ),
      )}
    </ol>
  );
}
