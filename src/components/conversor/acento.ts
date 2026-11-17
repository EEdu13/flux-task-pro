import type { CSSProperties } from "react";

/**
 * A cor de destaque da roda e da faixa do arrastar (05/11/2026): o tom e a
 * saturação do tema (`--primary`), com a luminosidade fixada em 84%.
 *
 * Os dois ficam sobre um véu escuro, e o `--primary` puro some nele em várias
 * paletas — o verde do tema claro é escuro, e o "noir" claro é quase preto.
 * Com a luminosidade fixa, o destaque aparece em qualquer paleta e ainda
 * carrega o tom dela: verde claro no padrão, azul claro no "ocean", cinza
 * claro no "noir". A sintaxe de cor relativa vale do Chrome 119 em diante, e o
 * app de mesa usa o WebView2 atual. Quem usa lê `var(--acento)`; o contêiner
 * define a variável com este estilo.
 */
export const ESTILO_DO_ACENTO = {
  "--acento": "oklch(from var(--primary) 0.84 c h)",
} as CSSProperties;
