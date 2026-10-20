import { CatmullRomCurve3, Vector3 } from "three";
import {
  KU,
  KV,
  Malha,
  PI,
  empurrar,
  empurrarDaCabeca,
  empurrarDaCabecaNoPlano,
  envelope,
  foraDaMecha,
  lerp,
  limitarEncosto,
  sstep,
  type Obra,
} from "@/components/rv/cabelo-casca";
import { elastico, feixeGota, fita, miolo, tufo } from "@/components/rv/cabelo-fita";
import {
  guiaSobreACabeca,
  mascaraDaFita,
  pousar,
  tomDaMecha,
  type ModoMechas,
} from "@/components/rv/cabelo-guia";
import { V_INICIO, V_LISO } from "@/components/rv/cabelo-texturas";

/*
 * Peças sob medida dos penteados femininos (motor novo): tranças de 3 mechas
 * (grossas, finas, coladas no couro ou soltas), o alto penteado até a raiz
 * delas, o coque de fitas enroladas, os rabos/tufinhos do alto e a flor de
 * enfeite. Tudo sai nas malhas da obra: o cabelo na `x` e os enfeites
 * coloridos nas malhas de enfeite (`malhaDeEnfeite`), cada cor numa.
 */

/** Cor de enfeite "de destaque": a cor 2 da roupa (o elástico das tranças). */
export const ENFEITE_DESTAQUE = "";
/** A flor (rosa fixa): pétala rosa-clara com o miolo rosa-escuro (as 2 cores do material). */
export const ENFEITE_FLOR = "#f9a8d4|#db2777";

/** A malha dos enfeites de uma cor (criada na primeira peça). */
export function malhaDeEnfeite(k: Obra, cor: string): Malha {
  k.enfeites ??= new Map();
  let m = k.enfeites.get(cor);
  if (!m) {
    m = new Malha();
    k.enfeites.set(cor, m);
  }
  return m;
}

/* ————————————————— Tranças ————————————————— */

/** Quadro (centro, tangente, lado, para fora) de uma guia, amostrado por arco. */
export type QuadroTranca = { c: Vector3[]; T: Vector3[]; B: Vector3[]; N: Vector3[]; comp: number };

export function quadroDaGuia(k: Obra, guia: Vector3[], S: number): QuadroTranca {
  const curva = new CatmullRomCurve3(guia, false, "centripetal");
  const q: QuadroTranca = { c: [], T: [], B: [], N: [], comp: curva.getLength() };
  const H = new Vector3();
  for (let i = 0; i < S; i++) {
    const s = i / (S - 1);
    const p = curva.getPointAt(s);
    const t = curva.getTangentAt(s).normalize();
    foraDaMecha(k, p, H);
    const n = H.clone().addScaledVector(t, -H.dot(t));
    if (n.lengthSq() < 1e-8) n.copy(q.N[i - 1] ?? new Vector3(0, 0, 1));
    n.normalize();
    const b = new Vector3().crossVectors(t, n).normalize();
    // o "lado" não pode virar no meio (o desenho em V da trança inverteria)
    const bAnt = q.B[i - 1];
    if (bAnt && b.dot(bAnt) < 0) b.negate();
    q.c.push(p);
    q.T.push(t);
    q.B.push(b);
    q.N.push(n);
  }
  return q;
}

/** O quadro no arco `a` (metros desde a raiz), interpolado. */
export function noArco(q: QuadroTranca, a: number) {
  const S = q.c.length;
  const f = Math.max(0, Math.min(S - 1.0001, (a / q.comp) * (S - 1)));
  const i = Math.floor(f);
  const u = f - i;
  return {
    c: q.c[i]!.clone().lerp(q.c[i + 1]!, u),
    T: q.T[i]!.clone()
      .lerp(q.T[i + 1]!, u)
      .normalize(),
    B: q.B[i]!.clone()
      .lerp(q.B[i + 1]!, u)
      .normalize(),
    N: q.N[i]!.clone()
      .lerp(q.N[i + 1]!, u)
      .normalize(),
  };
}

/** Para que lado do corpo a trança cai e como ela corre na cabeça. */
export type RegrasTranca = {
  /** +1 cai na frente (peito), −1 nas costas. */
  lado: 1 | -1;
  /** Lado da cabeça (+1 = +x, −1 = −x; 0 = no meio). */
  l: number;
  /** Onde a trança da frente pousa no peito (|x|). */
  xAlvo?: number;
  /**
   * Trecho inicial (fração 0..1 da guia) que corre COLADO na cabeça (trança
   * embutida/boxeadora): ali os gomos ficam meio afundados no cabelo.
   */
  rente?: number;
  /** Folga a mais da cabeça (m): trança que corre por cima de outro cabelo. */
  folga?: number;
};

/**
 * Regras de um ponto da guia da trança (R = o raio da trança ali): longe da
 * cabeça (a raiz fica meio enterrada no couro; no trecho `rente`, colada),
 * longe do corpo; da linha do ombro para baixo, na frente do peito (ou nas
 * costas) pelo envelope — a trança é grossa: o centro fica além do limite das
 * mechas finas — e fora do encosto e da aba.
 */
function restringirTranca(
  k: Obra,
  p: Vector3,
  ant: Vector3,
  base: Vector3,
  R: number,
  rente: boolean,
  o: RegrasTranca,
) {
  const c = k.ctx;
  const extra = o.folga ?? 0;
  const margem = rente
    ? R * 0.8 + extra
    : lerp(R * 0.5 + extra, R + 0.006 + extra, sstep(0, 0.08, p.distanceTo(base)));
  if (p.y > -k.t / 2 + 0.02) empurrarDaCabeca(k, p, margem);
  else empurrarDaCabecaNoPlano(k, p, margem);
  empurrar(k, p, 0, R * 0.85);
  if (p.y < c.topoTroncoY + 0.02) {
    const sx = Math.sign(o.l) || Math.sign(p.x) || 1;
    const env = envelope(k);
    if (o.lado > 0) {
      pousar(k, p, ant, 1, sx, o.xAlvo);
      p.z = Math.max(p.z, env.limFrente(p.x, p.y) + R * 0.55);
    } else {
      pousar(k, p, ant, -1, sx);
      p.z = Math.min(p.z, env.limTras(p.x, p.y) - R * 0.55);
    }
  }
  if (k.aba) {
    const yAba = k.aba(p.x, p.z);
    if (yAba !== null && p.y > yAba - R) p.y = yAba - R;
  }
  limitarEncosto(k, p, R);
}

/**
 * A guia de uma trança a partir de pontos de controle: a curva é
 * reamostrada a cada 2 cm, passa pelas regras (cabeça, corpo, encosto, aba)
 * e é alisada (as colisões deixam dentes), com as regras reaplicadas.
 */
export function guiaDeTranca(
  k: Obra,
  ctrl: Vector3[],
  raio: (s: number) => number,
  o: RegrasTranca,
): Vector3[] {
  const esc = k.t / 0.46;
  const curva = new CatmullRomCurve3(ctrl, false, "centripetal");
  const n = Math.max(12, Math.round(curva.getLength() / (0.02 * esc)));
  const g = curva.getSpacedPoints(n);
  const base = g[0]!.clone();
  const rente = (i: number) => i / n < (o.rente ?? 0);
  for (let i = 1; i < g.length; i++)
    restringirTranca(k, g[i]!, g[i - 1]!, base, raio(i / n), rente(i), o);
  const m = new Vector3();
  for (let it = 0; it < 4; it++)
    for (let i = 1; i < g.length - 1; i++) {
      m.copy(g[i - 1]!)
        .add(g[i + 1]!)
        .multiplyScalar(0.5);
      g[i]!.lerp(m, 0.5);
      restringirTranca(k, g[i]!, g[i - 1]!, base, raio(i / n), rente(i), o);
    }
  return g;
}

/**
 * Os gomos de uma trança de 3 mechas: vista de frente, cada mecha cruza da
 * borda para o meio descendo, alternando os lados — o "V" empilhado. Cada
 * gomo é uma fita gorda (seção quase redonda) que nasce por baixo do gomo de
 * cima e some por baixo do de baixo: as pontas escuras (tom) fazem a dobra.
 * A textura corre ao longo do gomo (os fios acompanham o cruzamento).
 */
function gomosDaTranca(
  k: Obra,
  x: Malha,
  q: QuadroTranca,
  comp: number,
  raio: (s: number) => number,
  tomAo: (s: number) => number,
  masc: (s: number, luz: boolean) => number,
  nGomos: number,
) {
  const S = k.alta ? 9 : 6;
  const M = k.alta ? 4 : 3;
  const curva = new CatmullRomCurve3([new Vector3(), new Vector3(), new Vector3()]);
  const p = new Vector3();
  const tg = new Vector3();
  // o passo acompanha o raio (gomos menores embaixo), escalado para dar `nGomos` na trança
  let soma = 0;
  for (let j = 0; j < 32; j++) soma += 1 / raio((j + 0.5) / 32);
  const kPasso = (comp * soma) / 32 / nGomos;
  let a = 0;
  let i = 0;
  while (a < comp - 0.004) {
    const R = raio(a / comp);
    const passo = kPasso * R;
    const meio = Math.min(comp, a + passo * 0.5);
    const s = meio / comp;
    const lado = i % 2 ? 1 : -1;
    const q0 = noArco(q, Math.max(0, meio - 1.0 * passo));
    const q1 = noArco(q, meio);
    const q2 = noArco(q, Math.min(comp, meio + 1.0 * passo));
    // de cima, na borda, até um pouco além do meio, embaixo (o gomo do meio estufa para fora)
    curva.points[0]!.copy(q0.c).addScaledVector(q0.B, lado * 0.78 * R);
    curva.points[1]!.copy(q1.c)
      .addScaledVector(q1.B, lado * 0.32 * R)
      .addScaledVector(q1.N, 0.14 * R);
    curva.points[2]!.copy(q2.c).addScaledVector(q2.B, -lado * 0.22 * R);
    const len = curva.getLength();
    const c: Vector3[] = [];
    const B: Vector3[] = [];
    const N: Vector3[] = [];
    const T: Vector3[] = [];
    const vs: number[] = [];
    const w: number[] = [];
    const h: number[] = [];
    const tons: number[] = [];
    const ms: number[] = [];
    // a mecha "clara" das luzes é sempre a mesma das três (gira pela trança)
    const luz = i % 3 === 0;
    for (let j = 0; j < S; j++) {
      const v = j / (S - 1);
      curva.getPointAt(v, p);
      curva.getTangentAt(v, tg).normalize();
      const n = q1.N.clone().addScaledVector(tg, -q1.N.dot(tg)).normalize();
      const b = new Vector3().crossVectors(tg, n).normalize();
      const bojo = Math.pow(Math.sin(Math.PI * v), 0.6);
      const ww = 0.52 * R * (0.35 + 0.65 * bojo);
      c.push(p.clone());
      T.push(tg.clone());
      N.push(n);
      B.push(b);
      vs.push(V_INICIO + 0.05 + (v * len) / KV);
      w.push(ww);
      h.push(ww * 0.85);
      tons.push(lerp(0.58, 1.08, Math.pow(Math.sin(Math.PI * v), 0.8)) * tomAo(s));
      ms.push(masc(s, luz));
    }
    k.nFita++;
    fita(
      x,
      c,
      B,
      N,
      T,
      vs,
      { w, h, barriga: 0.8, concha: 0 },
      tons,
      ms,
      (0.37 * i + k.r() * 0.2) % 1,
      R / KU,
      M,
    );
    a += passo;
    i++;
  }
}

/** Como montar uma trança sobre a guia. */
export type CfgTranca = {
  /** Raio de desenho ao longo (s = 0..1 da guia): a largura total fica ~1,6R. */
  raio: (s: number) => number;
  /** Quantos gomos (metade de cada lado); padrão: passo de ~0,6R. */
  nGomos?: number;
  modo: ModoMechas;
  /** Comprimento do tufo solto embaixo do elástico (m); 0 = sem tufo nem elástico. */
  tufo: number;
  /** Tufo em leque cheio (tranças grossas) ou fininho (trancinhas). */
  leque?: boolean;
};

/**
 * Uma trança de 3 mechas sobre a guia: miolo escuro (sem fresta entre os
 * gomos), os gomos em "V", o elástico na cor de destaque e o tufo solto.
 */
export function tranca(k: Obra, x: Malha, guia: Vector3[], cfg: CfgTranca) {
  const q = quadroDaGuia(k, guia, 96);
  const tufoComp = cfg.tufo > 0 ? Math.min(cfg.tufo, q.comp * 0.18) : 0;
  const comp = q.comp - tufoComp;
  const raio = cfg.raio;
  const tomAo = (s: number) => lerp(0.86, 1, sstep(0, 0.15, s)) * (1 + 0.06 * sstep(0.6, 1, s));
  // máscara das mechas: o modo ao longo da trança (raiz/pontas/ombré) e, nas luzes, uma das
  // três mechas (ela gira pela trança)
  const masc = (s: number, luz: boolean) => mascaraDaFita(cfg.modo, false, luz)(s);
  const eixo: Vector3[] = [];
  for (let i = 0; i <= 16; i++) eixo.push(noArco(q, (comp * i) / 16).c);
  miolo(k, x, eixo, (v) => raio(v) * 0.45, 0.5);
  let soma = 0;
  for (let j = 0; j < 32; j++) soma += raio((j + 0.5) / 32);
  const nGomos = cfg.nGomos ?? Math.max(8, Math.round(comp / ((0.6 * soma) / 32)));
  gomosDaTranca(k, x, q, comp, raio, tomAo, masc, nGomos);
  if (tufoComp <= 0) return;

  const fim = noArco(q, comp);
  const R1 = raio(1);
  elastico(
    malhaDeEnfeite(k, ENFEITE_DESTAQUE),
    fim.c,
    fim.T,
    R1 * 0.5,
    R1 * 0.22,
    1,
    0,
    k.alta ? 18 : 12,
    k.alta ? 8 : 5,
  );
  const guiaTufo: Vector3[] = [];
  for (let i = 0; i <= 6; i++)
    guiaTufo.push(noArco(q, comp - 0.004 + ((tufoComp + 0.004) * i) / 6).c);
  const leque = cfg.leque ?? true;
  // o tufo abre em leque logo abaixo do elástico e as pontas se separam
  const raioTufo = leque
    ? (v: number) => R1 * lerp(0.5, 1.15, sstep(0, 0.5, v)) * (1 - 0.55 * sstep(0.55, 1, v))
    : (v: number) => R1 * lerp(0.45, 0.8, sstep(0, 0.4, v)) * (1 - 0.8 * sstep(0.4, 1, v));
  miolo(k, x, guiaTufo, (v) => raioTufo(v) * 0.7, 0.45);
  tufo(k, x, guiaTufo, {
    largura: R1,
    espessura: 0.45,
    afina: 0.5,
    raiz: 1,
    pontas: leque ? (k.alta ? 8 : 5) : k.alta ? 5 : 4,
    abre: leque ? 0.55 : 0.3,
    concha: 0.12,
    torce: 0,
    V0: V_INICIO + 0.05,
    u0: k.r() * 0.6,
    tom: (v) => lerp(0.92, 1.08, v) * tomAo(1),
    mascara: () => masc(1, false),
    separa: 0.35,
    redondo: raioTufo,
  });
}

/* ————————————————— O alto penteado até um ponto ————————————————— */

export type CfgPenteado = {
  /** Pontos de partida (na direção do centro da cabeça; o raio é o da casca). */
  de: Vector3[];
  largura: number;
  /** Folga da pele: base + bojo no meio do caminho. */
  folga: [number, number];
  espessura?: number;
  modo: ModoMechas;
  /** Quantas das primeiras fitas são "da frente" (modo de mechas "frente"). */
  frente?: number;
  tom?: number;
};

/**
 * Fitas largas e rentes que levam o cabelo de cada ponto `de` (risca, linha
 * do meio da nuca, linha da testa) até o `alvo` (a raiz de uma trança, um
 * rabo, um coque): é o que faz o cabelo parecer "puxado" para lá.
 */
export function penteadoAte(k: Obra, x: Malha, alvo: Vector3, cfg: CfgPenteado) {
  const tomCouro = (v: number) =>
    lerp(0.9, 1.04, v) * (1 - 0.15 * sstep(0.85, 1, v)) * (cfg.tom ?? 1);
  cfg.de.forEach((de, i) => {
    if (k.corte !== null) {
      // sob chapéu só as fitas que nascem abaixo do corte (o alto fica dentro dele)
      const dd = de.clone().normalize();
      const p = dd.multiplyScalar(k.cab.alcance(new Vector3(), dd, 0));
      if (p.y > k.corte - 0.03) return;
    }
    const g = guiaSobreACabeca(
      k,
      de,
      alvo,
      (s) => cfg.folga[0] + cfg.folga[1] * Math.sin(s * PI),
      9,
    );
    const frente = i < (cfg.frente ?? 0);
    const m = cfg.modo === "raiz" ? 1 : mascaraDaFita(cfg.modo, frente, i % 2 === 0)(0);
    tufo(k, x, g, {
      largura: cfg.largura * (1 + 0.12 * k.r()),
      espessura: cfg.espessura ?? 0.2,
      afina: 0.6,
      raiz: 0.8,
      pontas: 1,
      abre: 0,
      concha: 0.25,
      torce: 0,
      V0: V_INICIO + 0.01,
      u0: k.r() * 0.8,
      tom: tomCouro,
      mascara: () => m,
      separa: 0,
    });
  });
}

/** As fitas da risca (de frente para trás) de um lado (l = ±1) até o alvo. */
export function daRisca(k: Obra, l: number, n: number, xRisca = 0): Vector3[] {
  const esc = k.t / 0.46;
  const out: Vector3[] = [];
  for (let i = 0; i < n; i++)
    out.push(new Vector3(xRisca + 0.022 * l, 0.25, lerp(0.17, -0.12, i / (n - 1)) * esc));
  return out;
}

/** As fitas da linha do meio da nuca (de cima para baixo) de um lado até o alvo. */
export function daNuca(k: Obra, l: number, n: number, y0 = 0.16, y1 = -0.17): Vector3[] {
  const esc = k.t / 0.46;
  const out: Vector3[] = [];
  for (let i = 0; i < n; i++)
    out.push(new Vector3(0.022 * l, lerp(y0, y1, i / (n - 1)) * esc, -0.21 * esc));
  return out;
}

/* ————————————————— Duas tranças soltas (ou uma) ————————————————— */

export type CfgTrancasSoltas = {
  /** Lados com trança (+1 = +x, −1 = −x). */
  lados: number[];
  /** Raio de desenho no alto (m, corpo clássico). */
  R0: number;
  /** Altura da raiz (rel. ao centro da cabeça, corpo clássico). */
  yRaiz: number;
  /** Até onde desce (fração da altura do tronco, em pé). */
  ate: number;
  nGomos?: number;
  /** Onde fica a risca (x): a risca de lado leva as fitas do alto a partir dela. */
  xRisca?: number;
};

/**
 * Tranças soltas que nascem embaixo, no lado de trás da cabeça (atrás de
 * onde fica a orelha), e caem em arco pela beira da frente do ombro até o
 * peito/umbigo: o cabelo todo é puxado rente da risca e da linha do meio da
 * nuca até a raiz de cada uma. Com uma trança só (de lado), o outro lado da
 * nuca também vai para ela.
 */
export function trancasSoltas(x: Malha, k: Obra, modo: ModoMechas, cfg: CfgTrancasSoltas) {
  const esc = k.t / 0.46;
  const c = k.ctx;
  const R0 = cfg.R0 * esc;
  // a trança nasce mais fina (sai do volume do cabelo), engrossa e afina até o elástico
  const raio = (s: number) =>
    R0 * lerp(0.55, 1, sstep(0, 0.2, s)) * lerp(1, 0.65, Math.pow(s, 1.2));
  const xAlvo = Math.max(0.19, c.troncoW / 2 - 0.08);
  const zPeito = c.troncoD / 2 + (c.acessorioFrente ? 0.075 : 0.055) + raio(0.3) * 0.55;
  const yFim = c.topoTroncoY - (c.pose === "sentado" ? 0.75 : 1) * cfg.ate * c.troncoH;
  for (const l of cfg.lados) {
    const o = new Vector3(0, cfg.yRaiz * esc, -0.07 * esc);
    const d = new Vector3(l, 0, 0);
    const base = o.clone().addScaledVector(d, k.cab.alcance(o, d, raio(0) * 0.5));
    const ctrl = [
      base,
      new Vector3(l * (k.t / 2 + raio(0.1) * 0.85), (cfg.yRaiz - 0.1) * esc, 0.03 * esc),
      new Vector3(l * lerp(k.t / 2 + raio(0.2) * 0.6, xAlvo, 0.5), c.topoTroncoY - 0.04, zPeito),
      new Vector3(l * xAlvo, c.topoTroncoY - 0.14, zPeito),
      new Vector3(l * xAlvo, yFim, zPeito),
    ];
    const guia = guiaDeTranca(k, ctrl, raio, { lado: 1, l, xAlvo });
    tranca(k, x, guia, { raio, nGomos: cfg.nGomos, modo, tufo: 0.12 * esc });
    // —— o alto penteado: fitas largas e rentes da risca e da nuca até a raiz ——
    const alvo = base.clone().addScaledVector(d, -R0 * 0.3);
    const de = [...daRisca(k, l, 6, cfg.xRisca ?? 0), ...daNuca(k, l, 6)];
    // trança de um lado só: as fitas do outro lado da nuca também vêm para ela
    if (cfg.lados.length === 1) de.push(...daNuca(k, -l, 5, 0.12, -0.17));
    penteadoAte(k, x, alvo, { de, largura: 0.07 * esc, folga: [0.009, 0.006], modo, frente: 2 });
  }
}

/* ————————————————— Coque ————————————————— */

/**
 * Coque de fitas enroladas: um miolo redondo e escuro e fitas largas que dão
 * a volta nele em arcos de inclinações espalhadas (as pontas somem por baixo
 * das vizinhas). `bagunca` (0..1) solta as voltas e deixa alças para fora.
 */
export function coqueDeFitas(
  k: Obra,
  x: Malha,
  centro: Vector3,
  raio: number,
  modo: ModoMechas,
  bagunca = 0,
) {
  const tom = tomDaMecha(1);
  const masc = mascaraDaFita(modo, false, false);
  const up = new Vector3(0, 1, 0);
  miolo(
    k,
    x,
    [
      centro.clone().addScaledVector(up, -raio * 0.95),
      centro.clone(),
      centro.clone().addScaledVector(up, raio * 0.95),
    ],
    (v) => raio * 0.88 * Math.pow(Math.max(0, Math.sin(PI * v)), 0.5),
    0.55,
  );
  const n = k.alta ? 12 : 8;
  const eixo = new Vector3();
  const u = new Vector3();
  const w = new Vector3();
  for (let i = 0; i < n; i++) {
    // eixos espalhados (espiral na esfera): as voltas cruzam em todas as direções
    const fy = 1 - (2 * (i + 0.5)) / n;
    const fr = Math.sqrt(1 - fy * fy);
    const fa = i * 2.39996 + k.r() * 0.4;
    eixo.set(Math.cos(fa) * fr, fy, Math.sin(fa) * fr).normalize();
    u.set(1, 0, 0).cross(eixo);
    if (u.lengthSq() < 1e-4) u.set(0, 0, 1).cross(eixo);
    u.normalize();
    w.crossVectors(eixo, u).normalize();
    const a0 = k.r() * 2 * PI;
    const volta = (1.25 + 0.35 * k.r()) * PI;
    const alca = bagunca * (0.12 + 0.2 * k.r());
    const pts: Vector3[] = [];
    for (let j = 0; j <= 12; j++) {
      const s = j / 12;
      const a = a0 + volta * s;
      const r = raio * (1.02 + 0.04 * (i % 3) + alca * Math.sin(PI * s));
      pts.push(
        centro
          .clone()
          .addScaledVector(u, Math.cos(a) * r)
          .addScaledVector(w, Math.sin(a) * r),
      );
    }
    tufo(k, x, pts, {
      largura: raio * (0.42 + 0.1 * k.r()),
      espessura: 0.3,
      afina: 0.7,
      raiz: 0.5,
      pontas: bagunca > 0.5 ? 2 : 1,
      abre: 0.2 * bagunca,
      concha: 0.3,
      torce: 0,
      V0: V_INICIO + 0.02,
      u0: k.r() * 0.8,
      tom: (v) => tom(0.4 + 0.6 * v),
      mascara: (v) => masc(v),
      separa: 0.2 * bagunca,
      normal: (p, out) => out.copy(p).sub(centro).normalize(),
    });
  }
}

/* ————————————————— Rabo e tufinhos do alto ————————————————— */

export type CfgRaboDoAlto = {
  /** Onde nasce (direção do centro da cabeça). */
  dirRaiz: Vector3;
  /** Para onde sai do elástico. */
  saida: Vector3;
  /** Comprimento (m, corpo clássico). */
  comp: number;
  raioMax: number;
  fitas: number;
  /** Gravidade: no começo e no fim (por passo). */
  gravidade: [number, number];
  /** +1 pousa na frente, −1 nas costas. */
  lado: 1 | -1;
  /** Abertura das pontas. */
  abre?: number;
};

/**
 * Um rabo/tufinho preso no alto da cabeça (rabo de cavalo alto, chiquinhas
 * curtas): o feixe em gota sobe pela `saida` e a gravidade o vence aos
 * poucos; desvia da cabeça, do corpo, da aba e do encosto. Devolve a raiz (o
 * elástico), para o alto penteado ir até ela.
 */
export function raboDoAlto(k: Obra, x: Malha, modo: ModoMechas, cfg: CfgRaboDoAlto): Vector3 {
  const esc = k.t / 0.46;
  const dirRaiz = cfg.dirRaiz.clone().normalize();
  const base = dirRaiz.clone().multiplyScalar(k.cab.alcance(new Vector3(), dirRaiz, 0.03));
  const guia: Vector3[] = [base.clone()];
  const p = base.clone();
  const dir = cfg.saida.clone().normalize();
  const ant = new Vector3();
  const comp = cfg.comp * esc;
  const R = cfg.raioMax * esc;
  const n = Math.max(6, Math.ceil(comp / 0.025));
  const sx = Math.sign(base.x) || 1;
  for (let i = 0; i < n; i++) {
    const s = i / n;
    dir.y -= lerp(cfg.gravidade[0], cfg.gravidade[1], s);
    dir.normalize();
    ant.copy(p);
    p.addScaledVector(dir, comp / n);
    empurrarDaCabeca(k, p, lerp(0.03, R * 0.85, Math.min(1, s * 4)));
    if (k.aba) {
      const yAba = k.aba(p.x, p.z);
      if (yAba !== null && p.y > yAba - R) p.y = yAba - R;
    }
    pousar(k, p, ant, cfg.lado, sx);
    limitarEncosto(k, p, R * 1.05);
    guia.push(p.clone());
  }
  feixeGota(k, x, {
    guia,
    raioMax: R,
    fitas: cfg.fitas,
    abre: cfg.abre ?? 0.25,
    tom: tomDaMecha(1),
    mascara: mascaraDaFita(modo, false, false),
    tomElastico: 0.35,
    saida: cfg.saida,
    base: 0.55,
  });
  return base;
}

/* ————————————————— Flor ————————————————— */

/**
 * Flor de enfeite (lírio/hibisco): 6 pétalas pontudas em concha, que abrem
 * para fora a partir do miolo, e 5 estames. Vai na malha de enfeite da flor:
 * a máscara pinta a base da pétala na cor 2 (rosa-escuro) e clareia até a
 * ponta (cor 1).
 */
export function flor(k: Obra, centro: Vector3, normal: Vector3, raio: number) {
  const m = malhaDeEnfeite(k, ENFEITE_FLOR);
  const n = normal.clone().normalize();
  const a = new Vector3(0, 1, 0).addScaledVector(n, -n.y);
  if (a.lengthSq() < 1e-4) a.set(1, 0, 0).addScaledVector(n, -n.x);
  a.normalize();
  const b = new Vector3().crossVectors(n, a).normalize();
  const S = k.alta ? 8 : 6;
  const M = k.alta ? 4 : 3;
  const petala = (dir: Vector3, comp: number, larg: number, sobe: number) => {
    const c: Vector3[] = [];
    const B: Vector3[] = [];
    const N: Vector3[] = [];
    const T: Vector3[] = [];
    const w: number[] = [];
    const h: number[] = [];
    const tom: number[] = [];
    const ms: number[] = [];
    const lado = new Vector3().crossVectors(dir, n).normalize();
    for (let i = 0; i < S; i++) {
      const s = i / (S - 1);
      // a pétala sai deitada e a ponta vira para fora (para a frente da flor)
      const p = centro
        .clone()
        .addScaledVector(dir, comp * s)
        .addScaledVector(n, sobe * comp * s * s);
      const t = dir
        .clone()
        .addScaledVector(n, 2 * sobe * s)
        .normalize();
      const nn = n.clone().addScaledVector(t, -n.dot(t)).normalize();
      c.push(p);
      T.push(t);
      N.push(nn);
      B.push(lado);
      const ww = larg * Math.pow(Math.sin(PI * Math.min(1, s * 0.9 + 0.08)), 0.7);
      w.push(Math.max(0.0015, ww * (1 - 0.85 * sstep(0.75, 1, s))));
      h.push(Math.max(0.001, ww * 0.18));
      tom.push(lerp(0.85, 1.08, s));
      ms.push(1 - sstep(0, 0.55, s));
    }
    fita(
      m,
      c,
      B,
      N,
      T,
      c.map(() => V_LISO),
      { w, h, barriga: 0.6, concha: -0.35 },
      tom,
      ms,
      0.5,
      0,
      M,
    );
  };
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * 2 * PI + 0.3;
    const dir = a
      .clone()
      .multiplyScalar(Math.cos(ang))
      .addScaledVector(b, Math.sin(ang))
      .addScaledVector(n, 0.1)
      .normalize();
    petala(dir, raio, raio * 0.36, 0.35);
  }
  // os estames: fininhos, saem do miolo para a frente
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * 2 * PI;
    const dir = n
      .clone()
      .addScaledVector(a, 0.35 * Math.cos(ang))
      .addScaledVector(b, 0.35 * Math.sin(ang))
      .normalize();
    petala(dir, raio * 0.55, raio * 0.05, 0.1);
  }
}

/** O raio de uma trança que só afina (trancinhas, embutidas): R0 no alto, `fim`·R0 embaixo. */
export function raioQueAfina(R0: number, fim: number) {
  return (s: number) => R0 * lerp(1, fim, Math.pow(s, 1.1));
}
