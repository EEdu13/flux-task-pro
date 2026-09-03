import { useEffect, useRef, useState } from "react";
import { useFluxo } from "@/lib/fluxo-store";
import { desktopBringToFront, desktopFlashTaskbar } from "@/lib/desktop";
import { listNudgesFn, sendNudgeFn, type TipoAviso } from "@/lib/attention.functions";
import { triggerTractor } from "@/components/tractor-banner";

interface AttnEvent {
  fromName: string;
  fromAvatar?: string;
}

export function AttentionOverlay() {
  const [current, setCurrent] = useState<AttnEvent | null>(null);
  const { currentUser, isAuthenticated } = useFluxo();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AttnEvent>).detail;
      if (!detail) return;
      setCurrent(detail);
      try {
        window.focus();
        if (window.parent && window.parent !== window) window.parent.focus();
        if (window.top && window.top !== window) window.top.focus();
      } catch {
        /* ignore cross-origin */
      }
      flashTitle(`🔔 ${detail.fromName} chamou sua atenção!`);
      playNudgeSound();
      // No app desktop: puxa a janela pra frente e pisca a barra (estilo MSN).
      // Sem toast do Windows — o overlay do app já é a notificação visual.
      void desktopBringToFront();
      void desktopFlashTaskbar();
      const root = document.documentElement;
      root.classList.remove("fluxo-nudge-shake");
      // force reflow to restart the animation
      void root.offsetWidth;
      root.classList.add("fluxo-nudge-shake");
      window.setTimeout(() => root.classList.remove("fluxo-nudge-shake"), 750);
      window.setTimeout(() => setCurrent(null), 4200);
    };
    window.addEventListener("fluxo:attention", handler as EventListener);
    return () => window.removeEventListener("fluxo:attention", handler as EventListener);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    // Register a tiny service worker so we can use
    // registration.showNotification — this is what actually makes Windows
    // flash the Chrome icon on the taskbar.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/fluxo-nudge-sw.js")
        .catch(() => {});
    }
  }, []);

  // Recebe cutucadas por polling no nosso backend (Azure SQL).
  // Trocamos o realtime do Supabase por esta sondagem porque é a mesma
  // mecânica das chamadas — que funciona de forma confiável entre máquinas.
  const seenRef = useRef<Set<string>>(new Set());
  /**
   * A primeira sondagem só anota o que já existe, sem exibir. Sem isso, abrir a
   * tela replicaria os avisos do último minuto — e recarregar a página faria
   * tudo tocar de novo.
   */
  const primeiraRef = useRef(true);
  useEffect(() => {
    if (!isAuthenticated || !currentUser?.id) return;
    let cancelled = false;
    seenRef.current = new Set();
    primeiraRef.current = true;

    async function poll() {
      try {
        const res = await listNudgesFn({ data: {} });
        if (cancelled) return;
        // Do mais antigo para o mais novo, para a ordem fazer sentido.
        const list = [...(res.nudges ?? [])].reverse();
        const apenasAnotar = primeiraRef.current;
        primeiraRef.current = false;

        for (const n of list) {
          const id = String(n.id);
          if (seenRef.current.has(id)) continue;
          seenRef.current.add(id);
          if (apenasAnotar) continue;

          // Mesma sondagem serve aos dois avisos: o tipo decide o que aparece.
          if (n.kind === "trator" && n.message) {
            triggerTractor({ message: `${n.from_name}: ${n.message}` });
            continue;
          }
          window.dispatchEvent(
            new CustomEvent("fluxo:attention", {
              detail: { fromName: n.from_name, fromAvatar: n.from_avatar ?? undefined },
            }),
          );
        }

        // A janela é de 60s e a memória cresce só com o que passou por ela.
        if (seenRef.current.size > 200) seenRef.current = new Set();
      } catch {
        /* rede instável: tenta de novo no próximo ciclo */
      }
    }

    void poll();
    // 1s: a consulta é leve e o "chamar atenção" precisa ser imediato.
    const id = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [currentUser?.id, isAuthenticated]);

  if (!current) return null;
  return (
    // z-460: a chamada de atenção só serve se for vista. É pointer-events-none
    // (não bloqueia nada), então pode ficar acima do diálogo (420) e do foco
    // (440) sem atrapalhar o que a pessoa está fazendo.
    <div className="pointer-events-none fixed inset-0 z-460 flex items-center justify-center">
      <div className="fluxo-attn-pop flex flex-col items-center gap-3">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-primary via-lime-400 to-amber-300 text-3xl font-black text-white shadow-[0_20px_80px_-10px_oklch(0.44_0.09_150/0.6)] ring-4 ring-white/40">
          {current.fromAvatar || current.fromName.slice(0, 1).toUpperCase()}
        </div>
        <div
          className="rounded-2xl bg-gradient-to-r from-primary via-lime-500 to-amber-400 px-8 py-4 text-center text-3xl font-black uppercase tracking-tight text-white shadow-2xl md:text-5xl"
          style={{ textShadow: "0 4px 24px oklch(0.2 0.02 260 / 0.5)" }}
        >
          {current.fromName}
          <div className="text-sm font-semibold tracking-widest opacity-90 md:text-base">
            chamou sua atenção!
          </div>
        </div>
      </div>
    </div>
  );
}

export function triggerAttention(fromName: string, fromAvatar?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("fluxo:attention", { detail: { fromName, fromAvatar } }),
  );
}

// ---------- MSN-style nudge sound (synthesized via Web Audio) ----------

let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

export function playNudgeSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  // Two quick knocks + a rising chirp — MSN-ish nudge
  const now = ctx.currentTime;
  const knock = (t: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.14);
  };
  knock(now);
  knock(now + 0.16);
  const chirp = ctx.createOscillator();
  const cg = ctx.createGain();
  chirp.type = "triangle";
  chirp.frequency.setValueAtTime(660, now + 0.34);
  chirp.frequency.exponentialRampToValueAtTime(1320, now + 0.55);
  cg.gain.setValueAtTime(0.0001, now + 0.34);
  cg.gain.exponentialRampToValueAtTime(0.25, now + 0.36);
  cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
  chirp.connect(cg).connect(ctx.destination);
  chirp.start(now + 0.34);
  chirp.stop(now + 0.62);
}

// ---------- Tab flashing + OS notifications ----------

let flashTimer: number | null = null;
let originalTitle: string | null = null;

function stopFlashing() {
  if (flashTimer !== null) {
    window.clearInterval(flashTimer);
    flashTimer = null;
  }
  if (originalTitle !== null) {
    document.title = originalTitle;
    originalTitle = null;
  }
}

export function flashTitle(message: string, durationMs = 8000) {
  if (typeof document === "undefined") return;
  if (originalTitle === null) originalTitle = document.title;
  const base = originalTitle;
  let on = false;
  if (flashTimer !== null) window.clearInterval(flashTimer);
  flashTimer = window.setInterval(() => {
    on = !on;
    document.title = on ? message : base;
  }, 800);
  const stopWhenVisible = () => {
    if (!document.hidden) {
      stopFlashing();
      document.removeEventListener("visibilitychange", stopWhenVisible);
      window.removeEventListener("focus", stopWhenVisible);
    }
  };
  document.addEventListener("visibilitychange", stopWhenVisible);
  window.addEventListener("focus", stopWhenVisible);
  window.setTimeout(stopFlashing, durationMs);
}

export function showNudgeNotification(fromName: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (!document.hidden && document.hasFocus()) return;
  // Prefer the ServiceWorker path — on Windows this is what actually makes
  // Chrome flash its taskbar icon in orange/red.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistration("/fluxo-nudge-sw.js").then((reg) => {
      if (!reg) return fallbackNotification(fromName);
      reg.showNotification("Fluxo", {
        body: `${fromName} chamou sua atenção!`,
        tag: "fluxo-nudge",
        renotify: true,
        requireInteraction: true,
        silent: false,
      } as NotificationOptions).catch(() => fallbackNotification(fromName));
    }).catch(() => fallbackNotification(fromName));
    return;
  }
  fallbackNotification(fromName);
}

function fallbackNotification(fromName: string) {
  try {
    const n = new Notification("Fluxo", {
      body: `${fromName} chamou sua atenção!`,
      tag: "fluxo-nudge",
      renotify: true,
      requireInteraction: true,
      silent: false,
    } as NotificationOptions);
    n.onclick = () => {
      try {
        window.focus();
        if (window.parent && window.parent !== window) window.parent.focus();
        if (window.top && window.top !== window) window.top.focus();
      } catch {
        /* ignore */
      }
      n.close();
    };
    // keep notification longer so Windows keeps flashing the taskbar
    window.setTimeout(() => n.close(), 20000);
  } catch {
    /* ignore */
  }
}

/**
 * Envia um aviso para outro usuário, gravando no nosso backend (Azure SQL).
 * O destinatário recebe na próxima sondagem (até ~1s).
 *
 * Com `kind: "trator"` e uma mensagem, o trator atravessa a tela dele puxando
 * a faixa; sem isso, é a cutucada de sempre.
 */
export async function sendNudge(
  targetUserId: string,
  fromName: string,
  fromAvatar?: string,
  fromUserId?: string,
  kind: TipoAviso = "cutucada",
  message?: string,
) {
  if (!fromUserId) throw new Error("Remetente inválido");
  await sendNudgeFn({
    data: { fromName, fromAvatar, targetUserId, kind, message },
  });
}