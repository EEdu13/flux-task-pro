import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { DarParabens } from "@/components/mural/dar-parabens";
import { useFluxo } from "@/lib/fluxo-store";
import { nomeCurto } from "@/lib/nome-curto";
import { carregarPainelDoMural } from "@/lib/mural-cliente";
import type { AniversarianteNoPainel, PostDoMural } from "@/lib/mural.functions";

/*
 * A faixa do Início (Mural, 14/10/2026): uma linha discreta abaixo do topo
 * com o aniversário de hoje ("🎂 Hoje é aniversário de X — Dar parabéns") e o
 * último comunicado fixado que a pessoa ainda não leu. Sem nada disso, não
 * desenha nada.
 *
 * Os comunicados fixados ficam guardados 5 min na sessão (como o painel): o
 * Início é aberto toda hora e não precisa perguntar de novo a cada vez.
 */

let fixadosGuardados: { valor: PostDoMural[]; em: number } | null = null;

async function comunicadosFixados(): Promise<PostDoMural[]> {
  if (fixadosGuardados && Date.now() - fixadosGuardados.em < 5 * 60_000)
    return fixadosGuardados.valor;
  const { feedDoMural } = await import("@/lib/mural.functions");
  const r = await feedDoMural({ data: {} });
  const valor = r.ativo ? r.fixados : [];
  fixadosGuardados = { valor, em: Date.now() };
  return valor;
}

export function FaixaDoMuralNoInicio() {
  const { currentUser } = useFluxo();
  const [hoje, setHoje] = useState<AniversarianteNoPainel[]>([]);
  const [comunicado, setComunicado] = useState<PostDoMural | null>(null);

  useEffect(() => {
    let vivo = true;
    carregarPainelDoMural()
      .then((p) => vivo && setHoje(p.hoje))
      .catch(() => {
        /* Enfeite do Início: sem o mural, a faixa simplesmente não aparece. */
      });
    comunicadosFixados()
      .then((fixados) => {
        if (!vivo) return;
        setComunicado(
          fixados.find(
            (p) => p.autorId !== currentUser.id && !p.leitores.includes(currentUser.id),
          ) ?? null,
        );
      })
      .catch(() => {
        /* Idem: sem comunicado, nada a mostrar. */
      });
    return () => {
      vivo = false;
    };
  }, [currentUser.id]);

  if (!hoje.length && !comunicado) return null;

  const primeiro = hoje[0];
  const nomes =
    hoje.length === 1
      ? nomeCurto(hoje[0].nome)
      : hoje.length === 2
        ? `${nomeCurto(hoje[0].nome)} e ${nomeCurto(hoje[1].nome)}`
        : `${nomeCurto(hoje[0].nome)} e mais ${hoje.length - 1}`;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm shadow-sm sm:flex-row sm:items-center sm:gap-4">
      {primeiro && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-base" aria-hidden>
            🎂
          </span>
          <span className="min-w-0 truncate">
            Hoje é aniversário de <strong className="font-semibold">{nomes}</strong>
          </span>
          {hoje.length === 1 ? (
            <DarParabens pessoaId={primeiro.id} nome={primeiro.nome} pequeno />
          ) : (
            <Link
              to="/mural"
              className="shrink-0 text-xs font-semibold text-primary hover:underline"
            >
              Dar parabéns
            </Link>
          )}
        </div>
      )}
      {primeiro && comunicado && <span className="hidden h-5 w-px bg-border sm:block" />}
      {comunicado && (
        <Link to="/mural" className="group flex min-w-0 flex-1 items-center gap-2">
          <span className="text-base" aria-hidden>
            📌
          </span>
          <span className="min-w-0 truncate">
            <span className="text-muted-foreground">Comunicado:</span>{" "}
            <span className="font-semibold">{comunicado.titulo}</span>
          </span>
          <span className="ml-auto inline-flex shrink-0 items-center text-xs font-semibold text-primary group-hover:underline">
            Ler <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      )}
    </div>
  );
}
