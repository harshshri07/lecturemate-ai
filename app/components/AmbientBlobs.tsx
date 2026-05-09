"use client";

import { useEffect } from "react";

type Blob = {
  x: number; // 0..1
  y: number; // 0..1
  vx: number;
  vy: number;
  seed: number;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/**
 * Lovable-like drifting blobs that repel from the cursor.
 * Writes CSS vars: --blob1-x/--blob1-y, --blob2-x/--blob2-y as percentages.
 */
export function AmbientBlobs() {
  useEffect(() => {
    const root = document.documentElement;
    const blobs: Blob[] = [
      { x: 0.18, y: 0.22, vx: 0, vy: 0, seed: 1.3 },
      { x: 0.78, y: 0.35, vx: 0, vy: 0, seed: 2.1 },
    ];

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const cxPx = parseFloat(getComputedStyle(root).getPropertyValue("--cursor-x")) || window.innerWidth / 2;
      const cyPx = parseFloat(getComputedStyle(root).getPropertyValue("--cursor-y")) || window.innerHeight / 3;
      const cx = cxPx / Math.max(1, window.innerWidth);
      const cy = cyPx / Math.max(1, window.innerHeight);

      for (const b of blobs) {
        // slow wandering (cheap pseudo-noise)
        const t = now / 1000;
        const ax = Math.sin(t * 0.35 + b.seed) * 0.02;
        const ay = Math.cos(t * 0.31 + b.seed * 1.7) * 0.02;

        // cursor repulsion
        const dx = b.x - cx;
        const dy = b.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) + 1e-6;
        const influence = clamp((0.34 - dist) / 0.34, 0, 1); // only within radius
        const repulse = influence * influence * 1.6; // stronger push

        // integrate accel into velocity
        b.vx += (ax + (dx / dist) * repulse) * dt;
        b.vy += (ay + (dy / dist) * repulse) * dt;

        // damping + integrate
        const damp = Math.pow(0.82, dt * 60);
        b.vx *= damp;
        b.vy *= damp;
        b.x += b.vx;
        b.y += b.vy;

        // keep within viewport margins
        b.x = clamp(b.x, 0.06, 0.94);
        b.y = clamp(b.y, 0.08, 0.92);
      }

      root.style.setProperty("--blob1-x", `${Math.round(blobs[0].x * 100)}%`);
      root.style.setProperty("--blob1-y", `${Math.round(blobs[0].y * 100)}%`);
      root.style.setProperty("--blob2-x", `${Math.round(blobs[1].x * 100)}%`);
      root.style.setProperty("--blob2-y", `${Math.round(blobs[1].y * 100)}%`);

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}

