"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createInvite, inviteLink, listTeam, removeMember, renameOrg, revokeInvite, updateMe } from "@/lib/api";
import { signOut } from "@/lib/auth";
import type { Me, OrgRole } from "@/lib/types";
import { Badge, cx, timeAgo } from "./ui";
import { useToast } from "./toast";

function InlineEdit({ label, value, save }: { label: string; value: string; save: (v: string) => Promise<unknown> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const m = useMutation({ mutationFn: save, onSuccess: () => setDraft(null) });
  if (draft === null)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <span className="cr-label">{label}</span>
          <span className="text-body-sm text-ink">{value || <span className="text-ink-2">Not set</span>}</span>
        </div>
        <button type="button" className="cr-btn cr-btn--ghost cr-btn--sm" onClick={() => setDraft(value)}>
          Change
        </button>
      </div>
    );
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate(draft);
      }}
    >
      <label className="cr-field">
        <span className="cr-label">{label}</span>
        <input className="cr-input" autoFocus maxLength={80} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button className="cr-btn cr-btn--primary cr-btn--sm" aria-busy={m.isPending} disabled={!draft.trim()}>
          Save
        </button>
        <button type="button" className="cr-btn cr-btn--ghost cr-btn--sm" onClick={() => setDraft(null)}>
          Cancel
        </button>
      </div>
      {m.isError && <span className="cr-error" role="alert">{m.error.message}</span>}
    </form>
  );
}

export function AccountCard({ me }: { me: Me }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["session"] });
  return (
    <div className="cr-card grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-body weight-bold">Your account</h2>
        <button type="button" className="cr-btn cr-btn--ghost cr-btn--sm" onClick={() => signOut()}>
          Log out
        </button>
      </div>
      <InlineEdit label="Name" value={me.name} save={(v) => updateMe(v).then(refresh)} />
      <div className="grid gap-0.5">
        <span className="cr-label">Email</span>
        <span className="text-body-sm text-ink">{me.email}</span>
      </div>
    </div>
  );
}

export function TeamCard({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const owner = me.role === "owner";
  const team = useQuery({ queryKey: ["team"], queryFn: listTeam });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const refresh = () => qc.invalidateQueries({ queryKey: ["team"] });

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      toast({ text: "Invite link copied. Send it to them yourself; Hone doesn't email it." });
    } catch {
      toast({ text: inviteLink(token) });
    }
  }

  const invite = useMutation({
    mutationFn: () => createInvite(email, role),
    onSuccess: (inv) => {
      setEmail("");
      setRole("member");
      refresh();
      copy(inv.token);
    },
  });
  const revoke = useMutation({ mutationFn: revokeInvite, onSuccess: refresh });
  const remove = useMutation({ mutationFn: removeMember, onSuccess: refresh });

  return (
    <div className="cr-card grid gap-5">
      <h2 className="text-body weight-bold">Organization</h2>
      {owner ? (
        <InlineEdit label="Name" value={me.org!.name} save={(v) => renameOrg(v).then(() => qc.invalidateQueries({ queryKey: ["session"] }))} />
      ) : (
        <div className="grid gap-0.5">
          <span className="cr-label">Name</span>
          <span className="text-body-sm text-ink">{me.org!.name}</span>
        </div>
      )}

      <div className="grid gap-2">
        <h3 className="cr-overline">People</h3>
        {team.isPending && <div className="cr-skeleton h-[96px] rounded-card" />}
        {team.isError && <span className="cr-error" role="alert">{team.error.message}</span>}
        {team.data && (
          <ul className="rounded-card border border-line">
            {team.data.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
                <span className="cr-avatar" aria-hidden>
                  {(m.name || m.email).slice(0, 1).toUpperCase()}
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-body-sm text-ink">
                    {m.name || m.email}
                    {m.id === me.id && <span className="text-ink-2"> (you)</span>}
                  </span>
                  <span className="truncate text-caption text-ink-2">{m.email}</span>
                </span>
                <Badge tone={m.role === "owner" ? "primary" : "neutral"}>{m.role === "owner" ? "Owner" : "Member"}</Badge>
                {owner && m.id !== me.id && (
                  <button
                    type="button"
                    className="cr-btn cr-btn--ghost cr-btn--sm"
                    aria-busy={remove.isPending && remove.variables === m.id}
                    onClick={() => remove.mutate(m.id)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
            {team.data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
                <span className="cr-avatar opacity-50" aria-hidden>
                  {i.email.slice(0, 1).toUpperCase()}
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-body-sm text-ink">{i.email}</span>
                  <span className={cx("text-caption", i.expired ? "text-danger-ink" : "text-ink-2")}>
                    {i.expired ? "Invite expired" : `Invited ${timeAgo(i.createdAt)}, not joined yet`}
                  </span>
                </span>
                <Badge tone="warning">{i.role === "owner" ? "Owner" : "Member"}, invited</Badge>
                {!i.expired && (
                  <button type="button" className="cr-btn cr-btn--secondary cr-btn--sm" onClick={() => copy(i.token)}>
                    Copy link
                  </button>
                )}
                <button
                  type="button"
                  className="cr-btn cr-btn--ghost cr-btn--sm"
                  aria-busy={revoke.isPending && revoke.variables === i.id}
                  onClick={() => revoke.mutate(i.id)}
                >
                  {i.expired ? "Remove" : "Cancel invite"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {owner && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          <h3 className="cr-overline">Invite someone</h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <label className="cr-field">
              <span className="cr-label">Email</span>
              <input className="cr-input" type="email" required placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="cr-field">
              <span className="cr-label">Role</span>
              <select className="cr-select" value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </select>
            </label>
            <button className="cr-btn cr-btn--primary" aria-busy={invite.isPending}>
              Create invite link
            </button>
          </div>
          <p className="cr-help">
            You get a link to send them. They set their name and password and join. Links last 7 days. Owners can invite and
            remove people; members can do everything else.
          </p>
          {invite.isError && <span className="cr-error" role="alert">{invite.error.message}</span>}
        </form>
      )}
    </div>
  );
}
