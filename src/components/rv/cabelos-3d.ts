import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Float32BufferAttribute,
  Matrix4,
  SphereGeometry,
  Vector3,
} from "three";
import type { AvatarConfig } from "@/lib/avatar-3d";
import { clarear, escurecer } from "@/components/rv/avatar-texturas";

/**
 * Gerador de cabelo estilizado (tipo Roblox/anime): cada penteado é um
 * conjunto de MECHAS — tubos achatados que afinam até a ponta — nascendo do
 * couro cabeludo e caindo com "gravidade". As mechas desviam da cabeça e dos
 * ombros e param antes de cobrir os olhos; tudo sai numa geometria só, com a
 * cor escurecendo na raiz e clareando na ponta.
 *
 * Coordenadas: centro da cabeça na origem, rosto para +z.
 */

export type Medidas = { t: number; peito: number; ombroX: number; coberto: boolean };
export type Base = "capa" | "liso" | "rente" | "nenhuma";

type V3 = [number, number, number];
const PI = Math.PI;

type Raiz = { p: Vector3; n: Vector3 };
type Grupo = {
  n: number;
  /** Azimute: 0 = frente, PI/2 = lado direito, PI = costas. */
  az?: [number, number];
  /** Elevação 0..1: 0 = altura da orelha, 1 = topo. */
  el?: [number, number];
  /** Raízes fixas (rabo, crista do moicano…), no lugar de az/el. */
  raiz?: (i: number, n: number, r: () => number, k: Ctx) => Raiz;
  len: [number, number];
  w: [number, number];
  /** Quanto a mecha sobe ao nascer (espetado). */
  levanta?: number;
  /** Gravidade por passo: 0 = espeto reto, 0.7 = cai liso. */
  peso: number;
  /** Penteado para um lado/para trás. */
  vies?: V3;
  /** Abre para o lado de onde nasceu (risca no meio). */
  abre?: number;
  jitter?: number;
  onda?: number;
  cacho?: number;
  achat?: number;
  /** Até onde pode descer na frente do rosto (y). */
  testa?: number;
  /** 0..1: o quanto a mecha gruda na cabeça (penteado puxado, liso). */
  cola?: number;
  /** Franja: sob chapéu, nasce por baixo da aba em vez de sumir. */
  franja?: boolean;
};
type Estilo = { base: Base; grupos: Grupo[]; extras?: (x: Construtor, k: Ctx) => void };

type Ctx = Medidas & { d: number; topo: number; cor: string; r: () => number };

/* ————————————————— Construção da malha ————————————————— */

class Construtor {
  pos: number[] = [];
  cor: number[] = [];
  idx: number[] = [];

  mecha(pts: Vector3[], w0: number, achat: number, c0: Color, c1: Color) {
    const curva = new CatmullRomCurve3(pts, false, "centripetal");
    const S = 10;
    const M = 7;
    const ini = this.pos.length / 3;
    const c = new Color();
    for (let s = 0; s < S; s++) {
      const u = s / S;
      const p = curva.getPointAt(u);
      const T = curva.getTangentAt(u);
      const fora = p.clone().normalize();
      let B = new Vector3().crossVectors(T, fora);
      if (B.lengthSq() < 1e-4) B = new Vector3().crossVectors(T, new Vector3(0, 0, 1));
      if (B.lengthSq() < 1e-4) B = new Vector3(1, 0, 0);
      B.normalize();
      const N = new Vector3().crossVectors(B, T).normalize();
      const w = w0 * Math.pow(1 - u, 0.75) * (u < 0.12 ? 0.75 + u * 2 : 1);
      c.copy(c0).lerp(c1, u);
      for (let m = 0; m < M; m++) {
        const a = (m / M) * PI * 2;
        const v = p
          .clone()
          .addScaledVector(B, Math.cos(a) * w)
          .addScaledVector(N, Math.sin(a) * w * achat);
        this.pos.push(v.x, v.y, v.z);
        this.cor.push(c.r, c.g, c.b);
      }
    }
    const ponta = curva.getPointAt(1);
    this.pos.push(ponta.x, ponta.y, ponta.z);
    this.cor.push(c1.r, c1.g, c1.b);
    const iPonta = ini + S * M;
    for (let s = 0; s < S - 1; s++) {
      for (let m = 0; m < M; m++) {
        const a = ini + s * M + m;
        const b = ini + s * M + ((m + 1) % M);
        this.idx.push(a, b, a + M, b, b + M, a + M);
      }
    }
    for (let m = 0; m < M; m++)
      this.idx.push(ini + (S - 1) * M + m, ini + (S - 1) * M + ((m + 1) % M), iPonta);
  }

  elipsoide(c: V3, esc: V3, cor: Color, rot: V3 = [0, 0, 0]) {
    const g = new SphereGeometry(1, 14, 10);
    const mat = new Matrix4().makeScale(...esc);
    mat.premultiply(new Matrix4().makeRotationX(rot[0]));
    mat.premultiply(new Matrix4().makeRotationY(rot[1]));
    mat.premultiply(new Matrix4().makeRotationZ(rot[2]));
    mat.premultiply(new Matrix4().makeTranslation(...c));
    g.applyMatrix4(mat);
    const ini = this.pos.length / 3;
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.cor.push(cor.r, cor.g, cor.b);
    }
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) this.idx.push(ini + ix.getX(i));
    g.dispose();
  }

  geometria(): BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.cor, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/* ————————————————— Física de brinquedo ————————————————— */

/** Tira o ponto de dentro da cabeça e dos ombros. */
function empurrar(k: Ctx, p: Vector3) {
  // Folga maior que a base escura: as mechas ficam por cima dela, não dentro.
  const hx = k.t / 2 + 0.032;
  const hz = k.d / 2 + 0.032;
  const alto = k.topo + 0.06;
  if (p.y < alto && p.y > -k.t / 2 - 0.02 && Math.abs(p.x) < hx && Math.abs(p.z) < hz) {
    const px = hx - Math.abs(p.x);
    const pz = hz - Math.abs(p.z);
    const py = alto - p.y;
    if (px <= pz && px <= py) p.x = Math.sign(p.x || 1) * hx;
    else if (pz <= py) p.z = Math.sign(p.z || -1) * hz;
    else p.y = alto;
  }
  // Ombros e tronco: o cabelo cai pela frente ou pelas costas, nunca atravessa.
  const ombroY = -k.t / 2 - 0.01;
  if (p.y < ombroY && Math.abs(p.x) < k.ombroX + 0.02 && Math.abs(p.z) < k.peito + 0.025) {
    p.z = Math.sign(p.z || -1) * (k.peito + 0.025);
  }
}

/** Puxa o ponto de volta para a superfície da cabeça (penteado colado). */
function colar(k: Ctx, p: Vector3, cola: number) {
  if (p.y < -k.t / 2) return;
  const hx = k.t / 2 + 0.032;
  const hz = k.d / 2 + 0.032;
  const alvo = new Vector3(
    Math.max(-hx, Math.min(hx, p.x)),
    Math.min(k.topo + 0.06, p.y),
    Math.max(-hz, Math.min(hz, p.z)),
  );
  p.lerp(alvo, cola);
}

function naFrenteDoRosto(k: Ctx, p: Vector3, testa: number) {
  return p.z > 0 && Math.abs(p.x) < k.t * 0.47 && p.y < testa && p.y > -k.t / 2 - 0.06;
}

const lerp = ([a, b]: [number, number], u: number) => a + (b - a) * u;

function raizNoCouro(k: Ctx, az: number, el01: number): Raiz {
  const el = (el01 * PI) / 2;
  const cy = k.topo - 0.07;
  const rx = k.t / 2;
  const ry = 0.1;
  const rz = k.d / 2;
  const p = new Vector3(
    Math.sin(az) * Math.cos(el) * rx,
    cy + Math.sin(el) * ry,
    Math.cos(az) * Math.cos(el) * rz,
  );
  const n = new Vector3(p.x / (rx * rx), (p.y - cy) / (ry * ry), p.z / (rz * rz)).normalize();
  return { p, n };
}

function simular(k: Ctx, { p: raiz, n }: Raiz, g: Grupo): Vector3[] | null {
  const r = k.r;
  const len = lerp(g.len, r());
  const K = 9;
  const passo = len / K;
  // A franja nasce para a frente, para deitar sobre a testa.
  const dir = g.franja ? new Vector3(n.x, 0.25, 1) : n.clone();
  dir.y += g.levanta ?? 0;
  if (g.vies) dir.add(new Vector3(...g.vies));
  if (g.abre) dir.x += Math.sign(raiz.x || 1) * g.abre;
  const j = g.jitter ?? 0.15;
  dir.add(new Vector3((r() - 0.5) * 2 * j, (r() - 0.5) * 2 * j, (r() - 0.5) * 2 * j)).normalize();
  const testa = g.testa ?? 0.1;
  const fase = r() * PI * 2;
  const pts = [raiz.clone()];
  const p = raiz.clone();
  for (let i = 1; i <= K; i++) {
    dir.y -= g.peso;
    dir.normalize();
    p.addScaledVector(dir, passo);
    const q = p.clone();
    if (g.onda || g.cacho) {
      const lado = new Vector3().crossVectors(dir, q.clone().normalize()).normalize();
      const frente = new Vector3().crossVectors(lado, dir).normalize();
      const s = i / K;
      if (g.onda) q.addScaledVector(lado, Math.sin(i * 1.4 + fase) * g.onda * s);
      if (g.cacho) {
        q.addScaledVector(lado, Math.cos(i * 2.3 + fase) * g.cacho);
        q.addScaledVector(frente, Math.sin(i * 2.3 + fase) * g.cacho);
      }
    }
    if (g.cola) {
      colar(k, p, g.cola);
      colar(k, q, g.cola);
    }
    empurrar(k, p);
    empurrar(k, q);
    if (naFrenteDoRosto(k, q, testa)) break;
    pts.push(q);
  }
  return pts.length >= 3 ? pts : null;
}

function semente(s: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let x = h;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/* ————————————————— Os penteados ————————————————— */

const coroa = (o: Partial<Grupo> = {}): Grupo => ({
  n: 20,
  az: [0, 2 * PI],
  el: [0.45, 1],
  len: [0.15, 0.2],
  w: [0.09, 0.11],
  peso: 0.25,
  jitter: 0.2,
  ...o,
});
const volta = (o: Partial<Grupo> = {}): Grupo => ({
  n: 20,
  az: [0.28 * PI, 1.72 * PI],
  el: [0, 0.5],
  len: [0.15, 0.2],
  w: [0.08, 0.1],
  peso: 0.25,
  jitter: 0.2,
  ...o,
});
const franja = (o: Partial<Grupo> = {}): Grupo => ({
  n: 9,
  az: [-0.34 * PI, 0.34 * PI],
  el: [0.45, 0.92],
  len: [0.22, 0.27],
  w: [0.07, 0.09],
  peso: 0.28,
  jitter: 0.2,
  testa: 0.07,
  franja: true,
  ...o,
});
const longoBase = (o: Partial<Grupo> = {}): Grupo[] => [
  coroa({
    n: 16,
    el: [0.55, 1],
    len: [0.2, 0.26],
    w: [0.1, 0.12],
    peso: 0.7,
    abre: 0.6,
    jitter: 0.05,
    cola: 0.5,
  }),
  volta({
    n: 28,
    az: [0.25 * PI, 1.75 * PI],
    el: [0, 0.55],
    len: [0.62, 0.72],
    w: [0.1, 0.12],
    peso: 0.6,
    jitter: 0.06,
    ...o,
  }),
  {
    n: 8,
    az: [-0.3 * PI, 0.3 * PI],
    el: [0.55, 0.95],
    len: [0.6, 0.7],
    w: [0.09, 0.1],
    peso: 0.45,
    abre: 1.2,
    jitter: 0.05,
    testa: 0.1,
    franja: true,
    ...o,
  },
];
const franjaReta = (): Grupo => ({
  n: 10,
  az: [-0.3 * PI, 0.3 * PI],
  el: [0.5, 0.95],
  len: [0.3, 0.3],
  w: [0.08, 0.09],
  peso: 0.6,
  jitter: 0.03,
  testa: 0.1,
  franja: true,
});
const fixa =
  (p: V3, n: V3): Grupo["raiz"] =>
  () => ({ p: new Vector3(...p), n: new Vector3(...n).normalize() });

function elastico(x: Construtor, k: Ctx, c: V3, esc: V3 = [0.055, 0.045, 0.055]) {
  x.elipsoide(c, esc, new Color(escurecer(k.cor, 0.45)));
}

const ESTILOS: Record<Exclude<AvatarConfig["cabelo"], "careca">, (k: Ctx) => Estilo> = {
  raspado: () => ({ base: "rente", grupos: [] }),
  social: () => ({
    base: "capa",
    grupos: [
      coroa({
        n: 16,
        el: [0.55, 1],
        len: [0.12, 0.16],
        w: [0.09, 0.11],
        peso: 0.5,
        vies: [0.5, 0, -0.3],
        jitter: 0.08,
        levanta: 0.1,
      }),
      volta({ n: 16, el: [0, 0.5], len: [0.07, 0.11], peso: 0.6, jitter: 0.08 }),
      franja({
        n: 6,
        az: [-0.3 * PI, 0.25 * PI],
        el: [0.4, 0.8],
        len: [0.14, 0.18],
        w: [0.08, 0.1],
        peso: 0.35,
        vies: [0.7, 0, 0],
        testa: 0.14,
        jitter: 0.06,
      }),
    ],
  }),
  topete: () => ({
    base: "liso",
    grupos: [
      {
        n: 10,
        az: [-0.25 * PI, 0.25 * PI],
        el: [0.55, 0.95],
        len: [0.2, 0.24],
        w: [0.1, 0.12],
        levanta: 1.2,
        peso: 0.16,
        vies: [0, 0, 0.2],
        jitter: 0.08,
      },
    ],
  }),
  anime: () => ({
    base: "capa",
    grupos: [
      coroa({
        n: 22,
        el: [0.35, 1],
        len: [0.14, 0.22],
        w: [0.07, 0.09],
        levanta: 0.5,
        peso: 0.06,
        jitter: 0.35,
      }),
      volta({
        n: 18,
        az: [0.3 * PI, 1.7 * PI],
        el: [0, 0.45],
        len: [0.14, 0.22],
        w: [0.07, 0.09],
        levanta: 0.1,
        peso: 0.12,
        jitter: 0.3,
      }),
      franja({ n: 9, len: [0.2, 0.26], w: [0.06, 0.08], peso: 0.25, jitter: 0.25 }),
    ],
  }),
  baguncado: () => ({
    base: "capa",
    grupos: [
      coroa({ n: 24, el: [0.4, 1], len: [0.16, 0.22], levanta: 0.15, peso: 0.22, jitter: 0.3 }),
      volta({ n: 22, len: [0.16, 0.22], peso: 0.25, jitter: 0.25 }),
      franja({ n: 10, az: [-0.38 * PI, 0.38 * PI], len: [0.22, 0.28], peso: 0.3, jitter: 0.2 }),
    ],
  }),
  emo: () => ({
    base: "capa",
    grupos: [
      coroa({
        n: 18,
        el: [0.5, 1],
        len: [0.14, 0.18],
        w: [0.1, 0.11],
        peso: 0.4,
        vies: [0.4, 0, -0.2],
        jitter: 0.15,
      }),
      volta({ n: 20, len: [0.18, 0.26], peso: 0.35, jitter: 0.2 }),
      franja({
        n: 9,
        az: [-0.45 * PI, 0.2 * PI],
        el: [0.5, 0.95],
        len: [0.28, 0.34],
        w: [0.08, 0.1],
        peso: 0.22,
        vies: [0.9, 0, 0],
        testa: 0.04,
        jitter: 0.1,
      }),
    ],
  }),
  wolfcut: () => ({
    base: "capa",
    grupos: [
      coroa({ n: 22, el: [0.4, 1], len: [0.15, 0.2], levanta: 0.2, peso: 0.2, jitter: 0.3 }),
      volta({ n: 12, az: [0.28 * PI, 0.6 * PI], len: [0.2, 0.24], peso: 0.3 }),
      volta({ n: 12, az: [1.4 * PI, 1.72 * PI], len: [0.2, 0.24], peso: 0.3 }),
      volta({ n: 16, az: [0.55 * PI, 1.45 * PI], len: [0.32, 0.4], peso: 0.35 }),
      franja({ n: 10, len: [0.22, 0.27], peso: 0.3, jitter: 0.25 }),
    ],
  }),
  moicano: (k) => ({
    base: "rente",
    grupos: [
      {
        n: 10,
        raiz: (i, n) => {
          const z = k.d / 2 - 0.04 - (i / (n - 1)) * (k.d - 0.04);
          return { p: new Vector3(0, k.topo + 0.02, z), n: new Vector3(0, 1, z * 0.8).normalize() };
        },
        len: [0.17, 0.23],
        w: [0.08, 0.1],
        levanta: 0.4,
        peso: 0.04,
        vies: [0, 0, -0.25],
        jitter: 0.08,
      },
    ],
  }),
  cacheadoCurto: () => ({
    base: "capa",
    grupos: [
      {
        n: 44,
        az: [0, 2 * PI],
        el: [0, 1],
        len: [0.08, 0.12],
        w: [0.06, 0.07],
        peso: 0.15,
        cacho: 0.03,
        jitter: 0.3,
        testa: 0.13,
      },
    ],
  }),
  afro: () => ({
    base: "capa",
    grupos: [],
    extras: (x, k) => {
      const claro = new Color(clarear(k.cor, 0.08));
      const escuro = new Color(escurecer(k.cor, 0.15));
      const grande = !k.coberto;
      const N = grande ? 70 : 40;
      for (let i = 0; i < N; i++) {
        const az = i * 2.39996;
        const el = -0.35 + (i / N) * (grande ? 1.35 : 0.75);
        const a = ((az % (2 * PI)) + 2 * PI) % (2 * PI);
        if ((a < 0.36 * PI || a > 1.64 * PI) && el < 0.5) continue; // o rosto fica livre
        const rx = k.t / 2 + 0.1;
        const ry = 0.24;
        const rz = k.d / 2 + 0.1;
        const e = (el * PI) / 2;
        x.elipsoide(
          [
            Math.sin(a) * Math.cos(e) * rx,
            k.topo - 0.06 + Math.sin(e) * ry,
            Math.cos(a) * Math.cos(e) * rz - 0.02,
          ],
          [0.085, 0.085, 0.085],
          i % 2 ? claro : escuro,
        );
      }
    },
  }),
  dreads: () => ({
    base: "capa",
    grupos: [
      {
        n: 26,
        az: [0.15 * PI, 1.85 * PI],
        el: [0.2, 1],
        len: [0.34, 0.46],
        w: [0.035, 0.04],
        achat: 1,
        peso: 0.5,
        jitter: 0.1,
      },
      {
        n: 5,
        az: [-0.25 * PI, 0.25 * PI],
        el: [0.6, 0.9],
        len: [0.3, 0.3],
        w: [0.035, 0.035],
        achat: 1,
        peso: 0.5,
        testa: 0.1,
        franja: true,
      },
    ],
  }),
  chanel: () => ({
    base: "capa",
    grupos: [
      coroa({ n: 18, len: [0.16, 0.2], w: [0.1, 0.12], peso: 0.7, jitter: 0.08, cola: 0.5 }),
      volta({ n: 24, len: [0.28, 0.32], w: [0.1, 0.12], peso: 0.7, jitter: 0.06 }),
      franjaReta(),
    ],
  }),
  longo: () => ({ base: "capa", grupos: longoBase() }),
  franjaLonga: () => ({ base: "capa", grupos: [...longoBase(), franjaReta()] }),
  ondulado: () => ({ base: "capa", grupos: longoBase({ onda: 0.045 }) }),
  cacheado: () => ({
    base: "capa",
    grupos: [
      coroa({ n: 20, len: [0.14, 0.18], w: [0.08, 0.09], peso: 0.3, cacho: 0.03, jitter: 0.3 }),
      volta({
        n: 34,
        az: [0.25 * PI, 1.75 * PI],
        el: [0, 0.6],
        len: [0.5, 0.6],
        w: [0.07, 0.08],
        peso: 0.5,
        cacho: 0.035,
        jitter: 0.15,
      }),
      franja({ n: 8, len: [0.2, 0.24], w: [0.06, 0.07], cacho: 0.025, peso: 0.4, testa: 0.1 }),
    ],
  }),
  rabo: (k) => ({
    base: "liso",
    grupos: [
      {
        n: 12,
        raiz: fixa([0, -0.02, -k.d / 2 - 0.02], [0, -0.3, -1]),
        len: [0.4, 0.48],
        w: [0.07, 0.09],
        peso: 0.35,
        jitter: 0.25,
      },
    ],
    extras: (x) => elastico(x, k, [0, -0.02, -k.d / 2 - 0.04]),
  }),
  raboAlto: (k) => ({
    base: "liso",
    grupos: [
      {
        n: 14,
        raiz: fixa([0, k.topo + 0.03, -k.d / 2 + 0.03], [0, 0.6, -0.8]),
        len: [0.42, 0.5],
        w: [0.07, 0.09],
        peso: 0.3,
        jitter: 0.3,
      },
      franja({ n: 5, az: [-0.3 * PI, 0.1 * PI], len: [0.2, 0.24], vies: [0.8, 0, 0], testa: 0.1 }),
    ],
    extras: (x) => elastico(x, k, [0, k.topo + 0.04, -k.d / 2 + 0.01]),
  }),
  coque: (k) => ({
    base: "liso",
    grupos: [],
    extras: (x) => {
      if (k.coberto) return;
      x.elipsoide([0, k.topo + 0.13, -k.d * 0.1], [0.12, 0.1, 0.12], new Color(k.cor));
      x.elipsoide(
        [0, k.topo + 0.16, -k.d * 0.1],
        [0.08, 0.06, 0.08],
        new Color(clarear(k.cor, 0.08)),
      );
      elastico(x, k, [0, k.topo + 0.06, -k.d * 0.1], [0.075, 0.03, 0.075]);
    },
  }),
  coqueDuplo: (k) => ({
    base: "liso",
    grupos: [
      franja({ n: 7, len: [0.2, 0.24], testa: 0.1 }),
      {
        n: 2,
        raiz: (i) => raizNoCouro(k, i ? 0.42 * PI : -0.42 * PI, 0.3),
        len: [0.36, 0.4],
        w: [0.06, 0.07],
        peso: 0.7,
        jitter: 0.03,
      },
    ],
    extras: (x) => {
      if (k.coberto) return;
      [-1, 1].forEach((l) => {
        x.elipsoide([k.t * 0.3 * l, k.topo + 0.11, -0.03], [0.11, 0.1, 0.11], new Color(k.cor));
        x.elipsoide(
          [k.t * 0.3 * l, k.topo + 0.15, -0.03],
          [0.07, 0.05, 0.07],
          new Color(clarear(k.cor, 0.1)),
        );
      });
    },
  }),
  chiquinha: (k) => ({
    base: "liso",
    grupos: [
      franja({ n: 7, len: [0.2, 0.24], testa: 0.1 }),
      ...[-1, 1].map((l): Grupo => ({
        n: 9,
        raiz: fixa([(k.t / 2 + 0.03) * l, 0.1, -0.05], [l, -0.2, 0]),
        len: [0.36, 0.44],
        w: [0.07, 0.08],
        peso: 0.3,
        jitter: 0.3,
      })),
    ],
    extras: (x) => [-1, 1].forEach((l) => elastico(x, k, [(k.t / 2 + 0.04) * l, 0.1, -0.05])),
  }),
  // (reserva: as tranças já foram portadas para o motor novo, `cabelo-estilos.ts`, que tem
  // precedência no despacho de `cabeca-3d.tsx`)
  trancas: (k) => ({
    base: "liso",
    grupos: [franja({ n: 7, len: [0.2, 0.24], testa: 0.1 })],
    extras: (x) => {
      const cor = new Color(k.cor);
      const claro = new Color(clarear(k.cor, 0.1));
      [-1, 1].forEach((l) => {
        // A trança desce do lado da cabeça e cai por cima do peito.
        const a = new Vector3((k.t / 2 + 0.03) * l, 0.02, k.d * 0.15);
        const b = new Vector3(k.t * 0.36 * l, -k.t / 2 - 0.04, k.peito + 0.045);
        const c = new Vector3(k.t * 0.36 * l, -k.t / 2 - 0.42, k.peito + 0.045);
        for (let i = 0; i < 11; i++) {
          const u = i / 10;
          const p = u < 0.3 ? a.clone().lerp(b, u / 0.3) : b.clone().lerp(c, (u - 0.3) / 0.7);
          x.elipsoide([p.x, p.y, p.z], [0.06, 0.045, 0.045], i % 2 ? claro : cor, [
            0,
            0,
            i % 2 ? 0.5 : -0.5,
          ]);
        }
        elastico(x, k, [c.x, c.y - 0.02, c.z], [0.04, 0.025, 0.04]);
        x.elipsoide([c.x, c.y - 0.07, c.z], [0.045, 0.06, 0.04], cor);
      });
    },
  }),
  // (reservas: estes só existem no motor novo, `cabelo-estilos.ts`, que tem precedência;
  // aqui cada um cai num parecido do motor antigo)
  longoMechas: (k) => ESTILOS.longo(k),
  longoEscorrido: (k) => ESTILOS.longo(k),
  chiquinhaAlta: (k) => ESTILOS.chiquinha(k),
  longoRepicado: (k) => ESTILOS.ondulado(k),
  raboFranja: (k) => ESTILOS.raboAlto(k),
  coqueSolto: (k) => ESTILOS.coque(k),
  longoFlor: (k) => ESTILOS.longo(k),
  repicadoChiquinhas: (k) => ESTILOS.chanel(k),
  longoTrancinhas: (k) => ESTILOS.longo(k),
  trancasBaixas: (k) => ESTILOS.trancas(k),
  trancasBoxer: (k) => ESTILOS.trancas(k),
  trancaLateral: (k) => ESTILOS.trancas(k),
  trancaEspinha: (k) => ESTILOS.rabo(k),
  // (reservas dos masculinos novos, 16/10/2026: só existem em `cabelo-estilos-masculinos.ts`)
  undercut: (k) => ESTILOS.topete(k),
  socialLambido: (k) => ESTILOS.social(k),
  topeteQuiff: (k) => ESTILOS.topete(k),
  buzzCut: (k) => ESTILOS.raspado(k),
  coqueMasculino: (k) => ESTILOS.coque(k),
  surfista: (k) => ESTILOS.wolfcut(k),
  cacheadoDegrade: (k) => ESTILOS.cacheadoCurto(k),
  heroiAnime: (k) => ESTILOS.anime(k),
  mulletRoqueiro: (k) => ESTILOS.wolfcut(k),
  hiTop: (k) => ESTILOS.afro(k),
  nago: (k) => ESTILOS.raspado(k),
  franjaEboy: (k) => ESTILOS.emo(k),
  samurai: (k) => ESTILOS.coque(k),
};

export function baseDoCabelo(tipo: AvatarConfig["cabelo"]): Base {
  return tipo === "careca" ? "nenhuma" : ESTILOS[tipo]({} as Ctx).base;
}

/** A malha do penteado, ou `null` (careca / raspado). */
export function gerarCabelo(
  tipo: AvatarConfig["cabelo"],
  cor: string,
  m: Medidas,
): BufferGeometry | null {
  if (tipo === "careca") return null;
  const k: Ctx = { ...m, d: m.t * 0.92, topo: m.t / 2, cor, r: semente(tipo) };
  const estilo = ESTILOS[tipo](k);
  const x = new Construtor();
  const raiz = new Color(escurecer(cor, 0.35));
  const ponta = new Color(clarear(cor, 0.14));
  estilo.grupos.forEach((g, gi) => {
    k.r = semente(`${tipo}:${gi}`);
    const [a0, a1] = g.az ?? [0, 2 * PI];
    const [e0, e1] = g.el ?? [0, 1];
    for (let i = 0; i < g.n; i++) {
      let rz: Raiz;
      if (g.raiz) rz = g.raiz(i, g.n, k.r, k);
      else {
        const u = (i + 0.5 + (k.r() - 0.5) * 0.5) / g.n;
        const v = (i * 0.618034 + k.r() * 0.15) % 1;
        rz = raizNoCouro(k, a0 + (a1 - a0) * u, e0 + (e1 - e0) * v);
      }
      if (k.coberto && rz.p.y > k.topo - 0.06) {
        // Sob o chapéu: o alto some; a franja nasce por baixo da aba.
        if (!g.franja || g.len[1] < 0.4) continue;
        rz = {
          p: new Vector3(rz.p.x, k.topo - 0.07, k.d / 2 - 0.02),
          n: new Vector3(rz.p.x * 2, -0.3, 1).normalize(),
        };
      }
      const pts = simular(k, rz, g);
      if (pts) x.mecha(pts, lerp(g.w, k.r()), g.achat ?? 0.45, raiz, ponta);
    }
  });
  estilo.extras?.(x, k);
  return x.geometria();
}
