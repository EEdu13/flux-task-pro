import { CatmullRomCurve3, Vector3 } from "three";
import {
  KV,
  PI,
  bolha,
  lerp,
  limitarEncosto,
  sstep,
  type CascaCfg,
  type Malha,
  type Obra,
} from "@/components/rv/cabelo-casca";
import { miolo, tufo } from "@/components/rv/cabelo-fita";
import {
  guiaSobreACabeca,
  mascaraDaFita,
  tomDaMecha,
  type Camada,
  type ModoMechas,
} from "@/components/rv/cabelo-guia";
import { V_INICIO } from "@/components/rv/cabelo-texturas";
import { coqueDeFitas, guiaDeTranca, penteadoAte, tranca } from "@/components/rv/cabelo-pecas";
import type { EstiloCabelo, Preset } from "@/components/rv/cabelo-estilos";

/*
 * Penteados masculinos novos do motor novo (16/10/2026: "crie pelo menos mais
 * 10 de cada, bem criativo e dinâmico, baseado em Roblox"). Mesma receita do
 * `cabelo-estilos.ts` (fluxo + casca + camadas + peças), num arquivo à parte
 * para não crescer o catálogo principal; `ESTILOS` espalha este objeto no fim.
 *
 * Números no corpo clássico (t = 0,46); o que depende da cabeça escala por
 * k.t/0,46. Fluxo "polo": u 0 = nuca, 0,25 = +x, 0,5 = frente, 0,75 = −x.
 * Sob chapéu (`k.corte` não nulo) as peças do alto (topete, coque, bloco)
 * somem — o chapéu cobre — e só o que sai abaixo do corte fica.
 */

/** A linha do cabelo no corpo da obra (os números são do clássico, t = 0,46). */
function linha(l: CascaCfg["linha"], k: Obra): CascaCfg["linha"] {
  const e = k.t / 0.46;
  return { frente: l.frente * e, lado: l.lado * e, tras: l.tras * e };
}

/** As duas metades espelhadas (u ↔ 1 − u) de uma camada. */
function espelhar(u: [number, number], c: Omit<Camada, "u" | "deriva">, deriva = 0): Camada[] {
  return [
    { ...c, u, deriva },
    { ...c, u: [1 - u[1], 1 - u[0]], deriva: -deriva },
  ];
}

/** Linha curta (testa, acima da orelha, nuca alta): os cortes masculinos. */
const LINHA_CURTA = { frente: 0.15, lado: 0.0, tras: -0.16 };

/** Casca rente de degradê: quase só a "sombra" do cabelo nos lados e na nuca. */
const DEGRADE = { espessura: 0.009, volumeLado: 0 };

/** Ponto da pele na direção `d` (do centro da cabeça), afastado `folga`. */
function naCabeca(k: Obra, d: Vector3, folga: number): Vector3 {
  const dd = d.clone().normalize();
  return dd.multiplyScalar(k.cab.alcance(new Vector3(), dd, folga));
}

/** Curva suave pelos pontos de controle (as guias das peças sob medida). */
function curva(ctrl: Vector3[], n: number): Vector3[] {
  return new CatmullRomCurve3(ctrl, false, "centripetal").getPoints(n);
}

/* ————————————————— Topete ————————————————— */

type CfgTopete = {
  /** Fitas lado a lado na testa. */
  n: number;
  /** De onde até onde vai na testa (x, m): o meio é o mais alto. */
  x: [number, number];
  /** Quanto sobe acima do alto da cabeça (m). */
  alto: number;
  /** Quanto avança à frente da testa (m). */
  frente: number;
  /** Até onde volta por cima (z final, m). */
  volta: number;
  largura: number;
  /** Penteado para o lado: quanto o fim da onda desvia em x (m). */
  desvio?: number;
};

/**
 * O topete (quiff/pompadour): fitas que nascem na linha da testa, sobem em
 * onda à frente da testa e voltam deitando por cima do alto da cabeça. O do
 * meio é o mais alto (a "onda"); as pontas se separam um pouco atrás.
 */
function topete(x: Malha, k: Obra, modo: ModoMechas, o: CfgTopete) {
  if (k.corte !== null) return;
  const e = k.t / 0.46;
  const topo = k.t / 2;
  const zF = k.d / 2;
  const tom = tomDaMecha(1);
  for (let i = 0; i < o.n; i++) {
    const f = o.n > 1 ? i / (o.n - 1) : 0.5;
    const c = 1 - Math.abs(2 * f - 1);
    const xr = lerp(o.x[0], o.x[1], f) * e + (k.r() - 0.5) * 0.01;
    const alto = o.alto * e * lerp(0.62, 1, Math.sqrt(c)) * (0.92 + 0.16 * k.r());
    const lado = (o.desvio ?? 0) * e;
    const p0 = naCabeca(k, new Vector3(xr, 0.14 * e, zF), 0.006);
    const ctrl = [
      p0,
      new Vector3(xr * 1.04, topo + alto * 0.25, zF + o.frente * e * 0.75),
      new Vector3(xr * 1.02 + lado * 0.3, topo + alto, zF - 0.01 * e + o.frente * e * 0.55),
      new Vector3(xr * 0.97 + lado * 0.7, topo + alto * 0.85, 0.06 * e),
      new Vector3(xr * 0.94 + lado, topo + alto * 0.4 + 0.012 * e, o.volta * e),
    ];
    const g = curva(ctrl, 14);
    for (const p of g) limitarEncosto(k, p, 0.04);
    const frente = Math.abs(f - 0.5) < 0.25;
    const masc = mascaraDaFita(modo, frente, i % 3 === 1);
    tufo(k, x, g, {
      largura: (o.largura + 0.008 * k.r()) * e,
      espessura: 0.4,
      afina: 0.5,
      raiz: 0.75,
      pontas: 2,
      abre: 0.25,
      concha: 0.3,
      torce: (k.r() - 0.5) * 0.4,
      V0: V_INICIO + 0.01,
      u0: k.r() * 0.8,
      tom: (v) => tom(0.25 + 0.75 * v),
      mascara: (v) => masc(v),
      separa: 0.35,
    });
  }
}

/* ————————————————— Cachinhos ————————————————— */

/**
 * Cachinhos em mola espalhados pelo alto (curly top): cada um nasce na casca
 * (pontos em espiral de Fibonacci na calota acima de `yMin`), sai para fora e
 * para cima e dá 2–3 voltas de hélice que afinam até a ponta.
 */
function cachinhos(
  x: Malha,
  k: Obra,
  modo: ModoMechas,
  n: number,
  yMin: number,
  folga: (fy: number) => number,
) {
  const e = k.t / 0.46;
  const tom = tomDaMecha(1);
  const d = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  for (let i = 0; i < n; i++) {
    // calota: fy de 1 (alto) até ~0,25 (a borda do degradê), espiral áurea em volta
    const fy = lerp(1, 0.2, Math.sqrt((i + 0.5) / n));
    const fr = Math.sqrt(1 - fy * fy);
    const ang = i * 2.39996 + k.r() * 0.3;
    d.set(Math.sin(ang) * fr, fy, Math.cos(ang) * fr * 0.95).normalize();
    const base = naCabeca(k, d, folga(fy));
    if (base.y < yMin * e) continue;
    // sob chapéu só os de baixo da borda (os de logo abaixo do corte espetavam para fora dela)
    if (k.corte !== null && base.y > k.corte - 0.06 * e) continue;
    // sai na normal, puxada para cima (o cacho em pé) e um pouco para trás
    const sai = d
      .clone()
      .add(new Vector3(0, 0.6, -0.1))
      .normalize();
    a.set(1, 0, 0).cross(sai);
    if (a.lengthSq() < 1e-4) a.set(0, 0, 1).cross(sai);
    a.normalize();
    b.crossVectors(sai, a).normalize();
    const comp = (0.05 + 0.025 * k.r()) * e;
    const R = (0.012 + 0.005 * k.r()) * e;
    const voltas = 2 + k.r();
    const fase = k.r() * 2 * PI;
    const g: Vector3[] = [];
    const nP = 22;
    for (let j = 0; j <= nP; j++) {
      const s = j / nP;
      const r = R * sstep(0, 0.25, s) * lerp(1, 0.6, s);
      const th = fase + voltas * 2 * PI * s;
      g.push(
        base
          .clone()
          .addScaledVector(sai, comp * s)
          .addScaledVector(a, Math.cos(th) * r)
          .addScaledVector(b, Math.sin(th) * r),
      );
    }
    const masc = mascaraDaFita(modo, fy > 0.8 && Math.abs(d.x) < 0.3 && d.z > 0, i % 4 === 0);
    tufo(k, x, g, {
      largura: (0.015 + 0.004 * k.r()) * e,
      espessura: 0.6,
      afina: 0.55,
      raiz: 0.8,
      pontas: 1,
      abre: 0,
      concha: 0.25,
      torce: 0,
      V0: V_INICIO + 0.02,
      u0: k.r() * 0.8,
      tom: (v) => tom(0.35 + 0.65 * v),
      mascara: (v) => masc(v),
      separa: 0,
      fino: true,
    });
  }
}

/* ————————————————— Bloco alto (hi-top) ————————————————— */

/**
 * O hi-top: um bloco de cachinhos em pé, de lados retos e topo chato (o
 * clássico dos anos 90), que nasce acima das têmporas e sobe `altura` acima
 * do alto da cabeça. É uma superfície própria (grade em volta × perfil) com
 * a textura de cachos e calombos leves no tom.
 */
function blocoAlto(x: Malha, k: Obra, modo: ModoMechas, altura: number, abre: number) {
  if (k.corte !== null) return;
  const e = k.t / 0.46;
  const topo = k.t / 2 + altura * e;
  const y0 = k.t / 2 - 0.1 * e;
  const nu = k.alta ? 48 : 28;
  const nLado = k.alta ? 8 : 5;
  const nTampa = k.alta ? 6 : 4;
  const masc = mascaraDaFita(modo, false, false);
  const rep = 7;
  const cascaFake: CascaCfg = {
    espessura: 0,
    volume: 0,
    linha: { frente: 0, lado: 0, tras: 0 },
    bolhas: { amp: 1, freq: 26 },
  };
  const d = new Vector3();
  const tg = new Vector3();
  const ini = x.n;
  const L = nLado + nTampa + 1;
  for (let i = 0; i <= nu; i++) {
    const th = (i / nu) * 2 * PI;
    const sx = Math.sin(th);
    const cz = Math.cos(th);
    // seção de "caixa arredondada" (superelipse): lados retos de bloco, cantos macios
    const sup = (a: number) => Math.sign(a) * Math.pow(Math.abs(a), 0.55);
    // a base abraça a cabeça (com folga) e o bloco abre um pouco para cima
    const rx0 = k.t / 2 + 0.012 * e;
    const rz0 = k.d / 2 + 0.012 * e;
    let arco = 0;
    let ant: Vector3 | null = null;
    for (let j = 0; j < L; j++) {
      const p = new Vector3();
      let ref: Vector3;
      if (j <= nLado) {
        const s = j / nLado;
        const yy = lerp(y0, topo - 0.035 * e, s);
        // a base nasce rente à cabeça e logo abre: bojo em S até a largura cheia
        const k1 = lerp(0.97, 1 + abre, sstep(0, 1, s));
        p.set(sup(sx) * rx0 * k1, yy, sup(cz) * rz0 * k1);
        ref = new Vector3(sx, 0, cz);
      } else {
        // tampa: da quina arredondada até o centro, quase chata
        const s = (j - nLado) / nTampa;
        const q = 1 - s;
        const k1 = (1 + abre) * lerp(0.94, 0, s) + (1 + abre) * 0.06 * q * q;
        const yy = topo - 0.035 * e * (1 - Math.sin(Math.min(1, s * 2.4) * (PI / 2)));
        p.set(sup(sx) * rx0 * k1, yy, sup(cz) * rz0 * k1);
        ref = new Vector3(sx * q, 1, cz * q).normalize();
      }
      d.copy(p).normalize();
      // calombos de cacho (o tom e um pouco a forma)
      const b = bolha(cascaFake, d);
      p.addScaledVector(ref, (b - 0.5) * 0.006 * e);
      if (ant) arco += p.distanceTo(ant);
      ant = p.clone();
      tg.set(0, 1, 0);
      const tom = lerp(0.68, 1.06, b) * lerp(0.82, 1, sstep(0, 0.4, j / nLado));
      x.v(p, tom, masc(j / L), (i / nu) * rep, V_INICIO + arco / KV, tg, ref);
    }
  }
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < L - 1; j++) {
      const a = ini + i * L + j;
      const b = ini + (i + 1) * L + j;
      x.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  for (let j = 0; j < L; j++) x.costura.push([ini + j, ini + nu * L + j]);
}

/* ————————————————— Trancinhas nagô ————————————————— */

/**
 * Trancinhas nagô (cornrows): `n` tranças finas coladas no couro, da linha da
 * testa até a nuca, em linhas paralelas que abrem um pouco nos lados; as
 * pontas saem soltas abaixo da nuca. Sob chapéu, só o trecho abaixo do corte.
 */
function nago(x: Malha, k: Obra, modo: ModoMechas, n: number) {
  const e = k.t / 0.46;
  const R0 = 0.022 * e;
  const raio = (s: number) => R0 * lerp(1, 0.75, s);
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) : 0.5;
    const xs = lerp(-1, 1, f);
    const ax = Math.abs(xs);
    // as linhas do meio correm pelo alto; as dos lados descem pelas têmporas até atrás da orelha
    const naCab = [
      new Vector3(xs * 0.13, 0.17, 0.24),
      new Vector3(xs * lerp(0.16, 0.22, ax), 0.27, 0.05),
      new Vector3(xs * lerp(0.15, 0.24, ax), lerp(0.2, 0.1, ax), -0.18),
      new Vector3(xs * lerp(0.1, 0.2, ax), lerp(-0.05, -0.12, ax), -0.25),
    ]
      .map((d) => naCabeca(k, d, R0 * 0.55))
      .filter((p) => k.corte === null || p.y < k.corte - 0.03 * e);
    if (naCab.length < 1) continue;
    const ult = naCab[naCab.length - 1]!;
    const ctrl = [
      ...naCab,
      new Vector3(ult.x * 1.02, ult.y - 0.035 * e, ult.z - 0.02 * e),
      new Vector3(ult.x * 1.03, ult.y - 0.07 * e, ult.z - 0.02 * e),
    ];
    if (ctrl.length < 3) continue;
    const guia = guiaDeTranca(k, ctrl, raio, {
      lado: -1,
      l: Math.sign(xs) || 0,
      rente: naCab.length >= 3 ? 0.78 : 0.2,
    });
    tranca(k, x, guia, { raio, modo, tufo: 0, nGomos: naCab.length >= 3 ? 26 : 10 });
  }
}

/* ————————————————— Os penteados ————————————————— */

/** Os anéis de espetos do herói anime: do polo para fora (raiz, abraço e trecho solto). */
const ANEIS_DE_ESPETOS: {
  n: number;
  u: [number, number];
  raiz: [number, number];
  abraco: [number, number];
  livre: [number, number];
}[] = [
  { n: 4, u: [0, 1], raiz: [0, 0.04], abraco: [0.08, 0.12], livre: [0.18, 0.22] },
  { n: 7, u: [0.07, 1.07], raiz: [0.14, 0.18], abraco: [0.26, 0.3], livre: [0.17, 0.21] },
  // o anel de fora só atrás e nos lados (na frente fica a franja)
  { n: 7, u: [0.64, 1.36], raiz: [0.32, 0.36], abraco: [0.44, 0.48], livre: [0.13, 0.17] },
];

export const ESTILOS_MASCULINOS: Partial<Record<EstiloCabelo, (k: Obra) => Preset>> = {
  // Undercut: lados e nuca raspados (degradê) e o alto comprido, penteado para trás, com
  // as pontas soltas caindo de leve na coroa.
  undercut: (k) => ({
    inflar: 1.05,
    anel: true,
    fluxo: { tipo: "polo", dir: [0, 0.55, 1] },
    casca: {
      ...DEGRADE,
      volume: 0.03,
      linha: linha(LINHA_CURTA, k),
    },
    camadas: [
      // o alto: da testa para trás, deitado, até a coroa
      {
        n: 15,
        u: [0.81, 1.19],
        raiz: [0, 0.12],
        abraco: [0.42, 0.55],
        livre: [0.07, 0.1],
        largura: [0.07, 0.08],
        pontas: 2,
        levanta: 0.2,
        gravidade: 0.12,
        enrola: -2,
        afina: 0.35,
        abre: 0.25,
        folga: 0.032,
        testa: 0.15,
        antiPente: true,
      },
    ],
    // a frente sobe um pouco antes de deitar para trás (o alto "solto" do undercut)
    extras: (x, k2, modo) =>
      topete(x, k2, modo, {
        n: k2.alta ? 8 : 6,
        x: [-0.15, 0.15],
        alto: 0.055,
        frente: 0.02,
        volta: -0.13,
        largura: 0.055,
      }),
  }),
  // Social de lado lambido (side part): risca bem marcada à esquerda, o cabelo todo
  // penteado com gel (brilho), o lado grande varrendo por cima com uma onda baixa na frente.
  socialLambido: (k) => ({
    inflar: 1.0,
    anel: true,
    fluxo: { tipo: "risca", x: 0.075 },
    casca: {
      espessura: 0.012,
      volume: 0.022,
      volumeLado: 0.004,
      linha: linha(LINHA_CURTA, k),
      sulco: 0.9,
    },
    camadas: [
      // o lado grande (−x): da risca, deitado por cima até a lateral
      {
        n: 8,
        u: [0.675, 0.86],
        raiz: [0, 0.06],
        raizRente: true,
        abraco: [0.85, 0.98],
        livre: [0.02, 0.035],
        largura: [0.075, 0.085],
        pontas: 1,
        gravidade: 0.3,
        afina: 0.5,
        folga: 0.016,
        testa: 0.15,
        fimVar: 0.03,
      },
      // o lado curto (+x): penteado para baixo, rente
      {
        n: 5,
        u: [0.18, 0.33],
        raiz: [0, 0.06],
        raizRente: true,
        abraco: [0.85, 0.98],
        livre: [0.015, 0.03],
        largura: [0.07, 0.08],
        pontas: 1,
        gravidade: 0.4,
        afina: 0.5,
        folga: 0.012,
        testa: 0.15,
        fimVar: 0.03,
      },
      // a coroa: para trás, rente
      {
        n: 6,
        u: [-0.17, 0.17],
        raiz: [0, 0.08],
        raizRente: true,
        abraco: [0.9, 1.0],
        livre: [0.015, 0.03],
        largura: [0.075, 0.085],
        pontas: 1,
        gravidade: 0.4,
        afina: 0.5,
        folga: 0.012,
        zAlvo: "tras",
        fimVar: 0.03,
      },
    ],
    // a onda baixa da frente: sai da linha da testa, sobe pouco e deita para o lado grande
    extras: (x, k2, modo) =>
      topete(x, k2, modo, {
        n: k2.alta ? 7 : 5,
        x: [-0.17, 0.06],
        alto: 0.04,
        frente: 0.022,
        volta: -0.06,
        largura: 0.06,
        desvio: -0.07,
      }),
  }),
  // Topete quiff: lados curtos e a onda alta na frente, que sobe da testa e volta deitando
  // por cima da cabeça.
  topeteQuiff: (k) => ({
    inflar: 1.0,
    anel: true,
    fluxo: { tipo: "polo", dir: [0, 0.75, 0.65] },
    casca: {
      espessura: 0.01,
      volume: 0.03,
      volumeLado: 0.002,
      linha: linha(LINHA_CURTA, k),
    },
    camadas: [
      // o alto de trás: deitado para trás até a coroa
      {
        n: 10,
        u: [0.8, 1.2],
        raiz: [0.15, 0.3],
        abraco: [0.45, 0.6],
        livre: [0.05, 0.07],
        largura: [0.07, 0.08],
        pontas: 2,
        gravidade: 0.15,
        enrola: -2,
        afina: 0.35,
        folga: 0.024,
        testa: 0.15,
        antiPente: true,
      },
      // os lados de cima, curtos, penteados para trás
      ...espelhar(
        [0.6, 0.75],
        {
          n: 3,
          raiz: [0.2, 0.35],
          abraco: [0.5, 0.6],
          livre: [0.03, 0.05],
          largura: [0.06, 0.07],
          pontas: 2,
          gravidade: 0.2,
          enrola: -2,
          afina: 0.35,
          folga: 0.018,
          testa: 0.15,
        },
        0.3,
      ),
    ],
    extras: (x, k2, modo) =>
      topete(x, k2, modo, {
        n: k2.alta ? 9 : 7,
        x: [-0.14, 0.14],
        alto: 0.13,
        frente: 0.07,
        volta: -0.09,
        largura: 0.05,
      }),
  }),
  // Buzz cut com degradê: tudo rente na máquina, um pouco mais cheio no alto, e a linha da
  // testa reta e marcada.
  buzzCut: (k) => ({
    inflar: 1.0,
    fluxo: { tipo: "polo", dir: [0, 1, 0.15] },
    casca: {
      espessura: 0.005,
      volume: 0.014,
      volumeLado: 0,
      linha: linha({ frente: 0.155, lado: 0.03, tras: -0.15 }, k),
      tom: 0.82,
    },
    camadas: [
      // pontinhas curtas no alto (a textura do corte à máquina)
      {
        n: 22,
        u: [0, 1],
        raiz: [0, 0.4],
        abraco: [0.4, 0.6],
        livre: [0.004, 0.008],
        largura: [0.05, 0.06],
        pontas: 3,
        gravidade: 0.1,
        afina: 0.2,
        folga: 0.004,
        espessura: 0.25,
        testa: 0.155,
        tom: 0.85,
        jitter: 0.9,
      },
    ],
  }),
  // Coque masculino (man bun): o cabelo médio puxado para um coque baixo e bagunçado na
  // coroa, com duas mechas soltas na frente das orelhas.
  coqueMasculino: (k) => ({
    inflar: 1.0,
    fluxo: { tipo: "polo", dir: [0, 0.55, -0.8] },
    casca: {
      espessura: 0.016,
      volume: 0.02,
      volumeLado: 0.008,
      linha: linha({ frente: 0.15, lado: -0.02, tras: -0.17 }, k),
    },
    camadas: espelhar([0.33, 0.37], {
      n: 1,
      raiz: [0.72, 0.8],
      raizRente: true,
      abraco: [0.98, 1.02],
      livre: [0.11, 0.14],
      largura: [0.032, 0.038],
      pontas: 2,
      gravidade: 0.7,
      afina: 0.35,
      abre: 0.3,
      folga: 0.012,
      zAlvo: "frente",
      testa: 0.15,
      onda: 0.012,
      frente: true,
    }),
    extras: (x, k2, modo) => {
      const e = k2.t / 0.46;
      const dirCoque = new Vector3(0, 0.62, -0.78).normalize();
      const base = naCabeca(k2, dirCoque, 0.02 * e);
      const coberto = k2.corte !== null && base.y > k2.corte - 0.06 * e;
      // sob chapéu o coque desce para a nuca, abaixo do corte
      const alvo = coberto ? naCabeca(k2, new Vector3(0, -0.12, -1), 0.02 * e) : base;
      for (const l of [-1, 1]) {
        penteadoAte(k2, x, alvo, {
          de: [
            new Vector3(0.05 * l, 0.22, 0.2),
            new Vector3(0.14 * l, 0.22, 0.17),
            new Vector3(0.22 * l, 0.14, 0.1),
            new Vector3(0.24 * l, 0.02, 0.0),
            new Vector3(0.22 * l, -0.08, -0.12),
          ],
          largura: 0.08 * e,
          folga: [0.012, 0.012],
          modo,
          frente: 2,
        });
        penteadoAte(k2, x, alvo, {
          de: [new Vector3(0.08 * l, -0.16, -0.22), new Vector3(0.18 * l, -0.14, -0.18)],
          largura: 0.07 * e,
          folga: [0.008, 0.008],
          modo,
        });
      }
      const centro = alvo.clone().addScaledVector(dirCoque, 0.065 * e);
      coqueDeFitas(k2, x, centro, 0.075 * e, modo, 0.7);
    },
  }),
  // Surfista: comprido até o queixo/ombro, ondulado e desfiado pelo sal, risca no meio e as
  // mechas da frente caindo de lado (cortina).
  surfista: (k) => ({
    inflar: 1.05,
    fluxo: { tipo: "risca", x: 0 },
    casca: {
      espessura: 0.02,
      volume: 0.028,
      volumeLado: 0.03,
      linha: linha({ frente: 0.15, lado: -0.03, tras: -0.17 }, k),
      sulco: 0.6,
    },
    camadas: [
      // costas e lados: até a altura do ombro, onduladas e repicadas
      {
        n: 18,
        u: [0.62, 1.38],
        raiz: [0.1, 0.22],
        abraco: [0.98, 1.04],
        livre: [0.26, 0.34],
        largura: [0.065, 0.075],
        pontas: 2,
        gravidade: 0.45,
        afina: 0.35,
        abre: 0.3,
        folga: 0.024,
        zAlvo: "tras",
        onda: 0.02,
        jitter: 0.35,
        fimVar: 0.12,
        antiPente: true,
      },
      // lados da frente: na frente da orelha até o queixo
      ...espelhar([0.255, 0.31], {
        n: 3,
        raiz: [0.1, 0.2],
        raizRente: true,
        abraco: [1.0, 1.04],
        livre: [0.22, 0.28],
        largura: [0.06, 0.07],
        pontas: 2,
        gravidade: 0.45,
        afina: 0.35,
        abre: 0.3,
        folga: 0.028,
        zAlvo: "frente",
        testa: 0.15,
        onda: 0.018,
        jitter: 0.3,
        frente: true,
      }),
      // cortina: as da frente saem da risca e caem de lado, abrindo a testa
      ...espelhar([0.312, 0.33], {
        n: 2,
        raiz: [0.02, 0.08],
        raizRente: true,
        abraco: [1.0, 1.04],
        livre: [0.2, 0.26],
        largura: [0.06, 0.07],
        pontas: 2,
        gravidade: 0.4,
        afina: 0.4,
        abre: 0.3,
        enrola: 1.4,
        enrolaDesde: 0.5,
        folga: 0.032,
        zAlvo: "frente",
        testa: 0.16,
        onda: 0.016,
        frente: true,
      }),
    ],
  }),
  // Cacheado no topo com degradê: cachinhos fofos e espetados só no alto, os lados e a nuca
  // no degradê rente.
  cacheadoDegrade: (k) => ({
    inflar: 1.05,
    textura: "cachos",
    fluxo: { tipo: "polo", dir: [0, 1, 0.1] },
    casca: {
      espessura: 0.006,
      volume: 0.032,
      volumeLado: 0,
      linha: linha(LINHA_CURTA, k),
      bolhas: { amp: 0.008, freq: 18 },
    },
    camadas: [],
    // as molas do alto
    // as molas do alto, nascendo na superfície da casca (espessura + bojo, que cresce com o y)
    extras: (x, k2, modo) =>
      cachinhos(x, k2, modo, k2.alta ? 100 : 56, 0.1, (fy) => 0.006 + 0.034 * fy ** 1.5),
  }),
  // Herói anime: espetos grandes para todo lado (o clássico de anime/Roblox), franja de
  // três pontas na testa e mechas espetadas por cima das orelhas.
  heroiAnime: (k) => ({
    inflar: 1.1,
    anel: true,
    franja: true,
    fluxo: { tipo: "polo", dir: [0, 0.9, -0.3] },
    casca: {
      espessura: 0.028,
      volume: 0.05,
      volumeLado: 0.02,
      linha: linha({ frente: 0.15, lado: -0.01, tras: -0.17 }, k),
    },
    camadas: [
      // a coroa de espetos em três anéis: o do meio aponta para cima, os de fora abrem em
      // leque para os lados e para trás (a silhueta de estrela)
      ...ANEIS_DE_ESPETOS.map((a): Camada => ({
        n: a.n,
        u: a.u,
        raiz: a.raiz,
        abraco: a.abraco,
        livre: a.livre,
        largura: [0.1, 0.115],
        pontas: 1,
        levanta: 1.4,
        gravidade: 0.012,
        afina: 0.06,
        folga: 0.03,
        testa: 0.15,
        jitter: 0.3,
      })),
      // espetos de trás, mais baixos, saindo da nuca para trás
      {
        n: 7,
        u: [0.82, 1.18],
        raiz: [0.3, 0.45],
        abraco: [0.5, 0.6],
        livre: [0.12, 0.15],
        largura: [0.09, 0.1],
        pontas: 1,
        levanta: 0.9,
        gravidade: 0.04,
        afina: 0.08,
        folga: 0.03,
        testa: 0.15,
        antiPente: true,
      },
      // por cima das orelhas, espetando para fora
      ...espelhar([0.22, 0.32], {
        n: 3,
        raiz: [0.35, 0.45],
        abraco: [0.6, 0.7],
        livre: [0.1, 0.13],
        largura: [0.08, 0.09],
        pontas: 1,
        levanta: 0.7,
        gravidade: 0.08,
        afina: 0.1,
        folga: 0.03,
        testa: 0.15,
        antiPente: true,
      }),
      // a franja de três pontas
      {
        n: 3,
        u: [0.43, 0.57],
        raiz: [0.25, 0.35],
        abraco: [0.95, 1.02],
        livre: [0.1, 0.12],
        largura: [0.075, 0.085],
        pontas: 1,
        gravidade: 0.4,
        enrola: 1.5,
        afina: 0.1,
        abre: 0.6,
        folga: 0.028,
        testa: 0.12,
        franja: true,
        frente: true,
        jitter: 0.2,
      },
    ],
  }),
  // Mullet roqueiro: curto e espetado em cima e nos lados, comprido e repicado atrás até
  // o ombro ("negócios na frente, festa atrás").
  mulletRoqueiro: (k) => ({
    inflar: 1.1,
    franja: true,
    fluxo: { tipo: "polo", dir: [0, 0.94, -0.33] },
    casca: {
      espessura: 0.022,
      volume: 0.035,
      volumeLado: 0.008,
      linha: linha({ frente: 0.15, lado: -0.0, tras: -0.19 }, k),
    },
    camadas: [
      // o alto: mechas curtas espetadas, bagunçadas
      {
        n: 14,
        u: [0, 1],
        raiz: [0, 0.1],
        abraco: [0.4, 0.6],
        livre: [0.05, 0.08],
        largura: [0.075, 0.085],
        pontas: 3,
        levanta: 0.5,
        gravidade: 0.1,
        enrola: 3,
        afina: 0.25,
        abre: 0.4,
        folga: 0.04,
        torce: 0.5,
        testa: 0.15,
        antiPente: true,
      },
      // a franja curta e desfiada
      {
        n: 6,
        u: [0.39, 0.61],
        raiz: [0.2, 0.35],
        abraco: [0.95, 1.02],
        livre: [0.07, 0.09],
        largura: [0.055, 0.065],
        pontas: 2,
        gravidade: 0.45,
        enrola: 1.2,
        afina: 0.3,
        abre: 0.4,
        folga: 0.026,
        testa: 0.13,
        franja: true,
        frente: true,
        frenteN: 2,
        jitter: 0.3,
        antiPente: true,
      },
      // a "festa": a nuca comprida, até o ombro, repicada e com a ponta virando para fora
      {
        n: 13,
        u: [0.8, 1.2],
        raiz: [0.35, 0.55],
        raizRente: true,
        abraco: [0.98, 1.03],
        livre: [0.28, 0.34],
        largura: [0.07, 0.08],
        pontas: 3,
        gravidade: 0.45,
        enrola: 2.2,
        enrolaDesde: 0.6,
        afina: 0.3,
        abre: 0.35,
        folga: 0.02,
        zAlvo: "tras",
        onda: 0.012,
        jitter: 0.4,
        fimVar: 0.12,
      },
      // os lados de trás, um pouco menores (a transição do mullet)
      ...espelhar([0.17, 0.25], {
        n: 3,
        raiz: [0.35, 0.55],
        raizRente: true,
        abraco: [0.98, 1.03],
        livre: [0.16, 0.2],
        largura: [0.065, 0.075],
        pontas: 2,
        gravidade: 0.45,
        enrola: 2,
        enrolaDesde: 0.6,
        afina: 0.3,
        abre: 0.3,
        folga: 0.02,
        zAlvo: "tras",
        jitter: 0.3,
      }),
    ],
  }),
  // Hi-top fade: o bloco alto de cachinhos, de topo chato, com os lados no degradê.
  hiTop: (k) => ({
    inflar: 1.0,
    textura: "cachos",
    fluxo: { tipo: "polo", dir: [0, 1, 0] },
    casca: {
      ...DEGRADE,
      volume: 0.012,
      linha: linha({ frente: 0.155, lado: 0.01, tras: -0.15 }, k),
      bolhas: { amp: 0.004, freq: 16 },
    },
    camadas: [],
    extras: (x, k2, modo) => blocoAlto(x, k2, modo, 0.17, 0.06),
  }),
  // Trancinhas nagô (cornrows): sete tranças finas coladas no couro, da testa à nuca.
  nago: (k) => ({
    inflar: 1.0,
    fluxo: { tipo: "polo", dir: [0, 0.3, -1] },
    casca: {
      espessura: 0.005,
      volume: 0.006,
      volumeLado: 0,
      linha: linha({ frente: 0.15, lado: -0.03, tras: -0.17 }, k),
      tom: 0.78,
    },
    camadas: [],
    extras: (x, k2, modo) => nago(x, k2, modo, k2.alta ? 7 : 5),
  }),
  // Franja e-boy: o bagunçado comprido em cima, com a franja grossa e desfiada cobrindo a
  // testa até a sobrancelha e os lados caindo por cima das orelhas.
  franjaEboy: (k) => ({
    inflar: 1.12,
    franja: true,
    fluxo: { tipo: "polo", dir: [0, 0.9, -0.42] },
    casca: {
      espessura: 0.026,
      volume: 0.04,
      volumeLado: 0.018,
      linha: linha({ frente: 0.15, lado: -0.04, tras: -0.18 }, k),
    },
    camadas: [
      // a volta toda, até a nuca, pontas para dentro
      {
        n: 18,
        u: [0.6, 1.4],
        raiz: [0.05, 0.2],
        abraco: [0.95, 1.05],
        livre: [0.06, 0.09],
        largura: [0.07, 0.08],
        pontas: 2,
        levanta: 0.15,
        gravidade: 0.25,
        enrola: -1.5,
        afina: 0.3,
        folga: 0.016,
        tom: 0.85,
        testa: 0.15,
        antiPente: true,
      },
      // o volume do alto: mechas grandes e bagunçadas
      {
        n: 12,
        u: [0, 1],
        raiz: [0, 0.1],
        abraco: [0.45, 0.65],
        livre: [0.07, 0.1],
        largura: [0.08, 0.09],
        pontas: 2,
        levanta: 0.35,
        gravidade: 0.15,
        enrola: 2.5,
        afina: 0.25,
        abre: 0.4,
        folga: 0.05,
        torce: 0.6,
        testa: 0.15,
        antiPente: true,
      },
      // lados caindo por cima das orelhas
      ...espelhar([0.27, 0.36], {
        n: 3,
        raiz: [0.1, 0.25],
        abraco: [0.95, 1.05],
        livre: [0.08, 0.11],
        largura: [0.065, 0.075],
        pontas: 2,
        gravidade: 0.35,
        enrola: -1.5,
        afina: 0.3,
        abre: 0.3,
        folga: 0.03,
        testa: 0.15,
        zAlvo: "frente",
        antiPente: true,
      }),
      // a franja cheia: 9 tufos até a sobrancelha, pontas finas desencontradas
      {
        n: 9,
        u: [0.37, 0.63],
        raiz: [0.18, 0.32],
        abraco: [0.95, 1.02],
        livre: [0.13, 0.16],
        largura: [0.06, 0.07],
        pontas: 2,
        levanta: 0.05,
        gravidade: 0.5,
        enrola: 1.0,
        afina: 0.3,
        abre: 0.4,
        folga: 0.03,
        testa: 0.115,
        franja: true,
        frente: true,
        frenteN: 3,
        jitter: 0.3,
        antiPente: true,
      },
    ],
  }),
  // Coque samurai (chonmage moderno): lados raspados e o alto puxado num coque alto,
  // pequeno e firme, no meio da cabeça, com o rabinho apontando para a frente.
  samurai: (k) => ({
    inflar: 1.0,
    anel: true,
    fluxo: { tipo: "polo", dir: [0, 1, -0.2] },
    casca: {
      ...DEGRADE,
      volume: 0.02,
      linha: linha({ frente: 0.15, lado: 0.02, tras: -0.15 }, k),
    },
    camadas: [],
    extras: (x, k2, modo) => {
      if (k2.corte !== null) return;
      const e = k2.t / 0.46;
      const alvo = naCabeca(k2, new Vector3(0, 1, -0.2), 0.02 * e);
      // o alto puxado até o coque: da testa, das têmporas e da coroa
      for (const l of [-1, 1])
        penteadoAte(k2, x, alvo, {
          de: [
            new Vector3(0.03 * l, 0.15, 0.24),
            new Vector3(0.1 * l, 0.15, 0.22),
            new Vector3(0.16 * l, 0.2, 0.12),
            new Vector3(0.18 * l, 0.24, -0.02),
            new Vector3(0.15 * l, 0.2, -0.17),
            new Vector3(0.05 * l, 0.15, -0.22),
          ],
          largura: 0.075 * e,
          folga: [0.008, 0.016],
          modo,
          frente: 2,
        });
      const centro = alvo.clone().add(new Vector3(0, 0.05 * e, -0.005 * e));
      coqueDeFitas(k2, x, centro, 0.05 * e, modo, 0.1);
      // o rabinho dobrado para a frente, em cima do coque
      const tom = tomDaMecha(1);
      const masc = mascaraDaFita(modo, false, false);
      const g = curva(
        [
          centro.clone().add(new Vector3(0, 0.035 * e, -0.02 * e)),
          centro.clone().add(new Vector3(0, 0.06 * e, 0.03 * e)),
          centro.clone().add(new Vector3(0, 0.05 * e, 0.09 * e)),
          centro.clone().add(new Vector3(0, 0.02 * e, 0.13 * e)),
        ],
        10,
      );
      miolo(k2, x, g, (v) => 0.022 * e * (1 - 0.6 * v), 0.5);
      tufo(k2, x, g, {
        largura: 0.03 * e,
        espessura: 0.5,
        afina: 0.5,
        raiz: 1,
        pontas: 3,
        abre: 0.4,
        concha: 0.15,
        torce: 0,
        V0: V_INICIO + 0.02,
        u0: k2.r() * 0.8,
        tom: (v) => tom(0.4 + 0.6 * v),
        mascara: (v) => masc(v),
        separa: 0.3,
        redondo: (v) => 0.026 * e * lerp(1, 0.35, v),
      });
    },
  }),
};

/*
 * Medidas da silhueta (corpo clássico, sem chapéu, alta), tiradas de `montarCabelo` na
 * bancada (scratchpad/catalogo-cabeca/medir.mjs, 16/10/2026 — o mesmo método das de
 * `cabelo-estilos.ts`: o bagunçado deu 0,191 / 0,725 / 0,564, idêntico): os enfeites que não
 * cobrem o alto (auréola, chifrinhos, chapéu de festa, fone) sobem/abrem por elas.
 */
/** Topo do cabelo acima do ALTO da cabeça (y = t/2), em m. */
export const ALTURA_TOPO_MASCULINOS: Partial<Record<EstiloCabelo, number>> = {
  undercut: 0.094,
  socialLambido: 0.075,
  topeteQuiff: 0.149,
  buzzCut: 0.036,
  coqueMasculino: 0.091,
  surfista: 0.098,
  cacheadoDegrade: 0.11,
  heroiAnime: 0.319,
  mulletRoqueiro: 0.162,
  hiTop: 0.172,
  nago: 0.03,
  franjaEboy: 0.157,
  samurai: 0.173,
};
/** Largura total do alto (m), de frente, na faixa y = t/2 ± 0,03. */
export const LARGURA_TOPO_MASCULINOS: Partial<Record<EstiloCabelo, number>> = {
  undercut: 0.583,
  socialLambido: 0.545,
  topeteQuiff: 0.557,
  buzzCut: 0.457,
  coqueMasculino: 0.495,
  surfista: 0.621,
  cacheadoDegrade: 0.577,
  heroiAnime: 0.794,
  mulletRoqueiro: 0.611,
  hiTop: 0.491,
  nago: 0.469,
  franjaEboy: 0.708,
  samurai: 0.456,
};
/** Largura total na altura das orelhas (m), |y| < 0,03. */
export const LARGURA_LATERAL_MASCULINOS: Partial<Record<EstiloCabelo, number>> = {
  undercut: 0.538,
  socialLambido: 0.539,
  topeteQuiff: 0.49,
  buzzCut: 0.47,
  coqueMasculino: 0.511,
  surfista: 0.64,
  cacheadoDegrade: 0.484,
  heroiAnime: 0.552,
  mulletRoqueiro: 0.588,
  hiTop: 0.477,
  nago: 0.471,
  franjaEboy: 0.624,
  samurai: 0.474,
};
