import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, X, CheckCircle2, Coffee } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { addFocusEntry } from "@/lib/focus-log";
import { toast } from "sonner";

const FOCUS_MINUTES = 25;

export function FocusOverlay() {
  const { tasks, currentUser, updateTask, toggleChecklistItem } = useFluxo();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(FOCUS_MINUTES * 60);
  const [running, setRunning] = useState(false);
  const startedRef = useRef<number | null>(null);
  const accumRef = useRef(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ taskId: string }>).detail?.taskId;
      if (!id) return;
      setTaskId(id);
      setRemaining(FOCUS_MINUTES * 60);
      setRunning(true);
      startedRef.current = Date.now();
      accumRef.current = 0;
      try {
        if ("Notification" in window && Notification.permission === "default") {
          Notification.requestPermission();
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("fluxo:focus-start", handler as EventListener);
    return () => window.removeEventListener("fluxo:focus-start", handler as EventListener);
  }, []);

  useEffect(() => {
    if (!running || taskId === null) return;
    const id = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          window.clearInterval(id);
          finish(true);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, taskId]);

  const task = useMemo(() => tasks.find((t) => t.id === taskId), [tasks, taskId]);

  const finish = useCallback(
    (completed: boolean) => {
      if (!taskId) return;
      const totalElapsed =
        accumRef.current +
        (startedRef.current ? Math.floor((Date.now() - startedRef.current) / 1000) : 0);
      const minutes = Math.max(1, Math.round(totalElapsed / 60));
      addFocusEntry(currentUser.id, {
        taskId,
        minutes,
        endedAt: Date.now(),
      });
      setRunning(false);
      setTaskId(null);
      startedRef.current = null;
      accumRef.current = 0;
      if (completed) {
        try {
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Pomodoro concluído", {
              body: `${minutes}min de foco. Hora de uma pausa.`,
            });
          }
          // Suave beep
          const ctx = new (window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "sine";
          o.frequency.value = 660;
          g.gain.value = 0.15;
          o.connect(g).connect(ctx.destination);
          o.start();
          setTimeout(() => {
            o.stop();
            ctx.close().catch(() => {});
          }, 300);
        } catch {
          /* ignore */
        }
        toast.success(`Pomodoro concluído (${minutes}min) — pausa de 5min?`, {
          icon: <Coffee className="h-4 w-4" />,
          duration: 6000,
        });
      } else {
        toast(`Foco interrompido — ${minutes}min registrados`);
      }
    },
    [taskId, currentUser.id],
  );

  const togglePause = () => {
    setRunning((r) => {
      const next = !r;
      if (next) {
        startedRef.current = Date.now();
      } else if (startedRef.current) {
        accumRef.current += Math.floor((Date.now() - startedRef.current) / 1000);
        startedRef.current = null;
      }
      return next;
    });
  };

  if (!taskId || !task) return null;

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const pct = 1 - remaining / (FOCUS_MINUTES * 60);

  return (
    <div className="fixed inset-0 z-[220] flex flex-col items-center justify-center bg-background/95 backdrop-blur-md">
      <button
        onClick={() => finish(false)}
        className="absolute right-4 top-4 rounded-md p-2 text-muted-foreground hover:bg-secondary"
        title="Encerrar foco"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="mb-6 text-center">
        <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
          Modo foco
        </div>
        <div className="text-2xl font-semibold">{task.title}</div>
      </div>

      <div className="relative flex h-56 w-56 items-center justify-center">
        <svg viewBox="0 0 100 100" className="absolute inset-0">
          <circle cx="50" cy="50" r="46" className="fill-none stroke-secondary" strokeWidth="6" />
          <circle
            cx="50"
            cy="50"
            r="46"
            className="fill-none stroke-primary transition-all"
            strokeWidth="6"
            strokeDasharray={2 * Math.PI * 46}
            strokeDashoffset={2 * Math.PI * 46 * (1 - pct)}
            transform="rotate(-90 50 50)"
            strokeLinecap="round"
          />
        </svg>
        <div className="text-center">
          <div className="font-mono text-5xl font-bold tabular-nums">
            {mm}:{ss}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {running ? "concentrado" : "pausado"}
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <button
          onClick={togglePause}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
        >
          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {running ? "Pausar" : "Retomar"}
        </button>
        <button
          onClick={() => {
            updateTask(task.id, { status: "concluida" });
            finish(true);
          }}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary"
        >
          <CheckCircle2 className="h-4 w-4" /> Concluir tarefa
        </button>
        <button
          onClick={() => finish(false)}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary"
        >
          Parar
        </button>
      </div>

      {task.checklist.length > 0 && (
        <div className="mt-8 w-full max-w-md rounded-lg border border-border bg-card p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Checklist
          </div>
          <ul className="space-y-1.5">
            {task.checklist.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={c.done}
                  onChange={() => toggleChecklistItem(task.id, c.id)}
                  className="h-4 w-4 rounded border-border"
                />
                <span className={c.done ? "text-muted-foreground line-through" : ""}>
                  {c.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 text-[11px] text-muted-foreground">
        Notificações e sons foram silenciados durante o foco.
      </div>
    </div>
  );
}

export function startFocus(taskId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("fluxo:focus-start", { detail: { taskId } }));
}

export function useIsFocusActive() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const on = () => setActive(true);
    const off = () => setActive(false);
    window.addEventListener("fluxo:focus-start", on);
    window.addEventListener("fluxo:focus-end", off);
    return () => {
      window.removeEventListener("fluxo:focus-start", on);
      window.removeEventListener("fluxo:focus-end", off);
    };
  }, []);
  return active;
}