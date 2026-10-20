import { CatmullRomCurve3, Vector3 } from "three";
import {
  KU,
  KV,
  Malha,
  PI,
  clamp01,
  foraDaMecha,
  lerp,
  sstep,
  type Obra,
} from "@/components/rv/cabelo-casca";
import { V_INICIO, V_LISO } from "@/components/rv/cabelo-texturas";

/*
 * As peças do cabelo: a FITA de seção lente (grossa no meio, fina nas bordas,
 * bordas curvadas para a cabeça — é ela que dá a cara de "lâmina" das mechas
 * do Roblox, em vez de tubo/palha), o TUFO (1–3 fitas sobre uma guia, com as
 * pontas desencontradas e separadas), o feixe em gota dos rabos e o elástico.
 */

export type Secao = {
  /** Meia-largura (m) em cada amostra. */
  w: number[];
  /** Meia-espessura (m) em cada amostra (lado de fora). */
  h: number[];
  /** Fração da espessura do lado de dentro (0,35 = barriga achatada). */
  barriga: number;
  /** Bordas curvadas para a cabeça (fração da largura). */
  concha: number;
};

const _p = new Vector3();
const _q = new Vector3();

/**
 * A fita: amostras (centro c, largura B, normal N para fora, tangente T) +
 * seção lente. UV: u atravessado (u0..u0+du), v ao longo. A ponta fecha num
 * vértice só (espinho) e a raiz num leque. `tom`/`masc` por amostra.
 */
export function fita(
  x: Malha,
  c: Vector3[],
  B: Vector3[],
  N: Vector3[],
  T: Vector3[],
  vs: number[],
  sec: Secao,
  tom: number[],
  masc: number[],
  u0: number,
  du: number,
  M = 4,
) {
  const S = c.length;
  if (S < 3) return;
  const R = 2 * M;
  const ini = x.n;
  for (let i = 0; i < S; i++) {
    const w = sec.w[i]!;
    const h = sec.h[i]!;
    for (let j = 0; j < R; j++) {
      const cima = j <= M;
      const s = cima ? -1 + (2 * j) / M : 1 - (2 * (j - M)) / M;
      const bojo = Math.pow(Math.max(0, 1 - s * s), 0.55);
      const y = (cima ? h * bojo : -h * sec.barriga * bojo) - sec.concha * w * s * s;
      _p.copy(c[i]!)
        .addScaledVector(B[i]!, s * w)
        .addScaledVector(N[i]!, y);
      // borda mais escura (separa as mechas); o verso, bem mais escuro, aparece nas frestas
      const k = cima ? 1 - 0.28 * Math.pow(Math.abs(s), 3) : 0.55;
      x.v(_p, tom[i]! * k, masc[i]!, u0 + (du * (s + 1)) / 2, vs[i]!, T[i]!, N[i]!);
    }
  }
  const ponta = x.v(
    c[S - 1]!,
    tom[S - 1]!,
    masc[S - 1]!,
    u0 + du / 2,
    vs[S - 1]!,
    T[S - 1]!,
    N[S - 1]!,
  );
  const raiz = x.v(c[0]!, tom[0]!, masc[0]!, u0 + du / 2, vs[0]!, T[0]!, N[0]!);
  // orientação: a normal do 1º quad deve apontar para N
  const a0 = new Vector3().fromArray(x.pos, (ini + R + M / 2) * 3);
  const b0 = new Vector3().fromArray(x.pos, (ini + R + M / 2 + 1) * 3);
  const c0 = new Vector3().fromArray(x.pos, (ini + 2 * R + M / 2) * 3);
  const nTri = b0.clone().sub(a0).cross(c0.clone().sub(a0));
  const inv = nTri.dot(N[1]!) < 0;
  const tri = (a: number, b: number, d: number) =>
    inv ? x.idx.push(a, d, b) : x.idx.push(a, b, d);
  for (let i = 0; i < S - 2; i++) {
    for (let j = 0; j < R; j++) {
      const a = ini + i * R + j;
      const b = ini + i * R + ((j + 1) % R);
      tri(a, b, a + R);
      tri(b, b + R, a + R);
    }
  }
  const ult = ini + (S - 2) * R;
  for (let j = 0; j < R; j++) tri(ult + j, ult + ((j + 1) % R), ponta);
  for (let j = 0; j < R; j++) tri(ini + ((j + 1) % R), ini + j, raiz);
}

/* ————————————————— Guia amostrada ————————————————— */

export type Normal = Vector3 | ((p: Vector3, out: Vector3) => Vector3);

/** Amostra a guia (Catmull-Rom centrípeta, reamostrada por arco) com quadros estáveis. */
export function amostrar(k: Obra, guia: Vector3[], S: number, normal?: Normal) {
  const curva = new CatmullRomCurve3(guia, false, "centripetal");
  const comp = curva.getLength();
  const c: Vector3[] = [];
  const T: Vector3[] = [];
  const B: Vector3[] = [];
  const N: Vector3[] = [];
  const vs: number[] = [];
  const H = new Vector3();
  let Bant: Vector3 | null = null;
  for (let i = 0; i < S; i++) {
    const v = Math.pow(i / (S - 1), 0.9);
    const p = curva.getPointAt(v);
    const t = curva.getTangentAt(v).normalize();
    if (typeof normal === "function") normal(p, H);
    else if (normal) H.copy(normal);
    else foraDaMecha(k, p, H);
    let b = new Vector3().crossVectors(t, H);
    const forca = b.length();
    b.normalize();
    if (Bant) {
      // |T×H| fraco: o quadro vira — mistura com o B anterior para não torcer de repente
      const prev = Bant.clone().addScaledVector(t, -Bant.dot(t)).normalize();
      if (prev.dot(b) < 0 && forca < 0.5) b.negate();
      b.lerp(prev, 1 - sstep(0.15, 0.45, forca)).normalize();
    } else if (forca < 0.1) {
      b = new Vector3().crossVectors(t, new Vector3(0, 0, 1));
      if (b.lengthSq() < 1e-4) b.set(1, 0, 0);
      b.normalize();
    }
    const n = new Vector3().crossVectors(b, t);
    // proteção contra normal zero: normal NaN vira ponto preto no SwiftShader
    if (n.lengthSq() < 1e-12) n.copy(H);
    n.normalize();
    c.push(p);
    T.push(t);
    B.push(b);
    N.push(n);
    vs.push(v);
    Bant = b;
  }
  return { c, T, B, N, vs, comp };
}

/* ————————————————— Tufo: 1–3 fitas sobre uma guia ————————————————— */

export type TufoCfg = {
  /** Meia-largura do tufo (m). */
  largura: number;
  /** Espessura relativa à largura (h = espessura·w). */
  espessura: number;
  /** Onde começa a afinar (0..1 do comprimento). */
  afina: number;
  /** Largura na raiz (fração). */
  raiz: number;
  pontas: number;
  /** Quanto as sub-fitas se abrem (fração da largura). */
  abre: number;
  concha: number;
  /** Torção total ao longo do tufo (rad). */
  torce: number;
  V0: number;
  u0: number;
  /** Tom ao longo (0..1) da sub-fita `sub`. */
  tom: (v: number, sub: number) => number;
  /** Máscara de mecha ao longo (0..1). */
  mascara: (v: number, sub: number) => number;
  /** Variação do fim de cada fita (±): 0,08 no geral, 0,02 nos cortes retos. */
  fimVar?: number;
  /** Separação lateral das pontas no último quarto (fração de w). 0 = sem. */
  separa?: number;
  /** Tufo redondo (rabo/chiquinha): raio do feixe ao longo, em vez de chato. */
  redondo?: (v: number) => number;
  /** Força o lado chato a olhar para esta direção (crista, coque). */
  normal?: Normal;
  /** Amostragem fina (cachos). */
  fino?: boolean;
  M?: number;
};

export function tufo(k: Obra, x: Malha, guia: Vector3[], cfg: TufoCfg) {
  if (guia.length < 2) return;
  const comp0 = guia.reduce((a, p, i) => (i ? a + p.distanceTo(guia[i - 1]!) : 0), 0);
  const S0 = cfg.fino
    ? Math.max(8, Math.min(48, Math.round(comp0 / 0.014)))
    : Math.max(6, Math.min(18, Math.round(comp0 / 0.045) + 3));
  // média (a sala, 10 avatares com sombra): menos amostras ao longo — de longe não aparece
  const S = k.alta ? S0 : Math.max(5, Math.round(S0 * 0.55));
  const am = amostrar(k, guia, S, cfg.normal);
  const n = Math.max(1, Math.round(cfg.pontas) - (k.alta || cfg.redondo ? 0 : 1));
  // Orçamento (C2.8): meia-seção de 4 vértices na alta (3 nos tufos de 2+ pontas), 2 na média.
  const M = cfg.M ?? (k.alta ? (n >= 2 ? 3 : 4) : 2);
  const fimVar = cfg.fimVar ?? 0.08;
  const separa = cfg.separa ?? 0.35;
  const rot = new Vector3();
  for (let q = 0; q < n; q++) {
    k.nFita++;
    // anti z-fighting: cada fita fica 0,6 ou 1,2 mm mais para fora que a vizinha
    const offRad = k.nFita % 2 ? 0.0006 : 0.0012;
    const ladoSep = k.nFita % 2 ? 1 : -1;
    // cada sub-fita termina num comprimento um pouco diferente (pontas desencontradas)
    const sq = n === 1 ? 0 : -1 + (2 * q + 1) / n;
    const fim = Math.min(
      1,
      (n === 1 ? 1 : 1 - 0.14 * Math.abs(sq) - 0.06 * k.r()) * (1 - fimVar + 2 * fimVar * k.r()),
    );
    const S2 = Math.max(5, Math.round(S * fim));
    const c: Vector3[] = [];
    const B: Vector3[] = [];
    const N: Vector3[] = [];
    const T: Vector3[] = [];
    const vs: number[] = [];
    const w: number[] = [];
    const h: number[] = [];
    const tons: number[] = [];
    const masc: number[] = [];
    const ang = cfg.redondo ? (2 * PI * q) / n + 0.4 * k.r() : 0;
    for (let i = 0; i < S2; i++) {
      const vv = (i / (S2 - 1)) * fim;
      const fi = vv * (S - 1);
      const i0 = Math.min(S - 2, Math.floor(fi));
      const tt = fi - i0;
      const cc = am.c[i0]!.clone().lerp(am.c[i0 + 1]!, tt);
      let bb = am.B[i0]!.clone()
        .lerp(am.B[i0 + 1]!, tt)
        .normalize();
      let nn = am.N[i0]!.clone()
        .lerp(am.N[i0 + 1]!, tt)
        .normalize();
      const tg = am.T[i0]!.clone()
        .lerp(am.T[i0 + 1]!, tt)
        .normalize();
      if (cfg.torce) {
        const a = cfg.torce * sstep(0.3, 1, vv);
        rot.copy(bb).multiplyScalar(Math.cos(a)).addScaledVector(nn, Math.sin(a));
        nn = nn.clone().multiplyScalar(Math.cos(a)).addScaledVector(bb, -Math.sin(a));
        bb = rot.clone();
      }
      const vloc = i / (S2 - 1);
      const raizW = lerp(cfg.raiz, 1, sstep(0, 0.18, vloc));
      const x01 = clamp01((vloc - cfg.afina) / (1 - cfg.afina));
      const afinar = 1 - x01 * x01;
      let W: number;
      let off: Vector3;
      if (cfg.redondo) {
        const R = cfg.redondo(vv);
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        off = bb
          .clone()
          .multiplyScalar(ca * R)
          .addScaledVector(nn, sa * R);
        // a sub-fita deita tangente ao feixe, de frente para fora
        const nb = bb.clone().multiplyScalar(-sa).addScaledVector(nn, ca);
        const nr = bb.clone().multiplyScalar(ca).addScaledVector(nn, sa);
        bb = nb;
        nn = nr;
        W = Math.max(0.004, ((R + 0.012) * PI) / n) * 1.25 * lerp(1, 0.25, x01 * x01);
        off.multiplyScalar(1 + cfg.abre * x01 * x01);
      } else {
        W = (cfg.largura * raizW * afinar) / Math.max(1, n * 0.72);
        const lado = sq * cfg.largura * (1 - 1 / (n + 0.6)) * (1 + cfg.abre * x01);
        off = bb
          .clone()
          .multiplyScalar(lado)
          .addScaledVector(nn, 0.0025 * q);
      }
      // separação nas pontas (refs 58/60): as fitas vizinhas se afastam no último quarto
      const sep = separa * cfg.largura * sstep(0.75, 1, vloc) * ladoSep;
      off.addScaledVector(bb, sep).addScaledVector(nn, offRad);
      c.push(cc.add(off));
      B.push(bb);
      N.push(nn);
      T.push(tg);
      vs.push(cfg.V0 + (vv * am.comp) / KV);
      w.push(Math.max(0.0015, W));
      h.push(
        Math.max(0.0012, W * cfg.espessura * (cfg.redondo ? 1 : lerp(0.6, 1, sstep(0, 0.2, vloc)))),
      );
      tons.push(cfg.tom(vloc, q));
      masc.push(cfg.mascara(vloc, q));
    }
    fita(
      x,
      c,
      B,
      N,
      T,
      vs,
      { w, h, barriga: 0.35, concha: cfg.concha },
      tons,
      masc,
      cfg.u0 + 0.37 * q,
      (2 * cfg.largura) / KU,
      M,
    );
  }
}

/* ————————————————— Peças especiais ————————————————— */

/** Elástico (anel achatado): usa a faixa lisa da textura. */
export function elastico(
  x: Malha,
  centro: Vector3,
  eixo: Vector3,
  raio: number,
  grossura: number,
  tom: number,
  masc = 0,
  NA = 18,
  NB = 8,
) {
  const e = eixo.clone().normalize();
  const a = new Vector3()
    .crossVectors(e, Math.abs(e.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0))
    .normalize();
  const b = new Vector3().crossVectors(e, a);
  const ini = x.n;
  const rad = new Vector3();
  const tg = new Vector3();
  for (let i = 0; i < NA; i++) {
    const t = (i / NA) * 2 * PI;
    rad.copy(a).multiplyScalar(Math.cos(t)).addScaledVector(b, Math.sin(t));
    tg.copy(a).multiplyScalar(-Math.sin(t)).addScaledVector(b, Math.cos(t));
    for (let j = 0; j < NB; j++) {
      const s = (j / NB) * 2 * PI;
      _p.copy(centro)
        .addScaledVector(rad, raio + Math.cos(s) * grossura)
        .addScaledVector(e, Math.sin(s) * grossura * 1.3);
      _q.copy(rad).multiplyScalar(Math.cos(s)).addScaledVector(e, Math.sin(s));
      x.v(_p, tom, masc, 0.5, V_LISO, tg, _q);
    }
  }
  for (let i = 0; i < NA; i++)
    for (let j = 0; j < NB; j++) {
      const a0 = ini + i * NB + j;
      const a1 = ini + i * NB + ((j + 1) % NB);
      const b0 = ini + ((i + 1) % NA) * NB + j;
      const b1 = ini + ((i + 1) % NA) * NB + ((j + 1) % NB);
      x.idx.push(a0, b0, a1, a1, b0, b1);
    }
}

/** Miolo escuro e redondo de um feixe (não deixa ver buraco entre as fitas). */
export function miolo(
  k: Obra,
  x: Malha,
  guia: Vector3[],
  raio: (v: number) => number,
  tom: number,
) {
  const am = amostrar(k, guia, Math.max(8, Math.min(16, Math.round(guia.length * 0.8))));
  const w = am.vs.map((v) => Math.max(0.002, raio(v)));
  fita(
    x,
    am.c,
    am.B,
    am.N,
    am.T,
    am.vs.map(() => V_LISO),
    { w, h: w, barriga: 1, concha: 0 },
    am.vs.map(() => tom),
    am.vs.map(() => 0),
    0.5,
    0,
    k.alta ? 4 : 3,
  );
}

export type FeixeCfg = {
  /** Guia do feixe (elástico → ponta). */
  guia: Vector3[];
  /** Raio máximo do feixe (m). */
  raioMax: number;
  /** Número de sub-fitas em volta. */
  fitas: number;
  /** Quanto as pontas se abrem em leque. */
  abre: number;
  tom: (v: number) => number;
  mascara: (v: number) => number;
  /** Tom do elástico (cor do cabelo × tom; o enfeite colorido é da Fase 1). */
  tomElastico: number;
  saida: Vector3;
  /** Grossura logo no elástico (fração do raio máximo): rabo fofo desde a base. Padrão 0,35. */
  base?: number;
};

/** Rabo/maria-chiquinha: feixe redondo de fitas em gota (aperta no elástico, enche, afina) com miolo escuro. */
export function feixeGota(k: Obra, x: Malha, f: FeixeCfg) {
  const R = f.raioMax;
  const b = f.base ?? 0.35;
  // aperta no elástico, enche logo depois (mais cedo quando a base já é grossa) e afina na ponta
  const cheio = b > 0.45 ? 0.2 : 0.3;
  const raioDe = (v: number) => R * lerp(b, 1, sstep(0, cheio, v)) * (1 - sstep(0.45, 1, v) * 0.85);
  miolo(k, x, f.guia, (v) => raioDe(v) * 0.8, 0.45);
  tufo(k, x, f.guia, {
    largura: R,
    espessura: 0.45,
    afina: 0.6,
    raiz: 1,
    pontas: f.fitas,
    abre: f.abre,
    concha: 0.12,
    torce: 0,
    V0: V_INICIO + 0.05,
    u0: k.r() * 0.6,
    tom: (v) => f.tom(v),
    mascara: (v) => f.mascara(v),
    separa: 0.2,
    redondo: raioDe,
  });
  elastico(
    x,
    f.guia[0]!.clone().addScaledVector(f.saida.clone().normalize(), 0.012),
    f.saida,
    R * 0.42,
    R * 0.16,
    f.tomElastico,
    0,
    k.alta ? 18 : 12,
    k.alta ? 8 : 6,
  );
}
