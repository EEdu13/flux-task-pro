/*
 * Quadro de feltro "Tarefas e decisões" na parede do telão.
 *
 * Por que só tarefas e decisões, 4 post-its em letra enorme: de longe, numa
 * textura, ninguém lê lista. O quadro mostra o que vira compromisso; a lista
 * completa fica no telão de espera e na aba Cards (clique no quadro abre).
 */
import { useMemo } from "react";
import { CARDS_NO_QUADRO, type CardNaSala } from "./tipos";
import { QUADRO, QUADRO_CENTRO, QUADRO_PX } from "./medidas-da-sala";
import {
  FONTE,
  FONTE_EMOJI,
  cortarTexto,
  quebrarTexto,
  retanguloArredondado,
  useTexturaDeCanvas,
} from "./textura-de-canvas";

/** Os últimos N cards de tarefa/decisão, o mais novo primeiro. */
export function cardsDoQuadro(mural: CardNaSala[]): CardNaSala[] {
  return mural
    .filter((c) => c.card.tipo === "tarefa" || c.card.tipo === "decisao")
    .slice(-CARDS_NO_QUADRO)
    .reverse();
}

/** Até 4 palavras: o post-it é para bater o olho, o resto está no telão/aba. */
function quatroPalavras(t: string): string {
  const p = t.split(/\s+/).filter(Boolean);
  return p.length <= 4 ? p.join(" ") : p.slice(0, 4).join(" ") + "…";
}

/**
 * Tentativas para o título, do maior corpo ao menor: 2 linhas grandes e, por último, 3 linhas
 * menores. O post-it é lido de longe, então só encolhe quando precisa.
 */
const TENTATIVAS_DO_TITULO = [
  { corpo: 72, linhas: 2 },
  { corpo: 62, linhas: 2 },
  { corpo: 54, linhas: 2 },
  { corpo: 46, linhas: 3 },
] as const;

/**
 * O maior corpo em que as (até) 4 palavras cabem SEM cortar palavra no meio. Com corpo fixo de
 * 72 px em 2 linhas, "Comprar correntes novas…" virava "Comprar correntes nov…" — e um título
 * cortado no quadro não diz nada. Não coube nem no menor: corta (o telão e a aba têm o resto).
 */
function tituloQueCabe(
  g: CanvasRenderingContext2D,
  titulo: string,
  largura: number,
): { linhas: string[]; corpo: number } {
  for (const t of TENTATIVAS_DO_TITULO) {
    g.font = `700 ${t.corpo}px ${FONTE}`;
    const linhas = quebrarTexto(g, titulo, largura, t.linhas);
    if (linhas.join(" ") === titulo) return { linhas, corpo: t.corpo };
  }
  const ultima = TENTATIVAS_DO_TITULO[TENTATIVAS_DO_TITULO.length - 1];
  return { linhas: quebrarTexto(g, titulo, largura, ultima.linhas), corpo: ultima.corpo };
}

const POSTIT = {
  tarefa: { fundo: "#fde68a", faixa: "#2563eb" },
  decisao: { fundo: "#bbf7d0", faixa: "#16a34a" },
} as const;

function desenharQuadro(g: CanvasRenderingContext2D, w: number, h: number, cards: CardNaSala[]) {
  // Feltro: verde-escuro com um leve granulado (determinístico — não "pisca" ao redesenhar).
  g.fillStyle = "#24453a";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(255,255,255,0.035)";
  for (let i = 0; i < 2400; i++) {
    const x = (i * 73) % w;
    const y = (i * 151) % h;
    g.fillRect(x, y, 2, 2);
  }

  g.textBaseline = "middle";
  g.textAlign = "center";
  g.fillStyle = "#f8fafc";
  g.font = `800 52px ${FONTE}`;
  g.fillText("TAREFAS E DECISÕES", w / 2, 58);

  if (!cards.length) {
    g.fillStyle = "rgba(248,250,252,0.7)";
    g.font = `600 64px ${FONTE}`;
    g.fillText("Nenhuma tarefa ainda", w / 2, h / 2 + 40);
    return;
  }

  const margem = 28;
  const topo = 112;
  const cw = (w - margem * 3) / 2;
  const ch = (h - topo - margem * 2) / 2;
  cards.forEach((c, i) => {
    const x = margem + (i % 2) * (cw + margem);
    const y = topo + Math.floor(i / 2) * (ch + margem);
    const cor = POSTIT[c.card.tipo as keyof typeof POSTIT] ?? POSTIT.tarefa;
    // Sombra do post-it + papel + faixa da cor do tipo.
    g.fillStyle = "rgba(0,0,0,0.25)";
    retanguloArredondado(g, x + 6, y + 8, cw, ch, 10);
    g.fill();
    g.fillStyle = cor.fundo;
    retanguloArredondado(g, x, y, cw, ch, 10);
    g.fill();
    g.fillStyle = cor.faixa;
    g.fillRect(x, y, cw, 14);

    g.textAlign = "left";
    g.font = `60px ${FONTE_EMOJI}`;
    g.fillText(c.card.emoji || (c.card.tipo === "decisao" ? "✅" : "📋"), x + 20, y + 66);

    g.fillStyle = "#111827";
    const { linhas, corpo } = tituloQueCabe(g, quatroPalavras(c.card.titulo), cw - 40);
    // As linhas ficam centradas no miolo do post-it (entre o emoji e o responsável).
    const passo = corpo + 2;
    const miolo = y + (100 + ch - 64) / 2;
    const y0 = miolo - ((linhas.length - 1) * passo) / 2;
    linhas.forEach((l, k) => g.fillText(l, x + 20, y0 + k * passo));

    if (c.card.responsavel) {
      g.font = `600 40px ${FONTE}`;
      g.fillStyle = "#374151";
      g.fillText(cortarTexto(g, `👤 ${c.card.responsavel}`, cw - 40), x + 20, y + ch - 34);
    }
  });
}

export function Quadro({
  mural,
  aoAbrirCards,
}: {
  mural: CardNaSala[];
  aoAbrirCards?: () => void;
}) {
  const cards = useMemo(() => cardsDoQuadro(mural), [mural]);
  // Só redesenha quando o conjunto filtrado muda (cards de outros tipos não mexem aqui).
  const chave = cards.map((c) => c.id).join(",");
  const textura = useTexturaDeCanvas(
    QUADRO_PX.w,
    QUADRO_PX.h,
    (g, w, h) => desenharQuadro(g, w, h, cards),
    chave,
    { anisotropia: 8 },
  );
  const m = QUADRO.moldura;
  return (
    <group position={QUADRO_CENTRO}>
      <mesh position={[0, 0, 0.02]} castShadow={false}>
        <boxGeometry args={[QUADRO.w + 2 * m, QUADRO.h + 2 * m, 0.04]} />
        <meshStandardMaterial color="#6b4a32" roughness={0.6} />
      </mesh>
      <mesh
        position={[0, 0, 0.042]}
        onClick={(e) => {
          e.stopPropagation();
          aoAbrirCards?.();
        }}
        onPointerOver={() => {
          if (aoAbrirCards) document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <planeGeometry args={[QUADRO.w, QUADRO.h]} />
        {textura ? (
          <meshStandardMaterial map={textura} roughness={0.95} />
        ) : (
          <meshStandardMaterial color="#24453a" />
        )}
      </mesh>
    </group>
  );
}
