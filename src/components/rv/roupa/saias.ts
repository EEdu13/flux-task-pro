import type { Medidas } from "@/components/rv/medidas";
import { bordaCurva, type Face } from "./caixa-roupa";
import type { CtxFace, ParteMolde } from "./molde";
import { LADOS, alturaDoCalcado, em, mat, type BlocoPele, type Esqueleto } from "./peca";
import { alfa, clarear, costura, escurecer, oclusao, pxs } from "./pincel";

/**
 * SAIAS e a saia dos VESTIDOS: um bloco afunilado pendurado na cintura
 * (como a saia pregueada), mais as pernas de pele por baixo. Fica aqui
 * porque serve às duas listas: parte de baixo (saia rodada, lápis, jeans) e
 * parte de cima de corpo inteiro (vestido, vestido longo).
 *
 * Em pé, o bloco desce reto do pivô (quadril + `cintura`). Sentado, gira
 * −1,38 no pivô e deita sobre as coxas (a perna sai do quadril para a
 * frente): a roda fica contida e o comprimento para antes do calçado — a
 * saia longa não engole o pé nem atravessa o assento.
 */

export type OpSaia = {
  /** Comprimento EM PÉ, do pivô até a barra (m). */
  comp: number;
  /** Largura e fundura na barra, em frações do tronco (o mínimo que cobre as pernas é garantido). */
  larg: number;
  fundo: number;
  /** Quanto o topo é mais estreito que a barra: 0 = reta, 0,22 = pregueada, 0,3 = rodada. */
  afunilar: number;
  /** Altura do pivô acima do quadril (0,1 = cintura). */
  cintura?: number;
};

/** O que a saia vira de verdade na pose (medidas já corrigidas). */
export type SaiaResolvida = {
  comp: number;
  larg: number;
  fundo: number;
  afunilar: number;
  cintura: number;
};

/**
 * Corrige a saia para a pose e o corpo: as pernas (2·pernaW + 1 cm) têm de
 * caber DENTRO do bloco onde elas nascem — em pé, na altura do quadril;
 * sentada, logo à frente do tronco. Sem isso o canto da coxa furava a
 * lateral da saia (a pregueada antiga mostra a pele ali no corpo forte).
 */
export function resolverSaia(m: Medidas, e: Esqueleto, sapato: string, o: OpSaia): SaiaResolvida {
  const cintura = o.cintura ?? 0.1;
  let { comp, larg, fundo, afunilar } = o;
  if (e.sentado) {
    comp = Math.min(comp, m.pernaH - alturaDoCalcado(sapato, m) - 0.02);
    afunilar = Math.min(afunilar, 0.25);
    larg = Math.min(larg, 1.15);
    fundo = Math.min(fundo, 1.35);
  }
  comp = Math.max(comp, cintura + 0.08);
  // distância do topo da saia até onde as pernas começam a sair dela
  const d0 = e.sentado ? m.troncoD / 2 : cintura;
  const fator = 1 - afunilar * (1 - Math.min(1, d0 / comp));
  const largMin = (2 * m.pernaW + 0.02) / (m.troncoW * fator);
  const fundoMin = (m.pernaW + 0.035) / (m.troncoD * fator);
  return {
    comp,
    larg: Math.max(larg, largMin),
    fundo: Math.max(fundo, fundoMin),
    afunilar,
    cintura,
  };
}

/**
 * Na face da saia, o y (m, a partir do alto da face) onde ela sai de baixo
 * do tronco: o cós ou o cinto pintado ali aparece na cintura de verdade.
 * Frente/costas medem pela fundura; laterais pela largura. Sentada, a saia
 * deita para a frente e a parte rente ao tronco some dentro dele.
 */
export function yQueAparece(m: Medidas, e: Esqueleto, s: SaiaResolvida, face: Face): number {
  const borda = bordaCurva(Math.min(0.05, (m.troncoD * s.fundo) / 2));
  let d = 0;
  if (e.sentado) d = m.troncoD / 2;
  else if (s.afunilar > 0) {
    const k = 1 / (face === "px" || face === "nx" ? s.larg : s.fundo);
    d = Math.max(0, s.comp * (1 - (1 - k) / s.afunilar));
  }
  return Math.max(0, d - 0.05 + borda);
}

/** O bloco da saia (nome "saia"), já na pose. */
export function parteSaia(m: Medidas, e: Esqueleto, s: SaiaResolvida, nome = "saia"): ParteMolde {
  const pivo = mat([0, e.quadrilY + s.cintura, 0], e.sentado ? [-1.38, 0, 0] : [0, 0, 0]);
  return {
    nome,
    tam: [m.troncoW * s.larg, s.comp, m.troncoD * s.fundo],
    raio: 0.05,
    afunilar: s.afunilar || undefined,
    matriz: em(pivo, mat([0, -s.comp / 2, 0])),
  };
}

/** As pernas inteiras de pele (do quadril ao calçado), por baixo da saia. */
export function pernasDePele(m: Medidas, e: Esqueleto, sapato: string): BlocoPele[] {
  const comp = m.pernaH - alturaDoCalcado(sapato, m);
  return LADOS.map((l) => ({
    tam: [m.pernaW - 0.02, comp, m.pernaW] as [number, number, number],
    raio: 0.05,
    matriz: em(e.perna(l), mat([0, -comp / 2, 0])),
  }));
}

/**
 * Pele das pernas abaixo de `alto` (shortinho, forro do vestido): entra
 * 1 cm na perna de pano, mais fina que ela (sem z-fighting).
 */
export function canelasDePele(m: Medidas, e: Esqueleto, sapato: string, alto: number): BlocoPele[] {
  const comp = m.pernaH - alturaDoCalcado(sapato, m);
  return LADOS.map((l) => ({
    tam: [m.pernaW - 0.02, comp - alto + 0.01, m.pernaW] as [number, number, number],
    raio: 0.05,
    matriz: em(e.perna(l), mat([0, -alto - (comp - alto) / 2 + 0.005, 0])),
  }));
}

/* ———————————————————— pincéis de saia ———————————————————— */

/** Início de um padrão de período `P` contínuo na volta do bloco (pela `faixa`). */
const inicio = (f: CtxFace, P: number) => -(f.faixa % P) - 2 * P;

/**
 * Godê / pregas macias: faixas verticais de luz e sombra, contínuas nas
 * quinas. `passo` 0,045 = pregueada; 0,08 = rodada (ondas largas).
 */
export function pregas(f: CtxFace, passo: number, forca = 1, de = 0) {
  const { g, w, h } = f;
  for (let x = inicio(f, passo); x < w + passo; x += passo) {
    const gr = g.createLinearGradient(x, 0, x + passo, 0);
    gr.addColorStop(0, `rgba(0,0,0,${0.28 * forca})`);
    gr.addColorStop(0.3, "rgba(0,0,0,0)");
    gr.addColorStop(0.75, `rgba(255,255,255,${0.11 * forca})`);
    gr.addColorStop(1, `rgba(0,0,0,${0.1 * forca})`);
    g.fillStyle = gr;
    g.fillRect(x, de, passo, h - de + 0.1);
  }
}

/** Bolinhas (poá) em quincôncio, contínuas na volta do bloco. */
export function bolinhas(f: CtxFace, cor: string, passo = 0.07, raio = 0.014) {
  const { g, w, h } = f;
  g.save();
  for (let y = -passo, j = 0; y < h + passo; y += passo * 0.866, j++) {
    for (let x = inicio(f, passo) + (j % 2 ? passo / 2 : 0); x < w + passo; x += passo) {
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.beginPath();
      g.arc(x + raio * 0.15, y + raio * 0.2, raio, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = cor;
      g.beginPath();
      g.arc(x, y, raio, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

/**
 * Barra de babado: faixa franzida na 2ª cor a partir de `y`, com a borda de
 * cima em ondinhas (o franzido) e a de baixo em recortes — o que faz a saia
 * e o vestido lerem "fofos" de longe.
 */
export function barraDeBabado(f: CtxFace, cor: string, y: number) {
  const { g, w, h } = f;
  const P = 0.045;
  const x0 = inicio(f, P);
  g.save();
  // sombra do babado sobre o pano de cima
  oclusao(f, -0.1, y - 0.02, w + 0.2, 0.02, "baixo", 0.25);
  g.fillStyle = cor;
  g.beginPath();
  g.moveTo(-0.2, h + 0.2);
  g.lineTo(-0.2, y);
  for (let x = x0; x < w + P; x += P) g.quadraticCurveTo(x + P / 2, y - 0.012, x + P, y);
  g.lineTo(w + 0.2, h + 0.2);
  g.closePath();
  g.fill();
  // franzido: riscos de sombra descendo do alto do babado
  for (let x = x0; x < w + P; x += P / 2) {
    const gr = g.createLinearGradient(x, 0, x + P / 2, 0);
    gr.addColorStop(0, "rgba(0,0,0,0.22)");
    gr.addColorStop(0.5, "rgba(255,255,255,0.12)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x, y, P / 2, h - y + 0.1);
  }
  // o pesponto do franzido
  costura(
    f,
    [
      [-0.1, y + 0.012],
      [w + 0.1, y + 0.012],
    ],
    escurecer(cor, 0.3),
    { traco: 0.005 },
  );
  // recortes da barra: meia-lua escura no pé de cada onda
  g.fillStyle = alfa(escurecer(cor, 0.35), 0.55);
  for (let x = x0; x < w + P; x += P) {
    g.beginPath();
    g.arc(x + P / 2, h + 0.004, P * 0.32, Math.PI, 0);
    g.fill();
  }
  g.restore();
}

/** Renda: meias-luas vazadas ao longo de uma linha (decote da alcinha, barra). */
export function renda(f: CtxFace, cor: string, y: number, x0 = -0.1, x1 = f.w + 0.1, P = 0.026) {
  const { g } = f;
  g.save();
  g.fillStyle = cor;
  g.strokeStyle = alfa(escurecer(cor, 0.35), 0.6);
  g.lineWidth = Math.max(0.002, pxs(f, 1));
  for (let x = x0; x < x1; x += P) {
    g.beginPath();
    g.arc(x + P / 2, y, P / 2, 0, Math.PI);
    g.fill();
    g.stroke();
    // o furinho da renda
    g.fillStyle = alfa("#000000", 0.25);
    g.beginPath();
    g.arc(x + P / 2, y + P * 0.2, P * 0.12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = cor;
  }
  g.restore();
}

/** Cós liso de saia (faixa na cintura, no alto da face), com pesponto. */
export function cosDeSaia(f: CtxFace, cor: string, alto: number, linha: string) {
  const { g, w } = f;
  g.fillStyle = clarear(cor, 0.04);
  g.fillRect(-0.1, -0.1, w + 0.2, alto + 0.1);
  costura(
    f,
    [
      [-0.1, alto - 0.008],
      [w + 0.1, alto - 0.008],
    ],
    linha,
  );
  oclusao(f, -0.1, alto, w + 0.2, 0.022, "cima", 0.28);
}
