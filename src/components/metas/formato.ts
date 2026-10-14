import { sectors } from "@/lib/fluxo-types";
import type { UserScore } from "./calculo";

/* Formatos e constantes compartilhados pelos blocos da aba Metas & Score
   (13/10/2026). Ficam fora dos arquivos de componente para o recarregamento
   rápido do Vite continuar funcionando neles. */

export const corDoSetor = (id: string) =>
  sectors.find((s) => s.id === id)?.color ?? "oklch(0.52 0.22 275)";

export const nomeDoSetor = (id: string) => sectors.find((s) => s.id === id)?.name ?? id;

export const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);

/** Pontos com vírgula decimal ("6,5"), como o resto do sistema. */
export const fmtPontos = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

/** Os quatro estados da tarefa no período, na ordem da Distribuição. */
export const ESTADOS = [
  {
    chave: "onTime" as const,
    rotulo: "No prazo",
    nota: "vale 1 ponto",
    cor: "var(--color-success)",
    opacidade: 1,
  },
  {
    chave: "late" as const,
    rotulo: "Com atraso",
    nota: "vale ½ ponto",
    cor: "var(--color-warning)",
    opacidade: 1,
  },
  {
    chave: "pending" as const,
    rotulo: "Pendentes",
    nota: "abertas, ainda no prazo",
    cor: "var(--color-muted-foreground)",
    opacidade: 0.4,
  },
  {
    chave: "missed" as const,
    rotulo: "Perdidas",
    nota: "venceram sem concluir",
    cor: "var(--color-destructive)",
    opacidade: 1,
  },
];

/** Score primeiro; empate decide quem fez mais pontos, depois quem tinha mais tarefa. */
export function porScore(a: UserScore, b: UserScore): number {
  if ((a.assigned === 0) !== (b.assigned === 0)) return a.assigned === 0 ? 1 : -1;
  return (
    b.pct - a.pct ||
    b.points - a.points ||
    b.assigned - a.assigned ||
    a.user.name.localeCompare(b.user.name, "pt-BR")
  );
}

/**
 * A frase curta sob o número. "0%" sozinho não diz se a pessoa falhou ou se só
 * ainda não chegou a hora — e são situações opostas para quem gerencia.
 */
export function leituraDoScore(
  s: Pick<UserScore, "assigned" | "pct" | "onTime" | "late" | "missed">,
): string {
  if (s.assigned === 0) return "sem tarefas";
  if (s.pct >= 100) return "meta batida";
  if (s.missed > 0) return `${s.missed} vencida${s.missed > 1 ? "s" : ""}`;
  if (s.onTime + s.late === 0) return "nada concluído ainda";
  return "abaixo da meta";
}
