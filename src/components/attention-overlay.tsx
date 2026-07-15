import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useFluxo } from "@/lib/fluxo-store";

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
      showNudgeNotification(detail.fromName);
      const root = document.documentElement;
      root.classList.remove("fluxo-nudge-shake");
      // force reflow to restart the animation
      void root.offsetWidth;
      root.classList.add("fluxo-nudge-shake");
      window.setTimeout(() => root.classList.remove("fluxo-nudge-shake"), 750);
      window.setTimeout(() => setCurrent(null), 1900);
    };
    window.addEventListener("fluxo:attention", handler as EventListener);
    return () => window.removeEventListener("fluxo:attention", handler as EventListener);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Subscribe to a Supabase realtime channel scoped to this user so nudges
  // sent from other tabs / other users actually reach *this* device.
  useEffect(() => {
    if (!isAuthenticated || !currentUser?.id) return;
    const ch = supabase.channel(`attention:${currentUser.id}`, {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "nudge" }, (payload) => {
      const p = payload.payload as AttnEvent | undefined;
      if (!p) return;
      window.dispatchEvent(
        new CustomEvent("fluxo:attention", { detail: p }),
      );
    });
    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [currentUser?.id, isAuthenticated]);

  if (!current) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center">
      <div className="fluxo-attn-pop flex flex-col items-center gap-3">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-primary via-fuchsia-500 to-amber-400 text-3xl font-black text-white shadow-[0_20px_80px_-10px_oklch(0.52_0.22_275/0.6)] ring-4 ring-white/40">
          {current.fromAvatar || current.fromName.slice(0, 1).toUpperCase()}
        </div>
        <div
          className="rounded-2xl bg-gradient-to-r from-primary via-fuchsia-600 to-amber-500 px-8 py-4 text-center text-3xl font-black uppercase tracking-tight text-white shadow-2xl md:text-5xl"
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

// Send a nudge to another user via Supabase realtime broadcast. Returns a
// promise that resolves when the message has been queued.
export async function sendNudge(
  targetUserId: string,
  fromName: string,
  fromAvatar?: string,
) {
  const ch = supabase.channel(`attention:${targetUserId}`, {
    config: { broadcast: { self: false, ack: true } },
  });
  await new Promise<void>((resolve) => {
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
    // safety timeout
    window.setTimeout(() => resolve(), 1500);
  });
  try {
    await ch.send({
      type: "broadcast",
      event: "nudge",
      payload: { fromName, fromAvatar },
    });
  } finally {
    window.setTimeout(() => supabase.removeChannel(ch), 500);
  }
}