"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { acceptInvite, inviteInfo } from "@/lib/api";
import { authMessage, signOut, supa } from "@/lib/auth";
import { useSession } from "@/components/auth-gate";
import { Field, FormError, MIN_PASSWORD, missing, passwordProblem } from "@/components/auth-forms";
import type { InviteInfo } from "@/lib/types";

/** Open an invite link: set a name and password (or log in) and join the organization. */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const info = useQuery({ queryKey: ["invite", token], queryFn: () => inviteInfo(token), retry: false });
  const s = useSession();

  if (info.isPending || s.isPending) return <div className="cr-skeleton h-[380px] rounded-card" />;
  if (info.isError)
    return (
      <Message title="This link doesn't work">
        {info.error.message}
      </Message>
    );
  const inv = info.data;
  if (inv.status !== "open")
    return (
      <Message title={inv.status === "used" ? "This invite was already used" : "This invite has expired"}>
        {inv.status === "used" ? "If it was you, log in." : `Ask ${inv.invitedBy || "the person who invited you"} for a new link.`}
      </Message>
    );

  const me = s.data?.enabled ? s.data.me : null;
  if (me && me.org?.name === inv.orgName && me.email === inv.email)
    return <Message title={`You're already in ${inv.orgName}`}>Head to your projects.</Message>;
  if (me && me.email !== inv.email)
    return (
      <Message title={`This invite is for ${inv.email}`}>
        You&apos;re logged in as {me.email}.{" "}
        <button type="button" className="text-primary-ink underline" onClick={() => signOut()}>
          Log out
        </button>{" "}
        and open the link again to accept it.
      </Message>
    );
  return <Accept token={token} inv={inv} signedIn={!!me} />;
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="cr-card grid gap-3">
      <title>Invite · Hone</title>
      <h1 className="cr-h2">{title}</h1>
      <p className="text-body-sm text-ink-2">{children}</p>
      <Link href="/" className="cr-btn cr-btn--secondary w-fit">
        Go to Hone
      </Link>
    </div>
  );
}

function Accept({ token, inv, signedIn }: { token: string; inv: InviteInfo; signedIn: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [f, setF] = useState({ name: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!signedIn) {
      const bad =
        mode === "new"
          ? missing({ "your name": f.name, "a password": f.password, "the password again": f.confirm }) ??
            passwordProblem(f.password, f.confirm)
          : missing({ "your password": f.password });
      if (bad) return setError(bad);
    }
    setBusy(true);
    try {
      const c = await supa();
      if (!c) return;
      if (!signedIn) {
        const res =
          mode === "new"
            ? await c.auth.signUp({ email: inv.email, password: f.password, options: { data: { name: f.name.trim() } } })
            : await c.auth.signInWithPassword({ email: inv.email, password: f.password });
        if (res.error) {
          if (/already/i.test(res.error.message)) setMode("existing");
          return setError(authMessage(res.error));
        }
        if (!res.data.session) return setError("Confirm your email from the message we sent, then open this link again.");
      }
      await acceptInvite(token);
      await qc.invalidateQueries({ queryKey: ["session"] });
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="cr-card grid gap-5" onSubmit={submit}>
      <title>{`Join ${inv.orgName} · Hone`}</title>
      <div className="grid gap-1">
        <span className="cr-overline">Invite</span>
        <h1 className="cr-h2">Join {inv.orgName}</h1>
        <p className="text-ui text-ink-2">
          {inv.invitedBy ? `${inv.invitedBy} invited you` : "You've been invited"} as {inv.role === "owner" ? "an owner" : "a member"}.
        </p>
      </div>
      <div className="grid gap-0.5 rounded-control bg-surface-2 px-3 py-2">
        <span className="text-caption text-ink-2">Email</span>
        <span className="text-body-sm text-ink">{inv.email}</span>
      </div>
      {!signedIn && mode === "new" && (
        <>
          <Field label="Your name" autoComplete="name" required autoFocus maxLength={80} value={f.name} onChange={set("name")} hint="How your teammates will see you." />
          <Field label="Password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={f.password} onChange={set("password")} hint={`At least ${MIN_PASSWORD} characters.`} />
          <Field label="Confirm password" type="password" autoComplete="new-password" required value={f.confirm} onChange={set("confirm")} />
        </>
      )}
      {!signedIn && mode === "existing" && (
        <Field label="Password" type="password" autoComplete="current-password" required autoFocus value={f.password} onChange={set("password")} />
      )}
      <FormError>{error}</FormError>
      <button className="cr-btn cr-btn--primary" aria-busy={busy} disabled={busy}>
        {signedIn ? `Join ${inv.orgName}` : mode === "new" ? "Set password and join" : "Log in and join"}
      </button>
      {!signedIn && (
        <button
          type="button"
          className="justify-self-start text-ui text-primary-ink underline"
          onClick={() => {
            setMode(mode === "new" ? "existing" : "new");
            setError("");
          }}
        >
          {mode === "new" ? "I already have a Hone account" : "I'm new to Hone"}
        </button>
      )}
    </form>
  );
}
