import { useSyncExternalStore } from "react";

/**
 * Os dois lançadores flutuantes estão recolhidos?
 *
 * O balão do chat e o raio de acesso rápido moram em componentes diferentes, em
 * arquivos diferentes, e precisam recolher JUNTOS ao mesmo clique. Um contexto
 * exigiria um provider novo na raiz para guardar um booleano; `useSyncExternalStore`
 * resolve com uma variável de módulo e uma lista de ouvintes, e qualquer
 * componente assina sem estar dentro de nada.
 *
 * A preferência fica no `localStorage`: quem recolheu porque os botões
 * atrapalhavam não quer recolher de novo a cada troca de tela.
 */

const CHAVE = "fluxo:lancadores-recolhidos";

function lerDoDisco(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CHAVE) === "1";
  } catch {
    return false;
  }
}

let recolhido = lerDoDisco();
const ouvintes = new Set<() => void>();

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

const ler = () => recolhido;

/* No servidor não há canto de tela nem preferência guardada. Devolver `false`
   fixo mantém a primeira pintura igual à do cliente que nunca recolheu, e o
   `useSyncExternalStore` corrige sozinho na hidratação de quem recolheu. */
const lerNoServidor = () => false;

export function useLancadoresRecolhidos(): boolean {
  return useSyncExternalStore(assinar, ler, lerNoServidor);
}

export function alternarLancadores(): void {
  recolhido = !recolhido;
  try {
    window.localStorage.setItem(CHAVE, recolhido ? "1" : "0");
  } catch {
    /* sem armazenamento, vale só para esta sessão — melhor que não funcionar */
  }
  for (const o of ouvintes) o();
}
