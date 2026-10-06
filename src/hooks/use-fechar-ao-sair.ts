import { useEffect, useRef, type RefObject } from "react";

/**
 * Fecha um painel flutuante com um clique fora dele ou com Esc.
 *
 * Feito para os dois lançadores do canto (o acesso rápido e a lista de
 * conversas), que ficavam abertos até alguém clicar de novo no próprio botão.
 *
 * O clique fora é ouvido no `pointerdown`, em captura, e não no `mousedown`: o
 * quadro de tarefas e as outras áreas de arrastar cancelam o `pointerdown`, e
 * aí o navegador nem chega a mandar o `mousedown`. Clicar num cartão não
 * fechava o acesso rápido por isso.
 *
 * Ficam de fora:
 * - o clique numa lista ou num menu aberto por cima. O seletor de status do
 *   chat é desenhado num portal, fora do painel, mas é filho dele;
 * - o Esc enquanto um filho do painel tem a própria lista aberta (um
 *   `aria-haspopup` com `aria-expanded="true"` lá dentro) ou com uma
 *   confirmação na tela. Esse Esc é deles primeiro. O `aria-haspopup` separa o
 *   dono de uma lista do botão de recolher, que também diz `aria-expanded` e
 *   travaria o Esc para sempre.
 */
export function useFecharAoSair(
  ref: RefObject<HTMLElement | null>,
  aberto: boolean,
  fechar: () => void,
): void {
  const fecharRef = useRef(fechar);
  useEffect(() => {
    fecharRef.current = fechar;
  });

  useEffect(() => {
    if (!aberto) return;
    const aoApertar = (e: PointerEvent) => {
      const alvo = e.target instanceof Element ? e.target : null;
      if (!alvo || ref.current?.contains(alvo)) return;
      if (alvo.closest('[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]')) {
        return;
      }
      fecharRef.current();
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      if (ref.current?.querySelector('[aria-haspopup][aria-expanded="true"]')) return;
      fecharRef.current();
    };
    document.addEventListener("pointerdown", aoApertar, true);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("pointerdown", aoApertar, true);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto, ref]);
}
