import type { AvatarConfig } from "@/lib/avatar-3d";
import type { Medidas } from "@/components/rv/medidas";
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
  type Esqueleto,
} from "./peca";
import {
  alfa,
  base,
  clarear,
  contrasta,
  corDaLinha,
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
  pxs,
  volume,
  ziper,
} from "./pincel";
import { PECAS_PES_EXTRAS } from "./pecas-pes-extras";

/**
 * Os CALÇADOS. Cada pé tem o cabedal (o "peito", que entra na boca da
 * calça), o bico na frente (mais baixo que o peito, como um calçado de
 * verdade) e a sola por baixo — nada coplanar, nem sentado.
 *
 * A sola tem só 3–4 mm de sobra em volta do cabedal e os dois pés ficam com
 * um vão entre si: antes a sola larga dos dois pés se juntava numa placa
 * única (o avatar "de pé num pedestal").
 *
 * Sentado (a perna gira −90° no quadril), a BASE da sola fica de frente para
 * a câmera: por isso ela é pintada como a sola de verdade (`pegada`), com
 * bico redondo, arco recuado, salto e desenho em contraste — e não como um
 * retângulo liso que lia como "radiador" ou caixa preta no colo.
 */

type SapatoNovo = "tenisCano" | "coturno";
export type TipoSapato = AvatarConfig["sapato"] | SapatoNovo;

/** Um bloco do pé dentro do grupo da perna: y a partir do chão, z para a frente. */
export function blocoDoPe(
  m: Medidas,
  e: Esqueleto,
  base_: string,
  l: 1 | -1,
  tam: [number, number, number],
  y0: number,
  z: number,
  raio: number,
  extra: Partial<ParteMolde> = {},
): ParteMolde {
  return {
    nome: nomeLado(base_, l),
    tam,
    raio,
    lado: l,
    matriz: em(e.perna(l), mat([0, -m.pernaH + y0 + tam[1] / 2, z])),
    ...extra,
  };
}

/**
 * Larguras: o cabedal 1 mm mais largo que a perna da calça de cada lado
 * (fecha a boca dela, que não tem fundo) e a sola 3 mm além do cabedal. Com
 * os pés em ±(pernaW/2 + 0,005), sobra um vão de 2 mm entre as solas.
 */
export const larguras = (m: Medidas) => {
  const cabedal = m.pernaW + 0.002;
  return { cabedal, sola: cabedal + 0.006 };
};

/** Cor de desenho que aparece em cima da `cor` (claro no escuro, escuro no claro), ±25%. */
export const contraste = (cor: string) =>
  luminancia(cor) < 0.32 ? clarear(cor, 0.28) : escurecer(cor, 0.25);

export type Desenho = "tenis" | "tratorado" | "couro";

/**
 * A base da sola vista de baixo (face −y; o bico fica em CIMA da face):
 * contorno de pegada — bico redondo, arco estreito e recuado, salto — com a
 * borda num tom e o solado em outro. `soFrente`: a sola do sapato social,
 * que para no arco (o salto é outro bloco).
 */
export function pegada(
  f: CtxFace,
  borda: string,
  solado: string,
  desenho: Desenho,
  o: { soFrente?: boolean; arco?: string } = {},
) {
  const { g, w, h } = f;
  base(f, borda);
  const m = Math.max(0.006, w * 0.05);
  const linha = contraste(solado);
  const frente = o.soFrente ? h - m : h * 0.56;
  // —— o bico e a planta (frente) ——
  g.save();
  g.fillStyle = solado;
  g.beginPath();
  g.moveTo(m, frente);
  g.lineTo(m, h * 0.2);
  g.bezierCurveTo(m, m * 0.6, w - m, m * 0.6, w - m, h * 0.2);
  g.lineTo(w - m, frente);
  g.closePath();
  g.fill();
  g.clip();
  desenharSolado(f, desenho, linha, 0, frente);
  g.restore();
  if (!o.soFrente) {
    // —— o arco (recuado, na cor da borda escurecida) e o salto ——
    g.fillStyle = o.arco ?? escurecer(borda, 0.18);
    g.beginPath();
    g.moveTo(w * 0.42, h * 0.58);
    g.quadraticCurveTo(w * 0.36, h * 0.66, w * 0.4, h * 0.73);
    g.lineTo(w - m, h * 0.73);
    g.lineTo(w - m, h * 0.58);
    g.closePath();
    g.fill();
    oclusao(f, w * 0.38, h * 0.57, w * 0.6, h * 0.04, "cima", 0.3);
    g.save();
    g.fillStyle = solado;
    g.beginPath();
    g.roundRect(m, h * 0.75, w - 2 * m, h * 0.25 - m, Math.min(w, h) * 0.12);
    g.fill();
    g.clip();
    desenharSolado(f, desenho, linha, h * 0.75, h);
    g.restore();
    oclusao(f, m, h * 0.75, w - 2 * m, h * 0.03, "cima", 0.25);
  }
  oclusao(f, m, frente - 0.012, w - 2 * m, 0.012, "baixo", 0.25);
  volume(f, { luz: 0.04, sombra: 0.06, bordas: 0.06, contorno: 0.35 });
}

/** O desenho de dentro do solado, entre y0 e y1. */
function desenharSolado(f: CtxFace, d: Desenho, linha: string, y0: number, y1: number) {
  const { g, w } = f;
  const fino = Math.max(0.004, pxs(f, 2));
  g.strokeStyle = linha;
  g.fillStyle = linha;
  if (d === "tenis") {
    // zigue-zague (espinha de peixe) do tênis
    g.lineWidth = fino;
    const passo = 0.022;
    for (let y = y0 + 0.012; y < y1; y += passo) {
      g.beginPath();
      for (let x = -0.01, i = 0; x < w + 0.02; x += 0.024, i++) {
        if (i) g.lineTo(x, y + (i % 2 ? 0.008 : 0));
        else g.moveTo(x, y);
      }
      g.stroke();
    }
  } else if (d === "tratorado") {
    // cravos grandes da botina, alternados, até a borda
    const passo = 0.034;
    for (let y = y0 + 0.008, j = 0; y < y1; y += passo, j++) {
      for (let x = j % 2 ? -0.012 : 0.008; x < w; x += 0.05) {
        g.beginPath();
        g.roundRect(x, y, 0.032, passo * 0.55, 0.004);
        g.fill();
      }
    }
  } else {
    // couro: lixa de uso no meio e o pesponto em volta
    g.fillStyle = alfa(linha, 0.25);
    g.beginPath();
    g.ellipse(w / 2, y0 + (y1 - y0) * 0.45, w * 0.28, (y1 - y0) * 0.28, 0, 0, Math.PI * 2);
    g.fill();
    costura(
      f,
      [
        [0.016, y1 - 0.004],
        [0.016, 0.05],
        ...curvaPts(0.016, 0.05, w / 2, -0.02, w - 0.016, 0.05),
        [w - 0.016, y1 - 0.004],
      ],
      linha,
      { traco: 0.005, espessura: 0.0025 },
    );
  }
}

/** Cadarço em X: `n` cruzamentos entre y0 e y1, com ilhoses dos dois lados. */
export function cadarcos(
  f: CtxFace,
  cor: string,
  fundo: string,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  n: number,
) {
  const { g } = f;
  const passo = (y1 - y0) / n;
  g.save();
  // a lingueta por baixo do cadarço
  g.fillStyle = fundo;
  g.fillRect(x0 - 0.008, y0 - 0.012, x1 - x0 + 0.016, y1 - y0 + 0.024);
  oclusao(f, x0 - 0.008, y0 - 0.012, 0.008, y1 - y0 + 0.024, "esq", 0.3);
  oclusao(f, x1, y0 - 0.012, 0.008, y1 - y0 + 0.024, "dir", 0.3);
  for (let i = 0; i < n; i++) {
    const ya = y0 + i * passo;
    const yb = ya + passo;
    for (const [a, b] of [
      [x0, x1],
      [x1, x0],
    ] as const) {
      g.strokeStyle = "rgba(0,0,0,0.3)";
      g.lineWidth = 0.011;
      g.beginPath();
      g.moveTo(a, ya + 0.002);
      g.lineTo(b, yb + 0.002);
      g.stroke();
      g.strokeStyle = cor;
      g.lineWidth = 0.008;
      g.beginPath();
      g.moveTo(a, ya);
      g.lineTo(b, yb);
      g.stroke();
    }
  }
  for (let i = 0; i <= n; i++) {
    for (const x of [x0, x1]) ilhos(f, x, y0 + i * passo, 0.0055);
  }
  g.restore();
}

/** O brilho do couro polido: mancha clara oval. */
export function brilho(f: CtxFace, x: number, y: number, rx: number, ry: number, a: number) {
  const { g } = f;
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, `rgba(255,255,255,${a})`);
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(-rx, -rx, 2 * rx, 2 * rx);
  g.restore();
}

/* ———————————————————— TÊNIS ———————————————————— */

const tenis: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const borracha = "#f3f1ec";
  // Cadarço na 2ª cor; se some no cabedal, um cinza que contrasta.
  const cadarco = contrasta(c.corRoupa2, cor, 0.12)
    ? c.corRoupa2
    : luminancia(cor) > 0.5
      ? "#475569"
      : "#e5e7eb";
  // Listra da sola: a cor do tênis (ou cinza, se o tênis já é branco).
  const listra = contrasta(cor, borracha, 0.15) ? cor : "#9ca3af";
  const linha = corDaLinha(cor);
  const H = alturaDoCalcado("tenis") + 0.008;
  const L = m.pernaW + 0.09;
  const z = 0.04;
  const SOLA = 0.04;
  // O peito vai do calcanhar até a frente da calça (fecha a boca dela); o bico,
  // mais baixo, sai 7 cm para a frente.
  const frenteDaCalca = (m.pernaW + 0.02) / 2 + 0.006;
  const tras = z - L / 2 + 0.004;
  const compPeito = frenteDaCalca - tras;
  const compBico = L * 0.42;
  const partes: ParteMolde[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [SW, SOLA, L], 0, z, 0.016));
    partes.push(
      blocoDoPe(m, e, "pe", l, [UW, H - 0.03, compPeito], 0.03, tras + compPeito / 2, 0.045),
    );
    partes.push(
      blocoDoPe(
        m,
        e,
        "bico",
        l,
        [UW - 0.008, 0.068, compBico],
        0.03,
        z + L / 2 - 0.004 - compBico / 2,
        0.032,
      ),
    );
  }

  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola")) {
      if (f.face === "ny") return pegada(f, borracha, "#d4d0c7", "tenis", { arco: listra });
      base(f, borracha);
      if (f.face === "py") return volume(f, { luz: 0.1, sombra: 0, bordas: 0 });
      // listra colorida + friso, e o "bico" da borracha
      g.fillStyle = listra;
      g.fillRect(-0.1, h * 0.38, W + 0.2, h * 0.16);
      g.fillStyle = "rgba(0,0,0,0.12)";
      g.fillRect(-0.1, h * 0.72, W + 0.2, Math.max(0.003, pxs(f, 1.5)));
      oclusao(f, -0.1, -0.1, W + 0.2, 0.02, "cima", 0.3);
      return volume(f, { luz: 0.1, sombra: 0.25, bordas: 0.05, contorno: 0.3 });
    }
    base(f, cor);
    pano(f, "ruido", 0.5);
    if (f.face === "ny") return escurecerTudo(f, 0.4, cor);
    if (f.parte.startsWith("bico")) {
      if (f.face === "py") {
        // em cima do bico: o fim do cadarço (2 X) e a biqueira de borracha na ponta
        cadarcos(f, cadarco, escurecer(cor, 0.12), W * 0.33, W * 0.67, -0.01, h * 0.42, 2);
        g.fillStyle = borracha;
        g.beginPath();
        g.moveTo(-0.1, h + 0.1);
        g.lineTo(-0.1, h * 0.78);
        g.quadraticCurveTo(W * 0.5, h * 0.6, W + 0.1, h * 0.78);
        g.lineTo(W + 0.1, h + 0.1);
        g.closePath();
        g.fill();
        g.strokeStyle = "rgba(0,0,0,0.2)";
        g.lineWidth = Math.max(0.003, pxs(f, 1.5));
        g.stroke();
        return volume(f, { luz: 0.16, sombra: 0, bordas: 0.12, contorno: 0.25 });
      }
      if (f.face === "pz") {
        // a ponta: biqueira de borracha com os furinhos
        g.fillStyle = borracha;
        g.fillRect(-0.1, h * 0.35, W + 0.2, h);
        g.strokeStyle = "rgba(0,0,0,0.2)";
        g.lineWidth = Math.max(0.003, pxs(f, 1.5));
        g.beginPath();
        g.moveTo(-0.1, h * 0.35);
        g.lineTo(W + 0.1, h * 0.35);
        g.stroke();
        g.fillStyle = "rgba(0,0,0,0.25)";
        for (let i = 0; i < 5; i++) {
          g.beginPath();
          g.arc(W * (0.3 + i * 0.1), h * 0.62, 0.0028, 0, Math.PI * 2);
          g.fill();
        }
        return volume(f, { luz: 0.12, sombra: 0.16, bordas: 0.1, contorno: 0.3 });
      }
      if (f.face === "nz") return escurecerTudo(f, 0.3, cor);
      // laterais do bico: costura da biqueira
      costura(f, curvaPts(W * 0.3, h, W * 0.55, h * 0.3, W + 0.01, h * 0.25), linha, {
        traco: 0.005,
      });
      return volume(f, { luz: 0.14, sombra: 0.16, bordas: 0.08, contorno: 0.3 });
    }
    // —— o peito (cabedal de trás) ——
    // a costura que prende o cabedal na sola
    costura(
      f,
      [
        [-0.1, h - 0.008],
        [W + 0.1, h - 0.008],
      ],
      linha,
      { traco: 0.006 },
    );
    if (f.face === "py") {
      // de cima (aparece no 3/4 alto): a língua e o começo do cadarço na frente
      cadarcos(f, cadarco, escurecer(cor, 0.12), W * 0.32, W * 0.68, h * 0.62, h - 0.012, 2);
      oclusao(f, -0.1, -0.1, W + 0.2, h * 0.5, "cima", 0.35);
      return volume(f, { luz: 0.12, sombra: 0, bordas: 0.12 });
    }
    if (f.face === "pz") {
      // o peito do pé (entre a barra da calça e o bico): a língua e o cadarço subindo
      cadarcos(f, cadarco, escurecer(cor, 0.12), W * 0.33, W * 0.67, 0.01, h * 0.62, 2);
      oclusao(f, -0.1, h * 0.6, W + 0.2, h * 0.4, "baixo", 0.3);
    } else if (f.face === "nz") {
      // calcanhar: reforço com puxador na 2ª cor
      g.fillStyle = escurecer(cor, 0.1);
      g.beginPath();
      g.roundRect(W * 0.18, h * 0.3, W * 0.64, h * 0.75, 0.02);
      g.fill();
      g.fillStyle = cadarco;
      g.beginPath();
      g.roundRect(W * 0.42, -0.02, W * 0.16, h * 0.5, 0.008);
      g.fill();
    } else {
      // lateral: faixa curva (genérica, sem marca), costura do calcanhar
      const fora = f.face === faceExterna(f.lado);
      g.strokeStyle = escurecer(cor, 0.3);
      g.lineWidth = 0.022;
      g.beginPath();
      g.moveTo(W * 0.12, h * 0.8);
      g.quadraticCurveTo(W * 0.5, h * 0.2, W * 0.95, h * 0.5);
      g.stroke();
      g.strokeStyle = fora ? cadarco : clarear(cor, 0.3);
      g.lineWidth = 0.012;
      g.stroke();
      costura(
        f,
        [
          [W * 0.7, 0.0],
          [W * 0.7, h - 0.02],
        ],
        linha,
        { traco: 0.005 },
      );
    }
    volume(f, { luz: 0.14, sombra: 0.16, bordas: 0.08, contorno: 0.3 });
  };
  return { partes, livres: [], pintar, rugosidade: 0.7, corBase: cor };
};

/* ———————————————————— SAPATO SOCIAL ———————————————————— */

const sapatoSocial: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  // Sola: escurecer(corSapato, 0,5), mas nunca abaixo do piso (R3 + critério 9).
  const sola = piso(escurecer(cor, 0.5));
  const H = alturaDoCalcado("social") + 0.008;
  const L = m.pernaW + 0.1;
  const z = 0.045;
  const SALTO = 0.075;
  const frenteDaCalca = (m.pernaW + 0.02) / 2 + 0.006;
  const tras = z - L / 2 + 0.004;
  const compPeito = frenteDaCalca - tras;
  const compBico = L * 0.46;
  const partes: ParteMolde[] = [];
  for (const l of LADOS) {
    // sola de couro da frente até o arco, erguida 12 mm (o salto é que apoia atrás)
    partes.push(
      blocoDoPe(
        m,
        e,
        "sola",
        l,
        [SW, 0.016, L - SALTO - 0.01],
        0.01,
        z + (SALTO + 0.01) / 2,
        0.008,
      ),
    );
    // salto: bloco separado, com vão no arco — aparece de perfil
    partes.push(
      blocoDoPe(m, e, "salto", l, [SW - 0.008, 0.03, SALTO], 0, z - L / 2 + SALTO / 2, 0.006),
    );
    partes.push(
      blocoDoPe(m, e, "pe", l, [UW, H - 0.024, compPeito], 0.024, tras + compPeito / 2, 0.05),
    );
    // bico fino: mais estreito e mais baixo, alongado para a frente
    partes.push(
      blocoDoPe(
        m,
        e,
        "bico",
        l,
        [UW - 0.05, 0.05, compBico],
        0.024,
        z + L / 2 - 0.006 - compBico / 2,
        0.024,
      ),
    );
  }
  const linha = clarear(cor, 0.22);
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola") || f.parte.startsWith("salto")) {
      if (f.face === "ny") {
        // embaixo: couro cru na sola, borracha escura no salto (o que se vê sentado)
        if (f.parte.startsWith("salto"))
          return pegada(f, sola, piso(escurecer(sola, 0.2)), "couro", { soFrente: true });
        return pegada(f, sola, "#9a6a3c", "couro", { soFrente: true });
      }
      base(f, sola);
      pano(f, "couro", 0.6);
      if (f.face !== "py")
        costura(
          f,
          [
            [-0.1, h * 0.4],
            [W + 0.1, h * 0.4],
          ],
          contraste(sola),
          { traco: 0.004, espessura: 0.002 },
        );
      return volume(f, { luz: 0.12, sombra: 0.2, bordas: 0.06, contorno: 0.3 });
    }
    base(f, cor);
    pano(f, "couro", 0.7);
    if (f.face === "ny") return escurecerTudo(f, 0.4, cor);
    if (f.parte.startsWith("bico")) {
      if (f.face === "py") {
        // a biqueira com pesponto em U e o brilho forte do couro polido
        costura(f, curvaPts(W * 0.12, h * 0.15, W * 0.5, h * 0.55, W * 0.88, h * 0.15), linha, {
          traco: 0.004,
          espessura: 0.0022,
        });
        brilho(f, W * 0.5, h * 0.7, W * 0.32, h * 0.2, 0.5);
        brilho(f, W * 0.42, h * 0.66, W * 0.08, h * 0.06, 0.6);
        return volume(f, { luz: 0.2, sombra: 0, bordas: 0.12, contorno: 0.25 });
      }
      if (f.face === "pz") {
        brilho(f, W * 0.5, h * 0.4, W * 0.35, h * 0.3, 0.45);
        return volume(f, { luz: 0.18, sombra: 0.22, bordas: 0.1, contorno: 0.3 });
      }
      if (f.face === "nz") return escurecerTudo(f, 0.3, cor);
      brilho(f, W * 0.55, h * 0.4, W * 0.35, h * 0.15, 0.3);
      return volume(f, { luz: 0.18, sombra: 0.22, bordas: 0.1, contorno: 0.3 });
    }
    // —— o peito (gáspea) ——
    if (f.face === "py") {
      // de cima: os 3 passadores do cadarço (oxford) na frente
      const y0 = h * 0.6;
      g.fillStyle = escurecer(cor, 0.12);
      g.beginPath();
      g.moveTo(W * 0.34, y0);
      g.lineTo(W * 0.66, y0);
      g.lineTo(W * 0.6, h);
      g.lineTo(W * 0.4, h);
      g.closePath();
      g.fill();
      for (let i = 0; i < 3; i++) {
        const y = y0 + 0.012 + i * 0.014;
        g.strokeStyle = contraste(cor);
        g.lineWidth = 0.005;
        g.beginPath();
        g.moveTo(W * 0.38, y);
        g.lineTo(W * 0.62, y);
        g.stroke();
      }
      oclusao(f, -0.1, -0.1, W + 0.2, h * 0.5, "cima", 0.4);
      return volume(f, { luz: 0.2, sombra: 0, bordas: 0.1 });
    }
    if (f.face === "pz") {
      // o peito do pé à vista entre a calça e o bico: a gáspea com o cadarço
      g.fillStyle = escurecer(cor, 0.12);
      g.fillRect(W * 0.34, -0.1, W * 0.32, h + 0.1);
      for (let i = 0; i < 3; i++) {
        const y = 0.012 + i * 0.016;
        g.strokeStyle = contraste(cor);
        g.lineWidth = 0.005;
        g.beginPath();
        g.moveTo(W * 0.37, y);
        g.lineTo(W * 0.63, y);
        g.stroke();
      }
      costura(f, curvaPts(W * 0.2, h * 0.9, W * 0.5, h * 0.4, W * 0.8, h * 0.9), linha, {
        traco: 0.004,
        espessura: 0.0022,
      });
      brilho(f, W * 0.5, h * 0.75, W * 0.3, h * 0.15, 0.3);
    } else if (f.face === "nz") {
      // contraforte do calcanhar
      costura(f, curvaPts(W * 0.15, h * 0.2, W * 0.5, h * 0.5, W * 0.85, h * 0.2), linha, {
        traco: 0.004,
        espessura: 0.0022,
      });
      brilho(f, W * 0.5, h * 0.6, W * 0.25, h * 0.15, 0.3);
    } else {
      // lateral: a costura da gáspea e o brilho alongado
      costura(f, curvaPts(W * 0.6, 0.0, W * 0.55, h * 0.55, W * 0.98, h * 0.6), linha, {
        traco: 0.004,
        espessura: 0.0022,
      });
      brilho(f, W * 0.5, h * 0.5, W * 0.4, h * 0.12, 0.3);
    }
    volume(f, { luz: 0.18, sombra: 0.22, bordas: 0.1, contorno: 0.3 });
  };
  return { partes, livres: [], pintar, rugosidade: 0.35, corBase: cor };
};

/* ———————————————————— BOTINA ———————————————————— */

const bota: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  // Sola de borracha: escurecer(corSapato, 0,5) no piso, com o desenho em contraste.
  const sola = piso(escurecer(cor, 0.5));
  const linha = clarear(cor, 0.35);
  const cano = alturaDoCalcado("bota") + 0.008;
  const cadarco = luminancia(cor) > 0.45 ? "#3f2a1d" : "#d6c7a1";
  const L = m.pernaW + 0.08;
  const z = 0.035;
  const SOLA = 0.042;
  const partes: ParteMolde[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [SW + 0.004, SOLA, L], 0, z, 0.014));
    // o pé e o cano na MESMA largura: leem como uma bota só, não duas almofadas
    partes.push(blocoDoPe(m, e, "pe", l, [UW + 0.004, 0.072, L - 0.008], 0.034, z, 0.036));
    partes.push(
      blocoDoPe(m, e, "cano", l, [UW + 0.004, cano - 0.09, m.pernaW + 0.026], 0.09, 0, 0.04),
    );
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola")) {
      if (f.face === "ny") return pegada(f, sola, piso(escurecer(sola, 0.15)), "tratorado");
      base(f, sola);
      if (f.face === "py") return volume(f, { luz: 0.1, sombra: 0, bordas: 0 });
      // cravos do solado tratorado na borda, em contraste
      g.fillStyle = contraste(sola);
      for (let x = 0.008; x < W; x += 0.028) g.fillRect(x, h * 0.58, 0.014, h * 0.5);
      g.fillStyle = "rgba(0,0,0,0.35)";
      for (let x = 0.022; x < W; x += 0.028) g.fillRect(x, h * 0.58, 0.004, h * 0.5);
      costura(
        f,
        [
          [-0.1, h * 0.25],
          [W + 0.1, h * 0.25],
        ],
        contraste(sola),
        { traco: 0.005 },
      );
      return volume(f, { luz: 0.12, sombra: 0.25, bordas: 0.05, contorno: 0.3 });
    }
    base(f, cor);
    pano(f, "couro");
    if (f.face === "ny") return escurecerTudo(f, 0.45, cor);
    if (f.parte.startsWith("cano")) {
      if (f.face === "py") {
        // a boca do cano: colarinho acolchoado escuro em volta da calça
        escurecerTudo(f, 0.25, cor);
        g.strokeStyle = piso(escurecer(cor, 0.35));
        g.lineWidth = 0.03;
        g.strokeRect(0, 0, W, h);
        return;
      }
      // O alto do cano fica dentro da calça (ela acaba 8 mm abaixo dele): o
      // colarinho acolchoado não aparece, só a sombra da barra da calça.
      oclusao(f, -0.1, -0.1, W + 0.2, 0.13, "cima", 0.35);
      if (f.face === "pz") {
        // a lingueta e o cadarço em zigue-zague subindo pelos ganchos do cano
        g.fillStyle = escurecer(cor, 0.14);
        g.fillRect(W * 0.32, 0.03, W * 0.36, h);
        oclusao(f, W * 0.32, 0.03, W * 0.03, h, "esq", 0.3);
        oclusao(f, W * 0.65, 0.03, W * 0.03, h, "dir", 0.3);
        const ys: number[] = [];
        for (let y = 0.016; y < h + 0.03; y += 0.024) ys.push(y);
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
        // ganchos de metal (em cima) e ilhoses (embaixo)
        ys.forEach((y, i) => {
          for (const x of [W * 0.27, W * 0.73]) {
            if (i < 3) {
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
        // o laço, pequeno, logo abaixo da barra da calça
        g.fillStyle = cadarco;
        g.beginPath();
        g.ellipse(W * 0.5, 0.02, 0.014, 0.007, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = cadarco;
        g.lineWidth = 0.006;
        g.beginPath();
        g.moveTo(W * 0.5, 0.023);
        g.lineTo(W * 0.44, 0.056);
        g.moveTo(W * 0.5, 0.023);
        g.lineTo(W * 0.57, 0.051);
        g.stroke();
      } else if (f.face === "nz") {
        // alça de puxar e a costura de trás
        g.fillStyle = piso(escurecer(cor, 0.35));
        g.beginPath();
        g.roundRect(W * 0.4, -0.03, W * 0.2, 0.07, 0.008);
        g.fill();
        costura(
          f,
          [
            [W * 0.5, 0.05],
            [W * 0.5, h],
          ],
          linha,
          { traco: 0.005 },
        );
      } else {
        costura(
          f,
          [
            [W * 0.3, 0.05],
            [W * 0.3, h],
          ],
          linha,
          { traco: 0.005 },
        );
        dobra(f, [W * 0.1, h * 0.6, W * 0.5, h * 0.55, W * 0.9, h * 0.62], 0.008, 0.18);
      }
      return volume(f, { luz: 0.14, sombra: 0.2, bordas: 0.1, contorno: 0.3 });
    }
    // —— o pé ——
    if (f.face === "py") {
      // a lingueta e o cadarço descendo até o meio do pé
      g.fillStyle = escurecer(cor, 0.14);
      g.fillRect(W * 0.32, -0.1, W * 0.36, h * 0.55);
      for (let y = h * 0.22; y < h * 0.5; y += 0.022) {
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
      // biqueira de segurança lisa: só a emenda em arco e o brilho
      costura(f, curvaPts(W * 0.05, h * 0.62, W * 0.5, h * 0.5, W * 0.95, h * 0.62), linha, {
        duplo: 0.006,
        traco: 0.006,
      });
      brilho(f, W * 0.5, h * 0.82, W * 0.3, h * 0.1, 0.18);
      oclusao(f, -0.1, -0.1, W + 0.2, h * 0.2, "cima", 0.35);
      return volume(f, { luz: 0.14, sombra: 0, bordas: 0.12 });
    }
    if (f.face === "pz") {
      // a ponta da biqueira: lisa, com o brilho do uso
      brilho(f, W * 0.5, h * 0.45, W * 0.3, h * 0.25, 0.2);
    } else if (f.face === "nz") {
      g.fillStyle = escurecer(cor, 0.12);
      g.beginPath();
      g.roundRect(W * 0.2, h * 0.1, W * 0.6, h, 0.02);
      g.fill();
    } else {
      costura(f, curvaPts(W * 0.62, -0.01, W * 0.62, h * 0.6, W * 0.98, h * 0.7), linha, {
        traco: 0.006,
      });
      costura(
        f,
        [
          [-0.1, h - 0.012],
          [W + 0.1, h - 0.012],
        ],
        linha,
        { traco: 0.006 },
      );
    }
    volume(f, { luz: 0.14, sombra: 0.22, bordas: 0.1, contorno: 0.3 });
  };
  return { partes, livres: [], pintar, rugosidade: 0.6, corBase: cor };
};

/* ———————————————————— chinelo (simples) ———————————————————— */

const chinelo: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const w = m.pernaW;
  const cor = piso(c.corSapato);
  const partes: ParteMolde[] = [];
  const pele: BlocoPele[] = [];
  const topoDoPe = 0.028 + alturaDoCalcado("chinelo") - 0.02;
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [w + 0.02, 0.03, w + 0.1], 0, 0.04, 0.012));
    // Tira em V POR CIMA do peito do pé (antes ficava dentro do pé de pele e só
    // as pontas apareciam): do dedão até os dois lados, 2 caixas giradas.
    for (const s of [-1, 1] as const) {
      partes.push({
        nome: `tira${s < 0 ? "A" : "B"}${l < 0 ? "D" : "E"}`,
        tam: [0.024, 0.012, 0.17],
        raio: 0.005,
        lado: l,
        matriz: em(
          e.perna(l),
          mat([s * 0.05, -m.pernaH + topoDoPe + 0.004, 0.085], [0, s * 0.62, 0]),
        ),
      });
    }
    pele.push({
      tam: [w - 0.02, alturaDoCalcado("chinelo") - 0.02, w + 0.04],
      raio: 0.04,
      matriz: em(
        e.perna(l),
        mat([0, -m.pernaH + 0.028 + (alturaDoCalcado("chinelo") - 0.02) / 2, 0.02]),
      ),
    });
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("tira")) {
      base(f, cor);
      return volume(f, { luz: 0.2, sombra: 0.25, bordas: 0.1, contorno: 0.3 });
    }
    if (f.face === "ny") return pegada(f, "#cbd5e1", "#b8c2cf", "tenis");
    base(f, f.face === "py" ? "#e2e8f0" : cor);
    g.fillStyle = "rgba(0,0,0,0.15)";
    g.fillRect(-0.1, h * 0.5, W + 0.2, Math.max(0.003, pxs(f, 1.5)));
    volume(f, { luz: 0.1, sombra: 0.2, bordas: 0.06, contorno: 0.3 });
  };
  return { partes, livres: [], pele, pintar, corBase: cor };
};

/* ———————————————————— femininos (13/10/2026) ———————————————————— */

/** A 2ª cor quando ela aparece em cima do calçado; senão um tom de contraste. */
export const detalhe = (c: AvatarConfig, cor: string) =>
  contrasta(c.corRoupa2, cor, 0.12) ? c.corRoupa2 : contraste(cor);

/** Pele dentro do grupo da perna: y a partir do chão, z para a frente. */
export function peleDoPe(
  m: Medidas,
  e: Esqueleto,
  l: 1 | -1,
  tam: [number, number, number],
  y0: number,
  z: number,
  raio = 0.035,
): BlocoPele {
  return { tam, raio, matriz: em(e.perna(l), mat([0, -m.pernaH + y0 + tam[1] / 2, z])) };
}

/**
 * Sapatilha: cabedal baixinho (o peito do pé de fora) e um laço na ponta,
 * na 2ª cor. A pele do pé sobe até dentro da calça (fecha a boca dela).
 */
const sapatilha: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const sola = piso(escurecer(cor, 0.4));
  const laco = detalhe(c, cor);
  const L = m.pernaW + 0.08;
  const z = 0.04;
  const alto = alturaDoCalcado("sapatilha");
  const TOPO = 0.062;
  const partes: ParteMolde[] = [];
  const pele: BlocoPele[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [SW, 0.018, L], 0, z, 0.008));
    partes.push(blocoDoPe(m, e, "pe", l, [UW, TOPO - 0.012, L - 0.012], 0.012, z, 0.03));
    // o laço da ponta: duas alças deitadas e o nó
    const yl = -m.pernaH + TOPO + 0.006;
    const zl = z + L / 2 - 0.055;
    for (const s of [-1, 1] as const) {
      partes.push({
        nome: `laco${s < 0 ? "A" : "B"}${l < 0 ? "D" : "E"}`,
        tam: [0.04, 0.012, 0.026],
        raio: 0.005,
        lado: l,
        matriz: em(e.perna(l), mat([s * 0.022, yl, zl], [0, s * 0.35, 0])),
      });
    }
    partes.push({
      nome: nomeLado("no", l),
      tam: [0.016, 0.016, 0.018],
      raio: 0.005,
      lado: l,
      matriz: em(e.perna(l), mat([0, yl + 0.002, zl], [0, 0, 0])),
    });
    // o peito do pé e o tornozelo: entram no cabedal e 1 cm na calça
    pele.push(peleDoPe(m, e, l, [m.pernaW - 0.02, alto - 0.03, m.pernaW + 0.01], 0.04, 0.01));
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("laco") || f.parte.startsWith("no")) {
      base(f, laco);
      if (f.face === "ny") return escurecerTudo(f, 0.4, laco);
      g.fillStyle = "rgba(255,255,255,0.22)";
      g.fillRect(W * 0.2, h * 0.2, W * 0.6, Math.max(0.002, h * 0.15));
      return volume(f, { luz: 0.2, sombra: 0.25, bordas: 0.15, contorno: 0.3 });
    }
    if (f.parte.startsWith("sola")) {
      if (f.face === "ny") return pegada(f, sola, "#9a6a3c", "couro");
      base(f, sola);
      return volume(f, { luz: 0.1, sombra: 0.2, bordas: 0.05, contorno: 0.3 });
    }
    base(f, cor);
    pano(f, "couro", 0.5);
    if (f.face === "ny") return escurecerTudo(f, 0.4, cor);
    if (f.face === "py") {
      // a boca do sapato: forro escuro em volta do pé
      g.fillStyle = piso(escurecer(cor, 0.45));
      g.beginPath();
      g.ellipse(W / 2, h * 0.48, W * 0.42, h * 0.36, 0, 0, Math.PI * 2);
      g.fill();
      brilho(f, W * 0.5, h * 0.88, W * 0.3, h * 0.08, 0.35);
      return volume(f, { luz: 0.16, sombra: 0, bordas: 0.12, contorno: 0.25 });
    }
    // o debrum (viés) na beirada de cima
    g.fillStyle = escurecer(cor, 0.25);
    g.fillRect(-0.1, -0.1, W + 0.2, 0.112);
    brilho(f, W * 0.5, h * 0.55, W * 0.35, h * 0.2, 0.3);
    volume(f, { luz: 0.16, sombra: 0.2, bordas: 0.1, contorno: 0.3 });
  };
  return { partes, livres: [], pele, pintar, rugosidade: 0.45, corBase: cor };
};

/**
 * Salto alto (scarpin): o corpo do sapato inclinado (calcanhar alto, ponta
 * no chão), o salto fino atrás e a meia-sola na frente — o vão do arco
 * aparece de perfil. O peito do pé fica de fora (pele).
 */
const salto: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const solado = detalhe(c, cor);
  const L = m.pernaW + 0.1;
  const z = 0.05;
  const INCLINA = 0.22;
  const alto = alturaDoCalcado("salto");
  const partes: ParteMolde[] = [];
  const pele: BlocoPele[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "salto", l, [0.04, 0.1, 0.04], 0, z - L / 2 + 0.032, 0.008));
    partes.push(blocoDoPe(m, e, "sola", l, [SW - 0.01, 0.022, L * 0.42], 0, z + L * 0.29, 0.008));
    partes.push({
      nome: nomeLado("pe", l),
      tam: [UW, 0.05, L],
      raio: 0.022,
      lado: l,
      matriz: em(e.perna(l), mat([0, -m.pernaH + 0.083, z], [INCLINA, 0, 0])),
    });
    // o peito do pé (pele) sai da boca do scarpin e entra 1 cm na calça
    pele.push(peleDoPe(m, e, l, [m.pernaW - 0.02, alto - 0.065, m.pernaW - 0.02], 0.075, -0.01));
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola") || f.parte.startsWith("salto")) {
      base(f, f.face === "ny" ? solado : cor);
      if (f.face !== "ny") brilho(f, W * 0.5, h * 0.4, W * 0.3, h * 0.3, 0.35);
      return volume(f, { luz: 0.14, sombra: 0.2, bordas: 0.08, contorno: 0.3 });
    }
    base(f, cor);
    if (f.face === "ny") {
      // por baixo: o solado na cor de destaque (aparece sentado)
      base(f, solado);
      return volume(f, { luz: 0.06, sombra: 0.1, bordas: 0.06, contorno: 0.35 });
    }
    if (f.face === "py") {
      // a boca do scarpin: forro escuro onde o pé entra
      g.fillStyle = piso(escurecer(cor, 0.5));
      g.beginPath();
      g.ellipse(W / 2, h * 0.42, W * 0.4, h * 0.34, 0, 0, Math.PI * 2);
      g.fill();
      brilho(f, W * 0.5, h * 0.9, W * 0.3, h * 0.07, 0.5);
      return volume(f, { luz: 0.2, sombra: 0, bordas: 0.12, contorno: 0.25 });
    }
    // verniz: brilho forte alongado
    brilho(f, W * 0.5, h * 0.4, W * 0.4, h * 0.18, 0.55);
    brilho(f, W * 0.4, h * 0.35, W * 0.08, h * 0.08, 0.6);
    volume(f, { luz: 0.2, sombra: 0.22, bordas: 0.1, contorno: 0.3 });
  };
  return { partes, livres: [], pele, pintar, rugosidade: 0.3, corBase: cor };
};

/**
 * Sandália: solado com palmilha clara, o pé de pele (calcanhar alto +
 * dedos baixos), tira nos dedos, tiras em X no peito do pé e a tira do
 * tornozelo com fivela.
 */
const sandalia: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const fivela = "#d4a72c";
  const L = m.pernaW + 0.09;
  const z = 0.04;
  const SOLA = 0.032;
  const pw = m.pernaW - 0.02;
  // calcanhar/tornozelo (de trás até z = 0,1) e os dedos (baixos, na frente)
  const tornozelo = { z0: z - L / 2 + 0.01, z1: 0.1, topo: alturaDoCalcado("sandalia") + 0.01 };
  const dedos = { z0: 0.08, z1: z + L / 2 - 0.006, topo: SOLA + 0.046 };
  const partes: ParteMolde[] = [];
  const pele: BlocoPele[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [SW + 0.004, SOLA, L], 0, z, 0.012));
    const dT = tornozelo.z1 - tornozelo.z0;
    const dD = dedos.z1 - dedos.z0;
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
    // tira dos dedos: abraça o pé (6 mm de folga em cima e dos lados)
    partes.push(
      blocoDoPe(
        m,
        e,
        "tiraDedos",
        l,
        [pw + 0.012, dedos.topo - SOLA + 0.006, 0.034],
        SOLA - 0.004,
        dedos.z1 - 0.06,
        0.008,
      ),
    );
    // tiras em X no peito do pé, saindo da frente do tornozelo
    for (const s of [-1, 1] as const) {
      partes.push({
        nome: `tira${s < 0 ? "A" : "B"}${l < 0 ? "D" : "E"}`,
        tam: [0.022, 0.012, 0.14],
        raio: 0.005,
        lado: l,
        matriz: em(e.perna(l), mat([0, -m.pernaH + dedos.topo + 0.004, 0.085], [0, s * 0.55, 0])),
      });
    }
    // tira do tornozelo
    partes.push(
      blocoDoPe(
        m,
        e,
        "tornozeleira",
        l,
        [pw + 0.014, 0.024, dT + 0.014],
        tornozelo.topo - 0.05,
        tornozelo.z0 + dT / 2,
        0.01,
        { ocultas: ["py", "ny"] },
      ),
    );
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola")) {
      if (f.face === "ny")
        return pegada(f, piso(escurecer(cor, 0.3)), piso(escurecer(cor, 0.45)), "tenis");
      if (f.face === "py") {
        // a palmilha clara, com a marca do pé
        base(f, "#e8d5b5");
        g.fillStyle = "rgba(120,80,40,0.15)";
        g.beginPath();
        g.ellipse(W / 2, h * 0.45, W * 0.3, h * 0.38, 0, 0, Math.PI * 2);
        g.fill();
        return volume(f, { luz: 0.06, sombra: 0, bordas: 0.12, contorno: 0.3 });
      }
      base(f, cor);
      // a palmilha aparecendo na borda de cima
      g.fillStyle = "#e8d5b5";
      g.fillRect(-0.1, -0.1, W + 0.2, 0.108);
      return volume(f, { luz: 0.1, sombra: 0.22, bordas: 0.05, contorno: 0.3 });
    }
    base(f, cor);
    pano(f, "couro", 0.6);
    if (f.parte.startsWith("tornozeleira") && f.face === faceExterna(f.lado)) {
      // a fivela dourada
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

/**
 * Bota de cano alto (até perto do joelho): salto bloco, zíper na lateral
 * de dentro e o punho dobrado no alto. A calça entra no cano (para 8 mm
 * abaixo da boca dele); a altura sai de `alturaDoCalcado("botaCano", m)`.
 */
const botaCano: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const { cabedal: UW, sola: SW } = larguras(m);
  const cor = piso(c.corSapato);
  const sola = piso(escurecer(cor, 0.5));
  const punho = detalhe(c, cor);
  const linha = clarear(cor, 0.3);
  const cano = alturaDoCalcado("botaCano", m) + 0.008;
  const L = m.pernaW + 0.08;
  const z = 0.035;
  const SALTO = 0.075;
  const partes: ParteMolde[] = [];
  const aneis: ParteMolde[] = [];
  for (const l of LADOS) {
    partes.push(blocoDoPe(m, e, "sola", l, [SW + 0.004, 0.03, L - SALTO], 0, z + SALTO / 2, 0.01));
    partes.push(
      blocoDoPe(m, e, "salto", l, [SW - 0.004, 0.05, SALTO], 0, z - L / 2 + SALTO / 2, 0.01),
    );
    partes.push(blocoDoPe(m, e, "pe", l, [UW + 0.004, 0.07, L - 0.008], 0.036, z, 0.036));
    partes.push(
      blocoDoPe(m, e, "cano", l, [UW + 0.006, cano - 0.09, m.pernaW + 0.03], 0.09, 0, 0.045),
    );
    aneis.push(
      blocoDoPe(m, e, "punho", l, [UW + 0.018, 0.055, m.pernaW + 0.042], cano - 0.052, 0, 0.045, {
        ocultas: ["ny"],
      }),
    );
  }
  const pintar: Pintor = (f) => {
    const { g, w: W, h } = f;
    if (f.parte.startsWith("sola") || f.parte.startsWith("salto")) {
      if (f.face === "ny")
        return pegada(f, sola, piso(escurecer(sola, 0.15)), "couro", { soFrente: true });
      base(f, sola);
      return volume(f, { luz: 0.12, sombra: 0.25, bordas: 0.05, contorno: 0.3 });
    }
    if (f.parte.startsWith("punho")) {
      base(f, punho);
      pano(f, "couro", 0.6);
      if (f.face === "py") {
        // a boca do cano: escura em volta da perna
        escurecerTudo(f, 0.45, punho);
        return;
      }
      costura(
        f,
        [
          [-0.1, h - 0.01],
          [W + 0.1, h - 0.01],
        ],
        contraste(punho),
        { traco: 0.005 },
      );
      oclusao(f, -0.1, h - 0.012, W + 0.2, 0.012, "baixo", 0.3);
      return volume(f, { luz: 0.16, sombra: 0.2, bordas: 0.1, contorno: 0.3 });
    }
    base(f, cor);
    pano(f, "couro");
    if (f.face === "ny") return escurecerTudo(f, 0.45, cor);
    if (f.parte.startsWith("cano")) {
      if (f.face === "py") return escurecerTudo(f, 0.4, cor);
      if (f.face === faceInterna(f.lado)) ziper(f, W / 2, 0.06, h - 0.02, cor);
      else if (f.face === faceExterna(f.lado))
        costura(
          f,
          [
            [W / 2, 0.06],
            [W / 2, h],
          ],
          linha,
          { traco: 0.005 },
        );
      // o couro amassado no tornozelo e o brilho do cano
      dobra(f, [W * 0.1, h - 0.06, W * 0.5, h - 0.075, W * 0.9, h - 0.055], 0.008, 0.2);
      dobra(f, [W * 0.15, h - 0.11, W * 0.5, h - 0.1, W * 0.85, h - 0.115], 0.007, 0.14);
      brilho(f, W * 0.5, h * 0.4, W * 0.18, h * 0.3, 0.22);
      return volume(f, { luz: 0.14, sombra: 0.2, bordas: 0.14, contorno: 0.3 });
    }
    // —— o pé ——
    if (f.face === "py") {
      brilho(f, W * 0.5, h * 0.8, W * 0.3, h * 0.12, 0.3);
      oclusao(f, -0.1, -0.1, W + 0.2, h * 0.25, "cima", 0.35);
      return volume(f, { luz: 0.16, sombra: 0, bordas: 0.12 });
    }
    if (f.face === "pz") brilho(f, W * 0.5, h * 0.45, W * 0.3, h * 0.25, 0.3);
    costura(
      f,
      [
        [-0.1, h - 0.012],
        [W + 0.1, h - 0.012],
      ],
      linha,
      { traco: 0.006 },
    );
    volume(f, { luz: 0.14, sombra: 0.22, bordas: 0.1, contorno: 0.3 });
  };
  return { partes, aneis, livres: [], pintar, rugosidade: 0.45, corBase: cor };
};

export const PECAS_PES: Record<AvatarConfig["sapato"], CriarPeca> = {
  tenis,
  social: sapatoSocial,
  bota,
  chinelo,
  sapatilha,
  salto,
  sandalia,
  botaCano,
  // Novos (16/10/2026): ver `pecas-pes-extras.ts`.
  ...PECAS_PES_EXTRAS,
};

/** Chave do que muda o desenho do calçado (R2.5). */
export function chaveDosPes(c: AvatarConfig): string {
  return `pes|${c.sapato}|${c.corSapato}|${c.corRoupa2}`;
}
