/*
 * redutores.ts — o estado da sala que vem pela REDE (cards e gestos), em funções puras.
 *
 * Por que puro: as regras de quem ganha o card duplicado, de qual "estado" de gesto vale e de
 * como a fila é ordenada precisam dar o MESMO resultado em todas as telas, e só dá para provar
 * isso fora do React. O hook (use-sala-ao-vivo.ts) só aplica estas funções com setState.
 *
 * O eco local (publishData não devolve ao remetente) entra pelos MESMOS redutores, com o
 * remetente = a minha identity — assim a minha tela e a dos outros nunca divergem.
 */
import {
  DURACAO_BALAO_MS,
  MAX_MURAL,
  MAX_VIVOS_POR_PESSOA,
  type CardNaSala,
  type GestoMomentaneo,
  type LadoDaMao,
  type MensagemCard,
  type MensagemGesto,
} from "../sala/tipos";
import { autorDoId, semelhanca } from "../voz/protocolo";
import { ordenarFila } from "../gestos/logica-da-mao";

/* ───────── Falantes (log local de ActiveSpeakersChanged) ───────── */

export interface FalantesNoTempo {
  t: number;
  ids: string[];
}

/** Guarda 60 s: cobre o "card chega uns 10 s depois da fala" com folga. */
export const LOG_DE_FALANTES_MS = 60_000;

/** Quantos ms `id` passou entre os falantes ativos dentro de [de, ate], pelo log local. */
export function tempoFalando(log: FalantesNoTempo[], id: string, de: number, ate: number): number {
  let total = 0;
  for (let i = 0; i < log.length; i++) {
    const a = log[i]!;
    const fim = log[i + 1]?.t ?? Math.max(ate, a.t);
    if (!a.ids.includes(id)) continue;
    const ini = Math.max(a.t, de);
    const fimCortado = Math.min(fim, ate);
    if (fimCortado > ini) total += fimCortado - ini;
  }
  return total;
}

/* ───────── Cards ───────── */

export interface CardsDaSala {
  porPessoa: Record<string, { cards: CardNaSala[]; iaOuvindo: boolean }>;
  /** Todos os cards da reunião, o mais novo por último (≤ MAX_MURAL). */
  mural: CardNaSala[];
}

export const CARDS_VAZIOS: CardsDaSala = { porPessoa: {}, mural: [] };

/** Mesmo texto (Jaccard ≥ 0,6) de outro autor nos últimos 10 s = a mesma fala captada por dois microfones. */
const ECO = 0.6;
const JANELA_DO_ECO_MS = 10_000;
/** Janela depois do início da fala em que se mede quem estava falando de verdade. */
const JANELA_DO_FALANTE_MS = 5_000;
/** O integrador poda o balão 600 ms depois da saída que a sala anima. */
export const PODA_DO_BALAO_MS = DURACAO_BALAO_MS + 600;

const pessoa = (e: CardsDaSala, id: string) => e.porPessoa[id] ?? { cards: [], iaOuvindo: false };

function semCard(e: CardsDaSala, id: string): CardsDaSala {
  const porPessoa: CardsDaSala["porPessoa"] = {};
  for (const [quem, p] of Object.entries(e.porPessoa))
    porPessoa[quem] = p.cards.some((c) => c.id === id)
      ? { ...p, cards: p.cards.filter((c) => c.id !== id) }
      : p;
  return { porPessoa, mural: e.mural.filter((c) => c.id !== id) };
}

/**
 * Aplica uma mensagem "rv-card" já validada (lerMensagemCard). O nome do autor vem do
 * participante do LiveKit, nunca do pacote.
 */
export function reduzirCard(
  e: CardsDaSala,
  m: MensagemCard,
  remetente: { id: string; nome: string },
  agora: number,
  falantes: FalantesNoTempo[],
): CardsDaSala {
  if (m.k === "ouvindo") {
    const p = pessoa(e, remetente.id);
    if (p.iaOuvindo === m.ligado) return e;
    return { ...e, porPessoa: { ...e.porPessoa, [remetente.id]: { ...p, iaOuvindo: m.ligado } } };
  }
  // O id carrega o autor: ninguém publica nem apaga card em nome de outro.
  if (autorDoId(m.id) !== remetente.id) return e;
  if (m.k === "apagar") return semCard(e, m.id);

  if (e.mural.some((c) => c.id === m.id)) return e;
  const novo: CardNaSala = {
    id: m.id,
    autorId: remetente.id,
    autorNome: remetente.nome,
    at: m.at,
    chegou: agora,
    card: m.card,
    ouvido: m.ouvido,
  };

  // Dedupe no receptor: a mesma frase virou card em dois microfones (eco de sala).
  // Fica o de quem mais falou em [at, at + 5 s] no MEU log; empate, o de at menor.
  let atual = e;
  const rival = e.mural.find(
    (c) =>
      c.autorId !== novo.autorId &&
      agora - c.chegou < JANELA_DO_ECO_MS &&
      semelhanca(c.ouvido, novo.ouvido) >= ECO,
  );
  if (rival) {
    const tNovo = tempoFalando(falantes, novo.autorId, novo.at, novo.at + JANELA_DO_FALANTE_MS);
    const tRival = tempoFalando(falantes, rival.autorId, rival.at, rival.at + JANELA_DO_FALANTE_MS);
    const novoGanha = tNovo > tRival || (tNovo === tRival && novo.at < rival.at);
    if (!novoGanha) return e;
    atual = semCard(e, rival.id);
  }

  const p = pessoa(atual, novo.autorId);
  const cards = [...p.cards, novo].sort((a, b) => a.chegou - b.chegou).slice(-MAX_VIVOS_POR_PESSOA);
  return {
    porPessoa: { ...atual.porPessoa, [novo.autorId]: { ...p, cards } },
    mural: [...atual.mural, novo].slice(-MAX_MURAL),
  };
}

/** Relógio de 1 s: tira dos vivos (balões) o que já passou da saída. O mural fica. */
export function podarCards(e: CardsDaSala, agora: number): CardsDaSala {
  let mudou = false;
  const porPessoa: CardsDaSala["porPessoa"] = {};
  for (const [id, p] of Object.entries(e.porPessoa)) {
    const cards = p.cards.filter((c) => agora - c.chegou < PODA_DO_BALAO_MS);
    if (cards.length !== p.cards.length) mudou = true;
    porPessoa[id] = cards.length !== p.cards.length ? { ...p, cards } : p;
  }
  return mudou ? { ...e, porPessoa } : e;
}

/** Quem saiu: some dos vivos e do chip IA; os cards dele FICAM no mural (são da reunião). */
export function cardsSemPessoa(e: CardsDaSala, id: string): CardsDaSala {
  if (!(id in e.porPessoa)) return e;
  const { [id]: _saiu, ...resto } = e.porPessoa;
  return { ...e, porPessoa: resto };
}

/** Cards de OUTROS nos últimos 10 s — anti-eco e contexto do useCardsDeFala. */
export function ouvidosRecentes(
  mural: CardNaSala[],
  meuId: string,
  agora: number,
): { autorId: string; at: number; ouvido: string }[] {
  return mural
    .filter((c) => c.autorId !== meuId && agora - c.chegou < JANELA_DO_ECO_MS)
    .map((c) => ({ autorId: c.autorId, at: c.at, ouvido: c.ouvido }));
}

/* ───────── Gestos ───────── */

export interface GestoDePessoa {
  sessao: string;
  seq: number;
  mao: LadoDaMao | null;
  maoDesde: number | null;
  origemMao: "camera" | "botao" | null;
  momentaneo: GestoMomentaneo | null;
  camera: boolean;
}

export type GestosDaSala = Record<string, GestoDePessoa>;

/**
 * Aplica um "estado" de gesto. Sessão diferente = conexão nova (aceita e recomeça o seq);
 * mesma sessão com seq ≤ o último = pacote velho ou repetido (ignora). `maoDesde` é usado cru:
 * o emissor já grampeou ≤ agora no relógio dele, e a fila só compara entre pessoas.
 */
export function reduzirGesto(
  e: GestosDaSala,
  m: Extract<MensagemGesto, { k: "estado" }>,
  remetente: string,
): GestosDaSala {
  const antes = e[remetente];
  if (antes && antes.sessao === m.sessao && m.seq <= antes.seq) return e;
  return {
    ...e,
    [remetente]: {
      sessao: m.sessao,
      seq: m.seq,
      mao: m.mao,
      maoDesde: m.mao === null ? null : (m.maoDesde ?? 0),
      origemMao: m.mao === null ? null : m.origemMao,
      momentaneo: m.momentaneo,
      camera: m.camera,
    },
  };
}

export function gestosSemPessoa(e: GestosDaSala, id: string): GestosDaSala {
  if (!(id in e)) return e;
  const { [id]: _saiu, ...resto } = e;
  return resto;
}

/** A fila de mãos: só quem está na sala, por `maoDesde` e depois pela identity (igual em todas as telas). */
export function filaDeMaos(
  gestos: GestosDaSala,
  presentes: { id: string; nome: string }[],
  meuId: string,
): { id: string; nome: string; desde: number; eu: boolean }[] {
  const itens = presentes
    .filter((p) => gestos[p.id]?.mao)
    .map((p) => ({
      id: p.id,
      nome: p.nome,
      desde: gestos[p.id]!.maoDesde ?? 0,
      eu: p.id === meuId,
    }));
  return ordenarFila(itens);
}

/** Quem conduz: menor joinedAt; empate (ou sem data) pela identity. Todos calculam igual. */
export function quemConduz(pessoas: { id: string; entrouEm: number | null }[]): string | null {
  let melhor: { id: string; t: number } | null = null;
  for (const p of pessoas) {
    const t = p.entrouEm ?? Number.POSITIVE_INFINITY;
    if (!melhor || t < melhor.t || (t === melhor.t && p.id < melhor.id)) melhor = { id: p.id, t };
  }
  return melhor?.id ?? null;
}

/* ───────── Avisos (pills acima da barra) ───────── */

export interface AvisoDaSala {
  id: string;
  /** Quem/qual evento — junto com o texto, evita repetir o mesmo aviso em 3 s. */
  chave: string;
  texto: string;
  emoji: string;
  desde: number;
}

const REPETICAO_MS = 3_000;
const AVISOS_GUARDADOS = 6;

export function comAviso(lista: AvisoDaSala[], novo: Omit<AvisoDaSala, "id">): AvisoDaSala[] {
  if (
    lista.some(
      (a) =>
        a.chave === novo.chave && a.texto === novo.texto && novo.desde - a.desde < REPETICAO_MS,
    )
  )
    return lista;
  return [...lista, { ...novo, id: `${novo.chave}:${novo.desde}` }].slice(-AVISOS_GUARDADOS);
}
