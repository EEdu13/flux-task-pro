import type { CSSProperties } from "react";

/*
 * O visual das telas intermediárias do conversor (05/11/2026): o mesmo da roda.
 * Vidro escuro sobre o véu, texto branco em vários graus, peças arredondadas e
 * a cor de destaque (`--acento`, ver `acento.ts`) para o que está escolhido e
 * para a ação principal.
 *
 * Não depende do tema do app, como a roda: o painel é escuro nos dois temas, e
 * por isso aqui não há `bg-card`, `border-border` nem `text-muted-foreground`.
 *
 * As classes ficam aqui, inteiras, para o Tailwind achá-las e para as telas não
 * repetirem as mesmas linhas compridas.
 */

/** Uma peça sobre o painel: linha da lista, cartão de página, opção de formato. */
export const SUPERFICIE = "rounded-2xl border border-white/10 bg-white/[0.06]";

/** A ação principal: a pílula na cor de destaque. */
export const BOTAO_PRINCIPAL =
  "inline-flex items-center gap-2 rounded-full bg-[var(--acento)] px-5 py-2.5 text-sm font-semibold text-neutral-950 shadow-[0_8px_24px_color-mix(in_oklab,var(--acento)_32%,transparent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none";

/** Ação secundária: pílula só com o contorno. */
export const BOTAO_CONTORNO =
  "inline-flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/90 transition hover:bg-white/10";

/** Ação discreta: sem contorno, só se acende ao passar o mouse. */
export const BOTAO_DISCRETO =
  "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-white/65 transition hover:bg-white/10 hover:text-white";

/** Atalhos pequenos acima da grade de páginas ("Todas", "Nenhuma"). */
export const ATALHO_PEQUENO =
  "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition hover:bg-white/10";

/** O clarão suave em volta do que está escolhido — o mesmo brilho do bloco ativo da roda. */
export const BRILHO_DO_ESCOLHIDO: CSSProperties = {
  boxShadow: "0 0 26px color-mix(in oklab, var(--acento) 26%, transparent)",
};
