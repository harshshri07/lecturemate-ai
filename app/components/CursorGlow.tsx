"use client";

import { useEffect } from "react";

/**
 * Tracks pointer position and exposes it via CSS vars:
 * --cursor-x, --cursor-y (in px).
 *
 * Used by CSS to render a subtle cursor glow.
 */
export function CursorGlow() {
  useEffect(() => {
    let raf = 0;
    let lastX = window.innerWidth / 2;
    let lastY = window.innerHeight / 3;

    const apply = () => {
      raf = 0;
      document.documentElement.style.setProperty("--cursor-x", `${lastX}px`);
      document.documentElement.style.setProperty("--cursor-y", `${lastY}px`);
    };

    const onMove = (e: PointerEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!raf) raf = window.requestAnimationFrame(apply);
    };

    // Initialize
    apply();
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}

