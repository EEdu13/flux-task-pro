/*
 * fila-de-maos.tsx — card âmbar "Mãos levantadas (N)" no canto da sala.
 *
 * A ordem é a da fila de verdade: quem levantou primeiro (desde) e, no empate, a identity —
 * todos os participantes calculam igual, então a fila é a mesma em todas as telas.
 * Quem conduz (menor joinedAt) vê "Abaixar" e "Dar a vez" em cada linha; os outros só
 * abaixam a própria mão.
 *
 * Fechada por padrão (uma linha: "✋ 1 Marcos · 2 Rafael"): o card aberto, opaco, tapava o
 * canto superior esquerdo do palco — os balões de quem senta à esquerda e a placa LARSIL.
 * Abre ao passar o mouse, ao focar pelo teclado ou num clique (que a deixa aberta).
 */
import { useEffect, useState } from "react";
import { ChevronDown, Hand } from "lucide-react";
import { ordenarFila } from "./logica-da-mao";
import "./gestos.css";

export interface ItemDaFila {
  id: string;
  nome: string;
  /** Date.now() do emissor (já grampeado ≤ agora lá). */
  desde: number;
  eu: boolean;
}

function haQuanto(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function FilaDeMaos({
  itens,
  souCondutor,
  aoAbaixarMinha,
  aoAbaixar,
  aoDarAVez,
}: {
  itens: ItemDaFila[];
  souCondutor: boolean;
  aoAbaixarMinha: () => void;
  aoAbaixar: (id: string) => void;
  aoDarAVez: (id: string) => void;
}) {
  const [agora, setAgora] = useState(() => Date.now());
  const [sobre, setSobre] = useState(false);
  const [fixa, setFixa] = useState(false);
  const n = itens.length;

  // "há 0:42" anda de 1 em 1 s, só enquanto há alguém na fila.
  useEffect(() => {
    if (!n) return;
    setAgora(Date.now());
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [n]);

  if (!n) return null;
  const fila = ordenarFila(itens);
  const aberta = sobre || fixa;
  const lista = (
    <ol className="flex flex-col gap-1">
      {fila.map((p, i) => (
        <li
          key={p.id}
          className={`flex items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] ${
            i === 0 ? "rv-fila-nova bg-[#fde68a]/70" : ""
          }`}
        >
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold">{i + 1}.</span> {p.eu ? `${p.nome} (você)` : p.nome}
            <span className="text-[#92400e]/80"> · há {haQuanto(agora - p.desde)}</span>
          </span>
          {p.eu ? (
            <button
              type="button"
              onClick={aoAbaixarMinha}
              className="shrink-0 cursor-pointer rounded-md bg-[#f59e0b] px-2 py-0.5 text-[11px] font-semibold text-black hover:bg-[#d97706]"
            >
              Abaixar
            </button>
          ) : souCondutor ? (
            <span className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => aoAbaixar(p.id)}
                className="cursor-pointer rounded-md border border-[#d97706]/60 px-1.5 py-0.5 text-[11px] font-medium hover:bg-[#fde68a]"
                title={`Abaixar a mão de ${p.nome}`}
              >
                Abaixar
              </button>
              <button
                type="button"
                onClick={() => aoDarAVez(p.id)}
                className="cursor-pointer rounded-md bg-[#16a34a] px-1.5 py-0.5 text-[11px] font-semibold text-white hover:bg-[#15803d]"
                title={`Dar a vez de falar a ${p.nome}`}
              >
                Dar a vez
              </button>
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );

  return (
    <section
      aria-label={`Mãos levantadas: ${n}`}
      onMouseEnter={() => setSobre(true)}
      onMouseLeave={() => setSobre(false)}
      onFocus={() => setSobre(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSobre(false);
      }}
      className={`pointer-events-auto max-w-[85vw] rounded-xl border border-[#f59e0b]/60 bg-[#fffbeb]/95 text-[#451a03] shadow-lg backdrop-blur ${
        aberta ? "w-80 p-2.5" : "w-auto max-w-[320px] px-2.5 py-1.5"
      }`}
    >
      <button
        type="button"
        onClick={() => setFixa((f) => !f)}
        aria-expanded={aberta}
        title={fixa ? "Recolher a fila" : "Manter a fila aberta"}
        className={`flex w-full cursor-pointer items-center gap-1.5 text-left text-[13px] font-semibold ${
          aberta ? "mb-1.5" : ""
        }`}
      >
        <Hand className="h-4 w-4 shrink-0 text-[#d97706]" aria-hidden />
        {aberta ? (
          <span className="flex-1">Mãos levantadas ({n})</span>
        ) : (
          <span className="min-w-0 flex-1 truncate">
            {fila.map((p, i) => (
              <span key={p.id} className={i === 0 ? "" : "font-medium text-[#92400e]"}>
                {i > 0 && <span className="px-1 text-[#92400e]/60">·</span>}
                {i + 1} {p.eu ? "Você" : p.nome}
              </span>
            ))}
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[#92400e] transition ${aberta ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {aberta && lista}
    </section>
  );
}
