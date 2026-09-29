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

/* A largura da barra de rolagem da página, sempre em dia.
 *
 * Medida quando o navegador JÁ fez o layout — no aviso do ResizeObserver e no
 * resize da janela —, e não na hora de abrir o modal. Ler a largura ali, logo
 * depois de o React inserir o modal, obrigava o navegador a refazer o layout da
 * página inteira no meio do clique, e de novo em seguida por causa do
 * `overflow: hidden`. Medido na agenda do calendário, era metade do tempo de
 * abrir o modal.
 *
 * O observador olha o `<html>`, cujo tamanho muda quando a barra aparece ou
 * some e quando o conteúdo cresce — os casos em que a largura muda. Com a
 * página travada a barra some de propósito; essa medida é ignorada, para o
 * modal seguinte compensar a barra que existia antes dele. */
let larguraDaBarra: number | null = null;
let acompanhando = false;

const medirAgora = () => window.innerWidth - document.documentElement.clientWidth;

function acompanharBarra() {
  if (acompanhando || typeof window === "undefined" || typeof ResizeObserver === "undefined") {
    return;
  }
  acompanhando = true;
  const medir = () => {
    if (abertos > 0) return;
    larguraDaBarra = medirAgora();
  };
  new ResizeObserver(medir).observe(document.documentElement);
  window.addEventListener("resize", medir);
}

// Começa cedo: os modais são carregados junto com o layout, e o primeiro aviso
// do observador chega bem antes do primeiro clique.
acompanharBarra();

export function TravaScroll() {
  useEffect(() => {
    acompanharBarra();
    abertos += 1;
    if (abertos === 1) {
      const body = document.body;
      overflowAnterior = body.style.overflow;
      paddingAnterior = body.style.paddingRight;
      // Sem compensar a barra de rolagem que some, o conteúdo atrás dá um salto
      // lateral no instante em que o modal abre. Sem medida ainda (um modal que
      // abre antes do primeiro aviso do observador), mede na hora, como antes.
      const largura = larguraDaBarra ?? medirAgora();
      body.style.overflow = "hidden";
      if (largura > 0) body.style.paddingRight = `${largura}px`;
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
