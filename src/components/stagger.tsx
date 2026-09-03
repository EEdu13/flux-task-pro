import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Entrada escalonada dos blocos de uma página, de cima para baixo.
 *
 * Use apenas em blocos de PRIMEIRO NÍVEL — as seções da página, nunca as linhas
 * dentro de uma lista. Numa lista de tarefas ou contatos o escalonamento atrasa
 * justamente a varredura que a pessoa foi fazer ali, e com 30 itens ou demora
 * demais ou fica imperceptível.
 */

/** Intervalo entre blocos. Curto o bastante para virar ritmo, não espera. */
const PASSO_S = 0.035;

/**
 * A partir daqui todos entram juntos.
 *
 * É o que mantém o tempo total constante: com 5 blocos ou com 50, a última
 * entrada começa no mesmo instante (~175ms). Sem esse teto, uma página que
 * cresça no futuro ficaria lenta sem ninguém perceber o porquê.
 */
const MAX_ESCALONADOS = 5;

export function BlocoEntrada({
  indice,
  children,
  className,
}: {
  indice: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: Math.min(indice, MAX_ESCALONADOS) * PASSO_S,
        duration: 0.28,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
