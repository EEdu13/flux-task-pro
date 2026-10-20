import type { CtxFace } from "./molde";

/**
 * Pincéis da roupa. Tudo em METROS (o molde já escalou o canvas), com y
 * para baixo a partir do topo da face. O "pano" fino (ruído, sarja, tricô)
 * é um ladrilho em PIXELS, igual em qualquer densidade.
 *
 * Receita do visual Roblox (ordem por face): base → grão → padrão contínuo
 * → construção (ribana, bolso, costura, zíper, botão) → estampa → dobras →
 * `volume` por último. Na sala (`qualidade: "media"`) o grão e o pesponto
 * somem e toda linha tem pelo menos 2 px: de longe eles só viram chuvisco.
 */

/* ———————————— cores ———————————— */

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const paraHex = (r: number, g: number, b: number) =>
  `#${((1 << 24) | (lim(r) << 16) | (lim(g) << 8) | lim(b)).toString(16).slice(1)}`;
const lim = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export const escurecer = (hex: string, q: number) => {
  const [r, g, b] = rgb(hex);
  return paraHex(r * (1 - q), g * (1 - q), b * (1 - q));
};
export const clarear = (hex: string, q: number) => {
  const [r, g, b] = rgb(hex);
  return paraHex(r + (255 - r) * q, g + (255 - g) * q, b + (255 - b) * q);
};
export const misturar = (a: string, b: string, t: number) => {
  const A = rgb(a);
  const B = rgb(b);
  return paraHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
};
export const alfa = (hex: string, a: number) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
export const luminancia = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
};
/** Diferença de cor perceptível? (gravata branca em camisa branca não serve). */
export const contrasta = (a: string, b: string, minimo = 0.16) => {
  const A = rgb(a);
  const B = rgb(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) / 441 > minimo;
};
/** Luminância de #1c1c1f: o "preto de desenho" mais escuro permitido. */
export const LUMINANCIA_PISO = luminancia("#1c1c1f");
/**
 * Preto "de desenho": nunca abaixo de #1c1c1f. Preto puro some no sombreado
 * e o tecido vira um buraco sem desenho (regra do Roblox: sombra é cor).
 * Sobe a cor somando cinza até a luminância do piso — TRAVA (antes só
 * misturava 75% e #000 ficava em #151517) e mantém o matiz (marinho continua
 * azulado, marrom continua marrom).
 */
export const piso = (hex: string) => {
  const l = luminancia(hex);
  if (l >= LUMINANCIA_PISO) return hex;
  const k = (LUMINANCIA_PISO - l) * 255 + 0.5;
  const [r, g, b] = rgb(hex);
  return paraHex(r + k, g + k, b + k);
};
/**
 * Linha de costura que aparece em qualquer cor de tecido. Em tecido muito
 * escuro (marinho, preto) ela clareia mais: senão o pesponto some no corpo
 * inteiro e o moletom vira um bloco liso.
 */
export const corDaLinha = (tecido: string) => {
  const l = luminancia(tecido);
  if (l > 0.55) return escurecer(tecido, 0.35);
  return clarear(tecido, l < 0.16 ? 0.42 : 0.3);
};

/** Espessura mínima em metros para `n` pixels nesta face. */
export const pxs = (f: CtxFace, n: number) => n / f.px;
const media = (f: CtxFace) => f.qualidade === "media";

/* ———————————— ladrilhos de pano (em pixels) ———————————— */

let semente = 7;
const aleatorio = () => {
  semente = (semente * 16807) % 2147483647;
  return (semente - 1) / 2147483646;
};

const ladrilhos = new Map<string, HTMLCanvasElement>();
function ladrilho(nome: string, lado: number, desenhar: (g: CanvasRenderingContext2D) => void) {
  let t = ladrilhos.get(nome);
  if (!t) {
    t = document.createElement("canvas");
    t.width = t.height = lado;
    desenhar(t.getContext("2d")!);
    ladrilhos.set(nome, t);
  }
  return t;
}

/** Moletom/algodão: grão miúdo claro e escuro. */
const RUIDO = () =>
  ladrilho("ruido", 128, (g) => {
    semente = 11;
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = aleatorio() > 0.5 ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.08)";
      g.fillRect(
        Math.floor(aleatorio() * 128),
        Math.floor(aleatorio() * 128),
        1 + Math.round(aleatorio()),
        1,
      );
    }
  });

/** Sarja do jeans: diagonais 2/1 + fios irregulares (slub). */
const SARJA = () =>
  ladrilho("sarja", 96, (g) => {
    semente = 5;
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        const k = (x + y * 2) % 6;
        g.fillStyle =
          k < 2 ? "rgba(255,255,255,0.13)" : k < 4 ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.10)";
        g.fillRect(x, y, 1, 1);
      }
    }
    for (let i = 0; i < 70; i++) {
      g.fillStyle = aleatorio() > 0.4 ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)";
      g.fillRect(
        Math.floor(aleatorio() * 96),
        Math.floor(aleatorio() * 96),
        1,
        3 + Math.floor(aleatorio() * 8),
      );
    }
  });

/** Brim/sarja fina (calça social, cargo, uniforme): diagonal discreta. */
const BRIM = () =>
  ladrilho("brim", 64, (g) => {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const k = (x + y) % 4;
        g.fillStyle =
          k === 0 ? "rgba(255,255,255,0.07)" : k === 2 ? "rgba(0,0,0,0.07)" : "rgba(0,0,0,0)";
        g.fillRect(x, y, 1, 1);
      }
    }
  });

/** Couro: poros e marcas suaves. */
const COURO = () =>
  ladrilho("couro", 128, (g) => {
    semente = 23;
    for (let i = 0; i < 900; i++) {
      g.fillStyle = aleatorio() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.09)";
      const r = 0.6 + aleatorio() * 1.4;
      g.beginPath();
      g.arc(aleatorio() * 128, aleatorio() * 128, r, 0, Math.PI * 2);
      g.fill();
    }
  });

/** Tela de colete EPI: grade fina de furinhos. */
const TELA = () =>
  ladrilho("tela", 8, (g) => {
    g.fillStyle = "rgba(0,0,0,0.13)";
    g.fillRect(0, 0, 2, 2);
    g.fillRect(4, 4, 2, 2);
    g.fillStyle = "rgba(255,255,255,0.06)";
    g.fillRect(2, 2, 2, 2);
  });

export type Grao = "ruido" | "sarja" | "brim" | "couro" | "tela";
const GRAOS: Record<Grao, () => HTMLCanvasElement> = {
  ruido: RUIDO,
  sarja: SARJA,
  brim: BRIM,
  couro: COURO,
  tela: TELA,
};

/** Preenche a face com o ladrilho, 1 pixel do ladrilho = 1 pixel do atlas. Só na alta. */
export function pano(f: CtxFace, tipo: Grao, forca = 1) {
  if (media(f)) return;
  const { g } = f;
  const pad = g.createPattern(GRAOS[tipo](), "repeat")!;
  pad.setTransform(new DOMMatrix([1 / f.px, 0, 0, 1 / f.px, 0, 0]));
  g.save();
  g.globalAlpha = forca;
  g.fillStyle = pad;
  g.fillRect(-0.1, -0.1, f.w + 0.2, f.h + 0.2);
  g.restore();
}

/** Base lisa da face (com folga para a margem de sangria). */
export function base(f: CtxFace, cor: string) {
  f.g.fillStyle = cor;
  f.g.fillRect(-0.1, -0.1, f.w + 0.2, f.h + 0.2);
}

/* ———————————— volume e dobras ———————————— */

export type OpVolume = {
  luz?: number;
  sombra?: number;
  bordas?: number;
  /** Cor da sombra: branco sombreia em azul-acinzentado, não em cinza sujo. */
  cor?: string;
  /** Contorno escuro de 1–2 px na borda da face (o "traço" do desenho). */
  contorno?: number;
  /** Cor do tecido: escuro ganha mais luz pintada. */
  base?: string;
};

/** Sombreamento "pintado" do Roblox: luz em cima, sombra embaixo e nas bordas. */
export function volume(f: CtxFace, o: OpVolume = {}) {
  const { g, w, h } = f;
  // Tecido escuro precisa de MAIS luz pintada (senão vira um buraco preto)
  const luz = (o.luz ?? 0.1) * (o.base && luminancia(o.base) < 0.22 ? 1.9 : 1);
  const sombra = o.sombra ?? 0.16;
  const cs = o.cor ?? "#000000";
  const v = g.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0, `rgba(255,255,255,${luz})`);
  v.addColorStop(0.35, "rgba(255,255,255,0)");
  v.addColorStop(0.68, alfa(cs, 0));
  v.addColorStop(1, alfa(cs, sombra));
  g.fillStyle = v;
  g.fillRect(-0.1, -0.1, w + 0.2, h + 0.2);
  const b = o.bordas ?? 0.1;
  if (b > 0) {
    const lado = g.createLinearGradient(0, 0, w, 0);
    lado.addColorStop(0, alfa(cs, b));
    lado.addColorStop(0.16, alfa(cs, 0));
    lado.addColorStop(0.84, alfa(cs, 0));
    lado.addColorStop(1, alfa(cs, b));
    g.fillStyle = lado;
    g.fillRect(-0.1, -0.1, w + 0.2, h + 0.2);
  }
  const c = o.contorno ?? 0.22;
  if (c > 0) {
    const e = pxs(f, media(f) ? 2 : 1.5);
    g.strokeStyle = alfa(cs === "#000000" ? "#000000" : cs, c);
    g.lineWidth = e * 2;
    g.strokeRect(0, 0, w, h);
  }
}

/** Uma dobra macia: sombra larga e esfumada + fio de luz logo acima. */
export function dobra(
  f: CtxFace,
  p: [number, number, number, number, number, number],
  largura = 0.012,
  forca = 0.22,
  cor = "#000000",
) {
  const { g } = f;
  const [x0, y0, cx, cy, x1, y1] = p;
  const curva = (dy: number) => {
    g.beginPath();
    g.moveTo(x0, y0 + dy);
    g.quadraticCurveTo(cx, cy + dy, x1, y1 + dy);
    g.stroke();
  };
  g.save();
  g.lineCap = "round";
  for (let i = 4; i >= 1; i--) {
    g.strokeStyle = alfa(cor, forca / 4);
    g.lineWidth = Math.max(largura * i * 0.7, pxs(f, 2));
    curva(0);
  }
  g.strokeStyle = `rgba(255,255,255,${(forca * 0.45).toFixed(3)})`;
  g.lineWidth = Math.max(largura * 0.5, pxs(f, media(f) ? 2 : 1));
  curva(-largura * 1.1);
  g.restore();
}

/** Sombra de contato (oclusão) num retângulo: escurece do lado `de`. */
export function oclusao(
  f: CtxFace,
  x: number,
  y: number,
  w: number,
  h: number,
  de: "cima" | "baixo" | "esq" | "dir",
  forca = 0.35,
  cor = "#000000",
) {
  const { g } = f;
  const gr =
    de === "cima" || de === "baixo"
      ? g.createLinearGradient(0, de === "cima" ? y : y + h, 0, de === "cima" ? y + h : y)
      : g.createLinearGradient(de === "esq" ? x : x + w, 0, de === "esq" ? x + w : x, 0);
  gr.addColorStop(0, alfa(cor, forca));
  gr.addColorStop(1, alfa(cor, 0));
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
}

/**
 * Escurece a face inteira (boca do punho, base escondida). Com `base` (a cor
 * do tecido), o escurecido para no piso #1c1c1f: no moletom preto a boca do
 * punho continua "tecido na sombra", não um buraco.
 */
export function escurecerTudo(f: CtxFace, q: number, base?: string) {
  const l = base ? luminancia(base) : 1;
  const qq = base ? Math.max(0, Math.min(q, 1 - LUMINANCIA_PISO / Math.max(l, 1e-3))) : q;
  f.g.fillStyle = `rgba(0,0,0,${qq})`;
  f.g.fillRect(-0.1, -0.1, f.w + 0.2, f.h + 0.2);
}

/* ———————————— padrões contínuos (pela `faixa`) ———————————— */

/**
 * Tartan de 3 cores: base `cor`, faixas largas escuras e fios finos claros.
 * Desenhado em (x + faixa): continua igual ao virar a quina do bloco.
 */
export function xadrezContinuo(f: CtxFace, escura: string, clara: string, P = 0.09, fio = "") {
  const { g, w, h } = f;
  const x0 = -(f.faixa % P) - P * 3;
  for (let x = x0; x < w + 2 * P; x += P) {
    g.fillStyle = alfa(escura, 0.5);
    g.fillRect(x, -0.3, P * 0.42, h + 0.6);
    g.fillStyle = alfa(clara, 0.38);
    g.fillRect(x + P * 0.64, -0.3, Math.max(P * 0.07, pxs(f, 2)), h + 0.6);
    if (fio) {
      g.fillStyle = alfa(fio, 0.4);
      g.fillRect(x + P * 0.2, -0.3, pxs(f, 1.5), h + 0.6);
    }
  }
  for (let y = -2 * P; y < h + 2 * P; y += P) {
    g.fillStyle = alfa(escura, 0.5);
    g.fillRect(-0.3, y, w + 0.6, P * 0.42);
    g.fillStyle = alfa(clara, 0.38);
    g.fillRect(-0.3, y + P * 0.64, w + 0.6, Math.max(P * 0.07, pxs(f, 2)));
    if (fio) {
      g.fillStyle = alfa(fio, 0.4);
      g.fillRect(-0.3, y + P * 0.2, w + 0.6, pxs(f, 1.5));
    }
  }
}

/** Listras horizontais de período `P` (0,05 m): a mesma fase no tronco e nas mangas. */
export function listrasContinuas(f: CtxFace, cor: string, P = 0.05, fase = 0) {
  const { g, w, h } = f;
  g.fillStyle = cor;
  for (let y = fase - P; y < h + P; y += P) g.fillRect(-0.1, y, w + 0.2, P * 0.45);
}

/** Tricô: colunas de "V" (pontos de meia), contínuas na volta. */
export function trico(f: CtxFace, cor: string) {
  const { g, w, h } = f;
  const cx = media(f) ? 0.03 : 0.018;
  const cy = cx * 0.85;
  const x0 = -(f.faixa % cx) - cx * 2;
  g.save();
  g.lineWidth = Math.max(cx * 0.16, pxs(f, media(f) ? 2 : 1));
  for (let x = x0; x < w + cx; x += cx) {
    for (let y = -cy; y < h + cy; y += cy) {
      g.strokeStyle = alfa(escurecer(cor, 0.4), 0.45);
      g.beginPath();
      g.moveTo(x + cx * 0.08, y);
      g.lineTo(x + cx * 0.5, y + cy * 0.8);
      g.lineTo(x + cx * 0.92, y);
      g.stroke();
      g.strokeStyle = alfa(clarear(cor, 0.35), 0.25);
      g.beginPath();
      g.moveTo(x + cx * 0.08, y - cy * 0.18);
      g.lineTo(x + cx * 0.5, y + cy * 0.6);
      g.stroke();
    }
  }
  g.restore();
}

/**
 * Faixa refletiva (EPI): prata com microgrid em losango e borda cinza
 * escura — lê como refletivo, não como listra branca. Na máscara de brilho,
 * pinta só o retângulo de branco (o emissivo acende ali).
 */
export function refletivo(f: CtxFace, x: number, y: number, w: number, h: number) {
  const { g } = f;
  if (f.mascara) {
    g.fillStyle = "#ffffff";
    g.fillRect(x, y, w, h);
    return;
  }
  g.save();
  g.fillStyle = "rgba(0,0,0,0.3)";
  g.fillRect(x, y + h, w, Math.max(0.004, pxs(f, 2)));
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, "#eef1f4");
  gr.addColorStop(0.45, "#c3c8cf");
  gr.addColorStop(0.55, "#b4bac2");
  gr.addColorStop(1, "#dfe3e8");
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  // microgrid em losango: 2 px na alta (some na média, onde viraria chuvisco)
  if (!media(f)) {
    const p = pxs(f, 4);
    g.strokeStyle = "rgba(90,98,110,0.35)";
    g.lineWidth = pxs(f, 1);
    for (let k = x - h; k < x + w + h; k += p) {
      g.beginPath();
      g.moveTo(k, y);
      g.lineTo(k + h, y + h);
      g.moveTo(k + h, y);
      g.lineTo(k, y + h);
      g.stroke();
    }
  }
  // reflexo: um traço claro inclinado a cada tanto
  g.fillStyle = "rgba(255,255,255,0.55)";
  for (let k = x + 0.03; k < x + w; k += 0.11) {
    g.beginPath();
    g.moveTo(k, y);
    g.lineTo(k + 0.02, y);
    g.lineTo(k + 0.02 - h * 0.5, y + h);
    g.lineTo(k - h * 0.5, y + h);
    g.closePath();
    g.fill();
  }
  g.restore();
  g.strokeStyle = "#4b5563";
  g.lineWidth = Math.max(0.003, pxs(f, 2));
  g.strokeRect(x, y, w, h);
}

/* ———————————— costura e aviamentos ———————————— */

export type OpCostura = { duplo?: number; traco?: number; espessura?: number };

/**
 * Pesponto: linha tracejada com um vinco escuro por baixo (afunda no pano).
 * Na média vira só o vinco de 2 px: o tracejado de longe é chuvisco.
 */
export function costura(
  f: CtxFace,
  pts: readonly [number, number][],
  cor: string,
  o: OpCostura = {},
) {
  const { g } = f;
  const traco = o.traco ?? 0.009;
  const esp = Math.max(o.espessura ?? 0.0032, pxs(f, 1.2));
  const deslocar = (off: number) =>
    pts.map(([x, y], i) => {
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(pts.length - 1, i + 1)]!;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [x - ((b[1] - a[1]) / L) * off, y + ((b[0] - a[0]) / L) * off] as [number, number];
    });
  g.save();
  const desenhar = (linha: [number, number][], dy: number) => {
    g.beginPath();
    linha.forEach(([x, y], i) => (i ? g.lineTo(x, y + dy) : g.moveTo(x, y + dy)));
    g.stroke();
  };
  if (media(f)) {
    g.strokeStyle = "rgba(0,0,0,0.22)";
    g.lineWidth = pxs(f, 2);
    desenhar(deslocar(0), 0);
    g.restore();
    return;
  }
  for (const off of o.duplo ? [-o.duplo / 2, o.duplo / 2] : [0]) {
    const linha = deslocar(off);
    g.setLineDash([]);
    g.strokeStyle = "rgba(0,0,0,0.22)";
    g.lineWidth = esp * 1.6;
    desenhar(linha, esp * 0.4);
    g.setLineDash([traco, traco * 0.55]);
    g.strokeStyle = cor;
    g.lineWidth = esp;
    desenhar(linha, 0);
  }
  g.restore();
}

/** Emenda: o vinco escuro com o fio de luz ao lado (costura fechada, sem pesponto). */
export function emenda(f: CtxFace, pts: readonly [number, number][], forca = 0.3) {
  const { g } = f;
  g.save();
  g.strokeStyle = `rgba(0,0,0,${forca})`;
  g.lineWidth = Math.max(0.003, pxs(f, 2));
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.strokeStyle = `rgba(255,255,255,${forca * 0.4})`;
  g.lineWidth = Math.max(0.0015, pxs(f, 1));
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x + 0.003, y) : g.moveTo(x + 0.003, y)));
  g.stroke();
  g.restore();
}

/**
 * Ribana (barra/punho canelado): nervuras verticais + vinco na emenda.
 * Alta: nervura de 1,4 cm; média: 2,4 cm com linhas de 2 px (4–5 por punho).
 */
export function canelado(f: CtxFace, x: number, y: number, w: number, h: number, cor: string) {
  const { g } = f;
  g.save();
  g.fillStyle = escurecer(cor, 0.06);
  g.fillRect(x, y, w, h);
  const passo = media(f) ? 0.024 : 0.014;
  const x0 = Math.floor((x + f.faixa) / passo) * passo - f.faixa;
  for (let xx = x0; xx < x + w + passo; xx += passo) {
    g.fillStyle = "rgba(0,0,0,0.22)";
    g.fillRect(xx, y, Math.max(passo * 0.28, pxs(f, 2)), h);
    g.fillStyle = "rgba(255,255,255,0.10)";
    g.fillRect(xx + passo * 0.5, y, Math.max(passo * 0.22, pxs(f, 1)), h);
  }
  oclusao(f, x, y, w, h * 0.35, "cima", 0.28);
  g.fillStyle = "rgba(255,255,255,0.12)";
  g.fillRect(x, y + h - h * 0.12, w, h * 0.12);
  g.restore();
}

/** Zíper: fita, dentes alternados e o cursor no alto. */
export function ziper(
  f: CtxFace,
  x: number,
  y0: number,
  y1: number,
  corFita: string,
  metal = "#c7ccd3",
) {
  const { g } = f;
  const larg = 0.026;
  g.save();
  g.fillStyle = escurecer(corFita, 0.2);
  g.fillRect(x - larg / 2, y0, larg, y1 - y0);
  const dente = media(f) ? 0.012 : 0.0055;
  for (let y = y0 + 0.01, i = 0; y < y1 - 0.004; y += dente, i++) {
    const lado = i % 2 ? 1 : -1;
    g.fillStyle = escurecer(metal, 0.35);
    g.fillRect(x + (lado < 0 ? -0.0075 : -0.0005), y + 0.0006, 0.008, dente * 0.75);
    g.fillStyle = metal;
    g.fillRect(x + (lado < 0 ? -0.0075 : -0.0005), y, 0.008, dente * 0.6);
  }
  g.fillStyle = escurecer(metal, 0.25);
  g.beginPath();
  g.roundRect(x - 0.011, y0 + 0.012, 0.022, 0.03, 0.006);
  g.fill();
  g.fillStyle = metal;
  g.beginPath();
  g.roundRect(x - 0.006, y0 + 0.035, 0.012, 0.045, 0.005);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.fillRect(x - 0.004, y0 + 0.038, 0.003, 0.035);
  g.restore();
}

/** Botão: aro, quatro furos e um brilho. */
export function botao(f: CtxFace, x: number, y: number, r: number, cor: string) {
  const { g } = f;
  g.save();
  g.fillStyle = "rgba(0,0,0,0.28)";
  g.beginPath();
  g.arc(x + r * 0.15, y + r * 0.25, r * 1.05, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = cor;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = escurecer(cor, 0.3);
  g.lineWidth = r * 0.22;
  g.beginPath();
  g.arc(x, y, r * 0.72, 0, Math.PI * 2);
  g.stroke();
  if (!media(f)) {
    g.fillStyle = escurecer(cor, 0.55);
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      g.beginPath();
      g.arc(x + dx * r * 0.28, y + dy * r * 0.28, r * 0.14, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = "rgba(255,255,255,0.45)";
  g.beginPath();
  g.arc(x - r * 0.35, y - r * 0.4, r * 0.25, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Rebite de cobre (jeans). */
export function rebite(f: CtxFace, x: number, y: number, r = 0.0075) {
  const { g } = f;
  const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  gr.addColorStop(0, "#f6d39a");
  gr.addColorStop(0.6, "#b87333");
  gr.addColorStop(1, "#6b3d17");
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** Ilhós de metal (tênis, bota). */
export function ilhos(f: CtxFace, x: number, y: number, r: number, metal = "#a3a9b3") {
  const { g } = f;
  g.save();
  g.fillStyle = escurecer(metal, 0.45);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = metal;
  g.lineWidth = r * 0.45;
  g.beginPath();
  g.arc(x, y, r * 0.78, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

/**
 * Sombra projetada de uma forma (bolso, lapela): desloca e escurece.
 * O `beginPath` é obrigatório: o recorte da face (rect + clip no
 * `pintarMolde`) continua como caminho atual, e um `caminho()` feito só de
 * `g.rect` SOMAVA o retângulo da face inteira — o painel do EPI com o
 * bolsinho saía 30% mais escuro que o outro.
 */
export function sombraDe(f: CtxFace, caminho: () => void, dx = 0.003, dy = 0.006, forca = 0.3) {
  const { g } = f;
  g.save();
  g.translate(dx, dy);
  g.fillStyle = `rgba(0,0,0,${forca})`;
  g.beginPath();
  caminho();
  g.fill();
  g.restore();
}

/**
 * Sombra macia (sem borda dura) de um polígono: 4 passadas deslocadas e
 * crescentes de baixa opacidade. Funciona em qualquer navegador (o
 * `ctx.filter = "blur()"` não existe no Safari).
 */
export function sombraMacia(
  f: CtxFace,
  pts: readonly [number, number][],
  dx: number,
  dy: number,
  forca = 0.22,
  cor = "#000000",
) {
  const { g } = f;
  g.save();
  for (let i = 1; i <= 4; i++) {
    const k = i / 4;
    g.fillStyle = alfa(cor, forca / 4);
    g.beginPath();
    pts.forEach(([x, y], j) => {
      const px = x + dx * k;
      const py = y + dy * k;
      if (j) g.lineTo(px, py);
      else g.moveTo(px, py);
    });
    g.closePath();
    g.fill();
  }
  g.restore();
}

/* ———————————— geometria do desenho ———————————— */

export function poligono(g: CanvasRenderingContext2D, pts: readonly [number, number][]) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

/** Pontos de uma curva quadrática (para costurar curvas com o pesponto). */
export function curvaPts(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  n = 14,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    out.push([a * x0 + b * cx + c * x1, a * y0 + b * cy + c * y1]);
  }
  return out;
}
