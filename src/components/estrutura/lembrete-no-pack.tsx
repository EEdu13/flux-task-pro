import { Link } from "@tanstack/react-router";
import { CircleCheck, ClipboardList } from "lucide-react";
import { situacaoDeHoje, useEstrutura, useTemEstrutura } from "@/lib/estrutura-cliente";

/*
 * O lembrete da estrutura no "Meu pack de hoje" (opção A, Eduardo 05/11/2026):
 * um lembrete do SISTEMA, não um item do pack. Borda tracejada, sem caixa de
 * marcar, e o texto diz que não conta. Fica verde quando a estrutura é enviada.
 *
 * Por isso ele NUNCA entra na lista de tarefas do pack (`tasks`, `myPack`,
 * `pending`): o "Meu pack (X/Y)", o "Marcar tudo como feito", os pontos, a
 * ofensiva, o Mural e o Wrapped continuam exatamente como são. É só desenho,
 * lendo a mesma memória que o card do Início.
 */
export function LembreteDaEstruturaNoPack() {
  const est = useEstrutura();
  const tem = useTemEstrutura();
  if (!tem) return null;

  const itens = est.equipes
    .map((e) => ({ e, s: situacaoDeHoje(est, e.equipe) }))
    .filter((x) => x.s === "pendente" || x.s === "enviado");
  if (itens.length === 0) return null;
  const varias = est.equipes.length > 1;

  return (
    <ul className="mt-3 space-y-1" aria-label="Lembrete do sistema">
      {itens.map(({ e, s }) =>
        s === "pendente" ? (
          <li
            key={e.equipe}
            className="flex items-center gap-2 rounded-md border border-dashed border-red-500/50 bg-red-500/5 px-3 py-2 text-sm"
          >
            <ClipboardList
              className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              Enviar a estrutura de hoje{varias ? ` (${e.equipe})` : ""}
              <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Lembrete do sistema · não conta no pack
              </span>
            </span>
            <Link
              to="/estrutura"
              search={{ equipe: e.equipe }}
              className="shrink-0 text-xs font-semibold text-primary hover:underline"
            >
              Enviar
            </Link>
          </li>
        ) : (
          <li
            key={e.equipe}
            className="flex items-center gap-2 rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-muted-foreground"
          >
            <CircleCheck
              className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              Estrutura de hoje enviada{varias ? ` (${e.equipe})` : ""}
              <span className="ml-2 text-[10px] font-medium uppercase tracking-wide">
                Lembrete do sistema · não conta no pack
              </span>
            </span>
          </li>
        ),
      )}
    </ul>
  );
}
