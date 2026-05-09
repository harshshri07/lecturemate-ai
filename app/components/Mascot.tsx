/**
 * Mascot — a soft, editorial book-owl character.
 * Used on hero, empty states, and processing.
 */
export function Mascot({
  className = "",
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="m-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.78 0.18 70)" />
          <stop offset="100%" stopColor="oklch(0.62 0.2 40)" />
        </linearGradient>
        <linearGradient id="m-belly" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.96 0.018 85)" />
          <stop offset="100%" stopColor="oklch(0.88 0.04 75)" />
        </linearGradient>
      </defs>

      {/* Book base */}
      <rect x="28" y="148" width="144" height="22" rx="3" fill="oklch(0.22 0.012 260)" />
      <rect x="32" y="152" width="136" height="14" rx="2" fill="oklch(0.32 0.018 260)" />
      <line x1="100" y1="148" x2="100" y2="170" stroke="oklch(0.18 0.013 260)" strokeWidth="1" />

      {/* Body */}
      <ellipse cx="100" cy="108" rx="56" ry="58" fill="url(#m-body)" />
      {/* Belly */}
      <ellipse cx="100" cy="118" rx="36" ry="40" fill="url(#m-belly)" />

      {/* Wings */}
      <path d="M48,108 Q40,140 70,150 L72,108 Z" fill="oklch(0.55 0.18 50)" opacity="0.85" />
      <path d="M152,108 Q160,140 130,150 L128,108 Z" fill="oklch(0.55 0.18 50)" opacity="0.85" />

      {/* Eye discs */}
      <circle cx="80" cy="92" r="20" fill="oklch(0.96 0.018 85)" />
      <circle cx="120" cy="92" r="20" fill="oklch(0.96 0.018 85)" />
      {/* Eye pupils */}
      <g className={animated ? "origin-center" : ""}>
        <circle cx="82" cy="94" r="7" fill="oklch(0.11 0.01 260)">
          {animated && (
            <animate
              attributeName="r"
              values="7;1;7"
              dur="4s"
              repeatCount="indefinite"
              keyTimes="0;0.05;0.1"
            />
          )}
        </circle>
        <circle cx="122" cy="94" r="7" fill="oklch(0.11 0.01 260)">
          {animated && (
            <animate
              attributeName="r"
              values="7;1;7"
              dur="4s"
              repeatCount="indefinite"
              keyTimes="0;0.05;0.1"
            />
          )}
        </circle>
        <circle cx="84" cy="91" r="2" fill="oklch(0.96 0.018 85)" />
        <circle cx="124" cy="91" r="2" fill="oklch(0.96 0.018 85)" />
      </g>

      {/* Beak */}
      <path d="M100,104 L94,114 L106,114 Z" fill="oklch(0.72 0.19 78)" />

      {/* Tufts */}
      <path d="M62,68 L70,78 L74,68 Z" fill="oklch(0.55 0.18 50)" />
      <path d="M138,68 L134,78 L126,68 Z" fill="oklch(0.55 0.18 50)" />

      {/* Glasses */}
      <circle cx="80" cy="92" r="18" fill="none" stroke="oklch(0.11 0.01 260)" strokeWidth="2" opacity="0.55" />
      <circle cx="120" cy="92" r="18" fill="none" stroke="oklch(0.11 0.01 260)" strokeWidth="2" opacity="0.55" />
      <line x1="98" y1="92" x2="102" y2="92" stroke="oklch(0.11 0.01 260)" strokeWidth="2" opacity="0.55" />
    </svg>
  );
}

