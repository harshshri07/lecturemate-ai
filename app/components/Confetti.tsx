"use client";

import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  life: number;
};

/**
 * Tiny canvas confetti — no dependency.
 * Trigger via `celebrate(x, y)` or dispatch `lecturemate:confetti`.
 */
export function ConfettiHost() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particlesRef.current = particlesRef.current.filter((p) => p.life > 0);
      for (const p of particlesRef.current) {
        p.vy += 0.18;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.min(1, p.life / 40);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.4);
        ctx.restore();
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const onBurst = (e: Event) => {
      const detail = (e as CustomEvent<{ x?: number; y?: number }>).detail || {};
      const x = detail.x ?? window.innerWidth / 2;
      const y = detail.y ?? window.innerHeight / 3;
      const colors = ["#e8b65a", "#c97a3d", "#b1d49b", "#7b8fbc", "#f3e6c8"];
      for (let i = 0; i < 90; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 4 + Math.random() * 8;
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 4,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.4,
          size: 6 + Math.random() * 6,
          color: colors[Math.floor(Math.random() * colors.length)],
          life: 90 + Math.random() * 30,
        });
      }
    };

    window.addEventListener("lecturemate:confetti", onBurst);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("lecturemate:confetti", onBurst);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-[100]" aria-hidden="true" />;
}

export function celebrate(x?: number, y?: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("lecturemate:confetti", { detail: { x, y } }));
}

