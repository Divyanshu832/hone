"use client";

/** Small pieces shared by the login, sign-up and invite pages. */
export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="cr-field">
      <span className="cr-label">
        {label}
        {input.required && (
          <>
            <span aria-hidden className="text-danger-ink"> *</span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </span>
      <input className="cr-input" {...input} />
      {hint && <span className="cr-help">{hint}</span>}
    </label>
  );
}

export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <span className="cr-error" role="alert">
      {children}
    </span>
  );
}

export const MIN_PASSWORD = 8;

export function passwordProblem(pw: string, confirm?: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters for your password.`;
  if (confirm !== undefined && pw !== confirm) return "The two passwords don't match.";
  return null;
}

/** Every field is required; spaces alone don't count. Returns the first problem, or null. */
export function missing(fields: Record<string, string>): string | null {
  for (const [label, v] of Object.entries(fields)) if (!v.trim()) return `Add ${label}.`;
  return null;
}

export function emailProblem(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : "That doesn't look like an email address.";
}
