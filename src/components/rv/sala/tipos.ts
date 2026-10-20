/*
 * Contrato da sala imersiva — compartilhado por SALA, VOZ, GESTOS e INTEGRADOR.
 *
 * Avatar3D — props novas para a próxima etapa da equipe do avatar (ninguém implementa agora):
 *   gesto?: GestoDoAvatar            // "maoDireita" | "maoEsquerda" | "duasMaos" | "aceno" | "joinha" | "palmas" | "coracao" | null
 *   bracoAoVivo?: LadoDaMao | null   // braço acompanhando a câmera em tempo real (independe da mão travada na fila)
 *   cabeca?: CabecaDoAvatar | null   // rad; yaw + = esquerda do avatar; limitar ±0,6 yaw / ±0,35 pitch
 * Requisitos:
 *   - Braços articulados no OMBRO (grupo/osso por braço, pivô em (±(troncoW/2 + bracoW/2), ombroY)),
 *     por malhas separadas ou skinning; cotovelo opcional. Hoje o corpo é 4 malhas juntas → impossível.
 *   - Poses: maoDireita/Esquerda = braço ~160° acima, palma à frente; duasMaos = ambos;
 *     aceno = maoDireita + oscilação ±25° a 2,5 Hz; palmas = antebraços à frente batendo a 3 Hz;
 *     joinha = antebraço 90° à frente, punho; coracao = duas mãos à frente do peito.
 *   - Transição por damp (~150 ms), SEM remontar malha nem trocar key por gesto (data-tsd-source).
 *   - Exportar `alturaDoTopoSentado(config): number`; a sala hoje mede por Box3 (avatar-na-cadeira.tsx).
 * Quando existir: a sala passa gesto/cabeca ao Avatar3D (só em avatar-na-cadeira.tsx) e mantém
 * o ícone acima da cabeça apenas para os momentâneos e para o número da fila.
 */
import type { AvatarConfig } from "@/lib/avatar-3d";

/* ───────── Cards (voz → balão / telão / quadro) ───────── */

/** "nada" nunca chega à sala: o servidor devolve, o cliente não publica. */
export const TIPOS_DE_CARD = [
  "ideia",
  "tarefa",
  "decisao",
  "pergunta",
  "problema",
  "aviso",
  "nada",
] as const;
export type TipoDeCard = (typeof TIPOS_DE_CARD)[number];
export type TipoVisivel = Exclude<TipoDeCard, "nada">;

export interface CardDaSala {
  tipo: TipoDeCard;
  emoji: string; // 1 emoji (até 2 code points)
  titulo: string; // ≤ 60 caracteres (≈ 6 palavras)
  resumo: string; // ≤ 160 caracteres (vai para hover e aba Cards, não para o balão)
  responsavel: string | null; // primeiro nome de um participante, ou null
  prazo: string | null; // como foi dito ("sexta-feira"), ≤ 40
  relevancia: number; // 0..1 — quanto vale mostrar na cabeça
}

/** Card como a sala guarda e desenha. */
export interface CardNaSala {
  id: string; // `${identity}:${at}` — único na reunião
  autorId: string;
  autorNome: string; // primeiro nome
  at: number; // epoch ms do início da fala (relógio de quem falou)
  chegou: number; // epoch ms local de chegada (anima entrada/saída)
  card: CardDaSala;
  ouvido: string; // texto transcrito (≤ 300) — dedupe/anti-eco e contexto
}

export const VISUAL_DO_CARD: Record<TipoVisivel, { cor: string; rotulo: string; emoji: string }> = {
  ideia: { cor: "#f59e0b", rotulo: "Ideia", emoji: "💡" },
  tarefa: { cor: "#2563eb", rotulo: "Tarefa", emoji: "📋" },
  decisao: { cor: "#16a34a", rotulo: "Decisão", emoji: "✅" },
  pergunta: { cor: "#7c3aed", rotulo: "Pergunta", emoji: "❓" },
  problema: { cor: "#dc2626", rotulo: "Problema", emoji: "⚠️" },
  aviso: { cor: "#0891b2", rotulo: "Aviso", emoji: "📢" },
};

/** Abaixo disto o cliente nem publica (fica só na bandeja do autor como "não publicado"). */
export const LIMIAR_DE_PUBLICAR = 0.4;
/** Relevância mínima para virar balão na cabeça; abaixo vai só para telão/aba Cards. */
export const LIMIAR_DO_BALAO: Record<TipoVisivel, number> = {
  ideia: 0.7,
  aviso: 0.7,
  tarefa: 0.5,
  decisao: 0.5,
  pergunta: 0.5,
  problema: 0.5,
};

export const DURACAO_BALAO_MS = 10_000; // a saída (400 ms) cabe dentro
export const MAX_BALOES_POR_PESSOA = 1; // o mais novo; os outros vivos viram "+N"
export const MAX_BALOES_NA_TELA = 4; // completos; o resto vira chip compacto
export const MAX_VIVOS_POR_PESSOA = 3; // quantos o integrador guarda para o "+N"
export const MAX_MURAL = 60; // histórico da reunião (aba Cards)
export const CARDS_NO_TELAO = 3; // tela de espera do telão
export const CARDS_NO_QUADRO = 4; // quadro da parede: só tarefas e decisões

/* ───────── Gestos ───────── */

export type LadoDaMao = "direita" | "esquerda" | "duas";
export type GestoMomentaneo = "aceno" | "joinha" | "palmas" | "coracao";
export type GestoDoAvatar = "maoDireita" | "maoEsquerda" | "duasMaos" | GestoMomentaneo | null;

/** O momentâneo aparece por cima por 3 s; senão vale a mão (travada na fila). */
export function gestoDoAvatar(
  mao: LadoDaMao | null,
  momentaneo: GestoMomentaneo | null,
): GestoDoAvatar {
  if (momentaneo) return momentaneo;
  if (mao === "direita") return "maoDireita";
  if (mao === "esquerda") return "maoEsquerda";
  if (mao === "duas") return "duasMaos";
  return null;
}

export const VISUAL_DO_GESTO: Record<
  Exclude<GestoDoAvatar, null>,
  { emoji: string; frase: string }
> = {
  maoDireita: { emoji: "✋", frase: "levantou a mão" },
  maoEsquerda: { emoji: "✋", frase: "levantou a mão" },
  duasMaos: { emoji: "🙌", frase: "levantou as duas mãos" },
  aceno: { emoji: "👋", frase: "acenou" },
  joinha: { emoji: "👍", frase: "fez joinha" },
  palmas: { emoji: "👏", frase: "aplaudiu" },
  coracao: { emoji: "❤️", frase: "mandou um coração" },
};

export const DURACAO_MOMENTANEO_MS = 3_000;
export const MAO_TRAVA_MS = 1_000; // mão erguida e parada por 1 s pela câmera → trava na fila
export const FALA_QUE_ABAIXA_MS = 4_000; // falar 4 s seguidos abaixa a própria mão
export const DURACAO_AVISO_MS = 4_000;

/** Reservado para o avatar (§6). Ninguém envia pela rede nesta etapa. */
export interface CabecaDoAvatar {
  yaw: number;
  pitch: number;
}

/* ───────── Quem está na mesa ───────── */

export type NaMesa = {
  id: string;
  nome: string; // primeiro nome
  config: AvatarConfig;
  falando: boolean;
  eu: boolean;
  /** Microfone fechado OU não publicado. */
  mudo: boolean;
  /** Nem publicou microfone (entrou só ouvindo). */
  semMicrofone: boolean;
  /** Mão travada (fila). Independe do braço estar no alto agora. */
  mao: LadoDaMao | null;
  maoDesde: number | null;
  /** 1 = primeiro da fila; null fora da fila. */
  posicaoNaFila: number | null;
  momentaneo: GestoMomentaneo | null;
  /** Cards vivos (mais antigo primeiro, ≤ MAX_VIVOS_POR_PESSOA). A sala ignora em `eu` (bandeja). */
  cards: CardNaSala[];
  /** "Cards por IA" ligado: chip "IA" visível para todos. */
  iaOuvindo: boolean;
  /** Gestos pela câmera ligados — SÓ no painel Participantes, nunca sobre a cabeça. */
  cameraGestos: boolean;
  /** Quem conduz (menor joinedAt): pode abaixar mãos e dar a vez. */
  conduz: boolean;
  cabeca: CabecaDoAvatar | null; // sempre null nesta etapa
};

/** O que a Sala3D aceita: os campos novos são opcionais (rota antiga compila; padrões na sala). */
export type PessoaNaSala = Pick<NaMesa, "id" | "nome" | "config" | "falando" | "eu"> &
  Partial<Omit<NaMesa, "id" | "nome" | "config" | "falando" | "eu">>;

/* ───────── Protocolos LiveKit (publishData) ───────── */

export const TOPICO_CARD = "rv-card";
export const TOPICO_GESTO = "rv-gesto";
/** Pacotes maiores que isto são descartados na entrada. */
export const MAX_BYTES_DO_PACOTE = 4_096;

/** topic "rv-card" — sempre reliable, JSON UTF-8 ≤ 2 KB. "pensando"/"desistiu" NÃO vão à rede. */
export type MensagemCard =
  | { v: 1; k: "ouvindo"; ligado: boolean }
  | { v: 1; k: "card"; id: string; at: number; card: CardDaSala; ouvido: string }
  | { v: 1; k: "apagar"; id: string }; // só vale se id começa com `${identity do remetente}:`

/** topic "rv-gesto" — sempre reliable. */
export type MensagemGesto =
  | {
      v: 1;
      k: "estado";
      sessao: string; // aleatória por conexão: sessão nova zera o seq
      seq: number;
      mao: LadoDaMao | null;
      maoDesde: number | null; // relógio do EMISSOR, já limitado a ≤ agora
      origemMao: "camera" | "botao" | null;
      momentaneo: GestoMomentaneo | null;
      camera: boolean;
    }
  | { v: 1; k: "abaixar"; alvo: string; motivo: "abaixar" | "vez" }; // só aceito de quem conduz
