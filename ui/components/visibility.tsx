"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LockSimple, UsersThree } from "@phosphor-icons/react";
import { setVisibility } from "@/lib/api";
import type { Project, Visibility } from "@/lib/types";
import { Badge } from "./ui";

/** Small label: who can see this project. Shown only when accounts are on. */
export function VisibilityBadge({ p }: { p: Project }) {
  if (!p.visibility) return null;
  if (p.visibility === "private")
    return (
      <Badge>
        <LockSimple aria-hidden /> Only you
      </Badge>
    );
  return (
    <Badge tone="primary">
      <UsersThree aria-hidden /> {p.mine ? "Shared with your organization" : `Shared by ${p.ownerName ?? "a teammate"}`}
    </Badge>
  );
}

/** The owner picks: only them, or everyone in their organization. */
export function VisibilitySwitch({ p }: { p: Project }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: Visibility) => setVisibility(p.id, v),
    onSuccess: (next) => {
      qc.setQueryData(["project", p.id], next);
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  if (!p.visibility) return null;
  if (!p.mine) return <VisibilityBadge p={p} />;
  const opts = [
    { v: "private" as const, label: "Only me", icon: LockSimple },
    { v: "org" as const, label: "My organization", icon: UsersThree },
  ];
  return (
    <div className="grid justify-items-end gap-1">
      <div className="cr-seg" role="group" aria-label="Who can see this project">
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            aria-pressed={p.visibility === o.v}
            aria-busy={m.isPending && m.variables === o.v}
            disabled={m.isPending}
            onClick={() => p.visibility !== o.v && m.mutate(o.v)}
            className="flex items-center gap-1.5 px-3"
          >
            <o.icon size={16} aria-hidden /> {o.label}
          </button>
        ))}
      </div>
      <span className="text-caption text-ink-2">
        {m.isError ? <span className="cr-error">{m.error.message}</span> : p.visibility === "org" ? "Everyone in your organization can see and run it." : "Nobody else can see it."}
      </span>
    </div>
  );
}
