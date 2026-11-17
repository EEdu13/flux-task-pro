import { dataParaIso } from "@/lib/data-iso";
import { HORARIO_VALIDO } from "@/lib/prazo";
import { RECORRENCIA_DO_PACK } from "@/lib/recorrencia";
import { semAcento } from "@/lib/texto-busca";
import type { useFluxo } from "@/lib/fluxo-store";
import type { Priority, Task, User } from "@/lib/fluxo-types";

/* O item do pack antes de virar tarefa — e a conta de como ele vira. Usado
   pela linha de criação (`criador-de-pack.tsx`) e pela tela do pack. Mora
   fora do componente para o Fast Refresh, que só recarrega arquivo que
   exporta apenas componentes. 13/10/2026. */

type NovaTarefa = Parameters<ReturnType<typeof useFluxo>["createTask"]>[0];

/** Um item ainda não gravado: o que a linha de criação produz. */
export type ItemDePack = {
  chave: string;
  titulo: string;
  /** "HH:mm" ou vazio (vence no fim do dia, 23:59). */
  horario: string;
  prioridade: Priority;
  /** Texto separado por vírgula, o mesmo valor do `CampoDeTags`. */
  tags: string;
  /** Volta todo dia útil — ver `RECORRENCIA_DO_PACK`. */
  repetir: boolean;
  minutos?: number;
  /** Etiquetas que não aparecem no campo, como `modelo:<nome>`. */
  etiquetasExtras?: string[];
};

/** Cor e rótulo de cada prioridade — as mesmas da grade de criação. */
export const PRIORIDADES_DO_PACK: { id: Priority; label: string; cor: string }[] = [
  { id: "alta", label: "Alta", cor: "text-destructive border-destructive/50 bg-destructive/10" },
  { id: "media", label: "Média", cor: "text-warning border-warning/50 bg-warning/10" },
  { id: "baixa", label: "Baixa", cor: "text-primary border-primary/50 bg-primary/10" },
];

const chaveNova = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Tira marcadores de lista ("- ", "1. ", "• ") de cada linha colada. */
export function linhasDoPack(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•\d.\s]+/, "").trim())
    .filter((l) => l.length > 0);
}

/** Título comparável: sem acento, caixa e espaço duplicado. */
export function chaveDoTitulo(titulo: string): string {
  return semAcento(titulo).replace(/\s+/g, " ");
}

export function novoItemDePack(
  titulo: string,
  base: Partial<Omit<ItemDePack, "chave" | "titulo">> = {},
): ItemDePack {
  return {
    chave: chaveNova(),
    titulo: titulo.trim(),
    horario: base.horario ?? "",
    prioridade: base.prioridade ?? "media",
    tags: base.tags ?? "",
    repetir: base.repetir ?? true,
    minutos: base.minutos,
    etiquetasExtras: base.etiquetasExtras,
  };
}

/**
 * A tarefa que o item vira — o mesmo formato que o pack sempre gravou
 * (`inPack`, etiqueta "pack", menção a quem recebe, vence hoje), agora com o
 * horário, a prioridade e as tags escolhidas.
 */
export function tarefaDoItemDePack(
  item: ItemDePack,
  destino: Pick<User, "id" | "sector"> | undefined,
  criador: Pick<User, "id" | "sector">,
): NovaTarefa {
  const assigneeId = destino?.id ?? criador.id;
  const hora = HORARIO_VALIDO.test(item.horario) ? item.horario : "";
  const prazo = new Date();
  const [h, m] = (hora || "23:59").split(":").map(Number);
  prazo.setHours(h, m, 0, 0);
  const tags = Array.from(
    new Set(
      [
        "pack",
        ...(item.etiquetasExtras ?? []),
        ...item.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      ].filter(Boolean),
    ),
  );
  const recorrencia: Pick<Task, "recurring" | "frequency" | "recurringWeekdays"> = item.repetir
    ? RECORRENCIA_DO_PACK
    : { recurring: false, frequency: "diaria", recurringWeekdays: null };
  return {
    title: item.titulo,
    sector: destino?.sector ?? criador.sector,
    createdBy: criador.id,
    assigneeId,
    mentions: assigneeId !== criador.id ? [assigneeId] : [],
    status: "pendente",
    score: 10,
    dueDate: prazo.toISOString(),
    dueTime: hora || null,
    ...recorrencia,
    priority: item.prioridade,
    tags,
    inPack: true,
    estimatedMinutes: item.minutos,
  };
}

/* ------------------------- Editar um item já gravado ------------------------- */

/**
 * O que a linha de edição mexe num item JÁ GRAVADO (09/11/2026): o mesmo recorte da linha de
 * criação — texto, horário, prioridade e repetição. Tags, minutos e dias específicos ficam
 * para a janela da tarefa.
 */
export type EdicaoDeItem = {
  titulo: string;
  /** "HH:mm" ou vazio (vence no fim do dia, 23:59). */
  horario: string;
  prioridade: Priority;
  repetir: boolean;
};

type ItemGravado = Pick<Task, "title" | "dueDate" | "dueTime" | "priority" | "recurring">;

/** O horário do item, ou vazio se não tem um válido (o que o servidor devolve é "HH:mm"). */
const horarioDe = (t: Pick<Task, "dueTime">): string =>
  t.dueTime && HORARIO_VALIDO.test(t.dueTime) ? t.dueTime : "";

/** A tarefa gravada, no formato da linha de edição. */
export function edicaoDe(t: ItemGravado): EdicaoDeItem {
  return {
    titulo: t.title,
    horario: horarioDe(t),
    prioridade: t.priority,
    repetir: t.recurring,
  };
}

/**
 * Só o que MUDOU entre a tarefa e a edição, no formato do `updateTask`; `null` se nada mudou ou
 * se a edição não vale (título vazio, horário que não é "HH:mm"). Quem chama grava só o que vier:
 * o que não mudou nem é tocado, e assim a repetição não derruba os dias próprios do item.
 *
 * - horário: o MESMO dia do prazo, com o horário novo (vazio = fim do dia, 23:59), como a janela
 *   da tarefa faz — mudar o horário nunca troca o dia, e um item atrasado continua atrasado;
 * - repetir: ligar é a repetição do pack (seg a sex); desligar é "só hoje", o mesmo que o criador grava.
 */
export function patchDaEdicao(t: ItemGravado, e: EdicaoDeItem): Partial<Task> | null {
  const titulo = e.titulo.trim().slice(0, 200);
  if (!titulo) return null;
  if (e.horario !== "" && !HORARIO_VALIDO.test(e.horario)) return null;

  const patch: Partial<Task> = {};
  if (titulo !== t.title) patch.title = titulo;
  if (e.horario !== horarioDe(t)) {
    const dia = dataParaIso(t.dueDate ? new Date(t.dueDate) : new Date());
    patch.dueDate = new Date(`${dia}T${e.horario || "23:59"}:00`).toISOString();
    patch.dueTime = e.horario || null;
  }
  if (e.prioridade !== t.priority) patch.priority = e.prioridade;
  if (e.repetir !== t.recurring) {
    Object.assign(
      patch,
      e.repetir
        ? RECORRENCIA_DO_PACK
        : { recurring: false, frequency: "diaria" as const, recurringWeekdays: null },
    );
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
