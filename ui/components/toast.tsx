"use client";

import { CheckCircle } from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type Toast = { id: number; text: string; action?: { label: string; run: () => void } };

/** One toast. Its timer pauses while hovered or focused, so an Undo button can't vanish under the cursor. */
function ToastItem({ t, onDone }: { t: Toast; onDone: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(t.action ? 8000 : 4200);
  useEffect(() => {
    if (paused) return;
    const start = Date.now();
    const timer = setTimeout(() => onDone(t.id), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - start;
    };
  }, [paused, onDone, t.id]);
  return (
    <div
      className="cr-toast rise min-w-[min(300px,calc(100vw-32px))]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <CheckCircle weight="fill" />
      <span>{t.text}</span>
      {t.action && (
        <button className="cr-btn cr-btn--ghost cr-btn--sm" onClick={t.action.run}>
          {t.action.label}
        </button>
      )}
    </div>
  );
}
const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId.current++;
    setToasts((all) => [...all, { ...t, id }]);
  }, []);
  const remove = useCallback((id: number) => setToasts((all) => all.filter((x) => x.id !== id)), []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-6 left-1/2 z-[60] grid -translate-x-1/2 gap-2"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} onDone={remove} />
        ))}
      </div>
    </Ctx.Provider>
  );
}
