/*
 * Textura desenhada por código (telão de espera, quadro, logo, paisagem).
 *
 * Por que esperar `document.fonts.ready`: o primeiro desenho acontece antes da
 * fonte da página carregar e o canvas guardaria o texto na fonte de reserva
 * (e não redesenha sozinho). O `dispose()` no unmount devolve a memória da GPU.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";

export type Desenho = (g: CanvasRenderingContext2D, w: number, h: number) => void;

/** Fonte padrão dos textos desenhados (a mesma pilha da interface). */
export const FONTE =
  'Inter, "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
export const FONTE_EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

/**
 * Cria a textura uma vez e redesenha quando `chave` muda. Devolve null fora do
 * navegador (SSR) — quem usa desenha um material liso nesse caso.
 */
export function useTexturaDeCanvas(
  w: number,
  h: number,
  desenhar: Desenho,
  chave: string,
  opcoes: { anisotropia?: number } = {},
): CanvasTexture | null {
  const [textura] = useState(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = opcoes.anisotropia ?? 4;
    return t;
  });
  // A função muda a cada render; quem decide redesenhar é a `chave`.
  const desenho = useRef(desenhar);
  useLayoutEffect(() => {
    desenho.current = desenhar;
  });
  const [fontesProntas, setFontesProntas] = useState(false);

  useEffect(() => {
    let vivo = true;
    const fontes = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fontes) {
      setFontesProntas(true);
      return;
    }
    fontes.ready.then(
      () => vivo && setFontesProntas(true),
      // Sem a API de fontes não há o que esperar: desenha com a de reserva.
      () => vivo && setFontesProntas(true),
    );
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (!textura || !fontesProntas) return;
    const c = textura.image as HTMLCanvasElement;
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    desenho.current(g, c.width, c.height);
    textura.needsUpdate = true;
  }, [textura, fontesProntas, chave]);

  useEffect(() => () => textura?.dispose(), [textura]);
  return textura;
}

/** Retângulo de cantos arredondados (o roundRect nativo ainda falha em alguns WebView). */
export function retanguloArredondado(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** Corta o texto com reticências para caber em `max` px na fonte atual. */
export function cortarTexto(g: CanvasRenderingContext2D, texto: string, max: number): string {
  if (g.measureText(texto).width <= max) return texto;
  const chars = Array.from(texto);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const meio = Math.ceil((lo + hi) / 2);
    if (g.measureText(chars.slice(0, meio).join("") + "…").width <= max) lo = meio;
    else hi = meio - 1;
  }
  return chars.slice(0, lo).join("").trimEnd() + "…";
}

/** Quebra em até `linhas` linhas de `max` px; a última leva reticências se sobrar texto. */
export function quebrarTexto(
  g: CanvasRenderingContext2D,
  texto: string,
  max: number,
  linhas: number,
): string[] {
  const palavras = texto.split(/\s+/).filter(Boolean);
  const saida: string[] = [];
  let atual = "";
  let i = 0;
  for (; i < palavras.length; i++) {
    const tentativa = atual ? atual + " " + palavras[i] : palavras[i];
    if (g.measureText(tentativa).width <= max || !atual) {
      atual = tentativa;
      continue;
    }
    saida.push(atual);
    atual = palavras[i];
    if (saida.length === linhas - 1) {
      atual = palavras.slice(i).join(" ");
      i = palavras.length;
      break;
    }
  }
  if (atual) saida.push(atual);
  const ultima = saida.length - 1;
  if (ultima >= 0) saida[ultima] = cortarTexto(g, saida[ultima], max);
  return saida.slice(0, linhas);
}
