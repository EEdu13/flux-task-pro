/**
 * O "Meu mês" (a retrospectiva estilo Spotify Wrapped) está pronto, mas
 * escondido até o lançamento (20/10/2026: "deixa escondido o Meu mês, que eu
 * vou soltar ele dia 30 como novidade").
 *
 * Com `false`: some do menu e da busca (Ctrl+K), não abre sozinho no dia 1º, a
 * página /meu-mes volta para o Início e a tela dele sai das novidades.
 * Para ver antes do lançamento: `/meu-mes?previa=1`, ou `?wrapped=1` em
 * qualquer tela para abrir a sequência do mês passado.
 *
 * Para lançar: troque para `true`, e coloque `TELA_DO_MEU_MES` (de
 * `novidades.tsx`) numa leva nova de novidades.
 */
export const MEU_MES_LIBERADO = false;
