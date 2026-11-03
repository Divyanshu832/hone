import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Hone",
  description: "Test your AI agent against real conversations, with judges you can trust.",
};

// Runs before first paint so the saved theme never flashes.
const themeScript = `try{var t=localStorage.getItem("hone-theme");document.documentElement.dataset.theme=t==="light"||t==="dark"?t:"auto"}catch(e){document.documentElement.dataset.theme="auto"}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="auto" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/Satoshi-Variable.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/Gambetta-Variable.woff2" as="font" type="font/woff2" crossOrigin="" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
