import { useEffect, useRef } from "react";

/** Última posição do ponteiro — usada pelas animações de conclusão para saber
 *  de onde "estourar" (ex.: a linha da tarefa que você clicou). */
let lastPointer = { x: 400, y: 300 };
if (typeof window !== "undefined") {
  lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}
export function getLastPointer() {
  return lastPointer;
}

const SPARK_COLORS = [
  "var(--color-primary)",
  "#ffffff",
  "var(--color-warning)",
  "var(--color-info)",
];

/**
 * Micro-interações globais:
 *  - explosão de estrelinhas/faíscas no ponto do clique
 *  - (o cursor 3D é feito por CSS `cursor:`, não aqui)
 *
 * pointer-events: none — nunca rouba clique. Respeita prefers-reduced-motion.
 */
export function InteractionFX() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const track = (e: PointerEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", track);
    window.addEventListener("pointerdown", track);

    const onDown = (e: PointerEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      if (reduce) return;
      const target = e.target as HTMLElement | null;
      // Não borrifa enquanto digita/seleciona texto.
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const layer = layerRef.current;
      if (!layer) return;

      const strong = !!target?.closest(
        "button, a, [role='button'], label, summary, .cursor-pointer",
      );
      const count = strong ? 16 : 11;
      for (let i = 0; i < count; i++) {
        const spark = document.createElement("span");
        spark.className = "fx-spark";
        // Riscos que disparam pra fora, cada um alinhado à sua direção.
        const angleDeg = (360 / count) * i + Math.random() * 22 - 11;
        const dist = 30 + Math.random() * (strong ? 60 : 40);
        spark.style.left = `${e.clientX}px`;
        spark.style.top = `${e.clientY}px`;
        spark.style.setProperty("--ang", `${angleDeg}deg`);
        spark.style.setProperty("--dist", `${dist}px`);
        spark.style.setProperty("--len", `${12 + Math.random() * 16}px`);
        spark.style.setProperty("--d", `${Math.random() * 60}ms`);
        spark.style.setProperty(
          "--spark-color",
          SPARK_COLORS[i % SPARK_COLORS.length],
        );
        spark.addEventListener("animationend", () => spark.remove());
        window.setTimeout(() => spark.remove(), 900);
        layer.appendChild(spark);
      }
    };

    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("pointermove", track);
      window.removeEventListener("pointerdown", track);
      window.removeEventListener("pointerdown", onDown);
    };
  }, []);

  return <div ref={layerRef} className="fx-spark-layer" aria-hidden />;
}
