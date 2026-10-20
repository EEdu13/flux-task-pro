import type { AvatarConfig } from "@/lib/avatar-3d";

/**
 * Lote 2 do rosto (16/10/2026: "crie pelo menos mais 10 de cada, bem criativo
 * e dinâmico, baseado em Roblox"): expressões clássicas do Roblox (Chill,
 * Super Super Happy, Beaming with Pride, Check It, Err…, Silly Fun, Smug,
 * Shiny Teeth…), adesivos de rosto, barbas e óculos novos.
 *
 * Tudo é desenhado no mesmo quadro 256×256 de `desenharRosto`
 * (`avatar-texturas.ts`): olhos em x 86/170, y 104; boca em torno de y 176.
 * Só usa o contexto 2D (o tipo de `avatar-3d` é apagado na compilação), então
 * dá para pré-visualizar fora do app. Traços grossos e cores fortes de
 * propósito: o rosto também aparece nas fotinhas pequenas do provador.
 */

type G = CanvasRenderingContext2D;

const OE = 86;
const OD = 170;
const OY = 104;
const ESCURO = "#1b1b1b";
const BRANCO = "#ffffff";
const LINGUA = "#f472b6";

/* ————————————————— cores ————————————————— */

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function misturar(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const rr = f(r1 + (r2 - r1) * t);
  const gg = f(g1 + (g2 - g1) * t);
  const bb = f(b1 + (b2 - b1) * t);
  return `#${((1 << 24) | (rr << 16) | (gg << 8) | bb).toString(16).slice(1)}`;
}
const escuro = (hex: string, t: number) => misturar(hex, "#000000", t);
const claro = (hex: string, t: number) => misturar(hex, "#ffffff", t);
function alfa(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
/** Luminância 0–255: decide contorno claro ou escuro sobre a pele. */
function luz(hex: string): number {
  const [r, g, b] = rgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114;
}

/** Sorteio com semente: as sardas e o pelo saem sempre iguais. */
function sorteio(semente: number): () => number {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ————————————————— formas ————————————————— */

function coracao(g: G, x: number, y: number, r: number) {
  g.beginPath();
  g.moveTo(x, y + r * 0.9);
  g.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.8, y - r * 1.4, x, y - r * 0.5);
  g.bezierCurveTo(x + r * 0.8, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r * 0.9);
  g.closePath();
}

function estrela(g: G, x: number, y: number, r: number, miolo = 0.45, giro = 0) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + giro + (i * Math.PI) / 5;
    const rr = i % 2 ? r * miolo : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}

/** Brilho de 4 pontas (✦). */
function brilho(g: G, x: number, y: number, r: number, cor: string) {
  g.fillStyle = cor;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.fill();
}

/** Gota de suor / lágrima, com a ponta para cima. */
function gota(g: G, x: number, y: number, s: number, cor = "#7dd3fc", borda = "#0284c7") {
  g.beginPath();
  g.moveTo(x, y - s * 1.9);
  g.bezierCurveTo(x + s * 0.3, y - s, x + s * 1.05, y - s * 0.35, x + s, y + s * 0.25);
  g.arc(x, y + s * 0.25, s, 0, Math.PI);
  g.bezierCurveTo(x - s * 1.05, y - s * 0.35, x - s * 0.3, y - s, x, y - s * 1.9);
  g.closePath();
  g.fillStyle = cor;
  g.fill();
  g.strokeStyle = borda;
  g.lineWidth = 2.5;
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.beginPath();
  g.ellipse(x - s * 0.35, y + s * 0.05, s * 0.22, s * 0.4, -0.4, 0, Math.PI * 2);
  g.fill();
}

/* ————————————————— expressões ————————————————— */

type Rosto = { iris: string; pelo: string; pele: string; aberta: boolean };

/** Sobrancelha reta (mesma regra de `avatar-texturas`): `incl` > 0 sobe a ponta de dentro da esquerda. */
function sob(g: G, x: number, y: number, incl: number, cor: string, w = 9) {
  g.strokeStyle = cor;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x - 22, y + incl * 40);
  g.lineTo(x + 22, y - incl * 40);
  g.stroke();
}
/** Sobrancelha em arco. `arco` > 0 = arqueada para cima. */
function sobArco(g: G, x: number, y: number, cor: string, arco = 9, w = 9) {
  g.strokeStyle = cor;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x - 22, y + 4);
  g.quadraticCurveTo(x, y - arco * 2 + 4, x + 22, y + 4);
  g.stroke();
}

type OpcoesOlho = {
  dx?: number;
  dy?: number;
  rx?: number;
  ry?: number;
  tampa?: number;
  incl?: number;
};

/**
 * Olho de íris colorida com pupila e brilho. `dx/dy` = para onde olha.
 * `tampa` = altura da pálpebra (relativa a OY): o olho é recortado acima
 * dela e ganha o traço da pálpebra — olhar de quem está de boa ou convencido.
 */
function olhoIris(g: G, x: number, iris: string, o: OpcoesOlho = {}) {
  const { dx = 0, dy = 0, rx = 12, ry = 17 } = o;
  const incl = o.incl ?? 0;
  const yE = OY + (o.tampa ?? 0) + incl;
  const yD = OY + (o.tampa ?? 0) - incl;
  g.save();
  if (o.tampa !== undefined) {
    g.beginPath();
    g.moveTo(x - 30, yE);
    g.lineTo(x + 30, yD);
    g.lineTo(x + 30, OY + 40);
    g.lineTo(x - 30, OY + 40);
    g.closePath();
    g.clip();
  }
  g.fillStyle = iris;
  g.beginPath();
  g.ellipse(x + dx, OY + dy, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = ESCURO;
  g.beginPath();
  g.ellipse(x + dx * 1.15, OY + dy + 1, rx * 0.54, ry * 0.59, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = BRANCO;
  g.beginPath();
  g.arc(x + dx + rx * 0.33, OY + dy - ry * 0.35, Math.max(3, rx * 0.33), 0, Math.PI * 2);
  g.fill();
  g.restore();
  if (o.tampa !== undefined) {
    const k = 14 / 60;
    g.strokeStyle = ESCURO;
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(x - 17, yE + (yD - yE) * k);
    g.quadraticCurveTo(x, (yE + yD) / 2 - 2, x + 17, yD + (yE - yD) * k);
    g.stroke();
  }
}

/** Olho fechado de alegria (∩). */
function olhoFeliz(g: G, x: number, w = 8, r = 15) {
  g.strokeStyle = ESCURO;
  g.lineWidth = w;
  g.beginPath();
  g.arc(x, OY + 8, r, Math.PI * 1.1, Math.PI * 1.9);
  g.stroke();
}

/** Olho branco arregalado com pupila pequena. */
function olhoArregalado(g: G, x: number, r: number, pupila: number, dx = 0, dy = 0) {
  g.fillStyle = BRANCO;
  g.strokeStyle = ESCURO;
  g.lineWidth = 5;
  g.beginPath();
  g.arc(x, OY, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = ESCURO;
  g.beginPath();
  g.arc(x + dx, OY + dy, pupila, 0, Math.PI * 2);
  g.fill();
}

function bochechas(g: G, cor = "#f472b6", a = 0.38, y = 150) {
  g.fillStyle = alfa(cor, a);
  [54, 202].forEach((x) => {
    g.beginPath();
    g.ellipse(x, y, 22, 13, 0, 0, Math.PI * 2);
    g.fill();
  });
}

/**
 * Boca em "D": topo reto (ou curvo com `curva`) e fundo redondo passando por
 * `yFundo`. Dentes de cima com `dentes` px de altura e língua opcional.
 */
function bocaD(
  g: G,
  x1: number,
  x2: number,
  yTopo: number,
  yFundo: number,
  o: { dentes?: number; lingua?: boolean; curva?: number } = {},
) {
  const cx = (x1 + x2) / 2;
  const forma = () => {
    g.beginPath();
    g.moveTo(x1, yTopo);
    g.quadraticCurveTo(cx, yTopo + (o.curva ?? 0), x2, yTopo);
    g.quadraticCurveTo(cx, 2 * yFundo - yTopo, x1, yTopo);
    g.closePath();
  };
  forma();
  g.fillStyle = ESCURO;
  g.fill();
  g.save();
  forma();
  g.clip();
  if (o.lingua) {
    g.fillStyle = LINGUA;
    g.beginPath();
    g.ellipse(cx, yFundo - 3, (x2 - x1) * 0.24, 11, 0, 0, Math.PI * 2);
    g.fill();
  }
  if (o.dentes) {
    g.fillStyle = BRANCO;
    g.fillRect(x1, yTopo - 20, x2 - x1, 20 + Math.max(0, o.curva ?? 0) / 2 + o.dentes);
  }
  g.restore();
}

/** Fileira de dentes cerrados num contorno: linha do meio e divisões. */
function dentesCerrados(
  g: G,
  forma: () => void,
  meio: () => void,
  xs: number[],
  y0: number,
  y1: number,
) {
  forma();
  g.fillStyle = BRANCO;
  g.fill();
  g.save();
  forma();
  g.clip();
  g.strokeStyle = "#9ca3af";
  g.lineWidth = 2.5;
  xs.forEach((x) => {
    g.beginPath();
    g.moveTo(x, y0);
    g.lineTo(x, y1);
    g.stroke();
  });
  g.strokeStyle = ESCURO;
  g.lineWidth = 3;
  meio();
  g.stroke();
  g.restore();
  g.strokeStyle = ESCURO;
  g.lineWidth = 6;
  forma();
  g.stroke();
}

/** Boca de falar padrão (o mesmo "O" dos rostos antigos), com deslocamento. */
function bocaFalando(g: G, cx = 128, cy = 176, rx = 24, ry = 18) {
  g.fillStyle = ESCURO;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#e57373";
  g.beginPath();
  g.ellipse(cx, cy + ry * 0.5, rx * 0.55, ry * 0.4, 0, 0, Math.PI * 2);
  g.fill();
}

const EXPRESSOES: Record<string, (g: G, r: Rosto) => void> = {
  // Chill: pálpebras baixas, sorrisinho de lado.
  relaxado(g, { iris, pelo, aberta }) {
    sob(g, OE, 66, -0.02, pelo);
    sob(g, OD, 66, 0.02, pelo);
    olhoIris(g, OE, iris, { tampa: -1, dx: 2 });
    olhoIris(g, OD, iris, { tampa: -1, dx: 2 });
    if (aberta) return bocaFalando(g, 132, 174, 18, 14);
    g.strokeStyle = ESCURO;
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(104, 170);
    g.quadraticCurveTo(132, 186, 156, 162);
    g.stroke();
  },

  // Super Super Happy: olhos ∩ grossos e bocão aberto com língua.
  superFeliz(g, { pelo, aberta }) {
    bochechas(g, "#fb7185", 0.32, 146);
    sobArco(g, OE, 60, pelo, 7);
    sobArco(g, OD, 60, pelo, 7);
    olhoFeliz(g, OE, 10, 17);
    olhoFeliz(g, OD, 10, 17);
    if (aberta) bocaD(g, 92, 164, 154, 204, { dentes: 9, lingua: true });
    else bocaD(g, 76, 180, 148, 226, { dentes: 12, lingua: true, curva: 6 });
  },

  // Beaming with Pride: olhos fechados de satisfação e sorrisão de dentes.
  orgulhoso(g, { pelo, aberta }) {
    bochechas(g, "#fb7185", 0.3, 146);
    sobArco(g, OE, 62, pelo, 8);
    sobArco(g, OD, 62, pelo, 8);
    olhoFeliz(g, OE);
    olhoFeliz(g, OD);
    if (aberta) {
      bocaD(g, 84, 172, 154, 206, { dentes: 12 });
      g.save();
      g.beginPath();
      g.moveTo(84, 154);
      g.quadraticCurveTo(128, 258, 172, 154);
      g.clip();
      g.fillStyle = BRANCO;
      g.fillRect(84, 194, 88, 20);
      g.restore();
      return;
    }
    const forma = () => {
      g.beginPath();
      g.moveTo(80, 152);
      g.quadraticCurveTo(128, 168, 176, 152);
      g.quadraticCurveTo(128, 236, 80, 152);
      g.closePath();
    };
    const meio = () => {
      g.beginPath();
      g.moveTo(82, 160);
      g.quadraticCurveTo(128, 200, 174, 160);
    };
    dentesCerrados(g, forma, meio, [102, 116, 128, 140, 154], 150, 200);
  },

  // Check It: uma sobrancelha lá em cima, olhar de canto e sorriso torto.
  confere(g, { iris, pelo, aberta }) {
    sob(g, OE, 72, -0.06, pelo);
    sobArco(g, OD, 54, pelo, 10);
    olhoIris(g, OE, iris, { dx: 5, dy: -3 });
    olhoIris(g, OD, iris, { dx: 5, dy: -3, rx: 13, ry: 18 });
    const forma = () => {
      g.beginPath();
      g.moveTo(98, 168);
      g.quadraticCurveTo(140, aberta ? 206 : 192, 172, 150);
      g.quadraticCurveTo(140, aberta ? 162 : 170, 98, 168);
      g.closePath();
    };
    forma();
    g.fillStyle = ESCURO;
    g.fill();
    g.save();
    forma();
    g.clip();
    g.fillStyle = BRANCO;
    g.beginPath();
    g.moveTo(98, 168);
    g.quadraticCurveTo(140, aberta ? 162 : 170, 172, 150);
    g.lineTo(172, 166);
    g.quadraticCurveTo(140, aberta ? 178 : 186, 98, 176);
    g.fill();
    g.restore();
  },

  // Err…: sobrancelha torta, olhar para o lado, boca reta e gota de suor.
  hesitante(g, { iris, pelo, aberta }) {
    sob(g, OE, 70, -0.04, pelo);
    sob(g, OD, 62, -0.12, pelo);
    olhoIris(g, OE, iris, { dx: -6 });
    olhoIris(g, OD, iris, { dx: -6 });
    gota(g, 206, 70, 9);
    if (aberta) return bocaFalando(g, 122, 176, 12, 13);
    g.strokeStyle = ESCURO;
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(104, 178);
    g.lineTo(124, 172);
    g.lineTo(152, 170);
    g.stroke();
  },

  // Silly Fun: um olho arregalado, o outro apertado, língua de lado.
  bobo(g, { pelo, aberta }) {
    sobArco(g, OE, 56, pelo, 8);
    sob(g, OD, 74, -0.1, pelo);
    olhoArregalado(g, OE, 21, 8, 4, 3);
    g.strokeStyle = ESCURO;
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(OD - 16, OY - 10);
    g.lineTo(OD + 12, OY);
    g.lineTo(OD - 16, OY + 10);
    g.stroke();
    if (aberta) return bocaD(g, 94, 162, 160, 204, { lingua: true });
    g.fillStyle = LINGUA;
    g.strokeStyle = escuro(LINGUA, 0.35);
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(146, 186, 13, 17, -0.3, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(146, 176);
    g.lineTo(149, 190);
    g.stroke();
    g.strokeStyle = ESCURO;
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(92, 160);
    g.quadraticCurveTo(128, 196, 170, 164);
    g.stroke();
  },

  // Smug: pálpebras baixas olhando de lado, sobrancelha erguida, sorriso de canto.
  convencido(g, { iris, pelo, aberta }) {
    sob(g, OE, 72, 0.06, pelo);
    sobArco(g, OD, 56, pelo, 9);
    olhoIris(g, OE, iris, { tampa: -2, incl: -3, dx: -5 });
    olhoIris(g, OD, iris, { tampa: -4, incl: 3, dx: -5 });
    if (aberta) return bocaFalando(g, 140, 172, 16, 12);
    g.strokeStyle = ESCURO;
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(106, 174);
    g.quadraticCurveTo(142, 182, 162, 156);
    g.stroke();
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(164, 150);
    g.quadraticCurveTo(172, 158, 166, 166);
    g.stroke();
  },

  // Shiny Teeth: sorriso de dentes branquíssimos com brilho.
  dentesBrilhando(g, { iris, pelo, aberta }) {
    sobArco(g, OE, 64, pelo, 6);
    sobArco(g, OD, 64, pelo, 6);
    olhoIris(g, OE, iris);
    olhoIris(g, OD, iris);
    if (aberta) {
      bocaD(g, 86, 170, 152, 210, { dentes: 14, curva: 10 });
      g.save();
      g.beginPath();
      g.moveTo(86, 152);
      g.quadraticCurveTo(128, 268, 170, 152);
      g.clip();
      g.fillStyle = BRANCO;
      g.fillRect(86, 198, 84, 20);
      g.restore();
    } else {
      const forma = () => {
        g.beginPath();
        g.moveTo(82, 154);
        g.quadraticCurveTo(128, 168, 174, 154);
        g.quadraticCurveTo(170, 208, 128, 210);
        g.quadraticCurveTo(86, 208, 82, 154);
        g.closePath();
      };
      const meio = () => {
        g.beginPath();
        g.moveTo(80, 182);
        g.quadraticCurveTo(128, 192, 176, 182);
      };
      dentesCerrados(g, forma, meio, [100, 114, 128, 142, 156], 150, 214);
    }
    brilho(g, 178, 150, 14, BRANCO);
    brilho(g, 178, 150, 7, "#fde68a");
    brilho(g, 194, 168, 6, BRANCO);
  },

  // Chorando de rir: olhos > <, lágrimas e bocão.
  chorandoDeRir(g, { pelo, aberta }) {
    sobArco(g, OE, 62, pelo, 6);
    sobArco(g, OD, 62, pelo, 6);
    g.strokeStyle = ESCURO;
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(OE - 16, OY - 12);
    g.lineTo(OE + 12, OY);
    g.lineTo(OE - 16, OY + 12);
    g.moveTo(OD + 16, OY - 12);
    g.lineTo(OD - 12, OY);
    g.lineTo(OD + 16, OY + 12);
    g.stroke();
    // Lágrimas escorrendo dos cantos de fora.
    [-1, 1].forEach((l) => {
      const x = l < 0 ? OE - 22 : OD + 22;
      g.strokeStyle = "rgba(96,165,250,0.9)";
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(x, OY + 8);
      g.quadraticCurveTo(x + l * 10, OY + 30, x + l * 4, OY + 54);
      g.stroke();
      gota(g, x + l * 4, OY + 58, 7, "#93c5fd", "#2563eb");
    });
    if (aberta) bocaD(g, 92, 164, 152, 200, { dentes: 9, lingua: true });
    else bocaD(g, 78, 178, 146, 222, { dentes: 12, lingua: true });
  },

  // Olhos de anime brilhando, boquinha de gato.
  olhosBrilhando(g, { iris, pelo, aberta }) {
    bochechas(g, "#f472b6", 0.3, 150);
    sobArco(g, OE, 56, pelo, 5, 6);
    sobArco(g, OD, 56, pelo, 5, 6);
    [OE, OD].forEach((x) => {
      const gi = g.createLinearGradient(0, OY - 24, 0, OY + 24);
      gi.addColorStop(0, escuro(iris, 0.55));
      gi.addColorStop(0.6, iris);
      gi.addColorStop(1, claro(iris, 0.45));
      g.fillStyle = gi;
      g.beginPath();
      g.ellipse(x, OY + 2, 16, 23, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = ESCURO;
      g.lineWidth = 4;
      g.stroke();
      g.fillStyle = ESCURO;
      g.beginPath();
      g.ellipse(x, OY + 2, 8, 12, 0, 0, Math.PI * 2);
      g.fill();
      // Cílio de cima grosso, como nos animes.
      g.lineWidth = 7;
      g.beginPath();
      g.ellipse(x, OY + 2, 17, 24, 0, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
      g.fillStyle = BRANCO;
      g.beginPath();
      g.arc(x + 6, OY - 7, 6.5, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(x - 6, OY + 13, 3.2, 0, Math.PI * 2);
      g.fill();
      brilho(g, x - 7, OY - 6, 6, BRANCO);
    });
    if (aberta) return bocaD(g, 112, 144, 166, 192, { lingua: true });
    g.strokeStyle = ESCURO;
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(108, 166);
    g.quadraticCurveTo(118, 178, 128, 168);
    g.quadraticCurveTo(138, 178, 148, 166);
    g.stroke();
  },

  // Determinado: sobrancelhas franzidas, olhar firme e dentes cerrados.
  determinado(g, { iris, pelo, aberta }) {
    sob(g, OE, 72, -0.28, pelo, 10);
    sob(g, OD, 72, 0.28, pelo, 10);
    olhoIris(g, OE, iris, { tampa: -7, incl: -4 });
    olhoIris(g, OD, iris, { tampa: -7, incl: 4 });
    if (aberta) {
      g.fillStyle = ESCURO;
      g.beginPath();
      g.moveTo(98, 160);
      g.lineTo(158, 160);
      g.lineTo(148, 200);
      g.lineTo(108, 200);
      g.closePath();
      g.fill();
      g.fillStyle = BRANCO;
      g.fillRect(100, 162, 56, 9);
      return;
    }
    const forma = () => {
      g.beginPath();
      g.roundRect(98, 164, 60, 24, 8);
    };
    const meio = () => {
      g.beginPath();
      g.moveTo(98, 176);
      g.lineTo(158, 176);
    };
    dentesCerrados(g, forma, meio, [113, 128, 143], 164, 188);
  },

  // Nervoso: olhos arregalados de pupila mínima, careta e suor.
  nervoso(g, { pelo, aberta }) {
    sob(g, OE, 62, 0.18, pelo);
    sob(g, OD, 62, -0.18, pelo);
    olhoArregalado(g, OE, 19, 4.5, 2);
    olhoArregalado(g, OD, 19, 4.5, 2);
    gota(g, 212, 68, 10);
    gota(g, 40, 92, 6);
    if (aberta) {
      g.fillStyle = ESCURO;
      g.beginPath();
      g.moveTo(102, 172);
      g.quadraticCurveTo(115, 158, 128, 170);
      g.quadraticCurveTo(141, 158, 154, 172);
      g.quadraticCurveTo(128, 204, 102, 172);
      g.fill();
      return;
    }
    const forma = () => {
      g.beginPath();
      g.moveTo(90, 168);
      g.quadraticCurveTo(109, 156, 128, 166);
      g.quadraticCurveTo(147, 156, 166, 168);
      g.lineTo(162, 186);
      g.quadraticCurveTo(128, 194, 94, 186);
      g.closePath();
    };
    const meio = () => {
      g.beginPath();
      g.moveTo(88, 176);
      g.quadraticCurveTo(128, 182, 168, 176);
    };
    dentesCerrados(g, forma, meio, [106, 118, 128, 138, 150], 156, 196);
  },

  // UwU: olhinhos em U, boca em w e bochecha riscada.
  uwu(g, { pelo, aberta }) {
    bochechas(g, "#f472b6", 0.42, 148);
    g.strokeStyle = alfa("#be185d", 0.75);
    g.lineWidth = 3;
    [54, 202].forEach((x) => {
      for (let k = -1; k <= 1; k++) {
        g.beginPath();
        g.moveTo(x + k * 10 - 4, 156);
        g.lineTo(x + k * 10 + 4, 144);
        g.stroke();
      }
    });
    sobArco(g, OE, 66, pelo, 4, 7);
    sobArco(g, OD, 66, pelo, 4, 7);
    g.strokeStyle = ESCURO;
    g.lineWidth = 8;
    [OE, OD].forEach((x) => {
      g.beginPath();
      g.arc(x, OY - 4, 14, Math.PI * 0.08, Math.PI * 0.92);
      g.stroke();
    });
    if (aberta) {
      g.fillStyle = ESCURO;
      g.beginPath();
      g.moveTo(106, 166);
      g.quadraticCurveTo(117, 178, 128, 168);
      g.quadraticCurveTo(139, 178, 150, 166);
      g.quadraticCurveTo(150, 196, 128, 196);
      g.quadraticCurveTo(106, 196, 106, 166);
      g.fill();
      g.fillStyle = LINGUA;
      g.beginPath();
      g.ellipse(128, 189, 11, 6, 0, 0, Math.PI * 2);
      g.fill();
      return;
    }
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(104, 166);
    g.quadraticCurveTo(116, 184, 128, 170);
    g.quadraticCurveTo(140, 184, 152, 166);
    g.stroke();
  },

  // 8-bit: olhos e sorriso de quadradinhos.
  pixel(g, { pelo, aberta }) {
    const u = 10;
    const bloco = (x: number, y: number, cor: string) => {
      g.fillStyle = cor;
      g.fillRect(x, y, u, u);
    };
    for (let c = 0; c < 4; c++) {
      bloco(OE - 20 + c * u, 70, pelo);
      bloco(OD - 20 + c * u, 70, pelo);
    }
    [OE, OD].forEach((x) => {
      for (let c = 0; c < 2; c++)
        for (let r = 0; r < 3; r++) bloco(x - 10 + c * u, OY - 15 + r * u, ESCURO);
      bloco(x, OY - 15, BRANCO);
    });
    if (aberta) {
      for (let c = -2; c < 2; c++)
        for (let r = 0; r < 3; r++) bloco(128 + c * u, 160 + r * u, ESCURO);
      bloco(118, 180, LINGUA);
      bloco(128, 180, LINGUA);
      return;
    }
    const sorriso: [number, number][] = [
      [-5, 0],
      [4, 0],
      [-4, 1],
      [3, 1],
      [-3, 2],
      [-2, 2],
      [-1, 2],
      [0, 2],
      [1, 2],
      [2, 2],
    ];
    sorriso.forEach(([c, r]) => bloco(128 + c * u, 156 + r * u, ESCURO));
  },

  // Nocauteado: olhos em X, língua de fora e estrelinhas rodando.
  nocaute(g, { aberta }) {
    g.strokeStyle = ESCURO;
    g.lineWidth = 8;
    [OE, OD].forEach((x) => {
      g.beginPath();
      g.moveTo(x - 13, OY - 13);
      g.lineTo(x + 13, OY + 13);
      g.moveTo(x + 13, OY - 13);
      g.lineTo(x - 13, OY + 13);
      g.stroke();
    });
    (
      [
        [56, 46, 11],
        [128, 30, 13],
        [200, 46, 11],
      ] as const
    ).forEach(([x, y, r]) => {
      estrela(g, x, y, r);
      g.fillStyle = "#facc15";
      g.fill();
      g.strokeStyle = "#a16207";
      g.lineWidth = 2;
      g.stroke();
    });
    if (aberta) return bocaFalando(g, 128, 176, 14, 16);
    g.fillStyle = LINGUA;
    g.strokeStyle = escuro(LINGUA, 0.35);
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(136, 186, 12, 16, 0.15, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.strokeStyle = ESCURO;
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(100, 172);
    g.quadraticCurveTo(110, 164, 120, 172);
    g.quadraticCurveTo(130, 180, 140, 172);
    g.quadraticCurveTo(150, 164, 158, 172);
    g.stroke();
  },
};

export function ehExpressaoExtra(expressao: string): boolean {
  return expressao in EXPRESSOES;
}

/** Desenha sobrancelhas, olhos e boca das expressões do lote 2. */
export function desenharExpressaoExtra(
  g: G,
  c: Pick<AvatarConfig, "expressao" | "olhos" | "pele">,
  bocaAberta: boolean,
  corSobrancelha: string,
) {
  const f = EXPRESSOES[c.expressao];
  if (!f) return;
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  f(g, { iris: c.olhos, pelo: corSobrancelha, pele: c.pele, aberta: bocaAberta });
  g.restore();
}

/* ————————————————— detalhes (adesivos do rosto) ————————————————— */

/** Pintinhas espalhadas com semente. `area` = [x, y, raioX, raioY]. */
function sardas(
  g: G,
  cor: string,
  semente: number,
  n: number,
  areas: [number, number, number, number][],
) {
  const rnd = sorteio(semente);
  g.fillStyle = cor;
  for (let i = 0; i < n; i++) {
    const [ax, ay, rx, ry] = areas[i % areas.length]!;
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd());
    g.beginPath();
    g.arc(ax + Math.cos(a) * rx * d, ay + Math.sin(a) * ry * d, 2 + rnd() * 2.2, 0, Math.PI * 2);
    g.fill();
  }
}

/** Cor de sarda/pinta que aparece em qualquer tom de pele. */
function corDeSarda(pele: string, forca = 0.45): string {
  return luz(pele) > 90
    ? alfa(escuro(misturar(pele, "#7a3b12", 0.5), forca * 0.6), 0.8)
    : alfa("#1a0d07", 0.75);
}

function faixa(g: G, x1: number, y1: number, x2: number, y2: number, w: number, cor: string) {
  g.strokeStyle = cor;
  g.lineWidth = w;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

const DETALHES: Record<string, (g: G, pele: string) => void> = {
  sardasNariz(g, pele) {
    sardas(g, corDeSarda(pele), 11, 34, [
      [128, 136, 26, 9],
      [62, 142, 22, 14],
      [194, 142, 22, 14],
    ]);
  },
  bochechaCoracao(g) {
    [54, 202].forEach((x) => {
      coracao(g, x, 150, 14);
      g.fillStyle = "#f43f5e";
      g.fill();
      g.strokeStyle = BRANCO;
      g.lineWidth = 2.5;
      g.stroke();
    });
  },
  estrelinhas(g) {
    (
      [
        [208, 136, 15, "#facc15"],
        [184, 160, 9, "#f472b6"],
        [222, 166, 7, "#38bdf8"],
      ] as const
    ).forEach(([x, y, r, cor], i) => {
      estrela(g, x, y, r, 0.48, i * 0.3);
      g.strokeStyle = BRANCO;
      g.lineWidth = 5;
      g.stroke();
      g.fillStyle = cor;
      g.fill();
    });
  },
  curativo(g, pele) {
    g.save();
    g.translate(196, 150);
    g.rotate(-0.55);
    const fita = luz(pele) > 150 ? "#e8b98a" : "#f3cfa6";
    g.fillStyle = fita;
    g.strokeStyle = escuro(fita, 0.3);
    g.lineWidth = 2.5;
    g.beginPath();
    g.roundRect(-34, -11, 68, 22, 11);
    g.fill();
    g.stroke();
    g.fillStyle = claro(fita, 0.45);
    g.fillRect(-11, -9, 22, 18);
    g.fillStyle = escuro(fita, 0.25);
    [-24, -18, 18, 24].forEach((x) =>
      [-4, 4].forEach((y) => {
        g.beginPath();
        g.arc(x, y, 1.4, 0, Math.PI * 2);
        g.fill();
      }),
    );
    g.restore();
  },
  pinturaBrasil(g) {
    [-1, 1].forEach((l) => {
      const x = l < 0 ? 54 : 202;
      faixa(g, x - 16, 140, x + 16, 140, 10, "#16a34a");
      faixa(g, x - 16, 154, x + 16, 154, 10, "#facc15");
      g.fillStyle = "#1d4ed8";
      g.beginPath();
      g.arc(x + l * 26, 147, 6, 0, Math.PI * 2);
      g.fill();
    });
  },
  pinturaTigre(g) {
    [-1, 1].forEach((l) => {
      const borda = l < 0 ? 18 : 238;
      g.fillStyle = "rgba(249,115,22,0.75)";
      g.beginPath();
      g.ellipse(l < 0 ? 52 : 204, 150, 30, 20, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#111";
      [0, 1, 2].forEach((k) => {
        const y = 136 + k * 14;
        g.beginPath();
        g.moveTo(borda, y - 5);
        g.quadraticCurveTo(borda - l * 26, y, borda - l * (40 - k * 6), y + 3);
        g.quadraticCurveTo(borda - l * 22, y + 6, borda, y + 6);
        g.closePath();
        g.fill();
      });
      // Listra na testa, como a pintura de tigre de festa.
      g.beginPath();
      g.moveTo(128 + l * 10, 30);
      g.quadraticCurveTo(128 + l * 22, 44, 128 + l * 14, 58);
      g.quadraticCurveTo(128 + l * 14, 44, 128 + l * 3, 32);
      g.closePath();
      g.fill();
    });
  },
  brilhinhos(g) {
    (
      [
        [44, 128, 11],
        [60, 160, 6],
        [212, 128, 11],
        [196, 160, 6],
        [128, 64, 7],
      ] as const
    ).forEach(([x, y, r]) => {
      brilho(g, x, y, r + 2, "rgba(161,98,7,0.55)");
      brilho(g, x, y, r, "#fef3c7");
    });
  },
  cicatriz(g, pele) {
    const cor = luz(pele) > 90 ? misturar(pele, "#9f1239", 0.45) : misturar(pele, "#f9a8d4", 0.35);
    g.strokeStyle = cor;
    g.lineWidth = 6;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(OD - 12, 66);
    g.lineTo(OD + 8, 146);
    g.stroke();
    g.lineWidth = 3;
    [78, 94, 120, 134].forEach((y) => {
      const x = OD - 12 + ((y - 66) / 80) * 20;
      g.beginPath();
      g.moveTo(x - 8, y + 1);
      g.lineTo(x + 8, y - 1);
      g.stroke();
    });
  },
  lagrima(g) {
    gota(g, OD + 6, 142, 7, "#60a5fa", "#1e3a8a");
  },
  pintasCharme(g, pele) {
    g.fillStyle = corDeSarda(pele, 0.8);
    (
      [
        [OE - 22, 128, 3.5],
        [196, 150, 4.5],
        [104, 160, 3.2],
      ] as const
    ).forEach(([x, y, r]) => {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    });
  },
  sardasBlush(g, pele) {
    const blush = luz(pele) > 90 ? "#f472b6" : "#fb7185";
    [54, 202].forEach((x) => {
      const gr = g.createRadialGradient(x, 148, 2, x, 148, 28);
      gr.addColorStop(0, alfa(blush, 0.5));
      gr.addColorStop(1, alfa(blush, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, 148, 30, 22, 0, 0, Math.PI * 2);
      g.fill();
    });
    sardas(g, corDeSarda(pele), 23, 22, [
      [58, 144, 18, 10],
      [198, 144, 18, 10],
      [128, 138, 14, 6],
    ]);
  },
  glitter(g) {
    const rnd = sorteio(7);
    const cores = ["#fde047", "#f9a8d4", "#ffffff", "#c4b5fd"];
    [
      [56, 132],
      [200, 132],
      [OE, 80],
      [OD, 80],
    ].forEach(([ax, ay], k) => {
      const n = k < 2 ? 26 : 12;
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd());
        const x = ax! + Math.cos(a) * (k < 2 ? 26 : 20) * d;
        const y = ay! + Math.sin(a) * (k < 2 ? 12 : 5) * d;
        g.fillStyle = cores[i % cores.length]!;
        g.beginPath();
        g.arc(x, y, 1.4 + rnd() * 1.8, 0, Math.PI * 2);
        g.fill();
      }
    });
    brilho(g, 44, 126, 8, "#ffffff");
    brilho(g, 212, 126, 8, "#ffffff");
  },
  pinturaGuerra(g) {
    [-1, 1].forEach((l) => {
      const x = l < 0 ? 58 : 198;
      [0, 1, 2].forEach((k) => {
        faixa(g, x - l * 14, 132 + k * 13, x + l * 14, 128 + k * 13, 7, "#dc2626");
      });
      g.fillStyle = BRANCO;
      [0, 1].forEach((k) => {
        g.beginPath();
        g.arc(x + l * 26, 136 + k * 14, 3.6, 0, Math.PI * 2);
        g.fill();
      });
    });
    faixa(g, 128, 40, 128, 62, 7, "#dc2626");
  },
  coradoAnime(g) {
    bochechas(g, "#fb7185", 0.45, 148);
    g.strokeStyle = "rgba(190,18,60,0.8)";
    g.lineWidth = 3;
    g.lineCap = "round";
    [54, 202].forEach((x) => {
      for (let k = -1; k <= 1; k++) {
        g.beginPath();
        g.moveTo(x + k * 10 - 4, 156);
        g.lineTo(x + k * 10 + 5, 142);
        g.stroke();
      }
    });
  },
};

export function ehDetalheExtra(detalhe: string): boolean {
  return detalhe in DETALHES;
}

/** Desenha um adesivo de rosto do lote 2 (embaixo dos olhos e da boca). */
export function desenharDetalheExtra(g: G, detalhe: string, pele: string) {
  const f = DETALHES[detalhe];
  if (!f) return;
  g.save();
  f(g, pele);
  g.restore();
}

/* ————————————————— barbas ————————————————— */

/** O contorno da barba cheia: queixo e bochechas, de `alto` para baixo. */
function caminhoMandibula(g: G, alto: number) {
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
}

/** Recorta o vão da boca (a pele volta a aparecer em volta dela). */
function vaoDaBoca(g: G, rx = 54, ry = 29) {
  g.save();
  g.globalCompositeOperation = "destination-out";
  g.beginPath();
  g.ellipse(128, 176, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function bigode(g: G, cor: string, largura = 40, grossura = 1) {
  g.fillStyle = cor;
  g.beginPath();
  g.moveTo(128, 134);
  g.quadraticCurveTo(128 - largura * 0.65, 124 - 4 * grossura, 128 - largura, 146);
  g.quadraticCurveTo(128 - largura * 0.5, 140 + 2 * grossura, 128, 147);
  g.quadraticCurveTo(128 + largura * 0.5, 140 + 2 * grossura, 128 + largura, 146);
  g.quadraticCurveTo(128 + largura * 0.65, 124 - 4 * grossura, 128, 134);
  g.fill();
}

/** Fios riscados por cima da massa da barba, para ela não ficar chapada. */
function fios(
  g: G,
  cor: string,
  semente: number,
  n: number,
  area: (r: () => number) => [number, number],
) {
  const rnd = sorteio(semente);
  g.strokeStyle = alfa(escuro(cor, 0.4), 0.5);
  g.lineWidth = 2;
  for (let i = 0; i < n; i++) {
    const [x, y] = area(rnd);
    const inc = (x - 128) / 90;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + inc * 4, y + 6, x + inc * 3, y + 12);
    g.stroke();
  }
}

/** Trança de gomos descendo de (x, y0) até y1, com anel de enfeite. */
function tranca(g: G, x: number, y0: number, y1: number, cor: string, anel?: string) {
  const passo = 9;
  for (let y = y0, k = 0; y < y1; y += passo, k++) {
    const l = k % 2 ? 1 : -1;
    // Gomos mais claros com contorno escuro: a trança se destaca da barba.
    g.fillStyle = k % 2 ? claro(cor, 0.22) : claro(cor, 0.1);
    g.beginPath();
    g.ellipse(x + l * 3, y + passo / 2, 9, 7, l * 0.6, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = alfa(escuro(cor, 0.6), 0.85);
    g.lineWidth = 2;
    g.stroke();
  }
  if (anel) {
    const ya = y0 + (y1 - y0) * 0.6;
    g.fillStyle = anel;
    g.strokeStyle = escuro(anel, 0.4);
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(x - 11, ya - 5, 22, 10, 3);
    g.fill();
    g.stroke();
  }
}

const BARBAS: Record<string, (g: G, cor: string) => void> = {
  porFazer(g, cor) {
    g.save();
    caminhoMandibula(g, 100);
    g.moveTo(92, 150);
    g.lineTo(92, 128);
    g.lineTo(164, 128);
    g.lineTo(164, 150);
    g.closePath();
    g.clip();
    g.fillStyle = alfa(cor, 0.14);
    g.fillRect(0, 0, 256, 256);
    const rnd = sorteio(31);
    g.fillStyle = alfa(cor, 0.55);
    for (let i = 0; i < 900; i++) {
      g.fillRect(14 + rnd() * 228, 96 + rnd() * 160, 2.2, 2.2);
    }
    g.restore();
    vaoDaBoca(g, 46, 24);
  },
  cavanhaqueBode(g, cor) {
    g.fillStyle = cor;
    g.beginPath();
    g.moveTo(108, 204);
    g.quadraticCurveTo(128, 196, 148, 204);
    g.quadraticCurveTo(150, 228, 134, 246);
    g.lineTo(128, 256);
    g.lineTo(122, 246);
    g.quadraticCurveTo(106, 228, 108, 204);
    g.fill();
    fios(g, cor, 5, 14, (r) => [112 + r() * 32, 206 + r() * 30]);
  },
  guidao(g, cor) {
    bigode(g, cor, 40, 1.4);
    g.strokeStyle = cor;
    g.lineWidth = 8;
    g.lineCap = "round";
    [-1, 1].forEach((l) => {
      g.beginPath();
      g.moveTo(128 + l * 34, 145);
      g.quadraticCurveTo(128 + l * 58, 152, 128 + l * 64, 136);
      g.quadraticCurveTo(128 + l * 66, 124, 128 + l * 56, 126);
      g.stroke();
    });
  },
  contorno(g, cor) {
    g.strokeStyle = cor;
    g.lineWidth = 15;
    g.lineCap = "butt";
    g.beginPath();
    g.moveTo(30, 72);
    g.lineTo(30, 170);
    g.quadraticCurveTo(38, 244, 128, 248);
    g.quadraticCurveTo(218, 244, 226, 170);
    g.lineTo(226, 72);
    g.stroke();
  },
  viking(g, cor) {
    g.fillStyle = cor;
    caminhoMandibula(g, 84);
    g.fill();
    vaoDaBoca(g);
    fios(g, cor, 9, 60, (r) => {
      const a = Math.PI * (0.1 + r() * 0.8);
      return [128 + Math.cos(a) * (60 + r() * 40), 176 + Math.sin(a) * (34 + r() * 30)];
    });
    bigode(g, cor, 52, 1.6);
    tranca(g, 100, 200, 256, cor, "#d4a017");
    tranca(g, 156, 200, 256, cor, "#d4a017");
  },
  mosca(g, cor) {
    g.fillStyle = cor;
    g.beginPath();
    g.moveTo(116, 204);
    g.quadraticCurveTo(128, 199, 140, 204);
    g.lineTo(128, 224);
    g.closePath();
    g.fill();
  },
  suicas(g, cor) {
    g.fillStyle = cor;
    [-1, 1].forEach((l) => {
      const x = l < 0 ? 22 : 234;
      g.beginPath();
      g.moveTo(x, 72);
      g.lineTo(x - l * 22, 72);
      g.quadraticCurveTo(x - l * 26, 126, x - l * 76, 140);
      g.quadraticCurveTo(x - l * 78, 172, x - l * 58, 198);
      g.quadraticCurveTo(x - l * 18, 206, x, 176);
      g.closePath();
      g.fill();
    });
    bigode(g, cor, 46, 1.2);
  },
  volumosa(g, cor) {
    g.fillStyle = cor;
    caminhoMandibula(g, 88);
    g.fill();
    // Barra ondulada embaixo, de barba que cresceu à vontade.
    g.beginPath();
    for (let k = 0; k <= 8; k++) {
      const x = 40 + k * 22;
      g.arc(x, 236 + Math.sin(k) * 4, 14, 0, Math.PI * 2);
    }
    g.fill();
    vaoDaBoca(g, 50, 27);
    fios(g, cor, 13, 90, (r) => {
      const a = Math.PI * (0.05 + r() * 0.9);
      return [128 + Math.cos(a) * (58 + r() * 50), 170 + Math.sin(a) * (34 + r() * 44)];
    });
    bigode(g, cor, 50, 1.8);
  },
  ancora(g, cor) {
    g.fillStyle = cor;
    g.beginPath();
    g.moveTo(118, 202);
    g.lineTo(138, 202);
    g.lineTo(137, 216);
    g.quadraticCurveTo(168, 222, 186, 196);
    g.quadraticCurveTo(182, 240, 128, 252);
    g.quadraticCurveTo(74, 240, 70, 196);
    g.quadraticCurveTo(88, 222, 119, 216);
    g.closePath();
    g.fill();
    bigode(g, cor, 34, 0.6);
  },
  ferradura(g, cor) {
    bigode(g, cor, 42, 1.2);
    g.fillStyle = cor;
    [86, 154].forEach((x) => {
      g.beginPath();
      g.roundRect(x, 136, 16, 104, 7);
      g.fill();
    });
  },
  lapis(g, cor) {
    g.strokeStyle = cor;
    g.lineWidth = 5;
    g.lineCap = "round";
    [-1, 1].forEach((l) => {
      g.beginPath();
      g.moveTo(128 + l * 4, 143);
      g.quadraticCurveTo(128 + l * 18, 138, 128 + l * 32, 146);
      g.stroke();
    });
  },
  trancada(g, cor) {
    g.fillStyle = cor;
    g.beginPath();
    g.moveTo(98, 206);
    g.quadraticCurveTo(128, 196, 158, 206);
    g.quadraticCurveTo(156, 226, 128, 228);
    g.quadraticCurveTo(100, 226, 98, 206);
    g.fill();
    bigode(g, cor, 42, 1.2);
    tranca(g, 128, 214, 256, cor, "#9ca3af");
  },
  degrade(g, cor) {
    const gr = g.createLinearGradient(0, 80, 0, 200);
    gr.addColorStop(0, alfa(cor, 0.1));
    gr.addColorStop(0.55, alfa(cor, 0.75));
    gr.addColorStop(1, alfa(cor, 1));
    g.fillStyle = gr;
    caminhoMandibula(g, 80);
    g.fill();
    vaoDaBoca(g);
    bigode(g, cor, 40, 1);
  },
};

export function ehBarbaExtra(barba: string): boolean {
  return barba in BARBAS;
}

/** Desenha uma barba do lote 2 (sempre no adesivo, por baixo da boca). */
export function desenharBarbaExtra(g: G, barba: string, cor: string) {
  const f = BARBAS[barba];
  if (!f) return;
  g.save();
  g.lineJoin = "round";
  f(g, cor);
  g.restore();
}

/* ————————————————— óculos ————————————————— */

function ponte(g: G, cor: string, w: number, arco = 6, y = OY - 2) {
  g.strokeStyle = cor;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(OE + 28, y);
  g.quadraticCurveTo(128, y - arco, OD - 28, y);
  g.stroke();
}
function hastes(g: G, cor: string, w: number, y = OY - 6) {
  g.strokeStyle = cor;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(OE - 34, y);
  g.lineTo(14, y - 4);
  g.moveTo(OD + 34, y);
  g.lineTo(242, y - 4);
  g.stroke();
}
function reflexo(g: G, x: number, y: number, a = 0.55) {
  g.strokeStyle = `rgba(255,255,255,${a})`;
  g.lineWidth = 4;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x - 14, y + 4);
  g.lineTo(x - 4, y - 8);
  g.stroke();
}

/** Aro preto por baixo de uma armação clara: aparece em qualquer pele. */
function aroDuplo(g: G, forma: () => void, cor: string, w: number) {
  g.strokeStyle = ESCURO;
  g.lineWidth = w + 4;
  forma();
  g.stroke();
  g.strokeStyle = cor;
  g.lineWidth = w;
  forma();
  g.stroke();
}

const OCULOS: Record<string, (g: G) => void> = {
  coracao(g) {
    hastes(g, "#be185d", 5);
    ponte(g, "#be185d", 5);
    [OE, OD].forEach((x) => {
      const f = () => coracao(g, x, OY + 2, 27);
      f();
      g.fillStyle = "rgba(219,39,119,0.85)";
      g.fill();
      aroDuplo(g, f, "#f9a8d4", 4);
      reflexo(g, x - 2, OY - 4);
    });
  },
  estrela(g) {
    hastes(g, "#a16207", 5);
    ponte(g, "#facc15", 5);
    [OE, OD].forEach((x) => {
      const f = () => estrela(g, x, OY + 2, 36, 0.55);
      f();
      g.fillStyle = "rgba(124,58,237,0.8)";
      g.fill();
      aroDuplo(g, f, "#facc15", 4);
      reflexo(g, x, OY);
    });
  },
  redondoDourado(g) {
    hastes(g, "#b88a1b", 3);
    [OE, OD].forEach((x) => {
      g.fillStyle = "rgba(255,255,255,0.14)";
      g.beginPath();
      g.arc(x, OY, 26, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#7a5a0c";
      g.lineWidth = 6;
      g.stroke();
      g.strokeStyle = "#e3b341";
      g.lineWidth = 3.5;
      g.stroke();
      reflexo(g, x, OY - 4, 0.45);
    });
    ponte(g, "#c9a227", 4, 12, OY - 6);
  },
  gatinho(g) {
    hastes(g, "#111", 5, OY - 12);
    [-1, 1].forEach((l) => {
      const x = l < 0 ? OE : OD;
      const f = () => {
        g.beginPath();
        g.moveTo(x - l * 30, OY - 12);
        g.quadraticCurveTo(x, OY - 22, x + l * 26, OY - 20);
        g.lineTo(x + l * 42, OY - 32);
        g.quadraticCurveTo(x + l * 40, OY + 6, x + l * 18, OY + 22);
        g.quadraticCurveTo(x - l * 6, OY + 30, x - l * 26, OY + 16);
        g.quadraticCurveTo(x - l * 34, OY + 2, x - l * 30, OY - 12);
        g.closePath();
      };
      f();
      g.fillStyle = "rgba(190,18,60,0.18)";
      g.fill();
      g.strokeStyle = "#111";
      g.lineWidth = 7;
      f();
      g.stroke();
      g.fillStyle = "#fde68a";
      g.beginPath();
      g.arc(x + l * 38, OY - 26, 3.5, 0, Math.PI * 2);
      g.fill();
      reflexo(g, x, OY - 2, 0.4);
    });
    ponte(g, "#111", 6, 8, OY - 10);
  },
  esportivo(g) {
    const f = () => {
      g.beginPath();
      g.moveTo(34, 84);
      g.quadraticCurveTo(128, 70, 222, 84);
      g.lineTo(220, 110);
      g.quadraticCurveTo(206, 136, 172, 132);
      g.quadraticCurveTo(140, 128, 128, 116);
      g.quadraticCurveTo(116, 128, 84, 132);
      g.quadraticCurveTo(50, 136, 36, 110);
      g.closePath();
    };
    const gr = g.createLinearGradient(34, 0, 222, 0);
    gr.addColorStop(0, "#f97316");
    gr.addColorStop(0.5, "#db2777");
    gr.addColorStop(1, "#7c3aed");
    f();
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = "#111";
    g.lineWidth = 4;
    g.stroke();
    g.strokeStyle = "#111";
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(34, 84);
    g.quadraticCurveTo(128, 70, 222, 84);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(54, 98);
    g.quadraticCurveTo(110, 88, 150, 92);
    g.stroke();
  },
  tresD(g) {
    hastes(g, "#e2e8f0", 6);
    [OE, OD].forEach((x, i) => {
      const f = () => {
        g.beginPath();
        g.roundRect(x - 34, OY - 22, 68, 44, 4);
      };
      f();
      g.fillStyle = i === 0 ? "rgba(239,68,68,0.82)" : "rgba(34,211,238,0.82)";
      g.fill();
      aroDuplo(g, f, "#f8fafc", 7);
      reflexo(g, x, OY - 2, 0.5);
    });
    g.strokeStyle = ESCURO;
    g.lineWidth = 11;
    g.beginPath();
    g.moveTo(OE + 36, OY - 6);
    g.lineTo(OD - 36, OY - 6);
    g.stroke();
    g.strokeStyle = "#f8fafc";
    g.lineWidth = 7;
    g.stroke();
  },
  monoculo(g) {
    g.strokeStyle = "#c9a227";
    g.lineWidth = 3;
    g.setLineDash([3, 4]);
    g.beginPath();
    g.moveTo(OD + 18, OY + 20);
    g.quadraticCurveTo(OD + 24, 190, 238, 214);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = "rgba(255,255,255,0.16)";
    g.beginPath();
    g.arc(OD, OY, 27, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#6b4f0a";
    g.lineWidth = 8;
    g.stroke();
    g.strokeStyle = "#e3b341";
    g.lineWidth = 5;
    g.stroke();
    reflexo(g, OD, OY - 4, 0.6);
  },
  nerd(g) {
    hastes(g, "#111", 6);
    [OE, OD].forEach((x) => {
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.beginPath();
      g.roundRect(x - 36, OY - 26, 72, 52, 8);
      g.fill();
      g.strokeStyle = "#111";
      g.lineWidth = 11;
      g.stroke();
      reflexo(g, x, OY - 2, 0.5);
    });
    g.strokeStyle = "#111";
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(OE + 36, OY - 4);
    g.lineTo(OD - 36, OY - 4);
    g.stroke();
    // Esparadrapo no meio: o óculos já quebrou uma vez.
    g.fillStyle = "#f8fafc";
    g.strokeStyle = "#94a3b8";
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(119, OY - 14, 18, 20, 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(123, OY - 10);
    g.lineTo(133, OY + 2);
    g.stroke();
  },
  espelhado(g) {
    hastes(g, "#94a3b8", 4);
    [OE, OD].forEach((x) => {
      const f = () => {
        g.beginPath();
        g.moveTo(x - 34, OY - 22);
        g.lineTo(x + 34, OY - 22);
        g.quadraticCurveTo(x + 38, OY + 34, x, OY + 30);
        g.quadraticCurveTo(x - 38, OY + 34, x - 34, OY - 22);
        g.closePath();
      };
      const gr = g.createLinearGradient(0, OY - 22, 0, OY + 30);
      gr.addColorStop(0, "#38bdf8");
      gr.addColorStop(0.5, "#a855f7");
      gr.addColorStop(1, "#f472b6");
      f();
      g.fillStyle = gr;
      g.fill();
      aroDuplo(g, f, "#e2e8f0", 3.5);
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.beginPath();
      g.moveTo(x - 26, OY - 16);
      g.lineTo(x - 8, OY - 16);
      g.lineTo(x - 24, OY + 6);
      g.closePath();
      g.fill();
    });
    ponte(g, "#e2e8f0", 4, 4, OY - 18);
  },
  pixel(g) {
    const u = 8;
    const bloco = (x: number, y: number, cor: string) => {
      g.fillStyle = cor;
      g.fillRect(x, y, u, u);
    };
    for (let x = 36; x < 220; x += u) bloco(x, 86, ESCURO);
    const linhas: [number, number, number][] = [
      [94, 44, 124],
      [102, 44, 124],
      [110, 52, 116],
      [118, 60, 108],
    ];
    linhas.forEach(([y, a, b]) => {
      for (let x = a; x < b; x += u) {
        bloco(x, y, ESCURO);
        bloco(256 - x - u, y, ESCURO);
      }
    });
    [
      [52, 94],
      [60, 102],
      [140, 94],
      [148, 102],
    ].forEach(([x, y]) => bloco(x!, y!, BRANCO));
  },
  protecao(g) {
    // Elástico atrás, de orelha a orelha.
    g.fillStyle = "#1f2937";
    g.fillRect(8, OY - 12, 240, 16);
    const f = () => {
      g.beginPath();
      g.moveTo(40, 82);
      g.quadraticCurveTo(128, 70, 216, 82);
      g.quadraticCurveTo(228, 104, 216, 126);
      g.quadraticCurveTo(172, 136, 146, 128);
      g.quadraticCurveTo(128, 114, 110, 128);
      g.quadraticCurveTo(84, 136, 40, 126);
      g.quadraticCurveTo(28, 104, 40, 82);
      g.closePath();
    };
    f();
    g.fillStyle = "rgba(186,230,253,0.42)";
    g.fill();
    aroDuplo(g, f, "#facc15", 7);
    // Respiros laterais da armação.
    g.fillStyle = ESCURO;
    [44, 206].forEach((x) =>
      [96, 106, 116].forEach((y) => {
        g.beginPath();
        g.arc(x + (x < 128 ? 0 : 6), y, 2.2, 0, Math.PI * 2);
        g.fill();
      }),
    );
    g.strokeStyle = "rgba(255,255,255,0.7)";
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(62, 92);
    g.quadraticCurveTo(100, 84, 128, 86);
    g.stroke();
  },
  viseira(g) {
    const f = () => {
      g.beginPath();
      g.moveTo(26, 84);
      g.quadraticCurveTo(128, 70, 230, 84);
      g.lineTo(230, 120);
      g.quadraticCurveTo(128, 134, 26, 120);
      g.closePath();
    };
    const gr = g.createLinearGradient(0, 76, 0, 128);
    gr.addColorStop(0, "rgba(14,165,233,0.92)");
    gr.addColorStop(1, "rgba(37,99,235,0.92)");
    f();
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = "#0f172a";
    g.lineWidth = 6;
    g.stroke();
    g.strokeStyle = "#cffafe";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(40, 101);
    g.quadraticCurveTo(128, 92, 216, 101);
    g.stroke();
    g.fillStyle = "#f0abfc";
    [52, 64].forEach((x) => {
      g.beginPath();
      g.arc(x, 113, 3, 0, Math.PI * 2);
      g.fill();
    });
  },
};

export function ehOculosExtra(oculos: string): boolean {
  return oculos in OCULOS;
}

/** Desenha um óculos do lote 2 (por cima de tudo no adesivo). */
export function desenharOculosExtra(g: G, oculos: string) {
  const f = OCULOS[oculos];
  if (!f) return;
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  f(g);
  g.restore();
}
