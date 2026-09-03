import { useCallback, useRef, useState } from "react";

/**
 * Estado de "processando" para botões que chamam a rede.
 *
 * Resolve dois problemas de uma vez:
 *
 * 1. A pessoa clica e nada muda na tela. Numa ação que fala com os EUA — o
 *    LiveKit, o Azure — isso é meio segundo ou mais de dúvida, e a reação
 *    natural é clicar de novo.
 * 2. Clicar de novo dispara a ação duas vezes. O `pendenteRef` bloqueia a
 *    segunda chamada antes mesmo do React re-renderizar, o que o estado
 *    sozinho não garante.
 *
 * O `finally` libera sempre, inclusive quando a ação lança — senão um erro
 * deixaria o botão travado para sempre.
 *
 * Uso:
 *   const { pendente, executar } = useAcaoPendente();
 *   <button disabled={pendente} onClick={() => executar(async () => { … })}>
 */
export function useAcaoPendente() {
  const [pendente, setPendente] = useState(false);
  const pendenteRef = useRef(false);

  const executar = useCallback(async (acao: () => void | Promise<void>) => {
    if (pendenteRef.current) return;
    pendenteRef.current = true;
    setPendente(true);
    try {
      await acao();
    } finally {
      pendenteRef.current = false;
      setPendente(false);
    }
  }, []);

  return { pendente, executar };
}
