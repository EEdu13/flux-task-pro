import { useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { TravaScroll } from "@/components/trava-scroll";

/**
 * Confirmação no visual do app, substituindo o `confirm()` do navegador.
 *
 * O nativo trava a thread inteira, ignora o tema (aparece branco no escuro),
 * mostra o endereço do site no topo e não tem como distinguir "excluir para
 * sempre" de "tem certeza?". Aqui a ação perigosa fica vermelha e o texto
 * explica o que acontece.
 *
 * Segue o mesmo formato do `transicionar` do transition-veil: uma função
 * exportada que devolve promessa, e um host montado uma vez na raiz. Assim
 * `if (confirm(...))` vira `if (await confirmar(...))` sem reestruturar quem
 * chama.
 */

const EVENTO = "fluxo:confirmar";

export interface OpcoesConfirmacao {
  titulo: string;
  descricao?: string;
  /** Rótulo do botão que confirma. Diga o que acontece: "Excluir", não "OK". */
  confirmar?: string;
  cancelar?: string;
  /** Pinta a confirmação de vermelho e mostra o ícone de alerta. */
  perigo?: boolean;
}

/** "sim" = o botão principal; "alternativa" = o terceiro; "nao" = cancelar/fechar/Esc. */
export type Escolha = "sim" | "alternativa" | "nao";

interface Pedido extends OpcoesConfirmacao {
  /** Um terceiro botão, à esquerda (ex.: "Sair sem salvar"). */
  alternativa?: string;
  responder: (r: Escolha) => void;
}

export function confirmar(opcoes: OpcoesConfirmacao): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const pedido: Pedido = { ...opcoes, responder: (r) => resolve(r === "sim") };
    window.dispatchEvent(new CustomEvent<Pedido>(EVENTO, { detail: pedido }));
  });
}

/**
 * A mesma janela com três saídas (20/10/2026, sair do avatar sem salvar:
 * "Salvar e sair" / "Sair sem salvar" / continuar). Fechar, Esc ou clicar fora
 * é sempre "nao" — nunca a ação que perde alguma coisa.
 */
export function escolher(opcoes: OpcoesConfirmacao & { alternativa: string }): Promise<Escolha> {
  if (typeof window === "undefined") return Promise.resolve("nao");
  return new Promise((resolve) => {
    const pedido: Pedido = { ...opcoes, responder: resolve };
    window.dispatchEvent(new CustomEvent<Pedido>(EVENTO, { detail: pedido }));
  });
}

export function ConfirmHost() {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const confirmarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const aoPedir = (e: Event) => setPedido((e as CustomEvent<Pedido>).detail);
    window.addEventListener(EVENTO, aoPedir);
    return () => window.removeEventListener(EVENTO, aoPedir);
  }, []);

  // O foco vai para a confirmação: quem chegou aqui pelo teclado consegue
  // resolver pelo teclado.
  useEffect(() => {
    if (pedido) confirmarRef.current?.focus();
  }, [pedido]);

  useEffect(() => {
    if (!pedido) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        responder("nao");
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [pedido]);

  const responder = (r: Escolha) => {
    pedido?.responder(r);
    setPedido(null);
  };

  if (!pedido) return null;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        // Clicar fora cancela — nunca confirma.
        if (e.target === e.currentTarget) responder("nao");
      }}
    >
      <TravaScroll />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fluxo-confirm-titulo"
        className="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start gap-3 p-5">
          {pedido.perigo && (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <AlertTriangle className="h-4.5 w-4.5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id="fluxo-confirm-titulo" className="text-sm font-semibold text-foreground">
              {pedido.titulo}
            </h2>
            {pedido.descricao && (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {pedido.descricao}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => responder("nao")}
            className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Cancelar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-secondary/40 px-4 py-3">
          {pedido.alternativa && (
            <button
              type="button"
              onClick={() => responder("alternativa")}
              className="mr-auto rounded-md px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10"
            >
              {pedido.alternativa}
            </button>
          )}
          <button
            type="button"
            onClick={() => responder("nao")}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
          >
            {pedido.cancelar ?? "Cancelar"}
          </button>
          <button
            ref={confirmarRef}
            type="button"
            onClick={() => responder("sim")}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              pedido.perigo
                ? "bg-destructive text-destructive-foreground hover:brightness-110"
                : "bg-primary text-primary-foreground hover:brightness-110"
            }`}
          >
            {pedido.confirmar ?? "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
