import { useEffect, useRef } from "react";
import { getLastPointer } from "@/components/interaction-fx";

/**
 * Comemoração ao concluir uma tarefa. Sorteia 1 de 5 animações felizes ao
 * receber o evento `fluxo:celebrate`. Camada com pointer-events: none.
 */
const CONFETTI = ["#a3e635", "#22c55e", "#38bdf8", "#fbbf24", "#fb7185", "#ffffff", "#84cc16"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const rand = (min: number, max: number) => min + Math.random() * (max - min);

export function Celebration() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const handler = () => {
      const layer = layerRef.current;
      if (!layer || reduce) return;
      const effects = [confettiRain, lineFireworks, rocket, starsRise, centerPop];
      pick(effects)(layer);
    };
    // Estouro em ponto específico — usado quando algo pequeno aparece na tela
    // (a foto no login, por exemplo) e o sorteio de tela cheia seria demais.
    const handlerAt = (e: Event) => {
      const layer = layerRef.current;
      if (!layer || reduce) return;
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail ?? { x: 0, y: 0 };
      burstAt(layer, x, y);
    };

    window.addEventListener("fluxo:celebrate", handler);
    window.addEventListener("fluxo:celebrate-at", handlerAt);
    return () => {
      window.removeEventListener("fluxo:celebrate", handler);
      window.removeEventListener("fluxo:celebrate-at", handlerAt);
    };
  }, []);

  return <div ref={layerRef} className="fx-celebrate-layer" aria-hidden />;
}

/** Utilitário: cria um elemento, adiciona à camada e agenda remoção. */
function spawn(layer: HTMLElement, className: string, life: number): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = className;
  layer.appendChild(el);
  window.setTimeout(() => el.remove(), life);
  return el;
}

/* 1) Chuva de confete na tela inteira */
function confettiRain(layer: HTMLElement) {
  for (let i = 0; i < 90; i++) {
    const p = spawn(layer, "cel-confetti", 4200);
    const size = rand(6, 12);
    p.style.left = `${rand(0, 100)}vw`;
    p.style.width = `${size}px`;
    p.style.height = `${size * rand(0.5, 1)}px`;
    p.style.background = pick(CONFETTI);
    p.style.setProperty("--drift", `${rand(-120, 120)}px`);
    p.style.setProperty("--rot", `${rand(-720, 720)}deg`);
    p.style.setProperty("--dur", `${rand(2.4, 4)}s`);
    p.style.setProperty("--d", `${rand(0, 700)}ms`);
    if (Math.random() > 0.5) p.style.borderRadius = "50%";
  }
}

/* 2) Fogos saindo da linha da tarefa (onde você clicou) */
function lineFireworks(layer: HTMLElement) {
  const { x, y } = getLastPointer();
  for (let i = 0; i < 50; i++) {
    const p = spawn(layer, "cel-burst", 1300);
    const angle = rand(0, Math.PI * 2);
    const dist = rand(40, 150);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = pick(CONFETTI);
    p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    p.style.setProperty("--dur", `${rand(0.7, 1.1)}s`);
  }
}

/* 3) Foguete cruzando a tela */
function rocket(layer: HTMLElement) {
  const startX = rand(10, 40);
  const r = spawn(layer, "cel-rocket", 1600);
  r.textContent = "🚀";
  r.style.left = `${startX}vw`;
  r.style.setProperty("--tx", `${rand(40, 80)}vw`);
  // Explosão no fim do trajeto
  window.setTimeout(() => {
    const bx = window.innerWidth * (startX / 100 + rand(0.3, 0.55));
    const by = window.innerHeight * 0.2;
    for (let i = 0; i < 40; i++) {
      const p = spawn(layer, "cel-burst", 1200);
      const angle = rand(0, Math.PI * 2);
      const dist = rand(30, 120);
      p.style.left = `${bx}px`;
      p.style.top = `${by}px`;
      p.style.background = pick(CONFETTI);
      p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
      p.style.setProperty("--dur", "0.9s");
    }
  }, 1050);
}

/* 4) Estrelas subindo do rodapé */
function starsRise(layer: HTMLElement) {
  for (let i = 0; i < 34; i++) {
    const s = spawn(layer, "cel-star", 3400);
    s.textContent = pick(["✦", "✧", "⭐", "🌟", "✨"]);
    s.style.left = `${rand(0, 100)}vw`;
    s.style.fontSize = `${rand(12, 26)}px`;
    s.style.setProperty("--sway", `${rand(-60, 60)}px`);
    s.style.setProperty("--dur", `${rand(2.2, 3.2)}s`);
    s.style.setProperty("--d", `${rand(0, 900)}ms`);
  }
}

/* 5) Selo central "Concluída!" + explosão radial */
function centerPop(layer: HTMLElement) {
  const badge = spawn(layer, "cel-badge", 1800);
  badge.textContent = pick(["Concluída! 🎉", "Mandou bem! 💪", "Feito! ✅", "Boa! 🙌"]);
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  for (let i = 0; i < 46; i++) {
    const p = spawn(layer, "cel-burst", 1300);
    const angle = (Math.PI * 2 * i) / 46;
    const dist = rand(80, 190);
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    p.style.background = pick(CONFETTI);
    p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    p.style.setProperty("--dur", `${rand(0.8, 1.2)}s`);
  }
}

/* 6) Estouro radial contido, em torno de um ponto dado */
function burstAt(layer: HTMLElement, x: number, y: number) {
  for (let i = 0; i < 34; i++) {
    const p = spawn(layer, "cel-burst", 1200);
    const angle = (Math.PI * 2 * i) / 34 + rand(-0.15, 0.15);
    const dist = rand(50, 130);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = pick(CONFETTI);
    p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    p.style.setProperty("--dur", `${rand(0.7, 1.1)}s`);
  }
}

/** Dispara a comemoração (usado pelo store ao concluir uma tarefa). */
export function celebrate() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("fluxo:celebrate"));
}

/** Estouro contido em torno de um ponto da tela (coordenadas de viewport). */
export function celebrateAt(x: number, y: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("fluxo:celebrate-at", { detail: { x, y } }));
}
