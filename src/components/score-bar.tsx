import { scoreBarColor, scoreTextClass } from "@/lib/score";

export function ScoreBar({
  pct,
  assigned,
  showLabel = true,
  size = "md",
  className = "",
}: {
  pct: number;
  assigned: number;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const h = size === "sm" ? "h-1" : size === "lg" ? "h-2.5" : "h-1.5";
  const label = assigned === 0 ? "—" : `${Math.round(pct)}%`;
  return (
    <div className={`w-full ${className}`}>
      {showLabel && (
        <div className="mb-1 flex items-center justify-between text-[10px] font-medium">
          <span className="text-muted-foreground">
            {assigned === 0 ? "sem tarefas" : pct >= 100 ? "meta batida" : "abaixo da meta"}
          </span>
          <span className={`tabular-nums ${scoreTextClass(pct, assigned)}`}>{label}</span>
        </div>
      )}
      <div className={`${h} w-full overflow-hidden rounded-full bg-secondary`}>
        <div
          className={`${h} rounded-full transition-all`}
          style={{
            width: `${Math.min(100, Math.max(assigned === 0 ? 0 : 4, pct))}%`,
            background: scoreBarColor(pct, assigned),
          }}
        />
      </div>
    </div>
  );
}