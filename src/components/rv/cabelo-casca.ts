import { Vector3 } from "three";
import type { AvatarConfig } from "@/lib/avatar-3d";
import type { PoseAvatar, Qualidade } from "@/components/rv/contexto-avatar";
import { V_INICIO } from "@/components/rv/cabelo-texturas";

/*
 * A base do cabelo novo (receita "casca + mechas em fita lente", validada no
 * laboratório): a CASCA é a superfície que veste o couro cabeludo — um offset
 * do SDF da cabeça — parametrizada por um CAMPO DE FLUXO (risca ou polo). As
 * linhas de u constante são a direção dos fios: a textura corre ao longo
 * delas e as mechas (cabelo-fita/cabelo-guia) nascem nelas.
 *
 * Aqui também mora o CORPO visto pelo cabelo (tronco, braços, capuz caído,
 * mochila e encosto da cadeira): o cabelo comprido desce por fora dele.
 *
 * Coordenadas: centro da cabeça na origem, +y para cima, +z para o rosto.
 */

export const PI = Math.PI;
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const faixa = ([a, b]: readonly [number, number], u: number) => a + (b - a) * u;
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Chapéus com aba larga em volta do corte: o cabelo que sai por baixo fica SOB a aba.
 * (16/10/2026: + as abas dos chapéus novos, medidas em `ABAS_NOVAS` de `cabelo-chapeu.ts`, e
 * "rente": gorro/boné/capacete justos dos novos — sem aba, mas o cabelo que renasce no corte
 * sai deitado por baixo da borda, em vez de espetar para fora acima dela.)
 */
export type TipoAba =
  | "chapeu"
  | "cartola"
  | "capacete"
  | "chapeuPalha"
  | "chapeuCowboy"
  | "sombrero"
  | "chapeuPescador"
  | "rente";

/** Tudo o que a malha do cabelo precisa saber do avatar (sem cor: a cor não muda a geometria). */
export type CtxCabelo = {
  t: number;
  d: number;
  troncoW: number;
  troncoD: number;
  bracoW: number;
  /** Altura do tronco: em pé, o cabelo desce no máximo até o quadril + 0,10. */
  troncoH: number;
  /** Relativos ao centro da cabeça: topoTroncoY = −(0,03 + t/2); ombroY = topoTroncoY − 0,06. */
  ombroY: number;
  topoTroncoY: number;
  /** Altura (rel. ao centro da cabeça) onde o chapéu corta o cabelo; null = sem chapéu que cubra. */
  corteChapeu: number | null;
  /** Chapéu de aba larga em volta do corte (o cabelo fica por baixo dela); null = sem aba. */
  aba: TipoAba | null;
  /** Moletom com capuz caído nas costas: o cabelo de trás passa por fora dele. */
  capuz: boolean;
  /** Colar/crachá/mochila na frente do peito: o cabelo pousa um pouco mais à frente. */
  acessorioFrente: boolean;
  /** Mochila nas costas (só em pé). */
  mochila: boolean;
  pose: PoseAvatar;
  qualidade: Qualidade;
  /** Face da frente do encosto da cadeira (z), em função do y relativo à cabeça; só sentado. */
  zEncosto: ((yCabeca: number) => number) | null;
  /** A MÁSCARA das mechas depende do modo; as cores não entram na geometria. */
  mechas: AvatarConfig["mechas"] | "raiz" | "ombre";
  /** Barba lenhador 3D: a franja/moldura não desce no meio do rosto abaixo do bigode. */
  barba3D: boolean;
};

/* ————————————————— A cabeça como SDF ————————————————— */

function sdCaixa(x: number, y: number, z: number, bx: number, by: number, bz: number, r: number) {
  const qx = Math.abs(x) - bx + r;
  const qy = Math.abs(y) - by + r;
  const qz = Math.abs(z) - bz + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/** A cabeça é o RoundedBox t × t × 0,92t, raio 0,1 (o mesmo do `Bloco`). */
export class CabecaSDF {
  readonly bx: number;
  readonly by: number;
  readonly bz: number;
  constructor(
    readonly t: number,
    readonly raio = 0.1,
  ) {
    this.bx = t / 2;
    this.by = t / 2;
    this.bz = (t * 0.92) / 2;
  }
  sdf(x: number, y: number, z: number) {
    return sdCaixa(x, y, z, this.bx, this.by, this.bz, Math.min(this.raio, this.bz - 0.001));
  }
  /** Distância de `o` (dentro) ao longo de `dir` até a iso-superfície sdf = off. */
  alcance(o: Vector3, dir: Vector3, off: number): number {
    // a cabeça cabe numa esfera de raio ~0,9t: 15 bisseções dão precisão < 0,05 mm
    let lo = 0;
    let hi = this.t * 0.9 + Math.max(0, off) + 0.05;
    for (let i = 0; i < 15; i++) {
      const m = (lo + hi) / 2;
      if (this.sdf(o.x + dir.x * m, o.y + dir.y * m, o.z + dir.z * m) < off) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  }
}

/* ————————————————— O corpo do avatar, visto pelo cabelo ————————————————— */

/**
 * Caixa arredondada do corpo como o Avatar3D/roupa a monta: um grupo com
 * pivô `p` e giro só em x (braço sentado, −1,2 rad) ou só em z (braço em pé,
 * ±0,06), e a caixa (centro `c`, meias medidas `h`, raio `r`) dentro dele.
 */
type Caixa = {
  px: number;
  py: number;
  pz: number;
  /** cos/sen do giro em x (sentado) — sa = 0 quando não gira. */
  ca: number;
  sa: number;
  /** cos/sen do giro em z (braço em pé). */
  cb: number;
  sb: number;
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  r: number;
};

function caixa(
  p: [number, number, number],
  h: [number, number, number],
  r: number,
  o: { c?: [number, number, number]; giroX?: number; giroZ?: number } = {},
): Caixa {
  const gx = o.giroX ?? 0;
  const gz = o.giroZ ?? 0;
  const c = o.c ?? [0, 0, 0];
  return {
    px: p[0],
    py: p[1],
    pz: p[2],
    ca: Math.cos(gx),
    sa: Math.sin(gx),
    cb: Math.cos(gz),
    sb: Math.sin(gz),
    cx: c[0],
    cy: c[1],
    cz: c[2],
    hx: h[0],
    hy: h[1],
    hz: h[2],
    r,
  };
}

/** Ponto → referencial da caixa (local = giro⁻¹·(ponto − pivô)). */
function paraCaixa(b: Caixa, x: number, y: number, z: number, out: Vector3): Vector3 {
  const X = x - b.px;
  const Y = y - b.py;
  const Z = z - b.pz;
  if (b.sa !== 0) return out.set(X, Y * b.ca + Z * b.sa, -Y * b.sa + Z * b.ca);
  if (b.sb !== 0) return out.set(X * b.cb + Y * b.sb, -X * b.sb + Y * b.cb, Z);
  return out.set(X, Y, Z);
}

const _l = new Vector3();
function sdDaCaixa(b: Caixa, x: number, y: number, z: number) {
  paraCaixa(b, x, y, z, _l);
  return sdCaixa(_l.x - b.cx, _l.y - b.cy, _l.z - b.cz, b.hx, b.hy, b.hz, b.r);
}

/** Reta p0 + t·d (no plano) recortada pelo retângulo [ya, yb] × [za, zb]: trecho de t ou null. */
function cortaRet(
  p0y: number,
  p0z: number,
  dy: number,
  dz: number,
  ya: number,
  yb: number,
  za: number,
  zb: number,
): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  if (Math.abs(dy) < 1e-9) {
    if (p0y < ya || p0y > yb) return null;
  } else {
    const a = (ya - p0y) / dy;
    const b = (yb - p0y) / dy;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (Math.abs(dz) < 1e-9) {
    if (p0z < za || p0z > zb) return null;
  } else {
    const a = (za - p0z) / dz;
    const b = (zb - p0z) / dz;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/** Reta p0 + t·d (|d| = 1) dentro do círculo (cy, cz, r): trecho de t ou null. */
function cortaCirc(
  p0y: number,
  p0z: number,
  dy: number,
  dz: number,
  cy: number,
  cz: number,
  r: number,
): [number, number] | null {
  const oy = p0y - cy;
  const oz = p0z - cz;
  const b = dy * oy + dz * oz;
  const disc = b * b - (oy * oy + oz * oz - r * r);
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

/**
 * Trecho de z em que a reta horizontal (x, y, ·) passa a menos de `folga` da
 * caixa (o offset da caixa arredondada). null = passa longe.
 */
function trechoNaCaixa(b: Caixa, x: number, y: number, folga: number): [number, number] | null {
  const X = x - b.px;
  const Y = y - b.py;
  const r = b.r + folga;
  if (b.sa === 0) {
    // sem giro em x: (x, y) locais ficam fixos e z local = Z
    const xl = b.sb !== 0 ? X * b.cb + Y * b.sb : X;
    const yl = b.sb !== 0 ? -X * b.sb + Y * b.cb : Y;
    const ex = Math.max(0, Math.abs(xl - b.cx) - (b.hx - b.r));
    const ey = Math.max(0, Math.abs(yl - b.cy) - (b.hy - b.r));
    const e2 = ex * ex + ey * ey;
    if (e2 >= r * r) return null;
    const meia = b.hz - b.r + Math.sqrt(r * r - e2);
    return [b.pz + b.cz - meia, b.pz + b.cz + meia];
  }
  // giro em x: no plano (y local, z local) a reta é p0 + Z·d, com Z = z − pz
  const ex = Math.max(0, Math.abs(X - b.cx) - (b.hx - b.r));
  if (ex >= r) return null;
  const rr = Math.sqrt(r * r - ex * ex);
  const p0y = Y * b.ca;
  const p0z = -Y * b.sa;
  const ya = b.cy - (b.hy - b.r);
  const yb = b.cy + (b.hy - b.r);
  const za = b.cz - (b.hz - b.r);
  const zb = b.cz + (b.hz - b.r);
  let t0 = Infinity;
  let t1 = -Infinity;
  const junta = (s: [number, number] | null) => {
    if (!s) return;
    t0 = Math.min(t0, s[0]);
    t1 = Math.max(t1, s[1]);
  };
  junta(cortaRet(p0y, p0z, b.sa, b.ca, ya - rr, yb + rr, za, zb));
  junta(cortaRet(p0y, p0z, b.sa, b.ca, ya, yb, za - rr, zb + rr));
  for (const cy of [ya, yb])
    for (const cz of [za, zb]) junta(cortaCirc(p0y, p0z, b.sa, b.ca, cy, cz, rr));
  return t0 <= t1 ? [b.pz + t0, b.pz + t1] : null;
}

/** Elipsoide alinhado aos eixos (pedaço do capuz caído). */
type Elipsoide = { cx: number; cy: number; cz: number; ax: number; ay: number; az: number };

function trechoNoElipsoide(e: Elipsoide, x: number, y: number, folga: number) {
  const ax = e.ax + folga;
  const ay = e.ay + folga;
  const u = ((x - e.cx) / ax) ** 2 + ((y - e.cy) / ay) ** 2;
  if (u >= 1) return null;
  const m = (e.az + folga) * Math.sqrt(1 - u);
  return [e.cz - m, e.cz + m] as [number, number];
}

/**
 * Folgas da LINHA CENTRAL da mecha de trás a cada parte do corpo (contrato:
 * costas entre tD + 0,035 e tD + 0,06). A fita tem barriga de ~0,35h para
 * dentro: a superfície de dentro fica ~7 mm mais perto que a linha central.
 */
const FOLGA_TRAS = { tronco: 0.042, braco: 0.036, capuz: 0.034, mochila: 0.03 };
/** Folgas da mecha da FRENTE (contrato: peito ≥ tD + 0,05; com colar/crachá ≥ tD + 0,07). */
const FOLGA_FRENTE = { braco: 0.03, capuz: 0.02 };
/**
 * Encosto (sentado): a linha central fica 4 cm à frente da face do encosto — a
 * fita tem até ~3 cm de espessura para fora (as costas dela olham para a
 * cadeira). No baixinho isso enterra metade da fita na cabeça: escondido.
 */
export const FOLGA_ENCOSTO = 0.04;

/**
 * O corpo do avatar no referencial da cabeça, com as MESMAS medidas do
 * Avatar3D e do esqueleto da roupa (tronco raio 0,06; braço = manga larga com
 * pivô no ombro, sentado girado −1,2 rad em x, que levanta o canto do ombro
 * até ~topo + 0,085; mochila da altura real dela, não só "abaixo de topo −
 * 0,30"; capuz caído = toro de 1,5 volta inclinado, aqui como elipsoides ao
 * longo do arco; encosto da cadeira da sala). Nada é importado da roupa: são
 * as medidas do corpo, conferidas nos renders.
 */
export class CorpoCabelo {
  readonly tronco: Caixa;
  readonly bracos: Caixa[];
  readonly mochila: Caixa | null;
  readonly capuz: Elipsoide[];
  private readonly capuzLim: { x: number; y0: number; y1: number } | null;
  /** Encosto (sentado): faixa de y (rel. à cabeça) e meia-largura em x. */
  private readonly enc: { y0: number; y1: number; meiaX: number } | null;
  /** Acima disto o corpo está longe (atalho do SDF). */
  readonly yAlto: number;
  constructor(readonly c: CtxCabelo) {
    const W = c.troncoW;
    const H = c.troncoH;
    const D = c.troncoD;
    const topo = c.topoTroncoY;
    const quadril = topo - H;
    const sentado = c.pose === "sentado";
    // Raios de canto MENORES que os do modelo (0,06 tronco, 0,05 braço e mochila): perto das
    // quinas o cabelo guarda folga até da quina "reta" — a fita tem largura e barriga.
    this.tronco = caixa([0, quadril + H / 2, 0], [W / 2, H / 2, D / 2], 0.03);
    const comp = H + 0.02;
    this.bracos = [-1, 1].map((l) =>
      caixa(
        [l * (W / 2 + c.bracoW / 2 + 0.01), c.ombroY, 0],
        [(c.bracoW + 0.01) / 2, comp / 2, (c.bracoW + 0.025) / 2],
        0.03,
        sentado
          ? { c: [0, -comp / 2 + 0.06, 0], giroX: -1.2 }
          : { c: [0, -comp / 2 + 0.06, 0], giroZ: 0.06 * l },
      ),
    );
    // A mochila: da frente mais justa (folga 0,01) ao fundo em tD + 0,16, do quadril + 0,1·H
    // ao quadril + 0,9·H (o topo dela fica ~6 cm abaixo do alto do tronco).
    this.mochila =
      c.mochila && !sentado
        ? caixa(
            [0, quadril + H * 0.5, -(D / 2 + 0.085)],
            [(W * 0.75) / 2, (H * 0.8) / 2, 0.075],
            0.025,
          )
        : null;
    // Capuz caído: toro R 0,135 / tubo 0,064 / arco 1,5π, girado (−π/2 + 0,5; 0; −π/4) e
    // escalado nos eixos do mundo — cada esfera do tubo vira um elipsoide.
    this.capuz = [];
    this.capuzLim = null;
    if (c.capuz) {
      const larg = 0.6 + 0.4 * (W / 0.56);
      const S = [1.28 * larg, 0.68, sentado ? 0.98 : 1.04];
      const T = [0, topo - 0.032, -0.028 + (0.3 - D) * 0.2];
      const R = 0.135;
      const tubo = 0.064 + 0.004;
      const ax = -PI / 2 + 0.5;
      const cxr = Math.cos(ax);
      const sxr = Math.sin(ax);
      let xm = 0;
      let y0 = Infinity;
      let y1 = -Infinity;
      const n = 18;
      for (let i = 0; i <= n; i++) {
        const f = (i / n) * 1.5 * PI - PI / 4;
        const lx = R * Math.cos(f);
        const ly = R * Math.sin(f);
        const e: Elipsoide = {
          cx: T[0]! + S[0]! * lx,
          cy: T[1]! + S[1]! * (ly * cxr),
          cz: T[2]! + S[2]! * (ly * sxr),
          ax: tubo * S[0]!,
          ay: tubo * S[1]!,
          az: tubo * S[2]!,
        };
        this.capuz.push(e);
        xm = Math.max(xm, Math.abs(e.cx) + e.ax);
        y0 = Math.min(y0, e.cy - e.ay);
        y1 = Math.max(y1, e.cy + e.ay);
      }
      this.capuzLim = { x: xm + 0.05, y0: y0 - 0.05, y1: y1 + 0.05 };
    }
    // Encosto da sala (caixa 0,5 × 0,7 × 0,06 em y 0,85, giro −0,12): face da frente de
    // y mundo ≈ 0,50 a 1,20; aqui em y relativo à cabeça.
    const cabecaYMundo = 0.52 + H + 0.03 + c.t / 2;
    this.enc =
      sentado && c.zEncosto
        ? { y0: 0.5 - cabecaYMundo, y1: 1.2 - cabecaYMundo, meiaX: 0.25 }
        : null;
    // o canto do ombro sentado sobe até ~topo + 0,085 (+ raio): folga generosa
    this.yAlto = topo + 0.2;
  }

  /** Distância (com sinal) ao tronco e aos braços: dá o "para fora" perto do corpo. */
  sd(x: number, y: number, z: number): number {
    if (y > this.yAlto) return 1;
    let d = sdDaCaixa(this.tronco, x, y, z);
    for (const b of this.bracos) d = Math.min(d, sdDaCaixa(b, x, y, z));
    return d;
  }

  /**
   * A mesma distância com a UNIÃO SUAVE (raio 6 cm) entre tronco e braços:
   * costas, ombros e braços viram uma superfície só, sem quina de gradiente
   * na emenda — é ela que orienta a fita que desce pelo corpo.
   */
  sdSuave(x: number, y: number, z: number): number {
    const k = 0.06;
    let s = Math.exp(-sdDaCaixa(this.tronco, x, y, z) / k);
    for (const b of this.bracos) s += Math.exp(-sdDaCaixa(b, x, y, z) / k);
    return -k * Math.log(Math.max(s, 1e-30));
  }

  /**
   * Rede de segurança, vértice a vértice, depois das guias: o que ainda ficou
   * dentro do corpo — a borda de uma fita larga numa quina, a barriga dela no
   * encosto do baixinho — sai pela face mais próxima (caixas RETAS, sem o
   * arredondado: vale também para a quina) ou para a frente do encosto. As
   * guias já fazem quase tudo; aqui são milímetros.
   */
  expulsar(p: Vector3, margem: number) {
    if (p.y > this.yAlto + 0.06) return;
    for (const b of [this.tronco, ...this.bracos, this.mochila]) {
      if (!b) continue;
      paraCaixa(b, p.x, p.y, p.z, _l);
      const lx = _l.x - b.cx;
      const ly = _l.y - b.cy;
      const lz = _l.z - b.cz;
      const dx = b.hx + margem - Math.abs(lx);
      const dy = b.hy + margem - Math.abs(ly);
      const dz = b.hz + margem - Math.abs(lz);
      if (dx <= 0 || dy <= 0 || dz <= 0) continue;
      let nx = lx;
      let ny = ly;
      let nz = lz;
      if (dz <= dx && dz <= dy) nz = (Math.sign(lz) || -1) * (b.hz + margem);
      else if (dx <= dy) nx = (Math.sign(lx) || 1) * (b.hx + margem);
      else ny = (Math.sign(ly) || 1) * (b.hy + margem);
      // de volta ao mundo: (local + centro), girado, + pivô
      const X = nx + b.cx;
      const Y = ny + b.cy;
      const Z = nz + b.cz;
      if (b.sa !== 0) p.set(b.px + X, b.py + Y * b.ca - Z * b.sa, b.pz + Y * b.sa + Z * b.ca);
      else if (b.sb !== 0) p.set(b.px + X * b.cb - Y * b.sb, b.py + X * b.sb + Y * b.cb, b.pz + Z);
      else p.set(b.px + X, b.py + Y, b.pz + Z);
    }
    const L = this.capuzLim;
    if (L && Math.abs(p.x) < L.x && p.y > L.y0 && p.y < L.y1) {
      for (let it = 0; it < 2; it++)
        for (const e of this.capuz) {
          const qx = (p.x - e.cx) / (e.ax + margem);
          const qy = (p.y - e.cy) / (e.ay + margem);
          const qz = (p.z - e.cz) / (e.az + margem);
          const u = Math.sqrt(qx * qx + qy * qy + qz * qz);
          if (u >= 1 || u < 1e-6) continue;
          p.set(
            e.cx + (qx / u) * (e.ax + margem),
            e.cy + (qy / u) * (e.ay + margem),
            e.cz + (qz / u) * (e.az + margem),
          );
        }
    }
    const E = this.enc;
    const c = this.c;
    if (E && c.zEncosto && Math.abs(p.x) < E.meiaX + margem && p.y > E.y0 && p.y < E.y1) {
      // (a face do encosto ganha o dobro: a fita encostada não pode "beijar" a cadeira)
      const z = c.zEncosto(p.y) + 2 * margem;
      if (p.z < z) p.z = z;
    }
  }

  /**
   * Os limites crus na reta horizontal (x, y): até onde a mecha de TRÁS pode
   * chegar (z máximo; +1 = nada atrás) e a da FRENTE (z mínimo; −1 = nada na
   * frente), e o z mínimo imposto pelo encosto (−1 = sem encosto).
   */
  limites(x: number, y: number, out: { tras: number; frente: number; enc: number }) {
    const c = this.c;
    let tras = 1;
    let frente = -1;
    const t = trechoNaCaixa(this.tronco, x, y, FOLGA_TRAS.tronco);
    if (t) tras = Math.min(tras, t[0]);
    const tf = trechoNaCaixa(this.tronco, x, y, c.acessorioFrente ? 0.07 : 0.05);
    if (tf) frente = Math.max(frente, tf[1]);
    for (const b of this.bracos) {
      const s = trechoNaCaixa(b, x, y, FOLGA_TRAS.braco);
      if (s) tras = Math.min(tras, s[0]);
      // sentado o braço vai para a frente: a mecha da frente nunca passa por cima dele (a faixa
      // de x da frente já a mantém sobre o peito)
      if (c.pose !== "sentado") {
        const sf = trechoNaCaixa(b, x, y, FOLGA_FRENTE.braco);
        if (sf) frente = Math.max(frente, sf[1]);
      }
    }
    if (this.mochila) {
      const s = trechoNaCaixa(this.mochila, x, y, FOLGA_TRAS.mochila);
      if (s) tras = Math.min(tras, s[0]);
    }
    const L = this.capuzLim;
    if (L && Math.abs(x) < L.x && y > L.y0 && y < L.y1) {
      for (const e of this.capuz) {
        const s = trechoNoElipsoide(e, x, y, FOLGA_TRAS.capuz);
        if (s) tras = Math.min(tras, s[0]);
        const sf = trechoNoElipsoide(e, x, y, FOLGA_FRENTE.capuz);
        if (sf) frente = Math.max(frente, sf[1]);
      }
    }
    let enc = -1;
    const E = this.enc;
    if (E && c.zEncosto && Math.abs(x) < E.meiaX + 0.03 && y > E.y0 - 0.02 && y < E.y1 + 0.02)
      enc = c.zEncosto(y) + FOLGA_ENCOSTO;
    out.tras = tras;
    out.frente = frente;
    out.enc = enc;
  }
}

/* ————————————————— Envelope: os limites suavizados numa grade ————————————————— */

const EX0 = -0.75;
const EDX = 0.025;
const ENX = 61;
const EDY = 0.01;
/**
 * Inclinação máxima (dz/dy) com que o cabelo se afasta ANTES de chegar num
 * obstáculo: 1,1 ≈ 48° da vertical — a mecha começa a desviar ~15 cm antes do
 * ombro, sem quina.
 */
const ANTECIPA = 1.1;
/** Quanto abaixo a mecha "enxerga" o obstáculo que vem. */
const ALCANCE = 0.3;

/**
 * Meia largura (m) que a fita ocupa para cada lado da linha central: o limite
 * de uma coluna vale o pior das colunas vizinhas nesse raio — a borda da fita
 * passa onde o capuz/a mochila/o braço é mais fundo que no meio dela.
 */
const LARGURA_FITA = 0.075;

/**
 * Os limites do corpo numa grade (x, y), já "alargados" pela fita e
 * "antecipados": a mecha começa a se afastar antes de chegar no ombro, no
 * capuz ou na mochila, numa rampa de inclinação limitada — em vez de um salto
 * (que virava quina e dobra). Colunas calculadas só quando alguma mecha passa.
 */
export class Envelope {
  readonly y0: number;
  readonly ny: number;
  private readonly tras: Float32Array;
  private readonly frente: Float32Array;
  private readonly enc: Float32Array;
  private readonly feitas = new Uint8Array(ENX);
  /** Limites crus por coluna (antes de alargar e antecipar). */
  private readonly crus: ({ tr: Float32Array; fr: Float32Array; en: Float32Array } | null)[] =
    new Array(ENX).fill(null);
  constructor(
    readonly corpo: CorpoCabelo,
    yBaixo: number,
    yAlto: number,
  ) {
    this.y0 = yBaixo;
    this.ny = Math.max(2, Math.ceil((yAlto - yBaixo) / EDY) + 1);
    this.tras = new Float32Array(ENX * this.ny);
    this.frente = new Float32Array(ENX * this.ny);
    this.enc = new Float32Array(ENX * this.ny);
  }
  private cru(i: number) {
    const pronto = this.crus[i];
    if (pronto) return pronto;
    const x = EX0 + i * EDX;
    const n = this.ny;
    const c = { tr: new Float32Array(n), fr: new Float32Array(n), en: new Float32Array(n) };
    const o = { tras: 1, frente: -1, enc: -1 };
    for (let j = 0; j < n; j++) {
      this.corpo.limites(x, this.y0 + j * EDY, o);
      c.tr[j] = o.tras;
      c.fr[j] = o.frente;
      c.en[j] = o.enc;
    }
    this.crus[i] = c;
    return c;
  }
  private coluna(i: number) {
    if (this.feitas[i]) return;
    this.feitas[i] = 1;
    const n = this.ny;
    const tr = new Float32Array(n).fill(1);
    const fr = new Float32Array(n).fill(-1);
    const en = new Float32Array(n).fill(-1);
    const R = Math.round(LARGURA_FITA / EDX);
    for (let q = Math.max(0, i - R); q <= Math.min(ENX - 1, i + R); q++) {
      const c = this.cru(q);
      for (let j = 0; j < n; j++) {
        if (c.tr[j]! < tr[j]!) tr[j] = c.tr[j]!;
        if (c.fr[j]! > fr[j]!) fr[j] = c.fr[j]!;
        if (c.en[j]! > en[j]!) en[j] = c.en[j]!;
      }
    }
    const alc = Math.round(ALCANCE / EDY);
    const base = i * n;
    for (let j = 0; j < n; j++) {
      let a = tr[j]!;
      let b = fr[j]!;
      let e = en[j]!;
      for (let q = 1; q <= alc && j - q >= 0; q++) {
        const s = ANTECIPA * q * EDY;
        a = Math.min(a, tr[j - q]! + s);
        b = Math.max(b, fr[j - q]! - s);
        e = Math.max(e, en[j - q]! - s);
      }
      this.tras[base + j] = a;
      this.frente[base + j] = b;
      this.enc[base + j] = e;
    }
  }
  private ler(arr: Float32Array, x: number, y: number) {
    const fi = Math.max(0, Math.min(ENX - 1.001, (x - EX0) / EDX));
    const fj = Math.max(0, Math.min(this.ny - 1.001, (y - this.y0) / EDY));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;
    this.coluna(i);
    this.coluna(i + 1);
    const n = this.ny;
    const a = arr[i * n + j]!;
    const b = arr[(i + 1) * n + j]!;
    const c = arr[i * n + j + 1]!;
    const d = arr[(i + 1) * n + j + 1]!;
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  /** z máximo da mecha de trás em (x, y) (+1 = livre). */
  limTras(x: number, y: number) {
    return this.ler(this.tras, x, y);
  }
  /** z mínimo da mecha da frente em (x, y) (−1 = livre). */
  limFrente(x: number, y: number) {
    return this.ler(this.frente, x, y);
  }
  /** z mínimo por causa do encosto (−1 = sem encosto). */
  limEncosto(x: number, y: number) {
    return this.ler(this.enc, x, y);
  }
}

/**
 * Envelopes prontos por corpo × pose × roupa/acessório: os 10 avatares da sala
 * com o mesmo corpo dividem a mesma grade (só depende do corpo, não do penteado).
 */
const ENVELOPES = new Map<string, Envelope>();

function chaveDoCorpo(c: CtxCabelo) {
  return [
    c.t,
    c.troncoW,
    c.troncoD,
    c.troncoH,
    c.bracoW,
    c.pose,
    +c.capuz,
    +c.mochila,
    +c.acessorioFrente,
  ].join("|");
}

/** Altura mínima (rel. à cabeça) até onde o cabelo solto desce. */
export function yMinimo(c: CtxCabelo) {
  return c.pose === "sentado" ? c.topoTroncoY - 0.55 : c.topoTroncoY - c.troncoH + 0.1;
}

/** O envelope do corpo da obra (criado na primeira mecha que chega perto do corpo). */
export function envelope(k: Obra): Envelope {
  if (k.env) return k.env;
  const c = k.ctx;
  const chave = chaveDoCorpo(c);
  let e = ENVELOPES.get(chave);
  if (!e) {
    e = new Envelope(k.corpo, yMinimo(c) - 0.06, c.topoTroncoY + 0.45);
    if (ENVELOPES.size > 24) ENVELOPES.clear();
    ENVELOPES.set(chave, e);
  }
  k.env = e;
  return e;
}

/** O estado de uma construção (um penteado, uma vez). */
export type Obra = {
  ctx: CtxCabelo;
  cab: CabecaSDF;
  /** O corpo visto pelo cabelo. */
  corpo: CorpoCabelo;
  /** Os limites do corpo em grade (criado na primeira mecha que desce até o corpo). */
  env: Envelope | null;
  /**
   * A face de BAIXO da aba do chapéu no ponto (x, z) — o cabelo não passa
   * dela; null fora da aba (ou sem chapéu de aba).
   */
  aba: ((x: number, z: number) => number | null) | null;
  t: number;
  d: number;
  /** Altura do corte do chapéu (rel. ao centro), ou null. */
  corte: number | null;
  r: () => number;
  /** Cache das corridas (linha u → trecho de psi no couro), separado casca × mechas. */
  corridas: Map<number, [number, number] | null>;
  alta: boolean;
  /** Superdimensionamento dos estilos fofos (C2.9): multiplica folga e bojo. */
  inflar: number;
  /** Contador de fitas: alterna o offset radial anti z-fighting e o lado da separação das pontas. */
  nFita: number;
  /**
   * Enfeites coloridos do penteado (elástico das tranças, flor): uma malha à
   * parte por cor, pintada com ela em vez da cor do cabelo. Chave "" = a cor
   * de destaque da roupa; "cor1|cor2" = cores fixas (cor2 onde a máscara é 1).
   */
  enfeites?: Map<string, Malha>;
};

/** O corpo (tronco + braços), como SDF: dá o "para fora" das mechas que encostam nele. */
export function sdCorpo(k: Obra, x: number, y: number, z: number) {
  return k.corpo.sd(x, y, z);
}

function sdTudo(k: Obra, x: number, y: number, z: number) {
  return Math.min(k.cab.sdf(x, y, z), sdCorpo(k, x, y, z));
}

const _g = new Vector3();
/** Normal "para fora" da cabeça/corpo (gradiente do SDF). */
export function fora(k: Obra, p: Vector3, out: Vector3): Vector3 {
  if (p.y > k.corpo.yAlto + 0.02) return foraDaCabeca(k, p, out);
  const e = 1e-3;
  out.set(
    sdTudo(k, p.x + e, p.y, p.z) - sdTudo(k, p.x - e, p.y, p.z),
    sdTudo(k, p.x, p.y + e, p.z) - sdTudo(k, p.x, p.y - e, p.z),
    sdTudo(k, p.x, p.y, p.z + e) - sdTudo(k, p.x, p.y, p.z - e),
  );
  if (out.lengthSq() < 1e-12) out.set(0, 1, 0);
  return out.normalize();
}

/** Normal "para fora" só da cabeça. */
export function foraDaCabeca(k: Obra, p: Vector3, out: Vector3): Vector3 {
  const e = 1e-3;
  const s = k.cab;
  out.set(
    s.sdf(p.x + e, p.y, p.z) - s.sdf(p.x - e, p.y, p.z),
    s.sdf(p.x, p.y + e, p.z) - s.sdf(p.x, p.y - e, p.z),
    s.sdf(p.x, p.y, p.z + e) - s.sdf(p.x, p.y, p.z - e),
  );
  if (out.lengthSq() < 1e-12) out.set(0, 1, 0);
  return out.normalize();
}

const _h = new Vector3();
/**
 * O "para fora" que orienta a FITA (o quadro da mecha): perto da cabeça, a
 * normal da cabeça; descendo pelo corpo, a normal da superfície SUAVE de
 * costas + ombros + braços (sentado, a face de cima do braço girado). Assim
 * a cortina deita nas costas, no alto do ombro e atrás do braço sem virar a
 * fita de cutelo — com a normal crua da união, a quina do ombro e a emenda
 * tronco/braço giravam a fita de lado e a borda dela entrava no corpo.
 */
export function foraDaMecha(k: Obra, p: Vector3, out: Vector3): Vector3 {
  // a fita gira (de "deitada no lado da cabeça" para "deitada no corpo") no espaço livre
  // ao lado do queixo, ANTES do ombro. Sentado o canto do ombro sobe até ~topo + 0,085: o
  // giro acontece mais alto.
  const c = k.ctx;
  const yb = -k.t / 2;
  const yOmbro = c.topoTroncoY + (c.pose === "sentado" ? 0.085 : 0);
  const s = sstep(Math.max(yb + 0.1, yOmbro + 0.13), Math.max(yb - 0.01, yOmbro + 0.035), p.y);
  if (s <= 0) return foraDaCabeca(k, p, out);
  const e = 2e-3;
  const cp = k.corpo;
  _h.set(
    cp.sdSuave(p.x + e, p.y, p.z) - cp.sdSuave(p.x - e, p.y, p.z),
    cp.sdSuave(p.x, p.y + e, p.z) - cp.sdSuave(p.x, p.y - e, p.z),
    cp.sdSuave(p.x, p.y, p.z + e) - cp.sdSuave(p.x, p.y, p.z - e),
  );
  if (_h.lengthSq() < 1e-14) _h.set(0, 0, p.z > 0 ? 1 : -1);
  _h.normalize();
  if (s >= 1) return out.copy(_h);
  foraDaCabeca(k, p, out);
  return out.lerp(_h, s).normalize();
}

/** Empurra o ponto para fora da cabeça e do corpo até ficar a `margem` da pele. */
export function empurrar(k: Obra, p: Vector3, margemCabeca: number, margemCorpo: number) {
  for (let i = 0; i < 4; i++) {
    const sc = k.cab.sdf(p.x, p.y, p.z);
    if (sc < margemCabeca) {
      fora(k, p, _g);
      p.addScaledVector(_g, margemCabeca - sc);
      continue;
    }
    const sb = sdCorpo(k, p.x, p.y, p.z);
    if (sb < margemCorpo) {
      fora(k, p, _g);
      p.addScaledVector(_g, margemCorpo - sb);
      continue;
    }
    break;
  }
}

/** Empurra para fora só da cabeça (o corpo, quem cuida é o envelope). */
export function empurrarDaCabeca(k: Obra, p: Vector3, margem: number) {
  for (let i = 0; i < 4; i++) {
    const sc = k.cab.sdf(p.x, p.y, p.z);
    if (sc >= margem) break;
    foraDaCabeca(k, p, _g);
    p.addScaledVector(_g, margem - sc);
  }
}

/**
 * Empurra para fora da cabeça só no plano horizontal (a mecha que já desce
 * pelo corpo nunca é jogada para cima: isso é o que fazia a "mola" no ombro).
 */
export function empurrarDaCabecaNoPlano(k: Obra, p: Vector3, margem: number) {
  for (let i = 0; i < 4; i++) {
    const sc = k.cab.sdf(p.x, p.y, p.z);
    if (sc >= margem) break;
    foraDaCabeca(k, p, _g);
    _g.y = 0;
    const l = _g.length();
    if (l < 0.2) break;
    p.addScaledVector(_g, (margem - sc) / l);
  }
}

/* ————————————————— Campo de fluxo ————————————————— */

/**
 * - "risca": risca em x = `x`, de zFrente a zCoroa. Dos lados os fios descem
 *   em planos de z constante (paralelos, como cabelo de verdade); na frente e
 *   atrás abrem em leque em volta das pontas da risca.
 * - "polo": todos os fios saem de um ponto (redemoinho, rabo, coque).
 * Nos dois, u ∈ [0,1) dá a volta: 0 = nuca, 0,25 = +x, 0,5 = frente, 0,75 = −x.
 */
export type Fluxo =
  | { tipo: "risca"; x?: number; zFrente?: number; zCoroa?: number }
  | { tipo: "polo"; dir: [number, number, number] };

export class Campo {
  readonly total: number;
  readonly zF: number;
  readonly zC: number;
  private readonly segs: { len: number; f: (s: number, o: Vector3, h: Vector3) => void }[] = [];
  private readonly P = new Vector3();
  /** Base do polo: Ef = "frente" (ou alto) e Ed = direita, ambos ⊥ P. */
  private readonly Ef = new Vector3();
  private readonly Ed = new Vector3();
  private readonly y0 = -0.03;
  constructor(
    k: Obra,
    readonly f: Fluxo,
  ) {
    this.zF = f.tipo === "risca" ? (f.zFrente ?? k.d / 2 - 0.03) : 0;
    this.zC = f.tipo === "risca" ? (f.zCoroa ?? -k.d * 0.12) : 0;
    if (f.tipo === "risca") {
      const x = f.x ?? 0;
      const zF = this.zF;
      const zC = this.zC;
      const rho = k.t * 0.36;
      const y0 = this.y0;
      const cap = (z: number, a0: number, a1: number) => ({
        len: Math.abs(a1 - a0) * rho,
        f: (s: number, o: Vector3, h: Vector3) => {
          const a = lerp(a0, a1, s);
          o.set(x, y0, z);
          h.set(Math.sin(a), 0, Math.cos(a));
        },
      });
      const lado = (z0: number, z1: number, hx: number) => ({
        len: Math.abs(z1 - z0),
        f: (s: number, o: Vector3, h: Vector3) => {
          o.set(x, y0, lerp(z0, z1, s));
          h.set(hx, 0, 0);
        },
      });
      this.segs.push(
        cap(zC, PI, PI / 2),
        lado(zC, zF, 1),
        cap(zF, PI / 2, -PI / 2),
        lado(zF, zC, -1),
        cap(zC, -PI / 2, -PI),
      );
    } else {
      // Ef = projeção de ẑ ⟂ P (se degenerar, ŷ): nunca o azimute horizontal, que degenera no polo.
      this.P.set(...f.dir).normalize();
      const P = this.P;
      this.Ef.set(0, 0, 1).addScaledVector(P, -P.z);
      if (this.Ef.length() < 0.3) this.Ef.set(0, 1, 0).addScaledVector(P, -P.y);
      this.Ef.normalize();
      this.Ed.crossVectors(P, this.Ef).normalize();
    }
    this.total =
      f.tipo === "risca" ? this.segs.reduce((a, s) => a + s.len, 0) : 2 * PI * k.t * 0.36;
  }

  /** Onde começa (u) e acaba cada trecho da risca: [fim da coroa +x, fim do lado +x, fim da frente, fim do lado −x]. */
  get marcosDaRisca(): number[] {
    let s = 0;
    const out: number[] = [];
    for (let i = 0; i < this.segs.length - 1; i++) {
      s += this.segs[i]!.len;
      out.push(s / this.total);
    }
    return out;
  }

  /** Origem do raio e direção no ângulo psi (0 = na risca/polo) da linha u. */
  raio(u: number, psi: number, o: Vector3, dir: Vector3): void {
    u = ((u % 1) + 1) % 1;
    if (this.f.tipo === "risca") {
      let s = u * this.total;
      let i = 0;
      while (i < this.segs.length - 1 && s > this.segs[i]!.len) s -= this.segs[i++]!.len;
      const seg = this.segs[i]!;
      seg.f(Math.min(1, s / seg.len), o, dir);
      const hx = dir.x;
      const hz = dir.z;
      dir.set(Math.sin(psi) * hx, Math.cos(psi), Math.sin(psi) * hz);
    } else {
      const fi = 2 * PI * (u - 0.5);
      const P = this.P;
      const ex = Math.cos(fi) * this.Ef.x - Math.sin(fi) * this.Ed.x;
      const ey = Math.cos(fi) * this.Ef.y - Math.sin(fi) * this.Ed.y;
      const ez = Math.cos(fi) * this.Ef.z - Math.sin(fi) * this.Ed.z;
      o.set(0, this.y0, 0);
      dir.set(
        Math.cos(psi) * P.x + Math.sin(psi) * ex,
        Math.cos(psi) * P.y + Math.sin(psi) * ey,
        Math.cos(psi) * P.z + Math.sin(psi) * ez,
      );
    }
  }
}

/* ————————————————— Casca ————————————————— */

export type CascaCfg = {
  /** Espessura base acima da pele (m). */
  espessura: number;
  /** Bojo no alto (m), cresce com a inclinação para cima. */
  volume: number;
  /** Bojo dos lados (acima da orelha): cabelo que abre. */
  volumeLado?: number;
  /** Altura da linha do cabelo (rel. ao centro da cabeça): testa, lados, nuca. */
  linha: { frente: number; lado: number; tras: number };
  /** Afundamento da risca (0..1); 0,7 = o sulco da spec. */
  sulco?: number;
  /** Calombos (black power): amplitude (m) e frequência. */
  bolhas?: { amp: number; freq: number };
  /** Multiplicador de tom da casca. */
  tom?: number;
};

/** A linha do cabelo em volta da cabeça: testa, lado (orelha) e nuca, pelo azimute do ponto. */
export function yLinha(c: CascaCfg, x: number, z: number) {
  const a = Math.abs(Math.atan2(x, z));
  const af = 0.72;
  if (a < af) return c.linha.frente;
  if (a < PI / 2) return lerp(c.linha.frente, c.linha.lado, sstep(af, PI / 2, a));
  return lerp(c.linha.lado, c.linha.tras, sstep(PI / 2, PI, a));
}

const _o = new Vector3();
const _d = new Vector3();

function noCouro(k: Obra, c: CascaCfg, campo: Campo, u: number, psi: number, mecha: boolean) {
  campo.raio(u, psi, _o, _d);
  const r = k.cab.alcance(_o, _d, 0);
  const x = _o.x + _d.x * r;
  const y = _o.y + _d.y * r;
  const z = _o.z + _d.z * r;
  // Sob chapéu as MECHAS nascem do corte para baixo (a casca segue fina por dentro do chapéu).
  if (mecha && k.corte !== null && y > k.corte) return false;
  return y > yLinha(c, x, z);
}

/** O trecho [a, b] de psi em que a linha u está sobre o couro (mecha=true: abaixo do corte do chapéu). */
export function corrida(
  k: Obra,
  c: CascaCfg,
  campo: Campo,
  u: number,
  mecha = true,
): [number, number] | null {
  const chave = Math.round((((u % 1) + 1) % 1) * 20000) * 2 + (mecha ? 1 : 0);
  if (k.corridas.has(chave)) return k.corridas.get(chave)!;
  const r = corridaCrua(k, c, campo, u, mecha);
  k.corridas.set(chave, r);
  return r;
}

function corridaCrua(
  k: Obra,
  c: CascaCfg,
  campo: Campo,
  u: number,
  mecha: boolean,
): [number, number] | null {
  let a = -1;
  const passo = 0.06;
  for (let psi = 0; psi <= PI; psi += passo) {
    const dentro = noCouro(k, c, campo, u, psi, mecha);
    if (dentro && a < 0) {
      a = psi;
      if (psi > 0) {
        // refina a entrada (o corte do chapéu precisa ser nítido)
        let lo = psi - passo;
        let hi = psi;
        for (let i = 0; i < 7; i++) {
          const m = (lo + hi) / 2;
          if (noCouro(k, c, campo, u, m, mecha)) hi = m;
          else lo = m;
        }
        a = hi;
      }
    }
    if (!dentro && a >= 0) {
      let lo = psi - passo;
      let hi = psi;
      for (let i = 0; i < 7; i++) {
        const m = (lo + hi) / 2;
        if (noCouro(k, c, campo, u, m, mecha)) lo = m;
        else hi = m;
      }
      return [a, lo];
    }
  }
  return a >= 0 ? [a, PI] : null;
}

/** Calombo 0..1 na direção d (soma de senos: barato e determinístico). */
export function bolha(c: CascaCfg, d: Vector3) {
  if (!c.bolhas) return 1;
  const f = c.bolhas.freq;
  const b =
    Math.sin(f * d.x + 1.3) * Math.sin(f * d.y * 1.13 + 2.1) * Math.sin(f * d.z * 0.91 + 0.7);
  return 0.5 + 0.5 * Math.sign(b) * Math.pow(Math.abs(b), 0.6);
}

/** Largura angular da risca: 12 mm na testa afinando até 4 mm na coroa (em rad de psi). */
function larguraRisca(campo: Campo, o: Vector3, t: number) {
  if (campo.f.tipo !== "risca") return 0;
  const s = clamp01((o.z - campo.zC) / Math.max(1e-6, campo.zF - campo.zC));
  return lerp(0.004, 0.012, s) / (t * 0.5);
}

function espessuraCasca(
  k: Obra,
  c: CascaCfg,
  campo: Campo,
  psi: number,
  fim: number,
  o: Vector3,
  d: Vector3,
) {
  let e =
    c.espessura +
    k.inflar *
      (c.volume * Math.pow(Math.max(0, d.y), 1.5) +
        (c.volumeLado ?? 0) * d.x * d.x * sstep(-0.6, 0.2, d.y));
  if (c.bolhas) e += c.bolhas.amp * bolha(c, d);
  if (campo.f.tipo === "risca" && c.sulco) {
    const w = larguraRisca(campo, o, k.t);
    e *= 1 - c.sulco * (1 - sstep(w * 0.5, w * 1.8, psi));
  }
  const dobra = sstep(fim - 0.22, fim, psi);
  // "Borda de papel" na linha do cabelo: some na pele sem degrau.
  return lerp(e, 0.004, dobra);
}

/**
 * Ponto da casca (+ folga acima dela). Sob chapéu, acima do corte, no máximo
 * 1 cm. Sentado, nunca atrás da face do encosto (no baixinho o encosto sobe
 * até a metade de trás da cabeça: o volume da nuca achata ali). `margemEnc` =
 * distância da face do encosto (a casca é uma superfície: 1,2 cm; a linha
 * central de uma mecha precisa de mais, por causa da espessura da fita).
 */
export function pontoCasca(
  k: Obra,
  c: CascaCfg,
  campo: Campo,
  u: number,
  psi: number,
  fim: number,
  folga: number,
  out: Vector3,
  margemEnc = 0.012,
): Vector3 {
  campo.raio(u, psi, _o, _d);
  let e = espessuraCasca(k, c, campo, psi, fim, _o, _d) + folga;
  let r = k.cab.alcance(_o, _d, e);
  if (k.corte !== null && e > 0.012) {
    // sob chapéu a casca afina até 1,2 cm nos 3,5 cm abaixo do corte (em rampa): o degrau
    // seco de espessura no corte deixava a pele aparecer em pontinhos logo abaixo da aba
    const yPele = _o.y + _d.y * k.cab.alcance(_o, _d, 0);
    const s = sstep(k.corte - 0.035, k.corte, yPele);
    if (s > 0) {
      e = lerp(e, 0.012, s);
      r = k.cab.alcance(_o, _d, e);
    }
  }
  out.copy(_o).addScaledVector(_d, r);
  limitarEncosto(k, out, margemEnc);
  return out;
}

/** Sentado: puxa o ponto para a frente da face do encosto (+margem), se ele estiver atrás dela. */
export function limitarEncosto(k: Obra, p: Vector3, margem: number) {
  const c = k.ctx;
  // o encosto tem 0,5 de largura: além dele (mais a margem, que nos rabos é o raio) não há o que evitar
  if (c.pose !== "sentado" || !c.zEncosto || Math.abs(p.x) > 0.25 + margem) return;
  const z = c.zEncosto(p.y) + margem;
  if (p.z >= z) return;
  // só onde o encosto existe (y mundo ≈ 0,50 a 1,20)
  const yMundo = p.y + 0.52 + c.troncoH + 0.03 + c.t / 2;
  if (yMundo < 0.48 || yMundo > 1.22) return;
  p.z = z;
}

/* ————————————————— Malha: tudo numa geometria só ————————————————— */

/** Os atributos crus, antes de virar BufferGeometry. */
export type Partes = {
  pos: number[];
  nor: number[];
  uv: number[];
  tan: number[];
  cor: number[];
  peso: number[];
  idx: number[];
};

/**
 * Acumulador dos vértices. A cor não é cor: r = tom (multiplicador de
 * luminância), g = máscara de mecha (0..1), b = 0 — o shader mistura as duas
 * cores do avatar (C2.5). `ref` guarda uma normal de reserva (o "para fora")
 * para quando a normal calculada degenerar.
 */
export class Malha {
  pos: number[] = [];
  cor: number[] = [];
  uv: number[] = [];
  tan: number[] = [];
  ref: number[] = [];
  idx: number[] = [];
  /** Pares de vértices duplicados na costura da casca (normal média). */
  costura: [number, number][] = [];
  /** Índice do primeiro vértice das mechas (o que vem antes é a casca). */
  iniMechas = 0;
  get n() {
    return this.pos.length / 3;
  }
  v(p: Vector3, tom: number, mascara: number, u: number, v: number, tg: Vector3, ref: Vector3) {
    this.pos.push(p.x, p.y, p.z);
    this.cor.push(tom, mascara, 0);
    this.uv.push(u, v);
    this.tan.push(tg.x, tg.y, tg.z, 1);
    this.ref.push(ref.x, ref.y, ref.z);
    return this.n - 1;
  }
}

/* ————————————————— A casca inteira ————————————————— */

/** Metros de largura que uma repetição da textura cobre (densidade dos fios). */
export const KU = 0.16;
/** Metros de comprimento que a textura cobre em v. */
export const KV = 0.5;

/** Máscara de mecha de um ponto da casca (depende do modo; ver cabelo-guia). */
export type MascaraCasca = (u: number, psi: number, o: Vector3, campo: Campo) => number;

const _p = new Vector3();
const _ant = new Vector3();
const _tg = new Vector3();
const _rf = new Vector3();

export function construirCasca(
  k: Obra,
  c: CascaCfg,
  campo: Campo,
  x: Malha,
  mascara: MascaraCasca,
  nu: number,
  nv: number,
) {
  const rep = Math.max(1, Math.round(campo.total / KU));
  const linhas: { ini: number; ok: boolean }[] = [];
  const o = new Vector3();
  const d = new Vector3();
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const cr = corrida(k, c, campo, u, false);
    if (!cr) {
      linhas.push({ ini: -1, ok: false });
      continue;
    }
    const [a, b] = cr;
    const ini = x.n;
    let arco = 0;
    // os pontos da linha primeiro: a tangente (anisotropia) sai dos vizinhos, sem raio extra
    const pts: Vector3[] = [];
    for (let j = 0; j <= nv; j++)
      pts.push(pontoCasca(k, c, campo, u, lerp(a, b, j / nv), b, 0, new Vector3()));
    for (let j = 0; j <= nv; j++) {
      const psi = lerp(a, b, j / nv);
      _p.copy(pts[j]!);
      if (j > 0) arco += _p.distanceTo(_ant);
      _tg.copy(pts[Math.min(nv, j + 1)]!).sub(pts[Math.max(0, j - 1)]!);
      if (_tg.lengthSq() < 1e-12) _tg.set(0, -1, 0);
      _tg.normalize();
      _ant.copy(_p);
      campo.raio(u, psi, o, d);
      let risca = lerp(0.7, 1, sstep(0, 0.2, psi));
      if (campo.f.tipo === "risca") {
        const w = larguraRisca(campo, o, k.t);
        risca = lerp(0.55, 1, sstep(w * 0.4, w * 2.2, psi));
      }
      const borda = lerp(1, 0.82, sstep(b - 0.18, b, psi));
      const vale = c.bolhas ? lerp(0.62, 1.08, bolha(c, d)) : 1;
      _rf.copy(d);
      x.v(
        _p,
        risca * borda * vale * (c.tom ?? 1),
        mascara(u, psi, o, campo),
        u * rep,
        V_INICIO + arco / KV,
        _tg,
        _rf,
      );
    }
    linhas.push({ ini, ok: true });
    if (i === nu && linhas[0]!.ok)
      for (let j = 0; j <= nv; j++) x.costura.push([linhas[0]!.ini + j, ini + j]);
  }
  for (let i = 0; i < nu; i++) {
    const A = linhas[i]!;
    const B = linhas[i + 1]!;
    if (!A.ok || !B.ok) continue;
    for (let j = 0; j < nv; j++) {
      const a = A.ini + j;
      const b = B.ini + j;
      x.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  x.iniMechas = x.n;
}
