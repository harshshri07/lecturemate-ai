"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import type { SkillLevel } from "@/app/lib/adaptLevel";

interface CheckInModalProps {
  lectureTitle?: string;
  onDone: (result: { score: number; level: SkillLevel }) => void;
  onSkip: () => void;
}

const FAMILIARITY_OPTIONS: {
  level: SkillLevel;
  score: number;
  emoji: string;
  label: string;
  sublabel: string;
  color: string;
  glow: string;
}[] = [
  {
    level:    "beginner",
    score:    25,
    emoji:    "🌱",
    label:    "New to this",
    sublabel: "I haven't studied this topic before",
    color:    "var(--success)",
    glow:     "color-mix(in oklab, var(--success) 18%, transparent)",
  },
  {
    level:    "intermediate",
    score:    55,
    emoji:    "📚",
    label:    "Know the basics",
    sublabel: "I've touched on this but want to go deeper",
    color:    "var(--warning)",
    glow:     "color-mix(in oklab, var(--warning) 18%, transparent)",
  },
  {
    level:    "advanced",
    score:    85,
    emoji:    "⚡",
    label:    "Pretty advanced",
    sublabel: "I know this well, looking for depth",
    color:    "var(--primary)",
    glow:     "color-mix(in oklab, var(--primary) 18%, transparent)",
  },
];

export function CheckInModal({ lectureTitle, onDone, onSkip }: CheckInModalProps) {
  const [chosen, setChosen] = useState<SkillLevel | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const handlePick = (opt: typeof FAMILIARITY_OPTIONS[number]) => {
    if (confirmed) return;
    setChosen(opt.level);
    setConfirmed(true);
    setTimeout(() => onDone({ score: opt.score, level: opt.level }), 900);
  };

  const topic = lectureTitle
    ? lectureTitle.length > 50
      ? lectureTitle.slice(0, 50) + "…"
      : lectureTitle
    : "this topic";

  return (
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.68)", backdropFilter: "blur(10px)" }}
    >
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, scale: 0.93, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.93 }}
          transition={{ type: "spring", stiffness: 360, damping: 30 }}
          className="relative w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          {/* Orange top bar */}
          <div className="h-1 w-full" style={{ background: "linear-gradient(90deg,#ff8c14,#ff4500)" }} />

          <div className="p-6">
            {/* Skip */}
            {!confirmed && (
              <button onClick={onSkip}
                className="absolute top-5 right-5 rounded-lg p-1.5 transition hover:opacity-60"
                style={{ color: "var(--muted-foreground)" }}>
                <X className="h-4 w-4" />
              </button>
            )}

            {/* Header */}
            <div className="mb-5">
              <p className="font-semibold text-base leading-tight">
                How well do you know this?
              </p>
              <p className="text-xs mt-1 leading-snug" style={{ color: "var(--muted-foreground)" }}>
                <span className="italic">{topic}</span>
              </p>
              <p className="text-[11px] mt-2" style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>
                No right or wrong. This helps us tune the workspace for you.
              </p>
            </div>

            {confirmed ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center py-5"
              >
                <div className="text-4xl mb-3">
                  {FAMILIARITY_OPTIONS.find(o => o.level === chosen)?.emoji}
                </div>
                <p className="font-semibold text-base">
                  {FAMILIARITY_OPTIONS.find(o => o.level === chosen)?.label}
                </p>
                <p className="text-xs mt-1.5" style={{ color: "var(--muted-foreground)" }}>
                  Tailoring your workspace…
                </p>
              </motion.div>
            ) : (
              <div className="space-y-2.5">
                {FAMILIARITY_OPTIONS.map((opt) => (
                  <motion.button
                    key={opt.level}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => handlePick(opt)}
                    className="w-full rounded-2xl border px-4 py-3.5 text-left transition-all flex items-center gap-3.5"
                    style={{ background: "var(--surface-elevated)", borderColor: "var(--border)" }}
                  >
                    <span className="text-2xl shrink-0 leading-none">{opt.emoji}</span>
                    <div>
                      <div className="text-sm font-semibold leading-tight">{opt.label}</div>
                      <div className="text-xs mt-0.5 leading-snug" style={{ color: "var(--muted-foreground)" }}>
                        {opt.sublabel}
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            )}

            {!confirmed && (
              <button onClick={onSkip}
                className="mt-4 text-xs transition hover:opacity-70 flex items-center gap-1"
                style={{ color: "var(--muted-foreground)" }}>
                Skip · start with defaults
              </button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
