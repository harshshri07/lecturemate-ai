"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import Image from "next/image";
import { LogIn, LogOut, ChevronDown, Cloud } from "lucide-react";

export function AuthButton() {
  const { data: session, status } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  if (status === "loading") {
    return (
      <div
        className="h-8 w-8 rounded-full animate-pulse"
        style={{ background: "var(--surface-elevated)" }}
      />
    );
  }

  if (!session) {
    return (
      <button
        onClick={() => signIn("google")}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition hover:opacity-80"
        style={{
          background: "color-mix(in oklab, var(--primary) 12%, transparent)",
          color: "var(--primary)",
          border: "1px solid color-mix(in oklab, var(--primary) 30%, transparent)",
        }}
      >
        <LogIn className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Sign in</span>
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-medium transition hover:opacity-80"
        style={{
          background: "var(--surface-elevated)",
          border: "1px solid var(--border)",
        }}
      >
        {session.user.image ? (
          <Image
            src={session.user.image}
            alt={session.user.name ?? "User"}
            width={24}
            height={24}
            className="h-6 w-6 rounded-full object-cover"
          />
        ) : (
          <div
            className="h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            {(session.user.name ?? session.user.email ?? "?")[0].toUpperCase()}
          </div>
        )}
        <span className="hidden sm:inline max-w-[100px] truncate text-xs" style={{ color: "var(--foreground)" }}>
          {session.user.name ?? session.user.email}
        </span>
        <ChevronDown className="h-3 w-3 opacity-50" />
      </button>

      <AnimatePresence>
        {menuOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-10 z-50 w-52 rounded-xl p-1 shadow-2xl"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              {/* User info */}
              <div className="px-3 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
                <p className="text-xs font-semibold truncate" style={{ color: "var(--foreground)" }}>
                  {session.user.name}
                </p>
                <p className="text-[11px] truncate" style={{ color: "var(--muted-foreground)" }}>
                  {session.user.email}
                </p>
              </div>

              {/* Cloud sync indicator */}
              <div className="flex items-center gap-2 px-3 py-2">
                <Cloud className="h-3.5 w-3.5" style={{ color: "var(--success)" }} />
                <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  Cloud sync enabled
                </span>
              </div>

              {/* Sign out */}
              <button
                onClick={() => { setMenuOpen(false); signOut(); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition hover:opacity-70"
                style={{ color: "var(--destructive)" }}
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
