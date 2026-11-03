"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authMessage, supa } from "@/lib/auth";
import { Field, FormError, missing } from "@/components/auth-forms";

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const bad = missing({ "your email": email, "your password": password });
    if (bad) return setError(bad);
    setBusy(true);
    try {
      const s = await supa();
      if (!s) return router.replace("/");
      const { error } = await s.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return setError(authMessage(error));
      await qc.invalidateQueries({ queryKey: ["session"] });
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="cr-card grid gap-5" onSubmit={submit}>
      <title>Log in · Hone</title>
      <div className="grid gap-1">
        <h1 className="cr-h2">Log in</h1>
        <p className="text-ui text-ink-2">Welcome back.</p>
      </div>
      <Field label="Email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <FormError>{error}</FormError>
      <button className="cr-btn cr-btn--primary" aria-busy={busy} disabled={busy}>
        Log in
      </button>
      <p className="text-ui text-ink-2">
        New to Hone?{" "}
        <Link href="/signup" className="text-primary-ink underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
