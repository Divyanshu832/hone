import Link from "next/link";
import { Suspense } from "react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="grid w-full max-w-[420px] gap-8">
        <Link href="/" className="justify-self-center font-display text-[34px] leading-none tracking-[-0.02em]">
          H<em>one</em>
        </Link>
        <Suspense fallback={<div className="cr-skeleton h-[380px] rounded-card" />}>{children}</Suspense>
      </div>
    </div>
  );
}
