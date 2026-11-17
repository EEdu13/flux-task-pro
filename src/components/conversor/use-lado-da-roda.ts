import { useEffect, useState } from "react";

/** Menor e maior lado da roda, em pixels. */
const LADO_MINIMO = 300;
const LADO_MAXIMO = 680;

function calcular(): number {
  if (typeof window === "undefined") return 560;
  const menor = Math.min(window.innerWidth, window.innerHeight);
  // 90% da menor medida da janela: sobra respiro para o botão de fechar e a dica de baixo.
  return Math.round(Math.max(LADO_MINIMO, Math.min(menor * 0.9, LADO_MAXIMO)));
}

/**
 * O lado do quadrado em que a roda é desenhada (05/11/2026). Acompanha a
 * janela: o app de mesa pode ser redimensionado com o conversor aberto, e
 * notebook de tela pequena não pode cortar a roda.
 */
export function useLadoDaRoda(): number {
  const [lado, setLado] = useState(calcular);
  useEffect(() => {
    const aoRedimensionar = () => setLado(calcular());
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, []);
  return lado;
}
