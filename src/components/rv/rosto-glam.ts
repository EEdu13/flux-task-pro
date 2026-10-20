import type { AvatarConfig } from "@/lib/avatar-3d";

/**
 * Rostos "glam" femininos — maquiados e com botox (16/10/2026, a pedido:
 * sobrancelha arqueada, olho amendoado com delineado gatinho e cílios longos,
 * blush suave e boca carnuda com gloss, como os rostos maquiados do Roblox).
 *
 * Desenha no mesmo quadro 256×256 de `desenharRosto` (olhos em x 86/170,
 * y 104; boca em torno de y 172). As cores de boca, blush e sombra saem da
 * própria pele (mistura), então funcionam do tom mais claro ao mais escuro.
 * Não importa three: só o contexto 2D — dá para pré-visualizar fora do app.
 */

const OE = 86;
const OD = 170;
const OY = 104;
const DELINEADO = "#15100e";

/** "feliz" = fechado sorrindo (∩); "meio" = pálpebra baixa, olhar de diva (16/10/2026). */
type TipoOlhoGlam = "aberto" | "fechado" | "feliz" | "meio";

type EstiloGlam = {
  olhos: [TipoOlhoGlam, TipoOlhoGlam];
  /** Meia largura da boca, quanto os cantos sobem e abertura (0 = fechada). */
  boca: { meia: number; sobe: number; abre: number };
  /** Pinta pequena perto da boca (referência 111). */
  pinta?: boolean;
  /* Lote 2 (16/10/2026, referência 112: cílios volumosos, olho com brilhos,
   * sobrancelha marcada e boca ombré). Tudo opcional: os 4 primeiros rostos
   * não mudam. */
  /** Cílios postiços volumosos, bem fartos e compridos. */
  volume?: boolean;
  /** Brilhinhos extras na íris. */
  brilho?: boolean;
  /** Sobrancelha grossa e marcada, quase reta. */
  forte?: boolean;
  /** Boca ombré: contorno escuro, meio claro. */
  ombre?: boolean;
  /** Biquinho de beijo (fechado) com coraçãozinho no ar. */
  beijo?: boolean;
  /** Sobrancelha direita erguida (olhar de diva). */
  ergue?: boolean;
  /** Glitter dourado nas pálpebras. */
  glitter?: boolean;
  /** Tamanho do olho (padrão 1,12). */
  escala?: number;
};

const ESTILOS: Record<string, EstiloGlam> = {
  glamSorriso: { olhos: ["aberto", "aberto"], boca: { meia: 34, sobe: 5, abre: 7 } },
  glamBeicinho: { olhos: ["aberto", "aberto"], boca: { meia: 32, sobe: 2, abre: 0 }, pinta: true },
  glamPiscadinha: { olhos: ["aberto", "fechado"], boca: { meia: 31, sobe: 4, abre: 0 } },
  glamSerena: { olhos: ["fechado", "fechado"], boca: { meia: 30, sobe: 4, abre: 0 } },
  // Lote 2 (16/10/2026). glamCilios = referência 112 (cílios fartos, olho castanho com brilho, boca ombré).
  glamCilios: {
    olhos: ["aberto", "aberto"],
    boca: { meia: 33, sobe: 2, abre: 0 },
    volume: true,
    brilho: true,
    forte: true,
    ombre: true,
  },
  glamRisonha: { olhos: ["feliz", "feliz"], boca: { meia: 34, sobe: 6, abre: 8 }, volume: true },
  glamBeijo: { olhos: ["aberto", "fechado"], boca: { meia: 30, sobe: 3, abre: 0 }, beijo: true },
  glamDiva: {
    olhos: ["meio", "meio"],
    boca: { meia: 31, sobe: 1, abre: 0 },
    volume: true,
    forte: true,
    ombre: true,
    ergue: true,
  },
  glamBrilho: {
    olhos: ["aberto", "aberto"],
    boca: { meia: 33, sobe: 5, abre: 6 },
    brilho: true,
    glitter: true,
    escala: 1.2,
  },
};

export function ehRostoGlam(expressao: string): boolean {
  return expressao in ESTILOS;
}

/* ——— cores ——— */

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hexDe(r: number, g: number, b: number): string {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) | (f(r) << 16) | (f(g) << 8) | f(b)).toString(16).slice(1)}`;
}
/** Mistura `a` com `b` (t = 0 → a, t = 1 → b). */
function misturar(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return hexDe(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
const escuro = (hex: string, t: number) => misturar(hex, "#000000", t);
const claro = (hex: string, t: number) => misturar(hex, "#ffffff", t);
function alfa(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
/** Pele "de gente" (r ≥ g ≥ b); azul/verde de fantasia recebem cores fixas. */
function peleNatural(hex: string): boolean {
  const [r, g, b] = rgb(hex);
  return r >= g && g >= b;
}

function paleta(pele: string) {
  const natural = peleNatural(pele);
  const base = natural ? pele : "#e8b49a";
  return {
    labio: misturar(base, "#c4506a", 0.5),
    blush: misturar(base, "#e0526e", 0.6),
    sombra: misturar(base, "#6b3a2e", 0.45),
    luz: claro(base, 0.45),
    /** Boca ombré (16/10/2026): rosado-amarronzado, como na referência 112. */
    labioOmbre: misturar(base, "#9a4545", 0.55),
  };
}

/* ——— peças ——— */

function blush(g: CanvasRenderingContext2D, cor: string) {
  [58, 198].forEach((x) => {
    const gr = g.createRadialGradient(x, 148, 2, x, 148, 30);
    gr.addColorStop(0, alfa(cor, 0.42));
    gr.addColorStop(1, alfa(cor, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(x, 148, 32, 24, 0, 0, Math.PI * 2);
    g.fill();
  });
}

/** Sobrancelha arqueada e afinada: cabeça mais clara, arco marcado, cauda fina. */
function sobrancelha(g: CanvasRenderingContext2D, x: number, lado: number, cor: string) {
  const y = 70;
  const gr = g.createLinearGradient(x - lado * 26, 0, x + lado * 10, 0);
  gr.addColorStop(0, alfa(cor, 0.55));
  gr.addColorStop(1, alfa(cor, 1));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(x - lado * 26, y + 8);
  g.lineTo(x - lado * 25, y + 1);
  g.quadraticCurveTo(x - lado * 8, y - 5, x + lado * 10, y - 7);
  g.quadraticCurveTo(x + lado * 23, y - 5, x + lado * 31, y + 5);
  g.quadraticCurveTo(x + lado * 21, y - 1, x + lado * 10, y - 1.5);
  g.quadraticCurveTo(x - lado * 8, y + 2, x - lado * 26, y + 8);
  g.fill();
}

/** Sobrancelha grossa e marcada (lote 2): cabeça cheia, arco baixo e cauda curta. */
function sobrancelhaForte(g: CanvasRenderingContext2D, x: number, lado: number, cor: string) {
  const y = 69;
  const gr = g.createLinearGradient(x - lado * 27, 0, x + lado * 12, 0);
  gr.addColorStop(0, alfa(cor, 0.7));
  gr.addColorStop(1, alfa(cor, 1));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(x - lado * 27, y + 9);
  g.lineTo(x - lado * 26, y + 1);
  g.quadraticCurveTo(x - lado * 6, y - 5, x + lado * 12, y - 7);
  g.quadraticCurveTo(x + lado * 26, y - 6, x + lado * 33, y + 4);
  g.quadraticCurveTo(x + lado * 22, y + 1, x + lado * 12, y + 2.5);
  g.quadraticCurveTo(x - lado * 6, y + 4, x - lado * 27, y + 9);
  g.fill();
  // Fiozinhos na cabeça da sobrancelha (efeito "penteada").
  g.strokeStyle = alfa(cor, 0.75);
  g.lineWidth = 1.3;
  for (let k = 0; k < 5; k++) {
    const bx = x - lado * (25 - k * 3);
    g.beginPath();
    g.moveTo(bx, y + 8 - k * 0.6);
    g.lineTo(bx + lado * 3, y - 1 - k * 0.6);
    g.stroke();
  }
}

/** Brilho de 4 pontas (✦) — reflexo de olho e glitter. */
function faisca(g: CanvasRenderingContext2D, x: number, y: number, r: number, cor: string) {
  g.fillStyle = cor;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.fill();
}

type P = [number, number];
/** Ponto e tangente numa Bézier cúbica. */
function bezier(p0: P, p1: P, p2: P, p3: P, t: number): { p: P; d: P } {
  const u = 1 - t;
  const p: P = [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
  const d: P = [
    3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]),
    3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]),
  ];
  return { p, d };
}

/** Um cílio em ponta: base larga na linha do olho, ponta fina e curvada. */
function cilio(
  g: CanvasRenderingContext2D,
  raiz: P,
  dir: P,
  tam: number,
  largura: number,
  lado: number,
) {
  const [dx, dy] = dir;
  const n = Math.hypot(dx, dy) || 1;
  const ux = dx / n;
  const uy = dy / n;
  const px = -uy * largura;
  const py = ux * largura;
  const ponta: P = [raiz[0] + ux * tam + lado * tam * 0.25, raiz[1] + uy * tam];
  g.beginPath();
  g.moveTo(raiz[0] - px, raiz[1] - py);
  g.quadraticCurveTo(raiz[0] + ux * tam * 0.6, raiz[1] + uy * tam * 0.6, ponta[0], ponta[1]);
  g.quadraticCurveTo(
    raiz[0] + ux * tam * 0.4 + px,
    raiz[1] + uy * tam * 0.4 + py,
    raiz[0] + px,
    raiz[1] + py,
  );
  g.closePath();
  g.fill();
}

function sombraDeOlho(g: CanvasRenderingContext2D, x: number, lado: number, cor: string) {
  const gr = g.createRadialGradient(x + lado * 5, OY - 6, 4, x + lado * 5, OY - 6, 30);
  gr.addColorStop(0, alfa(cor, 0.5));
  gr.addColorStop(1, alfa(cor, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(x + lado * 5, OY - 6, 32, 22, 0, 0, Math.PI * 2);
  g.fill();
}

/** Delineado gatinho saindo do canto de fora. */
function gatinho(g: CanvasRenderingContext2D, x: number, lado: number, y0: number) {
  g.fillStyle = DELINEADO;
  g.beginPath();
  g.moveTo(x + lado * 12, y0 - 9);
  g.quadraticCurveTo(x + lado * 26, y0 - 9, x + lado * 34, y0 - 15);
  g.quadraticCurveTo(x + lado * 28, y0 - 4, x + lado * 20, y0 + 1);
  g.closePath();
  g.fill();
}

type ExtrasOlho = { volume?: boolean; brilho?: boolean; meio?: boolean };

function olhoAberto(
  g: CanvasRenderingContext2D,
  x: number,
  lado: number,
  iris: string,
  sombra: string,
  ex: ExtrasOlho = {},
) {
  const dentro: P = [x - lado * 19, OY + 4];
  const fora: P = [x + lado * 21, OY - 1];
  // "meio" (16/10/2026): pálpebra de cima mais baixa e reta = olhar de diva.
  const c1: P = ex.meio ? [x - lado * 12, OY - 4] : [x - lado * 12, OY - 13];
  const c2: P = ex.meio ? [x + lado * 10, OY - 6] : [x + lado * 10, OY - 15];
  const amendoa = () => {
    g.beginPath();
    g.moveTo(...dentro);
    g.bezierCurveTo(...c1, ...c2, ...fora);
    g.bezierCurveTo(x + lado * 12, OY + 12, x - lado * 8, OY + 13, ...dentro);
    g.closePath();
  };

  sombraDeOlho(g, x, lado, sombra);
  // Côncavo da pálpebra (o vinco), bem leve.
  g.strokeStyle = alfa(escuro(sombra, 0.35), 0.35);
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x - lado * 16, OY - 7);
  g.bezierCurveTo(x - lado * 6, OY - 21, x + lado * 12, OY - 21, x + lado * 23, OY - 9);
  g.stroke();

  amendoa();
  g.fillStyle = "#fbf6f2";
  g.fill();

  g.save();
  amendoa();
  g.clip();
  const ix = x + lado * 1;
  const iy = OY + 1;
  const gi = g.createRadialGradient(ix, iy + 2, 2, ix, iy, 12);
  gi.addColorStop(0, claro(iris, 0.3));
  gi.addColorStop(0.65, iris);
  gi.addColorStop(1, escuro(iris, 0.5));
  g.fillStyle = gi;
  g.beginPath();
  g.arc(ix, iy, 12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#120c0a";
  g.beginPath();
  g.arc(ix, iy, 5.2, 0, Math.PI * 2);
  g.fill();
  // Sombra da pálpebra de cima sobre o branco e a íris.
  const gs = g.createLinearGradient(0, OY - 14, 0, OY - 2);
  gs.addColorStop(0, "rgba(40,20,15,0.45)");
  gs.addColorStop(1, "rgba(40,20,15,0)");
  g.fillStyle = gs;
  g.fillRect(x - 30, OY - 20, 60, 20);
  g.restore();

  // Brilhos (luz sempre do mesmo lado nos dois olhos).
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(ix + 4, iy - 4, 3.2, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(ix - 3.5, iy + 4.5, 1.5, 0, Math.PI * 2);
  g.fill();
  if (ex.brilho) {
    // Olho "brilhando" da referência 112: faísca e pontinhos de luz na íris.
    faisca(g, ix - 4, iy - 3, 4.2, "rgba(255,255,255,0.95)");
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.beginPath();
    g.arc(ix + 5, iy + 4, 1.3, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(ix + 1, iy + 7, 0.9, 0, Math.PI * 2);
    g.fill();
  }

  // Linha d'água de baixo, só na metade de fora.
  g.strokeStyle = alfa(DELINEADO, 0.6);
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(...fora);
  g.bezierCurveTo(x + lado * 12, OY + 12, x - lado * 2, OY + 13, x - lado * 8, OY + 10);
  g.stroke();

  // Delineado de cima + gatinho.
  g.strokeStyle = DELINEADO;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(...dentro);
  g.bezierCurveTo(...c1, ...c2, ...fora);
  g.stroke();
  gatinho(g, x, lado, OY);

  // Cílios longos em pontas, crescendo para fora.
  g.fillStyle = DELINEADO;
  if (ex.volume) {
    ciliosVolume(g, x, lado, dentro, c1, c2, fora);
    return;
  }
  for (let i = 0; i < 10; i++) {
    const t = 0.18 + i * 0.085;
    const { p, d } = bezier(dentro, c1, c2, fora, t);
    // Normal da pálpebra (para cima), puxada para fora conforme anda no olho.
    const n = Math.hypot(d[0], d[1]) || 1;
    const dir: P = [(lado * d[1]) / n + lado * t * 0.9, (-lado * d[0]) / n];
    const tam = 4 + t * 9 + (i % 2) * 2.5;
    cilio(g, p, dir, tam, 1.3, lado);
  }
  // Cilinhos de baixo, no canto de fora.
  for (let k = 0; k < 3; k++) {
    const rx = x + lado * (6 + k * 5);
    const ry = OY + 11 - k * 1.5;
    cilio(g, [rx, ry], [lado * 0.5, 1], 3 + k * 0.6, 0.7, lado);
  }
}

/**
 * Cílios postiços volumosos (referência 112): duas camadas de fios em leque,
 * tufos mais compridos no canto de fora e cílios de baixo também cheios.
 */
function ciliosVolume(
  g: CanvasRenderingContext2D,
  x: number,
  lado: number,
  dentro: P,
  c1: P,
  c2: P,
  fora: P,
) {
  // Raiz grossa: o "risco" dos cílios postiços em cima do delineado.
  g.strokeStyle = DELINEADO;
  g.lineWidth = 5.5;
  g.beginPath();
  g.moveTo(...bezier(dentro, c1, c2, fora, 0.2).p);
  for (let t = 0.25; t <= 1.001; t += 0.05) g.lineTo(...bezier(dentro, c1, c2, fora, t).p);
  g.stroke();
  g.fillStyle = DELINEADO;
  for (let camada = 0; camada < 2; camada++) {
    const n = camada ? 13 : 17;
    for (let i = 0; i < n; i++) {
      const t = 0.14 + (i / (n - 1)) * 0.86;
      const { p, d } = bezier(dentro, c1, c2, fora, t);
      const m = Math.hypot(d[0], d[1]) || 1;
      // Cada fio abre um pouco para os lados (efeito "fofo"), mais para fora no canto.
      const abre = ((i * 7) % 5) / 5 - 0.4;
      const dir: P = [
        (lado * d[1]) / m + lado * (t * 1.25 + abre * 0.35),
        (-lado * d[0]) / m - (camada ? 0.15 : 0),
      ];
      const tufo = i % 4 === 2 ? 4 : 0;
      const tam = (camada ? 5 : 7) + t * (camada ? 10 : 14) + tufo + (i % 2) * 2;
      cilio(g, p, dir, tam, camada ? 1.1 : 1.6, lado);
    }
  }
  // Cílios de baixo: fileira cheia e curtinha, maior no canto de fora.
  for (let k = 0; k < 6; k++) {
    const rx = x - lado * 6 + lado * k * 5;
    const ry = OY + 12 - k * 1.3;
    cilio(g, [rx, ry], [lado * (0.3 + k * 0.1), 1], 2.6 + k * 0.7, 0.75, lado);
  }
}

/** Olho fechado sorrindo (∩) com os cílios fartos para cima. */
function olhoFeliz(
  g: CanvasRenderingContext2D,
  x: number,
  lado: number,
  sombra: string,
  volume: boolean,
) {
  const dentro: P = [x - lado * 19, OY + 6];
  const c1: P = [x - lado * 9, OY - 7];
  const c2: P = [x + lado * 10, OY - 8];
  const fora: P = [x + lado * 21, OY + 3];
  sombraDeOlho(g, x, lado, sombra);
  g.strokeStyle = DELINEADO;
  g.lineWidth = 4.5;
  g.beginPath();
  g.moveTo(...dentro);
  g.bezierCurveTo(...c1, ...c2, ...fora);
  g.stroke();
  gatinho(g, x, lado, OY + 3);
  g.fillStyle = DELINEADO;
  const n = volume ? 12 : 8;
  for (let i = 0; i < n; i++) {
    const t = 0.2 + (i / (n - 1)) * 0.75;
    const { p, d } = bezier(dentro, c1, c2, fora, t);
    const m = Math.hypot(d[0], d[1]) || 1;
    const dir: P = [(lado * d[1]) / m + lado * t * 0.9, (-lado * d[0]) / m];
    cilio(g, p, dir, (volume ? 5 : 4) + t * (volume ? 11 : 8), volume ? 1.4 : 1.2, lado);
  }
}

/** Glitter dourado na pálpebra. */
function glitterPalpebra(g: CanvasRenderingContext2D, x: number, lado: number) {
  const pontos: [number, number, number][] = [
    [-10, -12, 1.4],
    [-3, -16, 1.8],
    [4, -14, 1.2],
    [10, -17, 1.6],
    [15, -11, 1.3],
    [-14, -7, 1.1],
    [0, -10, 1],
  ];
  pontos.forEach(([dx, dy, r], i) => {
    g.fillStyle = i % 3 ? "rgba(253,224,71,0.95)" : "rgba(255,255,255,0.95)";
    g.beginPath();
    g.arc(x + lado * dx, OY + dy, r, 0, Math.PI * 2);
    g.fill();
  });
  faisca(g, x + lado * 22, OY - 20, 4.5, "rgba(255,255,255,0.95)");
}

/** Biquinho de beijo, com um coraçãozinho saindo da boca. */
function labiosBeijo(g: CanvasRenderingContext2D, cor: string, luz: string) {
  const cx = 128;
  const cy = 176;
  g.strokeStyle = alfa(luz, 0.7);
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(cx - 5, cy - 16);
  g.lineTo(cx, cy - 13);
  g.lineTo(cx + 5, cy - 16);
  g.stroke();
  // Lábio de cima: dois montinhos franzidos.
  g.fillStyle = escuro(cor, 0.08);
  g.beginPath();
  g.moveTo(cx - 17, cy);
  g.bezierCurveTo(cx - 17, cy - 12, cx - 7, cy - 15, cx, cy - 10);
  g.bezierCurveTo(cx + 7, cy - 15, cx + 17, cy - 12, cx + 17, cy);
  g.quadraticCurveTo(cx, cy - 3, cx - 17, cy);
  g.fill();
  // Lábio de baixo, redondo e mais claro.
  const gb = g.createLinearGradient(0, cy, 0, cy + 16);
  gb.addColorStop(0, escuro(cor, 0.1));
  gb.addColorStop(0.5, claro(cor, 0.12));
  gb.addColorStop(1, escuro(cor, 0.12));
  g.fillStyle = gb;
  g.beginPath();
  g.moveTo(cx - 17, cy);
  g.quadraticCurveTo(cx, cy - 3, cx + 17, cy);
  g.bezierCurveTo(cx + 17, cy + 18, cx - 17, cy + 18, cx - 17, cy);
  g.fill();
  // Franzido e o furinho do meio.
  g.strokeStyle = alfa(escuro(cor, 0.45), 0.6);
  g.lineWidth = 1.2;
  [-8, -3, 3, 8].forEach((dx) => {
    g.beginPath();
    g.moveTo(cx + dx * 1.1, cy - 6);
    g.lineTo(cx + dx, cy - 1.5);
    g.moveTo(cx + dx, cy + 2.5);
    g.lineTo(cx + dx * 1.15, cy + 9);
    g.stroke();
  });
  g.fillStyle = escuro(cor, 0.65);
  g.beginPath();
  g.ellipse(cx, cy, 4.5, 2.4, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.8)";
  g.beginPath();
  g.ellipse(cx + 5, cy + 7, 3.4, 1.6, -0.2, 0, Math.PI * 2);
  g.fill();
  // Coraçãozinho mandado no ar.
  const coracao = (x: number, y: number, r: number, c: string) => {
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(x, y + r * 0.9);
    g.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.8, y - r * 1.4, x, y - r * 0.5);
    g.bezierCurveTo(x + r * 0.8, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r * 0.9);
    g.fill();
  };
  coracao(cx + 34, cy - 14, 8, "#f43f5e");
  coracao(cx + 48, cy - 30, 5, "#fb7185");
}

/** Olho fechado relaxado (‿) com os cílios caindo para baixo. */
function olhoFechado(g: CanvasRenderingContext2D, x: number, lado: number, sombra: string) {
  const dentro: P = [x - lado * 19, OY + 2];
  const c1: P = [x - lado * 8, OY + 11];
  const c2: P = [x + lado * 10, OY + 11];
  const fora: P = [x + lado * 21, OY];
  sombraDeOlho(g, x, lado, sombra);
  g.strokeStyle = DELINEADO;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(...dentro);
  g.bezierCurveTo(...c1, ...c2, ...fora);
  g.stroke();
  gatinho(g, x, lado, OY + 5);
  g.fillStyle = DELINEADO;
  for (let i = 0; i < 7; i++) {
    const t = 0.25 + i * 0.11;
    const { p } = bezier(dentro, c1, c2, fora, t);
    cilio(g, p, [lado * (0.15 + t * 0.6), 1], 3.5 + t * 6, 1.1, lado);
  }
}

/** Boca carnuda com gloss. `abre` > 0 mostra os dentes de cima. */
function labios(
  g: CanvasRenderingContext2D,
  cor: string,
  luz: string,
  { meia, sobe, abre }: EstiloGlam["boca"],
  ombre = false,
) {
  const cx = 128;
  const sy = 172;
  const L = cx - meia;
  const R = cx + meia;
  const yc = sy - sobe;
  const fundoCtrl = sy + 23 + abre;
  const linhaCima = sy + 3;
  const linhaBaixo = sy + 3 + abre * 2;

  const contornoCima = () => {
    g.moveTo(L, yc);
    g.bezierCurveTo(L + 7, yc - 8, cx - 20, sy - 17, cx - 9, sy - 15);
    g.quadraticCurveTo(cx - 3, sy - 15, cx, sy - 11);
    g.quadraticCurveTo(cx + 3, sy - 15, cx + 9, sy - 15);
    g.bezierCurveTo(cx + 20, sy - 17, R - 7, yc - 8, R, yc);
  };

  // Luz do arco do cupido na pele, logo acima da boca.
  g.strokeStyle = alfa(luz, 0.7);
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(cx - 6, sy - 18);
  g.lineTo(cx, sy - 15);
  g.lineTo(cx + 6, sy - 18);
  g.stroke();

  if (abre > 0) {
    // Vão da boca e os dentes de cima.
    g.save();
    g.beginPath();
    g.moveTo(L, yc);
    g.quadraticCurveTo(cx, linhaCima, R, yc);
    g.quadraticCurveTo(cx, linhaBaixo, L, yc);
    g.closePath();
    g.fillStyle = "#4a1d24";
    g.fill();
    g.clip();
    g.fillStyle = "#fbf8f4";
    g.fillRect(L, yc - 6, meia * 2, sy + 2 + abre * 0.85 - (yc - 6));
    const gd = g.createLinearGradient(0, sy - 2, 0, sy + 3);
    gd.addColorStop(0, "rgba(60,30,30,0.35)");
    gd.addColorStop(1, "rgba(60,30,30,0)");
    g.fillStyle = gd;
    g.fillRect(L, sy - 4, meia * 2, 8);
    g.restore();
  }

  // Lábio de cima.
  const gc = g.createLinearGradient(0, sy - 17, 0, sy + 3);
  gc.addColorStop(0, escuro(cor, 0.04));
  gc.addColorStop(1, escuro(cor, 0.16));
  g.fillStyle = gc;
  g.beginPath();
  contornoCima();
  g.quadraticCurveTo(cx, linhaCima, L, yc);
  g.closePath();
  g.fill();
  g.strokeStyle = alfa(escuro(cor, 0.35), 0.5);
  g.lineWidth = 1.2;
  g.beginPath();
  contornoCima();
  g.stroke();

  // Lábio de baixo, mais cheio e mais claro no meio.
  const topoBaixo = (yc + linhaBaixo) / 2;
  const fundo = 0.25 * yc + 0.75 * fundoCtrl;
  const gb = g.createLinearGradient(0, topoBaixo, 0, fundo);
  gb.addColorStop(0, escuro(cor, 0.12));
  gb.addColorStop(0.45, claro(cor, 0.12));
  gb.addColorStop(1, escuro(cor, 0.1));
  g.fillStyle = gb;
  g.beginPath();
  g.moveTo(L, yc);
  g.quadraticCurveTo(cx, linhaBaixo, R, yc);
  g.bezierCurveTo(R - 5, fundoCtrl, L + 5, fundoCtrl, L, yc);
  g.closePath();
  g.fill();
  g.strokeStyle = alfa(escuro(cor, 0.35), 0.45);
  g.beginPath();
  g.moveTo(R, yc);
  g.bezierCurveTo(R - 5, fundoCtrl, L + 5, fundoCtrl, L, yc);
  g.stroke();

  // Linha entre os lábios (fechada) e os cantinhos.
  g.strokeStyle = escuro(cor, 0.6);
  g.lineWidth = abre > 0 ? 1.4 : 2.2;
  g.beginPath();
  g.moveTo(L - 1, yc + 0.5);
  g.quadraticCurveTo(cx, linhaCima, R + 1, yc + 0.5);
  g.stroke();

  // Ombré (16/10/2026): beirada escura e miolo claro, nos dois lábios.
  if (ombre) {
    g.save();
    g.beginPath();
    contornoCima();
    g.bezierCurveTo(R - 5, fundoCtrl, L + 5, fundoCtrl, L, yc);
    g.closePath();
    g.clip();
    const go = g.createRadialGradient(cx, sy + 2, 2, cx, sy + 2, meia * 1.05);
    go.addColorStop(0, alfa(claro(cor, 0.35), 0.55));
    go.addColorStop(0.45, alfa(cor, 0));
    go.addColorStop(1, alfa(escuro(cor, 0.45), 0.75));
    g.fillStyle = go;
    g.fillRect(L - 2, sy - 20, meia * 2 + 4, 50);
    g.restore();
    g.strokeStyle = alfa(escuro(cor, 0.5), 0.8);
    g.lineWidth = 1.8;
    g.beginPath();
    contornoCima();
    g.bezierCurveTo(R - 5, fundoCtrl, L + 5, fundoCtrl, L, yc);
    g.stroke();
  }

  // Gloss: faixa de luz no lábio de baixo e pontos no de cima.
  const gy = (topoBaixo + fundo) / 2 - 1;
  const gg = g.createRadialGradient(cx + 3, gy, 1, cx + 3, gy, meia * 0.42);
  gg.addColorStop(0, "rgba(255,255,255,0.7)");
  gg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gg;
  g.beginPath();
  g.ellipse(cx + 3, gy, meia * 0.42, 4, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath();
  g.ellipse(cx + 6, gy - 0.5, 2.6, 1.3, -0.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.4)";
  [-1, 1].forEach((l) => {
    g.beginPath();
    g.ellipse(cx + l * 9, sy - 10, 4, 1.4, l * 0.25, 0, Math.PI * 2);
    g.fill();
  });
}

/**
 * Desenha o rosto glam inteiro (blush, sobrancelhas, olhos e boca) no
 * contexto já criado por `desenharRosto`. `bocaAberta` = quadro do "falando":
 * lábios entreabertos mostrando os dentes.
 */
export function desenharRostoGlam(
  g: CanvasRenderingContext2D,
  c: Pick<AvatarConfig, "expressao" | "pele" | "olhos" | "corCabelo" | "detalhe">,
  bocaAberta: boolean,
  corSobrancelha: string,
) {
  const estilo = ESTILOS[c.expressao];
  if (!estilo) return;
  const cores = paleta(c.pele);

  blush(g, cores.blush);
  const sob = estilo.forte ? sobrancelhaForte : sobrancelha;
  sob(g, OE, -1, corSobrancelha);
  g.save();
  // Sobrancelha direita erguida (glamDiva, 16/10/2026).
  if (estilo.ergue) g.translate(0, -6);
  sob(g, OD, 1, corSobrancelha);
  g.restore();

  [OE, OD].forEach((x, i) => {
    const lado = i === 0 ? -1 : 1;
    // Olho glam é um pouco maior que o dos outros rostos (como nas referências).
    const esc = estilo.escala ?? 1.12;
    g.save();
    g.translate(x, OY);
    g.scale(esc, esc);
    g.translate(-x, -OY);
    const tipo = estilo.olhos[i];
    if (estilo.glitter) glitterPalpebra(g, x, lado);
    if (tipo === "aberto" || tipo === "meio")
      olhoAberto(g, x, lado, c.olhos, cores.sombra, {
        volume: estilo.volume,
        brilho: estilo.brilho,
        meio: tipo === "meio",
      });
    else if (tipo === "feliz") olhoFeliz(g, x, lado, cores.sombra, !!estilo.volume);
    else olhoFechado(g, x, lado, cores.sombra);
    g.restore();
  });

  const corLabio = estilo.ombre ? cores.labioOmbre : cores.labio;
  if (estilo.beijo && !bocaAberta) {
    labiosBeijo(g, corLabio, cores.luz);
  } else {
    const boca = bocaAberta
      ? { meia: estilo.boca.meia, sobe: Math.max(3, estilo.boca.sobe), abre: 11 }
      : estilo.boca;
    labios(g, corLabio, cores.luz, boca, estilo.ombre);
  }

  if (estilo.pinta && c.detalhe !== "pinta") {
    g.fillStyle = "rgba(55,32,24,0.75)";
    g.beginPath();
    g.arc(168, 186, 2.4, 0, Math.PI * 2);
    g.fill();
  }
}
