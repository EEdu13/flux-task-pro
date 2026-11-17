import { CheckCheck, History, Loader2, Send, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * A barra de ações, presa embaixo da lista: "Todos ADM" e "Repetir último dia"
 * (os dois só PREENCHEM, nunca enviam, e têm "Desfazer"), quantos faltam e o
 * Enviar, que só acende com tudo marcado.
 */

export function BarraDeAcoes({
  faltam,
  podeDesfazer,
  enviando,
  repetindo,
  simulacao,
  reenvio,
  aoTodosAdm,
  aoRepetir,
  aoDesfazer,
  aoEnviar,
}: {
  faltam: number;
  podeDesfazer: boolean;
  enviando: boolean;
  repetindo: boolean;
  /** O envio está desligado ou são dados de exemplo: o botão avisa que é simulação. */
  simulacao: boolean;
  /** O dia já foi enviado: o botão diz "Reenviar". */
  reenvio: boolean;
  aoTodosAdm: () => void;
  aoRepetir: () => void;
  aoDesfazer: () => void;
  aoEnviar: () => void;
}) {
  const ocupado = enviando || repetindo;
  const rotulo = `${reenvio ? "Reenviar" : "Enviar"}${simulacao ? " (simulação)" : ""}`;
  return (
    <div className="sticky bottom-0 z-10 -mx-3 border-t border-border bg-background/95 px-3 py-3 backdrop-blur sm:-mx-4 sm:px-4 md:-mx-6 md:px-6">
      {/* Do `lg` para cima, 10rem de folga à direita: ali moram os botões flutuantes (acesso
          rápido e chat), e o Enviar não pode ficar embaixo deles com a página esticada. */}
      <div className="mx-auto flex w-full max-w-[2200px] flex-wrap items-center gap-2 lg:pr-40">
        <button
          type="button"
          onClick={aoTodosAdm}
          disabled={ocupado}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-secondary disabled:opacity-50"
        >
          <CheckCheck className="h-4 w-4" aria-hidden />
          Todos ADM
        </button>
        <button
          type="button"
          onClick={aoRepetir}
          disabled={ocupado}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-secondary disabled:opacity-50"
        >
          {repetindo ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <History className="h-4 w-4" aria-hidden />
          )}
          Repetir último dia
        </button>
        {podeDesfazer && (
          <button
            type="button"
            onClick={aoDesfazer}
            disabled={ocupado}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            <Undo2 className="h-4 w-4" aria-hidden />
            Desfazer
          </button>
        )}
        <span
          className={cn(
            "ml-auto text-xs font-medium",
            faltam > 0
              ? "text-amber-700 dark:text-amber-400"
              : "text-emerald-700 dark:text-emerald-400",
          )}
          aria-live="polite"
        >
          {faltam > 0 ? `Faltam ${faltam}` : "Tudo marcado"}
        </span>
        <button
          type="button"
          onClick={aoEnviar}
          disabled={faltam > 0 || ocupado}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {enviando ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
          {enviando ? "Enviando…" : rotulo}
        </button>
      </div>
    </div>
  );
}
