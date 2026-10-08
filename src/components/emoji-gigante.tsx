import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { primeiroNome } from "@/integrations/iam/types";

type Evento = { emoji: string; deNome: string; meu: boolean; chave: number };

/**
 * O emoji que toma a tela, estilo MSN (pedido do usuário, 08/10/2026): um
 * gigante no meio e uma chuva dele subindo ao redor, por uns 3 segundos.
 * Não bloqueia nada — `pointer-events-none` — e some sozinho.
 *
 * Ouve "fluxo:emoji-gigante", disparado por quem manda (para ver junto) e
 * pela sondagem de avisos de quem recebe — ver `avisos-no-chat.ts`.
 */
export function EmojiGigante() {
  const [atual, setAtual] = useState<Evento | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const aoReceber = (e: Event) => {
      const d = (e as CustomEvent<{ emoji: string; deNome: string; meu?: boolean }>).detail;
      if (!d?.emoji) return;
      setAtual({ emoji: d.emoji, deNome: d.deNome, meu: !!d.meu, chave: Date.now() });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAtual(null), 3200);
    };
    window.addEventListener("fluxo:emoji-gigante", aoReceber);
    return () => {
      window.removeEventListener("fluxo:emoji-gigante", aoReceber);
      window.clearTimeout(timer);
    };
  }, []);

  /* A chuva: posições e tempos sorteados uma vez por evento, para o desenho
     não pular a cada render. */
  const gotas = useMemo(
    () =>
      atual
        ? Array.from({ length: 22 }, (_, i) => ({
            id: i,
            x: Math.random() * 100,
            tamanho: 28 + Math.random() * 46,
            atraso: Math.random() * 0.9,
            duracao: 2 + Math.random() * 1.2,
            giro: (Math.random() - 0.5) * 60,
          }))
        : [],
    [atual],
  );

  return (
    <AnimatePresence>
      {atual && (
        <motion.div
          key={atual.chave}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-0 z-[470] overflow-hidden bg-black/10"
          aria-live="polite"
        >
          {gotas.map((g) => (
            <motion.span
              key={g.id}
              className="absolute select-none"
              style={{ left: `${g.x}%`, fontSize: g.tamanho }}
              initial={{ y: "105vh", rotate: 0, opacity: 0 }}
              animate={{ y: "-15vh", rotate: g.giro, opacity: [0, 1, 1, 0] }}
              transition={{ duration: g.duracao, delay: g.atraso, ease: "easeOut" }}
            >
              {atual.emoji}
            </motion.span>
          ))}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.div
              className="select-none leading-none drop-shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
              style={{ fontSize: "min(42vw, 42vh)" }}
              initial={{ scale: 0.1, rotate: -20 }}
              animate={{ scale: [0.1, 1.15, 0.95, 1.05, 1], rotate: [-20, 8, -4, 2, 0] }}
              transition={{ duration: 1.1, ease: "easeOut" }}
            >
              {atual.emoji}
            </motion.div>
            {/* Quem mandou, embaixo do emoji — a assinatura da brincadeira. */}
            <motion.div
              initial={{ y: 30, opacity: 0, scale: 0.8 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ delay: 0.45, type: "spring", stiffness: 300, damping: 18 }}
              className="mt-4 rounded-full bg-gradient-to-r from-primary via-lime-500 to-amber-400 px-7 py-2.5 text-2xl font-black uppercase tracking-tight text-white shadow-2xl md:text-3xl"
              style={{ textShadow: "0 2px 8px oklch(0.2 0.02 260 / 0.45)" }}
            >
              {atual.meu ? "Você mandou!" : `${primeiroNome(atual.deNome)} mandou!`}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
