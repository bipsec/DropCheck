import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

import { Toaster } from "sonner";
import { SessionBootstrap } from "@/lib/session-bootstrap";
import { TopNav } from "@/components/top-nav";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"],
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "DropCheck — See what dropping this class actually costs",
  description:
    "DropCheck ingests your transcript, builds an editable profile, and answers course-drop impact questions with a multi-agent Claude pipeline grounded on a real course catalog.",
  metadataBase: new URL("http://localhost:3000"),
  openGraph: {
    title: "DropCheck",
    description:
      "Transcript-grounded course impact analysis with a multi-agent Claude pipeline.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${plexMono.variable}`}
    >
      <body>
        <SessionBootstrap />
        <TopNav />
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
