"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { ToastProvider } from "./toast";
import { AuthGate } from "./auth-gate";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Suspense fallback={<div className="min-h-dvh" />}>
          <AuthGate>{children}</AuthGate>
        </Suspense>
      </ToastProvider>
    </QueryClientProvider>
  );
}
