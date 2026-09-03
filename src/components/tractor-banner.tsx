import { useEffect, useState } from "react";
import larsilLogo from "@/assets/larsil-logo.png";

/**
 * Trator da Larsil atravessando a tela puxando uma faixa — no estilo do
 * aviãozinho de praia com publicidade. Dispara ao receber o evento
 * `fluxo:tractor` (com { message?, durationSec? }); atravessa uma vez e some.
 */
export interface TractorEventDetail {
  message?: string;
  durationSec?: number;
}

interface Travessia {
  key: number;
  message: string;
  dur: number;
  /** Faixa vertical: 0 é a de cima. Evita um trator por cima do outro. */
  faixa: number;
}

/** Quantos cabem na tela ao mesmo tempo sem virar bagunça. */
const MAX_FAIXAS = 3;
/** Distância entre faixas — o trator tem ~100px de altura mais a faixa. */
const ALTURA_FAIXA = 120;

let contadorChave = 0;

export function TractorBanner() {
  const [runs, setRuns] = useState<Travessia[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<TractorEventDetail>).detail ?? {};
      setRuns((atuais) => {
        // Cada trator ganha uma faixa livre em vez de sobrepor o anterior.
        // Cheio, o novo é descartado — quatro faixas simultâneas já tomariam
        // metade da tela e nenhuma seria legível.
        const ocupadas = new Set(atuais.map((r) => r.faixa));
        let faixa = -1;
        for (let i = 0; i < MAX_FAIXAS; i++) {
          if (!ocupadas.has(i)) {
            faixa = i;
            break;
          }
        }
        if (faixa === -1) return atuais;

        contadorChave += 1;
        return [
          ...atuais,
          {
            key: contadorChave,
            faixa,
            message: detail.message?.trim() || "Hora da pausa — beba água! 💧",
            dur: Math.min(60, Math.max(6, detail.durationSec ?? 16)),
          },
        ];
      });
    };
    window.addEventListener("fluxo:tractor", handler as EventListener);
    return () => window.removeEventListener("fluxo:tractor", handler as EventListener);
  }, []);

  if (runs.length === 0) return null;

  return (
    <div className="fluxo-tractor-layer" aria-hidden>
      {runs.map((run) => (
        <Convoy
          key={run.key}
          run={run}
          onEnd={() => setRuns((atuais) => atuais.filter((r) => r.key !== run.key))}
        />
      ))}
    </div>
  );
}

/** Uma travessia. Separado para o laço não empurrar todo o SVG um nível adentro. */
function Convoy({ run, onEnd }: { run: Travessia; onEnd: () => void }) {
  return (
      <div
        className="fluxo-tractor-convoy"
        style={{ animationDuration: `${run.dur}s`, top: run.faixa * ALTURA_FAIXA }}
        onAnimationEnd={onEnd}
      >
        {/* Faixa (trailer) */}
        <div className="fluxo-tractor-banner">
          <div className="fluxo-tractor-banner-fabric">
            <img src={larsilLogo} alt="Larsil" className="fluxo-tractor-logo" />
            <span className="fluxo-tractor-msg">{run.message}</span>
          </div>
          {/* franjas */}
          <span className="fluxo-tractor-tail" />
        </div>

        {/* Corda ligando faixa ao trator */}
        <svg className="fluxo-tractor-rope" viewBox="0 0 60 40" preserveAspectRatio="none">
          <path d="M0 20 Q 30 8 60 26" fill="none" stroke="oklch(0.35 0.02 150)" strokeWidth="2" />
        </svg>

        {/* Trator */}
        <div className="fluxo-tractor">
          {/* Fumaça do escapamento */}
          <span className="fluxo-tractor-smoke fluxo-tractor-smoke-1" />
          <span className="fluxo-tractor-smoke fluxo-tractor-smoke-2" />
          <span className="fluxo-tractor-smoke fluxo-tractor-smoke-3" />

          <svg viewBox="0 0 210 160" className="fluxo-tractor-svg">
            {/* Escapamento */}
            <rect x="104" y="24" width="9" height="34" rx="4" fill="#7a8a86" />
            <rect x="102" y="20" width="13" height="8" rx="4" fill="#8b9b96" />

            {/* Chassi / corpo base (uma peça sólida, evita buracos) */}
            <rect
              x="26"
              y="80"
              width="156"
              height="38"
              rx="14"
              fill="oklch(0.5 0.16 150)"
              stroke="oklch(0.32 0.08 150)"
              strokeWidth="3"
            />

            {/* Capô (frente) */}
            <path
              d="M110 72 h44 q22 0 22 22 v16 q0 6 -6 6 H110 Z"
              fill="oklch(0.5 0.16 150)"
              stroke="oklch(0.32 0.08 150)"
              strokeWidth="3"
              strokeLinejoin="round"
            />

            {/* Cabine */}
            <rect
              x="32"
              y="44"
              width="80"
              height="58"
              rx="12"
              fill="oklch(0.5 0.16 150)"
              stroke="oklch(0.32 0.08 150)"
              strokeWidth="3"
            />
            {/* Teto */}
            <rect x="26" y="38" width="92" height="11" rx="5" fill="oklch(0.55 0.15 150)" />

            {/* Janela */}
            <rect x="42" y="54" width="60" height="34" rx="8" fill="oklch(0.9 0.02 220)" opacity="0.9" />
            <rect x="69" y="54" width="5" height="34" fill="oklch(0.5 0.16 150)" />

            {/* Farol */}
            <circle cx="170" cy="94" r="6.5" fill="oklch(0.92 0.14 95)" stroke="oklch(0.32 0.08 150)" strokeWidth="2" />

            {/* Para-lama traseiro (fender) por cima da roda grande */}
            <path
              d="M34 120 A38 38 0 0 1 104 118"
              fill="none"
              stroke="oklch(0.6 0.16 150)"
              strokeWidth="9"
              strokeLinecap="round"
            />

            {/* Roda traseira (grande) — gira */}
            <g className="fluxo-wheel">
              <circle cx="69" cy="122" r="32" fill="#2a2a2a" />
              <circle cx="69" cy="122" r="32" fill="none" stroke="#111" strokeWidth="6" strokeDasharray="6 7" />
              <circle cx="69" cy="122" r="16" fill="#8a8f8c" />
              <circle cx="69" cy="122" r="7" fill="#c7ccc9" />
            </g>

            {/* Roda dianteira (pequena) — gira */}
            <g className="fluxo-wheel">
              <circle cx="153" cy="128" r="22" fill="#2a2a2a" />
              <circle cx="153" cy="128" r="22" fill="none" stroke="#111" strokeWidth="5" strokeDasharray="5 6" />
              <circle cx="153" cy="128" r="11" fill="#8a8f8c" />
              <circle cx="153" cy="128" r="5" fill="#c7ccc9" />
            </g>
          </svg>
        </div>
      </div>
  );
}

/** Dispara o trator programaticamente (botão de teste ou, no futuro, timer). */
export function triggerTractor(detail?: TractorEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("fluxo:tractor", { detail: detail ?? {} }));
}
