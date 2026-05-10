"use client";

import { motion, AnimatePresence } from "framer-motion";
import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import { Mascot } from "@/app/components/Mascot";
import { AnimatedBackground } from "@/app/components/AnimatedBackground";
const GUEST_KEY = "studyai_guest_confirmed";

interface SignInGateProps {
  /**
   * "loading" — session still resolving, show opaque cover with no form
   * "gate"    — show the sign-in / guest picker
   * (unmounted entirely when "app")
   */
  phase: "loading" | "gate";
  onContinue: () => void;
}

export function SignInGate({ phase, onContinue }: SignInGateProps) {
  const [loading, setLoading] = useState(false);

  // Lock body scroll while gate is visible
  useEffect(() => {
    document.body.classList.add("gate-open");
    return () => { document.body.classList.remove("gate-open"); };
  }, []);

  function handleGuest() {
    try { localStorage.setItem(GUEST_KEY, "1"); } catch { /* ignore */ }
    onContinue();
  }

  async function handleGoogle() {
    setLoading(true);
    await signIn("google", { callbackUrl: "/" });
  }

  return (
    // Single overlay that is ALWAYS fully opaque — never unmounts during "loading→gate"
    // Only unmounts (with AnimatePresence exit) when transitioning to "app"
    <motion.div
      key="sign-in-gate"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3, ease: "easeInOut" } }}
      className="fixed inset-0 z-[500] flex flex-col items-center justify-center px-4 overflow-hidden"
    >
      {/* Background fill + stars */}
      <div
        className="fixed inset-0"
        style={{ zIndex: 498, background: "var(--background)" }}
      />
      {/* Stars background — always rendered, inside the gate stacking layer */}
      <AnimatedBackground density={72} interactive={phase === "gate"} zIndex={499} />

      {/* Custom circle cursor — only active once the form is visible */}
      {/* Form content — only fades in once the session is resolved */}
      <AnimatePresence>
        {phase === "gate" && (
          <motion.div
            key="gate-form"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex flex-col items-center text-center"
            style={{ maxWidth: 400, width: "100%", zIndex: 501 }}
          >
            {/* Mascot */}
            <div className="mb-5">
              <Mascot className="h-[84px] w-[84px]" animated />
            </div>

            {/* Label */}
            <p
              className="text-[10px] font-mono uppercase tracking-[0.22em] mb-3"
              style={{ color: "var(--primary)" }}
            >
              StudyAI
            </p>

            {/* Headline */}
            <h1
              className="text-[2.1rem] sm:text-[2.5rem] font-bold tracking-tight leading-[1.12] mb-4"
              style={{ fontFamily: "var(--font-serif, 'Instrument Serif', serif)" }}
            >
              Your AI study kit,
              <br />
              <em style={{ color: "var(--primary)", fontStyle: "italic" }}>always with you.</em>
            </h1>

            {/* Sub-copy */}
            <p
              className="text-sm leading-relaxed mb-9"
              style={{ color: "var(--muted-foreground)" }}
            >
              Sign in to sync your lectures, progress, and adaptive
              learning profile across all your devices.
            </p>

            {/* Buttons */}
            <div className="flex flex-col gap-3 w-full">
              {/* Google */}
              <button
                onClick={handleGoogle}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 py-3.5 px-6 rounded-2xl font-semibold text-[15px] transition-all duration-200 hover:scale-[1.025] active:scale-[0.975] disabled:opacity-55"
                style={{
                  background: "var(--foreground)",
                  color: "var(--background)",
                  boxShadow: "0 6px 32px color-mix(in oklab, var(--foreground) 14%, transparent)",
                }}
              >
                {loading ? (
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                )}
                {loading ? "Redirecting…" : "Continue with Google"}
              </button>

              {/* Guest */}
              <button
                onClick={handleGuest}
                className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-2xl font-medium text-sm transition-all duration-200 hover:opacity-70 active:scale-[0.975]"
                style={{
                  background: "color-mix(in oklab, var(--surface) 50%, transparent)",
                  color: "var(--muted-foreground)",
                  border: "1px solid var(--border)",
                  backdropFilter: "blur(8px)",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
                Continue as guest
              </button>
            </div>

            {/* Fine print */}
            <p
              className="mt-6 text-[11px] leading-relaxed"
              style={{ color: "var(--muted-foreground)", opacity: 0.5 }}
            >
              Guest mode works fully. Your data stays on this device only.
              <br />
              Sign in anytime to unlock cloud sync.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Synchronous localStorage check — safe to call during useEffect */
export function shouldShowGate(isSignedIn: boolean): boolean {
  if (isSignedIn) return false;
  if (typeof window === "undefined") return false;
  try { return !localStorage.getItem(GUEST_KEY); } catch { return false; }
}
