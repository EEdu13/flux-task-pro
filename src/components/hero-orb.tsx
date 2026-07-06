import { motion } from "framer-motion";

interface HeroOrbProps {
  score: number;
  goal: number;
}

export function HeroOrb({ score, goal }: HeroOrbProps) {
  const pct = Math.min(100, Math.round((score / goal) * 100));
  const rings = [
    { size: 320, color: "oklch(0.78 0.17 210)", value: 82, duration: 40 },
    { size: 260, color: "oklch(0.7 0.2 330)", value: 68, duration: 55, reverse: true },
    { size: 200, color: "oklch(0.78 0.18 155)", value: 94, duration: 30 },
  ];

  return (
    <div className="relative flex h-[380px] w-full items-center justify-center">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0 blur-3xl opacity-70"
        style={{ background: "var(--gradient-hero)" }}
      />

      {/* Rotating rings */}
      {rings.map((r, i) => {
        const circumference = 2 * Math.PI * (r.size / 2 - 8);
        const dash = (r.value / 100) * circumference;
        return (
          <svg
            key={i}
            width={r.size}
            height={r.size}
            className="absolute"
            style={{
              animation: `${r.reverse ? "orb-spin-reverse" : "orb-spin"} ${r.duration}s linear infinite`,
              filter: `drop-shadow(0 0 20px ${r.color})`,
            }}
          >
            <circle
              cx={r.size / 2}
              cy={r.size / 2}
              r={r.size / 2 - 8}
              fill="none"
              stroke="oklch(1 0 0 / 0.04)"
              strokeWidth="10"
            />
            <circle
              cx={r.size / 2}
              cy={r.size / 2}
              r={r.size / 2 - 8}
              fill="none"
              stroke={r.color}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              transform={`rotate(-90 ${r.size / 2} ${r.size / 2})`}
            />
          </svg>
        );
      })}

      {/* Central glass orb */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="relative flex h-40 w-40 items-center justify-center rounded-full"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, oklch(1 0 0 / 0.4), oklch(0.78 0.17 210 / 0.3) 40%, oklch(0.14 0.03 265 / 0.8) 80%)",
          boxShadow:
            "inset 0 4px 20px oklch(1 0 0 / 0.3), inset 0 -10px 30px oklch(0.7 0.2 330 / 0.5), 0 0 80px oklch(0.78 0.17 210 / 0.6), 0 0 160px oklch(0.7 0.2 330 / 0.4)",
          animation: "float-y 6s ease-in-out infinite",
        }}
      >
        {/* Highlight */}
        <div
          className="absolute left-6 top-4 h-10 w-10 rounded-full opacity-70 blur-md"
          style={{ background: "oklch(1 0 0 / 0.6)" }}
        />
        <div className="relative z-10 text-center">
          <div className="text-4xl font-semibold tracking-tight text-white">{pct}%</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/70">Meta hoje</div>
        </div>
      </motion.div>

      {/* Orbiting particles */}
      {[0, 120, 240].map((angle, i) => (
        <div
          key={i}
          className="absolute h-2 w-2 rounded-full"
          style={{
            background: ["#22d3ee", "#f472b6", "#34d399"][i],
            boxShadow: `0 0 12px ${["#22d3ee", "#f472b6", "#34d399"][i]}`,
            transform: `rotate(${angle}deg) translateX(170px)`,
            animation: `orb-spin ${20 + i * 5}s linear infinite`,
            transformOrigin: "center",
          }}
        />
      ))}
    </div>
  );
}