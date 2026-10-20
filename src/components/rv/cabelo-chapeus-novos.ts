import { BufferGeometry, CatmullRomCurve3, Vector3 } from "three";
import { CabecaSDF, clamp01, lerp, sstep } from "@/components/rv/cabelo-casca";
import { ABAS_NOVAS, Grade, type AbaNova } from "@/components/rv/cabelo-chapeu";
import type { TexturaDeChapeu } from "@/components/rv/cabelo-texturas";

/*
 * Os chapéus e enfeites novos do catálogo (16/10/2026: "crie pelo menos mais
 * 10 de cada, bem criativo e dinâmico, baseado em Roblox") — o agro/
 * silvicultura (palha, trucker, cowboy, capacete florestal com viseira e
 * abafador) e os clássicos divertidos (hélice girando, auréola, chifrinhos…).
 *
 * Tudo é geometria procedural, como o chapéu de aba (`cabelo-chapeu.ts`):
 * cada chapéu sai como uma lista de PEÇAS, uma por cor/acabamento (1 draw
 * call cada), com o tom (vinco, costura, sombra da fita) no atributo `color`.
 * Os que cobrem o alto nascem no CORTE do cabelo (`CORTE_DO_CHAPEU`) e vestem
 * a cabeça pelo SDF dela (a cabeça é um bloco arredondado: o casco do gorro,
 * do boné e do capacete a abraça de verdade, sem fresta nem cabelo furando).
 * As abas largas usam as medidas de `ABAS_NOVAS`, as mesmas que o cabelo usa
 * para passar por baixo delas.
 *
 * Coordenadas: centro da cabeça na origem, +y para cima, rosto para +z;
 * números no corpo clássico (t = 0,46), escalados por e = t/0,46.
 */

const PI = Math.PI;

export type PecaChapeu = {
  geo: BufferGeometry;
  /**
   * "" = a cor do chapéu (`corChapeu`); "#rrggbb" = cor fixa; "escuro:0.4" /
   * "claro:0.6" = a cor do chapéu escurecida/clareada nessa fração.
   */
  cor: string;
  rugosidade: number;
  metal: number;
  /** Brilho próprio (emissive na mesma cor): LED, auréola. */
  brilho: number;
  textura: TexturaDeChapeu | null;
  /** Gira em torno do eixo y que passa pelo pivô (a hélice); a geometria é relativa a ele. */
  giro: { pivo: [number, number, number]; vel: number } | null;
};

/** O que o chapéu precisa saber do avatar (medido do cabelo e do corte). */
export type CtxChapeuNovo = {
  /** Altura do corte (rel. ao centro da cabeça) nos que cobrem o alto; null nos enfeites. */
  corte: number | null;
  /** Topo do cabelo acima do alto da cabeça (m). */
  alturaCab: number;
  /** Largura do alto do cabelo (m). */
  largTopo: number;
  /** Largura do cabelo na altura das orelhas (m). */
  largLado: number;
};

/* ————————————————— Cores ————————————————— */

function hexParaRgb(h: string): [number, number, number] {
  const s = h.replace("#", "");
  const n = parseInt(s.length === 3 ? s.replace(/(.)/g, "$1$1") : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbParaHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Resolve a cor de uma peça ("" / "#hex" / "escuro:f" / "claro:f") com a cor do chapéu. */
export function corDaPeca(spec: string, corChapeu: string): string {
  if (!spec) return corChapeu;
  if (spec.startsWith("#")) return spec;
  const [tipo, val] = spec.split(":");
  const f = clamp01(Number(val) || 0);
  const [r, g, b] = hexParaRgb(corChapeu);
  if (tipo === "escuro") return rgbParaHex([r * (1 - f), g * (1 - f), b * (1 - f)]);
  return rgbParaHex([r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f]);
}

/* ————————————————— Oficina: uma grade por cor/acabamento ————————————————— */

type Acabamento = {
  rug?: number;
  metal?: number;
  brilho?: number;
  textura?: TexturaDeChapeu;
  giro?: PecaChapeu["giro"];
};

class Oficina {
  private readonly m = new Map<string, { g: Grade; cor: string; a: Acabamento }>();
  g(cor: string, a: Acabamento = {}): Grade {
    const giro = a.giro ? a.giro.pivo.join(",") : "";
    const chave = [cor, a.rug, a.metal, a.brilho, a.textura, giro].join("|");
    let e = this.m.get(chave);
    if (!e) {
      e = { g: new Grade(), cor, a };
      this.m.set(chave, e);
    }
    return e.g;
  }
  pecas(): PecaChapeu[] {
    return [...this.m.values()]
      .filter((e) => e.g.n > 0)
      .map((e) => ({
        geo: e.g.geometria(),
        cor: e.cor,
        rugosidade: e.a.rug ?? 0.8,
        metal: e.a.metal ?? 0,
        brilho: e.a.brilho ?? 0,
        textura: e.a.textura ?? null,
        giro: e.a.giro ?? null,
      }));
  }
}

/* ————————————————— Ferramentas de forma ————————————————— */

/** Ruído suave e determinístico (soma de senos) em [−1, 1]. */
function ruido(x: number, y: number, z: number) {
  return (
    0.5 * Math.sin(x * 1.7 + y * 2.3 + 0.4) * Math.sin(z * 1.9 - x * 0.7 + 1.1) +
    0.5 * Math.sin(y * 3.1 - z * 1.3 + 2.2) * Math.sin(x * 2.9 + z * 0.5)
  );
}

/** Superelipse: |a|^q com sinal (q < 1 deixa a volta mais "quadrada", de bloco). */
const sup = (a: number, q: number) => Math.sign(a) * Math.pow(Math.abs(a), q);

type CfgCasco = {
  /** Altura da borda de baixo (rel. ao centro da cabeça). */
  yBase: number;
  /** Folga da pele (m) no ângulo th, na fração s (0 = borda, 1 = alto), na direção d. */
  off: (th: number, s: number, d: Vector3) => number;
  tom?: (th: number, s: number) => number;
  /** Faixa de θ (padrão: a volta inteira, com costura). */
  th?: [number, number];
  /** Faixa de s (padrão 0–1). */
  s?: [number, number];
  nu: number;
  nv: number;
  uRep?: number;
  vEsc?: number;
};

/**
 * Casco que veste a cabeça (gorro, boné, capacete, bandana): cada ponto sai do
 * centro (0, yc, 0) no ângulo θ e na elevação φ — da borda (φ0, onde o casco
 * cruza `yBase`) até o alto — e pousa na iso-superfície do SDF da cabeça com
 * a folga pedida. Abraça o bloco arredondado de verdade.
 */
function casco(g: Grade, cab: CabecaSDF, c: CfgCasco) {
  const yc = Math.min(c.yBase, cab.t / 2 - 0.1);
  const o = new Vector3(0, yc, 0);
  const d = new Vector3();
  const [th0, th1] = c.th ?? [-PI, PI];
  const [s0, s1] = c.s ?? [0, 1];
  const fechar = !c.th;
  const phi0 = new Map<number, number>();
  const borda = (th: number) => {
    if (c.yBase <= yc + 1e-6) return 0;
    let lo = 0;
    let hi = PI / 2;
    for (let i = 0; i < 18; i++) {
      const m = (lo + hi) / 2;
      d.set(Math.sin(th) * Math.cos(m), Math.sin(m), Math.cos(th) * Math.cos(m));
      const r = cab.alcance(o, d, c.off(th, 0, d));
      if (yc + d.y * r < c.yBase) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  g.grade(
    c.nu,
    c.nv,
    (fu, fv, out) => {
      const th = lerp(th0, th1, fu);
      let p0 = phi0.get(fu);
      if (p0 === undefined) {
        p0 = borda(th);
        phi0.set(fu, p0);
      }
      const s = lerp(s0, s1, fv);
      const phi = lerp(p0, (PI / 2) * 0.999, s);
      d.set(Math.sin(th) * Math.cos(phi), Math.sin(phi), Math.cos(th) * Math.cos(phi));
      const r = cab.alcance(o, d, c.off(th, s, d));
      out.copy(o).addScaledVector(d, r);
      return c.tom ? c.tom(th, s) : 1;
    },
    c.uRep ?? 4,
    c.vEsc ?? 1,
    false,
    fechar,
  );
}

/** O ponto do casco em (th, s) — para pousar enfeites (laço, logo, bolinhas) nele. */
function pontoDoCasco(cab: CabecaSDF, c: CfgCasco, th: number, s: number): Vector3 {
  const g = new Grade();
  casco(g, cab, { ...c, th: [th, th + 1e-4], s: [s, s + 1e-4], nu: 1, nv: 1 });
  return new Vector3(g.pos[0], g.pos[1], g.pos[2]);
}

/**
 * Faixa horizontal colada na cabeça (punho do gorro, fita da boina, aro do
 * capacete): raios horizontais de (0, y, 0), y de y0 a y1, com folga off(th, f).
 */
function faixa(
  g: Grade,
  cab: CabecaSDF,
  y0: number,
  y1: number,
  off: (th: number, f: number) => number,
  tom: (th: number, f: number) => number,
  nu: number,
  nv: number,
  uRep = 8,
) {
  const o = new Vector3();
  const d = new Vector3();
  g.grade(
    nu,
    nv,
    (fu, fv, out) => {
      const th = fu * 2 * PI - PI;
      const y = lerp(y0, y1, fv);
      o.set(0, y, 0);
      d.set(Math.sin(th), 0, Math.cos(th));
      out.copy(o).addScaledVector(d, cab.alcance(o, d, off(th, fv)));
      return tom(th, fv);
    },
    uRep,
    0.3,
  );
}

/** Quadros (tangente, "normal" e "binormal") ao longo de uma curva, por transporte paralelo. */
function quadros(pts: Vector3[], ref?: Vector3) {
  const n = pts.length;
  const T: Vector3[] = [];
  const N: Vector3[] = [];
  const B: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(n - 1, i + 1)]!;
    T.push(b.clone().sub(a).normalize());
  }
  for (let i = 0; i < n; i++) {
    const t = T[i]!;
    let nn: Vector3;
    if (ref) nn = ref.clone().addScaledVector(t, -ref.dot(t));
    else if (i === 0) {
      nn = new Vector3(0, 1, 0).cross(t);
      if (nn.lengthSq() < 1e-6) nn = new Vector3(1, 0, 0).cross(t);
    } else nn = N[i - 1]!.clone().addScaledVector(t, -N[i - 1]!.dot(t));
    if (nn.lengthSq() < 1e-10) nn = new Vector3(0, 0, 1).cross(t);
    nn.normalize();
    N.push(nn);
    B.push(new Vector3().crossVectors(t, nn).normalize());
  }
  return { T, N, B };
}

/**
 * Tubo de raio variável sobre a curva `pts` (chifre, arco do fone, folha):
 * `achata` < 1 achata a seção na direção N (com `ref`, N aponta para ela).
 */
function tubo(
  g: Grade,
  pts: Vector3[],
  raio: (s: number) => number,
  nR: number,
  o: { achata?: number; ref?: Vector3; tom?: (s: number) => number; uRep?: number } = {},
) {
  const n = pts.length - 1;
  const { N, B } = quadros(pts, o.ref);
  const ach = o.achata ?? 1;
  g.grade(
    nR,
    n,
    (fu, fv, out) => {
      const i = Math.round(fv * n);
      const a = fu * 2 * PI;
      const r = raio(i / n);
      out
        .copy(pts[i]!)
        .addScaledVector(N[i]!, Math.cos(a) * r * ach)
        .addScaledVector(B[i]!, Math.sin(a) * r);
      return o.tom ? o.tom(i / n) : 1;
    },
    o.uRep ?? 1,
    1,
  );
}

/** Curva suave pelos pontos de controle. */
function curva(ctrl: Vector3[], n: number, fechada = false): Vector3[] {
  const c = new CatmullRomCurve3(ctrl, fechada, "centripetal");
  return fechada ? c.getSpacedPoints(n) : c.getPoints(n);
}

/**
 * Elipsoide orientado: centro c, eixo "frente" n (raio rn), e os dois outros
 * (ru na direção u, rv na outra); `forma` deforma o raio (pompom fofo).
 */
function bola(
  g: Grade,
  c: Vector3,
  n: Vector3,
  ru: number,
  rv: number,
  rn: number,
  nu: number,
  nv: number,
  o: { u?: Vector3; forma?: (d: Vector3) => number; tom?: (d: Vector3) => number } = {},
) {
  const w = n.clone().normalize();
  const u0 = o.u ?? (Math.abs(w.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0));
  const u = u0.clone().addScaledVector(w, -u0.dot(w));
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0).addScaledVector(w, -w.x);
  u.normalize();
  const v = new Vector3().crossVectors(w, u).normalize();
  const d = new Vector3();
  g.grade(
    nu,
    nv,
    (fu, fv, out) => {
      const th = fu * 2 * PI;
      const ph = fv * PI;
      // local: (u, v, w) com o polo em +w
      const lu = Math.sin(ph) * Math.cos(th);
      const lv = Math.sin(ph) * Math.sin(th);
      const lw = Math.cos(ph);
      d.set(lu, lv, lw);
      const k = o.forma ? o.forma(d) : 1;
      out
        .copy(c)
        .addScaledVector(u, lu * ru * k)
        .addScaledVector(v, lv * rv * k)
        .addScaledVector(w, lw * rn * k);
      return o.tom ? o.tom(d) : 1;
    },
    2,
    1,
  );
}

/**
 * Volta de torno (copa de chapéu): o perfil [k, h] (fração do raio da base, altura acima
 * da base) girado em volta do eixo y, na base elíptica (rx, rz) com expoente de bloco q.
 */
function torno(
  g: Grade,
  rx: number,
  rz: number,
  base: number,
  perfil: [number, number][],
  nu: number,
  nv: number,
  o: {
    q?: number;
    tom?: (th: number, fv: number) => number;
    forma?: (th: number, fv: number) => number;
    uRep?: number;
    xf?: (p: Vector3) => void;
  } = {},
) {
  const pts = curva(
    perfil.map(([k, h]) => new Vector3(k, h, 0)),
    nv,
  );
  const q = o.q ?? 1;
  g.grade(
    nu,
    nv,
    (fu, fv, out) => {
      const th = fu * 2 * PI - PI;
      const p = pts[Math.round(fv * nv)]!;
      const k = Math.max(0, p.x) * (o.forma ? o.forma(th, fv) : 1);
      out.set(sup(Math.sin(th), q) * rx * k, base + p.y, sup(Math.cos(th), q) * rz * k);
      o.xf?.(out);
      return o.tom ? o.tom(th, fv) : 1;
    },
    o.uRep ?? 6,
    1,
  );
}

/**
 * A aba de um chapéu novo (`ABAS_NOVAS`): anel com espessura e borda
 * arredondada, da copa (rx0, rz0) até a borda (rxA, rzA), na altura `sobe`.
 * `franja` = borda desfiada (palha). Tom: em cima 1,06, embaixo 0,8; `tom`
 * multiplica (costuras).
 */
function abaNova(
  g: Grade,
  aba: AbaNova,
  e: number,
  base: number,
  alta: boolean,
  o: { franja?: boolean; tom?: (th: number, f: number) => number; uRep?: number } = {},
) {
  const nu = alta ? 96 : 56;
  const nR = alta ? 8 : 5;
  const perfil: [number, number][] = [];
  for (let i = 0; i <= nR; i++) perfil.push([i / nR, 1]);
  perfil.push([1.012, 0.5], [1.016, 0], [1.012, -0.5]);
  for (let i = nR; i >= 0; i--) perfil.push([i / nR, -1]);
  const nP = perfil.length - 1;
  const esp = aba.esp * e;
  g.grade(
    nu,
    nP,
    (fu, fv, out) => {
      const th = fu * 2 * PI - PI;
      const sx = Math.sin(th);
      const cz = Math.cos(th);
      const [f, lado] = perfil[Math.round(fv * nP)]!;
      let rx = lerp(aba.rx0 * 0.96 * e, aba.rxA * e, f);
      let rz = lerp(aba.rz0 * 0.96 * e, aba.rzA * e, f);
      if (o.franja && f > 0.9) {
        // palha desfiada: a borda serrilhada (vértice sim, vértice não) e ondulada
        const serra = (Math.round(fu * nu) % 2 ? 1 : -1) * 0.006 * e;
        const onda = 0.008 * e * Math.sin(th * 7 + 0.5);
        const w = sstep(0.9, 1.01, f);
        rx += (serra + onda) * w;
        rz += (serra + onda) * w;
      }
      const ff = Math.min(1, f);
      out.set(
        sx * rx,
        base + 0.004 + aba.sobe(sx, cz, ff) * e + lado * esp * (f > 1 ? 0.6 : 1),
        cz * rz,
      );
      return (lado < 0 ? 0.8 : 1.06) * (o.tom ? o.tom(th, ff) : 1);
    },
    o.uRep ?? 10,
    1,
  );
}

/**
 * Pala de boné/capacete: placa curva na frente, da borda do casco para fora
 * (comprimento L, cai `queda` na ponta e curva para baixo nos lados).
 */
function pala(
  g: Grade,
  borda: (th: number) => Vector3,
  e: number,
  o: { abre: number; L: number; queda: number; curva: number; esp: number; n: number },
) {
  const perfil: [number, number][] = [];
  const nR = 5;
  for (let i = 0; i <= nR; i++) perfil.push([i / nR, 1]);
  perfil.push([1.01, 0.5], [1.015, 0], [1.01, -0.5]);
  for (let i = nR; i >= 0; i--) perfil.push([i / nR, -1]);
  const nP = perfil.length - 1;
  const raiz = new Map<number, Vector3>();
  g.grade(
    o.n,
    nP,
    (fu, fv, out) => {
      const a = fu * 2 - 1;
      const th = a * o.abre;
      let p0 = raiz.get(fu);
      if (!p0) {
        p0 = borda(th);
        raiz.set(fu, p0);
      }
      const [f, lado] = perfil[Math.round(fv * nP)]!;
      // ponta arredondada: mais curta nos cantos
      const L = o.L * e * Math.sqrt(Math.max(0.05, 1 - 0.6 * a * a));
      const ff = Math.min(1, f);
      const dir = new Vector3(Math.sin(th) * 0.45, 0, 1).normalize();
      out
        .copy(p0)
        .addScaledVector(dir, L * f)
        .add(
          new Vector3(
            0,
            -o.queda * e * ff * ff - o.curva * e * a * a * ff + lado * o.esp * e * 0.5,
            -0.004 * e,
          ),
        );
      return lado < 0 ? 0.72 : 1.04;
    },
    1,
    1,
    false,
    false,
  );
}

/* ————————————————— Os chapéus ————————————————— */

type Fabrica = (of: Oficina, k: Kit) => void;

/** O que toda receita usa: medidas, cabeça, contexto e qualidade. */
type Kit = {
  t: number;
  e: number;
  topo: number;
  zF: number;
  cab: CabecaSDF;
  c: CtxChapeuNovo;
  alta: boolean;
  /** Corte efetivo (os que cobrem o alto sempre têm). */
  base: number;
};

/** Gorro de tricô com punho dobrado, caidinho atrás, e pompom fofo. */
const gorroPompom: Fabrica = (of, k) => {
  const { e, base, cab, alta } = k;
  const malha = of.g("", { textura: "gorro", rug: 1 });
  // punho dobrado: 5 cm de ribana, um pouco mais grosso, com as bordas arredondadas
  faixa(
    malha,
    cab,
    base - 0.004 * e,
    base + 0.05 * e,
    (_th, f) => (0.03 + 0.007 * Math.sin(PI * f)) * e,
    (_th, f) => 0.9 - 0.12 * (1 - Math.sin(PI * f)),
    alta ? 72 : 40,
    alta ? 6 : 4,
    12,
  );
  // corpo: sobe do punho, mais folgado no alto e caidinho atrás (slouch)
  const corpo: CfgCasco = {
    yBase: base + 0.045 * e,
    off: (th, s) =>
      (0.026 +
        0.04 * Math.sin((PI / 2) * s) ** 2 +
        0.02 * Math.max(0, -Math.cos(th)) * Math.sin(PI * s) * (1 - s)) *
      e,
    tom: (_th, s) => lerp(0.95, 1.05, s),
    nu: alta ? 72 : 40,
    nv: alta ? 12 : 7,
    uRep: 10,
  };
  casco(malha, cab, corpo);
  // pompom: bola fofa (raio com calombos) no alto
  const alto = pontoDoCasco(cab, corpo, 0, 1);
  bola(
    of.g("claro:0.85", { rug: 1 }),
    new Vector3(0, alto.y + 0.05 * e, -0.012 * e),
    new Vector3(0, 1, 0),
    0.068 * e,
    0.068 * e,
    0.064 * e,
    alta ? 28 : 16,
    alta ? 18 : 10,
    {
      forma: (d) => 1 + 0.09 * ruido(d.x * 9, d.y * 9, d.z * 9),
      tom: (d) => 0.85 + 0.2 * (0.5 + 0.5 * ruido(d.x * 14, d.y * 14, d.z * 14)),
    },
  );
};

/** Boné trucker: frente alta branca de espuma, tela atrás, pala curva e um pinheirinho bordado. */
const boneTrucker: Fabrica = (of, k) => {
  const { e, base, cab, alta } = k;
  const off = (th: number, s: number) =>
    (0.032 + 0.024 * sstep(0, 0.7, s) + 0.016 * Math.max(0, Math.cos(th)) * Math.sin(PI * s)) * e;
  const nu = alta ? 40 : 22;
  const nv = alta ? 12 : 7;
  const frente: CfgCasco = { yBase: base, off, th: [-0.95, 0.95], nu, nv, uRep: 2 };
  casco(of.g("#f8fafc", { rug: 0.95 }), cab, frente);
  // a tela de trás (sarja na textura; o tom faz os gomos)
  casco(of.g("", { textura: "bone", rug: 0.9 }), cab, {
    yBase: base,
    off,
    th: [0.95, 2 * PI - 0.95],
    nu: alta ? 56 : 30,
    nv,
    uRep: 6,
    tom: (th) => 0.86 + 0.06 * Math.cos(th * 6),
  });
  const cor = of.g("", { rug: 0.85 });
  // botão do alto
  const alto = pontoDoCasco(cab, frente, 0, 1);
  bola(cor, alto, new Vector3(0, 1, 0), 0.017 * e, 0.017 * e, 0.009 * e, 12, 6);
  // pala
  pala(cor, (th) => pontoDoCasco(cab, frente, th, 0), e, {
    abre: 0.78,
    L: 0.18,
    queda: 0.02,
    curva: 0.035,
    esp: 0.01,
    n: alta ? 18 : 10,
  });
  // o pinheirinho bordado na frente (silvicultura): três andares e o tronquinho
  const centro = pontoDoCasco(cab, frente, 0, 0.32);
  const nrm = new Vector3(0, 0.25, 1).normalize();
  const verde = of.g("#15803d", { rug: 0.9 });
  bola(
    of.g("#14532d", { rug: 0.9 }),
    centro.clone().addScaledVector(nrm, 0.002),
    nrm,
    0.058 * e,
    0.052 * e,
    0.004 * e,
    16,
    8,
  );
  for (let i = 0; i < 3; i++) {
    const y0 = -0.036 + i * 0.022;
    const larg = (0.036 - i * 0.008) * e;
    const p0 = centro
      .clone()
      .add(new Vector3(0, y0 * e, 0))
      .addScaledVector(nrm, 0.006 * e);
    const pts = [0, 0.5, 1].map((s) => p0.clone().add(new Vector3(0, 0.036 * e * s, 0)));
    tubo(verde, curva(pts, 6), (s) => larg * (1 - s) + 0.001, 8, {
      achata: 0.25,
      ref: nrm,
    });
  }
};

/** Capacete florestal (EPI): casco com nervura, viseira de tela e abafadores. */
const capaceteFlorestal: Fabrica = (of, k) => {
  const { e, base, cab, alta, c, t, zF } = k;
  const casca = of.g("", { textura: "capacete", rug: 0.35 });
  const shell: CfgCasco = {
    yBase: base - 0.008 * e,
    off: (_th, s) => (0.042 + 0.02 * Math.sin((PI / 2) * s) + 0.035 * s ** 3) * e,
    nu: alta ? 72 : 40,
    nv: alta ? 14 : 8,
    uRep: 3,
  };
  casco(casca, cab, shell);
  // nervura do meio, da testa à nuca (o capacete de obra/floresta)
  {
    const yc = Math.min(shell.yBase, k.t / 2 - 0.1);
    const o = new Vector3(0, yc, 0);
    const d = new Vector3();
    casca.grade(
      6,
      alta ? 24 : 14,
      (fu, fv, out) => {
        const b = lerp(0.35, PI - 0.35, fv);
        const lado = Math.cos(fu * PI);
        d.set(lado * 0.07, Math.sin(b), Math.cos(b)).normalize();
        const s = clamp01((Math.asin(Math.min(1, d.y)) - 0.2) / (PI / 2 - 0.2));
        const alto = Math.sin(fu * PI) * Math.sqrt(Math.sin(fv * PI));
        const off = shell.off(0, s, d) + (0.002 + 0.012 * alto) * e;
        out.copy(o).addScaledVector(d, cab.alcance(o, d, off));
        return 0.92 + 0.12 * alto;
      },
      1,
      1,
      false,
      false,
    );
  }
  // aro de baixo, mais grosso
  faixa(
    casca,
    cab,
    base - 0.03 * e,
    base - 0.008 * e,
    (_th, f) => (0.052 + 0.006 * Math.sin(PI * f)) * e,
    () => 0.85,
    alta ? 72 : 40,
    3,
  );
  // pala curta na frente
  pala(casca, (th) => pontoDoCasco(cab, shell, th, 0), e, {
    abre: 0.9,
    L: 0.06,
    queda: 0.01,
    curva: 0.01,
    esp: 0.012,
    n: alta ? 16 : 9,
  });
  // abafadores: conchas na cor do capacete, almofada preta, haste preta
  const xc = Math.max(t / 2 + 0.05 * e, c.largLado / 2 + 0.03 * e);
  const preto = of.g("#111827", { rug: 0.6 });
  for (const l of [-1, 1]) {
    bola(
      casca,
      new Vector3(l * (xc + 0.012 * e), -0.01 * e, 0),
      new Vector3(l, 0, 0),
      0.078 * e,
      0.066 * e,
      0.036 * e,
      alta ? 24 : 14,
      alta ? 12 : 8,
      { u: new Vector3(0, 1, 0) },
    );
    bola(
      preto,
      new Vector3(l * (xc - 0.022 * e), -0.01 * e, 0),
      new Vector3(l, 0, 0),
      0.07 * e,
      0.06 * e,
      0.018 * e,
      alta ? 20 : 12,
      8,
      { u: new Vector3(0, 1, 0) },
    );
    const topoAro = new Vector3(l * (t / 2 + 0.05 * e), base - 0.02 * e, 0);
    tubo(
      preto,
      curva(
        [
          topoAro,
          new Vector3(l * (xc + 0.02 * e), lerp(base, 0.07 * e, 0.5), 0),
          new Vector3(l * (xc + 0.03 * e), 0.06 * e, 0),
        ],
        8,
      ),
      () => 0.009 * e,
      8,
    );
  }
  // viseira de tela: arco de cilindro na frente do rosto, da aba até o queixo
  const zc = -0.02 * e;
  const R = zF + 0.085 * e - zc;
  const ang = 0.92;
  const yA = base - 0.02 * e;
  const yB = -0.15 * e;
  const tela = of.g("#374151", { metal: 0.5, rug: 0.4 });
  const ponto = (a: number, y: number, dr = 0) =>
    new Vector3(Math.sin(a) * (R + dr), y, zc + Math.cos(a) * (R + dr));
  const nV = alta ? 17 : 11;
  const nH = alta ? 10 : 7;
  const fio = 0.0028 * e;
  for (let i = 0; i < nV; i++) {
    const a = lerp(-ang, ang, i / (nV - 1));
    tela.grade(
      1,
      1,
      (fu, fv, out) => {
        out.copy(ponto(a + ((fu - 0.5) * 2 * fio) / R, lerp(yA, yB, fv)));
        return 1;
      },
      1,
      1,
      false,
      false,
    );
  }
  for (let j = 0; j < nH; j++) {
    const y = lerp(yA, yB, j / (nH - 1));
    tela.grade(
      alta ? 24 : 14,
      1,
      (fu, fv, out) => {
        out.copy(ponto(lerp(-ang, ang, fu), y + (fv - 0.5) * 2 * fio, 0.001));
        return 1;
      },
      1,
      1,
      false,
      false,
    );
  }
  // moldura da viseira e as hastes até o eixo do abafador
  const moldura = of.g("#111827", { rug: 0.5 });
  const arco = (y: number) =>
    curva(
      Array.from({ length: 9 }, (_, i) => ponto(lerp(-ang, ang, i / 8), y, 0.002)),
      alta ? 28 : 16,
    );
  tubo(moldura, arco(yA), () => 0.009 * e, 6, { achata: 0.5 });
  tubo(moldura, arco(yB), () => 0.005 * e, 6);
  for (const l of [-1, 1]) {
    const lado = ponto(l * ang, yA, 0.002);
    tubo(
      moldura,
      curva([ponto(l * ang, yB, 0.002), ponto(l * ang, (yA + yB) / 2, 0.002), lado], 8),
      () => 0.006 * e,
      6,
    );
    tubo(
      moldura,
      curva([lado, new Vector3(l * (xc + 0.035 * e), 0.02 * e, 0.0)], 6),
      () => 0.007 * e,
      6,
    );
  }
};

/** Coroa de folhas (louro/eucalipto) com florzinhas na cor do chapéu. */
const coroaFolhas: Fabrica = (of, k) => {
  const { e, t, topo, c, alta } = k;
  const dy = Math.max(0, c.alturaCab - 0.335 * t);
  const rx = Math.max(0.272 * e, c.largTopo * 0.47);
  const rz = rx * 0.93;
  const y0 = topo - 0.035 * e + dy;
  const anel = (th: number, dr = 0) =>
    new Vector3(Math.sin(th) * (rx + dr), y0 - 0.022 * e * Math.cos(th), Math.cos(th) * (rz + dr));
  const nAnel = alta ? 40 : 24;
  const pts = Array.from({ length: nAnel }, (_, i) => anel((i / nAnel) * 2 * PI));
  tubo(of.g("#713f12", { rug: 0.9 }), curva(pts, nAnel * 2, true), () => 0.008 * e, 6);
  const tons = ["#3f6212", "#65a30d", "#4d7c0f"];
  const nFolhas = alta ? 34 : 22;
  for (let i = 0; i < nFolhas; i++) {
    const th = (i / nFolhas) * 2 * PI;
    const p = anel(th);
    const tan = anel(th + 0.05)
      .sub(anel(th - 0.05))
      .normalize();
    const fora = new Vector3(Math.sin(th), 0, Math.cos(th));
    const lado = i % 2 ? 1 : -1;
    // a folha sai para trás ao longo do anel, alternando para cima e para baixo
    const dir = tan
      .clone()
      .multiplyScalar(-0.8)
      .add(new Vector3(0, 0.55 * lado, 0))
      .addScaledVector(fora, 0.25)
      .normalize();
    const L = (0.07 + 0.012 * Math.sin(i * 2.3)) * e;
    const meio = p
      .clone()
      .addScaledVector(dir, L * 0.5)
      .addScaledVector(fora, 0.008 * e);
    const ponta = p
      .clone()
      .addScaledVector(dir, L)
      .addScaledVector(fora, 0.02 * e)
      .add(new Vector3(0, -0.006 * e * lado, 0));
    tubo(
      of.g(tons[i % 3]!, { rug: 0.7 }),
      curva([p, meio, ponta], 8),
      (s) => (0.019 * Math.pow(Math.sin(PI * Math.min(1, s * 0.92 + 0.04)), 0.75) + 0.0005) * e,
      8,
      { achata: 0.16, ref: fora },
    );
  }
  // florzinhas (5 bolinhas de pétala + miolo) na frente e dos lados
  for (const th of [-1.5, -0.75, 0, 0.75, 1.5]) {
    const p = anel(th, 0.012 * e);
    const fora = new Vector3(Math.sin(th), 0.3, Math.cos(th)).normalize();
    const u = new Vector3(0, 1, 0).addScaledVector(fora, -fora.y).normalize();
    const v = new Vector3().crossVectors(fora, u);
    for (let j = 0; j < 5; j++) {
      const a = (j / 5) * 2 * PI;
      const q = p
        .clone()
        .addScaledVector(u, Math.cos(a) * 0.013 * e)
        .addScaledVector(v, Math.sin(a) * 0.013 * e);
      bola(of.g("", { rug: 0.6 }), q, fora, 0.01 * e, 0.01 * e, 0.005 * e, 8, 5);
    }
    bola(
      of.g("#facc15", { rug: 0.6 }),
      p.clone().addScaledVector(fora, 0.004 * e),
      fora,
      0.007 * e,
      0.007 * e,
      0.005 * e,
      8,
      5,
    );
  }
};

/** Bandana de pirata: lenço justo no alto, nó atrás com as duas pontas caindo, poá branco. */
const bandana: Fabrica = (of, k) => {
  const { e, base, cab, alta } = k;
  const pano = of.g("", { rug: 0.9 });
  const corpo: CfgCasco = {
    yBase: base,
    off: (_th, s) => (0.015 + 0.004 * s) * e,
    tom: (th, s) => 1 - 0.05 * Math.sin(th * 5 + s * 6) * Math.sin(PI * s),
    nu: alta ? 64 : 36,
    nv: alta ? 12 : 7,
    uRep: 3,
  };
  casco(pano, cab, corpo);
  // bainha
  faixa(
    pano,
    cab,
    base - 0.004 * e,
    base + 0.014 * e,
    (_th, f) => (0.019 + 0.002 * Math.sin(PI * f)) * e,
    () => 0.84,
    alta ? 64 : 36,
    3,
  );
  // nó atrás
  const no = pontoDoCasco(cab, corpo, PI, 0.06);
  const tras = new Vector3(0, 0, -1);
  for (const l of [-1, 1])
    bola(
      pano,
      no.clone().add(new Vector3(l * 0.022 * e, 0.002 * e, -0.018 * e)),
      tras,
      0.028 * e,
      0.03 * e,
      0.022 * e,
      14,
      8,
      { tom: () => 0.9 },
    );
  // as duas pontas, caindo e abrindo
  for (const l of [-1, 1]) {
    const pts = curva(
      [
        no.clone().add(new Vector3(l * 0.012 * e, -0.008 * e, -0.03 * e)),
        no.clone().add(new Vector3(l * 0.045 * e, -0.07 * e, -0.06 * e)),
        no.clone().add(new Vector3(l * 0.07 * e, -0.14 * e, -0.062 * e)),
      ],
      alta ? 12 : 8,
    );
    tubo(pano, pts, (s) => (0.03 * (1 - 0.35 * s) * (1 - sstep(0.8, 1, s) * 0.95) + 0.001) * e, 8, {
      achata: 0.14,
      ref: tras,
      tom: (s) => lerp(0.85, 1, s),
    });
  }
  // poá
  const poa = of.g("#f8fafc", { rug: 0.9 });
  const n = alta ? 26 : 16;
  for (let i = 0; i < n; i++) {
    // espalhado por área (mais bolinhas embaixo, onde a volta é maior)
    const s = Math.asin(lerp(0.12, 0.93, (i + 0.5) / n)) / (PI / 2);
    const th = i * 2.39996 + 0.7;
    const p = pontoDoCasco(cab, corpo, th, s);
    const nrm = p
      .clone()
      .sub(new Vector3(0, base - 0.05 * e, 0))
      .normalize();
    bola(
      poa,
      p.clone().addScaledVector(nrm, 0.0015 * e),
      nrm,
      0.014 * e,
      0.014 * e,
      0.002 * e,
      10,
      4,
    );
  }
};

/** Boina: a "almofada" tombada de lado sobre uma fita, com o cabinho no alto. */
const boina: Fabrica = (of, k) => {
  const { e, base, cab, alta } = k;
  faixa(
    of.g("escuro:0.3", { rug: 0.85 }),
    cab,
    base - 0.003 * e,
    base + 0.03 * e,
    (_th, f) => (0.02 + 0.003 * Math.sin(PI * f)) * e,
    () => 1,
    alta ? 64 : 36,
    3,
  );
  const C = new Vector3(0.028 * e, base + 0.038 * e, -0.012 * e);
  const giroZ = -0.16;
  const giroX = -0.07;
  const H = 0.068 * e;
  const xf = (p: Vector3) => {
    p.sub(C);
    const x1 = p.x * Math.cos(giroZ) - p.y * Math.sin(giroZ);
    const y1 = p.x * Math.sin(giroZ) + p.y * Math.cos(giroZ);
    const y2 = y1 * Math.cos(giroX) - p.z * Math.sin(giroX);
    const z2 = y1 * Math.sin(giroX) + p.z * Math.cos(giroX);
    p.set(x1, y2, z2).add(C);
  };
  // perfil fechado: do centro de cima até a borda e de volta por baixo (mais chato embaixo)
  const perfil: [number, number][] = [];
  const nA = alta ? 12 : 8;
  for (let i = 0; i <= nA; i++) {
    const a = (i / nA) * PI;
    const r = Math.pow(Math.sin(a), 0.42);
    // embaixo desce mais fundo: a almofada cai até a fita (sem fresta de lado)
    const y = Math.cos(a) * (a > PI / 2 ? 1.1 : 1);
    perfil.push([r, y]);
  }
  const g = of.g("", { textura: "gorro", rug: 1 });
  g.grade(
    alta ? 64 : 36,
    nA,
    (fu, fv, out) => {
      const th = fu * 2 * PI - PI;
      const [r, y] = perfil[Math.round(fv * nA)]!;
      out.set(C.x + Math.sin(th) * 0.285 * e * r, C.y + y * H, C.z + Math.cos(th) * 0.27 * e * r);
      xf(out);
      return lerp(0.88, 1.04, (y + 1) / 2);
    },
    4,
    1,
  );
  // o cabinho, no alto da almofada tombada (o "para cima" dela também tomba)
  const cabo = C.clone().add(new Vector3(0, H, 0));
  xf(cabo);
  const cima = C.clone().add(new Vector3(0, 1, 0));
  xf(cima);
  cima.sub(C).normalize();
  tubo(
    of.g("escuro:0.15", { rug: 1 }),
    curva(
      [
        cabo.clone().addScaledVector(cima, -0.004 * e),
        cabo.clone().addScaledVector(cima, 0.026 * e),
      ],
      4,
    ),
    (s) => (0.008 - 0.002 * s) * e,
    8,
  );
};

/** Chapéu de chef: faixa pregueada e o "cogumelo" fofo de gomos. */
const chapeuChef: Fabrica = (of, k) => {
  const { e, t, zF, base, alta } = k;
  const branco = of.g("#f8fafc", { rug: 0.95 });
  const rx = t / 2 + 0.022 * e;
  const rz = zF + 0.022 * e;
  const hFaixa = 0.1 * e;
  torno(
    branco,
    rx,
    rz,
    base - 0.004 * e,
    [
      [1, 0],
      [1, hFaixa * 0.5],
      [1, hFaixa],
    ],
    alta ? 72 : 40,
    3,
    { q: 0.62, tom: (th) => 0.93 + 0.06 * Math.cos(th * 28) },
  );
  // o cogumelo: elipsoide que sai da faixa, estufa 25% e fecha em cima, com 9 gomos
  const Yc = base + hFaixa + 0.1 * e;
  // (começa por dentro da faixa: de cima não aparece fresta entre ela e o cogumelo)
  const perfil: [number, number][] = [[0.97, hFaixa - 0.012 * e]];
  const nA = alta ? 14 : 9;
  for (let i = 0; i <= nA; i++) {
    const a = lerp(-0.62, PI / 2, i / nA);
    perfil.push([1.2 * Math.cos(a), Yc + 0.17 * e * Math.sin(a) - base]);
  }
  torno(branco, rx, rz, base, perfil, alta ? 72 : 40, alta ? 16 : 10, {
    q: 0.75,
    forma: (th, fv) => 1 + 0.07 * Math.cos(th * 9) * (1 - fv) ** 0.7,
    tom: (th, fv) => 0.92 + 0.1 * (0.5 + 0.5 * Math.cos(th * 9)) * (1 - fv) + 0.04 * fv,
  });
};

/** Chapéu de festa: cone listrado e tombado, babado dourado e pompom. */
const chapeuFesta: Fabrica = (of, k) => {
  const { e, topo, c, alta } = k;
  const B = new Vector3(0.035 * e, topo + Math.max(0, c.alturaCab * 0.75) - 0.006 * e, 0);
  const giro = -0.2;
  const R = 0.13 * e;
  const H = 0.3 * e;
  const xf = (p: Vector3) => {
    p.sub(B);
    const x = p.x * Math.cos(giro) - p.y * Math.sin(giro);
    const y = p.x * Math.sin(giro) + p.y * Math.cos(giro);
    p.set(x, y, p.z).add(B);
  };
  const nFaixas = 6;
  for (let i = 0; i < nFaixas; i++) {
    const g = of.g(i % 2 ? "#f8fafc" : "", { rug: 0.6 });
    g.grade(
      alta ? 40 : 24,
      2,
      (fu, fv, out) => {
        const th = fu * 2 * PI;
        const s = (i + fv) / nFaixas;
        out.set(B.x + Math.sin(th) * R * (1 - s), B.y + H * s, B.z + Math.cos(th) * R * (1 - s));
        xf(out);
        return 1;
      },
      2,
      1,
    );
  }
  // babado dourado na base
  const ouro = of.g("#facc15", { rug: 0.4, metal: 0.3 });
  const nB = alta ? 48 : 28;
  const anel = Array.from({ length: nB }, (_, i) => {
    const th = (i / nB) * 2 * PI;
    const p = new Vector3(
      B.x + Math.sin(th) * (R + 0.006 * e),
      B.y + 0.008 * e * (i % 2 ? 1 : -1),
      B.z + Math.cos(th) * (R + 0.006 * e),
    );
    xf(p);
    return p;
  });
  tubo(ouro, curva(anel, nB * 2, true), () => 0.012 * e, 6);
  // pompom no bico
  const bico = new Vector3(B.x, B.y + H + 0.02 * e, B.z);
  xf(bico);
  bola(ouro, bico, new Vector3(0, 1, 0), 0.034 * e, 0.034 * e, 0.034 * e, 18, 10, {
    forma: (d) => 1 + 0.12 * ruido(d.x * 11, d.y * 11, d.z * 11),
  });
};

/** Boné de hélice (o clássico do Roblox): gomos coloridos, pala e a hélice que gira. */
const boneHelice: Fabrica = (of, k) => {
  const { e, base, cab, alta } = k;
  const off = (_th: number, s: number) => (0.02 + 0.012 * s) * e;
  const gomos = ["", "#2563eb", "#dc2626", "#16a34a"];
  gomos.forEach((cor, i) => {
    const a0 = -PI / 4 + (i * PI) / 2;
    casco(of.g(cor, { rug: 0.7 }), cab, {
      yBase: base,
      off,
      th: [a0, a0 + PI / 2],
      nu: alta ? 18 : 10,
      nv: alta ? 12 : 7,
      uRep: 2,
    });
  });
  const cfg: CfgCasco = { yBase: base, off, nu: 1, nv: 1 };
  pala(of.g("", { rug: 0.7 }), (th) => pontoDoCasco(cab, cfg, th, 0), e, {
    abre: 0.7,
    L: 0.1,
    queda: 0.012,
    curva: 0.02,
    esp: 0.009,
    n: alta ? 14 : 8,
  });
  const alto = pontoDoCasco(cab, cfg, 0, 1);
  const hub = alto.clone().add(new Vector3(0, 0.05 * e, 0));
  tubo(
    of.g("#d1d5db", { metal: 0.6, rug: 0.35 }),
    [alto.clone().add(new Vector3(0, -0.005 * e, 0)), hub.clone()],
    () => 0.008 * e,
    8,
  );
  // a hélice: relativa ao pivô (o eixo dela), gira no componente
  const giro: PecaChapeu["giro"] = { pivo: [hub.x, hub.y, hub.z], vel: 9 };
  const pas = of.g("#facc15", { rug: 0.5, giro });
  bola(pas, new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0.016 * e, 0.016 * e, 0.014 * e, 12, 8);
  for (const l of [-1, 1]) {
    // pá torcida (passo da hélice): elipsoide comprido em x, inclinado em volta do próprio eixo
    const passo = 0.35 * l;
    const n = new Vector3(0, Math.cos(passo), Math.sin(passo));
    bola(
      of.g("#dc2626", { rug: 0.5, giro }),
      new Vector3(l * 0.075 * e, 0, 0),
      n,
      0.068 * e,
      0.022 * e,
      0.005 * e,
      alta ? 18 : 12,
      8,
      { u: new Vector3(1, 0, 0) },
    );
  }
};

/** Auréola: anel dourado que brilha, flutuando acima do cabelo. */
const aureola: Fabrica = (of, k) => {
  const { e, topo, c, alta } = k;
  const y = topo + Math.max(0.05 * e, c.alturaCab) + 0.065 * e;
  const inc = 0.18;
  const n = alta ? 48 : 28;
  const pts = Array.from({ length: n }, (_, i) => {
    const th = (i / n) * 2 * PI;
    const zz = Math.cos(th) * 0.15 * e;
    return new Vector3(Math.sin(th) * 0.17 * e, y + zz * Math.sin(inc), zz * Math.cos(inc));
  });
  tubo(
    of.g("#fde047", { brilho: 0.9, metal: 0.3, rug: 0.3 }),
    curva(pts, n * 2, true),
    () => 0.016 * e,
    10,
  );
};

/** Fone gamer com orelhas de gato: arco, conchas brancas e o LED na cor do chapéu. */
const foneGatinho: Fabrica = (of, k) => {
  const { e, t, topo, c, alta } = k;
  const xc = Math.max(t / 2 + 0.045 * e, c.largLado / 2 + 0.025 * e);
  const yTopo = topo + Math.max(0.025 * e, c.alturaCab * 0.9) + 0.018 * e;
  const yc = -0.01 * e;
  const arcoEm = (a: number) => new Vector3(xc * Math.sin(a), yc + (yTopo - yc) * Math.cos(a), 0.0);
  const branco = of.g("#f8fafc", { rug: 0.45 });
  const led = of.g("", { brilho: 0.85, rug: 0.4 });
  const pts = curva(
    Array.from({ length: 13 }, (_, i) => arcoEm(lerp(-PI / 2, PI / 2, i / 12))),
    alta ? 40 : 24,
  );
  tubo(branco, pts, () => 0.02 * e, 10, { achata: 0.5, ref: new Vector3(0, 0, 1) });
  for (const l of [-1, 1]) {
    const cc = new Vector3(l * (xc + 0.01 * e), yc, 0);
    bola(
      branco,
      cc,
      new Vector3(l, 0, 0),
      0.085 * e,
      0.075 * e,
      0.042 * e,
      alta ? 24 : 14,
      alta ? 12 : 8,
      {
        u: new Vector3(0, 1, 0),
      },
    );
    // anel de LED na face de fora da concha
    const n = 24;
    const anel = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * 2 * PI;
      return new Vector3(
        cc.x + l * 0.032 * e,
        cc.y + Math.cos(a) * 0.06 * e,
        cc.z + Math.sin(a) * 0.052 * e,
      );
    });
    tubo(led, curva(anel, 48, true), () => 0.008 * e, 6);
    // orelha: pirâmide achatada no arco, com o miolo de LED
    const a = l * 0.52;
    const p = arcoEm(a);
    const fora = p
      .clone()
      .sub(new Vector3(0, yc, 0))
      .normalize();
    const fora2 = fora
      .clone()
      .add(new Vector3(l * 0.15, 0.1, 0))
      .normalize();
    tubo(
      branco,
      [p.clone().addScaledVector(fora2, -0.01 * e), p.clone().addScaledVector(fora2, 0.115 * e)],
      (s) => (0.06 * (1 - s) + 0.002) * e,
      4,
      { achata: 0.35, ref: new Vector3(0, 0, 1) },
    );
    const pi = p.clone().add(new Vector3(0, 0, 0.014 * e));
    tubo(
      led,
      [pi.clone().addScaledVector(fora2, 0.005 * e), pi.clone().addScaledVector(fora2, 0.085 * e)],
      (s) => (0.036 * (1 - s) + 0.001) * e,
      4,
      { achata: 0.3, ref: new Vector3(0, 0, 1) },
    );
  }
};

/** Copa redonda de palha + aba larga desfiada + fita na cor do chapéu. */
const chapeuPalha: Fabrica = (of, k) => {
  const { e, base, alta } = k;
  const aba = ABAS_NOVAS.chapeuPalha;
  const palha = of.g("#dcb874", { textura: "chapeu", rug: 0.95 });
  const trama = (th: number, fv: number) =>
    0.94 + 0.08 * (Math.round(th * 24) % 2 ? 1 : 0) * (Math.round(fv * 18) % 2 ? 1 : 0);
  torno(
    palha,
    aba.rx0 * e,
    aba.rz0 * e,
    base - 0.004 * e,
    [
      [1, 0],
      [0.99, 0.06 * e],
      [0.95, 0.11 * e],
      [0.86, 0.148 * e],
      [0.7, 0.168 * e],
      [0.42, 0.178 * e],
      [0, 0.181 * e],
    ],
    alta ? 72 : 40,
    alta ? 12 : 7,
    { tom: trama, uRep: 8 },
  );
  abaNova(palha, aba, e, base, alta, {
    franja: true,
    tom: (th, f) => trama(th, f * 3) * lerp(1, 0.92, f),
  });
  // fita (na cor do chapéu) na base da copa
  torno(
    of.g("", { rug: 0.6 }),
    aba.rx0 * e * 1.012,
    aba.rz0 * e * 1.012,
    base,
    [
      [0.995, 0.008 * e],
      [1.002, 0.02 * e],
      [0.99, 0.038 * e],
    ],
    alta ? 72 : 40,
    3,
  );
};

/** Chapéu de cowboy: copa com vinco e pinças, aba enrolada, fita de couro e fivela. */
const chapeuCowboy: Fabrica = (of, k) => {
  const { e, base, alta } = k;
  const aba = ABAS_NOVAS.chapeuCowboy;
  const feltro = of.g("", { textura: "chapeu", rug: 0.85 });
  const rx0 = aba.rx0 * e;
  const rz0 = aba.rz0 * e;
  const alt = 0.2 * e;
  const afina = 0.82;
  const vinco = 0.055 * e;
  const yTopo = (x: number, z: number, rho: number) => {
    const domo = 0.03 * e * (1 - rho * rho);
    const v =
      vinco *
      Math.exp(-((x / (0.07 * e)) ** 2)) *
      lerp(0.5, 1, sstep(0.2, -0.2, z / rz0)) *
      sstep(1, 0.7, rho);
    return base + alt + domo - v;
  };
  const pinca = (th: number, s: number) =>
    1 - 0.16 * s * s * Math.exp(-(((Math.abs(th) - 0.7) / 0.3) ** 2)) * Math.max(0, Math.cos(th));
  const nS = alta ? 10 : 6;
  const nT = alta ? 8 : 5;
  feltro.grade(
    alta ? 72 : 40,
    nS + nT,
    (fu, fv, out) => {
      const th = fu * 2 * PI - PI;
      const sx = Math.sin(th);
      const cz = Math.cos(th);
      const j = fv * (nS + nT);
      if (j <= nS) {
        const s = j / nS;
        const kk = lerp(1, afina, s) * pinca(th, s);
        const x = sx * rx0 * kk;
        const z = cz * rz0 * kk;
        out.set(x, lerp(base - 0.004 * e, yTopo(x, z, 1), s), z);
        return lerp(0.95, 1.08, s);
      }
      const rho = 1 - (j - nS) / nT;
      const kk = afina * pinca(th, 1) * rho;
      const x = sx * rx0 * kk;
      const z = cz * rz0 * kk;
      out.set(x, yTopo(x, z, rho), z);
      return 1.08 - 0.25 * (1 - sstep(0, 0.03 * e, yTopo(x, z, rho) - (base + alt - vinco)));
    },
    6,
    1,
  );
  abaNova(feltro, aba, e, base, alta);
  // fita de couro + fivela prateada
  const couro = of.g("escuro:0.6", { rug: 0.55 });
  torno(
    couro,
    rx0 * 1.008,
    rz0 * 1.008,
    base,
    [
      [1, 0.008 * e],
      [1.004, 0.022 * e],
      [0.985, 0.036 * e],
    ],
    alta ? 72 : 40,
    3,
  );
  const thF = 0.55;
  const pF = new Vector3(Math.sin(thF) * rx0 * 1.03, base + 0.022 * e, Math.cos(thF) * rz0 * 1.03);
  bola(
    of.g("#d1d5db", { metal: 0.85, rug: 0.25 }),
    pF,
    new Vector3(Math.sin(thF), 0, Math.cos(thF)),
    0.02 * e,
    0.024 * e,
    0.006 * e,
    12,
    6,
  );
};

/** Sombrero: copa alta e pontuda, aba enorme virada na borda, faixa e bolinhas penduradas. */
const sombrero: Fabrica = (of, k) => {
  const { e, base, alta } = k;
  const aba = ABAS_NOVAS.sombrero;
  const feltro = of.g("", { textura: "chapeu", rug: 0.85 });
  torno(
    feltro,
    aba.rx0 * e,
    aba.rz0 * e,
    base - 0.004 * e,
    [
      [1, 0],
      [0.9, 0.09 * e],
      [0.76, 0.18 * e],
      [0.6, 0.255 * e],
      [0.44, 0.305 * e],
      [0.25, 0.335 * e],
      [0, 0.345 * e],
    ],
    alta ? 72 : 40,
    alta ? 14 : 8,
    { tom: (_th, fv) => lerp(0.95, 1.08, fv) },
  );
  abaNova(feltro, aba, e, base, alta, {
    // bordado: dois anéis mais escuros na aba
    tom: (th, f) =>
      1 -
      0.22 *
        (Math.exp(-(((f - 0.55) / 0.04) ** 2)) + Math.exp(-(((f - 0.8) / 0.03) ** 2))) *
        (0.75 + 0.25 * Math.cos(th * 24)),
  });
  torno(
    of.g("#16a34a", { rug: 0.6 }),
    aba.rx0 * e * 1.01,
    aba.rz0 * e * 1.01,
    base,
    [
      [0.995, 0.01 * e],
      [0.985, 0.03 * e],
      [0.96, 0.05 * e],
    ],
    alta ? 72 : 40,
    3,
  );
  // bolinhas penduradas na borda, em três cores
  const cores = ["#dc2626", "#f8fafc", "#16a34a"];
  const n = alta ? 24 : 16;
  for (let i = 0; i < n; i++) {
    const th = (i / n) * 2 * PI;
    const sx = Math.sin(th);
    const cz = Math.cos(th);
    const y = base + 0.004 * e + aba.sobe(sx, cz, 1) * e;
    const p = new Vector3(sx * aba.rxA * e * 1.01, y - 0.018 * e, cz * aba.rzA * e * 1.01);
    bola(
      of.g(cores[i % 3]!, { rug: 0.9 }),
      p,
      new Vector3(0, 1, 0),
      0.014 * e,
      0.014 * e,
      0.014 * e,
      10,
      6,
    );
  }
};

/** Bucket (chapéu de pescador): copa reta de topo chato, aba curta caindo, costuras. */
const chapeuPescador: Fabrica = (of, k) => {
  const { e, base, alta } = k;
  const aba = ABAS_NOVAS.chapeuPescador;
  const brim = of.g("", { textura: "bone", rug: 0.9 });
  const costura = (x: number, ...pos: number[]) =>
    1 - 0.2 * pos.reduce((a, p) => a + Math.exp(-(((x - p) / 0.02) ** 2)), 0);
  torno(
    brim,
    aba.rx0 * e,
    aba.rz0 * e,
    base - 0.004 * e,
    [
      [1, 0],
      [0.975, 0.05 * e],
      [0.94, 0.096 * e],
      [0.9, 0.114 * e],
      [0.8, 0.122 * e],
      [0.4, 0.125 * e],
      [0, 0.126 * e],
    ],
    alta ? 64 : 36,
    alta ? 12 : 7,
    { tom: (_th, fv) => costura(fv, 0.12, 0.62) },
  );
  abaNova(brim, aba, e, base, alta, { tom: (_th, f) => costura(f, 0.3, 0.55, 0.8), uRep: 8 });
};

const FABRICAS: Record<string, Fabrica> = {
  chapeuPalha,
  boneTrucker,
  chapeuCowboy,
  capaceteFlorestal,
  gorroPompom,
  chapeuPescador,
  coroaFolhas,
  bandana,
  boina,
  chapeuChef,
  chapeuFesta,
  boneHelice,
  aureola,
  foneGatinho,
  sombrero,
};

/** Os chapéus deste arquivo (para o despacho em `cabeca-3d.tsx`). */
export function ehChapeuNovo(tipo: string): boolean {
  return tipo in FABRICAS;
}

/** Os chapéus novos que cobrem o alto da cabeça (o cabelo nasce do corte para baixo). */
export const COBRE_O_ALTO_NOVOS = [
  "chapeuPalha",
  "boneTrucker",
  "chapeuCowboy",
  "capaceteFlorestal",
  "gorroPompom",
  "bandana",
  "boina",
  "chapeuChef",
  "boneHelice",
  "sombrero",
] as const;

/**
 * As peças de um chapéu novo, ou null se o tipo não é deste arquivo.
 * `corte` vem do `CORTE_DO_CHAPEU` (null nos enfeites que não cobrem o alto).
 */
export function pecasDoChapeuNovo(
  tipo: string,
  t: number,
  c: CtxChapeuNovo,
  alta: boolean,
): PecaChapeu[] | null {
  const fab = FABRICAS[tipo];
  if (!fab) return null;
  const e = t / 0.46;
  const of = new Oficina();
  fab(of, {
    t,
    e,
    topo: t / 2,
    zF: (t * 0.92) / 2,
    cab: new CabecaSDF(t),
    c,
    alta,
    base: c.corte ?? t / 2 - 0.05 * e,
  });
  return of.pecas();
}

/**
 * Altura do topo do chapéu novo acima do alto da cabeça (t/2), para o rótulo
 * do nome; null se o tipo não é deste arquivo. Medidas da bancada (clássico).
 */
export function alturaDoChapeuNovo(
  tipo: string,
  t: number,
  corte: number | null,
  alturaCab: number,
): number | null {
  const e = t / 0.46;
  const base = (corte ?? t / 2) - t / 2;
  const tab: Record<string, number> = {
    chapeuPalha: base + 0.181 * e,
    boneTrucker: base + 0.11 * e,
    chapeuCowboy: base + 0.25 * e,
    capaceteFlorestal: base + 0.12 * e,
    gorroPompom: base + 0.25 * e,
    chapeuPescador: base + 0.126 * e,
    coroaFolhas: Math.max(0, alturaCab - 0.335 * t) + 0.03 * e,
    bandana: base + 0.095 * e,
    boina: base + 0.12 * e,
    chapeuChef: base + 0.36 * e,
    chapeuFesta: Math.max(0, alturaCab * 0.75) + 0.35 * e,
    boneHelice: base + 0.16 * e,
    aureola: Math.max(0.05 * e, alturaCab) + 0.1 * e,
    foneGatinho: Math.max(0.025 * e, alturaCab * 0.9) + 0.13 * e,
    sombrero: base + 0.345 * e,
  };
  return tab[tipo] ?? null;
}
