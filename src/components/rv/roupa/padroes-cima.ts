import type { CtxFace } from "./molde";
import { alfa, clarear, escurecer, pxs } from "./pincel";

/**
 * Padrões corridos e enfeites pintados das partes de cima novas
 * (16/10/2026): floral, havaiana, ondas do kimono, faixa de renas do
 * suéter, patches bordados da jaqueta jeans, sakura da bomber e o número
 * de camisa de time. Tudo em METROS na face (y para baixo), contínuo na
 * volta do bloco pela `faixa` (o motivo não "pula" ao virar a quina).
 */

const media = (f: CtxFace) => f.qualidade === "media";

/** Pseudoaleatório estável por célula (o mesmo desenho em toda pintura). */
const sorteio = (i: number, j: number, k = 0) => {
  const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Chama `motivo(x, y, i, j)` numa grade de período `P` (linhas alternadas
 * deslocadas meio passo), em coordenadas da face e contínua pela `faixa`.
 */
export function grade(
  f: CtxFace,
  P: number,
  motivo: (x: number, y: number, i: number, j: number) => void,
  Py = P,
) {
  const i0 = Math.floor(f.faixa / P) - 2;
  const i1 = Math.ceil((f.faixa + f.w) / P) + 2;
  for (let j = -1; j < f.h / Py + 2; j++) {
    const desloc = j % 2 ? P / 2 : 0;
    for (let i = i0; i <= i1; i++) {
      const x = i * P + desloc - f.faixa;
      if (x < -P || x > f.w + P) continue;
      motivo(x, j * Py, i, j);
    }
  }
}

/** Florzinha de 5 pétalas com miolo. */
export function flor(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  cor: string,
  miolo: string,
  giro = 0,
) {
  g.fillStyle = cor;
  for (let k = 0; k < 5; k++) {
    const a = giro + (k / 5) * Math.PI * 2;
    g.beginPath();
    g.ellipse(
      x + Math.cos(a) * r * 0.55,
      y + Math.sin(a) * r * 0.55,
      r * 0.52,
      r * 0.36,
      a,
      0,
      Math.PI * 2,
    );
    g.fill();
  }
  g.fillStyle = miolo;
  g.beginPath();
  g.arc(x, y, r * 0.3, 0, Math.PI * 2);
  g.fill();
}

/** Folhinha em gota apontando no ângulo `a`. */
function folhinha(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  comp: number,
  a: number,
  cor: string,
) {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.fillStyle = cor;
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(comp * 0.5, -comp * 0.32, comp, 0);
  g.quadraticCurveTo(comp * 0.5, comp * 0.32, 0, 0);
  g.fill();
  g.restore();
}

/** Floral miúdo (vestido floral): flores em 2 cores + folhinhas, espalhadas. */
export function floral(f: CtxFace, flor1: string, flor2: string, folha: string, miolo: string) {
  const { g } = f;
  const P = media(f) ? 0.09 : 0.075;
  grade(f, P, (x, y, i, j) => {
    const dx = (sorteio(i, j) - 0.5) * P * 0.3;
    const dy = (sorteio(i, j, 1) - 0.5) * P * 0.3;
    const r = P * (0.2 + sorteio(i, j, 2) * 0.08);
    const giro = sorteio(i, j, 3) * 6;
    folhinha(g, x + dx, y + dy, r * 2.1, giro, folha);
    folhinha(g, x + dx, y + dy, r * 1.8, giro + 2.6, folha);
    flor(g, x + dx, y + dy, r, (i + j) % 3 === 0 ? flor2 : flor1, miolo, giro);
  });
}

/** Hibisco (havaiana): 5 pétalas largas com veios e o pistilo comprido. */
function hibisco(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  cor: string,
  giro: number,
) {
  const escura = escurecer(cor, 0.35);
  for (let k = 0; k < 5; k++) {
    const a = giro + (k / 5) * Math.PI * 2;
    g.fillStyle = cor;
    g.beginPath();
    g.ellipse(
      x + Math.cos(a) * r * 0.5,
      y + Math.sin(a) * r * 0.5,
      r * 0.6,
      r * 0.42,
      a,
      0,
      Math.PI * 2,
    );
    g.fill();
  }
  // miolo escuro em estrela
  g.fillStyle = escura;
  g.beginPath();
  g.arc(x, y, r * 0.28, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = alfa(escura, 0.7);
  g.lineWidth = r * 0.07;
  g.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = giro + (k / 5) * Math.PI * 2;
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75);
  }
  g.stroke();
  g.strokeStyle = "#fde047";
  g.lineWidth = r * 0.09;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + Math.cos(giro + 0.6) * r * 0.95, y + Math.sin(giro + 0.6) * r * 0.95);
  g.stroke();
}

/** Folha de palmeira/costela-de-adão estilizada: nervura e recortes. */
function folhaTropical(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  comp: number,
  a: number,
  cor: string,
) {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.fillStyle = cor;
  for (let k = 0; k < 6; k++) {
    const t = (k + 0.5) / 6;
    const larg = comp * 0.3 * Math.sin(Math.PI * t);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(
        comp * t,
        s * larg * 0.5,
        comp * 0.08,
        larg * 0.55 + 0.002,
        s * 0.5,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
  }
  g.strokeStyle = escurecer(cor, 0.3);
  g.lineWidth = comp * 0.035;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(comp, 0);
  g.stroke();
  g.restore();
}

/** Estampa havaiana corrida: hibiscos grandes e folhas tropicais. */
export function havaiana(f: CtxFace, corFlor: string, corFlor2: string, folha: string) {
  const { g } = f;
  const P = 0.15;
  grade(
    f,
    P,
    (x, y, i, j) => {
      const giro = sorteio(i, j) * 6;
      folhaTropical(g, x, y, P * 0.85, giro, folha);
      folhaTropical(g, x, y, P * 0.7, giro + 2.4, clarear(folha, 0.18));
      hibisco(g, x + P * 0.08, y + P * 0.05, P * 0.27, (i + j) % 2 ? corFlor : corFlor2, giro);
    },
    P * 0.8,
  );
}

/**
 * Seigaiha (ondas do kimono): escamas de arcos concêntricos, contínuas.
 * `cor` = linhas; `fundo` = o miolo dos arcos.
 */
export function seigaiha(f: CtxFace, cor: string, fundo: string) {
  const { g } = f;
  const R = media(f) ? 0.05 : 0.04;
  const P = R * 2;
  const Py = R * 0.5;
  g.save();
  g.lineWidth = Math.max(R * 0.1, pxs(f, media(f) ? 2 : 1.2));
  grade(
    f,
    P,
    (x, y) => {
      for (let k = 4; k >= 1; k--) {
        g.fillStyle = k % 2 ? fundo : cor;
        g.beginPath();
        g.arc(x, y + R, (R * k) / 4, Math.PI, 0);
        g.closePath();
        g.fill();
      }
      g.strokeStyle = cor;
      g.beginPath();
      g.arc(x, y + R, R, Math.PI, 0);
      g.stroke();
    },
    Py,
  );
  g.restore();
}

/** Uma rena de tricô (perfil de blocos), virada para +x se `s` = 1. */
function rena(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  k: number,
  s: 1 | -1,
  cor: string,
) {
  // grade de "pontos": cada ponto é k×k
  const pix = [
    "....x.x...",
    "....xxx...",
    ".....x....",
    ".....xx...",
    "xxxxxxx...",
    "xxxxxx....",
    "x.x..x.x..",
    "x.x..x.x..",
  ];
  g.fillStyle = cor;
  pix.forEach((linha, j) => {
    for (let i = 0; i < linha.length; i++) {
      if (linha[i] !== "x") continue;
      const xx = s > 0 ? i : linha.length - 1 - i;
      g.fillRect(x + (xx - 5) * k, y + (j - 4) * k, k * 0.92, k * 0.92);
    }
  });
}

/** Floco de neve de 6 pontas (tricô). */
export function floco(g: CanvasRenderingContext2D, x: number, y: number, r: number, cor: string) {
  g.save();
  g.strokeStyle = cor;
  g.lineWidth = r * 0.22;
  g.lineCap = "round";
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    g.moveTo(x, y);
    g.lineTo(x + cx * r, y + cy * r);
    // farpinhas
    const bx = x + cx * r * 0.6;
    const by = y + cy * r * 0.6;
    for (const d of [-0.7, 0.7]) {
      g.moveTo(bx, by);
      g.lineTo(bx + Math.cos(a + d) * r * 0.35, by + Math.sin(a + d) * r * 0.35);
    }
  }
  g.stroke();
  g.restore();
}

/**
 * Faixa de Fair Isle do suéter: barra lisa na 2ª cor com renas e flocos
 * em "ponto" + ziguezague nas bordas. `y` e `alto` em y da face.
 */
export function faixaDeRenas(f: CtxFace, y: number, alto: number, cor: string, fundo: string) {
  const { g, w } = f;
  g.fillStyle = fundo;
  g.fillRect(-0.1, y, w + 0.2, alto);
  // ziguezague das bordas (dentes de 1,6 cm)
  const d = 0.016;
  g.fillStyle = cor;
  for (const [y0, s] of [
    [y, 1],
    [y + alto, -1],
  ] as const) {
    const x0 = -(f.faixa % (d * 2)) - d * 4;
    g.beginPath();
    g.moveTo(x0, y0);
    for (let x = x0; x < w + d * 4; x += d * 2) {
      g.lineTo(x + d, y0 + s * d * 0.9);
      g.lineTo(x + d * 2, y0);
    }
    g.closePath();
    g.fill();
  }
  const k = Math.min(alto / 12, 0.0085);
  const P = k * 22;
  const i0 = Math.floor(f.faixa / P) - 1;
  for (let i = i0; i < i0 + w / P + 3; i++) {
    const x = i * P - f.faixa;
    if (i % 3 === 2) floco(g, x, y + alto / 2, k * 3.2, cor);
    else rena(g, x, y + alto / 2 + k * 0.5, k, i % 3 === 0 ? 1 : -1, cor);
  }
}

/** Fileira de pontinhos (tricô) entre faixas. */
export function pontinhos(f: CtxFace, y: number, cor: string, passo = 0.024) {
  const { g, w } = f;
  g.fillStyle = cor;
  const x0 = -(f.faixa % passo) - passo;
  for (let x = x0; x < w + passo; x += passo) g.fillRect(x, y, passo * 0.35, passo * 0.35);
}

/* ———————————————————— patches bordados ———————————————————— */

export type TipoPatch = "estrela" | "raio" | "smile" | "coracao" | "pinheiro" | "flor";

/**
 * Patch bordado (jaqueta jeans): disco de feltro com sombra, borda em ponto
 * cheio e o motivo no meio. `r` = raio (m).
 */
export function patch(f: CtxFace, tipo: TipoPatch, x: number, y: number, r: number) {
  const { g } = f;
  const cores: Record<TipoPatch, [string, string]> = {
    estrela: ["#1d4ed8", "#facc15"],
    raio: ["#111827", "#facc15"],
    smile: ["#facc15", "#1f2937"],
    coracao: ["#f8fafc", "#e11d48"],
    pinheiro: ["#fef3c7", "#15803d"],
    flor: ["#f9a8d4", "#f8fafc"],
  };
  const [fundo, motivo] = cores[tipo];
  g.save();
  // sombra de relevo
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.beginPath();
  g.arc(x + r * 0.08, y + r * 0.14, r * 1.02, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = fundo;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  // borda em ponto cheio (merrow)
  g.strokeStyle = escurecer(fundo === "#f8fafc" ? "#94a3b8" : fundo, 0.35);
  g.lineWidth = r * 0.16;
  g.beginPath();
  g.arc(x, y, r * 0.92, 0, Math.PI * 2);
  g.stroke();
  if (!media(f)) {
    g.strokeStyle = "rgba(255,255,255,0.25)";
    g.lineWidth = Math.max(pxs(f, 1), r * 0.03);
    g.setLineDash([r * 0.06, r * 0.05]);
    g.beginPath();
    g.arc(x, y, r * 0.92, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  g.fillStyle = motivo;
  g.strokeStyle = motivo;
  const p = (a: number, rr: number): [number, number] => [
    x + Math.cos(a) * rr,
    y + Math.sin(a) * rr,
  ];
  g.beginPath();
  switch (tipo) {
    case "estrela":
      for (let k = 0; k < 10; k++)
        g.lineTo(...p(-Math.PI / 2 + (k * Math.PI) / 5, k % 2 ? r * 0.3 : r * 0.68));
      g.closePath();
      g.fill();
      break;
    case "raio":
      for (const [dx, dy] of [
        [0.12, -0.7],
        [-0.35, 0.08],
        [-0.02, 0.08],
        [-0.14, 0.7],
        [0.36, -0.14],
        [0.04, -0.14],
        [0.22, -0.7],
      ])
        g.lineTo(x + dx * r, y + dy * r);
      g.closePath();
      g.fill();
      break;
    case "smile":
      g.arc(x - r * 0.3, y - r * 0.2, r * 0.12, 0, Math.PI * 2);
      g.arc(x + r * 0.3, y - r * 0.2, r * 0.12, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = r * 0.14;
      g.lineCap = "round";
      g.beginPath();
      g.arc(x, y, r * 0.48, 0.5, Math.PI - 0.5);
      g.stroke();
      break;
    case "coracao":
      g.moveTo(x, y + r * 0.55);
      g.bezierCurveTo(x - r * 0.9, y - r * 0.05, x - r * 0.35, y - r * 0.75, x, y - r * 0.28);
      g.bezierCurveTo(x + r * 0.35, y - r * 0.75, x + r * 0.9, y - r * 0.05, x, y + r * 0.55);
      g.fill();
      break;
    case "pinheiro":
      g.moveTo(x, y - r * 0.68);
      g.lineTo(x + r * 0.5, y + r * 0.35);
      g.lineTo(x - r * 0.5, y + r * 0.35);
      g.closePath();
      g.fill();
      g.fillStyle = "#7c4a26";
      g.fillRect(x - r * 0.1, y + r * 0.35, r * 0.2, r * 0.3);
      break;
    case "flor":
      flor(g, x, y, r * 0.62, motivo, "#facc15");
      break;
  }
  g.restore();
}

/* ———————————————————— sakura (bomber de cetim) ———————————————————— */

/**
 * Galho de cerejeira bordado: curva marrom com raminhos e flores rosa de 5
 * pétalas (com contorno, lê de longe). `escala` 1 = galho de ~30 cm.
 */
export function galhoSakura(
  f: CtxFace,
  x: number,
  y: number,
  escala: number,
  espelhar = false,
  flor1 = "#f9a8d4",
) {
  const { g } = f;
  const k = escala;
  const s = espelhar ? -1 : 1;
  g.save();
  g.translate(x, y);
  g.scale(s * k, k);
  g.lineCap = "round";
  g.strokeStyle = "#3f2a1d";
  g.lineWidth = 0.016;
  g.beginPath();
  g.moveTo(-0.15, 0.12);
  g.bezierCurveTo(-0.06, 0.04, 0.02, 0.06, 0.15, -0.1);
  g.moveTo(-0.02, 0.06);
  g.quadraticCurveTo(0.0, -0.02, -0.04, -0.09);
  g.moveTo(0.07, 0.0);
  g.quadraticCurveTo(0.12, 0.05, 0.16, 0.06);
  g.stroke();
  const flores: [number, number, number][] = [
    [0.15, -0.1, 0.034],
    [-0.04, -0.09, 0.03],
    [0.16, 0.06, 0.026],
    [0.05, 0.02, 0.028],
    [-0.1, 0.06, 0.024],
    [0.1, -0.05, 0.02],
  ];
  for (const [fx, fy, r] of flores) {
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.beginPath();
    g.arc(fx + 0.003, fy + 0.004, r * 1.05, 0, Math.PI * 2);
    g.fill();
    flor(g, fx, fy, r, flor1, "#be185d", fx * 9);
    g.fillStyle = "rgba(255,255,255,0.45)";
    g.beginPath();
    g.arc(fx - r * 0.25, fy - r * 0.3, r * 0.18, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/* ———————————————————— número de camisa ———————————————————— */

/** Número de costas (camisa de time): bloco com contorno, centrado em (cx, cy). */
export function numeroDeCamisa(
  f: CtxFace,
  texto: string,
  cx: number,
  cy: number,
  alto: number,
  cor: string,
  contorno: string,
) {
  const { g } = f;
  g.save();
  // fonte em 100 px e escala: fonte de fração de pixel (metros) arredonda mal
  g.translate(cx, cy);
  g.scale(alto / 100, alto / 100);
  g.font = `900 100px "Arial Black", Impact, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.strokeStyle = contorno;
  g.lineWidth = 16;
  g.strokeText(texto, 0, 0);
  g.fillStyle = cor;
  g.fillText(texto, 0, 0);
  g.restore();
}
