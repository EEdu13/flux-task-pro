import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Os botões de status de uma pessoa ou de um veículo: um por opção da lista,
 * com o texto EXATO que vai para o banco. Exatamente um fica marcado. Cada
 * status tem a sua cor, para a lista ser lida de relance (quem está de FALTA
 * salta aos olhos); a cor nunca é a única pista: o texto está sempre lá.
 */

/** Marcado: o preenchimento forte. Cores da paleta do Tailwind, com o par do tema escuro. */
const MARCADO: Record<string, string> = {
  ADM: "border-primary bg-primary text-primary-foreground",
  FALTA: "border-red-600 bg-red-600 text-white",
  FÉRIAS: "border-amber-500 bg-amber-500 text-white",
  FOLGA: "border-sky-600 bg-sky-600 text-white",
  ATESTADO: "border-violet-600 bg-violet-600 text-white",
  "NÃO ESTÁ NA EQUIPE":
    "border-zinc-700 bg-zinc-700 text-white dark:border-zinc-300 dark:bg-zinc-300 dark:text-zinc-900",
  "À DISPOSIÇÃO": "border-emerald-600 bg-emerald-600 text-white",
  APOIO: "border-sky-600 bg-sky-600 text-white",
  OFICINA: "border-amber-500 bg-amber-500 text-white",
  "À VENDA": "border-violet-600 bg-violet-600 text-white",
  "SEM ATIVIDADE": "border-zinc-500 bg-zinc-500 text-white",
};

/** O mesmo status só como etiqueta (modo leitura): fundo suave, sem preencher. */
const ETIQUETA: Record<string, string> = {
  ADM: "border-primary/30 bg-primary/10 text-primary",
  FALTA: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  FÉRIAS: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  FOLGA: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  ATESTADO: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  "NÃO ESTÁ NA EQUIPE": "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  "À DISPOSIÇÃO": "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  APOIO: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  OFICINA: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  "À VENDA": "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  "SEM ATIVIDADE": "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
};

export function BotoesDeStatus({
  nome,
  opcoes,
  valor,
  aoEscolher,
  desabilitado,
}: {
  /** Para o leitor de tela: "Status de Fulano". */
  nome: string;
  opcoes: readonly string[];
  valor: string | null;
  aoEscolher: (status: string) => void;
  desabilitado?: boolean;
}) {
  return (
    <div role="group" aria-label={`Status de ${nome}`} className="flex flex-wrap gap-1.5">
      {opcoes.map((op) => {
        const marcado = valor === op;
        return (
          <button
            key={op}
            type="button"
            aria-pressed={marcado}
            disabled={desabilitado}
            onClick={() => aoEscolher(op)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              "disabled:cursor-not-allowed disabled:opacity-50",
              marcado
                ? MARCADO[op]
                : "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {marcado && <Check className="h-3 w-3" aria-hidden />}
            {op}
          </button>
        );
      })}
    </div>
  );
}

/** O status guardado, sem botão. Fora da lista (ou vazio) aparece como está, em tom neutro. */
export function EtiquetaDeStatus({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="inline-flex rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
        Sem marca
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide",
        ETIQUETA[status] ?? "border-border bg-secondary text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}
