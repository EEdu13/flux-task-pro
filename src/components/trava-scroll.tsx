import { useEffect } from "react";

/**
 * Trava a rolagem da página enquanto estiver montado.
 *
 * Dá para rolar o conteúdo atrás de um modal aberto, o que confunde na hora de
 * fechar — a pessoa rola achando que está mexendo no modal, o fundo se move, e
 * o modal parece ter saído do lugar.
 *
 * É componente e não hook de propósito: quase todo modal do app é renderizado
 * como `{aberto && <div …>}`, então montar/desmontar já é o sinal exato de
 * abrir/fechar. Como componente basta uma linha dentro do overlay, sem precisar
 * içar o booleano até o topo do componente pai para respeitar a ordem dos hooks.
 *
 * O contador de módulo cobre modal sobre modal (a grade abre o "Criar todas?"
 * por cima de si mesma): só o último a fechar devolve a rolagem.
 */

let abertos = 0;
let overflowAnterior = "";
let paddingAnterior = "";

export function TravaScroll() {
  useEffect(() => {
    abertos += 1;
    if (abertos === 1) {
      const body = document.body;
      overflowAnterior = body.style.overflow;
      paddingAnterior = body.style.paddingRight;
      // Sem compensar a barra de rolagem que some, o conteúdo atrás dá um salto
      // lateral no instante em que o modal abre.
      const larguraBarra = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = "hidden";
      if (larguraBarra > 0) body.style.paddingRight = `${larguraBarra}px`;
    }
    return () => {
      abertos -= 1;
      if (abertos === 0) {
        document.body.style.overflow = overflowAnterior;
        document.body.style.paddingRight = paddingAnterior;
      }
    };
  }, []);

  return null;
}
