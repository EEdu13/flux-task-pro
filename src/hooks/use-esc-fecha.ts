import { useEffect, useRef } from "react";

/**
 * Esc fecha a janela enquanto ela está aberta.
 *
 * Para as janelas feitas à mão (um `fixed inset-0` com o cartão no meio) que
 * fechavam no clique fora mas não no Esc — ou em nenhum dos dois (auditoria
 * de 08/10/2026). As que já usam Radix (Dialog, Popover) não precisam disto.
 *
 * `fechar` vai por ref: a janela costuma recriar a função a cada render, e
 * o efeito não deve se reinscrever por isso.
 */
export function useEscFecha(aberto: boolean, fechar: () => void) {
  const ref = useRef(fechar);
  ref.current = fechar;
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto]);
}
