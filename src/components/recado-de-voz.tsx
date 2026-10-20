import { useEffect } from "react";
import { Loader2, Mic, Send, X } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { LIMITE_RECADO_S, useGravadorDeVoz } from "@/lib/use-gravador-de-voz";
import { formatarDuracao, gravacaoComoAnexo } from "@/lib/gravacao-de-midia";
import type { Attachment } from "@/lib/fluxo-types";

/**
 * Botão de recado de voz (19/10/2026), estilo WhatsApp.
 *
 * Parado é um microfone. Gravando, vira uma pílula com o cancelar, o tempo, a
 * ondinha do nível ao vivo e o botão de parar — que ENVIA, como no WhatsApp.
 * Quem chama recebe o anexo pronto (apontando para o arquivo na memória do
 * navegador, `blob:`) e decide para onde ele vai: o comentário, a conversa ou
 * os anexos da tarefa. O envio em pedaços acontece lá, no caminho de sempre.
 */
export function BotaoRecadoDeVoz({
  aoGravar,
  aoMudarGravando,
  rotulo,
  className = "",
  tamanhoIcone = "h-4 w-4",
}: {
  aoGravar: (anexo: Attachment) => void;
  /** Para quem quer esconder o resto (o campo do chat) enquanto grava. */
  aoMudarGravando?: (gravando: boolean) => void;
  /** Texto ao lado do microfone; sem ele, só o ícone. */
  rotulo?: string;
  className?: string;
  tamanhoIcone?: string;
}) {
  const { currentUser } = useFluxo();
  const { estado, segundos, niveis, iniciar, parar, cancelar } = useGravadorDeVoz((g) =>
    aoGravar(gravacaoComoAnexo(g, currentUser.id)),
  );
  const gravando = estado === "gravando";

  useEffect(() => {
    aoMudarGravando?.(gravando);
  }, [gravando, aoMudarGravando]);

  if (!gravando) {
    return (
      <button
        type="button"
        onClick={() => void iniciar()}
        disabled={estado === "pedindo"}
        title="Gravar recado de voz (até 3 minutos)"
        className={`inline-flex items-center gap-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-60 ${className}`}
      >
        {estado === "pedindo" ? (
          <Loader2 className={`${tamanhoIcone} animate-spin`} />
        ) : (
          <Mic className={tamanhoIcone} />
        )}
        {rotulo}
      </button>
    );
  }

  const restante = LIMITE_RECADO_S - segundos;
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-destructive/30 bg-destructive/5 py-1 pl-1 pr-1"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cancelar();
        }
      }}
    >
      <button
        type="button"
        onClick={cancelar}
        title="Cancelar (o recado é descartado)"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <X className="h-4 w-4" />
      </button>
      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-destructive" />
      <span className="shrink-0 text-xs font-semibold tabular-nums text-destructive">
        {formatarDuracao(segundos)}
      </span>
      <div className="flex h-6 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden>
        {niveis.map((n, i) => (
          <span
            key={i}
            className="w-[3px] flex-1 rounded-full bg-destructive/70 transition-[height] duration-100"
            style={{ height: `${Math.max(12, Math.round(n * 100))}%` }}
          />
        ))}
      </div>
      {restante <= 30 && (
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
          faltam {Math.max(0, Math.ceil(restante))}s
        </span>
      )}
      <button
        type="button"
        onClick={parar}
        autoFocus
        title="Parar e enviar"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:brightness-110"
      >
        <Send className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
