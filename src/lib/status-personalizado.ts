/**
 * O status personalizado, no jeito do Slack (19/10/2026): um emoji, um texto
 * curto e até quando vale — "🚜 Em campo", "🍽️ Almoço — volto às 14h".
 *
 * Mora em `gestor.preferencias` (chave `status_personalizado`), num JSON
 * `{emoji, texto, ate}`, e NÃO numa coluna nova da presença: o banco é
 * compartilhado e o schema não muda por isto. Os outros o recebem na mesma
 * consulta de `presenceList` (um LEFT JOIN pela chave primária), sem sondagem
 * nova.
 *
 * Diferente do disponível/ocupado/ausente, este vale também para quem está
 * offline — "Em campo" é justamente o recado de quem não está no computador.
 *
 * Este arquivo é puro (sem servidor, sem React): o servidor usa para validar e
 * filtrar o vencido, a tela usa para montar os presets e o "até quando".
 */

export const CHAVE_STATUS_PERSONALIZADO = "status_personalizado";
export const MAX_TEXTO_DO_STATUS = 60;
/** Um emoji com modificadores (pele, ZWJ) passa de 2 caracteres; 16 cabe com folga. */
const MAX_EMOJI = 16;

export type StatusPersonalizado = {
  emoji: string;
  texto: string;
  /** ISO de quando o status some sozinho; `null` = só some quando a pessoa limpar. */
  ate: string | null;
};

export type Duracao = "30min" | "1h" | "hoje" | "sexta" | "data" | "nunca";

export const DURACOES: { id: Duracao; rotulo: string }[] = [
  { id: "30min", rotulo: "30 minutos" },
  { id: "1h", rotulo: "1 hora" },
  { id: "hoje", rotulo: "Até o fim do dia" },
  { id: "sexta", rotulo: "Até sexta-feira" },
  { id: "data", rotulo: "Escolher a data…" },
  { id: "nunca", rotulo: "Não limpar" },
];

/** Os prontos, com a duração que costuma servir — dá para trocar antes de salvar. */
export const PRESETS_DE_STATUS: { emoji: string; texto: string; duracao: Duracao }[] = [
  { emoji: "🚜", texto: "Em campo", duracao: "hoje" },
  { emoji: "🍽️", texto: "Almoço", duracao: "1h" },
  { emoji: "📞", texto: "Em reunião", duracao: "1h" },
  { emoji: "🏠", texto: "Home office", duracao: "hoje" },
  { emoji: "🚗", texto: "Em deslocamento", duracao: "1h" },
  { emoji: "🤒", texto: "Atestado", duracao: "hoje" },
  { emoji: "🏖️", texto: "De férias", duracao: "sexta" },
];

/** Os emojis que dá para escolher à mão, além dos dos presets. */
export const EMOJIS_DE_STATUS = [
  "🚜",
  "🌳",
  "🍽️",
  "☕",
  "📞",
  "💻",
  "🏠",
  "🚗",
  "✈️",
  "🏖️",
  "🤒",
  "🏥",
  "📚",
  "🎯",
  "🔧",
  "📊",
  "🧾",
  "🙋",
  "🔕",
  "🎉",
];

/** Fim do dia local de `d` (23:59:59.999). */
function fimDoDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * Quando a duração escolhida termina. "Até sexta" numa sexta é hoje à noite;
 * no fim de semana, a sexta seguinte. `dataEscolhida` é o "AAAA-MM-DD" do
 * campo de data e vale até o fim daquele dia.
 */
export function ateDaDuracao(
  duracao: Duracao,
  agora: Date = new Date(),
  dataEscolhida?: string,
): string | null {
  switch (duracao) {
    case "30min":
      return new Date(agora.getTime() + 30 * 60_000).toISOString();
    case "1h":
      return new Date(agora.getTime() + 60 * 60_000).toISOString();
    case "hoje":
      return fimDoDia(agora).toISOString();
    case "sexta": {
      const faltam = (5 - agora.getDay() + 7) % 7;
      const sexta = new Date(agora);
      sexta.setDate(agora.getDate() + faltam);
      return fimDoDia(sexta).toISOString();
    }
    case "data": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataEscolhida ?? "");
      if (!m) return fimDoDia(agora).toISOString();
      return fimDoDia(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString();
    }
    case "nunca":
      return null;
  }
}

/** "AAAA-MM-DD" de hoje no fuso local — o mínimo do campo de data. */
export function hojeNoCampoDeData(agora: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

/**
 * Valida o que veio da rede ou do banco. Devolve `null` para qualquer coisa
 * fora do formato — inclusive JSON quebrado gravado por outra versão.
 */
export function paraStatus(v: unknown): StatusPersonalizado | null {
  let o: unknown = v;
  if (typeof v === "string") {
    try {
      o = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const emoji = typeof r.emoji === "string" ? r.emoji.trim().slice(0, MAX_EMOJI) : "";
  const texto =
    typeof r.texto === "string"
      ? r.texto.replace(/\s+/g, " ").trim().slice(0, MAX_TEXTO_DO_STATUS)
      : "";
  if (!emoji && !texto) return null;
  let ate: string | null = null;
  if (r.ate !== null && r.ate !== undefined) {
    const t = typeof r.ate === "string" ? Date.parse(r.ate) : NaN;
    if (!Number.isFinite(t)) return null;
    ate = new Date(t).toISOString();
  }
  return { emoji, texto, ate };
}

/** O status ainda vale agora? Vencido não aparece para ninguém. */
export function statusVigente<T extends { ate: string | null }>(
  s: T | null | undefined,
  agora: number = Date.now(),
): T | null {
  if (!s) return null;
  if (s.ate && Date.parse(s.ate) <= agora) return null;
  return s;
}

/** "🚜 Em campo" — o status numa linha. */
export function statusEmTexto(s: { emoji: string; texto: string }): string {
  return [s.emoji, s.texto].filter(Boolean).join(" ");
}

/** "até 14:30", "até amanhã", "até sex., 24/10" — o que o título do status explica. */
export function rotuloDoAte(ate: string | null, agora: Date = new Date()): string {
  if (!ate) return "";
  const d = new Date(ate);
  const dias = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime()) /
      86_400_000,
  );
  const fimDoDiaDele = d.getHours() === 23 && d.getMinutes() === 59;
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (dias === 0) return fimDoDiaDele ? "até o fim do dia" : `até ${hora}`;
  if (dias === 1) return fimDoDiaDele ? "até amanhã" : `até amanhã, ${hora}`;
  const data = d.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
  return `até ${data}`;
}

const semVariacao = (e: string) => e.replace(/️/g, "");
const EMOJIS_FORA_DA_MESA = new Set(["🚜", "🏖", "🤒", "🏥", "✈"]);

/**
 * A pessoa está fora do escritório por causa do status — em campo, de férias,
 * de atestado. No Escritório 3D ela NÃO aparece sentada trabalhando (e também
 * não vai para o refeitório, que é do "ausente"): a mesa fica com o nome e o
 * status, como a de quem saiu.
 */
export function statusTiraDaMesa(s: { emoji: string; texto: string } | null | undefined): boolean {
  if (!s) return false;
  if (EMOJIS_FORA_DA_MESA.has(semVariacao(s.emoji))) return true;
  const t = s.texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return /\b(campo|ferias|atestado|licenca|folga|viagem|viajando)\b/.test(t);
}
