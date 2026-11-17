import { useEffect } from "react";

/*
 * A trava do "soltar no vazio", para o app inteiro (12/11/2026).
 *
 * Fora das áreas que recebem arquivo, o navegador ABRE na própria janela o que for solto nela:
 * um arquivo do Windows vira a página, e um link solto navega para ele. No app de mesa isso tira
 * a pessoa do CONECTA, e numa chamada derruba a ligação. A trava nasceu dentro do conversor
 * (`use-arraste-de-arquivo.ts`), mas só valia onde ele estava montado: o /login, o /convidado, a
 * janela de chamada e — enquanto o conversor está escondido — a produção inteira ficavam sem
 * ela. Agora mora na raiz (`__root.tsx`) e vale em toda página, com ou sem conversor.
 *
 * Dois ouvintes, na janela:
 * - `dragover` na fase de BOLHA: quem aceita o arquivo (o chat, a grade, os arquivos do projeto,
 *   o conversor) chama `preventDefault` antes de o evento chegar aqui, porque o React trata os
 *   eventos das telas na raiz da página, abaixo da janela. O que chega sem dono vira "não pode
 *   soltar aqui" (cursor de proibido), e o soltar nem acontece;
 * - `drop` na fase de CAPTURA: cancela a abertura pelo navegador antes de qualquer tela, inclusive
 *   das que param a propagação (o calendário, o painel de delegar). Cancelar não esconde o
 *   arquivo de quem o aceita: o chat e a grade continuam lendo `dataTransfer.files`.
 *
 * Link arrastado para um campo de texto continua virando texto: com link, a trava não pega campo.
 * Texto puro (arrastar tarefa, um trecho) não é com ela.
 */

function oQueVem(e: DragEvent): "arquivo" | "link" | null {
  const tipos = e.dataTransfer ? Array.from(e.dataTransfer.types) : [];
  if (tipos.includes("Files")) return "arquivo";
  if (tipos.includes("text/uri-list")) return "link";
  return null;
}

function emCampoDeTexto(alvo: EventTarget | null): boolean {
  return (
    alvo instanceof Element &&
    !!alvo.closest("input, textarea, [contenteditable=''], [contenteditable='true']")
  );
}

function travar(e: DragEvent): boolean {
  const vem = oQueVem(e);
  return vem === "arquivo" || (vem === "link" && !emCampoDeTexto(e.target));
}

export function useTravaDeSoltar(): void {
  useEffect(() => {
    const aoPassar = (e: DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer || !travar(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "none";
    };
    const aoSoltar = (e: DragEvent) => {
      if (travar(e)) e.preventDefault();
    };
    window.addEventListener("dragover", aoPassar);
    window.addEventListener("drop", aoSoltar, true);
    return () => {
      window.removeEventListener("dragover", aoPassar);
      window.removeEventListener("drop", aoSoltar, true);
    };
  }, []);
}
