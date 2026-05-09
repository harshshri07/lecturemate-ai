import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ConfettiHost } from "./components/Confetti";
import { CursorGlow } from "./components/CursorGlow";
import { AmbientBlobs } from "./components/AmbientBlobs";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "StudyAI — Turn any lecture into your study kit",
  description: "Paste a YouTube URL. Four AI agents extract, structure, summarize, and index the entire video into a study workspace you can actually use.",
  openGraph: {
    title: "StudyAI — Turn any lecture into your study kit",
    description: "AI-powered study companion built on Amazon Bedrock",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${inter.variable} antialiased`}>
        {children}
        <CursorGlow />
        <AmbientBlobs />
        <ConfettiHost />
      </body>
    </html>
  );
}
