import type { Room } from "livekit-client";
import {
  MAX_BYTES_DO_PACOTE,
  TIPOS_DE_CARD,
  TOPICO_CARD,
  VISUAL_DO_CARD,
  type CardDaSala,
  type MensagemCard,
  type TipoVisivel,
} from "../sala/tipos";

/**
 * O canal "rv-card" da sala: publicar, ler com desconfiança e as pequenas
 * contas de texto que evitam card repetido (eco) e card de conversa à toa.
 *
 * Tudo puro (sem React) para ser testado no Node. O que vem da rede é de
 * outra pessoa e pode vir torto, velho ou malicioso: `lerMensagemCard` só
 * deixa passar o formato exato, com cada texto cortado no tamanho que a sala
 * desenha. Quem mandou NUNCA vem no pacote — sai de `participant.identity`.
 */

const codificador = new TextEncoder();

/** Publica no canal dos cards, sempre confiável (card perdido = balão que nunca aparece). */
export function publicarCard(room: Room, m: MensagemCard, destino?: string[]): Promise<void> {
  return room.localParticipant.publishData(codificador.encode(JSON.stringify(m)), {
    reliable: true,
    topic: TOPICO_CARD,
    ...(destino?.length ? { destinationIdentities: destino } : {}),
  });
}

const VISIVEIS = TIPOS_DE_CARD.filter((t): t is TipoVisivel => t !== "nada");

const corte = (v: unknown, teto: number): string | null =>
  typeof v === "string" ? v.trim().slice(0, teto) : null;

/** Até 2 code points (base + seletor de variação); maior que isso volta o do tipo. */
function emojiValido(v: unknown, tipo: TipoVisivel): string {
  const e = typeof v === "string" ? v.trim() : "";
  const pontos = Array.from(e);
  if (pontos.length === 0 || pontos.length > 2) return VISUAL_DO_CARD[tipo].emoji;
  return e;
}

/** Id da reunião: o texto é livre, mas tem que apontar para um autor (ver `autorDoId`). */
const idValido = (v: unknown): string | null =>
  typeof v === "string" && v.length <= 200 && autorDoId(v) !== null ? v : null;

function cardValido(v: unknown): CardDaSala | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  // "nada" nunca vai à rede: se veio, é cliente velho ou pacote forjado.
  const tipo = VISIVEIS.find((t) => t === c.tipo);
  if (!tipo) return null;
  const titulo = corte(c.titulo, 60);
  if (!titulo) return null;
  const relevancia = c.relevancia;
  if (typeof relevancia !== "number" || !Number.isFinite(relevancia)) return null;
  if (relevancia < 0 || relevancia > 1) return null;
  const responsavel = c.responsavel === null ? null : corte(c.responsavel, 60);
  const prazo = c.prazo === null ? null : corte(c.prazo, 40);
  return {
    tipo,
    emoji: emojiValido(c.emoji, tipo),
    titulo,
    resumo: corte(c.resumo, 160) ?? "",
    responsavel: responsavel || null,
    prazo: prazo || null,
    relevancia,
  };
}

/**
 * Lê um pacote do canal "rv-card". Devolve null para qualquer coisa fora do
 * formato: grande demais, JSON quebrado, versão diferente, tipo de mensagem
 * que não existe mais ("pensando" saiu da rede), card "nada", data inválida ou
 * relevância fora de 0..1. Textos chegam cortados no tamanho da sala.
 */
export function lerMensagemCard(payload: Uint8Array): MensagemCard | null {
  if (!payload || payload.byteLength === 0 || payload.byteLength > MAX_BYTES_DO_PACOTE) return null;
  let bruto: unknown;
  try {
    bruto = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
  } catch {
    return null;
  }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const m = bruto as Record<string, unknown>;
  if (m.v !== 1) return null;

  if (m.k === "ouvindo") {
    return typeof m.ligado === "boolean" ? { v: 1, k: "ouvindo", ligado: m.ligado } : null;
  }
  if (m.k === "apagar") {
    const id = idValido(m.id);
    return id ? { v: 1, k: "apagar", id } : null;
  }
  if (m.k === "card") {
    const id = idValido(m.id);
    if (!id) return null;
    if (typeof m.at !== "number" || !Number.isFinite(m.at) || m.at <= 0) return null;
    const card = cardValido(m.card);
    if (!card) return null;
    return { v: 1, k: "card", id, at: m.at, card, ouvido: corte(m.ouvido, 300) ?? "" };
  }
  return null;
}

/**
 * Quem escreveu o card, pelo id `${identity}:${at}`. A identidade pode ter ":"
 * dentro, por isso o corte é no ÚLTIMO ":" e só vale se o resto for número.
 * O integrador aceita "apagar" só quando isto bate com quem mandou.
 */
export function autorDoId(id: string): string | null {
  if (typeof id !== "string") return null;
  const i = id.lastIndexOf(":");
  if (i <= 0) return null;
  return /^\d+$/.test(id.slice(i + 1)) ? id.slice(0, i) : null;
}

const semAcento = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const palavras = (t: string) =>
  semAcento(t)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/* Frases de chamada, não de trabalho. Antes de gastar uma chamada do Claude:
   a bancada mostrou que ele acerta "nada" nelas, mas cada uma custa ~800 tokens
   e quase 2 s de fila para a frase seguinte. */
/* Conservador de propósito: "a produção caiu 20%" é problema, não conexão —
   por isso "caiu" só conta junto de internet, áudio, chamada. */
const CONEXAO = [
  /\b(ta|esta|estao|tao|voces?|vcs?) (me )?(ouvindo|escutando|vendo)\b/,
  /\b(consegue|conseguem|da pra|da para) (me )?(ouvir|escutar|ver)\b/,
  /^(bom dia|boa tarde|boa noite|ola|oi|alo|e ai)\b.{0,25}$/,
  /\b(internet|conexao|audio|som|video|chamada|microfone|mic|camera)\b.{0,12}\b(caiu|travou|congelou|cortando|picotando|falhando|ruim|mudo)\b/,
  /\b(caiu|travou|congelou|cortando|picotando|falhando)\b.{0,12}\b(internet|conexao|audio|som|video|chamada|microfone|mic)\b/,
  /^(deixa eu|vou|posso|vou so) (compartilhar|abrir|mostrar) (a |minha )?tela\b.{0,15}$/,
  /^(pode falar|pode continuar|fala ai|so um (minuto|momento|segundo)|ja volto|um minutinho|deixa eu ver aqui)\b.{0,20}$/,
];

/** Frase feita só de muleta ("tá bom, beleza, valeu pessoal"): concordância sem conteúdo. */
const MULETAS = new Set(
  "ta bom bem certo ok okay beleza blz uhum aham entendi perfeito valeu obrigado obrigada pessoal gente entao ne e isso sim nao claro show legal otimo combinado".split(
    " ",
  ),
);

/**
 * "Tá me ouvindo?", "bom dia", "deixa eu compartilhar", "beleza": conversa de
 * chamada. Também tudo com menos de 4 palavras — curto demais para virar card
 * que valha um balão.
 */
export function ehConversaDeConexao(t: string): boolean {
  const ps = palavras(t);
  if (ps.length < 4) return true;
  // Sem pontuação: "Bom dia, pessoal!" vira "bom dia pessoal" para as âncoras ^ e $.
  const n = ps.join(" ");
  if (ps.every((p) => MULETAS.has(p))) return true;
  // Frase longa com conteúdo pode citar "tela" ou "microfone" de passagem.
  if (ps.length > 12) return false;
  return CONEXAO.some((re) => re.test(n));
}

/**
 * Parecença entre duas frases (Jaccard das palavras de 3+ letras, sem acento).
 * É o anti-eco: o microfone de um capta a caixa de som do outro, e a mesma
 * frase chega transcrita por duas pessoas. ≥ 0,6 conta como a mesma fala.
 */
export function semelhanca(a: string, b: string): number {
  const A = new Set(palavras(a).filter((p) => p.length >= 3));
  const B = new Set(palavras(b).filter((p) => p.length >= 3));
  if (A.size === 0 || B.size === 0) return 0;
  let comum = 0;
  for (const p of A) if (B.has(p)) comum++;
  return comum / (A.size + B.size - comum);
}
