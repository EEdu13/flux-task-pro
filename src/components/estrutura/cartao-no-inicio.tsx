import { Link } from "@tanstack/react-router";
import { CircleCheck, ClipboardList } from "lucide-react";
import { situacaoDeHoje, useEstrutura, useTemEstrutura } from "@/lib/estrutura-cliente";

/*
 * O card do Início (Parte A): a estrutura de hoje, uma linha por equipe.
 *
 * - PENDENTE: faixa vermelha com "Enviar agora", que abre a tela já na equipe.
 * - ENVIADA: uma linha verde, discreta.
 * - Folga, fora da cobrança, ou a cobrança ainda não veio: não desenha nada.
 *
 * Só LÊ a memória de `estrutura-cliente.ts`, alimentada pela vigia: o Início é
 * aberto toda hora e não pergunta nada por conta própria. Quem não tem equipe
 * de estrutura (a imensa maioria) não vê nada, nem um espaço vazio.
 */
export function CartaoDaEstruturaNoInicio() {
  const est = useEstrutura();
  const tem = useTemEstrutura();
  if (!tem) return null;

  const situacoes = est.equipes.map((e) => ({ e, s: situacaoDeHoje(est, e.equipe) }));
  const pendentes = situacoes.filter((x) => x.s === "pendente");
  const enviadas = situacoes.filter((x) => x.s === "enviado");
  if (pendentes.length === 0 && enviadas.length === 0) return null;
  const varias = est.equipes.length > 1;

  return (
    <div className="flex flex-col gap-2">
      {pendentes.map(({ e }) => (
        <div
          key={e.equipe}
          className="flex items-center gap-3 rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-2.5 text-sm shadow-sm"
        >
          <ClipboardList className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Estrutura de hoje{varias ? ` · ${e.equipe}` : ""} ·{" "}
            <strong className="font-semibold text-red-700 dark:text-red-400">Pendente</strong>
          </span>
          <Link
            to="/estrutura"
            search={{ equipe: e.equipe }}
            className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            Enviar agora
          </Link>
        </div>
      ))}
      {pendentes.length === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          <CircleCheck className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            Estrutura de hoje enviada
            {varias ? ` · ${enviadas.map((x) => x.e.equipe).join(", ")}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
