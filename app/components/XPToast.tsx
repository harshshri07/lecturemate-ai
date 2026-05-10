"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface XPToastItem {
  id:     string;
  amount: number;
  label:  string;
}

interface XPToastProps {
  toasts: XPToastItem[];
  onDismiss: (id: string) => void;
}

/** Auto-dismiss each toast after 2.8 s */
function XPToastEntry({
  toast,
  onDismiss,
}: {
  toast: XPToastItem;
  onDismiss: (id: string) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    timer.current = setTimeout(() => onDismiss(toast.id), 2800);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [toast.id, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 60, scale: 0.88 }}
      animate={{ opacity: 1, x: 0,  scale: 1 }}
      exit={{    opacity: 0, x: 60, scale: 0.88 }}
      transition={{ type: "spring", stiffness: 420, damping: 28 }}
      className="flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg cursor-pointer select-none"
      style={{
        background:  "linear-gradient(135deg, rgba(30,30,30,0.96) 0%, rgba(20,18,14,0.98) 100%)",
        border:      "1px solid rgba(255,160,40,0.35)",
        backdropFilter: "blur(16px)",
        boxShadow:   "0 0 0 1px rgba(255,140,20,0.12), 0 8px 32px -8px rgba(0,0,0,0.6), 0 0 20px -6px rgba(255,120,20,0.3)",
        minWidth:    "200px",
      }}
      onClick={() => onDismiss(toast.id)}
    >
      {/* XP badge */}
      <div
        className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center font-bold text-sm"
        style={{
          background: "linear-gradient(135deg, #ff8c14 0%, #ff5500 100%)",
          color:      "#fff",
          boxShadow:  "0 2px 8px rgba(255,100,20,0.5)",
          fontFamily: "var(--font-mono)",
        }}
      >
        ⚡
      </div>

      {/* Text */}
      <div>
        <div
          className="font-bold leading-none"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize:   "1.1rem",
            background: "linear-gradient(90deg, #ffb84d, #ff6a00)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          +{toast.amount} XP
        </div>
        <div className="text-xs mt-0.5 leading-none" style={{ color: "rgba(255,255,255,0.62)" }}>
          {toast.label}
        </div>
      </div>
    </motion.div>
  );
}

/** Fixed bottom-right stack of XP notifications */
export function XPToastContainer({ toasts, onDismiss }: XPToastProps) {
  return (
    <div
      className="fixed bottom-6 right-6 z-[9000] flex flex-col-reverse gap-2 pointer-events-none"
      style={{ alignItems: "flex-end" }}
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <XPToastEntry toast={t} onDismiss={onDismiss} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
