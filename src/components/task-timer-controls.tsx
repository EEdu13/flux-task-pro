import { Pause, Play, Square, Timer } from "lucide-react";
import { useTaskTimer } from "@/lib/task-timer";
import { formatHM, formatHMS } from "@/lib/time-log";

/**
 * Inline play / pause / stop controls for a task's pomodoro-style timer.
 * Compact by default — fits inside task cards, list rows and pack items.
 */
export function TaskTimerControls({
  taskId,
  estimatedMinutes,
  size = "sm",
  showTotal = true,
  className = "",
}: {
  taskId: string;
  estimatedMinutes?: number;
  size?: "sm" | "md";
  showTotal?: boolean;
  className?: string;
}) {
  const { activeTaskId, paused, elapsedActive, totalFor, play, pause, stop } = useTaskTimer();
  const isActive = activeTaskId === taskId;
  const running = isActive && !paused;
  const totalSeconds = totalFor(taskId);
  const estSeconds = estimatedMinutes ? estimatedMinutes * 60 : 0;
  const over = estSeconds > 0 && totalSeconds > estSeconds;
  const pct = estSeconds > 0 ? Math.min(999, Math.round((totalSeconds / estSeconds) * 100)) : 0;

  const btn =
    size === "md"
      ? "h-7 w-7"
      : "h-6 w-6";
  const iconCls = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums transition ${
        isActive
          ? running
            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "border-border bg-background text-muted-foreground"
      } ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <Timer className={`${iconCls} shrink-0 opacity-70`} />
      <span className="font-mono">
        {isActive
          ? formatHMS(elapsedActive)
          : totalSeconds > 0
            ? formatHM(totalSeconds)
            : estSeconds > 0
              ? `~${formatHM(estSeconds)}`
              : "0m"}
      </span>
      {estSeconds > 0 && totalSeconds > 0 && (
        <span
          className={`ml-0.5 rounded px-1 text-[9px] font-semibold ${
            over
              ? "bg-destructive/15 text-destructive"
              : "bg-secondary text-muted-foreground"
          }`}
          title={`${pct}% do tempo estimado (${formatHM(estSeconds)})`}
        >
          {pct}%
        </span>
      )}
      {!showTotal && null}
      <div className="ml-0.5 flex items-center gap-0.5">
        {!running ? (
          <button
            type="button"
            title={isActive ? "Retomar" : "Iniciar tempo"}
            onClick={(e) => {
              e.stopPropagation();
              play(taskId);
            }}
            className={`flex ${btn} items-center justify-center rounded hover:bg-primary/15 hover:text-primary`}
          >
            <Play className={iconCls} />
          </button>
        ) : (
          <button
            type="button"
            title="Pausar"
            onClick={(e) => {
              e.stopPropagation();
              pause();
            }}
            className={`flex ${btn} items-center justify-center rounded hover:bg-amber-500/20`}
          >
            <Pause className={iconCls} />
          </button>
        )}
        {isActive && (
          <button
            type="button"
            title="Parar e registrar"
            onClick={(e) => {
              e.stopPropagation();
              stop();
            }}
            className={`flex ${btn} items-center justify-center rounded hover:bg-destructive/15 hover:text-destructive`}
          >
            <Square className={iconCls} />
          </button>
        )}
      </div>
    </div>
  );
}