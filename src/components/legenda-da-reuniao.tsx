import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import type { Legenda } from "@/lib/use-ata-da-reuniao";

/**
 * A legenda da reunião (19/10/2026): o que acabou de ser dito, com o nome de
 * quem falou, embaixo do vídeo — para todos que estão na sala, como legenda
 * de TV. Sai da transcrição frase a frase, na hora; a ata usa outra, mais lenta
 * e mais exata (os blocos de fala).
 *
 * Desenhada por cima da caixa da reunião, medindo onde ela está: a caixa não é
 * `relative`, e a legenda não pode empurrar o vídeo.
 */
export function LegendaDaReuniao({
  legendas,
  alvo,
}: {
  legendas: Legenda[];
  alvo: RefObject<HTMLElement | null>;
}) {
  const [caixa, setCaixa] = useState<DOMRect | null>(null);
  useEffect(() => {
    const medir = () => setCaixa(alvo.current?.getBoundingClientRect() ?? null);
    medir();
    const id = window.setInterval(medir, 1000);
    window.addEventListener("resize", medir);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", medir);
    };
  }, [alvo]);

  if (!caixa || typeof document === "undefined") return null;
  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed z-[60] flex flex-col items-center gap-1 px-4"
      style={{
        left: caixa.left,
        width: caixa.width,
        // Acima da barra de controles da reunião.
        bottom: Math.max(16, window.innerHeight - caixa.bottom + 84),
      }}
    >
      <AnimatePresence initial={false}>
        {legendas.map((l) => (
          <motion.p
            key={l.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="max-w-3xl rounded-lg bg-black/75 px-3 py-1.5 text-center text-[15px] leading-snug text-white shadow-lg backdrop-blur-sm"
          >
            <span className="font-semibold text-amber-300">{l.quem}:</span> {l.texto}
          </motion.p>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
