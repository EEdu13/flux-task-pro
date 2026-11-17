import { AlertTriangle, RotateCw } from "lucide-react";
import type { EquipeDaEstrutura } from "@/lib/estrutura-tipos";

/* Os blocos pequenos da tela da estrutura: seletor de equipe, erro, esqueleto, aviso de exemplo. */

/** Só aparece com mais de uma equipe; com uma, mostra o código dela. */
export function SeletorDeEquipe({
  equipes,
  valor,
  aoMudar,
}: {
  equipes: EquipeDaEstrutura[];
  valor: string;
  aoMudar: (equipe: string) => void;
}) {
  const atual = equipes.find((e) => e.equipe === valor);
  if (equipes.length <= 1) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold">
        {valor}
        {atual?.projeto && (
          <span className="text-xs font-normal text-muted-foreground">· {atual.projeto}</span>
        )}
      </span>
    );
  }
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-xs font-medium text-muted-foreground">Equipe</span>
      <select
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {equipes.map((e) => (
          <option key={e.equipe} value={e.equipe}>
            {e.equipe}
            {e.projeto ? ` · ${e.projeto}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CartaoDeErro({
  mensagem,
  aoTentarDeNovo,
}: {
  mensagem: string;
  aoTentarDeNovo: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4 sm:flex-row sm:items-center"
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">{mensagem}</p>
      <button
        type="button"
        onClick={aoTentarDeNovo}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
      >
        <RotateCw className="h-3.5 w-3.5" aria-hidden />
        Tentar de novo
      </button>
    </div>
  );
}

/** O esqueleto enquanto a lista carrega: o mesmo desenho das linhas, sem texto. */
export function Esqueleto() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Carregando a equipe">
      <div className="h-4 w-24 animate-pulse rounded bg-secondary" />
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between"
          >
            <div className="flex flex-col gap-1.5">
              <div className="h-3.5 w-44 animate-pulse rounded bg-secondary" />
              <div className="h-3 w-28 animate-pulse rounded bg-secondary/70" />
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className="h-6 w-16 animate-pulse rounded-full bg-secondary" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
