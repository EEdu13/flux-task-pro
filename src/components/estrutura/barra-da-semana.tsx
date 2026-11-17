import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Coffee,
  Minus,
} from "lucide-react";
import {
  diaEMes,
  nomeCurtoDoDia,
  numeroDoDia,
  segundaDaSemana,
  somarDias,
} from "@/lib/estrutura-datas";
import type { DiaDaSemana, SituacaoDoDia } from "@/lib/estrutura-tipos";
import { cn } from "@/lib/utils";

/*
 * A barra da semana (segunda a sexta): um botão por dia, com a situação do dia
 * na cor E no texto. Verde = enviado; vermelho = pendente; azul = folga; cinza =
 * fora da cobrança; tracejado = dia que ainda não chegou (não dá para enviar).
 * As setas andam de semana em semana, sem limite para trás (Eduardo, 09/11/2026)
 * e nunca além da semana de hoje.
 */

const ESTILO: Record<SituacaoDoDia, string> = {
  enviado: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  pendente: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  folga: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  naoCobrado: "border-border bg-secondary/40 text-muted-foreground",
  futuro: "border-dashed border-border text-muted-foreground/70",
};

const ROTULO: Record<SituacaoDoDia, string> = {
  enviado: "Enviado",
  pendente: "Pendente",
  folga: "Folga",
  naoCobrado: "Sem cobrança",
  futuro: "Ainda não",
};

function Icone({ situacao }: { situacao: SituacaoDoDia }) {
  const c = "h-3.5 w-3.5";
  switch (situacao) {
    case "enviado":
      return <CircleCheck className={c} aria-hidden />;
    case "pendente":
      return <CircleAlert className={c} aria-hidden />;
    case "folga":
      return <Coffee className={c} aria-hidden />;
    case "futuro":
      return <Clock3 className={c} aria-hidden />;
    default:
      return <Minus className={c} aria-hidden />;
  }
}

export function BarraDaSemana({
  dias,
  diaSelecionado,
  hoje,
  aoEscolherDia,
  aoMudarSemana,
}: {
  /** `null` enquanto carrega. */
  dias: DiaDaSemana[] | null;
  diaSelecionado: string;
  hoje: string;
  aoEscolherDia: (dia: string) => void;
  aoMudarSemana: (passo: -1 | 1) => void;
}) {
  const segunda = segundaDaSemana(diaSelecionado);
  const naSemanaDeHoje = segundaDaSemana(hoje) === segunda;
  const cinco = [0, 1, 2, 3, 4].map((i) => somarDias(segunda, i));

  return (
    <div className="flex items-stretch gap-2">
      <button
        type="button"
        onClick={() => aoMudarSemana(-1)}
        className="grid w-8 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-secondary"
        aria-label="Semana anterior"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div
        className="grid min-w-0 flex-1 grid-cols-5 gap-2"
        role="group"
        aria-label={`Semana de ${diaEMes(segunda)}`}
      >
        {cinco.map((dia) => {
          const situacao = dias?.find((d) => d.dia === dia)?.situacao;
          const futuro = dia > hoje;
          const selecionado = dia === diaSelecionado;
          return (
            <button
              key={dia}
              type="button"
              disabled={futuro}
              onClick={() => aoEscolherDia(dia)}
              aria-pressed={selecionado}
              aria-label={`${nomeCurtoDoDia(dia)} ${diaEMes(dia)}: ${situacao ? ROTULO[situacao] : dias === null ? "carregando" : "sem informação"}`}
              className={cn(
                "flex min-w-0 flex-col items-center gap-0.5 rounded-lg border px-1 py-2 transition-colors xl:py-3",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                situacao
                  ? ESTILO[situacao]
                  : dias === null
                    ? "animate-pulse border-border bg-secondary/40"
                    : "border-border bg-secondary/40",
                selecionado && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                futuro ? "cursor-not-allowed" : "hover:brightness-95",
              )}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                {nomeCurtoDoDia(dia)}
              </span>
              <span className="text-base font-bold leading-none tabular-nums xl:text-lg">
                {numeroDoDia(dia)}
              </span>
              <span className="mt-0.5 flex items-center gap-1 text-[10px] font-medium">
                {situacao && <Icone situacao={situacao} />}
                <span className="hidden truncate sm:inline">
                  {situacao ? ROTULO[situacao] : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => aoMudarSemana(1)}
        disabled={naSemanaDeHoje}
        className="grid w-8 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-secondary disabled:opacity-30"
        aria-label="Próxima semana"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
