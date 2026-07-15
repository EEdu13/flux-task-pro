import { useEffect, useState } from "react";

interface AttnEvent {
  fromName: string;
  fromAvatar?: string;
}

export function AttentionOverlay() {
  const [current, setCurrent] = useState<AttnEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AttnEvent>).detail;
      if (!detail) return;
      setCurrent(detail);
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