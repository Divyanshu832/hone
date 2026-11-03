"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createOrg, updateMe } from "@/lib/api";
import { authMessage, signOut, supa } from "@/lib/auth";
import { useSession } from "@/components/auth-gate";
import { emailProblem, Field, FormError, MIN_PASSWORD, missing, passwordProblem } from "@/components/auth-forms";

/** Create an account, then an organization. Someone signed in without an organization sees only step 2. */
export default function SignupPage() {
  const s = useSession();
  const me = s.data?.enabled ? s.data.me : null;
  if (s.isPending) return <div className="cr-skeleton h-[380px] rounded-card" />;
  if (me && !me.org) return <OrgStep name={me.name} email={me.email} />;
  return <AccountStep />;
}

function AccountStep() {
  const router = useRouter();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", email: "", password: "", org: "" });
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const bad =
      missing({ "your name": f.name, "your email": f.email, "a password": f.password, "your organization's name": f.org }) ??
      emailProblem(f.email) ??
      passwordProblem(f.password);
    if (bad) return setError(bad);
    setBusy(true);
    try {
      const c = await supa();
      if (!c) return router.replace("/");
      const { data, error } = await c.auth.signUp({
        email: f.email.trim(),
        password: f.password,
        options: { data: { name: f.name.trim() } },
      });
      if (error) return setError(authMessage(error));
      // With email confirmation on, there's no session until they click the link.
      if (!data.session) return setSent(true);
      await createOrg(f.org.trim());
      await qc.invalidateQueries({ queryKey: ["session"] });
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <div className="cr-card grid gap-3">
        <h1 className="cr-h2">Check your email</h1>
        <p className="text-body-sm text-ink-2">
          We sent a link to <strong className="text-ink">{f.email}</strong>. Open it, then log in to finish setting up.
        </p>
        <Link href="/login" className="cr-btn cr-btn--secondary w-fit">
          Go to log in
        </Link>
      </div>
    );

  return (
    <form className="cr-card grid gap-5" onSubmit={submit}>
      <title>Create an account · Hone</title>
      <div className="grid gap-1">
        <h1 className="cr-h2">Create an account</h1>
        <p className="text-ui text-ink-2">Invited by someone? Use the link they sent you instead.</p>
      </div>
      <Field label="Your name" autoComplete="name" required autoFocus maxLength={80} value={f.name} onChange={set("name")} />
      <Field label="Email" type="email" autoComplete="email" required value={f.email} onChange={set("email")} />
      <Field
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD}
        hint={`At least ${MIN_PASSWORD} characters.`}
        value={f.password}
        onChange={set("password")}
      />
      <Field
        label="Organization"
        autoComplete="organization"
        required
        maxLength={80}
        hint="Your team's name. You can invite people to it later."
        value={f.org}
        onChange={set("org")}
      />
      <FormError>{error}</FormError>
      <button className="cr-btn cr-btn--primary" aria-busy={busy} disabled={busy}>
        Create account
      </button>
      <p className="text-ui text-ink-2">
        Have an account?{" "}
        <Link href="/login" className="text-primary-ink underline">
          Log in
        </Link>
      </p>
    </form>
  );
}

function OrgStep({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [org, setOrg] = useState("");
  const [yourName, setYourName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const bad = missing({ ...(name ? {} : { "your name": yourName }), "your organization's name": org });
    if (bad) return setError(bad);
    setBusy(true);
    try {
      if (!name) await updateMe(yourName.trim());
      await createOrg(org.trim());
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
      <title>Create your organization · Hone</title>
      <div className="grid gap-1">
        <h1 className="cr-h2">Create your organization</h1>
        <p className="text-ui text-ink-2">
          {name ? `Hi ${name}. ` : ""}Projects belong to an organization, so your team sees the same ones.
        </p>
      </div>
      {!name && (
        <Field label="Your name" autoComplete="name" required autoFocus maxLength={80} value={yourName} onChange={(e) => setYourName(e.target.value)} />
      )}
      <Field label="Organization" autoComplete="organization" required autoFocus={!!name} maxLength={80} value={org} onChange={(e) => setOrg(e.target.value)} />
      <FormError>{error}</FormError>
      <button className="cr-btn cr-btn--primary" aria-busy={busy} disabled={busy}>
        Create organization
      </button>
      <p className="text-ui text-ink-2">
        Waiting for an invite? Open the link you were sent. Signed in as {email}.{" "}
        <button type="button" className="text-primary-ink underline" onClick={() => signOut()}>
          Log out
        </button>
      </p>
    </form>
  );
}
