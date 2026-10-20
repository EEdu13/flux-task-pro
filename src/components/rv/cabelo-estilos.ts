import { Vector3 } from "three";
import type { AvatarConfig } from "@/lib/avatar-3d";
import {
  empurrarDaCabeca,
  lerp,
  limitarEncosto,
  sstep,
  type CascaCfg,
  type Fluxo,
  type Malha,
  type Obra,
} from "@/components/rv/cabelo-casca";
import { feixeGota, tufo } from "@/components/rv/cabelo-fita";
import {
  guiaSobreACabeca,
  mascaraDaFita,
  pousar,
  tomDaMecha,
  type Camada,
  type ModoMechas,
} from "@/components/rv/cabelo-guia";
import { V_INICIO } from "@/components/rv/cabelo-texturas";
import {
  coqueDeFitas,
  flor,
  guiaDeTranca,
  penteadoAte,
  raboDoAlto,
  raioQueAfina,
  tranca,
  trancasSoltas,
} from "@/components/rv/cabelo-pecas";
import {
  ALTURA_TOPO_MASCULINOS,
  ESTILOS_MASCULINOS,
  LARGURA_LATERAL_MASCULINOS,
  LARGURA_TOPO_MASCULINOS,
} from "@/components/rv/cabelo-estilos-masculinos";

/*
 * O catálogo do cabelo novo: cada penteado é uma receita (fluxo + casca +
 * camadas de mechas + peças extras). Números no corpo clássico (t = 0,46),
 * em metros; o que depende da cabeça escala por k.t. Na Fase 0 só os
 * penteados da fatia vertical estão aqui — os outros continuam no motor
 * antigo (`cabelos-3d.ts`) pelo despacho em `cabeca-3d.tsx`.
 *
 * Nas riscas (`risca` no meio), u = 0,173–0,327 é o lado +x da risca e
 * 0,673–0,827 o lado −x; entre os dois fica a ponta da frente, onde o fluxo
 * abre em leque. As mechas que emolduram o rosto nascem no LADO da risca,
 * perto da frente: assim descem cada uma para o seu lado, sem se cruzar no
 * alto da testa (o leque da frente fica só com a casca — a risca em V).
 */

/** Valores que entram no `OPCOES.cabelo` na Fase 1 (união local: o tsc fica verde antes do Edit). */
type CabeloNovo =
  | "fofoMeio"
  | "espetado"
  | "mullet"
  | "boxBraids"
  | "chiquinhaBaixa"
  | "meioPreso"
  | "degrade"
  | "twists"
  | "cacheadoMedio";
export type EstiloCabelo = Exclude<AvatarConfig["cabelo"], "careca"> | CabeloNovo;

export type Preset = {
  /** Desenho da textura: fios retos (padrão) ou cachinhos. */
  textura?: "fios" | "cachos";
  /** Anel de brilho pintado na textura (catálogos anime 53/54). */
  anel?: boolean;
  /** Superdimensionamento dos estilos fofos (C2.9). */
  inflar?: number;
  fluxo: Fluxo;
  casca: CascaCfg;
  camadas: Camada[];
  extras?: (x: Malha, k: Obra, modo: ModoMechas) => void;
  /** Tem franja sobre a testa (o véu de sombra só existe nesses). */
  franja?: boolean;
  /**
   * As luzes da frente fazem parte do penteado: a faixa da casca dos dois lados
   * da risca sai sempre na cor das mechas (somada ao modo escolhido).
   */
  luzesNaFrente?: boolean;
};

const LINHA_CURTA = { frente: 0.15, lado: 0.0, tras: -0.16 };
const LINHA_LONGA = { frente: 0.15, lado: -0.06, tras: -0.19 };

/** A linha do cabelo no corpo da obra (os números são do clássico, t = 0,46). */
function linha(l: CascaCfg["linha"], k: Obra): CascaCfg["linha"] {
  const e = k.t / 0.46;
  return { frente: l.frente * e, lado: l.lado * e, tras: l.tras * e };
}

/**
 * As duas metades de uma camada da risca, espelhadas em u (u ↔ 1 − u). A
 * `deriva` vale para a metade dada; a espelhada recebe a oposta (o mesmo
 * desvio visto do outro lado).
 */
function espelhar(u: [number, number], c: Omit<Camada, "u" | "deriva">, deriva = 0): Camada[] {
  return [
    { ...c, u, deriva },
    { ...c, u: [1 - u[1], 1 - u[0]], deriva: -deriva },
  ];
}

/** Os penteados do motor novo. Os ausentes caem no motor antigo. */
export const ESTILOS: Partial<Record<EstiloCabelo, (k: Obra) => Preset>> = {
  baguncado: (k) => ({
    inflar: 1.15,
    franja: true,
    fluxo: { tipo: "polo", dir: [0, 0.94, -0.33] },
    casca: { espessura: 0.03, volume: 0.035, volumeLado: 0.012, linha: linha(LINHA_CURTA, k) },
    camadas: [
      // de baixo: volta toda, até a linha do cabelo, ponta para fora (nuca em pontas)
      {
        n: 18,
        u: [0, 1],
        raiz: [0.05, 0.25],
        abraco: [0.92, 1.04],
        livre: [0.035, 0.065],
        largura: [0.065, 0.075],
        pontas: 2,
        levanta: 0.35,
        gravidade: 0.1,
        enrola: 3,
        afina: 0.3,
        tom: 0.8,
        folga: 0.012,
        torce: 0.4,
        testa: 0.15,
        antiPente: true,
      },
      // de cima: mechas grandes saindo do redemoinho, com volume (o "fofo")
      {
        n: 14,
        u: [0, 1],
        raiz: [0, 0.1],
        abraco: [0.5, 0.75],
        livre: [0.055, 0.09],
        largura: [0.08, 0.09],
        pontas: 3,
        levanta: 0.45,
        gravidade: 0.12,
        enrola: 3.5,
        afina: 0.25,
        abre: 0.4,
        folga: 0.05,
        torce: 0.6,
        testa: 0.15,
        antiPente: true,
      },
      // franja: 7 tufos que caem na testa até ~meia testa (o do meio mais comprido, pontas
      // desencontradas) e encostam nela — a franja da ref. 54
      {
        n: 7,
        u: [0.385, 0.615],
        raiz: [0.2, 0.35],
        abraco: [0.95, 1.02],
        livre: [0.09, 0.11],
        largura: [0.055, 0.065],
        pontas: 2,
        levanta: 0.06,
        gravidade: 0.45,
        enrola: 1.2,
        afina: 0.3,
        abre: 0.45,
        folga: 0.028,
        testa: 0.13,
        franja: true,
        jitter: 0.3,
        frente: true,
        frenteN: 2,
        antiPente: true,
      },
      // antenas: 2 fitas finas que escapam do redemoinho
      {
        n: 2,
        u: [0.15, 0.4],
        raiz: [0, 0.04],
        abraco: [0.15, 0.25],
        livre: [0.07, 0.09],
        largura: [0.03, 0.035],
        levanta: 0.9,
        gravidade: 0.06,
        enrola: 8,
        afina: 0.2,
        folga: 0.05,
        testa: 0.15,
      },
    ],
  }),
  anime: (k) => ({
    inflar: 1.15,
    anel: true,
    franja: true,
    fluxo: { tipo: "polo", dir: [0, 0.9, -0.44] },
    casca: {
      espessura: 0.028,
      volume: 0.04,
      volumeLado: 0.026,
      linha: linha({ frente: 0.15, lado: -0.02, tras: -0.17 }, k),
    },
    camadas: [
      // costas e lados: mechas largas que descem até a nuca/maxilar; a ponta vira um pouco, rente
      // (sem "chifre" saindo na horizontal)
      {
        n: 13,
        u: [0.62, 1.38],
        raiz: [0.05, 0.2],
        abraco: [1.0, 1.15],
        livre: [0.06, 0.09],
        largura: [0.075, 0.085],
        pontas: 2,
        levanta: 0.1,
        gravidade: 0.28,
        enrola: 2.2,
        enrolaDesde: 0.4,
        afina: 0.25,
        tom: 0.82,
        folga: 0.012,
        testa: 0.15,
        saidaMax: 0.05,
        antiPente: true,
      },
      // alto: espetos grandes para trás/cima (a silhueta), largos e sobrepostos (sem fresta)
      {
        n: 7,
        u: [0.7, 1.3],
        raiz: [0, 0.06],
        abraco: [0.35, 0.5],
        livre: [0.1, 0.13],
        largura: [0.085, 0.095],
        pontas: 2,
        levanta: 0.6,
        gravidade: 0.05,
        enrola: 2.2,
        afina: 0.18,
        folga: 0.03,
        testa: 0.15,
        antiPente: true,
      },
      // lados de cima, caindo por cima da orelha
      ...[0.3, 0.7].map((c): Camada => ({
        n: 3,
        u: [c - 0.06, c + 0.06],
        raiz: [0.05, 0.15],
        abraco: [1.0, 1.1],
        livre: [0.05, 0.07],
        largura: [0.07, 0.08],
        pontas: 2,
        levanta: 0.12,
        gravidade: 0.25,
        enrola: 2.5,
        enrolaDesde: 0.3,
        afina: 0.22,
        folga: 0.028,
        testa: 0.15,
        saidaMax: 0.06,
        antiPente: true,
      })),
      // franja: 5 tufos de 2 pontas finas e desencontradas até a sobrancelha (ref. 53), sem
      // levantar (nada de gancho na frente do rosto)
      {
        n: 5,
        u: [0.41, 0.59],
        raiz: [0.15, 0.3],
        abraco: [1.0, 1.08],
        livre: [0.04, 0.06],
        largura: [0.065, 0.075],
        pontas: 2,
        levanta: 0.03,
        gravidade: 0.4,
        enrola: 0.6,
        afina: 0.13,
        abre: 0.35,
        // folga baixa: com 4 cm a franja passava a quina da testa em arco e, de perfil, virava
        // um gancho na frente do rosto
        folga: 0.024,
        testa: 0.125,
        franja: true,
        frente: true,
        frenteN: 2,
        jitter: 0.2,
        antiPente: true,
      },
      // costeletas compridas dos lados do rosto (até o maxilar)
      ...[0.355, 0.645].map((c): Camada => ({
        n: 1,
        u: [c - 0.005, c + 0.005],
        raiz: [0.35, 0.45],
        abraco: [1.0, 1.05],
        livre: [0.1, 0.12],
        largura: [0.055, 0.06],
        pontas: 2,
        gravidade: 0.4,
        enrola: 1.2,
        enrolaDesde: 0.5,
        afina: 0.22,
        folga: 0.034,
        zAlvo: "frente",
        testa: 0.15,
        frente: true,
      })),
    ],
  }),
  longo: (k) => {
    const esc = k.t / 0.46;
    return {
      fluxo: { tipo: "risca", x: 0 },
      casca: {
        espessura: 0.014,
        volume: 0.014,
        volumeLado: 0.07,
        linha: linha(LINHA_LONGA, k),
        // risca marcada mas rasa (com o sulco de 70% os dois lados viravam "coração" no alto)
        sulco: 0.5,
      },
      camadas: [
        // cortina de trás, por baixo (um pouco mais escura, larga): a barra em V (centro de
        // trás mais longo), uma ponta por fita — 10–16 pontas grandes na barra, não serrilha
        {
          n: 10,
          u: [-0.21, 0.21],
          raiz: [0.2, 0.35],
          raizRente: true,
          abraco: [0.98, 1.02],
          livre: [0.47, 0.53],
          largura: [0.1, 0.11],
          pontas: 1,
          gravidade: 0.55,
          afina: 0.6,
          enrola: -0.8,
          tom: 0.86,
          folga: 0.008,
          zAlvo: "tras",
          vCentro: 0.12,
        },
        // costas e lados de trás, por cima: saem da risca, descem e acabam JUNTO com a de baixo
        // (pontas desencontradas por cima das dela: sem degrau no meio das costas)
        {
          n: 13,
          u: [0.75, 1.25],
          raiz: [0.12, 0.22],
          raizRente: true,
          abraco: [0.98, 1.03],
          livre: [0.46, 0.53],
          largura: [0.09, 0.1],
          pontas: 1,
          gravidade: 0.45,
          afina: 0.58,
          abre: 0.2,
          levanta: 0.4,
          enrola: -0.2,
          folga: 0.02,
          zAlvo: "tras",
          nivelar: 0.8,
          vCentro: 0.12,
          fimVar: 0.06,
        },
        // lados da frente: do lado da risca, na frente da orelha; caem na frente dos ombros
        // (pousam no peito, fora da gola)
        ...espelhar([0.262, 0.308], {
          n: 3,
          raiz: [0.12, 0.2],
          raizRente: true,
          abraco: [0.98, 1.03],
          livre: [0.62, 0.7],
          largura: [0.075, 0.085],
          pontas: 1,
          gravidade: 0.55,
          afina: 0.58,
          abre: 0.2,
          enrola: -0.6,
          folga: 0.026,
          zAlvo: "frente",
          testa: 0.17,
          jitter: 0.3,
        }),
        // moldura do rosto (ref. 58): a fita da frente de cada lado, larga, sai da risca a
        // ~2 cm do meio e desce pela têmpora até o peito
        ...espelhar([0.31, 0.324], {
          n: 2,
          raiz: [0.06, 0.12],
          raizRente: true,
          abraco: [1.0, 1.05],
          livre: [0.62, 0.7],
          largura: [0.068, 0.076],
          pontas: 2,
          gravidade: 0.5,
          afina: 0.55,
          abre: 0.3,
          enrola: -0.5,
          folga: 0.032,
          zAlvo: "frente",
          testa: 0.17,
          frente: true,
          jitter: 0.2,
        }),
      ],
      extras: (x, k2) => lado(x, k2, esc),
    };
  },
  chiquinha: (k) => ({
    inflar: 1.0,
    fluxo: { tipo: "risca", x: 0 },
    casca: {
      espessura: 0.024,
      volume: 0.06,
      volumeLado: 0.02,
      linha: linha({ frente: 0.15, lado: -0.04, tras: -0.19 }, k),
      sulco: 0.7,
    },
    camadas: [
      // mechas de rosto (ref. 60): 2 de cada lado, saem da risca a ~2 cm do meio, descem pela
      // têmpora até o queixo e só a ponta vira para dentro (gancho). A testa fica livre no
      // meio — a linha do cabelo desce em diagonal da risca até a têmpora.
      ...espelhar([0.298, 0.322], {
        n: 2,
        raiz: [0.1, 0.16],
        raizRente: true,
        abraco: [1.0, 1.04],
        livre: [0.38, 0.44],
        largura: [0.055, 0.065],
        pontas: 2,
        gravidade: 0.45,
        afina: 0.45,
        abre: 0.25,
        enrola: -7,
        enrolaDesde: 0.72,
        folga: 0.024,
        zAlvo: "frente",
        testa: 0.17,
        frente: true,
      }),
    ],
    extras: (x, k, modo) => chiquinhas(x, k, modo),
  }),
  // Duas tranças de 3 mechas: risca no meio (marcada, do alto até a nuca), o cabelo todo
  // puxado rente até atrás de cada orelha, e as tranças caindo por cima dos ombros até o peito.
  trancas: (k) => ({
    inflar: 1.0,
    fluxo: { tipo: "risca", x: 0 },
    casca: {
      espessura: 0.014,
      volume: 0.018,
      volumeLado: 0.004,
      // lados e nuca cobertos até o maxilar: a trança sai do volume do cabelo
      linha: linha({ frente: 0.15, lado: -0.14, tras: -0.21 }, k),
      sulco: 0.7,
    },
    camadas: [],
    extras: (x, k2, modo) =>
      trancasSoltas(x, k2, modo, { lados: [-1, 1], R0: 0.1, yRaiz: -0.07, ate: 0.8, nGomos: 16 }),
  }),
  // Longo com luzes na frente (ref. 97): o longo liso com as duas mechas grossas da moldura
  // do rosto sempre na cor das mechas (o "money piece"), desde a risca, e pontas em V finas.
  longoMechas: (k) => {
    const b = ESTILOS.longo!(k);
    return {
      ...b,
      luzesNaFrente: true,
      camadas: [
        // as do longo, sem a moldura (as 2 últimas) e com as pontas mais finas
        ...b.camadas.slice(0, -2).map((c): Camada => ({ ...c, afina: 0.48 })),
        // a moldura loira: larga, sai da risca a ~2 cm do meio e desce pela têmpora até o peito
        ...espelhar([0.305, 0.322], {
          n: 2,
          raiz: [0.04, 0.1],
          raizRente: true,
          abraco: [1.0, 1.05],
          livre: [0.64, 0.72],
          largura: [0.1, 0.11],
          pontas: 1,
          gravidade: 0.5,
          afina: 0.5,
          abre: 0.2,
          enrola: -0.5,
          folga: 0.034,
          zAlvo: "frente",
          testa: 0.17,
          frente: true,
          mecha: true,
          jitter: 0.15,
        }),
      ],
    };
  },
  // Longo liso escorrido (ref. 98): o alto liso e rente (sem bojo nos lados), as mechas
  // coladas que caem retas nas costas e por cima dos ombros, a frente um pouco mais comprida
  // e pontas finas.
  longoEscorrido: (k) => {
    const b = ESTILOS.longo!(k);
    return {
      ...b,
      casca: { ...b.casca, espessura: 0.012, volume: 0.006, volumeLado: 0.018, sulco: 0.55 },
      camadas: b.camadas.map((c): Camada => ({
        ...c,
        // rente: sem levantar nem enrolar, folga pequena
        folga: Math.min(c.folga ?? 0.02, 0.018),
        levanta: 0,
        enrola: c.zAlvo === "frente" ? -0.3 : -0.15,
        afina: 0.4,
        fimVar: 0.1,
        livre:
          c.zAlvo === "frente"
            ? [c.livre[0] + 0.2, c.livre[1] + 0.22]
            : [c.livre[0] - 0.06, c.livre[1] - 0.05],
      })),
      extras: undefined,
    };
  },
  // Chiquinhas longas (ref. 99): os dois rabos grandes no alto da cabeça caindo além dos
  // ombros, o alto liso com risca no meio e duas mechas finas e compridas na frente das orelhas.
  chiquinhaAlta: (k) => {
    const b = ESTILOS.chiquinha!(k);
    return {
      ...b,
      camadas: espelhar([0.275, 0.29], {
        n: 1,
        raiz: [0.12, 0.16],
        raizRente: true,
        abraco: [1.0, 1.04],
        livre: [0.56, 0.62],
        largura: [0.05, 0.055],
        pontas: 1,
        gravidade: 0.5,
        afina: 0.4,
        abre: 0.2,
        enrola: -2.5,
        enrolaDesde: 0.75,
        folga: 0.024,
        zAlvo: "frente",
        testa: 0.17,
        frente: true,
      }),
      extras: (x, k2, modo) => chiquinhas(x, k2, modo, { longa: true }),
    };
  },
  // Longo repicado ondulado (ref. 100): o longo com ondas suaves, pontas finas e camadas
  // soltas e desfiadas emoldurando o rosto (as que viram para fora na altura do queixo).
  longoRepicado: (k) => {
    const b = ESTILOS.longo!(k);
    return {
      ...b,
      camadas: [
        ...b.camadas.map((c): Camada => ({ ...c, onda: 0.02, afina: 0.48, jitter: 0.3 })),
        ...espelhar([0.27, 0.315], {
          n: 3,
          raiz: [0.08, 0.2],
          raizRente: true,
          abraco: [1.0, 1.04],
          livre: [0.3, 0.42],
          largura: [0.035, 0.045],
          pontas: 2,
          gravidade: 0.45,
          afina: 0.4,
          abre: 0.35,
          enrola: 1.6,
          enrolaDesde: 0.55,
          folga: 0.04,
          zAlvo: "frente",
          testa: 0.17,
          onda: 0.02,
          jitter: 0.4,
          frente: true,
        }),
      ],
    };
  },
  // Rabo alto com franja (ref. 101): o cabelo puxado para um rabo fofo no alto (sobe e cai
  // nas costas), franja cortina aberta no meio e mechas onduladas compridas dos lados do rosto.
  raboFranja: (k) => ({
    inflar: 1.05,
    franja: true,
    fluxo: { tipo: "polo", dir: [0, 0.95, -0.3] },
    casca: {
      espessura: 0.02,
      volume: 0.03,
      volumeLado: 0.012,
      linha: linha({ frente: 0.15, lado: -0.03, tras: -0.17 }, k),
    },
    camadas: [
      // franja cortina: tufos que caem na testa e abrem do meio para os lados (o do meio
      // mais curto), até a sobrancelha
      {
        n: 7,
        u: [0.385, 0.615],
        raiz: [0.2, 0.35],
        abraco: [0.95, 1.02],
        livre: [0.1, 0.13],
        largura: [0.06, 0.07],
        pontas: 2,
        levanta: 0.06,
        gravidade: 0.45,
        enrola: 1.2,
        afina: 0.3,
        abre: 0.5,
        folga: 0.028,
        testa: 0.12,
        franja: true,
        jitter: 0.25,
        frente: true,
        frenteN: 2,
        antiPente: true,
      },
      // mechas compridas e onduladas dos lados do rosto, até o peito
      ...espelhar([0.33, 0.37], {
        n: 2,
        raiz: [0.3, 0.5],
        abraco: [1.0, 1.05],
        livre: [0.5, 0.58],
        largura: [0.05, 0.06],
        pontas: 2,
        gravidade: 0.5,
        afina: 0.45,
        abre: 0.25,
        folga: 0.03,
        zAlvo: "frente",
        testa: 0.17,
        onda: 0.022,
        frente: true,
      }),
    ],
    extras: (x, k2, modo) => {
      const coberta = k2.corte !== null;
      // sob chapéu o rabo sai de trás, abaixo do corte
      raboDoAlto(k2, x, modo, {
        dirRaiz: coberta ? new Vector3(0, -0.1, -1) : new Vector3(0, 0.95, -0.3),
        saida: coberta ? new Vector3(0, 0.2, -1) : new Vector3(0, 0.95, -0.4),
        comp: coberta ? 0.5 : 0.78,
        raioMax: 0.12,
        fitas: k2.alta ? 11 : 8,
        gravidade: coberta ? [0.3, 0.9] : [0.1, 0.9],
        lado: -1,
        abre: 0.3,
      });
    },
  }),
  // Coque alto com mechas soltas (ref. 102): o coque bagunçado no alto da cabeça e mechas
  // finas e compridas soltas dos dois lados do rosto.
  coqueSolto: (k) => ({
    inflar: 1.0,
    fluxo: { tipo: "polo", dir: [0, 1, -0.15] },
    casca: {
      espessura: 0.018,
      volume: 0.025,
      volumeLado: 0.008,
      linha: linha({ frente: 0.15, lado: -0.04, tras: -0.18 }, k),
    },
    camadas: [
      ...espelhar([0.35, 0.39], {
        n: 2,
        raiz: [0.25, 0.4],
        abraco: [1.0, 1.04],
        livre: [0.5, 0.62],
        largura: [0.03, 0.04],
        pontas: 2,
        gravidade: 0.55,
        afina: 0.35,
        abre: 0.3,
        folga: 0.03,
        zAlvo: "frente",
        testa: 0.17,
        jitter: 0.35,
        onda: 0.012,
        frente: true,
      }),
      // duas soltas atrás da orelha
      ...espelhar([0.2, 0.24], {
        n: 1,
        raiz: [0.35, 0.5],
        abraco: [1.0, 1.04],
        livre: [0.35, 0.45],
        largura: [0.03, 0.035],
        pontas: 2,
        gravidade: 0.55,
        afina: 0.35,
        folga: 0.02,
        zAlvo: "tras",
        onda: 0.015,
      }),
    ],
    extras: (x, k2, modo) => {
      if (k2.corte !== null) return;
      const e = k2.t / 0.46;
      coqueDeFitas(k2, x, new Vector3(0, k2.t / 2 + 0.08 * e, -0.04 * e), 0.11 * e, modo, 1);
    },
  }),
  // Longo com flor (ref. 103): longo liso, um dos lados ondulado, e a flor rosa presa no
  // lado da cabeça (fixa, faz parte do penteado).
  longoFlor: (k) => {
    const b = ESTILOS.longo!(k);
    return {
      ...b,
      camadas: b.camadas.map((c): Camada => {
        const meio = (c.u[0] + c.u[1]) / 2;
        // o lado −x (u 0,5..1) ondula; o resto fica liso
        const ondula = meio > 0.55 && meio < 0.95;
        return ondula ? { ...c, onda: 0.04, afina: 0.5 } : { ...c, afina: 0.5 };
      }),
      extras: (x, k2, modo) => {
        b.extras?.(x, k2, modo);
        const e = k2.t / 0.46;
        const d = new Vector3(1, 0.3, 0.2).normalize();
        const o = new Vector3(0, 0.08 * e, 0.03 * e);
        const centro = o.clone().addScaledVector(d, k2.cab.alcance(o, d, 0.1 * e));
        flor(k2, centro, d, 0.1 * e);
      },
    };
  },
  // Repicado com chiquinhas (ref. 104): corte médio repicado (pontas desfiadas, franja) com
  // dois tufinhos presos no alto, um de cada lado.
  repicadoChiquinhas: (k) => ({
    inflar: 1.05,
    franja: true,
    fluxo: { tipo: "risca", x: 0 },
    casca: {
      espessura: 0.024,
      volume: 0.03,
      volumeLado: 0.02,
      linha: linha({ frente: 0.15, lado: -0.03, tras: -0.17 }, k),
      sulco: 0.6,
    },
    camadas: [
      // as camadas compridas dos lados e de trás (até o ombro), desfiadas
      {
        n: 18,
        u: [0.6, 1.4],
        raiz: [0.12, 0.25],
        abraco: [0.98, 1.04],
        livre: [0.22, 0.32],
        largura: [0.065, 0.075],
        pontas: 3,
        gravidade: 0.45,
        afina: 0.3,
        abre: 0.3,
        folga: 0.02,
        zAlvo: "tras",
        jitter: 0.3,
        fimVar: 0.15,
        antiPente: true,
      },
      // lados da frente (na frente da orelha), até o queixo
      ...espelhar([0.27, 0.33], {
        n: 3,
        raiz: [0.1, 0.2],
        raizRente: true,
        abraco: [1.0, 1.04],
        livre: [0.2, 0.28],
        largura: [0.06, 0.07],
        pontas: 3,
        gravidade: 0.45,
        afina: 0.3,
        abre: 0.3,
        folga: 0.026,
        zAlvo: "frente",
        testa: 0.15,
        jitter: 0.3,
        fimVar: 0.15,
        frente: true,
      }),
      // franja desfiada
      {
        n: 7,
        u: [0.39, 0.61],
        raiz: [0.2, 0.35],
        abraco: [0.95, 1.02],
        livre: [0.1, 0.13],
        largura: [0.055, 0.065],
        pontas: 2,
        gravidade: 0.45,
        enrola: 1.2,
        afina: 0.3,
        abre: 0.45,
        folga: 0.028,
        testa: 0.12,
        franja: true,
        frente: true,
        frenteN: 2,
        jitter: 0.3,
        antiPente: true,
      },
    ],
    extras: (x, k2, modo) => {
      if (k2.corte !== null) return;
      for (const l of [-1, 1])
        raboDoAlto(k2, x, modo, {
          dirRaiz: new Vector3(0.17 * l, 0.22, -0.02),
          saida: new Vector3(0.45 * l, 1, -0.1),
          comp: 0.3,
          raioMax: 0.055,
          fitas: k2.alta ? 7 : 5,
          gravidade: [0.15, 0.75],
          lado: -1,
          abre: 0.4,
        });
    },
  }),
  // Longo com trancinhas (ref. 105): o longo liso com uma trancinha fina de cada lado, que
  // sai da têmpora, perto da risca, e desce emoldurando o rosto até o peito.
  longoTrancinhas: (k) => {
    const b = ESTILOS.longo!(k);
    return {
      ...b,
      extras: (x, k2, modo) => {
        b.extras?.(x, k2, modo);
        const e = k2.t / 0.46;
        const c = k2.ctx;
        const R0 = 0.03 * e;
        const raio = raioQueAfina(R0, 0.75);
        const xAlvo = Math.max(0.19, c.troncoW / 2 - 0.09);
        const zPeito = c.troncoD / 2 + (c.acessorioFrente ? 0.075 : 0.055) + 0.03;
        for (const l of [-1, 1]) {
          const d0 = new Vector3(0.1 * l, 0.24, 0.16).normalize();
          const p0 = d0.multiplyScalar(k2.cab.alcance(new Vector3(), d0, 0.03));
          // sob chapéu nasce abaixo do corte, na têmpora
          if (k2.corte !== null) p0.set(l * (k2.t / 2 + 0.03), k2.corte - 0.04 * e, 0.12 * e);
          const ctrl = [
            p0,
            new Vector3(l * (k2.t / 2 + 0.035), 0.05 * e, 0.17 * e),
            new Vector3(l * (k2.t / 2 + 0.04), -0.15 * e, 0.2 * e),
            new Vector3(l * xAlvo, c.topoTroncoY - 0.1, zPeito),
            new Vector3(l * xAlvo, c.topoTroncoY - 0.42 * c.troncoH, zPeito),
          ];
          const guia = guiaDeTranca(k2, ctrl, raio, { lado: 1, l, xAlvo, folga: 0.03 });
          tranca(k2, x, guia, { raio, modo, tufo: 0.06 * e, leque: false, nGomos: 30 });
        }
      },
    };
  },
  // Tranças baixas com franja (ref. 106): risca de lado, franja varrida para o lado e duas
  // tranças que nascem embaixo das orelhas e caem na frente dos ombros.
  trancasBaixas: (k) => ({
    inflar: 1.0,
    franja: true,
    fluxo: { tipo: "risca", x: 0.04 },
    casca: {
      espessura: 0.016,
      volume: 0.022,
      volumeLado: 0.006,
      linha: linha({ frente: 0.15, lado: -0.14, tras: -0.21 }, k),
      sulco: 0.6,
    },
    camadas: [],
    extras: (x, k2, modo) => {
      trancasSoltas(x, k2, modo, {
        lados: [-1, 1],
        R0: 0.075,
        yRaiz: -0.12,
        ate: 0.6,
        nGomos: 14,
        xRisca: 0.04,
      });
      franjaDeLado(x, k2, modo, 0.04);
    },
  }),
  trancasBoxer: (k) => ({
    inflar: 1.0,
    fluxo: { tipo: "risca", x: 0 },
    casca: {
      espessura: 0.012,
      volume: 0.012,
      volumeLado: 0.004,
      linha: linha({ frente: 0.15, lado: -0.08, tras: -0.2 }, k),
      sulco: 0.8,
    },
    camadas: [],
    extras: (x, k2, modo) => {
      const e = k2.t / 0.46;
      const c = k2.ctx;
      const R0 = 0.08 * e;
      const raio = (s: number) => R0 * lerp(0.75, 1, sstep(0, 0.12, s)) * lerp(1, 0.6, s);
      const zCostas = -(c.troncoD / 2 + 0.06 + R0 * 0.6);
      const yFim = c.topoTroncoY - (c.pose === "sentado" ? 0.5 : 0.65) * c.troncoH;
      for (const l of [-1, 1]) {
        const naCabeca = [
          new Vector3(0.1 * l, 0.2, 0.2),
          new Vector3(0.15 * l, 0.26, 0.02),
          new Vector3(0.16 * l, 0.14, -0.2),
          new Vector3(0.14 * l, -0.1, -0.24),
        ].map((d) => {
          const dd = d.normalize();
          return dd.multiplyScalar(k2.cab.alcance(new Vector3(), dd, R0 * 0.7));
        });
        // sob chapéu: só o trecho que sai abaixo do corte
        const vis =
          k2.corte === null ? naCabeca : naCabeca.filter((p) => p.y < k2.corte! - 0.04 * e);
        const ctrl = [
          ...vis,
          new Vector3(0.15 * l * e, c.topoTroncoY - 0.06, zCostas),
          new Vector3(0.15 * l * e, yFim, zCostas),
        ];
        const nCab = vis.length;
        const guia = guiaDeTranca(k2, ctrl, raio, {
          lado: -1,
          l,
          rente: nCab >= 3 ? 0.45 : 0,
        });
        tranca(k2, x, guia, { raio, modo, tufo: 0.1 * e, nGomos: nCab >= 3 ? 30 : 20 });
      }
    },
  }),
  // Trança de lado (ref. 108): risca de lado, mechinhas soltas na frente e uma trança só,
  // que nasce embaixo, atrás da orelha, e cai por cima de um ombro.
  trancaLateral: (k) => ({
    inflar: 1.0,
    fluxo: { tipo: "risca", x: 0.06 },
    casca: {
      espessura: 0.016,
      volume: 0.022,
      volumeLado: 0.006,
      linha: linha({ frente: 0.15, lado: -0.14, tras: -0.21 }, k),
      sulco: 0.6,
    },
    camadas: espelhar([0.3, 0.32], {
      n: 1,
      raiz: [0.45, 0.6],
      raizRente: true,
      abraco: [1.0, 1.04],
      livre: [0.24, 0.3],
      largura: [0.05, 0.055],
      pontas: 2,
      gravidade: 0.5,
      afina: 0.35,
      abre: 0.3,
      enrola: -1.5,
      enrolaDesde: 0.6,
      folga: 0.026,
      zAlvo: "frente",
      testa: 0.17,
      frente: true,
    }),
    extras: (x, k2, modo) =>
      trancasSoltas(x, k2, modo, {
        lados: [-1],
        R0: 0.085,
        yRaiz: -0.1,
        ate: 0.75,
        nGomos: 14,
        xRisca: 0.06,
      }),
  }),
  // Trança espinha de peixe (ref. 109): o cabelo todo varrido para trás numa trança só, que
  // começa no alto da nuca, corre colada até embaixo e cai nas costas até o elástico.
  trancaEspinha: (k) => ({
    inflar: 1.0,
    fluxo: { tipo: "polo", dir: [0, 0.25, -1] },
    casca: {
      espessura: 0.016,
      volume: 0.02,
      volumeLado: 0.01,
      linha: linha({ frente: 0.15, lado: -0.04, tras: -0.2 }, k),
    },
    camadas: [],
    extras: (x, k2, modo) => {
      const e = k2.t / 0.46;
      const c = k2.ctx;
      const R0 = 0.085 * e;
      const raio = (s: number) => R0 * lerp(0.8, 1, sstep(0, 0.15, s)) * lerp(1, 0.6, s);
      const zCostas = -(c.troncoD / 2 + 0.06 + R0 * 0.6);
      const yFim = c.topoTroncoY - (c.pose === "sentado" ? 0.5 : 0.65) * c.troncoH;
      const naCabeca = [
        new Vector3(0, 0.2, -1),
        new Vector3(0, -0.05, -1),
        new Vector3(0, -0.3, -1),
      ]
        .map((d) => {
          const dd = d.normalize();
          return dd.multiplyScalar(k2.cab.alcance(new Vector3(), dd, R0 * 0.7));
        })
        .filter((p) => k2.corte === null || p.y < k2.corte - 0.04 * e);
      const ctrl = [
        ...naCabeca,
        new Vector3(0, c.topoTroncoY - 0.06, zCostas),
        new Vector3(0, yFim, zCostas),
      ];
      const guia = guiaDeTranca(k2, ctrl, raio, {
        lado: -1,
        l: 0,
        rente: naCabeca.length >= 3 ? 0.3 : 0,
      });
      // espinha de peixe: gomos pequenos e muitos
      tranca(k2, x, guia, { raio, modo, tufo: 0.11 * e, nGomos: 30 });
      // o cabelo varrido da testa e do alto até o começo da trança, e dos lados até o trecho
      // dela na nuca (a trança embutida vai "pegando" mecha enquanto desce)
      const alto = guia[0]!.clone();
      const nuca = (naCabeca[naCabeca.length - 1] ?? guia[0]!).clone();
      for (const l of [-1, 1]) {
        penteadoAte(k2, x, alto, {
          de: [
            new Vector3(0.06 * l, 0.25, 0.17),
            new Vector3(0.16 * l, 0.2, 0.15),
            new Vector3(0.2 * l, 0.25, 0.0),
          ],
          largura: 0.075 * e,
          folga: [0.01, 0.008],
          modo,
          frente: 2,
        });
        penteadoAte(k2, x, nuca, {
          de: [
            new Vector3(0.23 * l, 0.1, 0.12),
            new Vector3(0.24 * l, -0.02, 0.06),
            new Vector3(0.24 * l, -0.1, -0.04),
            new Vector3(0.2 * l, -0.16, -0.16),
          ],
          largura: 0.07 * e,
          folga: [0.01, 0.008],
          modo,
        });
      }
    },
  }),
  // os masculinos novos (16/10/2026) moram em `cabelo-estilos-masculinos.ts`
  ...ESTILOS_MASCULINOS,
};

/**
 * Longo: o bojo dos lados na altura da orelha (a ref. 58 abre ~1,5× o rosto
 * ali) — 2 fitas largas por lado por cima da cortina, que saem da risca,
 * passam por fora da orelha e caem atrás do ombro.
 */
function lado(x: Malha, k: Obra, esc: number) {
  const tom = tomDaMecha(1);
  for (const l of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const z0 = lerp(0.07, -0.02, i) * esc;
      // sob chapéu nasce no lado da cabeça, logo abaixo do corte (o alto fica dentro do chapéu)
      const de =
        k.corte === null
          ? new Vector3(0.02 * l, 0.25, z0)
          : new Vector3(l * k.t * 0.5, k.corte - 0.035 * esc, z0);
      const ate = new Vector3(l, -0.25, z0 - 0.04);
      const g = guiaSobreACabeca(
        k,
        de,
        ate,
        (s) => 0.02 + 0.055 * Math.sin(Math.min(1, s * 1.3) * Math.PI * 0.5),
        7,
      );
      if (k.aba)
        for (const q of g) {
          const yAba = k.aba(q.x, q.z);
          if (yAba !== null && q.y > yAba - 0.014) q.y = yAba - 0.014;
        }
      // continua caindo, afastada, até o ombro (o envelope do corpo a leva para trás dele)
      const p = g[g.length - 1]!.clone();
      const d = p
        .clone()
        .sub(g[g.length - 2]!)
        .normalize();
      const ant = p.clone();
      for (let j = 0; j < 12; j++) {
        d.y -= 0.5;
        d.x += 0.04 * l;
        d.normalize();
        ant.copy(p);
        p.addScaledVector(d, 0.025);
        empurrarDaCabeca(k, p, 0.04);
        pousar(k, p, ant, -1, l);
        g.push(p.clone());
      }
      tufo(k, x, g, {
        largura: (0.075 + 0.01 * k.r()) * esc,
        espessura: 0.34,
        afina: 0.6,
        raiz: 0.6,
        pontas: 2,
        abre: 0.25,
        concha: 0.2,
        torce: 0,
        V0: V_INICIO + 0.02,
        u0: k.r() * 0.8,
        tom: (v) => tom(v),
        mascara: () => 0,
      });
    }
  }
}

/** Variações da maria-chiquinha. */
type OpcChiquinha = {
  /** Chiquinhas longas (ref. 99): rabos mais grossos que passam dos ombros. */
  longa?: boolean;
};

/**
 * A maria-chiquinha alta (ref. 60): o alto vira duas "bolas" de cabelo
 * penteado — fitas largas da risca até cada elástico, e da nuca subindo até
 * ele —, e os rabos sobem em arco, enchem logo depois do elástico e caem em
 * S, abertos em 3–5 pontas, até a altura do queixo (em pé, sem passar dos
 * ombros: a silhueta fica em ~2,2C). Sentada, o envelope do corpo leva o rabo
 * para trás do ombro que sobe. Sob chapéu, o elástico desce para baixo do
 * corte e o rabo sai de lado, por baixo da aba.
 */
function chiquinhas(x: Malha, k: Obra, modo: ModoMechas, opc: OpcChiquinha = {}) {
  const esc = k.t / 0.46;
  const longa = !!opc.longa;
  const tom = tomDaMecha(1);
  const masc = mascaraDaFita(modo, false, false);
  const coberta = k.corte !== null;
  for (const l of [-1, 1]) {
    // —— o elástico ——
    let base: Vector3;
    let saida: Vector3;
    if (!coberta) {
      // o polo (x ±0,17, z −0,04) um pouco acima do da spec (y +0,20): na ref. 60 os rabos
      // nascem no alto da cabeça e sobem bem acima dela antes de cair
      const dirPolo = new Vector3(0.17 * l, 0.2, -0.04).normalize();
      base = dirPolo.clone().multiplyScalar(k.cab.alcance(new Vector3(), dirPolo, 0.03));
      // longa: sai mais de lado (o rabo pesado mal sobe acima da cabeça antes de cair)
      saida = longa ? new Vector3(l * 0.62, 0.72, -0.2) : new Vector3(l * 0.3, 1, -0.18);
    } else {
      const y = k.corte! - 0.04 * esc;
      const o = new Vector3(0, y, -0.04 * esc);
      const d = new Vector3(l, 0, 0);
      base = o.clone().addScaledVector(d, k.cab.alcance(o, d, 0.03));
      saida = new Vector3(l, 0.35, -0.25);
    }
    // —— o rabo: guia em arco, cai em S ——
    const guia: Vector3[] = [base.clone()];
    const p = base.clone();
    const dir = saida.clone().normalize();
    const ant = new Vector3();
    // sobe ~15 cm acima da cabeça, abre até ~0,41 do meio e cai quase a prumo até o maxilar:
    // a curva aperta aos poucos (no começo quase só sobe; depois a gravidade vence)
    // longa (ref. 99): o rabo passa dos ombros e cai a prumo pelo lado do corpo
    const comp = (coberta ? 0.56 : 0.8) * esc * (longa ? 1.65 : 1);
    const n = Math.ceil(comp / 0.025);
    for (let i = 0; i < n; i++) {
      const s = i / n;
      dir.y -= lerp(coberta ? 0.25 : 0.08, coberta ? 0.9 : 0.95, longa ? Math.min(1, s * 1.9) : s);
      // a parte de baixo volta um pouco para dentro (o S da ref. 60)
      if (s > 0.55 && !longa) dir.x -= 0.03 * l;
      dir.normalize();
      ant.copy(p);
      p.addScaledVector(dir, comp / n);
      empurrarDaCabeca(k, p, lerp(0.03, 0.08, Math.min(1, s * 4)) * esc);
      if (k.aba) {
        const yAba = k.aba(p.x, p.z);
        if (yAba !== null && p.y > yAba - 0.09 * esc) p.y = yAba - 0.09 * esc;
      }
      pousar(k, p, ant, -1, l);
      // o rabo é um feixe redondo de ~9,5 cm de raio: sentada, o encosto fica a um raio dele
      limitarEncosto(k, p, (longa ? 0.115 : 0.1) * esc);
      guia.push(p.clone());
    }
    feixeGota(k, x, {
      guia,
      raioMax: (longa ? 0.11 : 0.095) * esc,
      fitas: longa ? (k.alta ? 11 : 8) : k.alta ? 9 : 7,
      abre: longa ? 0.22 : 0.3,
      tom,
      mascara: masc,
      tomElastico: 0.35,
      saida,
      base: 0.55,
    });
    // —— o alto penteado até o elástico: fitas largas da risca (a "bola" da ref. 60) ——
    if (!coberta) {
      const alvo = base.clone().addScaledVector(saida.clone().normalize(), -0.01);
      for (let i = 0; i < 5; i++) {
        const zr = lerp(0.17, -0.08, i / 4) * esc;
        const de = new Vector3(0.025 * l, 0.25, zr);
        const g = guiaSobreACabeca(
          k,
          de,
          alvo,
          (s) => 0.012 + 0.036 * Math.sin(s * Math.PI) * (1 - 0.5 * s),
          8,
        );
        tufo(k, x, g, {
          largura: (0.08 + 0.012 * k.r()) * esc,
          espessura: 0.3,
          afina: 0.55,
          raiz: 0.75,
          pontas: 1,
          abre: 0,
          concha: 0.25,
          torce: 0,
          V0: V_INICIO + 0.01,
          u0: k.r() * 0.8,
          tom: (v) => lerp(0.92, 1.05, v) * (1 - 0.18 * sstep(0.85, 1, v)),
          mascara: () => 0,
          separa: 0,
        });
      }
    }
    // —— a nuca: fitas curtas subindo até o elástico ——
    const alvoNuca = base.clone().addScaledVector(saida.clone().normalize(), -0.015);
    // (nascem um pouco acima da linha da nuca e bem rentes: a borda de baixo não vira franja)
    for (let i = 0; i < 4; i++) {
      const xr = lerp(0.03, 0.19, i / 3) * l * esc;
      const de = new Vector3(xr, -0.16, -0.21);
      const g = guiaSobreACabeca(k, de, alvoNuca, (s) => 0.006 + 0.01 * Math.sin(s * Math.PI), 8);
      tufo(k, x, g, {
        largura: (0.05 + 0.008 * k.r()) * esc,
        espessura: 0.22,
        afina: 0.5,
        raiz: 0.8,
        pontas: 1,
        abre: 0,
        concha: 0.25,
        torce: 0,
        V0: V_INICIO + 0.01,
        u0: k.r() * 0.8,
        tom: (v) => lerp(0.85, 1.02, v),
        mascara: () => 0,
        separa: 0,
      });
    }
  }
}

/**
 * Franja varrida para o lado (ref. 106): fitas que saem da risca (em `xRisca`), deitam pelo
 * alto e caem na testa em diagonal até a sobrancelha, cada uma um pouco mais para o lado
 * oposto da risca (a mais comprida cobre o canto da testa).
 */
function franjaDeLado(x: Malha, k: Obra, modo: ModoMechas, xRisca: number) {
  if (k.corte !== null) return;
  const e = k.t / 0.46;
  const tom = tomDaMecha(1);
  const n = k.alta ? 7 : 5;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const de = new Vector3(xRisca + lerp(0.01, -0.02, f), 0.25, lerp(0.16, 0.02, f) * e);
    const ate = new Vector3(lerp(0.08, -0.19, f) * e, lerp(0.12, 0.07, f) * e, 0.21 * e);
    const g = guiaSobreACabeca(k, de, ate, (s) => 0.014 + 0.012 * Math.sin(s * Math.PI), 9);
    const masc = mascaraDaFita(modo, f < 0.4, i % 3 === 0);
    tufo(k, x, g, {
      largura: (0.065 + 0.01 * k.r()) * e,
      espessura: 0.3,
      afina: 0.55,
      raiz: 0.7,
      pontas: 2,
      abre: 0.2,
      concha: 0.22,
      torce: 0,
      V0: V_INICIO + 0.01,
      u0: k.r() * 0.8,
      tom: (v) => tom(0.3 + 0.7 * v),
      mascara: (v) => masc(v),
      separa: 0.3,
    });
  }
}

/** Qual textura o penteado usa (sem montar). */
export function texturaDoEstilo(estilo: EstiloCabelo): { cachos: boolean; anel: boolean } {
  const fab = ESTILOS[estilo];
  if (!fab) return { cachos: false, anel: false };
  const p = fab({ t: 0.46, d: 0.4232 } as Obra);
  return { cachos: p.textura === "cachos", anel: !!p.anel };
}

/*
 * Medidas da silhueta de cada penteado (corpo clássico, sem chapéu, alta),
 * tiradas de `montarCabelo` na bancada (scratchpad/fase0/cabelo/correcao/tools/
 * medidas-topo.mjs, 10/10/2026) e gravadas aqui: os enfeites que não cobrem o
 * alto sobem/abrem por elas. Chiquinha: o topo é o do alto entre os rabos.
 * Estilos do motor antigo: ausentes = nenhum ajuste (como hoje).
 */
/** Topo do cabelo acima do ALTO da cabeça (y = t/2), em m. */
export const ALTURA_TOPO: Partial<Record<EstiloCabelo, number>> = {
  baguncado: 0.191,
  anime: 0.132,
  longo: 0.081,
  chiquinha: 0.104,
  ...ALTURA_TOPO_MASCULINOS,
};
/**
 * Largura total do alto do cabelo (m), vista de frente, na faixa y = t/2 ± 0,03.
 * Chiquinha: medida só da cabeça (os rabos ficam de fora, a coroa vai entre eles).
 */
export const LARGURA_TOPO: Partial<Record<EstiloCabelo, number>> = {
  baguncado: 0.725,
  anime: 0.662,
  longo: 0.653,
  chiquinha: 0.593,
  ...LARGURA_TOPO_MASCULINOS,
};
/** Largura total na altura das orelhas (m). Chiquinha: só a cabeça (os rabos passam por fora do fone). */
export const LARGURA_LATERAL: Partial<Record<EstiloCabelo, number>> = {
  baguncado: 0.564,
  anime: 0.614,
  longo: 0.693,
  chiquinha: 0.557,
  ...LARGURA_LATERAL_MASCULINOS,
};
