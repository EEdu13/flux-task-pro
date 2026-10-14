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
