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
import { toast } from "sonner";
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

/* O cronômetro em andamento fica guardado neste computador (22/10/2026: o
   notebook da Milena desligou sozinho com o tempo correndo, e o tempo sumiu).
   Antes ele vivia só na memória da tela: pausar não gravava, e um desligamento
   ou uma queda de energia levava a sessão inteira. Agora o estado é guardado a
   cada mudança e recebe um "sinal de vida" a cada 20 s. Ao abrir de novo, o
   cronômetro volta pausado com o tempo contado até o último sinal — o tempo em
   que o computador ficou desligado não entra. */
const SINAL_MS = 20_000;
const chaveDoCronometro = (pessoa: string) => `fluxo:cronometro:${pessoa}`;
type CronometroGuardado = RunningState & { sinal: number };

function guardarCronometro(pessoa: string, estado: RunningState | null) {
  if (!pessoa) return;
  try {
    if (!estado) window.localStorage.removeItem(chaveDoCronometro(pessoa));
    else
      window.localStorage.setItem(
        chaveDoCronometro(pessoa),
        JSON.stringify({ ...estado, sinal: Date.now() } satisfies CronometroGuardado),
      );
  } catch {
    /* sem armazenamento: o cronômetro funciona, só não sobrevive a uma queda */
  }
}

function lerCronometro(pessoa: string): CronometroGuardado | null {
  if (!pessoa) return null;
  try {
    const bruto = window.localStorage.getItem(chaveDoCronometro(pessoa));
    if (!bruto) return null;
    const c = JSON.parse(bruto) as Partial<CronometroGuardado>;
    if (
      typeof c.taskId !== "string" ||
      typeof c.startedAt !== "number" ||
      typeof c.sessionAccum !== "number" ||
      typeof c.sinal !== "number"
    )
      return null;
    return c as CronometroGuardado;
  } catch {
    return null;
  }
}

const rid = () => `tl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function TaskTimerProvider({ children }: { children: ReactNode }) {
  const { currentUser, tasks } = useFluxo();
  const userId = currentUser.id;
  const [running, setRunning] = useState<RunningState | null>(null);
  const [totals, setTotals] = useState<Record<string, number>>(() => loadTimeLog(userId).totals);
  const [tick, setTick] = useState(0);
  const runningRef = useRef<RunningState | null>(null);
  runningRef.current = running;

  /* Ao entrar (ou trocar de pessoa): o cronômetro que ficou guardado volta,
     pausado, com o tempo contado até o último sinal de vida. */
  const tarefasRef = useRef(tasks);
  tarefasRef.current = tasks;
  useEffect(() => {
    setTotals(loadTimeLog(userId).totals);
    const guardado = lerCronometro(userId);
    if (!guardado) {
      setRunning(null);
      return;
    }
    const segundos = guardado.paused
      ? guardado.sessionAccum
      : guardado.sessionAccum +
        Math.max(0, Math.floor((guardado.sinal - guardado.startedAt) / 1000));
    setRunning({
      taskId: guardado.taskId,
      startedAt: Date.now(),
      paused: true,
      sessionAccum: segundos,
    });
    if (!guardado.paused && segundos >= 60) {
      const titulo = tarefasRef.current.find((t) => t.id === guardado.taskId)?.title;
      const h = Math.floor(segundos / 3600);
      const m = Math.floor((segundos % 3600) / 60);
      toast.info("O cronômetro foi recuperado", {
        description: `${titulo ? `"${titulo}" · ` : ""}${h ? `${h}h ` : ""}${m}min até o computador desligar. Dê play para continuar de onde parou.`,
        duration: 12_000,
      });
    }
  }, [userId]);

  // Guarda a cada mudança, e o sinal de vida enquanto corre.
  useEffect(() => {
    guardarCronometro(userId, running);
    if (!running || running.paused) return;
    const id = window.setInterval(() => guardarCronometro(userId, runningRef.current), SINAL_MS);
    return () => window.clearInterval(id);
  }, [running, userId]);

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
      /* appendSession grava o total certo no localStorage e, ao gravar,
         dispara "fluxo:timer-updated" — o efeito abaixo escuta esse evento e
         recarrega `totals` dali. Somar `seconds` aqui também dobrava a conta:
         o React aplica os dois setTotals em sequência, e o segundo somava em
         cima do valor que o evento já tinha corrigido (5 min virava 10). */
      appendSession(userId, session);

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
          .then(() => {
            /* O mesmo evento, de novo — agora que a linha existe no banco.
               `appendSession` já o emitiu uma vez, mas Relatórios responde a
               ele buscando no servidor, e naquele instante a gravação ainda
               estava no ar: a tela recarregaria sem a sessão que acabou de
               fechar e só a mostraria na próxima visita. */
            window.dispatchEvent(new CustomEvent("fluxo:timer-updated"));
          })
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

  /* Fechou a aba normalmente: grava a sessão e esquece o guardado — senão ela
     voltaria ao abrir e contaria duas vezes. Desligamento ou queda de energia
     não chegam aqui; aí vale o guardado (ver acima). */
  useEffect(() => {
    const onUnload = () => {
      const cur = runningRef.current;
      if (cur) {
        commit(cur);
        guardarCronometro(userId, null);
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [commit, userId]);

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
