import { useEffect, useRef } from "react";

/**
 * Quanto tempo o Ctrl precisa ficar apertado SOZINHO para abrir o conversor.
 * 400 ms, como na especificação (confirmado pelo usuário em 05/11/2026). Se
 * abrir sem querer — quem aperta o Ctrl e demora a achar o C ou a rodinha —,
 * é aqui que se ajusta.
 */
export const MS_DO_CTRL = 400;

/**
 * Já há algo modal por cima: um diálogo (Radix ou dos nossos), a confirmação
 * (`confirm-dialog.tsx` usa `alertdialog`) ou o alerta de compromisso. A
 * especificação olhava só `role="dialog"` — e o conversor abriria por cima de
 * um "Excluir tarefa?".
 */
const ALGO_MODAL_ABERTO = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';

function focoEmCampoDeTexto(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/**
 * Chama `abrir` quando o Ctrl é segurado sozinho por `ms` (04/11/2026).
 *
 * Não abre se vier outra tecla junto (Ctrl+C, Ctrl+V, Ctrl+K…; o AltGr do
 * teclado ABNT2 também chega como Ctrl e cancela pela tecla que vem junto),
 * nem com clique (Ctrl+clique), rodinha (Ctrl+roda = zoom), troca de janela,
 * foco em campo de texto ou algo modal aberto. Soltar o Ctrl depois de aberto
 * não fecha: a pessoa precisa da mão livre para arrastar o arquivo.
 */
export function useCtrlSegurado(abrir: () => void, ligado: boolean, ms = MS_DO_CTRL): void {
  /* `abrir` muda a cada desenho de quem chama; guardado aqui, os ouvintes não
     precisam ser trocados a cada vez. */
  const abrirRef = useRef(abrir);
  useEffect(() => {
    abrirRef.current = abrir;
  }, [abrir]);

  useEffect(() => {
    if (!ligado) return;
    let timer: number | undefined;
    /* Botão do mouse já apertado: a pessoa está arrastando uma tarefa,
       selecionando texto ou puxando a barra de rolagem. Segurar o Ctrl no meio
       disso não é pedir o conversor — e abri-lo estragaria o gesto. */
    let botaoApertado = false;
    const cancelar = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const aoApertarBotao = () => {
      botaoApertado = true;
      cancelar(); // Ctrl+clique
    };
    const aoSoltarBotao = () => {
      botaoApertado = false;
    };
    const aoPerderFoco = () => {
      botaoApertado = false;
      cancelar(); // Alt+Tab no meio
    };
    const aoDescer = (e: KeyboardEvent) => {
      if (e.key !== "Control") {
        cancelar(); // outra tecla junto = atalho, não "segurar"
        return;
      }
      if (e.repeat || timer !== undefined) return;
      if (e.shiftKey || e.altKey || e.metaKey || botaoApertado) return;
      if (focoEmCampoDeTexto() || document.querySelector(ALGO_MODAL_ABERTO)) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        // Olha de novo: um diálogo pode ter aberto nesses 400 ms.
        if (document.querySelector(ALGO_MODAL_ABERTO) || focoEmCampoDeTexto()) return;
        abrirRef.current();
      }, ms);
    };
    const aoSubir = (e: KeyboardEvent) => {
      if (e.key === "Control") cancelar();
    };
    window.addEventListener("keydown", aoDescer, true);
    window.addEventListener("keyup", aoSubir, true);
    window.addEventListener("mousedown", aoApertarBotao, true);
    window.addEventListener("mouseup", aoSoltarBotao, true);
    window.addEventListener("wheel", cancelar, true); // Ctrl+roda = zoom
    window.addEventListener("blur", aoPerderFoco);
    return () => {
      cancelar();
      window.removeEventListener("keydown", aoDescer, true);
      window.removeEventListener("keyup", aoSubir, true);
      window.removeEventListener("mousedown", aoApertarBotao, true);
      window.removeEventListener("mouseup", aoSoltarBotao, true);
      window.removeEventListener("wheel", cancelar, true);
      window.removeEventListener("blur", aoPerderFoco);
    };
  }, [ligado, ms]);
}
