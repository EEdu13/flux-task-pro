/*
 * avisos-de-gesto.tsx — pills âmbar "Eduardo levantou a mão ✋" logo acima da barra de controles.
 *
 * Por que pill e não toast: o aviso precisa ficar PERTO da sala (é sobre quem está na mesa) e
 * sumir sozinho sem empilhar — no máximo 2 visíveis, cada um por DURACAO_AVISO_MS. O integrador
 * decide QUAIS avisos existem (mão levantada, sua vez, entrou/saiu); aqui só se desenha.
 */
import { useEffect, useState } from "react";
import { DURACAO_AVISO_MS } from "../sala/tipos";
import "./gestos.css";

export interface AvisoDeGesto {
  id: string;
  texto: string;
  emoji: string;
  /** Date.now() de quando o aviso nasceu. */
  desde: number;
}

const MAX_VISIVEIS = 2;
const SAIDA_MS = 300;

export function AvisosDeGesto({ avisos }: { avisos: AvisoDeGesto[] }) {
  const [agora, setAgora] = useState(() => Date.now());
  const temVivo = avisos.some((a) => agora - a.desde < DURACAO_AVISO_MS);

  // Relógio só enquanto há aviso vivo: troca para "saindo" e depois tira da tela.
  useEffect(() => {
    setAgora(Date.now());
    if (!avisos.length) return;
    const id = setInterval(() => setAgora(Date.now()), 100);
    return () => clearInterval(id);
  }, [avisos]);

  if (!temVivo) return null;
  const visiveis = avisos
    .filter((a) => agora - a.desde < DURACAO_AVISO_MS)
    .sort((a, b) => a.desde - b.desde)
    .slice(-MAX_VISIVEIS);

  return (
    <div
      className="pointer-events-none flex flex-col items-center gap-2"
      role="status"
      aria-live="polite"
    >
      {visiveis.map((a) => (
        <div
          key={a.id}
          className="rv-aviso-gesto rounded-full bg-[#f59e0b] px-4 py-1.5 text-[14px] font-semibold text-black shadow-lg"
          data-saindo={agora - a.desde >= DURACAO_AVISO_MS - SAIDA_MS}
        >
          {a.texto}
          {a.emoji && !a.texto.includes(a.emoji) ? ` ${a.emoji}` : ""}
        </div>
      ))}
    </div>
  );
}
