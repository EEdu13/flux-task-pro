import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import type { AvatarConfig } from "@/lib/avatar-3d";
import { desenharRostoGlam, ehRostoGlam } from "@/components/rv/rosto-glam";
import {
  desenharBarbaExtra,
  desenharDetalheExtra,
  desenharExpressaoExtra,
  desenharOculosExtra,
  ehBarbaExtra,
  ehExpressaoExtra,
  ehOculosExtra,
} from "@/components/rv/rosto-extras";

/**
 * Tudo o que no avatar é DESENHO, e não bloco: o rosto (olhos, boca,
 * sobrancelhas, barba, óculos, detalhes), os padrões de tecido (xadrez,
 * listrado, jeans, tricô) e as estampas da camiseta. Como no Roblox, é o
 * desenho que dá personalidade ao boneco de blocos.
 */

const S = 256;

function tela(): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d")!;
  g.lineCap = "round";
  g.lineJoin = "round";
  return { c, g };
}

function textura(c: HTMLCanvasElement, repetir = false): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  if (repetir) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export function escurecer(hex: string, quanto: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 - quanto))));
  return `#${((1 << 24) | (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).slice(1)}`;
}
export function clarear(hex: string, quanto: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v + (255 - v) * quanto);
  return `#${((1 << 24) | (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).slice(1)}`;
}
function alfa(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ————————————————— Rosto ————————————————— */

const OE = 86; // olho esquerdo (x)
const OD = 170; // olho direito (x)
const OY = 104;
const ESCURO = "#1b1b1b";

function coracao(g: CanvasRenderingContext2D, x: number, y: number, r: number, cor: string) {
  g.fillStyle = cor;
  g.beginPath();
  g.moveTo(x, y + r * 0.9);
  g.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.8, y - r * 1.4, x, y - r * 0.5);
  g.bezierCurveTo(x + r * 0.8, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r * 0.9);
  g.fill();
}

function estrela(g: CanvasRenderingContext2D, x: number, y: number, r: number, cor: string) {
  g.fillStyle = cor;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

type TipoDeOlho =
  "normal" | "feliz" | "fechado" | "piscando" | "arregalado" | "coracao" | "estrela" | "meio";

function olho(g: CanvasRenderingContext2D, x: number, tipo: TipoDeOlho, iris: string) {
  g.strokeStyle = ESCURO;
  g.lineWidth = 8;
  switch (tipo) {
    case "feliz": // ^
      g.beginPath();
      g.arc(x, OY + 8, 15, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
      return;
    case "fechado": // — com cílio de sono
      g.beginPath();
      g.arc(x, OY - 4, 15, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
      return;
    case "piscando":
      g.beginPath();
      g.moveTo(x - 15, OY + 2);
      g.lineTo(x + 15, OY - 2);
      g.stroke();
      return;
    case "coracao":
      coracao(g, x, OY, 18, "#e11d48");
      return;
    case "estrela":
      estrela(g, x, OY, 22, "#facc15");
      g.strokeStyle = "#a16207";
      g.lineWidth = 2;
      g.stroke();
      return;
    case "arregalado":
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.arc(x, OY, 20, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 5;
      g.stroke();
      g.fillStyle = ESCURO;
      g.beginPath();
      g.arc(x, OY, 7, 0, Math.PI * 2);
      g.fill();
      return;
  }
  // normal / meio: íris colorida, pupila e brilho
  g.fillStyle = iris;
  g.beginPath();
  g.ellipse(x, OY, 12, 17, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = ESCURO;
  g.beginPath();
  g.ellipse(x, OY + 1, 6.5, 10, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(x + 4, OY - 6, 4, 0, Math.PI * 2);
  g.fill();
  if (tipo === "meio") {
    // Pálpebra baixada: olhar de quem está no controle.
    g.fillStyle = "rgba(0,0,0,0)";
    g.strokeStyle = ESCURO;
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(x - 15, OY - 4);
    g.lineTo(x + 15, OY - 4);
    g.stroke();
  }
}

function sobrancelha(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  inclinacao: number,
  cor: string,
) {
  g.strokeStyle = cor;
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(x - 22, y + inclinacao * 40);
  g.lineTo(x + 22, y - inclinacao * 40);
  g.stroke();
}

// Partial (16/10/2026): os rostos do lote 2 (rosto-extras.ts) e os glam desenham o próprio olho.
const OLHOS: Partial<Record<AvatarConfig["expressao"], [TipoDeOlho, TipoDeOlho]>> = {
  sorriso: ["normal", "normal"],
  sorrisao: ["normal", "normal"],
  serio: ["normal", "normal"],
  piscadinha: ["normal", "piscando"],
  surpreso: ["arregalado", "arregalado"],
  bravo: ["normal", "normal"],
  apaixonado: ["coracao", "coracao"],
  estrelado: ["estrela", "estrela"],
  timido: ["feliz", "feliz"],
  descolado: ["meio", "normal"],
  sono: ["fechado", "fechado"],
  gargalhada: ["feliz", "feliz"],
  lingua: ["normal", "piscando"],
  confiante: ["meio", "meio"],
  fofo: ["feliz", "feliz"],
  // Os glam (16/10/2026) têm olho próprio em rosto-glam.ts; aqui só fecham o tipo.
  glamSorriso: ["normal", "normal"],
  glamBeicinho: ["normal", "normal"],
  glamPiscadinha: ["normal", "piscando"],
  glamSerena: ["fechado", "fechado"],
};

/** Inclinação das sobrancelhas [esquerda, direita] e altura. */
const SOBRANCELHAS: Partial<Record<AvatarConfig["expressao"], [number, number, number]>> = {
  serio: [0.12, -0.12, 70],
  bravo: [0.3, -0.3, 74],
  surpreso: [-0.05, 0.05, 52],
  timido: [-0.2, 0.2, 64],
  descolado: [-0.05, 0.25, 66],
  sono: [0.05, -0.05, 76],
};

function boca(g: CanvasRenderingContext2D, e: AvatarConfig["expressao"], labio: string | null) {
  g.strokeStyle = labio ?? ESCURO;
  g.fillStyle = ESCURO;
  g.lineWidth = labio ? 10 : 8;
  const dentes = (x: number, y: number, w: number) => {
    g.fillStyle = "#ffffff";
    g.fillRect(x, y, w, 12);
    g.fillStyle = ESCURO;
  };
  switch (e) {
    case "sorrisao":
    case "estrelado":
      g.beginPath();
      g.moveTo(84, 156);
      g.quadraticCurveTo(128, 222, 172, 156);
      g.closePath();
      g.fill();
      dentes(96, 158, 64);
      return;
    case "gargalhada":
      g.beginPath();
      g.moveTo(80, 150);
      g.quadraticCurveTo(128, 236, 176, 150);
      g.closePath();
      g.fill();
      dentes(94, 152, 68);
      g.fillStyle = "#ef4444";
      g.beginPath();
      g.ellipse(128, 194, 20, 10, 0, 0, Math.PI * 2);
      g.fill();
      return;
    case "fofo":
      // Boca aberta em "D" com a linguinha, como os rostos fofos do Roblox.
      g.beginPath();
      g.moveTo(98, 160);
      g.lineTo(158, 160);
      g.quadraticCurveTo(158, 204, 128, 204);
      g.quadraticCurveTo(98, 204, 98, 160);
      g.fill();
      g.fillStyle = "#f472b6";
      g.beginPath();
      g.ellipse(128, 194, 18, 9, 0, 0, Math.PI * 2);
      g.fill();
      return;
    case "serio":
      g.beginPath();
      g.moveTo(104, 172);
      g.lineTo(152, 172);
      g.stroke();
      return;
    case "bravo":
      g.beginPath();
      g.arc(128, 196, 28, Math.PI * 1.2, Math.PI * 1.8);
      g.stroke();
      return;
    case "surpreso":
      g.beginPath();
      g.ellipse(128, 176, 14, 18, 0, 0, Math.PI * 2);
      g.fill();
      return;
    case "sono":
      g.beginPath();
      g.ellipse(128, 176, 9, 7, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#64748b";
      g.font = "bold 34px sans-serif";
      g.fillText("z", 196, 64);
      g.font = "bold 24px sans-serif";
      g.fillText("z", 222, 40);
      return;
    case "piscadinha":
    case "descolado":
      g.beginPath();
      g.moveTo(98, 166);
      g.quadraticCurveTo(140, 196, 166, 156);
      g.stroke();
      return;
    case "confiante":
      g.beginPath();
      g.moveTo(96, 162);
      g.quadraticCurveTo(128, 196, 166, 160);
      g.closePath();
      g.fill();
      dentes(110, 163, 46);
      return;
    case "timido":
      g.beginPath();
      g.arc(128, 162, 16, Math.PI * 0.2, Math.PI * 0.8);
      g.stroke();
      return;
    case "lingua":
      g.beginPath();
      g.arc(128, 148, 32, Math.PI * 0.2, Math.PI * 0.8);
      g.stroke();
      g.fillStyle = "#f472b6";
      g.beginPath();
      g.ellipse(138, 186, 13, 17, 0.2, 0, Math.PI * 2);
      g.fill();
      return;
    default:
      g.beginPath();
      g.arc(128, 150, 32, Math.PI * 0.2, Math.PI * 0.8);
      g.stroke();
  }
}

/**
 * A barba fica em volta da boca, nunca em cima: a massa da barba é desenhada,
 * o contorno da boca é recortado (pele aparece) e a boca vem por último.
 */
function barba(g: CanvasRenderingContext2D, tipo: AvatarConfig["barba"], cor: string) {
  if (tipo === "nenhuma") return;
  // Barbas do lote 2 (16/10/2026): rosto-extras.ts.
  if (ehBarbaExtra(tipo)) return desenharBarbaExtra(g, tipo, cor);
  g.fillStyle = cor;
  const bigode = () => {
    g.beginPath();
    g.moveTo(128, 134);
    g.quadraticCurveTo(102, 124, 88, 146);
    g.quadraticCurveTo(108, 141, 128, 147);
    g.quadraticCurveTo(148, 141, 168, 146);
    g.quadraticCurveTo(154, 124, 128, 134);
    g.fill();
  };
  const bigodao = () => {
    g.beginPath();
    g.moveTo(128, 132);
    g.quadraticCurveTo(98, 118, 76, 138);
    g.quadraticCurveTo(64, 148, 60, 130);
    g.quadraticCurveTo(56, 156, 84, 150);
    g.quadraticCurveTo(108, 144, 128, 148);
    g.quadraticCurveTo(148, 144, 172, 150);
    g.quadraticCurveTo(200, 156, 196, 130);
    g.quadraticCurveTo(192, 148, 180, 138);
    g.quadraticCurveTo(158, 118, 128, 132);
    g.fill();
  };
  const cavanhaque = () => {
    g.beginPath();
    g.moveTo(100, 212);
    g.quadraticCurveTo(128, 202, 156, 212);
    g.quadraticCurveTo(154, 248, 128, 250);
    g.quadraticCurveTo(102, 248, 100, 212);
    g.fill();
  };
  /** A massa da barba no queixo e nas bochechas, com o vão da boca recortado. */
  const mandibula = (opac: number, alto: number) => {
    g.save();
    g.fillStyle = opac < 1 ? alfa(cor, opac) : cor;
    g.beginPath();
    g.moveTo(22, alto);
    g.lineTo(40, alto);
    g.quadraticCurveTo(46, 140, 86, 146);
    g.lineTo(170, 146);
    g.quadraticCurveTo(210, 140, 216, alto);
    g.lineTo(234, alto);
    g.lineTo(234, 176);
    g.quadraticCurveTo(230, 250, 128, 254);
    g.quadraticCurveTo(26, 250, 22, 176);
    g.closePath();
    g.fill();
    // O vão da boca: a pele volta a aparecer em volta dela.
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.ellipse(128, 176, 54, 29, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  switch (tipo) {
    case "rala":
      mandibula(0.32, 96);
      return;
    case "bigode":
      bigode();
      return;
    case "bigodao":
      bigodao();
      return;
    case "cavanhaque":
      cavanhaque();
      return;
    case "barbicha":
      cavanhaque();
      bigode();
      g.strokeStyle = cor;
      g.lineWidth = 9;
      [-1, 1].forEach((l) => {
        g.beginPath();
        g.moveTo(128 + 38 * l, 144);
        g.quadraticCurveTo(128 + 60 * l, 190, 128 + 26 * l, 212);
        g.stroke();
      });
      return;
    case "cheia":
      mandibula(1, 96);
      bigode();
      return;
    case "lenhador":
      mandibula(1, 84);
      bigodao();
      return;
    case "costeleta":
      [-1, 1].forEach((l) => {
        const x = l < 0 ? 22 : 234;
        g.beginPath();
        g.moveTo(x, 72);
        g.lineTo(x - 22 * l, 72);
        g.quadraticCurveTo(x - 26 * l, 130, x - 14 * l, 168);
        g.quadraticCurveTo(x - 4 * l, 160, x, 150);
        g.closePath();
        g.fill();
      });
  }
}

function oculos(g: CanvasRenderingContext2D, tipo: AvatarConfig["oculos"]) {
  if (tipo === "nenhum") return;
  // Óculos do lote 2 (16/10/2026): rosto-extras.ts.
  if (ehOculosExtra(tipo)) return desenharOculosExtra(g, tipo);
  const aviador = tipo === "aviador";
  g.strokeStyle = aviador ? "#b7791f" : "#111";
  g.lineWidth = aviador ? 5 : 7;
  const lente = (x: number) => {
    g.beginPath();
    if (tipo === "redondo") g.arc(x, OY, 30, 0, Math.PI * 2);
    else if (aviador) {
      g.moveTo(x - 34, OY - 22);
      g.lineTo(x + 34, OY - 22);
      g.quadraticCurveTo(x + 38, OY + 34, x, OY + 30);
      g.quadraticCurveTo(x - 38, OY + 34, x - 34, OY - 22);
    } else g.roundRect(x - 36, OY - 24, 72, 48, 10);
    if (tipo === "escuro" || aviador) {
      g.fillStyle = aviador ? "rgba(30,41,59,0.85)" : "rgba(15,23,42,0.92)";
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.4)";
      g.fillRect(x - 22, OY - 14, 14, 5);
    }
    g.stroke();
  };
  lente(OE);
  lente(OD);
  g.beginPath();
  g.moveTo(OE + 30, OY - 2);
  g.lineTo(OD - 30, OY - 2);
  g.stroke();
}

function detalhes(
  g: CanvasRenderingContext2D,
  d: AvatarConfig["detalhe"],
  timido: boolean,
  pele: string,
) {
  // Adesivos do lote 2 (16/10/2026): rosto-extras.ts.
  desenharDetalheExtra(g, d, pele);
  if (d === "bochechas" || timido) {
    g.fillStyle = timido ? "rgba(244,63,94,0.45)" : "rgba(244,114,182,0.35)";
    [54, 202].forEach((x) => {
      g.beginPath();
      g.ellipse(x, 150, 22, 13, 0, 0, Math.PI * 2);
      g.fill();
    });
  }
  if (d === "sardas") {
    g.fillStyle = "rgba(146,64,14,0.55)";
    [
      [60, 140],
      [72, 150],
      [56, 156],
      [80, 140],
      [196, 140],
      [184, 150],
      [200, 156],
      [176, 140],
    ].forEach(([x, y]) => {
      g.beginPath();
      g.arc(x!, y!, 3.5, 0, Math.PI * 2);
      g.fill();
    });
  }
  if (d === "pinta") {
    g.fillStyle = "#3f2a1d";
    g.beginPath();
    g.arc(170, 170, 5, 0, Math.PI * 2);
    g.fill();
  }
}

function cilios(g: CanvasRenderingContext2D) {
  g.strokeStyle = ESCURO;
  g.lineWidth = 4;
  [OE, OD].forEach((x, i) => {
    const lado = i === 0 ? -1 : 1;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.moveTo(x + lado * (6 + k * 5), OY - 15 + k * 2);
      g.lineTo(x + lado * (14 + k * 7), OY - 26 + k * 4);
      g.stroke();
    }
  });
}

/* ————————————————— Rostos de reação (17/10/2026) ————————————————— */

/**
 * Rostos que só existem durante uma reação do avatar (`reacao-de-avatar.tsx`):
 * por cima da expressão salva, sem mexer nela. Não são opções do provador —
 * por isso ficam fora de `OPCOES.expressao`.
 */
export type RostoDeReacao =
  | "beijo"
  | "furioso"
  | "festa"
  // As nove reações novas do chat (17/10/2026):
  | "carinho"
  | "grato"
  | "piscada"
  | "desconfiado"
  | "gargalhada"
  | "determinado"
  | "sono"
  | "tranquilo"
  | "estrela"
  // A ofensiva do Início (19/10/2026): perdeu a sequência / o pack está em risco.
  | "triste"
  | "preocupado";

function rostoDeReacao(
  g: CanvasRenderingContext2D,
  r: RostoDeReacao,
  c: AvatarConfig,
  pelo: string,
) {
  if (rostoNovoDeReacao(g, r, c, pelo)) return;
  if (r === "festa") {
    // Comemorando: olhos fechados de alegria (^ ^), sobrancelhas lá em cima,
    // bochecha corada e a boca aberta num sorrisão com a língua.
    sobrancelha(g, OE, 56, -0.1, pelo);
    sobrancelha(g, OD, 56, 0.1, pelo);
    g.strokeStyle = ESCURO;
    g.lineWidth = 8;
    g.lineCap = "round";
    for (const x of [OE, OD]) {
      g.beginPath();
      g.moveTo(x - 17, OY + 8);
      g.quadraticCurveTo(x, OY - 16, x + 17, OY + 8);
      g.stroke();
    }
    g.fillStyle = "rgba(244,63,94,0.3)";
    for (const x of [56, 200]) {
      g.beginPath();
      g.ellipse(x, 146, 20, 12, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#4a1414";
    g.beginPath();
    g.moveTo(90, 154);
    g.quadraticCurveTo(128, 162, 166, 154);
    g.quadraticCurveTo(160, 212, 128, 212);
    g.quadraticCurveTo(96, 212, 90, 154);
    g.closePath();
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(94, 157);
    g.quadraticCurveTo(128, 164, 162, 157);
    g.lineTo(160, 168);
    g.quadraticCurveTo(128, 174, 96, 168);
    g.closePath();
    g.fill();
    g.fillStyle = "#f472b6";
    g.beginPath();
    g.ellipse(128, 200, 18, 10, 0, 0, Math.PI * 2);
    g.fill();
    return;
  }
  if (r === "beijo") {
    // Sobrancelhas soltas, olhos de coração, bochecha corada e biquinho.
    sobrancelha(g, OE, 60, -0.14, pelo);
    sobrancelha(g, OD, 60, 0.14, pelo);
    for (const x of [OE, OD]) {
      coracao(g, x, OY, 22, "#e11d48");
      g.fillStyle = "rgba(255,255,255,0.75)";
      g.beginPath();
      g.ellipse(x - 9, OY - 9, 5, 3.5, -0.6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "rgba(244,63,94,0.32)";
    for (const x of [58, 198]) {
      g.beginPath();
      g.ellipse(x, 150, 20, 12, 0, 0, Math.PI * 2);
      g.fill();
    }
    // O biquinho: dois gomos (lábio de cima e de baixo) com o vinco no meio.
    g.fillStyle = "#d61f4f";
    g.beginPath();
    g.ellipse(128, 171, 15, 10, 0, 0, Math.PI * 2);
    g.ellipse(128, 186, 14, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#7f1d1d";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(117, 179);
    g.quadraticCurveTo(128, 175, 139, 179);
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.beginPath();
    g.ellipse(122, 167, 4.5, 2.5, -0.3, 0, Math.PI * 2);
    g.fill();
    coracao(g, 168, 158, 9, "#f43f5e");
    coracao(g, 186, 138, 6, "#fb7185");
    return;
  }

  // Furioso: sobrancelha grossa em "V", olho apertado, dente cerrado e a veia.
  g.strokeStyle = pelo;
  g.lineWidth = 13;
  for (const [x, l] of [
    [OE, 1],
    [OD, -1],
  ] as const) {
    g.beginPath();
    g.moveTo(x - 26 * l, OY - 42);
    g.lineTo(x + 20 * l, OY - 20);
    g.stroke();
  }
  for (const [x, l] of [
    [OE, 1],
    [OD, -1],
  ] as const) {
    // A pálpebra desce para o meio do rosto: só o que está abaixo dela aparece.
    const alto = (dx: number) => OY - 6 + dx * 0.32 * l;
    g.save();
    g.beginPath();
    g.moveTo(x - 20, alto(-20));
    g.lineTo(x + 20, alto(20));
    g.lineTo(x + 20, OY + 30);
    g.lineTo(x - 20, OY + 30);
    g.closePath();
    g.clip();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.ellipse(x, OY + 2, 15, 15, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.olhos;
    g.beginPath();
    g.ellipse(x + 3 * l, OY + 5, 9, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = ESCURO;
    g.beginPath();
    g.ellipse(x + 3 * l, OY + 6, 4.5, 6, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.strokeStyle = ESCURO;
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(x - 19, alto(-19));
    g.lineTo(x + 19, alto(19));
    g.stroke();
  }
  g.fillStyle = "rgba(239,68,68,0.28)";
  for (const x of [56, 200]) {
    g.beginPath();
    g.ellipse(x, 148, 22, 13, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Dentes cerrados, numa boca torta para baixo.
  g.fillStyle = "#ffffff";
  g.strokeStyle = ESCURO;
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(94, 192);
  g.quadraticCurveTo(128, 158, 162, 192);
  g.quadraticCurveTo(128, 182, 94, 192);
  g.closePath();
  g.fill();
  g.stroke();
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(102, 184);
  g.quadraticCurveTo(128, 168, 154, 184);
  for (const x of [114, 128, 142]) {
    g.moveTo(x, 172 + Math.abs(x - 128) * 0.35);
    g.lineTo(x, 188 - Math.abs(x - 128) * 0.15);
  }
  g.stroke();
  // A veia de raiva (💢) na testa, do lado de quem olha à direita.
  g.strokeStyle = "#dc2626";
  g.lineWidth = 6;
  const vx = 206;
  const vy = 40;
  // Quatro arcos, um por quadrante, com a barriga virada para o centro.
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const meio = Math.atan2(-sy, -sx);
    g.beginPath();
    g.arc(vx + sx * 15, vy + sy * 15, 11, meio - 1.1, meio + 1.1);
    g.stroke();
  }
}

/* ——— Os rostos das reações novas (17/10/2026) ——— */

/** Bochechas coradas. */
function corar(g: CanvasRenderingContext2D, forca = 0.3) {
  g.fillStyle = `rgba(244,63,94,${forca})`;
  for (const x of [56, 200]) {
    g.beginPath();
    g.ellipse(x, 148, 20, 12, 0, 0, Math.PI * 2);
    g.fill();
  }
}

/** Sorriso de boca fechada: um arco de `l` de largura, `fundo` de curva. */
function sorrisoFechado(g: CanvasRenderingContext2D, l: number, fundo: number, y = 168) {
  g.strokeStyle = ESCURO;
  g.lineWidth = 7;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(128 - l / 2, y);
  g.quadraticCurveTo(128, y + fundo, 128 + l / 2, y);
  g.stroke();
}

/** Boca aberta num "D" (de alegria), com ou sem a língua. */
function bocaAbertaD(
  g: CanvasRenderingContext2D,
  l: number,
  fundo: number,
  lingua: boolean,
  y = 156,
) {
  g.fillStyle = "#4a1414";
  g.beginPath();
  g.moveTo(128 - l / 2, y);
  g.quadraticCurveTo(128, y + 8, 128 + l / 2, y);
  g.quadraticCurveTo(128 + l / 2 - 6, y + fundo, 128, y + fundo);
  g.quadraticCurveTo(128 - l / 2 + 6, y + fundo, 128 - l / 2, y);
  g.closePath();
  g.fill();
  // Os dentes de cima.
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.moveTo(128 - l / 2 + 4, y + 3);
  g.quadraticCurveTo(128, y + 10, 128 + l / 2 - 4, y + 3);
  g.lineTo(128 + l / 2 - 6, y + 13);
  g.quadraticCurveTo(128, y + 19, 128 - l / 2 + 6, y + 13);
  g.closePath();
  g.fill();
  if (lingua) {
    g.fillStyle = "#f472b6";
    g.beginPath();
    g.ellipse(128, y + fundo - 10, l * 0.24, 9, 0, 0, Math.PI * 2);
    g.fill();
  }
}

/** Olho fechado tranquilo: um "∪" (pálpebra de quem agradece ou cochila). */
function olhoFechadoCalmo(g: CanvasRenderingContext2D, x: number, y = OY) {
  g.strokeStyle = ESCURO;
  g.lineWidth = 7;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x - 16, y);
  g.quadraticCurveTo(x, y + 12, x + 16, y);
  g.stroke();
}

/**
 * Os rostos das reações novas. Devolve `false` se `r` não é um deles (aí
 * `rostoDeReacao` desenha os de antes: beijo, furioso, festa).
 */
function rostoNovoDeReacao(
  g: CanvasRenderingContext2D,
  r: RostoDeReacao,
  c: AvatarConfig,
  pelo: string,
): boolean {
  switch (r) {
    case "carinho": // abraço: olhinhos fechados de alegria, corado, sorriso e um coração
      sobrancelha(g, OE, 60, -0.12, pelo);
      sobrancelha(g, OD, 60, 0.12, pelo);
      olho(g, OE, "feliz", c.olhos);
      olho(g, OD, "feliz", c.olhos);
      corar(g, 0.4);
      sorrisoFechado(g, 44, 18);
      coracao(g, 204, 122, 9, "#f43f5e");
      return true;
    case "grato": // obrigado: olhos fechados em paz, sobrancelha mansa, sorriso pequeno
      sobrancelha(g, OE, 66, 0.08, pelo);
      sobrancelha(g, OD, 66, -0.08, pelo);
      olhoFechadoCalmo(g, OE);
      olhoFechadoCalmo(g, OD);
      corar(g, 0.22);
      sorrisoFechado(g, 36, 12);
      return true;
    case "piscada": // joinha: piscadinha e sorrisão
      sobrancelha(g, OE, 62, -0.14, pelo);
      sobrancelha(g, OD, 72, 0.02, pelo);
      olho(g, OE, "normal", c.olhos);
      olho(g, OD, "feliz", c.olhos);
      bocaAbertaD(g, 60, 34, false);
      return true;
    case "desconfiado": {
      // tô de olho: pálpebras baixas, olhar de lado, uma sobrancelha em pé, boca torta
      sobrancelha(g, OE, 74, -0.02, pelo);
      sobrancelha(g, OD, 56, 0.22, pelo);
      for (const x of [OE, OD]) {
        g.fillStyle = "#ffffff";
        g.beginPath();
        g.ellipse(x, OY + 2, 16, 14, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = c.olhos;
        g.beginPath();
        g.ellipse(x + 7, OY + 4, 9, 11, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = ESCURO;
        g.beginPath();
        g.ellipse(x + 8, OY + 5, 4.5, 6, 0, 0, Math.PI * 2);
        g.fill();
        // a pálpebra de cima, na cor da pele, cobrindo metade do olho
        g.fillStyle = c.pele;
        g.fillRect(x - 20, OY - 18, 40, 17);
        g.strokeStyle = ESCURO;
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(x - 18, OY - 1);
        g.lineTo(x + 18, OY - 1);
        g.stroke();
      }
      g.strokeStyle = ESCURO;
      g.lineWidth = 7;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(108, 176);
      g.quadraticCurveTo(132, 172, 152, 166);
      g.stroke();
      return true;
    }
    case "gargalhada": {
      // rindo muito: olhos espremidos > <, lágrimas de rir e a boca escancarada
      sobrancelha(g, OE, 56, -0.16, pelo);
      sobrancelha(g, OD, 56, 0.16, pelo);
      g.strokeStyle = ESCURO;
      g.lineWidth = 8;
      g.lineCap = "round";
      for (const [x, l] of [
        [OE, 1],
        [OD, -1],
      ] as const) {
        g.beginPath();
        g.moveTo(x - 14 * l, OY - 12);
        g.lineTo(x + 12 * l, OY);
        g.lineTo(x - 14 * l, OY + 12);
        g.stroke();
        // a lágrima, no canto de fora
        g.fillStyle = "#7dd3fc";
        g.beginPath();
        g.moveTo(x - 24 * l, OY + 8);
        g.quadraticCurveTo(x - 32 * l, OY + 24, x - 24 * l, OY + 28);
        g.quadraticCurveTo(x - 16 * l, OY + 24, x - 24 * l, OY + 8);
        g.fill();
      }
      corar(g, 0.32);
      bocaAbertaD(g, 74, 52, true, 152);
      return true;
    }
    case "determinado": {
      // bora: sobrancelhas firmes para baixo, olhar decidido e o sorriso de dentes
      g.strokeStyle = pelo;
      g.lineWidth = 11;
      g.lineCap = "round";
      for (const [x, l] of [
        [OE, 1],
        [OD, -1],
      ] as const) {
        g.beginPath();
        g.moveTo(x - 24 * l, OY - 40);
        g.lineTo(x + 18 * l, OY - 28);
        g.stroke();
      }
      olho(g, OE, "normal", c.olhos);
      olho(g, OD, "normal", c.olhos);
      g.fillStyle = "#ffffff";
      g.strokeStyle = ESCURO;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(96, 164);
      g.quadraticCurveTo(128, 170, 160, 164);
      g.quadraticCurveTo(156, 190, 128, 190);
      g.quadraticCurveTo(100, 190, 96, 164);
      g.closePath();
      g.fill();
      g.stroke();
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(99, 176);
      g.quadraticCurveTo(128, 182, 157, 176);
      g.stroke();
      return true;
    }
    case "sono": {
      // olhos pesados fechando, olheira e o bocejo em "O"
      sobrancelha(g, OE, 74, 0.1, pelo);
      sobrancelha(g, OD, 74, -0.1, pelo);
      g.strokeStyle = ESCURO;
      g.lineWidth = 7;
      g.lineCap = "round";
      for (const x of [OE, OD]) {
        g.beginPath();
        g.moveTo(x - 17, OY + 2);
        g.quadraticCurveTo(x, OY + 8, x + 17, OY + 2);
        g.stroke();
        g.strokeStyle = "rgba(100,116,139,0.45)";
        g.lineWidth = 4;
        g.beginPath();
        g.arc(x, OY + 8, 14, Math.PI * 0.2, Math.PI * 0.8);
        g.stroke();
        g.strokeStyle = ESCURO;
        g.lineWidth = 7;
      }
      g.fillStyle = "#4a1414";
      g.beginPath();
      g.ellipse(128, 182, 13, 18, 0, 0, Math.PI * 2);
      g.fill();
      return true;
    }
    case "tranquilo": // café: olhos meio fechados de prazer, sorriso de canto
      sobrancelha(g, OE, 66, -0.06, pelo);
      sobrancelha(g, OD, 66, 0.06, pelo);
      for (const x of [OE, OD]) {
        olho(g, x, "normal", c.olhos);
        g.fillStyle = c.pele;
        g.fillRect(x - 20, OY - 22, 40, 20);
        g.strokeStyle = ESCURO;
        g.lineWidth = 7;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(x - 16, OY - 2);
        g.quadraticCurveTo(x, OY + 3, x + 16, OY - 2);
        g.stroke();
      }
      corar(g, 0.2);
      sorrisoFechado(g, 40, 14);
      return true;
    case "estrela": // você é top: olhos de estrela, sorrisão e brilho
      sobrancelha(g, OE, 58, -0.14, pelo);
      sobrancelha(g, OD, 58, 0.14, pelo);
      olho(g, OE, "estrela", c.olhos);
      olho(g, OD, "estrela", c.olhos);
      corar(g, 0.25);
      bocaAbertaD(g, 66, 40, true);
      estrela(g, 214, 70, 10, "#fde047");
      return true;
    case "triste": {
      // perdeu a ofensiva: sobrancelhas caídas para fora, olhos marejados, boca para baixo
      sobrancelha(g, OE, 66, 0.2, pelo);
      sobrancelha(g, OD, 66, -0.2, pelo);
      olho(g, OE, "normal", c.olhos);
      olho(g, OD, "normal", c.olhos);
      g.fillStyle = "rgba(125,211,252,0.85)";
      for (const x of [OE, OD]) {
        g.beginPath();
        g.moveTo(x + 10, OY + 16);
        g.quadraticCurveTo(x + 4, OY + 34, x + 10, OY + 38);
        g.quadraticCurveTo(x + 16, OY + 34, x + 10, OY + 16);
        g.fill();
      }
      g.strokeStyle = ESCURO;
      g.lineWidth = 7;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(104, 186);
      g.quadraticCurveTo(128, 166, 152, 186);
      g.stroke();
      return true;
    }
    case "preocupado": {
      // o pack de hoje ainda aberto no fim da tarde: sobrancelha franzida, boca torta
      sobrancelha(g, OE, 62, 0.16, pelo);
      sobrancelha(g, OD, 62, -0.16, pelo);
      olho(g, OE, "normal", c.olhos);
      olho(g, OD, "normal", c.olhos);
      // a gota de suor na testa
      g.fillStyle = "rgba(125,211,252,0.9)";
      g.beginPath();
      g.moveTo(206, 46);
      g.quadraticCurveTo(196, 66, 206, 72);
      g.quadraticCurveTo(216, 66, 206, 46);
      g.fill();
      g.strokeStyle = ESCURO;
      g.lineWidth = 6;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(106, 178);
      g.quadraticCurveTo(116, 170, 128, 178);
      g.quadraticCurveTo(140, 186, 150, 176);
      g.stroke();
      return true;
    }
    default:
      return false;
  }
}

/**
 * O adesivo do rosto. `bocaAberta` é o quadro do "falando". `reacao`
 * (17/10/2026) troca olhos, sobrancelhas e boca por um rosto de reação; a
 * pele, a barba, os detalhes e os óculos continuam os da pessoa.
 */
export function desenharRosto(
  c: AvatarConfig,
  bocaAberta: boolean,
  reacao?: RostoDeReacao,
): CanvasTexture | null {
  const t = tela();
  if (!t) return null;
  const { g } = t;
  const pelo = escurecer(c.corCabelo, 0.15);
  const maquiagem = c.detalhe === "maquiagem";

  barba(g, c.barba, pelo);
  detalhes(g, c.detalhe, c.expressao === "timido" || c.expressao === "fofo", c.pele);

  if (reacao) {
    rostoDeReacao(g, reacao, c, pelo);
    oculos(g, c.oculos);
    return textura(t.c);
  }

  // Rosto glam (16/10/2026): já vem maquiado, com olho, boca e quadro de fala próprios.
  if (ehRostoGlam(c.expressao)) {
    desenharRostoGlam(g, c, bocaAberta, pelo);
    oculos(g, c.oculos);
    return textura(t.c);
  }

  // Expressões do lote 2 (16/10/2026): olho, sobrancelha, boca e quadro de fala próprios.
  if (ehExpressaoExtra(c.expressao)) {
    desenharExpressaoExtra(g, c, bocaAberta, pelo);
    oculos(g, c.oculos);
    return textura(t.c);
  }

  const [ie, id, alt] = SOBRANCELHAS[c.expressao] ?? [-0.08, 0.08, 70];
  sobrancelha(g, OE, alt, ie, pelo);
  sobrancelha(g, OD, alt, id, pelo);

  const [oe, od] = OLHOS[c.expressao] ?? ["normal", "normal"];
  olho(g, OE, oe, c.olhos);
  olho(g, OD, od, c.olhos);
  if (maquiagem && oe === "normal") cilios(g);

  if (bocaAberta) {
    g.fillStyle = ESCURO;
    g.beginPath();
    g.ellipse(128, 176, 26, 20, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#e57373";
    g.beginPath();
    g.ellipse(128, 186, 14, 8, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    boca(g, c.expressao, maquiagem ? "#be123c" : null);
  }

  oculos(g, c.oculos);
  return textura(t.c);
}

/* ————————————————— Tecidos ————————————————— */

export type Padrao = "xadrez" | "listrada" | "jeans" | "tricô";

export function desenharTecido(padrao: Padrao, cor: string): CanvasTexture | null {
  const t = tela();
  if (!t) return null;
  const { g } = t;
  g.fillStyle = cor;
  g.fillRect(0, 0, S, S);
  if (padrao === "xadrez") {
    g.fillStyle = alfa(escurecer(cor, 0.45), 0.55);
    for (let i = 0; i < S; i += 64) {
      g.fillRect(i, 0, 26, S);
      g.fillRect(0, i, S, 26);
    }
    g.fillStyle = alfa(clarear(cor, 0.7), 0.35);
    for (let i = 40; i < S; i += 64) {
      g.fillRect(i, 0, 5, S);
      g.fillRect(0, i, S, 5);
    }
  } else if (padrao === "listrada") {
    g.fillStyle = clarear(cor, 0.85);
    for (let i = 0; i < S; i += 40) g.fillRect(0, i, S, 18);
  } else if (padrao === "jeans") {
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = Math.random() > 0.5 ? alfa("#ffffff", 0.07) : alfa("#000000", 0.08);
      g.fillRect(Math.random() * S, Math.random() * S, 2, 6);
    }
    g.strokeStyle = alfa("#f4c27a", 0.75);
    g.setLineDash([6, 5]);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(30, 0);
    g.lineTo(30, S);
    g.moveTo(S - 30, 0);
    g.lineTo(S - 30, S);
    g.stroke();
    g.setLineDash([]);
  } else {
    // tricô: nervuras horizontais e a barra de baixo mais escura
    g.strokeStyle = alfa(escurecer(cor, 0.25), 0.6);
    g.lineWidth = 3;
    for (let y = 8; y < S; y += 14) {
      g.beginPath();
      for (let x = 0; x <= S; x += 14) {
        g.lineTo(x, y + (x % 28 === 0 ? 4 : 0));
      }
      g.stroke();
    }
  }
  return textura(t.c, true);
}

/** Cabelo liso puxado: fios finos e um brilho atravessado. */
export function desenharFios(cor: string): CanvasTexture | null {
  const t = tela();
  if (!t) return null;
  const { g } = t;
  g.fillStyle = cor;
  g.fillRect(0, 0, S, S);
  const brilho = g.createLinearGradient(0, 0, 0, S);
  brilho.addColorStop(0.2, alfa("#ffffff", 0));
  brilho.addColorStop(0.35, alfa("#ffffff", 0.22));
  brilho.addColorStop(0.5, alfa("#ffffff", 0));
  g.fillStyle = brilho;
  g.fillRect(0, 0, S, S);
  g.lineWidth = 3;
  for (let i = 0; i < 46; i++) {
    const x = (i * 5.57) % S;
    g.strokeStyle = i % 3 ? alfa(escurecer(cor, 0.4), 0.45) : alfa(clarear(cor, 0.3), 0.3);
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + 10, S * 0.33, x - 10, S * 0.66, x + 4, S);
    g.stroke();
  }
  return textura(t.c, true);
}

/* ————————————————— Estampas ————————————————— */

export function desenharEstampa(
  e: AvatarConfig["estampa"],
  corDaRoupa: string,
): CanvasTexture | null {
  if (e === "nenhuma") return null;
  const t = tela();
  if (!t) return null;
  const { g } = t;
  const contraste = isClara(corDaRoupa) ? "#1f2937" : "#ffffff";
  switch (e) {
    case "coracao":
      coracao(g, 128, 120, 70, "#e11d48");
      break;
    case "estrela":
      estrela(g, 128, 128, 100, "#facc15");
      break;
    case "raio":
      g.fillStyle = "#facc15";
      g.beginPath();
      [
        [150, 20],
        [70, 140],
        [122, 140],
        [100, 236],
        [190, 104],
        [136, 104],
        [168, 20],
      ].forEach(([x, y], i) => (i ? g.lineTo(x!, y!) : g.moveTo(x!, y!)));
      g.closePath();
      g.fill();
      break;
    case "smile":
      g.fillStyle = "#facc15";
      g.beginPath();
      g.arc(128, 128, 100, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = ESCURO;
      [96, 160].forEach((x) => {
        g.beginPath();
        g.ellipse(x, 104, 12, 20, 0, 0, Math.PI * 2);
        g.fill();
      });
      g.strokeStyle = ESCURO;
      g.lineWidth = 12;
      g.beginPath();
      g.arc(128, 128, 60, Math.PI * 0.2, Math.PI * 0.8);
      g.stroke();
      break;
    case "arvore":
      g.fillStyle = "#7c4a26";
      g.fillRect(114, 170, 28, 66);
      g.fillStyle = "#16a34a";
      [
        [128, 30, 80],
        [128, 80, 100],
        [128, 130, 120],
      ].forEach(([x, y, w]) => {
        g.beginPath();
        g.moveTo(x!, y!);
        g.lineTo(x! - w!, y! + 70);
        g.lineTo(x! + w!, y! + 70);
        g.closePath();
        g.fill();
      });
      break;
    case "dez":
      g.fillStyle = contraste;
      g.font = "bold 170px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("10", 128, 140);
      break;
  }
  return textura(t.c);
}

export function isClara(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return r * 0.299 + g * 0.587 + b * 0.114 > 160;
}
