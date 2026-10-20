import { Euler, Matrix4, Quaternion, Vector3, type BufferGeometry } from "three";
import type { AvatarConfig } from "@/lib/avatar-3d";
import type { PoseAvatar, Qualidade } from "@/components/rv/contexto-avatar";
import type { Medidas } from "@/components/rv/medidas";
import type { Face } from "./caixa-roupa";
import type { Molde, ParteMolde, Pintor, RetanguloLivre } from "./molde";

/**
 * O que é uma PEÇA (parte de cima, de baixo ou calçado) e o "esqueleto" do
 * corpo onde ela se veste. O corpo é estático por pose (só a cabeça anima),
 * então cada bloco já nasce com a sua matriz no espaço do avatar e a peça
 * inteira vira UMA malha (ver `juntar.ts`): ~4 draw calls por corpo.
 */

/** Malha 3D extra (capuz, colarinho, gravata) que pinta num retângulo livre do atlas. */
export type Extra = { geo: BufferGeometry; matriz: Matrix4 };

/** Bloco de pele (antebraço, canela da bermuda): vai para o material de pele. */
export type BlocoPele = { tam: [number, number, number]; raio: number; matriz: Matrix4 };

export type Peca = {
  partes: ParteMolde[];
  livres: RetanguloLivre[];
  pintar: Pintor;
  extras?: (molde: Molde, pose: PoseAvatar) => Record<string, Extra>;
  /** Anéis de silhueta (punho, barra, cinto, colarinho): ≤ 6 por avatar somando as 3 peças. */
  aneis?: ParteMolde[];
  pele?: BlocoPele[];
  /** Padrão 0,85; couro 0,45; sapato social 0,35. */
  rugosidade?: number;
  /** A textura usa a cor da pele (decote, ombro da regata): entra na chave. */
  mostraPele?: boolean;
  /** EPI / uniforme: as faixas refletivas acendem um pouco (máscara em `mascara`). */
  emissivoFaixas?: boolean;
  mascara?: Pintor;
  /** Cor do material liso mostrado enquanto a textura espera na fila (sala). */
  corBase: string;
};

export type CriarPeca = (m: Medidas, c: AvatarConfig, q: Qualidade, pose: PoseAvatar) => Peca;

/* ———————————— matrizes ———————————— */

const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

/** Matriz de posição + giro (Euler XYZ, como o `rotation` do R3F) + escala. */
export function mat(
  pos: readonly [number, number, number],
  rot: readonly [number, number, number] = [0, 0, 0],
  escala: readonly [number, number, number] = [1, 1, 1],
): Matrix4 {
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  return new Matrix4().compose(_p.set(...pos), _q, _s.set(...escala));
}

/** pai × local: o bloco dentro do grupo (braço, perna). */
export const em = (pai: Matrix4, local: Matrix4) => pai.clone().multiply(local);

/* ———————————— esqueleto (as MESMAS fórmulas do Avatar3D) ———————————— */

export type Esqueleto = {
  sentado: boolean;
  quadrilY: number;
  ombroY: number;
  topo: number;
  /** Comprimento do braço inteiro (manga + antebraço + mão). */
  compBraco: number;
  /** Grupo do braço `l` (−1 direito, 1 esquerdo): pivô no ombro. */
  braco: (l: 1 | -1) => Matrix4;
  /** Grupo da perna `l`: pivô no quadril (sentado, gira −90° para a frente). */
  perna: (l: 1 | -1) => Matrix4;
};

export function esqueleto(m: Medidas, pose: PoseAvatar): Esqueleto {
  const sentado = pose === "sentado";
  const quadrilY = sentado ? 0.52 : m.pernaH;
  const ombroY = quadrilY + m.troncoH - 0.06;
  const topo = quadrilY + m.troncoH;
  return {
    sentado,
    quadrilY,
    ombroY,
    topo,
    compBraco: m.troncoH + 0.02,
    braco: (l) =>
      mat(
        [(m.troncoW / 2 + m.bracoW / 2 + 0.01) * l, ombroY, 0],
        sentado ? [-1.2, 0, 0] : [0, 0, 0.06 * l],
      ),
    perna: (l) =>
      mat([(m.pernaW / 2 + 0.005) * l, quadrilY, 0], sentado ? [-Math.PI / 2, 0, 0] : [0, 0, 0]),
  };
}

/**
 * Partes de cima cuja barra de ribana (anel) cobre a cintura por fora: com
 * elas a calça NÃO gera cós nem cinto. As quinas do cós (raio 0,03) e o cinto
 * (W + 0,018) saíam através da barra (W + 0,012, raio 0,066) — o "lacinho" de
 * jeans nas quinas e o cinto cortando a ribana. Entra na chave de baixo.
 * A blusa de babado também: o babado da cintura (peplum) fica por cima do cós.
 */
export const COBRE_O_COS: ReadonlySet<string> = new Set([
  "moletom",
  "babado",
  // barra de ribana / cinto por fora da cintura (16/10/2026)
  "cortaVento",
  "bomberCetim",
  "jaquetaCouro",
]);

/**
 * Altura do alto da coxa sentado (a perna gira −90° no quadril): o que desce
 * abaixo disso na frente do quadril atravessa a coxa.
 */
export const topoDaCoxaSentado = (m: Medidas, e: Esqueleto) => e.quadrilY + (m.pernaW + 0.02) / 2;

/**
 * Altura do calçado: a perna da calça termina em cima dele. A bota de cano
 * alto vai até perto do joelho, então depende da perna (`m`): no baixinho
 * ela não pode engolir a calça inteira.
 */
export function alturaDoCalcado(sapato: string, m?: Medidas): number {
  switch (sapato) {
    case "bota":
      return 0.22;
    case "botaCano":
      return Math.min(0.42, (m?.pernaH ?? 0.72) * 0.58);
    case "sapatilha":
      return 0.11;
    case "salto":
      return 0.16;
    // —— calçados novos (16/10/2026): os de cano dependem da perna, como a botaCano ——
    case "galocha":
      return Math.min(0.38, (m?.pernaH ?? 0.72) * 0.52);
    case "coturno":
      return Math.min(0.3, (m?.pernaH ?? 0.72) * 0.42);
    case "botaCowboy":
      return Math.min(0.34, (m?.pernaH ?? 0.72) * 0.46);
    case "botinaEpi":
    case "plataforma":
      return 0.2;
    case "tenisCano":
      return 0.19;
    case "patins":
      return 0.25;
    case "chineloMeia":
      return 0.17;
    case "tenisChunky":
      return 0.16;
    case "chuteira":
      return 0.14;
    case "babuche":
    case "pantufa":
      return 0.12;
    case "mocassim":
      return 0.11;
    default:
      return 0.13;
  }
}

export const LADOS = [-1, 1] as const;
export const nomeLado = (base: string, l: 1 | -1) => `${base}${l < 0 ? "D" : "E"}`;

/** Lado interno (que encosta no tronco/na outra perna) de um membro. */
export const faceInterna = (lado: 1 | -1): Face => (lado > 0 ? "nx" : "px");
export const faceExterna = (lado: 1 | -1): Face => (lado > 0 ? "px" : "nx");
export const ehLateral = (f: Face) => f === "px" || f === "nx";

/* ———————————— blocos do corpo ———————————— */

export function parteTronco(m: Medidas, e: Esqueleto): ParteMolde {
  return {
    nome: "tronco",
    tam: [m.troncoW, m.troncoH, m.troncoD],
    raio: 0.06,
    matriz: mat([0, e.quadrilY + m.troncoH / 2, 0]),
    semFaces: ["ny"],
  };
}

export type Manga = "nenhuma" | "curta" | "cotovelo" | "longa";

export function comprimentoDaManga(m: Medidas, manga: Manga): number {
  if (manga === "nenhuma") return 0;
  if (manga === "curta") return 0.2;
  if (manga === "cotovelo") return 0.26;
  return m.troncoH + 0.02 - 0.13;
}

/**
 * As duas mangas + os antebraços de pele. `larga`: afunila 8% no punho
 * (moletom, uniforme), e o punho de ribana entra como anel.
 */
export function mangasEBracos(
  m: Medidas,
  e: Esqueleto,
  manga: Manga,
  o: { larga?: boolean } = {},
): { partes: ParteMolde[]; pele: BlocoPele[]; comp: number } {
  const comp = comprimentoDaManga(m, manga);
  const partes: ParteMolde[] = [];
  const pele: BlocoPele[] = [];
  for (const l of LADOS) {
    const g = e.braco(l);
    if (comp > 0) {
      const w = m.bracoW + 0.01;
      const d = m.bracoW + 0.025;
      partes.push({
        nome: nomeLado("manga", l),
        // Larga: o punho fica 8% mais estreito que o ombro (o topo alarga 8,7%).
        tam: o.larga ? [w * 0.95, comp, d * 0.95] : [w, comp, d],
        raio: 0.05,
        afunilar: o.larga ? -0.087 : undefined,
        lado: l,
        matriz: em(g, mat([0, -comp / 2 + 0.06, 0])),
      });
    }
    const resto = m.troncoH + 0.02 - comp;
    // O antebraço entra 1 cm na manga (sem fresta), mais fino que ela (sem z-fighting).
    pele.push({
      tam: [m.bracoW - 0.01, resto + (comp > 0 ? 0.01 : 0), m.bracoW + 0.01],
      raio: 0.05,
      matriz: em(g, mat([0, -comp - resto / 2 + 0.06 + (comp > 0 ? 0.005 : 0), 0])),
    });
  }
  return { partes, pele, comp };
}

/** Anéis de punho (ribana +5 mm) no fim da manga. */
export function aneisDePunho(m: Medidas, e: Esqueleto, comp: number, larga: boolean): ParteMolde[] {
  const w = (m.bracoW + 0.01) * (larga ? 0.95 : 1) + 0.012;
  const d = (m.bracoW + 0.025) * (larga ? 0.95 : 1) + 0.012;
  const alto = 0.065;
  return LADOS.map((l) => ({
    nome: nomeLado("punho", l),
    tam: [w, alto, d] as [number, number, number],
    raio: 0.05,
    lado: l,
    ocultas: ["py", "ny"] as Face[],
    matriz: em(e.braco(l), mat([0, -comp + 0.06 + alto / 2 - 0.006, 0])),
  }));
}

/**
 * Pernas da calça (do quadril até `alto`), já com o comprimento que sobra
 * acima do calçado. A base fica dentro do calçado; o TOPO fica pintado de
 * pano, porque sentado ele vira para trás e aparece embaixo do tronco.
 */
export function pernasDaCalca(
  m: Medidas,
  e: Esqueleto,
  alto: number,
  o: { baseVisivel?: boolean } = {},
): ParteMolde[] {
  return LADOS.map((l) => ({
    nome: nomeLado("perna", l),
    tam: [m.pernaW, alto, m.pernaW + 0.02] as [number, number, number],
    raio: 0.05,
    lado: l,
    semFaces: (o.baseVisivel ? [] : ["ny"]) as Face[],
    ocultas: (o.baseVisivel ? ["ny"] : []) as Face[],
    matriz: em(e.perna(l), mat([0, -alto / 2, 0])),
  }));
}

/** O cós por cima do quadril. */
export function parteCos(m: Medidas, e: Esqueleto): ParteMolde {
  return {
    nome: "cos",
    tam: [m.troncoW + 0.005, 0.08, m.troncoD + 0.005],
    raio: 0.03,
    matriz: mat([0, e.quadrilY + 0.04, 0]),
    semFaces: ["py", "ny"],
  };
}

/** Anel do cinto sobre o cós (social, cargo). */
export function anelCinto(m: Medidas, e: Esqueleto): ParteMolde {
  return {
    nome: "cinto",
    tam: [m.troncoW + 0.018, 0.042, m.troncoD + 0.018],
    raio: 0.035,
    matriz: mat([0, e.quadrilY + 0.05, 0]),
    ocultas: ["py", "ny"],
  };
}
