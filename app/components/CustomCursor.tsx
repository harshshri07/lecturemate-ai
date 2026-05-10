"use client";

import { useEffect, useRef } from "react";

/**
 * CustomCursor — neon orange ring that sits exactly on the cursor.
 * No lerp/lag — the ring follows the mouse directly via mousemove.
 */
export function CustomCursor() {
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const ring = ringRef.current;
    if (!ring) return;

    const RADIUS = 11; // px — half the ring width

    const style = document.createElement("style");
    style.textContent = "*, *::before, *::after { cursor: none !important; }";
    document.head.appendChild(style);

    // Move ring directly on mousemove — zero lag, perfectly synced
    function onMove(e: MouseEvent) {
      if (ring) {
        ring.style.transform = `translate(${e.clientX - RADIUS}px, ${e.clientY - RADIUS}px)`;
      }
    }

    window.addEventListener("mousemove", onMove, { passive: true });

    return () => {
      window.removeEventListener("mousemove", onMove);
      document.head.removeChild(style);
    };
  }, []);

  return (
    <div
      ref={ringRef}
      className="pointer-events-none fixed top-0 left-0 z-[9999] rounded-full"
      style={{
        width:      22,
        height:     22,
        border:     "1.5px solid rgba(255, 120, 30, 0.95)",
        boxShadow:  "0 0 8px 2px rgba(255, 110, 20, 0.60), 0 0 20px 5px rgba(255, 80, 0, 0.22)",
        willChange: "transform",
      }}
    />
  );
}
