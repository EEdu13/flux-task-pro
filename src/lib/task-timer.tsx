import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFluxo } from "./fluxo-store";
import { appendSession, loadTimeLog, saveTimeLog, type TimerSession } from "./time-log";

interface RunningState {
  taskId: string;
  startedAt: number; // ms
  paused: boolean;
  // seconds accumulated in current work-session (across pauses)
  sessionAccum: number;
}

interface Ctx {
  activeTaskId: string | null;
  paused: boolean;
  // ticks every second when running for the current task
  elapsedActive: number;
  totals: Record<string, number>;
  totalFor: (taskId: string) => number;
  play: (taskId: string) => void;
  pause: () => void;
  stop: () => void;
  toggle: (taskId: string) => void;
}

const TimerCtx = createContext<Ctx | null>(null);

const rid = () => `tl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function TaskTimerProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useFluxo();
  const userId = currentUser.id;
  const [running, setRunning] = useState<RunningState | null>(null);
  const [totals, setTotals] = useState<Record<string, number>>(() => loadTimeLog(userId).totals);
  const [tick, setTick] = useState(0);
  const runningRef = useRef<RunningState | null>(null);
  runningRef.current = running;

  // Reload totals when the current user changes
  useEffect(() => {
    setTotals(loadTimeLog(userId).totals);
    // don't auto-pause if user id "changes" only by re-render; safety: stop existing
    setRunning(null);
  }, [userId]);

  /* O banco é a verdade — o local é o que aparece antes dele responder.
     Ao trocar de computador o total local nasce zerado; esta busca o corrige
     assim que a resposta chega. Some quando não há sessão real: sem ela não
     há como o servidor saber de quem é o tempo. */
  useEffect(() => {
    // O id da pessoa é o número da IAM em texto — não um GUID de tarefa.
    // Vazio ou não numérico é o placeholder de ninguém logado ainda.
    if (!userId || !Number.isInteger(Number(userId))) return;
    let vivo = true;
    void (async () => {
      try {
        const { listarSessoesDeTempo } = await import("./tempo.functions");
        const { sessoes } = await listarSessoesDeTempo();
        if (!vivo) return;
        const doServidor: Record<string, number> = {};
        for (const s of sessoes) {
          if (s.pessoaId !== userId) continue;
          doServidor[s.taskId] = (doServidor[s.taskId] ?? 0) + s.seconds;
        }
        setTotals((prev) => ({ ...prev, ...doServidor }));
      } catch (e) {
        console.warn("[fluxo] tempo não carregou do banco:", (e as Error)?.message);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [userId]);

  // Refresh totals when time log is updated from other sources
  useEffect(() => {
    const on = () => setTotals(loadTimeLog(userId).totals);
    window.addEventListener("fluxo:timer-updated", on);
    return () => window.removeEventListener("fluxo:timer-updated", on);
  }, [userId]);

  // 1s tick while running (not paused)
  useEffect(() => {
    if (!running || running.paused) return;
    const id = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsedActive = useMemo(() => {
    if (!running) return 0;
    if (running.paused) return running.sessionAccum;
    return running.sessionAccum + Math.floor((Date.now() - running.startedAt) / 1000);
    // tick forces recompute
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, tick]);

  const commit = useCallback(
    (state: RunningState) => {
      const now = Date.now();
      const extra = state.paused ? 0 : Math.floor((now - state.startedAt) / 1000);
      const seconds = state.sessionAccum + extra;
      if (seconds < 1) return;
      const session: TimerSession = {
        id: rid(),
        taskId: state.taskId,
        startedAt: now - seconds * 1000,
        endedAt: now,
        seconds,
      };
      appendSession(userId, session);
      setTotals((prev) => ({
        ...prev,
        [state.taskId]: (prev[state.taskId] ?? 0) + seconds,
      }));

      // Só sobe ao banco quem tem tarefa de banco: uma sessão apontando para
      // uma tarefa do formato antigo daria erro de formato no servidor.
      if (/^[0-9a-f-]{36}$/i.test(state.taskId)) {
        void import("./tempo.functions")
          .then((api) =>
            api.registrarSessaoDeTempo({
              data: {
                tarefaId: state.taskId,
                iniciouEm: new Date(session.startedAt).toISOString(),
                encerrouEm: new Date(session.endedAt).toISOString(),
              },
            }),
          )
          .catch((e) => console.warn("[fluxo] sessão de tempo não gravou:", (e as Error)?.message));
      }
    },
    [userId],
  );

  const play = useCallback(
    (taskId: string) => {
      const cur = runningRef.current;
      if (cur && cur.taskId === taskId && cur.paused) {
        setRunning({ ...cur, paused: false, startedAt: Date.now() });
        return;
      }
      if (cur && cur.taskId !== taskId) {
        commit(cur);
      }
      setRunning({ taskId, startedAt: Date.now(), paused: false, sessionAccum: 0 });
    },
    [commit],
  );

  const pause = useCallback(() => {
    const cur = runningRef.current;
    if (!cur || cur.paused) return;
    const extra = Math.floor((Date.now() - cur.startedAt) / 1000);
    setRunning({ ...cur, paused: true, sessionAccum: cur.sessionAccum + extra });
  }, []);

  const stop = useCallback(() => {
    const cur = runningRef.current;
    if (!cur) return;
    commit(cur);
    setRunning(null);
  }, [commit]);

  const toggle = useCallback(
    (taskId: string) => {
      const cur = runningRef.current;
      if (cur && cur.taskId === taskId && !cur.paused) {
        pause();
      } else {
        play(taskId);
      }
    },
    [pause, play],
  );

  // Persist totals in a defensive way in case we ever bypass appendSession
  useEffect(() => {
    const data = loadTimeLog(userId);
    if (JSON.stringify(data.totals) !== JSON.stringify(totals)) {
      saveTimeLog(userId, { ...data, totals });
    }
  }, [totals, userId]);

  // Auto-commit if the tab is closing
  useEffect(() => {
    const onUnload = () => {
      const cur = runningRef.current;
      if (cur) commit(cur);
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [commit]);

  const value: Ctx = {
    activeTaskId: running?.taskId ?? null,
    paused: !!running?.paused,
    elapsedActive,
    totals,
    totalFor: (taskId: string) => {
      const base = totals[taskId] ?? 0;
      if (running && running.taskId === taskId) return base + elapsedActive;
      return base;
    },
    play,
    pause,
    stop,
    toggle,
  };

  return <TimerCtx.Provider value={value}>{children}</TimerCtx.Provider>;
}

export function useTaskTimer(): Ctx {
  const c = useContext(TimerCtx);
  if (!c) throw new Error("useTaskTimer must be used inside TaskTimerProvider");
  return c;
}