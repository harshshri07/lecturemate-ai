"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

interface AnimatedBackgroundProps {
  density?: number;
  interactive?: boolean;
  className?: string;
  /** Pass the current theme string so colours are re-sampled on toggle */
  theme?: string;
  /** Override the z-index of the fixed wrapper (default: -1) */
  zIndex?: number;
}

export function AnimatedBackground({
  density = 70,
  interactive = true,
  className = "",
  theme,
  zIndex = -1,
}: AnimatedBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const _canvas = canvas;
    const _ctx = ctx;

    // In dark mode stars are white; in light mode use a dark ink colour so
    // they're still visible against the pale background.
    const isLight = theme === "light";
    // star RGB: white in dark, dark-ink in light
    const [sr, sg, sb] = isLight ? [30, 24, 40] : [255, 255, 255];

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let rafId = 0;
    let particles: Particle[] = [];
    let W = 0;
    let H = 0;
    let mouse = { x: -9999, y: -9999 };

    function spawnParticles() {
      const isMobile = W < 768;
      const count = isMobile
        ? Math.round(density * 0.3)
        : Math.min(Math.round((W * H) / 35000 + density * 0.5), 90);
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: 0.8 + Math.random() * 1.2,
      }));
    }

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      _canvas.width  = W * DPR;
      _canvas.height = H * DPR;
      _canvas.style.width  = `${W}px`;
      _canvas.style.height = `${H}px`;
      _ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      spawnParticles();
    }

    function draw() {
      _ctx.clearRect(0, 0, W, H);

      const isMobile = W < 768;
      const doInteract = interactive && !isMobile;
      const LINK_DIST  = 55;   // longer lines connecting more distant stars
      const REPEL_DIST = 140;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        if (doInteract) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < REPEL_DIST * REPEL_DIST && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const force = ((REPEL_DIST - d) / (d + 4)) * 0.022;
            p.vx += dx * force;
            p.vy += dy * force;
          }
        }

        p.vx = p.vx * 0.985 + (Math.random() - 0.5) * 0.006;
        p.vy = p.vy * 0.985 + (Math.random() - 0.5) * 0.006;

        const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (spd > 1.2) { p.vx = (p.vx / spd) * 1.2; p.vy = (p.vy / spd) * 1.2; }

        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x += W;
        if (p.x > W) p.x -= W;
        if (p.y < 0) p.y += H;
        if (p.y > H) p.y -= H;

        // Draw connecting lines to nearby stars only (short distance = no large shapes)
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d  = Math.sqrt(dx * dx + dy * dy);
          if (d < LINK_DIST) {
            const alpha = (1 - d / LINK_DIST) * (isLight ? 0.22 : 0.40);
            _ctx.beginPath();
            _ctx.moveTo(p.x, p.y);
            _ctx.lineTo(q.x, q.y);
            _ctx.strokeStyle = `rgba(${sr},${sg},${sb},${alpha})`;
            _ctx.lineWidth = 0.75;
            _ctx.stroke();
          }
        }

      }

      // Draw dots — small white stars
      for (const p of particles) {
        _ctx.beginPath();
        _ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        _ctx.fillStyle = `rgba(${sr},${sg},${sb},${isLight ? 0.70 : 0.90})`;
        _ctx.fill();
      }

      // Cursor glow — warm orange halo
      if (doInteract && mouse.x > -9000) {
        const glow = _ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 110);
        glow.addColorStop(0,   "rgba(255,120,30,0.28)");
        glow.addColorStop(0.5, "rgba(255,90,10,0.10)");
        glow.addColorStop(1,   "rgba(255,70,0,0)");
        _ctx.beginPath();
        _ctx.arc(mouse.x, mouse.y, 110, 0, Math.PI * 2);
        _ctx.fillStyle = glow;
        _ctx.fill();
      }

      rafId = requestAnimationFrame(draw);
    }

    resize();
    draw();

    const ro = new ResizeObserver(resize);
    ro.observe(document.documentElement);

    const onMouseMove  = (e: MouseEvent) => { mouse = { x: e.clientX, y: e.clientY }; };
    const onMouseLeave = () => { mouse = { x: -9999, y: -9999 }; };
    if (interactive) {
      window.addEventListener("mousemove",  onMouseMove,  { passive: true });
      window.addEventListener("mouseleave", onMouseLeave, { passive: true });
    }

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener("mousemove",  onMouseMove);
      window.removeEventListener("mouseleave", onMouseLeave);
    };
  // Re-run when theme changes so star colour updates instantly
  }, [density, interactive, theme]);

  return (
    <div
      ref={wrapperRef}
      className={`pointer-events-none fixed inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
      style={{ zIndex }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
