import type { EXTRAS_SAPATO } from "@/lib/avatar-catalogo/baixo";
import type { Medidas } from "@/components/rv/medidas";
import type { Face } from "./caixa-roupa";
import type { CtxFace, ParteMolde, Pintor } from "./molde";
import {
  LADOS,
  alturaDoCalcado,
  em,
  esqueleto,
  faceExterna,
  faceInterna,
  mat,
  nomeLado,
  type BlocoPele,
  type CriarPeca,
} from "./peca";
import {
  alfa,
  base,
  canelado,
  clarear,
  contrasta,
  costura,
  curvaPts,
  dobra,
  escurecer,
  escurecerTudo,
  ilhos,
  luminancia,
  oclusao,
  pano,
  piso,
  poligono,
  pxs,
  volume,
  ziper,
} from "./pincel";
import {
  blocoDoPe,
  brilho,
  cadarcos,
  contraste,
  detalhe,
  larguras,
  pegada,
  peleDoPe,
} from "./pecas-pes";

/**
 * CALÇADOS NOVOS (16/10/2026: "crie pelo menos mais 10 de cada, bem
 * criativo e dinâmico, baseado em Roblox"): galocha e botina do agro,
 * coturno, tênis de cano alto e chunky, babuche com pins, chuteira com
 * travas, patins de 4 rodas, pantufa de bichinho, sandália plataforma,
 * mocassim, bota country de bico fino e chinelo com meia.
 *
 * Mesmas regras de `pecas-pes.ts`: tudo dentro do grupo da perna (em pé e
 * sentado é o mesmo corpo rígido — sentado, a sola fica de frente para a
 * câmera e é pintada como sola de verdade), larguras a partir de
 * `m.pernaW` (serve a qualquer corpo) e o alto do calçado vem de
 * `alturaDoCalcado` (a calça termina ali, 8 mm dentro dele).
 *
 * `pecas-pes.ts` importa este arquivo (e este importa os pincéis de lá): o
 * ciclo é seguro porque nada daqui usa o que vem de lá fora das funções.
 */

export type SapatoExtra = (typeof EXTRAS_SAPATO)[number]["v"];

/** Nas laterais do pé: x da FRENTE (bico) da face (px começa na frente, nx termina nela). */
const xFrente = (f: CtxFace) => (f.face === "px" ? 0 : f.w);
const ehLado = (f: CtxFace) => f.face === "px" || f.face === "nx";

/** Linha reta (atalho do pesponto). */
const reta = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y1],
];

/**
 * O "peito" (do calcanhar até a frente da calça, fecha a boca dela) e o
 * bico (mais baixo, na frente), como no tênis.
 */
function peitoEBico(m: Medidas, z: number, L: number, fracBico = 0.42) {
  const frenteDaCalca = (m.pernaW + 0.02) / 2 + 0.006;
  const tras = z - L / 2 + 0.004;
  const compPeito = frenteDaCalca - tras;
  const compBico = L * fracBico;
  return {
    tras,
    compPeito,
    compBico,
    zPeito: tras + compPeito / 2,
    zBico: z + L / 2 - 0.004 - compBico / 2,
  };
}

/** Brilho de borracha/verniz: faixa larga suave + fio de luz forte. */
function brilhoMolhado(f: CtxFace, a = 0.35) {
  const { g, w, h } = f;
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, "rgba(255,255,255,0)");
  gr.addColorStop(0.3, `rgba(255,255,255,${a * 0.5})`);
  gr.addColorStop(0.42, "rgba(255,255,255,0)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(-0.1, -0.1, w + 0.2, h + 0.2);
  g.fillStyle = `rgba(255,255,255,${a})`;
  g.fillRect(w * 0.27, h * 0.08, Math.max(0.004, pxs(f, 2)), h * 0.8);
}

/** Laterais de uma sola de borracha: cravos em contraste e o friso. */
function lateralDaSola(f: CtxFace, sola: string, cravos = true) {
  const { g, w, h } = f;
  base(f, sola);
  if (cravos) {
    g.fillStyle = contraste(sola);
    for (let x = 0.008; x < w; x += 0.026) g.fillRect(x, h * 0.55, 0.013, h * 0.5);
    g.fillStyle = "rgba(0,0,0,0.35)";
    for (let x = 0.021; x < w; x += 0.026) g.fillRect(x, h * 0.55, 0.004, h * 0.5);
  }
  costura(f, reta(-0.1, h * 0.25, w + 0.1, h * 0.25), contraste(sola), { traco: 0.005 });
  volume(f, { luz: 0.12, sombra: 0.25, bordas: 0.05, contorno: 0.3 });
}

/** Cadarço em zigue-zague subindo pelo cano, com ganchos no alto e ilhoses embaixo. */
function cadarcoDoCano(f: CtxFace, cadarco: string, fundo: string, ganchos: number) {
  const { g, w: W, h } = f;
  g.fillStyle = fundo;
  g.fillRect(W * 0.32, 0.02, W * 0.36, h);
  oclusao(f, W * 0.32, 0.02, W * 0.03, h, "esq", 0.3);
  oclusao(f, W * 0.65, 0.02, W * 0.03, h, "dir", 0.3);
  const ys: number[] = [];
  for (let y = 0.016; y < h + 0.02; y += 0.024) ys.push(y);
  for (let i = 0; i < ys.length - 1; i++) {
    const y = ys[i]!;
    const yn = ys[i + 1]!;
    for (const [a, b] of [
      [0.28, 0.72],
      [0.72, 0.28],
    ] as const) {
      g.strokeStyle = "rgba(0,0,0,0.35)";
      g.lineWidth = 0.009;
      g.beginPath();
      g.moveTo(W * a, y + 0.002);
      g.lineTo(W * b, yn + 0.002);
      g.stroke();
      g.strokeStyle = cadarco;
      g.lineWidth = 0.0065;
      g.beginPath();
      g.moveTo(W * a, y);
      g.lineTo(W * b, yn);
      g.stroke();
    }
  }
  ys.forEach((y, i) => {
    for (const x of [W * 0.27, W * 0.73]) {
      if (i < ganchos) {
        g.fillStyle = "#9ca3af";
        g.beginPath();
        g.arc(x, y, 0.008, Math.PI * 0.15, Math.PI * 1.85);
        g.fill();
        g.fillStyle = "#4b5563";
        g.beginPath();
        g.arc(x, y, 0.0035, 0, Math.PI * 2);
        g.fill();
      } else ilhos(f, x, y, 0.0055, "#b0b6bf");
    }
  });
}

/* ———————————————————— GALOCHA ———————————————————— */

/**
 * Galocha de borracha (bota de chuva do campo): cano largo e brilhante,
 * faixa na boca na 2ª cor com a fivela de ajuste e solado tratorado.
 */
const galocha: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const sola = piso(escurecer(cor, 0.45));
  const faixa = detalhe(c, cor);
  const H = alturaDoCalcado("galocha", m) + 0.008;
  const L = m.pernaW + 0.085;
  const z = 0.035;
  const partes: ParteMolde[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [SW + 0.008, 0.035, L], 0, z, 0.014));
    partes.push(blocoDoPe(m, e, "pe", l, [UW + 0.008, 0.08, L - 0.006], 0.028, z, 0.04));
    partes.push(
      blocoDoPe(m, e, "cano", l, [UW + 0.014, H - 0.09, m.pernaW + 0.036], 0.09, 0, 0.045),
    );
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola")) {
      if (f.face === "ny") return pegada(f, sola, piso(escurecer(sola, 0.18)), "tratorado");
      if (f.face === "py") return base(f, sola);
      return lateralDaSola(f, sola);
    }
    base(f, cor);
    if (f.face === "ny") return escurecerTudo(f, 0.45, cor);
    if (f.parte.startsWith("cano")) {
      if (f.face === "py") {
        // a boca larga: o forro escuro em volta da calça
        escurecerTudo(f, 0.55, cor);
        g.strokeStyle = faixa;
        g.lineWidth = 0.02;
        g.strokeRect(0, 0, W, h);
        return;
      }
      brilhoMolhado(f, 0.4);
      // faixa da boca e o friso de baixo
      g.fillStyle = faixa;
      g.fillRect(-0.1, -0.1, W + 0.2, 0.15);
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(-0.1, 0.05, W + 0.2, Math.max(0.003, pxs(f, 1.5)));
      if (f.face === faceExterna(f.lado)) {
        // a sanfona de ajuste com a tirinha e a fivela
        g.fillStyle = escurecer(cor, 0.18);
        poligono(g, [
          [W * 0.38, 0.05],
          [W * 0.62, 0.05],
          [W * 0.5, 0.17],
        ]);
        g.fill();
        g.fillStyle = faixa;
        g.fillRect(W * 0.34, 0.02, W * 0.32, 0.022);
        g.strokeStyle = "#cbd5e1";
        g.lineWidth = 0.004;
        g.strokeRect(W * 0.6, 0.016, 0.02, 0.03);
      } else if (f.face === "nz") {
        // a nervura de trás
        g.fillStyle = "rgba(0,0,0,0.18)";
        g.fillRect(W / 2 - 0.006, 0.05, 0.012, h);
        g.fillStyle = "rgba(255,255,255,0.18)";
        g.fillRect(W / 2 - 0.006, 0.05, 0.003, h);
      }
      dobra(f, [W * 0.1, h - 0.07, W * 0.5, h - 0.085, W * 0.9, h - 0.065], 0.008, 0.2);
      return volume(f, { luz: 0.16, sombra: 0.2, bordas: 0.14, contorno: 0.3, base: cor });
    }
    // —— o pé ——
    if (f.face === "py") {
      brilho(f, W * 0.5, h * 0.82, W * 0.3, h * 0.1, 0.4);
      oclusao(f, -0.1, -0.1, W + 0.2, h * 0.3, "cima", 0.35);
      return volume(f, { luz: 0.16, sombra: 0, bordas: 0.12 });
    }
    if (f.face === "pz") brilho(f, W * 0.5, h * 0.4, W * 0.35, h * 0.25, 0.4);
    else brilhoMolhado(f, 0.3);
    // o friso de borracha logo acima da sola
    g.fillStyle = escurecer(cor, 0.15);
    g.fillRect(-0.1, h - 0.022, W + 0.2, 0.03);
    volume(f, { luz: 0.16, sombra: 0.22, bordas: 0.1, contorno: 0.3, base: cor });
  };
  return { partes, livres: [], pintar, rugosidade: 0.28, corBase: cor };
};

/* ———————————————————— BOTINA DE ELÁSTICO COM BIQUEIRA ———————————————————— */

/**
 * A botina do agro: couro, elástico em V dos dois lados do cano, alça de
 * puxar atrás, biqueira de segurança 3D na ponta e solado de PU bicolor.
 */
const botinaEpi: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const linha = clarear(cor, 0.35);
  const H = alturaDoCalcado("botinaEpi") + 0.008;
  const L = m.pernaW + 0.085;
  const z = 0.035;
  const solado = "#2a2a2e";
  const mel = "#c58a3a";
  const partes: ParteMolde[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [SW + 0.006, 0.042, L], 0, z, 0.014));
    partes.push(blocoDoPe(m, e, "pe", l, [UW + 0.004, 0.075, L - 0.012], 0.034, z, 0.036));
    partes.push(
      blocoDoPe(m, e, "cano", l, [UW + 0.004, H - 0.09, m.pernaW + 0.026], 0.09, 0, 0.04),
    );
    partes.push(
      blocoDoPe(m, e, "biqueira", l, [UW + 0.014, 0.085, 0.085], 0.034, z + L / 2 - 0.0445, 0.03),
    );
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola")) {
      if (f.face === "ny") return pegada(f, solado, "#3a3a40", "tratorado", { arco: mel });
      base(f, solado);
      if (f.face === "py") return;
      // a entressola cor de mel em cima do solado preto
      g.fillStyle = mel;
      g.fillRect(-0.1, -0.1, W + 0.2, h * 0.45 + 0.1);
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(-0.1, h * 0.45, W + 0.2, Math.max(0.003, pxs(f, 1.5)));
      for (let x = 0.008; x < W; x += 0.026) {
        g.fillStyle = "#3a3a40";
        g.fillRect(x, h * 0.62, 0.013, h * 0.5);
      }
      return volume(f, { luz: 0.12, sombra: 0.25, bordas: 0.05, contorno: 0.3 });
    }
    base(f, cor);
    pano(f, "couro");
    if (f.face === "ny") return escurecerTudo(f, 0.45, cor);
    if (f.parte.startsWith("biqueira")) {
      const capa = escurecer(cor, 0.12);
      base(f, capa);
      pano(f, "couro", 0.7);
      if (f.face === "nz") return escurecerTudo(f, 0.3, capa);
      if (f.face === "py") {
        costura(f, curvaPts(W * 0.06, h * 0.1, W * 0.5, -0.01, W * 0.94, h * 0.1), linha, {
          duplo: 0.006,
          traco: 0.006,
        });
        brilho(f, W * 0.5, h * 0.6, W * 0.32, h * 0.22, 0.4);
      } else brilho(f, W * 0.5, h * 0.35, W * 0.35, h * 0.2, 0.3);
      return volume(f, { luz: 0.18, sombra: 0.22, bordas: 0.12, contorno: 0.32 });
    }
    if (f.parte.startsWith("cano")) {
      if (f.face === "py") {
        escurecerTudo(f, 0.3, cor);
        g.strokeStyle = piso(escurecer(cor, 0.35));
        g.lineWidth = 0.03;
        g.strokeRect(0, 0, W, h);
        return;
      }
      oclusao(f, -0.1, -0.1, W + 0.2, 0.1, "cima", 0.3);
      if (ehLado(f)) {
        // o elástico em V: mais largo em cima, canelado escuro e pespontado
        const v: [number, number][] = [
          [W * 0.28, -0.01],
          [W * 0.72, -0.01],
          [W * 0.56, h * 0.78],
          [W * 0.44, h * 0.78],
        ];
        g.save();
        g.fillStyle = "#1f2125";
        poligono(g, v);
        g.fill();
        g.clip();
        g.fillStyle = "rgba(255,255,255,0.12)";
        for (let x = W * 0.28; x < W * 0.72; x += 0.008) g.fillRect(x, -0.01, pxs(f, 1.5), h);
        g.restore();
        costura(f, [v[0]!, v[3]!], linha, { traco: 0.005 });
        costura(f, [v[1]!, v[2]!], linha, { traco: 0.005 });
      } else if (f.face === "nz") {
        // a alça de puxar
        g.fillStyle = piso(escurecer(cor, 0.35));
        g.beginPath();
        g.roundRect(W * 0.4, -0.03, W * 0.2, 0.08, 0.008);
        g.fill();
        costura(f, reta(W * 0.5, 0.06, W * 0.5, h), linha, { traco: 0.005 });
      } else {
        costura(f, reta(W * 0.2, 0.02, W * 0.2, h), linha, { traco: 0.005 });
        costura(f, reta(W * 0.8, 0.02, W * 0.8, h), linha, { traco: 0.005 });
      }
      dobra(f, [W * 0.1, h * 0.65, W * 0.5, h * 0.6, W * 0.9, h * 0.66], 0.008, 0.18);
      return volume(f, { luz: 0.14, sombra: 0.2, bordas: 0.1, contorno: 0.3 });
    }
    // —— o pé ——
    if (f.face === "py") {
      costura(f, curvaPts(W * 0.05, h * 0.42, W * 0.5, h * 0.3, W * 0.95, h * 0.42), linha, {
        traco: 0.006,
      });
      oclusao(f, -0.1, -0.1, W + 0.2, h * 0.25, "cima", 0.35);
      return volume(f, { luz: 0.14, sombra: 0, bordas: 0.12 });
    }
    costura(f, reta(-0.1, h - 0.012, W + 0.1, h - 0.012), linha, { traco: 0.006 });
    if (ehLado(f)) {
      // a costura da gáspea, perto do bico
      const xa = xFrente(f) === 0 ? W * 0.38 : W * 0.62;
      const xb = xFrente(f) === 0 ? W * 0.02 : W * 0.98;
      costura(f, curvaPts(xa, -0.01, xa, h * 0.6, xb, h * 0.7), linha, { traco: 0.006 });
    }
    volume(f, { luz: 0.14, sombra: 0.22, bordas: 0.1, contorno: 0.3 });
  };
  return { partes, livres: [], pintar, rugosidade: 0.6, corBase: cor };
};

/* ———————————————————— COTURNO ———————————————————— */

/** Coturno militar: cano alto todo amarrado (ganchos no alto), zíper de dentro e solado grosso. */
const coturno: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const sola = "#232327";
  const linha = clarear(cor, 0.3);
  const cadarco = contrasta(c.corRoupa2, cor, 0.12)
    ? c.corRoupa2
    : luminancia(cor) > 0.45
      ? "#2b2b2f"
      : "#9ca3af";
  const H = alturaDoCalcado("coturno", m) + 0.008;
  const L = m.pernaW + 0.09;
  const z = 0.035;
  const partes: ParteMolde[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [SW + 0.01, 0.05, L], 0, z, 0.012));
    partes.push(blocoDoPe(m, e, "pe", l, [UW + 0.006, 0.075, L - 0.012], 0.042, z, 0.036));
    partes.push(blocoDoPe(m, e, "cano", l, [UW + 0.006, H - 0.1, m.pernaW + 0.028], 0.1, 0, 0.04));
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola")) {
      if (f.face === "ny") return pegada(f, sola, "#3b3b42", "tratorado");
      if (f.face === "py") return base(f, sola);
      base(f, sola);
      // cravos grandes em degrau e o vergão costurado
      g.fillStyle = "#3b3b42";
      for (let x = 0.006; x < W; x += 0.03) {
        g.beginPath();
        g.roundRect(x, h * 0.45, 0.02, h * 0.6, 0.004);
        g.fill();
      }
      g.fillStyle = "#34343a";
      g.fillRect(-0.1, -0.1, W + 0.2, h * 0.3 + 0.1);
      costura(f, reta(-0.1, h * 0.16, W + 0.1, h * 0.16), "#6b7280", { traco: 0.005 });
      return volume(f, { luz: 0.12, sombra: 0.25, bordas: 0.05, contorno: 0.3 });
    }
    base(f, cor);
    pano(f, "couro");
    if (f.face === "ny") return escurecerTudo(f, 0.45, cor);
    if (f.parte.startsWith("cano")) {
      if (f.face === "py") {
        escurecerTudo(f, 0.3, cor);
        g.strokeStyle = piso(escurecer(cor, 0.4));
        g.lineWidth = 0.03;
        g.strokeRect(0, 0, W, h);
        return;
      }
      // o colarinho acolchoado no alto
      g.fillStyle = piso(escurecer(cor, 0.25));
      g.fillRect(-0.1, -0.1, W + 0.2, 0.14);
      oclusao(f, -0.1, 0.04, W + 0.2, 0.015, "cima", 0.35);
      if (f.face === "pz") cadarcoDoCano(f, cadarco, escurecer(cor, 0.14), 4);
      else if (f.face === faceInterna(f.lado)) ziper(f, W / 2, 0.05, h - 0.01, cor);
      else if (f.face === "nz") {
        g.fillStyle = piso(escurecer(cor, 0.35));
        g.beginPath();
        g.roundRect(W * 0.4, -0.03, W * 0.2, 0.08, 0.008);
        g.fill();
        costura(f, reta(W * 0.5, 0.06, W * 0.5, h), linha, { traco: 0.005 });
      } else {
        costura(f, reta(W * 0.35, 0.05, W * 0.35, h), linha, { traco: 0.005 });
        costura(f, reta(W * 0.65, 0.05, W * 0.65, h), linha, { traco: 0.005 });
      }
      dobra(f, [W * 0.1, h - 0.06, W * 0.5, h - 0.075, W * 0.9, h - 0.055], 0.008, 0.2);
      dobra(f, [W * 0.15, h * 0.5, W * 0.5, h * 0.46, W * 0.85, h * 0.52], 0.008, 0.14);
      return volume(f, { luz: 0.14, sombra: 0.2, bordas: 0.12, contorno: 0.3, base: cor });
    }
    // —— o pé ——
    if (f.face === "py") {
      g.fillStyle = escurecer(cor, 0.14);
      g.fillRect(W * 0.32, -0.1, W * 0.36, h * 0.5);
      for (let y = h * 0.16; y < h * 0.45; y += 0.022) {
        for (const x of [W * 0.3, W * 0.7]) ilhos(f, x, y, 0.005, "#b0b6bf");
        g.strokeStyle = cadarco;
        g.lineWidth = 0.006;
        g.beginPath();
        g.moveTo(W * 0.3, y);
        g.lineTo(W * 0.7, y + 0.022);
        g.moveTo(W * 0.7, y);
        g.lineTo(W * 0.3, y + 0.022);
        g.stroke();
      }
      costura(f, curvaPts(W * 0.05, h * 0.6, W * 0.5, h * 0.48, W * 0.95, h * 0.6), linha, {
        duplo: 0.006,
        traco: 0.006,
      });
      oclusao(f, -0.1, -0.1, W + 0.2, h * 0.18, "cima", 0.35);
      return volume(f, { luz: 0.14, sombra: 0, bordas: 0.12 });
    }
    if (f.face === "pz") brilho(f, W * 0.5, h * 0.45, W * 0.3, h * 0.25, 0.22);
    costura(f, reta(-0.1, h - 0.012, W + 0.1, h - 0.012), linha, { traco: 0.006 });
    volume(f, { luz: 0.14, sombra: 0.22, bordas: 0.1, contorno: 0.3 });
  };
  return { partes, livres: [], pintar, rugosidade: 0.55, corBase: cor };
};

/* ———————————————————— TÊNIS CANO ALTO ———————————————————— */

/** Tênis de basquete de cano alto: colarinho acolchoado, tira de velcro e o emblema de estrela. */
const tenisCano: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const borracha = "#f3f1ec";
  const destaque = detalhe(c, cor);
  const cadarco = luminancia(cor) > 0.5 ? "#475569" : "#f1f5f9";
  const H = alturaDoCalcado("tenisCano") + 0.008;
  const L = m.pernaW + 0.09;
  const z = 0.04;
  const { compPeito, compBico, zPeito, zBico } = peitoEBico(m, z, L);
  const partes: ParteMolde[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [SW, 0.045, L], 0, z, 0.016));
    partes.push(blocoDoPe(m, e, "pe", l, [UW, H - 0.035, compPeito], 0.035, zPeito, 0.045));
    partes.push(blocoDoPe(m, e, "bico", l, [UW - 0.008, 0.07, compBico], 0.035, zBico, 0.032));
    partes.push(
      blocoDoPe(m, e, "tira", l, [UW + 0.012, 0.036, compPeito + 0.012], H - 0.075, zPeito, 0.045, {
        ocultas: ["py", "ny"] as Face[],
      }),
    );
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola")) {
      if (f.face === "ny") return pegada(f, borracha, "#d4d0c7", "tenis", { arco: destaque });
      base(f, borracha);
      if (f.face === "py") return;
      g.fillStyle = destaque;
      g.fillRect(-0.1, h * 0.3, W + 0.2, h * 0.14);
      g.fillStyle = "rgba(0,0,0,0.14)";
      for (let x = 0.01; x < W; x += 0.012) g.fillRect(x, h * 0.6, pxs(f, 1.5), h * 0.3);
      oclusao(f, -0.1, -0.1, W + 0.2, 0.02, "cima", 0.3);
      return volume(f, { luz: 0.1, sombra: 0.25, bordas: 0.05, contorno: 0.3 });
    }
    if (f.parte.startsWith("tira")) {
      base(f, destaque);
      g.fillStyle = "rgba(0,0,0,0.12)";
      for (let x = -0.1; x < W + 0.1; x += 0.006) g.fillRect(x, 0, pxs(f, 1), h);
      if (f.face === faceExterna(f.lado)) {
        g.fillStyle = escurecer(destaque, 0.25);
        g.beginPath();
        g.roundRect(W * 0.08, h * 0.15, 0.03, h * 0.7, 0.006);
        g.fill();
      }
      return volume(f, { luz: 0.2, sombra: 0.25, bordas: 0.1, contorno: 0.35 });
    }
    base(f, cor);
    pano(f, "couro", 0.45);
    if (f.face === "ny") return escurecerTudo(f, 0.4, cor);
    if (f.parte.startsWith("bico")) {
      if (f.face === "py") {
        cadarcos(f, cadarco, escurecer(cor, 0.12), W * 0.33, W * 0.67, -0.01, h * 0.42, 2);
        g.fillStyle = borracha;
        g.beginPath();
        g.moveTo(-0.1, h + 0.1);
        g.lineTo(-0.1, h * 0.75);
        g.quadraticCurveTo(W * 0.5, h * 0.55, W + 0.1, h * 0.75);
        g.lineTo(W + 0.1, h + 0.1);
        g.closePath();
        g.fill();
        return volume(f, { luz: 0.16, sombra: 0, bordas: 0.12, contorno: 0.25 });
      }
      if (f.face === "pz") {
        g.fillStyle = borracha;
        g.fillRect(-0.1, h * 0.3, W + 0.2, h);
        return volume(f, { luz: 0.12, sombra: 0.16, bordas: 0.1, contorno: 0.3 });
      }
      if (f.face === "nz") return escurecerTudo(f, 0.3, cor);
      return volume(f, { luz: 0.14, sombra: 0.16, bordas: 0.08, contorno: 0.3 });
    }
    // —— o cano (peito) ——
    if (f.face === "py") {
      escurecerTudo(f, 0.3, cor);
      g.strokeStyle = destaque;
      g.lineWidth = 0.025;
      g.strokeRect(0, 0, W, h);
      return;
    }
    // colarinho acolchoado
    g.fillStyle = destaque;
    g.fillRect(-0.1, -0.1, W + 0.2, 0.135);
    oclusao(f, -0.1, 0.035, W + 0.2, 0.012, "cima", 0.3);
    if (f.face === "pz") {
      cadarcos(f, cadarco, escurecer(cor, 0.12), W * 0.33, W * 0.67, 0.05, h - 0.02, 4);
    } else if (f.face === "nz") {
      g.fillStyle = escurecer(cor, 0.1);
      g.beginPath();
      g.roundRect(W * 0.2, h * 0.45, W * 0.6, h * 0.6, 0.02);
      g.fill();
    } else {
      // o emblema redondo com estrela no tornozelo de fora e o painel do calcanhar
      g.fillStyle = escurecer(cor, 0.12);
      const xf = xFrente(f);
      const xt = W - xf;
      g.beginPath();
      g.moveTo(xt, h * 0.3);
      g.quadraticCurveTo(W * 0.5, h * 0.55, xt, h + 0.02);
      g.fill();
      if (f.face === faceExterna(f.lado)) {
        const cx = W * 0.5;
        const cy = h * 0.42;
        g.fillStyle = "#f8fafc";
        g.beginPath();
        g.arc(cx, cy, 0.026, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = destaque;
        g.lineWidth = 0.004;
        g.stroke();
        g.fillStyle = destaque;
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const r = i % 2 ? 0.008 : 0.018;
          if (i) g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          else g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        g.closePath();
        g.fill();
      }
    }
    costura(f, reta(-0.1, h - 0.008, W + 0.1, h - 0.008), contraste(cor), { traco: 0.006 });
    volume(f, { luz: 0.14, sombra: 0.16, bordas: 0.08, contorno: 0.3 });
  };
  return { partes, livres: [], pintar, rugosidade: 0.6, corBase: cor };
};

/* ———————————————————— TÊNIS CHUNKY ———————————————————— */

/** Tênis "paizão" de solado gigante em camadas onduladas, cabedal de tela com recortes. */
const tenisChunky: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const creme = "#f1ece0";
  const destaque = detalhe(c, cor);
  const recorte = luminancia(cor) > 0.6 ? "#cbd5e1" : clarear(cor, 0.55);
  const H = alturaDoCalcado("tenisChunky") + 0.008;
  const L = m.pernaW + 0.1;
  const z = 0.045;
  const { compPeito, compBico, zPeito, zBico } = peitoEBico(m, z, L, 0.44);
  const partes: ParteMolde[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [SW + 0.014, 0.03, L + 0.012], 0, z, 0.012));
    partes.push(blocoDoPe(m, e, "entressola", l, [SW + 0.008, 0.042, L], 0.026, z, 0.016));
    partes.push(blocoDoPe(m, e, "pe", l, [UW, H - 0.062, compPeito], 0.062, zPeito, 0.045));
    partes.push(blocoDoPe(m, e, "bico", l, [UW - 0.006, 0.062, compBico], 0.062, zBico, 0.032));
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola")) {
      const s = piso(escurecer(destaque, 0.1));
      if (f.face === "ny") return pegada(f, s, piso(escurecer(s, 0.2)), "tenis");
      base(f, s);
      return volume(f, { luz: 0.1, sombra: 0.25, bordas: 0.05, contorno: 0.3 });
    }
    if (f.parte.startsWith("entressola")) {
      base(f, creme);
      if (f.face === "py" || f.face === "ny") return;
      // as ondas da entressola: a camada de cima em outra cor
      g.fillStyle = recorte;
      g.beginPath();
      g.moveTo(-0.1, -0.1);
      g.lineTo(-0.1, h * 0.4);
      for (let x = -0.1; x < W + 0.1; x += 0.05)
        g.quadraticCurveTo(x + 0.025, h * 0.75, x + 0.05, h * 0.4);
      g.lineTo(W + 0.1, -0.1);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(0,0,0,0.25)";
      g.lineWidth = Math.max(0.003, pxs(f, 1.5));
      g.stroke();
      return volume(f, { luz: 0.12, sombra: 0.22, bordas: 0.06, contorno: 0.3 });
    }
    base(f, cor);
    pano(f, "tela", 0.8);
    if (f.face === "ny") return escurecerTudo(f, 0.4, cor);
    const cadarco = luminancia(cor) > 0.5 ? "#475569" : "#f1f5f9";
    if (f.parte.startsWith("bico")) {
      if (f.face === "py") {
        cadarcos(f, cadarco, escurecer(cor, 0.1), W * 0.33, W * 0.67, -0.01, h * 0.42, 2);
        // a biqueira de camurça
        g.fillStyle = recorte;
        g.beginPath();
        g.moveTo(-0.1, h + 0.1);
        g.lineTo(-0.1, h * 0.7);
        g.quadraticCurveTo(W * 0.5, h * 0.5, W + 0.1, h * 0.7);
        g.lineTo(W + 0.1, h + 0.1);
        g.closePath();
        g.fill();
        return volume(f, { luz: 0.16, sombra: 0, bordas: 0.12, contorno: 0.25 });
      }
      if (f.face === "nz") return escurecerTudo(f, 0.3, cor);
      g.fillStyle = recorte;
      g.fillRect(-0.1, h * 0.35, W + 0.2, h);
      return volume(f, { luz: 0.14, sombra: 0.16, bordas: 0.1, contorno: 0.3 });
    }
    if (f.face === "py") {
      cadarcos(f, cadarco, escurecer(cor, 0.1), W * 0.32, W * 0.68, h * 0.6, h - 0.012, 2);
      oclusao(f, -0.1, -0.1, W + 0.2, h * 0.5, "cima", 0.35);
      return volume(f, { luz: 0.12, sombra: 0, bordas: 0.12 });
    }
    if (f.face === "pz") {
      cadarcos(f, cadarco, escurecer(cor, 0.1), W * 0.33, W * 0.67, 0.01, h * 0.62, 2);
    } else if (f.face === "nz") {
      g.fillStyle = recorte;
      g.beginPath();
      g.roundRect(W * 0.15, h * 0.35, W * 0.7, h * 0.7, 0.02);
      g.fill();
      g.fillStyle = destaque;
      g.beginPath();
      g.roundRect(W * 0.42, -0.02, W * 0.16, h * 0.4, 0.008);
      g.fill();
    } else {
      // recortes sobrepostos e a faixa ondulada na 2ª cor
      g.fillStyle = recorte;
      g.beginPath();
      g.moveTo(-0.1, h * 0.55);
      g.quadraticCurveTo(W * 0.5, h * 0.2, W + 0.1, h * 0.55);
      g.lineTo(W + 0.1, h + 0.1);
      g.lineTo(-0.1, h + 0.1);
      g.closePath();
      g.fill();
      g.strokeStyle = destaque;
      g.lineWidth = 0.016;
      g.beginPath();
      g.moveTo(W * 0.08, h * 0.85);
      g.bezierCurveTo(W * 0.35, h * 0.3, W * 0.6, h * 0.95, W * 0.95, h * 0.4);
      g.stroke();
    }
    volume(f, { luz: 0.14, sombra: 0.16, bordas: 0.08, contorno: 0.3 });
  };
  return { partes, livres: [], pintar, rugosidade: 0.75, corBase: cor };
};

/* ———————————————————— BABUCHE COM PINS ———————————————————— */

/** Um pin (jibbitz) colorido: estrela, coração, carinha ou florzinha. */
function pin(f: CtxFace, x: number, y: number, r: number, tipo: number, cor: string) {
  const { g } = f;
  g.save();
  g.fillStyle = "rgba(0,0,0,0.3)";
  g.beginPath();
  g.arc(x + r * 0.15, y + r * 0.2, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = cor;
  if (tipo === 0) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r * 1.1;
      if (i) g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  } else if (tipo === 1) {
    g.beginPath();
    g.moveTo(x, y + r);
    g.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.6, y - r * 1.4, x, y - r * 0.4);
    g.bezierCurveTo(x + r * 0.6, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r);
    g.fill();
  } else if (tipo === 2) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1c1c1f";
    g.beginPath();
    g.arc(x - r * 0.35, y - r * 0.2, r * 0.13, 0, Math.PI * 2);
    g.arc(x + r * 0.35, y - r * 0.2, r * 0.13, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#1c1c1f";
    g.lineWidth = r * 0.14;
    g.beginPath();
    g.arc(x, y, r * 0.5, 0.2 * Math.PI, 0.8 * Math.PI);
    g.stroke();
  } else {
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      g.beginPath();
      g.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.45, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#facc15";
    g.beginPath();
    g.arc(x, y, r * 0.35, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "rgba(255,255,255,0.5)";
  g.beginPath();
  g.arc(x - r * 0.35, y - r * 0.4, r * 0.18, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Furinhos de ventilação em quincôncio. */
function furinhos(
  f: CtxFace,
  cor: string,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  passo = 0.026,
) {
  const { g } = f;
  const r = passo * 0.28;
  for (let y = y0, j = 0; y <= y1; y += passo * 0.86, j++) {
    for (let x = x0 + (j % 2 ? passo / 2 : 0); x <= x1; x += passo) {
      g.fillStyle = piso(escurecer(cor, 0.55));
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = alfa(clarear(cor, 0.4), 0.6);
      g.beginPath();
      g.arc(x, y + r * 0.5, r * 0.7, 0, Math.PI);
      g.fill();
    }
  }
}

/**
 * Babuche de borracha: o corpo fofo na frente, a alça do calcanhar, os
 * furinhos e os pins coloridos em cima. O calcanhar fica de fora (pele).
 */
const babuche: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const sola = piso(escurecer(cor, 0.2));
  const L = m.pernaW + 0.1;
  const z = 0.045;
  const compCorpo = L * 0.64;
  const zPele = -0.005;
  const partes: ParteMolde[] = [];
  const pele: BlocoPele[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [SW + 0.014, 0.03, L + 0.008], 0, z, 0.012));
    partes.push(
      blocoDoPe(
        m,
        e,
        "corpo",
        l,
        [UW + 0.02, 0.092, compCorpo],
        0.022,
        z + L / 2 - compCorpo / 2,
        0.045,
      ),
    );
    const tras = zPele - m.pernaW / 2 - 0.008;
    const compAlca = z + L / 2 - compCorpo + 0.03 - tras;
    partes.push(
      blocoDoPe(m, e, "alca", l, [UW + 0.028, 0.026, compAlca], 0.05, tras + compAlca / 2, 0.02, {
        ocultas: ["py", "ny"] as Face[],
      }),
    );
    pele.push(
      peleDoPe(
        m,
        e,
        l,
        [m.pernaW - 0.02, alturaDoCalcado("babuche") - 0.018, m.pernaW],
        0.028,
        zPele,
      ),
    );
  }
  const pins = [
    ["#facc15", 0],
    ["#ec4899", 1],
    [contrasta(c.corRoupa2, cor) ? c.corRoupa2 : "#22c55e", 3],
    ["#fde047", 2],
  ] as const;
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola")) {
      if (f.face === "ny") return pegada(f, sola, piso(escurecer(sola, 0.15)), "tenis");
      base(f, sola);
      return volume(f, { luz: 0.12, sombra: 0.2, bordas: 0.05, contorno: 0.3 });
    }
    base(f, cor);
    if (f.parte.startsWith("alca")) {
      g.fillStyle = "rgba(0,0,0,0.15)";
      g.fillRect(-0.1, h * 0.45, W + 0.2, Math.max(0.003, pxs(f, 1.5)));
      return volume(f, { luz: 0.2, sombra: 0.25, bordas: 0.1, contorno: 0.32 });
    }
    if (f.face === "ny") return escurecerTudo(f, 0.4, cor);
    if (f.face === "nz") {
      // a boca: o pé entra por aqui
      escurecerTudo(f, 0.45, cor);
      return;
    }
    if (f.face === "py") {
      // a parte de trás do corpo fica embaixo da barra da calça: furos e pins vão na frente
      furinhos(f, cor, W * 0.14, W * 0.86, h * 0.5, h * 0.64);
      const pos = f.lado > 0 ? [0.24, 0.5, 0.76, 0.62] : [0.28, 0.52, 0.76, 0.38];
      pins.forEach(([cp, tipo], i) => {
        pin(f, W * pos[i]!, h * (i === 3 ? 0.9 : 0.77), 0.016, tipo, cp);
      });
      brilho(f, W * 0.5, h * 0.88, W * 0.3, h * 0.06, 0.25);
      return volume(f, { luz: 0.18, sombra: 0, bordas: 0.14, contorno: 0.25 });
    }
    if (f.face === "pz") {
      furinhos(f, cor, W * 0.2, W * 0.8, h * 0.18, h * 0.4);
      brilho(f, W * 0.5, h * 0.5, W * 0.35, h * 0.25, 0.3);
    } else {
      // laterais: uma fileira de furos e o rebite da alça perto do calcanhar
      furinhos(f, cor, W * 0.2, W * 0.75, h * 0.22, h * 0.3, 0.03);
      const xt = f.face === "px" ? W - 0.025 : 0.025;
      g.fillStyle = escurecer(cor, 0.25);
      g.beginPath();
      g.arc(xt, h - 0.047, 0.014, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = clarear(cor, 0.25);
      g.beginPath();
      g.arc(xt - 0.003, h - 0.05, 0.006, 0, Math.PI * 2);
      g.fill();
    }
    volume(f, { luz: 0.18, sombra: 0.22, bordas: 0.12, contorno: 0.3 });
  };
  return { partes, livres: [], pele, pintar, rugosidade: 0.55, corBase: cor };
};

/* ———————————————————— CHUTEIRA ———————————————————— */

/** Chuteira: cabedal liso com raio na 2ª cor, cadarço de lado, gola de meia e as TRAVAS 3D. */
const chuteira: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const destaque = detalhe(c, cor);
  const placa = piso(escurecer(destaque, 0.15));
  const H = alturaDoCalcado("chuteira") + 0.008;
  const L = m.pernaW + 0.09;
  const z = 0.04;
  const { compPeito, compBico, zPeito, zBico } = peitoEBico(m, z, L, 0.46);
  const partes: ParteMolde[] = [];
  for (const l of LADOS) {
    for (const zt of [z + L / 2 - 0.04, z + L * 0.12, z - L / 2 + 0.04])
      for (const s of [-1, 1])
        partes.push({
          nome: `trava${zt.toFixed(3)}${s}${l}`,
          tam: [0.026, 0.026, 0.026],
          raio: 0.008,
          lado: l,
          livre: "trava",
          matriz: em(e.perna(l), mat([s * (SW / 2 - 0.03), -m.pernaH + 0.013, zt])),
        });
    partes.push(blocoDoPe(m, e, "placa", l, [SW, 0.016, L], 0.022, z, 0.008));
    partes.push(blocoDoPe(m, e, "pe", l, [UW, H - 0.034, compPeito], 0.034, zPeito, 0.045));
    partes.push(blocoDoPe(m, e, "bico", l, [UW - 0.012, 0.052, compBico], 0.034, zBico, 0.026));
  }
  const raio = (f: CtxFace) => {
    const { g, w: W, h } = f;
    const xf = xFrente(f);
    const k = xf === 0 ? 1 : -1;
    g.fillStyle = destaque;
    poligono(g, [
      [xf + k * W * 0.05, h * 0.75],
      [xf + k * W * 0.45, h * 0.3],
      [xf + k * W * 0.5, h * 0.5],
      [xf + k * W * 0.95, h * 0.15],
      [xf + k * W * 0.55, h * 0.65],
      [xf + k * W * 0.5, h * 0.45],
    ]);
    g.fill();
  };
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte === "livre") {
      base(f, "#e5e7eb");
      g.fillStyle = "rgba(0,0,0,0.2)";
      g.fillRect(0, f.h * 0.7, f.w, f.h * 0.3);
      return;
    }
    if (f.parte.startsWith("placa")) {
      base(f, placa);
      if (f.face === "ny") {
        // embaixo (sentado aparece): placa lisa com as nervuras
        g.strokeStyle = contraste(placa);
        g.lineWidth = Math.max(0.004, pxs(f, 2));
        for (let y = 0.03; y < h; y += 0.04) {
          g.beginPath();
          g.moveTo(W * 0.2, y);
          g.lineTo(W * 0.8, y + 0.01);
          g.stroke();
        }
      }
      return volume(f, { luz: 0.14, sombra: 0.2, bordas: 0.06, contorno: 0.32 });
    }
    base(f, cor);
    // degradê do calcanhar para o bico
    const gr = g.createLinearGradient(0, 0, W, h);
    gr.addColorStop(0, "rgba(255,255,255,0.12)");
    gr.addColorStop(1, "rgba(0,0,0,0.12)");
    g.fillStyle = gr;
    g.fillRect(-0.1, -0.1, W + 0.2, h + 0.2);
    if (f.face === "ny") return escurecerTudo(f, 0.4, cor);
    const cadarco = luminancia(cor) > 0.5 ? "#334155" : "#f1f5f9";
    if (f.parte.startsWith("bico")) {
      if (f.face === "py") {
        // cadarço deslocado para fora (área de chute limpa)
        const dx = f.lado > 0 ? W * 0.1 : -W * 0.1;
        cadarcos(f, cadarco, escurecer(cor, 0.1), W * 0.36 + dx, W * 0.64 + dx, -0.01, h * 0.45, 2);
        brilho(f, W * 0.5, h * 0.8, W * 0.3, h * 0.12, 0.35);
        return volume(f, { luz: 0.18, sombra: 0, bordas: 0.12, contorno: 0.25 });
      }
      if (f.face === "nz") return escurecerTudo(f, 0.3, cor);
      if (ehLado(f)) raio(f);
      brilho(f, W * 0.5, h * 0.4, W * 0.35, h * 0.2, 0.35);
      return volume(f, { luz: 0.16, sombra: 0.16, bordas: 0.08, contorno: 0.3 });
    }
    // gola de meia (malha) no alto
    g.fillStyle = piso(escurecer(cor, 0.3));
    g.fillRect(-0.1, -0.1, W + 0.2, 0.13);
    g.fillStyle = "rgba(255,255,255,0.08)";
    for (let x = -0.1; x < W + 0.1; x += 0.01) g.fillRect(x, -0.1, pxs(f, 1.5), 0.13);
    if (f.face === "py") {
      escurecerTudo(f, 0.3, cor);
      return;
    }
    if (f.face === "pz") {
      const dx = f.lado > 0 ? W * 0.1 : -W * 0.1;
      cadarcos(f, cadarco, escurecer(cor, 0.1), W * 0.36 + dx, W * 0.64 + dx, 0.05, h * 0.9, 2);
    } else if (ehLado(f)) raio(f);
    brilho(f, W * 0.5, h * 0.5, W * 0.35, h * 0.15, 0.25);
    volume(f, { luz: 0.16, sombra: 0.16, bordas: 0.08, contorno: 0.3 });
  };
  return {
    partes,
    livres: [{ nome: "trava", w: 0.04, h: 0.04 }],
    pintar,
    rugosidade: 0.4,
    corBase: cor,
  };
};

/* ———————————————————— PATINS ———————————————————— */

/** Patins de 4 rodas retrô: bota de cano com listras, placa de metal, rodas neon e o freio. */
const patins: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const roda = contrasta(c.corRoupa2, cor) ? c.corRoupa2 : "#f472b6";
  const listra = luminancia(cor) > 0.6 ? "#ef4444" : "#f8fafc";
  const H = alturaDoCalcado("patins") + 0.008;
  const L = m.pernaW + 0.09;
  const z = 0.035;
  const Y = 0.074; // onde a bota começa
  const { compPeito, compBico, zPeito, zBico } = peitoEBico(m, z, L);
  const partes: ParteMolde[] = [];
  for (const l of LADOS) {
    for (const zr of [z + L / 2 - 0.045, z - L / 2 + 0.045])
      for (const s of [-1, 1])
        partes.push({
          nome: `roda${zr > z ? "F" : "T"}${s < 0 ? "A" : "B"}${l < 0 ? "D" : "E"}`,
          tam: [0.034, 0.052, 0.052],
          raio: 0.022,
          lado: l,
          matriz: em(e.perna(l), mat([s * (SW / 2 - 0.012), -m.pernaH + 0.026, zr])),
        });
    partes.push(blocoDoPe(m, e, "placa", l, [SW - 0.03, 0.016, L - 0.04], 0.042, z, 0.006));
    partes.push(
      blocoDoPe(m, e, "freio", l, [0.045, 0.045, 0.035], 0.012, z + L / 2 - 0.005, 0.012),
    );
    partes.push(blocoDoPe(m, e, "sola", l, [SW, 0.02, L], 0.056, z, 0.008));
    partes.push(blocoDoPe(m, e, "pe", l, [UW, H - Y, compPeito], Y, zPeito, 0.045));
    partes.push(blocoDoPe(m, e, "bico", l, [UW - 0.008, 0.06, compBico], Y, zBico, 0.03));
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("roda")) {
      base(f, roda);
      if (ehLado(f)) {
        // o cubo da roda
        g.fillStyle = "#e5e7eb";
        g.beginPath();
        g.arc(W / 2, h / 2, Math.min(W, h) * 0.24, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#6b7280";
        g.beginPath();
        g.arc(W / 2, h / 2, Math.min(W, h) * 0.09, 0, Math.PI * 2);
        g.fill();
      }
      return volume(f, { luz: 0.25, sombra: 0.25, bordas: 0.2, contorno: 0.3 });
    }
    if (f.parte.startsWith("placa")) {
      base(f, "#a1a8b3");
      return volume(f, { luz: 0.3, sombra: 0.3, bordas: 0.1, contorno: 0.35 });
    }
    if (f.parte.startsWith("freio")) {
      base(f, "#2b2b30");
      return volume(f, { luz: 0.18, sombra: 0.25, bordas: 0.1, contorno: 0.3 });
    }
    if (f.parte.startsWith("sola")) {
      if (f.face === "ny") return pegada(f, "#3f3f46", "#52525b", "couro", { soFrente: true });
      base(f, "#3f3f46");
      return volume(f, { luz: 0.12, sombra: 0.2, bordas: 0.05, contorno: 0.3 });
    }
    base(f, cor);
    pano(f, "couro", 0.5);
    if (f.face === "ny") return escurecerTudo(f, 0.4, cor);
    if (f.parte.startsWith("bico")) {
      if (f.face === "py") {
        cadarcos(f, listra, escurecer(cor, 0.1), W * 0.33, W * 0.67, -0.01, h * 0.45, 2);
        brilho(f, W * 0.5, h * 0.8, W * 0.3, h * 0.12, 0.3);
        return volume(f, { luz: 0.16, sombra: 0, bordas: 0.12, contorno: 0.25 });
      }
      if (f.face === "nz") return escurecerTudo(f, 0.3, cor);
      brilho(f, W * 0.5, h * 0.4, W * 0.35, h * 0.2, 0.3);
      return volume(f, { luz: 0.16, sombra: 0.16, bordas: 0.08, contorno: 0.3 });
    }
    if (f.face === "py") {
      escurecerTudo(f, 0.3, cor);
      g.strokeStyle = "#f8fafc";
      g.lineWidth = 0.025;
      g.strokeRect(0, 0, W, h);
      return;
    }
    // colarinho branco acolchoado
    g.fillStyle = "#f8fafc";
    g.fillRect(-0.1, -0.1, W + 0.2, 0.13);
    oclusao(f, -0.1, 0.03, W + 0.2, 0.012, "cima", 0.3);
    if (f.face === "pz") {
      cadarcos(f, listra, escurecer(cor, 0.1), W * 0.33, W * 0.67, 0.05, h - 0.02, 5);
    } else if (ehLado(f)) {
      // duas listras de corrida em diagonal
      const xf = xFrente(f);
      const k = xf === 0 ? 1 : -1;
      g.strokeStyle = listra;
      g.lineWidth = 0.012;
      for (const d of [0, 0.024]) {
        g.beginPath();
        g.moveTo(xf + k * (W * 0.15 + d), h);
        g.lineTo(xf + k * (W * 0.6 + d), 0.05);
        g.stroke();
      }
    }
    costura(f, reta(-0.1, h - 0.01, W + 0.1, h - 0.01), contraste(cor), { traco: 0.006 });
    volume(f, { luz: 0.14, sombra: 0.18, bordas: 0.1, contorno: 0.3 });
  };
  return { partes, livres: [], pintar, rugosidade: 0.5, corBase: cor };
};

/* ———————————————————— PANTUFA DE BICHINHO ———————————————————— */

/** Pantufa fofinha de ursinho: pelúcia, orelhas 3D, olhinhos, focinho e bochechas. */
const pantufa: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const orelha = contrasta(c.corRoupa2, cor, 0.12) ? c.corRoupa2 : "#f9a8d4";
  const olho = luminancia(cor) < 0.25 ? "#f8fafc" : "#1c1c1f";
  const L = m.pernaW + 0.1;
  const z = 0.045;
  const alto = alturaDoCalcado("pantufa") + 0.008;
  const partes: ParteMolde[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [SW + 0.03, 0.014, L + 0.012], 0, z, 0.007));
    partes.push(blocoDoPe(m, e, "corpo", l, [UW + 0.03, alto - 0.01, L + 0.004], 0.01, z, 0.05));
    for (const s of [-1, 1] as const) {
      partes.push({
        nome: `orelha${s < 0 ? "A" : "B"}${l < 0 ? "D" : "E"}`,
        tam: [0.05, 0.05, 0.022],
        raio: 0.02,
        lado: l,
        matriz: em(
          e.perna(l),
          mat(
            [s * Math.min(0.06, UW * 0.24), -m.pernaH + alto + 0.016, z + L / 2 - 0.068],
            [0, 0, -s * 0.25],
          ),
        ),
      });
    }
  }
  const pelucia = (f: CtxFace, tom: string) => {
    const { g, w, h } = f;
    if (f.qualidade === "media") return;
    g.save();
    g.lineWidth = pxs(f, 1.5);
    for (let i = 0; i < (w * h) / 0.00012; i++) {
      const x = ((i * 0.6180339) % 1) * w;
      const y = ((i * 0.7548776) % 1) * h;
      g.strokeStyle = i % 2 ? alfa(clarear(tom, 0.35), 0.5) : alfa(escurecer(tom, 0.3), 0.45);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 0.004 * ((i % 3) - 1), y + 0.007);
      g.stroke();
    }
    g.restore();
  };
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola")) {
      if (f.face === "ny") return pegada(f, "#9ca3af", "#b8bec8", "tenis");
      base(f, "#9ca3af");
      return volume(f, { luz: 0.1, sombra: 0.2, bordas: 0.05, contorno: 0.3 });
    }
    if (f.parte.startsWith("orelha")) {
      base(f, cor);
      pelucia(f, cor);
      if (f.face === "pz") {
        g.fillStyle = orelha;
        g.beginPath();
        g.ellipse(W / 2, h * 0.55, W * 0.28, h * 0.3, 0, 0, Math.PI * 2);
        g.fill();
      }
      return volume(f, { luz: 0.18, sombra: 0.2, bordas: 0.18, contorno: 0.3 });
    }
    base(f, cor);
    pelucia(f, cor);
    if (f.face === "ny") return escurecerTudo(f, 0.4, cor);
    if (f.face === "py") {
      // a boca da pantufa (atrás, em volta da calça)
      g.fillStyle = piso(escurecer(cor, 0.45));
      g.beginPath();
      g.ellipse(W / 2, h * 0.38, W * 0.38, h * 0.3, 0, 0, Math.PI * 2);
      g.fill();
      return volume(f, { luz: 0.16, sombra: 0, bordas: 0.16, contorno: 0.25 });
    }
    if (f.face === "pz") {
      // a carinha
      const ey = h * 0.38;
      for (const s of [-1, 1]) {
        g.fillStyle = olho;
        g.beginPath();
        g.arc(W / 2 + s * W * 0.2, ey, 0.014, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.85)";
        g.beginPath();
        g.arc(W / 2 + s * W * 0.2 - 0.004, ey - 0.005, 0.004, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = alfa(orelha, 0.55);
        g.beginPath();
        g.ellipse(W / 2 + s * W * 0.32, ey + 0.028, 0.018, 0.01, 0, 0, Math.PI * 2);
        g.fill();
      }
      // focinho claro com o narizinho e a boquinha em "w"
      g.fillStyle = clarear(cor, 0.45);
      g.beginPath();
      g.ellipse(W / 2, h * 0.6, W * 0.13, h * 0.17, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#3b2a26";
      g.beginPath();
      g.ellipse(W / 2, h * 0.53, 0.011, 0.007, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#3b2a26";
      g.lineWidth = Math.max(0.003, pxs(f, 1.5));
      g.beginPath();
      g.moveTo(W / 2 - 0.016, h * 0.62);
      g.quadraticCurveTo(W / 2 - 0.008, h * 0.68, W / 2, h * 0.6);
      g.quadraticCurveTo(W / 2 + 0.008, h * 0.68, W / 2 + 0.016, h * 0.62);
      g.stroke();
    }
    volume(f, { luz: 0.16, sombra: 0.22, bordas: 0.16, contorno: 0.28, base: cor });
  };
  return { partes, livres: [], pintar, rugosidade: 1, corBase: cor };
};

/* ———————————————————— SANDÁLIA PLATAFORMA ———————————————————— */

/** Sandália de plataforma de cortiça: tiras em X, tira dos dedos e tornozeleira com fivela. */
const plataforma: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const cortica = "#c79a62";
  const fivela = "#d4a72c";
  const L = m.pernaW + 0.09;
  const z = 0.04;
  const SOLA = 0.075;
  const pw = m.pernaW - 0.02;
  const tornozelo = { z0: z - L / 2 + 0.01, z1: 0.1, topo: alturaDoCalcado("plataforma") + 0.01 };
  const dedos = { z0: 0.08, z1: z + L / 2 - 0.006, topo: SOLA + 0.046 };
  const dT = tornozelo.z1 - tornozelo.z0;
  const dD = dedos.z1 - dedos.z0;
  const partes: ParteMolde[] = [];
  const pele: BlocoPele[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [SW + 0.006, SOLA, L], 0, z, 0.014));
    pele.push(
      peleDoPe(
        m,
        e,
        l,
        [pw, tornozelo.topo - SOLA + 0.004, dT],
        SOLA - 0.004,
        tornozelo.z0 + dT / 2,
      ),
    );
    pele.push(
      peleDoPe(m, e, l, [pw, dedos.topo - SOLA + 0.004, dD], SOLA - 0.004, dedos.z0 + dD / 2, 0.02),
    );
    partes.push(
      blocoDoPe(
        m,
        e,
        "tiraDedos",
        l,
        [pw + 0.012, dedos.topo - SOLA + 0.006, 0.04],
        SOLA - 0.004,
        dedos.z1 - 0.06,
        0.008,
      ),
    );
    for (const s of [-1, 1] as const) {
      partes.push({
        nome: `tira${s < 0 ? "A" : "B"}${l < 0 ? "D" : "E"}`,
        tam: [0.024, 0.012, 0.14],
        raio: 0.005,
        lado: l,
        matriz: em(e.perna(l), mat([0, -m.pernaH + dedos.topo + 0.004, 0.085], [0, s * 0.55, 0])),
      });
    }
    partes.push(
      blocoDoPe(
        m,
        e,
        "tornozeleira",
        l,
        [pw + 0.014, 0.026, dT + 0.014],
        tornozelo.topo - 0.055,
        tornozelo.z0 + dT / 2,
        0.01,
        {
          ocultas: ["py", "ny"] as Face[],
        },
      ),
    );
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola")) {
      if (f.face === "ny") return pegada(f, "#3b2f26", "#52443a", "tenis");
      if (f.face === "py") {
        base(f, cor);
        g.fillStyle = "rgba(0,0,0,0.15)";
        g.beginPath();
        g.ellipse(W / 2, h * 0.45, W * 0.3, h * 0.38, 0, 0, Math.PI * 2);
        g.fill();
        return volume(f, { luz: 0.06, sombra: 0, bordas: 0.12, contorno: 0.3 });
      }
      // cortiça: pintinhas claras e escuras; forro na cor da sandália em cima e borracha embaixo
      base(f, cortica);
      if (f.qualidade === "alta") {
        for (let i = 0; i < (W * h) / 0.00004; i++) {
          const x = ((i * 0.6180339) % 1) * W;
          const y = ((i * 0.7548776) % 1) * h;
          g.fillStyle = i % 3 ? "rgba(90,55,25,0.35)" : "rgba(255,240,210,0.4)";
          g.fillRect(x, y, pxs(f, 2), pxs(f, 1.5));
        }
      }
      g.fillStyle = cor;
      g.fillRect(-0.1, -0.1, W + 0.2, 0.112);
      g.fillStyle = "#3b2f26";
      g.fillRect(-0.1, h - 0.012, W + 0.2, 0.1);
      return volume(f, { luz: 0.1, sombra: 0.22, bordas: 0.06, contorno: 0.3 });
    }
    base(f, cor);
    pano(f, "couro", 0.6);
    if (f.parte.startsWith("tornozeleira") && f.face === faceExterna(f.lado)) {
      g.strokeStyle = fivela;
      g.lineWidth = 0.004;
      g.strokeRect(W * 0.55, -0.002, 0.022, h + 0.004);
      g.fillStyle = fivela;
      g.fillRect(W * 0.55 + 0.009, h / 2 - 0.002, 0.014, 0.004);
    }
    volume(f, { luz: 0.18, sombra: 0.2, bordas: 0.1, contorno: 0.3 });
  };
  return { partes, livres: [], pele, pintar, rugosidade: 0.5, corBase: cor };
};

/* ———————————————————— MOCASSIM ———————————————————— */

/** Mocassim: a costura em U franzida no peito do pé, a tira com a fenda (penny) e o brilho. */
const mocassim: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const sola = piso(escurecer(cor, 0.45));
  const linha = clarear(cor, 0.25);
  const H = alturaDoCalcado("mocassim") + 0.008;
  const L = m.pernaW + 0.09;
  const z = 0.04;
  const partes: ParteMolde[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [SW, 0.018, L], 0, z, 0.008));
    partes.push(blocoDoPe(m, e, "pe", l, [UW, H - 0.014, L - 0.01], 0.014, z, 0.042));
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola")) {
      if (f.face === "ny") return pegada(f, sola, "#9a6a3c", "couro");
      base(f, sola);
      costura(f, reta(-0.1, h * 0.45, W + 0.1, h * 0.45), contraste(sola), {
        traco: 0.004,
        espessura: 0.002,
      });
      return volume(f, { luz: 0.12, sombra: 0.2, bordas: 0.06, contorno: 0.3 });
    }
    base(f, cor);
    pano(f, "couro", 0.7);
    if (f.face === "ny") return escurecerTudo(f, 0.4, cor);
    if (f.face === "py") {
      // o avental em U (bico embaixo da face) com a costura franzida
      const u = curvaPts(W * 0.18, h * 0.42, W * 0.5, h * 1.08, W * 0.82, h * 0.42, 18);
      g.strokeStyle = "rgba(0,0,0,0.35)";
      g.lineWidth = 0.008;
      g.beginPath();
      u.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
      g.strokeStyle = linha;
      g.lineWidth = Math.max(0.0025, pxs(f, 1.5));
      for (const [x, y] of u) {
        g.beginPath();
        g.moveTo(x, y - 0.006);
        g.lineTo(x, y + 0.006);
        g.stroke();
      }
      // a tira com a fenda
      g.fillStyle = escurecer(cor, 0.15);
      g.fillRect(W * 0.16, h * 0.3, W * 0.68, 0.028);
      g.fillStyle = piso(escurecer(cor, 0.55));
      g.beginPath();
      g.ellipse(W / 2, h * 0.3 + 0.014, 0.022, 0.006, 0, 0, Math.PI * 2);
      g.fill();
      oclusao(f, W * 0.16, h * 0.3 + 0.028, W * 0.68, 0.01, "cima", 0.3);
      brilho(f, W * 0.5, h * 0.75, W * 0.24, h * 0.1, 0.45);
      oclusao(f, -0.1, -0.1, W + 0.2, h * 0.2, "cima", 0.35);
      return volume(f, { luz: 0.18, sombra: 0, bordas: 0.12 });
    }
    if (f.face === "pz") brilho(f, W * 0.5, h * 0.45, W * 0.32, h * 0.25, 0.4);
    else if (ehLado(f)) brilho(f, W * 0.5, h * 0.5, W * 0.4, h * 0.15, 0.3);
    costura(f, reta(-0.1, h - 0.01, W + 0.1, h - 0.01), linha, { traco: 0.004, espessura: 0.0022 });
    volume(f, { luz: 0.18, sombra: 0.22, bordas: 0.1, contorno: 0.3 });
  };
  return { partes, livres: [], pintar, rugosidade: 0.4, corBase: cor };
};

/* ———————————————————— BOTA COUNTRY ———————————————————— */

/**
 * Bota de cowboy (country/rodeio): bico FINO (bloco afunilado deitado para
 * a frente: estreita e baixa até a ponta), salto carrapeta, cano com o
 * bordado na 2ª cor e as cavas em V na frente e atrás.
 */
const botaCowboy: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const bordado = detalhe(c, cor);
  const sola = piso(escurecer(cor, 0.5));
  const H = alturaDoCalcado("botaCowboy", m) + 0.008;
  const L = m.pernaW + 0.12;
  const z = 0.05;
  const SALTO = 0.075;
  const TS = 0.025; // sola da frente
  const ponta = (
    nome: string,
    l: 1 | -1,
    tam: [number, number, number],
    af: number,
    yc: number,
    z0: number,
    z1: number,
  ): ParteMolde => ({
    nome: nomeLado(nome, l),
    // deitado: o "alto" do bloco aponta para a frente (+z) e afunila até a ponta
    tam: [tam[0], z1 - z0, tam[2]],
    raio: 0.012,
    lado: l,
    afunilar: af,
    matriz: em(e.perna(l), mat([0, -m.pernaH + yc, (z0 + z1) / 2], [Math.PI / 2, 0, 0])),
  });
  const partes: ParteMolde[] = [];
  const zFrente = z + L / 2;
  const zTras = z - L / 2;
  for (const l of LADOS) {
    partes.push(
      blocoDoPe(m, e, "salto", l, [SW - 0.006, 0.05, SALTO], 0, zTras + SALTO / 2, 0.006),
    );
    partes.push(ponta("sola", l, [SW, 0, TS], 0.45, TS / 2, zTras + SALTO + 0.004, zFrente));
    // o pé vai do calcanhar até a frente da calça (o cano não fica com o fundo à mostra)
    const compPe = (m.pernaW + 0.02) / 2 + 0.016 - zTras;
    partes.push(
      blocoDoPe(m, e, "pe", l, [UW + 0.004, 0.085, compPe], TS, zTras + compPe / 2, 0.036),
    );
    const hb = 0.075;
    partes.push(
      ponta("bico", l, [UW + 0.004, 0, hb], 0.5, TS + (hb * 0.5) / 2, z - 0.02, zFrente - 0.004),
    );
    partes.push(blocoDoPe(m, e, "cano", l, [UW + 0.01, H - 0.1, m.pernaW + 0.032], 0.1, 0, 0.04));
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola") || f.parte.startsWith("salto")) {
      // a sola deitada: a face de baixo é a "pz" do bloco (sentado, aparece)
      const embaixo = f.parte.startsWith("sola") ? f.face === "pz" : f.face === "ny";
      if (embaixo) return pegada(f, sola, "#9a6a3c", "couro", { soFrente: true });
      base(f, sola);
      pano(f, "couro", 0.6);
      if (f.parte.startsWith("salto") && f.face !== "py")
        for (let y = h * 0.25; y < h; y += h * 0.25) {
          g.fillStyle = "rgba(0,0,0,0.25)";
          g.fillRect(-0.1, y, W + 0.2, Math.max(0.003, pxs(f, 1.5)));
        }
      return volume(f, { luz: 0.12, sombra: 0.2, bordas: 0.06, contorno: 0.3 });
    }
    base(f, cor);
    pano(f, "couro");
    if (f.parte.startsWith("bico")) {
      // em cima (a face "nz" do bloco deitado): costura do bico até a ponta
      if (f.face === "nz") {
        costura(f, reta(W / 2, -0.01, W / 2, h * 0.85), bordado, { traco: 0.005 });
        costura(f, curvaPts(W * 0.2, h, W * 0.5, h * 0.55, W * 0.8, h), bordado, { traco: 0.005 });
        brilho(f, W * 0.5, h * 0.35, W * 0.25, h * 0.2, 0.35);
      } else if (f.face === "py") brilho(f, W * 0.5, h * 0.5, W * 0.3, h * 0.3, 0.3);
      return volume(f, { luz: 0.16, sombra: 0.2, bordas: 0.12, contorno: 0.3 });
    }
    if (f.face === "ny") return escurecerTudo(f, 0.45, cor);
    if (f.parte.startsWith("cano")) {
      if (f.face === "py") {
        escurecerTudo(f, 0.4, cor);
        return;
      }
      if (f.face === "pz" || f.face === "nz") {
        // a cava em V: o forro aparecendo acima dela
        g.fillStyle = piso(escurecer(cor, 0.5));
        poligono(g, [
          [-0.1, -0.1],
          [W + 0.1, -0.1],
          [W + 0.1, 0.004],
          [W / 2, 0.075],
          [-0.1, 0.004],
        ]);
        g.fill();
        costura(
          f,
          [
            [0, 0.01],
            [W / 2, 0.08],
            [W, 0.01],
          ],
          bordado,
          { traco: 0.005 },
        );
      } else {
        // as alças de puxar e o bordado em arabescos
        g.fillStyle = piso(escurecer(cor, 0.3));
        g.beginPath();
        g.roundRect(W * 0.38, -0.02, W * 0.24, 0.06, 0.01);
        g.fill();
        g.fillStyle = piso(escurecer(cor, 0.6));
        g.beginPath();
        g.roundRect(W * 0.44, 0.006, W * 0.12, 0.02, 0.006);
        g.fill();
        const cx = W / 2;
        const meio = h * 0.55;
        g.strokeStyle = bordado;
        g.lineWidth = Math.max(0.0035, pxs(f, 2));
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(cx, h * 0.12);
          g.bezierCurveTo(
            cx + s * W * 0.35,
            h * 0.25,
            cx + s * W * 0.05,
            meio,
            cx + s * W * 0.3,
            meio + h * 0.1,
          );
          g.bezierCurveTo(
            cx + s * W * 0.42,
            meio + h * 0.18,
            cx + s * W * 0.1,
            h * 0.92,
            cx,
            h * 0.95,
          );
          g.stroke();
          g.beginPath();
          g.arc(cx + s * W * 0.22, h * 0.3, 0.012, 0, Math.PI * 1.5);
          g.stroke();
        }
        g.fillStyle = bordado;
        g.beginPath();
        g.arc(cx, meio, 0.008, 0, Math.PI * 2);
        g.fill();
      }
      dobra(f, [W * 0.1, h - 0.05, W * 0.5, h - 0.065, W * 0.9, h - 0.045], 0.008, 0.2);
      return volume(f, { luz: 0.16, sombra: 0.2, bordas: 0.14, contorno: 0.3, base: cor });
    }
    // —— o pé ——
    if (f.face === "py") {
      brilho(f, W * 0.5, h * 0.8, W * 0.3, h * 0.12, 0.35);
      oclusao(f, -0.1, -0.1, W + 0.2, h * 0.3, "cima", 0.35);
      return volume(f, { luz: 0.16, sombra: 0, bordas: 0.12 });
    }
    costura(f, reta(-0.1, h - 0.01, W + 0.1, h - 0.01), bordado, { traco: 0.005 });
    volume(f, { luz: 0.16, sombra: 0.22, bordas: 0.1, contorno: 0.3 });
  };
  return { partes, livres: [], pintar, rugosidade: 0.45, corBase: cor };
};

/* ———————————————————— CHINELO COM MEIA ———————————————————— */

/** O clássico chinelo de dedo com meia esportiva (listras no alto na cor do chinelo). */
const chineloMeia: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const w = m.pernaW;
  const cor = piso(c.corSapato);
  const meia =
    contrasta(c.corRoupa2, cor) && luminancia(c.corRoupa2) > 0.35 ? c.corRoupa2 : "#f4f4f2";
  const listra = contrasta(cor, meia) ? cor : "#2563eb";
  const H = alturaDoCalcado("chineloMeia") + 0.008;
  const TOPO_PE = 0.088;
  const partes: ParteMolde[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [w + 0.02, 0.03, w + 0.1], 0, 0.04, 0.012));
    partes.push(
      blocoDoPe(m, e, "meiaPe", l, [w - 0.006, TOPO_PE - 0.028, w + 0.07], 0.028, 0.035, 0.03),
    );
    partes.push(blocoDoPe(m, e, "meiaCano", l, [w + 0.004, H - 0.06, w + 0.024], 0.06, 0, 0.045));
    // a tira em V fica na frente do pé (atrás dela o cano da meia cobre tudo):
    // do dedão até os lados, deitada em cima da meia
    const zPonta = 0.035 + (w + 0.07) / 2 - 0.012;
    const zLado = (w + 0.024) / 2 - 0.012;
    const xLado = Math.min(0.1, w * 0.38);
    const ang = Math.atan2(xLado, zPonta - zLado);
    const comp = Math.hypot(xLado, zPonta - zLado) + 0.02;
    for (const s of [-1, 1] as const) {
      partes.push({
        nome: `tira${s < 0 ? "A" : "B"}${l < 0 ? "D" : "E"}`,
        tam: [0.022, 0.012, comp],
        raio: 0.005,
        lado: l,
        matriz: em(
          e.perna(l),
          mat(
            [(s * xLado) / 2, -m.pernaH + TOPO_PE + 0.003, (zPonta + zLado) / 2],
            [0, -s * ang, 0],
          ),
        ),
      });
    }
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("tira")) {
      base(f, cor);
      return volume(f, { luz: 0.2, sombra: 0.25, bordas: 0.1, contorno: 0.3 });
    }
    if (f.parte.startsWith("sola")) {
      if (f.face === "ny") return pegada(f, "#cbd5e1", "#b8c2cf", "tenis");
      base(f, f.face === "py" ? "#e2e8f0" : cor);
      g.fillStyle = "rgba(0,0,0,0.15)";
      g.fillRect(-0.1, h * 0.5, W + 0.2, Math.max(0.003, pxs(f, 1.5)));
      return volume(f, { luz: 0.1, sombra: 0.2, bordas: 0.06, contorno: 0.3 });
    }
    base(f, meia);
    pano(f, "ruido");
    if (f.parte.startsWith("meiaPe")) {
      if (f.face === "py") {
        // o vinco do dedão onde passa a tira
        g.strokeStyle = "rgba(0,0,0,0.2)";
        g.lineWidth = Math.max(0.003, pxs(f, 2));
        g.beginPath();
        g.moveTo(W * 0.5, h * 0.82);
        g.lineTo(W * 0.5, h);
        g.stroke();
      }
      return volume(f, { luz: 0.1, sombra: 0.2, bordas: 0.14, contorno: 0.22 });
    }
    if (f.face === "py") return escurecerTudo(f, 0.25, meia);
    // canelado e as duas listras perto da boca
    g.fillStyle = "rgba(0,0,0,0.07)";
    for (let x = -f.faixa % 0.012; x < W; x += 0.012) g.fillRect(x, 0, pxs(f, 2), h);
    canelado(f, -0.1, -0.1, W + 0.2, 0.12, meia);
    g.fillStyle = listra;
    g.fillRect(-0.1, 0.03, W + 0.2, 0.014);
    g.fillRect(-0.1, 0.056, W + 0.2, 0.014);
    dobra(f, [W * 0.1, h - 0.03, W * 0.5, h - 0.045, W * 0.9, h - 0.025], 0.008, 0.18);
    volume(f, { luz: 0.1, sombra: 0.18, bordas: 0.12 });
  };
  return { partes, livres: [], pintar, corBase: cor };
};

export const PECAS_PES_EXTRAS: Record<SapatoExtra, CriarPeca> = {
  galocha,
  botinaEpi,
  coturno,
  tenisCano,
  tenisChunky,
  babuche,
  chuteira,
  patins,
  pantufa,
  plataforma,
  mocassim,
  botaCowboy,
  chineloMeia,
};
