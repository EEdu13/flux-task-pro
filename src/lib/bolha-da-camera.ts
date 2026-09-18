/**
 * Onde mora a bolha da câmera do apresentador.
 *
 * Fica fora do React porque tem dois leitores de naturezas diferentes: a
 * sobreposição na tela, que precisa re-renderizar quando a posição muda, e o
 * compositor da gravação (`composicao-gravacao.ts`), que é um laço de canvas
 * rodando 24 vezes por segundo e não pode depender de render nenhum. O laço
 * simplesmente lê daqui a cada quadro.
 *
 * A posição é o CENTRO da bolha em fração (0..1) da área da chamada, não em
 * pixels. Assim a mesma posição vale para a janela de quem arrastou, para uma
 * janela de outro tamanho e para o quadro de 1280×720 da gravação — e cada um
 * escolhe o próprio diâmetro.
 */

export type PosicaoDaBolha = { x: number; y: number };

/** Canto inferior direito, como no desenho que originou isto. */
export const POSICAO_PADRAO: PosicaoDaBolha = { x: 0.87, y: 0.76 };

const CHAVE = "fluxo.chamada.bolha";

function ler(): PosicaoDaBolha {
  if (typeof window === "undefined") return POSICAO_PADRAO;
  try {
    const cru = window.localStorage.getItem(CHAVE);
    if (!cru) return POSICAO_PADRAO;
    const p = JSON.parse(cru) as Partial<PosicaoDaBolha>;
    if (typeof p.x !== "number" || typeof p.y !== "number") return POSICAO_PADRAO;
    /* Vindo do armazenamento, número fora de 0..1 não é possível pelo caminho
       normal — mas é o tipo de coisa que, se acontecer, joga a bolha para fora
       da tela e parece que ela sumiu. */
    return { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
  } catch {
    return POSICAO_PADRAO;
  }
}

let atual: PosicaoDaBolha = ler();

export function posicaoDaBolha(): PosicaoDaBolha {
  return atual;
}

/**
 * Onde a bolha pode ficar sem sair da área.
 *
 * Recebe pixels (onde o ponteiro está, o tamanho da área e o da bolha) e
 * devolve o centro em fração. O limite é o RAIO, não zero: parar o centro na
 * borda deixaria metade da bolha para fora, que é o jeito de ela parecer
 * cortada ou sumida.
 *
 * Fica aqui, e não dentro do componente, porque é a única conta de verdade
 * nesse arrasto — o resto é ponteiro e CSS.
 */
export function posicaoLimitada(
  ponteiro: { x: number; y: number },
  area: { largura: number; altura: number },
  bolha: { largura: number; altura: number },
): PosicaoDaBolha {
  if (!area.largura || !area.altura) return POSICAO_PADRAO;
  const raioX = bolha.largura / 2 / area.largura;
  const raioY = bolha.altura / 2 / area.altura;
  /* Bolha maior que a área (janela minúscula): o raio passa de 0.5 e o teto
     ficaria abaixo do piso. Aí ela vai para o meio, que é o menos errado. */
  const limitar = (v: number, raio: number) =>
    raio >= 0.5 ? 0.5 : Math.min(1 - raio, Math.max(raio, v));
  return {
    x: limitar(ponteiro.x / area.largura, raioX),
    y: limitar(ponteiro.y / area.altura, raioY),
  };
}

/**
 * Move a bolha. Chamado a cada movimento do ponteiro, de propósito: é assim
 * que a gravação acompanha o arrasto em tempo real, já que o compositor lê
 * daqui a cada quadro. Não escreve em disco — ver `guardarBolha`.
 */
export function moverBolha(p: PosicaoDaBolha) {
  atual = p;
}

/**
 * Guarda a posição atual para as próximas chamadas. Só ao soltar: gravar a
 * cada pixel do arrasto escreveria no localStorage dezenas de vezes por
 * segundo, sem nenhum ganho.
 */
export function guardarBolha() {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(atual));
  } catch {
    /* sem localStorage a posição vale só para esta chamada; aceitável */
  }
}
