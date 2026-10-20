/*
 * O balão de um card sobre a cabeça de quem falou.
 *
 * Os TRÊS modos (completo, compacto, chip) e o expandido (hover, com o resumo)
 * ficam montados ao mesmo tempo, empilhados no mesmo canto; o Projetor só
 * troca o `data-modo` do invólucro. Por que montar todos: o Projetor precisa
 * do tamanho de cada modo para decidir o layout ANTES de mostrar, sem
 * setState nem getBoundingClientRect por quadro (o ResizeObserver mede os
 * escondidos, que usam visibility e não display).
 */
import { useState } from "react";
import { type CardNaSala, DURACAO_BALAO_MS, type TipoVisivel, VISUAL_DO_CARD } from "./tipos";
import { DURACAO_SAIDA_BALAO_MS } from "./medidas-da-sala";

export type ModoDoBalao = "completo" | "compacto" | "chip";
export const MODOS_DO_BALAO: ModoDoBalao[] = ["completo", "compacto", "chip"];

function Rabicho({ cor = "#ffffff" }: { cor?: string }) {
  return <span className="rv-rabicho" style={{ background: cor }} aria-hidden />;
}

function Chips({ card }: { card: CardNaSala["card"] }) {
  if (!card.responsavel && !card.prazo) return null;
  return (
    <div className="rv-balao-chips">
      {card.responsavel && <span className="rv-balao-chip">👤 {card.responsavel}</span>}
      {card.prazo && <span className="rv-balao-chip">📅 {card.prazo}</span>}
    </div>
  );
}

function Mais({ extras }: { extras: number }) {
  if (extras <= 0) return null;
  return (
    <span className="rv-balao-mais" aria-label={`mais ${extras} card${extras > 1 ? "s" : ""}`}>
      +{extras}
    </span>
  );
}

export function BalaoDeCard({
  item,
  extras,
  refDoModo,
  aoAbrir,
}: {
  item: CardNaSala;
  /** Outros cards vivos da mesma pessoa ("+N"). */
  extras: number;
  /** Registro de cada modo no Projetor (tamanho via ResizeObserver). */
  refDoModo: (modo: ModoDoBalao) => (el: HTMLElement | null) => void;
  aoAbrir: () => void;
}) {
  const { card } = item;
  const visual = VISUAL_DO_CARD[card.tipo as TipoVisivel] ?? VISUAL_DO_CARD.aviso;
  const emoji = card.emoji || visual.emoji;
  // O atraso da saída é fixado UMA vez por card (o componente tem key = id do
  // card): recalcular a cada render deslocaria a linha do tempo da animação.
  const [atrasoDaSaida] = useState(
    () => item.chegou + DURACAO_BALAO_MS - DURACAO_SAIDA_BALAO_MS - Date.now(),
  );
  const abrir = (e: React.MouseEvent) => {
    e.stopPropagation();
    aoAbrir();
  };
  const titulo = `${visual.rotulo} de ${item.autorNome}: ${card.titulo}`;

  return (
    <div
      className="rv-balao-anim"
      style={{ ["--rv-saida" as string]: `${Math.round(atrasoDaSaida)}ms` }}
    >
      <button
        type="button"
        ref={refDoModo("completo")}
        className="rv-var rv-var-completo"
        style={{ borderLeftColor: visual.cor }}
        onClick={abrir}
        aria-label={titulo}
      >
        <div className="rv-balao-linha">
          <span className="rv-balao-emoji">{emoji}</span>
          <span className="rv-balao-titulo rv-duas-linhas">{card.titulo}</span>
          <Mais extras={extras} />
        </div>
        <Chips card={card} />
        <Rabicho />
      </button>

      <button
        type="button"
        ref={refDoModo("compacto")}
        className="rv-var rv-var-compacto"
        style={{ borderLeftColor: visual.cor }}
        onClick={abrir}
        aria-label={titulo}
      >
        <span className="rv-balao-emoji rv-pequeno">{emoji}</span>
        <span className="rv-balao-titulo rv-uma-linha">{card.titulo}</span>
        <Mais extras={extras} />
        <Rabicho />
      </button>

      <button
        type="button"
        ref={refDoModo("chip")}
        className="rv-var rv-var-chip"
        style={{ boxShadow: `0 0 0 2px ${visual.cor}, 0 4px 12px rgba(0,0,0,.25)` }}
        onClick={abrir}
        aria-label={titulo}
      >
        <span>{emoji}</span>
        <Mais extras={extras} />
      </button>

      {/* Hover em qualquer modo: o card completo com o resumo. */}
      <button
        type="button"
        className="rv-var rv-var-expandido"
        style={{ borderLeftColor: visual.cor }}
        onClick={abrir}
        aria-label={titulo}
        tabIndex={-1}
      >
        <div className="rv-balao-linha">
          <span className="rv-balao-emoji">{emoji}</span>
          <span className="rv-balao-titulo">{card.titulo}</span>
        </div>
        {card.resumo && <p className="rv-balao-resumo">{card.resumo}</p>}
        <Chips card={card} />
        <div className="rv-balao-rodape">
          {visual.rotulo} · {item.autorNome}
          {extras > 0 && ` · +${extras} na aba Cards`}
        </div>
        <Rabicho />
      </button>
    </div>
  );
}
