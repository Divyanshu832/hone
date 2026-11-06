"use client";

import { EnvelopeSimple } from "@phosphor-icons/react";

/**
 * The managed plan: for people who don't want to bring their own model keys. There's no checkout; they
 * email us. NEXT_PUBLIC_SALES_EMAIL overrides the address.
 */
export const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL || "sdivyanshushekhar@gmail.com";

function salesHref(org?: string) {
  const subject = "Hone managed plan";
  const body = `Hi,\n\nWe'd like to use Hone without bringing our own model keys.${org ? `\n\nOrganization: ${org}` : ""}\n`;
  return `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** A small link for notices: "or contact sales". */
export function ContactSalesLink({ org, children = "contact sales" }: { org?: string; children?: React.ReactNode }) {
  if (!SALES_EMAIL) return null;
  return (
    <a href={salesHref(org)} className="underline">
      {children}
    </a>
  );
}

/** The card under the keys form in Settings. */
export function ManagedPlanCard({ org }: { org?: string }) {
  if (!SALES_EMAIL) return null;
  return (
    <div className="cr-card grid gap-3">
      <div className="grid gap-1">
        <h2 className="text-body weight-bold">Rather not manage keys?</h2>
        <p className="text-ui text-ink-2">
          The managed plan runs Hone on our keys, with a monthly allowance and one invoice. Tell us about your agents and
          we&apos;ll set it up.
        </p>
      </div>
      <div>
        <a href={salesHref(org)} className="cr-btn cr-btn--secondary">
          <EnvelopeSimple aria-hidden />
          Contact sales
        </a>
      </div>
    </div>
  );
}
