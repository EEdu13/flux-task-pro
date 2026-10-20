/*
 * Ajudantes do Mural do lado da tela (14/10/2026). O painel lateral
 * (aniversários, tempo de casa) muda uma vez por dia: a tela guarda a
 * resposta por 5 minutos na sessão, para o Início e o Mural não perguntarem
 * de novo a cada troca de página.
 */
import type { PainelDoMural } from "@/lib/mural.functions";

/** A mensagem que o servidor manda enquanto a migração do mural não rodou. */
export const MSG_MURAL_INATIVO = "O mural ainda não foi ativado.";

export function ehErroDeMuralInativo(e: unknown): boolean {
  return String((e as Error)?.message ?? "").includes("ainda não foi ativado");
}

const VALIDADE_PAINEL_MS = 5 * 60_000;
let painelGuardado: { valor: PainelDoMural; em: number } | null = null;
let painelBuscando: Promise<PainelDoMural> | null = null;

export async function carregarPainelDoMural(forcar = false): Promise<PainelDoMural> {
  if (!forcar && painelGuardado && Date.now() - painelGuardado.em < VALIDADE_PAINEL_MS) {
    return painelGuardado.valor;
  }
  if (painelBuscando) return painelBuscando;
  painelBuscando = import("@/lib/mural.functions")
    .then(({ painelDoMural }) => painelDoMural())
    .then((valor) => {
      painelGuardado = { valor, em: Date.now() };
      return valor;
    })
    .finally(() => {
      painelBuscando = null;
    });
  return painelBuscando;
}

/** Depois de salvar o próprio aniversário: o próximo pedido vai ao servidor. */
export function esquecerPainelDoMural(): void {
  painelGuardado = null;
}

export const NOMES_DOS_MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "14 de outubro". */
export const diaEMes = (dia: number, mes: number) => `${dia} de ${NOMES_DOS_MESES[mes - 1] ?? ""}`;

/** Iniciais para o avatar quando a pessoa não está na lista do app. */
export function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  return (
    (partes[0]?.[0] ?? "") + (partes.length > 1 ? (partes.at(-1)?.[0] ?? "") : "")
  ).toUpperCase();
}

/* -------------------- Fases 2 e 3 (14/10/2026) -------------------- */

/**
 * Avisa a tela do Mural (se estiver aberta) que algo foi publicado fora dela —
 * um agradecimento feito pela tarefa, por exemplo — para ela reler o topo.
 */
export const EVENTO_MURAL_PUBLICADO = "fluxo:mural-publicado";
export function avisarMuralPublicado(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_MURAL_PUBLICADO));
}

/** "qua., 22 de outubro · 18:30" — a data de um evento, no fuso de quem vê. */
export function dataDoEvento(iso: string): string {
  const d = new Date(iso);
  const dia = d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "long" });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${dia} · ${hora}`;
}

/** Valor para um `<input type="datetime-local">` a partir de um ISO (hora local). */
export function paraCampoDataHora(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** O inverso: o valor do campo (hora local) em ISO, ou null se vazio/inválido. */
export function doCampoDataHora(valor: string): string | null {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const NOMES_DOS_FERIADOS: Record<string, string> = {
  "1-1": "Confraternização Universal",
  "4-21": "Tiradentes",
  "5-1": "Dia do Trabalho",
  "9-7": "Independência do Brasil",
  "10-12": "Nossa Senhora Aparecida",
  "11-2": "Finados",
  "11-15": "Proclamação da República",
  "11-20": "Consciência Negra",
  "12-25": "Natal",
};

/**
 * O próximo feriado nacional a partir de amanhã — a mesma regra do pack e
 * dos prazos (`ehFeriadoNacional`), sem ir ao banco.
 */
export async function proximoFeriado(
  agora: Date = new Date(),
): Promise<{ data: Date; nome: string; emDias: number } | null> {
  const { ehFeriadoNacional } = await import("@/lib/dias-uteis");
  const base = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  for (let i = 1; i <= 370; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (ehFeriadoNacional(d.getFullYear(), d.getMonth(), d.getDate())) {
      return {
        data: d,
        nome: NOMES_DOS_FERIADOS[`${d.getMonth() + 1}-${d.getDate()}`] ?? "Sexta-feira Santa",
        emDias: i,
      };
    }
  }
  return null;
}
