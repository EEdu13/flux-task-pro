import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FocusEvent,
  type PointerEvent,
} from "react";
import type { CaixaDePrevia } from "./locais/miniaturas";
import type { LeitorDePrevias } from "./locais/previas";

/*
 * O que a prévia lateral compartilha com as telas (05/11/2026). Os componentes
 * estão em `previa-lateral.tsx`; aqui moram o contexto e os ganchos, separados
 * para o recarregamento rápido do Vite não desistir do arquivo dos componentes.
 *
 * As importações de `locais/*` são só de tipo: nada do pdf.js entra no pacote
 * por causa deste arquivo.
 */

export type ValorDaPrevia = {
  /** Quem está com a prévia aberta (o id que a miniatura ou a linha deu), ou nenhum. */
  ativo: string | null;
  /** O lugar, dentro do painel lateral, onde o conteúdo da prévia é desenhado. */
  slot: HTMLElement | null;
  /** A caixa, em px de CSS, em que a página ou a imagem precisa caber. */
  caixa: CaixaDePrevia;
  /** O mouse (ou o foco) chegou. Abre depois de uma espera curta; com a prévia já aberta, troca na hora. */
  entrar: (id: string) => void;
  /** O mouse (ou o foco) saiu. Fecha depois de uma espera mínima, para não piscar entre duas miniaturas. */
  sair: (id: string) => void;
  /** Some na hora, sem espera: a miniatura saiu da tela com a prévia aberta. */
  fechar: (id: string) => void;
  /** Enquanto uma linha é arrastada, nenhuma prévia abre. */
  bloquear: (bloqueado: boolean) => void;
};

export const ContextoDaPrevia = createContext<ValorDaPrevia | null>(null);

/**
 * Os gestos que abrem a prévia de um item: o mouse em cima ou o foco do
 * teclado. Espalhe `props` no elemento do item. `ativo` diz se é a vez dele.
 *
 * Toque não abre: não existe "passar por cima" no dedo, e a prévia surgiria
 * como um clarão a cada toque.
 */
export function usePreviaLateral(id: string) {
  const valor = useContext(ContextoDaPrevia);
  const entrar = valor?.entrar;
  const sair = valor?.sair;
  const fechar = valor?.fechar;

  // O item sai da tela com a prévia aberta (Voltar, Esc, arquivo tirado da lista): ela fecha junto.
  useEffect(() => {
    if (!fechar) return;
    return () => fechar(id);
  }, [fechar, id]);

  const props = useMemo(
    () => ({
      onPointerEnter: (e: PointerEvent) => {
        if (e.pointerType !== "touch") entrar?.(id);
      },
      onPointerLeave: (e: PointerEvent) => {
        if (e.pointerType !== "touch") sair?.(id);
      },
      // Só o foco de quem navega pelo teclado: o clique também dá foco, e a prévia
      // grudaria na página recém-marcada mesmo com o mouse longe.
      onFocus: (e: FocusEvent<HTMLElement>) => {
        if (e.target.matches(":focus-visible")) entrar?.(id);
      },
      onBlur: (e: FocusEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget)) sair?.(id);
      },
    }),
    [entrar, sair, id],
  );

  return { props, ativo: valor?.ativo === id };
}

/** Enquanto `bloqueado`, a prévia não abre (e a que está aberta fecha). */
export function useBloquearPrevia(bloqueado: boolean) {
  const bloquear = useContext(ContextoDaPrevia)?.bloquear;
  useEffect(() => {
    if (!bloquear) return;
    bloquear(bloqueado);
    return () => bloquear(false);
  }, [bloquear, bloqueado]);
}

/**
 * O leitor das prévias de linha (a primeira página de um PDF, uma imagem),
 * carregado sob demanda e solto quando a tela sai. `null` até ficar pronto — e
 * para sempre se o carregamento falhar: sem leitor, a prévia só não aparece.
 */
export function useLeitorDePrevias(): LeitorDePrevias | null {
  const [leitor, setLeitor] = useState<LeitorDePrevias | null>(null);
  useEffect(() => {
    let vivo = true;
    let criado: LeitorDePrevias | null = null;
    import("./locais/previas").then(
      (m) => {
        criado = m.criarLeitorDePrevias();
        if (vivo) setLeitor(criado);
        else criado.fechar();
      },
      () => {},
    );
    return () => {
      vivo = false;
      criado?.fechar();
    };
  }, []);
  return leitor;
}
