import { ROUPA_INTEIRA, type AvatarConfig } from "@/lib/avatar-3d";
import type { Face } from "./caixa-roupa";
import type { CtxFace, ParteMolde, Pintor } from "./molde";
import {
  COBRE_O_COS,
  LADOS,
  alturaDoCalcado,
  anelCinto,
  ehLateral,
  em,
  esqueleto,
  faceExterna,
  faceInterna,
  mat,
  nomeLado,
  parteCos,
  pernasDaCalca,
  type BlocoPele,
  type CriarPeca,
  type Esqueleto,
  type Peca,
} from "./peca";
import type { Medidas } from "@/components/rv/medidas";
import {
  barraDeBabado,
  canelasDePele,
  cosDeSaia,
  parteSaia,
  pernasDePele,
  pregas,
  resolverSaia,
  yQueAparece,
} from "./saias";
import {
  alfa,
  base,
  botao,
  clarear,
  contrasta,
  corDaLinha,
  costura,
  curvaPts,
  dobra,
  emenda,
  escurecer,
  escurecerTudo,
  luminancia,
  oclusao,
  pano,
  piso,
  poligono,
  pxs,
  rebite,
  sombraDe,
  volume,
  type Grao,
} from "./pincel";
import { PECAS_BAIXO_EXTRAS, PELE_NA_TEXTURA_BAIXO } from "./pecas-baixo-extras";

/**
 * As PARTES DE BAIXO: pernas da calça, cós e os anéis (barra empilhada do
 * jeans, cinto), mais os bolsos 3D do cargo. O comprimento da perna depende
 * do calçado (a bota é mais alta), por isso o sapato entra na chave.
 *
 * Fase 0: jeans, social e cargo completos; jogger, bermuda e saia simples.
 * Femininas (13/10/2026): saia rodada, lápis e jeans, legging, shortinho e
 * pantalona; e a parte de baixo das roupas inteiras (vestido, macacão).
 */

type CalcaNova = "jeansRasgado" | "saiaLonga" | "shortJeans" | "brim" | "moletom";
export type TipoCalca = AvatarConfig["calca"] | CalcaNova;

export const LARANJA = "#d9963f";
export const COURO_CINTO = "#2b1f19";

/** Interno/externo de uma face da perna, vista de fora (x da borda de dentro). */
export const xInterno = (f: CtxFace) => {
  if (f.face === "pz") return f.lado > 0 ? 0 : f.w;
  if (f.face === "nz") return f.lado > 0 ? f.w : 0;
  return f.w / 2;
};

/* ———————————————————— cós e cinto ———————————————————— */

/** O cós, a menos que a parte de cima o cubra (barra de ribana do moletom). */
export const cosSeVisivel = (m: Medidas, e: Esqueleto, c: AvatarConfig): ParteMolde[] =>
  COBRE_O_COS.has(c.roupa) ? [] : [parteCos(m, e)];
/** O cinto, idem: por baixo da barra ele cortava a ribana ao meio. */
export const cintoSeVisivel = (m: Medidas, e: Esqueleto, c: AvatarConfig): ParteMolde[] =>
  COBRE_O_COS.has(c.roupa) ? [] : [anelCinto(m, e)];

export function pintarCos(
  f: CtxFace,
  cor: string,
  linha: string,
  grao: Grao,
  o: { botao?: string; etiqueta?: boolean } = {},
) {
  const { g, w, h } = f;
  base(f, cor);
  pano(f, grao);
  if (f.face === "py" || f.face === "ny") return;
  costura(
    f,
    [
      [-0.1, 0.012],
      [w + 0.1, 0.012],
    ],
    linha,
  );
  costura(
    f,
    [
      [-0.1, h - 0.012],
      [w + 0.1, h - 0.012],
    ],
    linha,
  );
  const passantes = f.face === "pz" ? [0.17, 0.83] : f.face === "nz" ? [0.5, 0.2, 0.8] : [0.5];
  for (const p of passantes) {
    const x = w * p;
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.fillRect(x - 0.008, -0.01, 0.02, h + 0.02);
    g.fillStyle = clarear(cor, 0.06);
    g.fillRect(x - 0.01, -0.01, 0.02, h + 0.02);
    costura(
      f,
      [
        [x - 0.008, 0.006],
        [x + 0.008, 0.006],
      ],
      linha,
      { espessura: 0.004, traco: 0.004 },
    );
    costura(
      f,
      [
        [x - 0.008, h - 0.006],
        [x + 0.008, h - 0.006],
      ],
      linha,
      { espessura: 0.004, traco: 0.004 },
    );
  }
  if (f.face === "pz" && o.botao) {
    const gr = g.createRadialGradient(w / 2 - 0.004, h / 2 - 0.004, 0.002, w / 2, h / 2, 0.016);
    gr.addColorStop(0, "#f2e2b8");
    gr.addColorStop(0.7, o.botao);
    gr.addColorStop(1, "#5c4421");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(w / 2, h / 2, 0.016, 0, Math.PI * 2);
    g.fill();
  }
  if (f.face === "nz" && o.etiqueta) {
    const x = w * 0.68;
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.fillRect(x + 0.002, 0.016, 0.07, 0.05);
    g.fillStyle = "#a7744a";
    g.fillRect(x, 0.012, 0.07, 0.05);
    g.strokeStyle = "#6e4527";
    g.lineWidth = 0.003;
    g.strokeRect(x + 0.006, 0.018, 0.058, 0.038);
  }
  volume(f, { luz: 0.08, sombra: 0.14, bordas: 0.06 });
}

/** Cinto (anel sobre o cós): couro com pesponto, fivela na frente, furos e passador. */
export function pintarCinto(f: CtxFace, couro: string, fivela: "metal" | "tatico") {
  const { g, w, h } = f;
  base(f, couro);
  pano(f, "couro", 0.8);
  if (f.face === "py" || f.face === "ny") return escurecerTudo(f, 0.35);
  const linha = clarear(couro, 0.3);
  costura(
    f,
    [
      [-0.1, 0.007],
      [w + 0.1, 0.007],
    ],
    linha,
    { traco: 0.005, espessura: 0.0025 },
  );
  costura(
    f,
    [
      [-0.1, h - 0.007],
      [w + 0.1, h - 0.007],
    ],
    linha,
    { traco: 0.005, espessura: 0.0025 },
  );
  if (f.face === "pz") {
    const cx = w / 2;
    const fw = 0.058;
    const fh = h + 0.012;
    // a ponta do cinto passando pelo passador, à direita de quem olha
    g.fillStyle = escurecer(couro, 0.15);
    g.fillRect(cx + fw / 2, 0.004, 0.07, h - 0.008);
    for (const x of [cx + 0.075, cx + 0.1]) {
      g.fillStyle = "rgba(0,0,0,0.6)";
      g.beginPath();
      g.arc(x, h / 2, 0.0035, 0, Math.PI * 2);
      g.fill();
    }
    sombraDe(f, () => g.rect(cx - fw / 2, -0.006, fw, fh), 0.002, 0.004, 0.4);
    if (fivela === "metal") {
      const gr = g.createLinearGradient(0, -0.006, 0, fh);
      gr.addColorStop(0, "#f1f5f9");
      gr.addColorStop(0.5, "#94a3b8");
      gr.addColorStop(1, "#cbd5e1");
      g.strokeStyle = gr;
      g.lineWidth = 0.008;
      g.strokeRect(cx - fw / 2 + 0.004, -0.002, fw - 0.008, fh - 0.008);
      g.fillStyle = "#cbd5e1";
      g.fillRect(cx - 0.002, h / 2 - 0.002, 0.03, 0.004);
    } else {
      g.fillStyle = "#3f4650";
      g.beginPath();
      g.roundRect(cx - fw / 2, -0.004, fw, fh - 0.004, 0.006);
      g.fill();
      g.fillStyle = "#6b7280";
      g.fillRect(cx - fw / 2 + 0.008, h / 2 - 0.003, fw - 0.016, 0.006);
    }
  }
  volume(f, { luz: 0.18, sombra: 0.2, bordas: 0.06, contorno: 0.3 });
}

/* ———————————————————— JEANS ———————————————————— */

/** O desbotado do jeans: mancha clara elíptica (coxa, joelho, bolso). */
export function desbotar(
  f: CtxFace,
  cor: string,
  x: number,
  y: number,
  rx: number,
  ry: number,
  a: number,
) {
  const { g } = f;
  const claro = clarear(cor, 0.35);
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, alfa(claro, a));
  gr.addColorStop(1, alfa(claro, 0));
  g.fillStyle = gr;
  g.fillRect(-rx, -rx, 2 * rx, 2 * rx);
  g.restore();
}

/** Barra com pesponto laranja e o "empilhado" (dobras) logo acima. */
function barraDoJeans(f: CtxFace, empilhado: boolean) {
  const { g, w, h } = f;
  if (empilhado) {
    dobra(f, [w * 0.1, h - 0.07, w * 0.5, h - 0.085, w * 0.9, h - 0.065], 0.008, 0.18);
    dobra(f, [w * 0.15, h - 0.12, w * 0.5, h - 0.11, w * 0.85, h - 0.125], 0.007, 0.12);
  }
  g.fillStyle = "rgba(0,0,0,0.28)";
  g.fillRect(-0.1, h - 0.032, w + 0.2, Math.max(0.004, pxs(f, 2)));
  costura(
    f,
    [
      [-0.1, h - 0.018],
      [w + 0.1, h - 0.018],
    ],
    LARANJA,
  );
}

/** FRENTE de uma perna do jeans: desbotado, bigodes, bolso com rebite, braguilha em J. */
function jeansFrente(f: CtxFace, cor: string) {
  const { g, w, h } = f;
  const desbotado = clarear(cor, 0.35);
  base(f, cor);
  pano(f, "sarja");
  desbotar(f, cor, w / 2, h * 0.3, w * 0.5, h * 0.3, 0.5);
  desbotar(f, cor, w / 2, h * 0.58, w * 0.4, h * 0.12, 0.3);
  const xi = f.lado > 0 ? 0 : w;
  const xe = w - xi;
  const s = xe > xi ? 1 : -1;
  for (let i = 0; i < 4; i++) {
    const y = 0.12 + i * 0.028;
    g.strokeStyle = alfa(desbotado, 0.35);
    g.lineWidth = Math.max(0.007, pxs(f, 2));
    g.beginPath();
    g.moveTo(xi + s * 0.01, y);
    g.quadraticCurveTo(xi + s * 0.06, y - 0.012, xi + s * (0.1 + i * 0.012), y - 0.03);
    g.stroke();
  }
  g.save();
  g.beginPath();
  g.moveTo(xe - s * 0.11, -0.1);
  g.lineTo(xe - s * 0.11, 0);
  g.quadraticCurveTo(xe - s * 0.1, 0.085, xe + s * 0.02, 0.1);
  g.lineTo(xe + s * 0.1, -0.1);
  g.closePath();
  g.fillStyle = "rgba(0,0,0,0.38)";
  g.fill();
  g.restore();
  g.strokeStyle = alfa("#ffffff", 0.22);
  g.lineWidth = Math.max(0.003, pxs(f, 1));
  g.beginPath();
  g.moveTo(xe - s * 0.11, 0);
  g.quadraticCurveTo(xe - s * 0.1, 0.085, xe + s * 0.02, 0.1);
  g.stroke();
  costura(f, curvaPts(xe - s * 0.1, 0, xe - s * 0.088, 0.075, xe + s * 0.02, 0.088), LARANJA, {
    duplo: 0.006,
  });
  rebite(f, xe - s * 0.008, 0.095);
  if (f.lado < 0) {
    costura(
      f,
      [
        [xe - s * 0.075, 0.02],
        [xe - s * 0.075, 0.058],
        [xe - s * 0.025, 0.058],
      ],
      LARANJA,
    );
    rebite(f, xe - s * 0.075, 0.016, 0.006);
  } else {
    costura(
      f,
      [
        [xi + 0.035, 0],
        [xi + 0.035, 0.14],
        [xi + 0.028, 0.162],
        [xi + 0.005, 0.175],
      ],
      LARANJA,
      { duplo: 0.006 },
    );
    rebite(f, xi + 0.006, 0.17, 0.005);
  }
  dobra(f, [w * 0.15, h * 0.53, w * 0.5, h * 0.515, w * 0.85, h * 0.535], 0.008, 0.18);
  dobra(f, [w * 0.2, h * 0.57, w * 0.5, h * 0.56, w * 0.8, h * 0.575], 0.007, 0.12);
  barraDoJeans(f, true);
  volume(f, { luz: 0.06, sombra: 0.14, bordas: 0.14 });
}

const jeans: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = c.corCalca;
  const alto = m.pernaH - alturaDoCalcado(c.sapato, m);
  const desbotado = clarear(cor, 0.35);
  const pernas = pernasDaCalca(m, e, alto);
  // Barra empilhada: anel +6 mm na boca da perna, com 2 dobras pintadas.
  const barras: ParteMolde[] = LADOS.map((l) => ({
    nome: nomeLado("barra", l),
    tam: [m.pernaW + 0.012, 0.055, m.pernaW + 0.032],
    raio: 0.05,
    lado: l,
    ocultas: ["py", "ny"] as Face[],
    matriz: em(e.perna(l), mat([0, -alto + 0.0275, 0])),
  }));
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    if (f.parte === "cos")
      return pintarCos(f, cor, LARANJA, "sarja", { botao: "#a8874f", etiqueta: true });
    if (f.parte.startsWith("barra")) {
      base(f, cor);
      pano(f, "sarja");
      desbotar(f, cor, w / 2, h * 0.5, w * 0.6, h * 0.6, 0.2);
      dobra(f, [-0.01, h * 0.35, w * 0.5, h * 0.2, w + 0.01, h * 0.4], 0.008, 0.25);
      dobra(f, [-0.01, h * 0.75, w * 0.4, h * 0.85, w + 0.01, h * 0.7], 0.007, 0.2);
      costura(
        f,
        [
          [-0.1, h - 0.014],
          [w + 0.1, h - 0.014],
        ],
        LARANJA,
      );
      return volume(f, { luz: 0.08, sombra: 0.25, bordas: 0.1 });
    }
    if (f.face === "pz") return jeansFrente(f, cor);
    base(f, cor);
    pano(f, "sarja");
    if (f.face === "py") return volume(f, { luz: 0.04, sombra: 0.14, bordas: 0.1, contorno: 0.15 });
    if (f.face === "ny") return escurecerTudo(f, 0.5);
    const brilho = (x: number, y: number, rx: number, ry: number, a: number) =>
      desbotar(f, cor, x, y, rx, ry, a);
    if (f.face === "nz") {
      brilho(w / 2, h * 0.3, w * 0.5, h * 0.3, 0.5);
      brilho(w / 2, h * 0.58, w * 0.4, h * 0.12, 0.3);
      const xi = xInterno(f);
      const s = xi > w / 2 ? -1 : 1;
      costura(
        f,
        [
          [xi, 0.065],
          [xi + s * w, 0.03],
        ],
        LARANJA,
        { duplo: 0.006 },
      );
      oclusao(f, -0.1, 0.03, w + 0.2, 0.04, "cima", 0.12);
      const bx = w / 2 + s * 0.008;
      const bw = Math.min(0.15, w * 0.62);
      const top = 0.085;
      const pts: [number, number][] = [
        [bx - bw / 2, top],
        [bx + bw / 2, top],
        [bx + bw / 2 - 0.006, top + 0.12],
        [bx, top + 0.15],
        [bx - bw / 2 + 0.006, top + 0.12],
      ];
      sombraDe(f, () => poligono(g, pts), 0.002, 0.004, 0.25);
      g.fillStyle = alfa(escurecer(cor, 0.12), 0.6);
      poligono(g, pts);
      g.fill();
      g.save();
      poligono(g, pts);
      g.clip();
      pano(f, "sarja");
      brilho(bx, top + 0.06, bw * 0.4, 0.05, 0.25);
      g.restore();
      oclusao(f, bx - bw / 2, top, bw, 0.012, "cima", 0.45);
      costura(
        f,
        [...pts.slice(1), pts[0]!].map(
          ([x, y], i) =>
            [x + (i === 0 || i === 1 ? -0.008 : i === 3 ? 0.008 : 0), y] as [number, number],
        ),
        LARANJA,
      );
      costura(
        f,
        curvaPts(bx - bw / 2 + 0.015, top + 0.06, bx - bw * 0.2, top + 0.02, bx, top + 0.07),
        LARANJA,
      );
      costura(
        f,
        curvaPts(bx, top + 0.07, bx + bw * 0.2, top + 0.02, bx + bw / 2 - 0.015, top + 0.06),
        LARANJA,
      );
      for (let i = 0; i < 3; i++) {
        const y = h * 0.56 + i * 0.022;
        g.strokeStyle = alfa(desbotado, 0.3);
        g.lineWidth = Math.max(0.006, pxs(f, 2));
        g.beginPath();
        g.moveTo(w * 0.25, y);
        g.quadraticCurveTo(w * 0.5, y + 0.008, w * 0.75, y);
        g.stroke();
      }
    } else {
      brilho(w / 2, h * 0.4, w * 0.4, h * 0.4, 0.25);
      const externa = f.face === faceExterna(f.lado);
      emenda(
        f,
        [
          [w / 2, -0.1],
          [w / 2, h + 0.1],
        ],
        0.35,
      );
      costura(
        f,
        [
          [w / 2 + (externa ? 0.007 : 0), 0],
          [w / 2 + (externa ? 0.007 : 0), h - 0.04],
        ],
        LARANJA,
        externa ? {} : { duplo: 0.007 },
      );
    }
    barraDoJeans(f, true);
    volume(f, { luz: 0.06, sombra: 0.14, bordas: 0.14 });
  };
  return {
    partes: [...pernas, ...cosSeVisivel(m, e, c)],
    aneis: barras,
    livres: [],
    pintar,
    corBase: cor,
  };
};

/* ———————————————————— CALÇA SOCIAL ———————————————————— */

const calcaSocial: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const linha = escurecer(cor, 0.25);
  const alto = m.pernaH - alturaDoCalcado(c.sapato, m);
  const vinco = (f: CtxFace, x: number) => {
    const { g, h } = f;
    // o vinco passado a ferro: aresta clara com sombra dos dois lados
    const gr = g.createLinearGradient(x - 0.03, 0, x + 0.03, 0);
    gr.addColorStop(0, "rgba(0,0,0,0)");
    gr.addColorStop(0.42, "rgba(0,0,0,0.16)");
    gr.addColorStop(0.5, "rgba(255,255,255,0.2)");
    gr.addColorStop(0.58, "rgba(0,0,0,0.1)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x - 0.03, -0.1, 0.06, h + 0.2);
  };
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    if (f.parte === "cos") return pintarCos(f, cor, linha, "brim");
    if (f.parte === "cinto") return pintarCinto(f, COURO_CINTO, "metal");
    base(f, cor);
    pano(f, "brim");
    if (f.face === "py") return volume(f, { luz: 0.04, sombra: 0.14, bordas: 0.1, contorno: 0.15 });
    if (f.face === "ny") return escurecerTudo(f, 0.5);
    if (f.face === "pz") {
      vinco(f, w / 2);
      const xi = xInterno(f);
      const xe = w - xi;
      const s = xe > xi ? 1 : -1;
      // bolso faca: a fenda inclinada na lateral de cima
      g.strokeStyle = "rgba(0,0,0,0.5)";
      g.lineWidth = Math.max(0.006, pxs(f, 2));
      g.beginPath();
      g.moveTo(xe - s * 0.065, -0.01);
      g.lineTo(xe - s * 0.005, 0.13);
      g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.15)";
      g.lineWidth = Math.max(0.002, pxs(f, 1));
      g.beginPath();
      g.moveTo(xe - s * 0.072, -0.01);
      g.lineTo(xe - s * 0.012, 0.13);
      g.stroke();
      // braguilha com pesponto discreto (perna esquerda do boneco)
      if (f.lado > 0)
        costura(
          f,
          [
            [xi + 0.03, 0],
            [xi + 0.03, 0.13],
            [xi + 0.005, 0.155],
          ],
          linha,
          { traco: 0.006 },
        );
      // pregas na cintura e "quebra" sobre o sapato
      dobra(f, [w * 0.3, 0.02, w * 0.32, 0.07, w * 0.3, 0.12], 0.008, 0.14);
      dobra(f, [w * 0.12, h - 0.05, w * 0.5, h - 0.075, w * 0.88, h - 0.045], 0.008, 0.18);
      dobra(f, [w * 0.2, h * 0.5, w * 0.5, h * 0.49, w * 0.8, h * 0.51], 0.008, 0.08);
    } else if (f.face === "nz") {
      vinco(f, w / 2);
      const xi = xInterno(f);
      const s = xi > w / 2 ? -1 : 1;
      // bolso embutido (vivo) com botão
      const bx = w / 2 + s * 0.01;
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(bx - 0.055, 0.075, 0.11, Math.max(0.005, pxs(f, 2)));
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.fillRect(bx - 0.055, 0.07, 0.11, Math.max(0.003, pxs(f, 1)));
      botao(f, bx, 0.06, 0.006, escurecer(cor, 0.4));
      emenda(
        f,
        [
          [xi, 0],
          [xi + s * 0.02, h * 0.3],
        ],
        0.2,
      );
      dobra(f, [w * 0.2, h * 0.55, w * 0.5, h * 0.53, w * 0.8, h * 0.56], 0.01, 0.14);
    } else {
      emenda(
        f,
        [
          [w / 2, -0.1],
          [w / 2, h + 0.1],
        ],
        0.3,
      );
    }
    volume(f, { luz: 0.08, sombra: 0.16, bordas: 0.12 });
  };
  return {
    partes: [...pernasDaCalca(m, e, alto), ...cosSeVisivel(m, e, c)],
    aneis: cintoSeVisivel(m, e, c),
    livres: [],
    pintar,
    rugosidade: 0.7,
    corBase: cor,
  };
};

/* ———————————————————— CARGO ———————————————————— */

const cargo: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const linha = corDaLinha(cor);
  const reforco = escurecer(cor, 0.1);
  const alto = m.pernaH - alturaDoCalcado(c.sapato, m);
  const yBolso = -Math.min(0.33, alto * 0.42);
  const BOLSO: [number, number, number] = [0.024, 0.15, 0.14];
  // Bolsos 3D na lateral de fora de cada coxa, e a lapela 3D por cima.
  const bolsos: ParteMolde[] = [];
  for (const l of LADOS) {
    const x = l * (m.pernaW / 2 + BOLSO[0] / 2 - 0.003);
    bolsos.push({
      nome: nomeLado("bolso", l),
      tam: BOLSO,
      raio: 0.008,
      lado: l,
      matriz: em(e.perna(l), mat([x, yBolso, 0])),
    });
    bolsos.push({
      nome: nomeLado("lapela", l),
      tam: [BOLSO[0] + 0.008, 0.045, BOLSO[2] + 0.01],
      raio: 0.008,
      lado: l,
      matriz: em(e.perna(l), mat([x + l * 0.004, yBolso + BOLSO[1] / 2 - 0.02, 0])),
    });
  }
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    if (f.parte === "cos") return pintarCos(f, cor, linha, "brim");
    if (f.parte === "cinto") return pintarCinto(f, "#23262b", "tatico");
    base(f, cor);
    pano(f, "brim");
    if (f.parte.startsWith("bolso")) {
      if (f.face !== faceExterna(f.lado))
        return volume(f, { luz: 0.05, sombra: 0.25, bordas: 0.1 });
      // prega macho no meio do bolso + pesponto em volta
      g.fillStyle = alfa(escurecer(cor, 0.2), 0.4);
      g.fillRect(w / 2 - 0.018, -0.1, 0.036, h + 0.2);
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(w / 2 - 0.018, -0.1, Math.max(0.003, pxs(f, 2)), h + 0.2);
      g.fillRect(w / 2 + 0.016, -0.1, Math.max(0.003, pxs(f, 2)), h + 0.2);
      costura(
        f,
        [
          [0.01, 0.01],
          [0.01, h - 0.01],
          [w - 0.01, h - 0.01],
          [w - 0.01, 0.01],
        ],
        linha,
        { duplo: 0.005 },
      );
      return volume(f, { luz: 0.1, sombra: 0.2, bordas: 0.12, contorno: 0.3 });
    }
    if (f.parte.startsWith("lapela")) {
      base(f, reforco);
      pano(f, "brim");
      if (f.face === faceExterna(f.lado)) {
        costura(
          f,
          [
            [0.01, 0.012],
            [w - 0.01, 0.012],
          ],
          linha,
          { traco: 0.006 },
        );
        costura(
          f,
          [
            [0.01, h - 0.01],
            [w - 0.01, h - 0.01],
          ],
          linha,
          { traco: 0.006 },
        );
        botao(f, w / 2, h * 0.55, 0.008, escurecer(cor, 0.45));
      }
      return volume(f, { luz: 0.14, sombra: 0.28, bordas: 0.1, contorno: 0.35 });
    }
    if (f.face === "py") return volume(f, { luz: 0.04, sombra: 0.14, bordas: 0.1, contorno: 0.15 });
    if (f.face === "ny") return escurecerTudo(f, 0.5);
    const yb = -yBolso; // centro do bolso, a partir do topo da perna
    if (f.face === "pz") {
      const xi = xInterno(f);
      const xe = w - xi;
      const s = xe > xi ? 1 : -1;
      // bolso faca
      g.strokeStyle = "rgba(0,0,0,0.45)";
      g.lineWidth = Math.max(0.006, pxs(f, 2));
      g.beginPath();
      g.moveTo(xe - s * 0.07, -0.01);
      g.quadraticCurveTo(xe - s * 0.06, 0.09, xe, 0.12);
      g.stroke();
      costura(f, curvaPts(xe - s * 0.06, -0.01, xe - s * 0.05, 0.085, xe, 0.11), linha);
      // joelheira dupla: retângulo de reforço com pesponto duplo
      const jy = h * 0.5;
      sombraDe(f, () => g.rect(0.02, jy - 0.07, w - 0.04, 0.14), 0, 0.004, 0.2);
      g.fillStyle = reforco;
      g.fillRect(0.02, jy - 0.07, w - 0.04, 0.14);
      pano(f, "brim");
      costura(
        f,
        [
          [0.028, jy - 0.062],
          [w - 0.028, jy - 0.062],
        ],
        linha,
        { duplo: 0.006 },
      );
      costura(
        f,
        [
          [0.028, jy + 0.062],
          [w - 0.028, jy + 0.062],
        ],
        linha,
        { duplo: 0.006 },
      );
      dobra(f, [0.03, jy + 0.03, w * 0.5, jy + 0.015, w - 0.03, jy + 0.035], 0.008, 0.16);
      if (f.lado > 0)
        costura(
          f,
          [
            [xi + 0.032, 0],
            [xi + 0.032, 0.13],
            [xi + 0.006, 0.16],
          ],
          linha,
        );
      dobra(f, [w * 0.12, h - 0.05, w * 0.5, h - 0.07, w * 0.88, h - 0.045], 0.008, 0.16);
      dobra(f, [w * 0.25, 0.2, w * 0.45, 0.23, w * 0.7, 0.21], 0.008, 0.1);
    } else if (f.face === "nz") {
      const xi = xInterno(f);
      const s = xi > w / 2 ? -1 : 1;
      const bx = w / 2 + s * 0.008;
      // bolso traseiro com lapela
      sombraDe(f, () => g.rect(bx - 0.06, 0.08, 0.12, 0.12), 0.002, 0.004, 0.2);
      g.fillStyle = reforco;
      g.fillRect(bx - 0.06, 0.08, 0.12, 0.12);
      costura(
        f,
        [
          [bx - 0.055, 0.1],
          [bx - 0.055, 0.195],
          [bx + 0.055, 0.195],
          [bx + 0.055, 0.1],
        ],
        linha,
      );
      sombraDe(f, () => g.rect(bx - 0.064, 0.07, 0.128, 0.04), 0.001, 0.005, 0.3);
      g.fillStyle = escurecer(cor, 0.05);
      g.fillRect(bx - 0.064, 0.07, 0.128, 0.04);
      botao(f, bx, 0.095, 0.007, escurecer(cor, 0.45));
      dobra(f, [w * 0.2, h * 0.56, w * 0.5, h * 0.53, w * 0.8, h * 0.57], 0.01, 0.16);
    } else {
      const externa = f.face === faceExterna(f.lado);
      emenda(
        f,
        [
          [w / 2, -0.1],
          [w / 2, h + 0.1],
        ],
        0.3,
      );
      costura(
        f,
        [
          [w / 2 + 0.006, 0],
          [w / 2 + 0.006, h - 0.03],
        ],
        linha,
      );
      if (externa) {
        // sombra que o bolso 3D projeta na coxa
        g.fillStyle = "rgba(0,0,0,0.2)";
        g.fillRect(w / 2 - 0.08, yb + 0.07, 0.16, 0.025);
      }
    }
    costura(
      f,
      [
        [-0.1, h - 0.02],
        [w + 0.1, h - 0.02],
      ],
      linha,
    );
    volume(f, { luz: 0.08, sombra: 0.16, bordas: 0.12 });
  };
  return {
    partes: [...pernasDaCalca(m, e, alto), ...cosSeVisivel(m, e, c), ...bolsos],
    aneis: cintoSeVisivel(m, e, c),
    livres: [],
    pintar,
    rugosidade: 0.8,
    corBase: cor,
  };
};

/* ———————————————————— simples (Fase 0) ———————————————————— */

/** Jogger: cós de ribana com cordão, listras laterais e punho no tornozelo. */
const jogger: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const alto = m.pernaH - alturaDoCalcado(c.sapato, m);
  const linha = corDaLinha(cor);
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    base(f, cor);
    pano(f, "ruido");
    if (f.parte === "cos") {
      if (f.face === "py" || f.face === "ny") return;
      g.fillStyle = "rgba(0,0,0,0.18)";
      for (let x = 0; x < w; x += 0.016) g.fillRect(x, 0, Math.max(0.004, pxs(f, 2)), h);
      if (f.face === "pz") {
        g.strokeStyle = c.corRoupa2;
        g.lineWidth = 0.008;
        g.beginPath();
        g.moveTo(w / 2 - 0.02, h * 0.5);
        g.quadraticCurveTo(w / 2 - 0.03, h + 0.05, w / 2 - 0.02, h + 0.1);
        g.moveTo(w / 2 + 0.02, h * 0.5);
        g.quadraticCurveTo(w / 2 + 0.03, h + 0.05, w / 2 + 0.02, h + 0.1);
        g.stroke();
      }
      return volume(f, { luz: 0.08, sombra: 0.2, bordas: 0.06 });
    }
    if (f.face === "py") return volume(f, { luz: 0.04, sombra: 0.14, bordas: 0.1, contorno: 0.15 });
    if (f.face === "ny") return escurecerTudo(f, 0.5);
    if (ehLateral(f.face) && f.face === faceExterna(f.lado)) {
      g.fillStyle = c.corRoupa2;
      g.fillRect(w / 2 - 0.02, -0.1, 0.012, h + 0.2);
      g.fillRect(w / 2 + 0.008, -0.1, 0.012, h + 0.2);
    }
    g.fillStyle = "rgba(0,0,0,0.2)";
    for (let x = 0; x < w; x += 0.016) g.fillRect(x, h - 0.06, Math.max(0.004, pxs(f, 2)), 0.06);
    oclusao(f, -0.1, h - 0.09, w + 0.2, 0.03, "baixo", 0.25);
    dobra(f, [w * 0.15, h * 0.52, w * 0.5, h * 0.5, w * 0.85, h * 0.53], 0.01, 0.16);
    dobra(f, [w * 0.15, h - 0.1, w * 0.5, h - 0.12, w * 0.85, h - 0.095], 0.009, 0.18);
    if (f.face === faceInterna(f.lado))
      costura(
        f,
        [
          [w / 2, 0],
          [w / 2, h - 0.06],
        ],
        linha,
      );
    volume(f, { luz: 0.08, sombra: 0.16, bordas: 0.12 });
  };
  return {
    partes: [...pernasDaCalca(m, e, alto), ...cosSeVisivel(m, e, c)],
    livres: [],
    pintar,
    corBase: cor,
  };
};

/** Bermuda (até 48%, pele abaixo) e saia (bloco afunilado, pernas de pele). */
const bermuda: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const comp = m.pernaH - alturaDoCalcado(c.sapato, m);
  const alto = comp * 0.48;
  const linha = corDaLinha(cor);
  const pele: BlocoPele[] = LADOS.map((l) => ({
    tam: [m.pernaW - 0.02, comp - alto + 0.01, m.pernaW],
    raio: 0.05,
    matriz: em(e.perna(l), mat([0, -alto - (comp - alto) / 2 + 0.005, 0])),
  }));
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    if (f.parte === "cos") return pintarCos(f, cor, linha, "brim");
    base(f, cor);
    pano(f, "brim");
    if (f.face === "py") return volume(f, { luz: 0.04, sombra: 0.14, bordas: 0.1, contorno: 0.15 });
    if (f.face === "ny") return escurecerTudo(f, 0.55);
    // barra dobrada
    g.fillStyle = alfa(escurecer(cor, 0.12), 0.6);
    g.fillRect(-0.1, h - 0.05, w + 0.2, 0.15);
    costura(
      f,
      [
        [-0.1, h - 0.05],
        [w + 0.1, h - 0.05],
      ],
      linha,
    );
    oclusao(f, -0.1, h - 0.075, w + 0.2, 0.025, "baixo", 0.25);
    if (ehLateral(f.face))
      emenda(
        f,
        [
          [w / 2, -0.1],
          [w / 2, h + 0.1],
        ],
        0.3,
      );
    if (f.face === "pz") dobra(f, [w * 0.2, 0.06, w * 0.5, 0.1, w * 0.8, 0.07], 0.008, 0.12);
    volume(f, { luz: 0.08, sombra: 0.16, bordas: 0.12 });
  };
  return {
    partes: [...pernasDaCalca(m, e, alto, { baseVisivel: true }), ...cosSeVisivel(m, e, c)],
    livres: [],
    pele,
    pintar,
    mostraPele: false,
    corBase: cor,
  };
};

/** Saia pregueada com xadrez opcional (`corRoupa2`); sentada, gira −1,38 no cós. */
const saia: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const comp = m.pernaH - alturaDoCalcado(c.sapato, m);
  const escura = escurecer(cor, 0.45);
  const clara = clarear(c.corRoupa2, 0.1);
  const linha = escurecer(cor, 0.4);
  const pele: BlocoPele[] = LADOS.map((l) => ({
    tam: [m.pernaW - 0.02, comp, m.pernaW],
    raio: 0.05,
    matriz: em(e.perna(l), mat([0, -comp / 2, 0])),
  }));
  const pivo = mat([0, e.quadrilY + 0.1, 0], e.sentado ? [-1.38, 0, 0] : [0, 0, 0]);
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    base(f, cor);
    if (f.face === "py") return volume(f, { luz: 0.04, sombra: 0.14, bordas: 0.1, contorno: 0.15 });
    if (f.face === "ny") return escurecerTudo(f, 0.55);
    const P = 0.07;
    const x0 = -(f.faixa % P) - 2 * P;
    if (luminancia(c.corRoupa2) !== luminancia(cor)) {
      for (let x = x0; x < w + 2 * P; x += P) {
        g.fillStyle = alfa(escura, 0.55);
        g.fillRect(x, -0.1, P * 0.45, h + 0.2);
        g.fillStyle = alfa(clara, 0.5);
        g.fillRect(x + P * 0.7, -0.1, Math.max(P * 0.06, pxs(f, 2)), h + 0.2);
      }
      for (let y = 0.03; y < h + 0.1; y += P) {
        g.fillStyle = alfa(escura, 0.45);
        g.fillRect(-0.1, y, w + 0.2, P * 0.45);
        g.fillStyle = alfa(clara, 0.45);
        g.fillRect(-0.1, y + P * 0.7, w + 0.2, Math.max(P * 0.06, pxs(f, 2)));
      }
    }
    pano(f, "sarja", 0.5);
    const passo = 0.045;
    const ini = -(f.faixa % passo) - passo;
    for (let x = ini; x < w + passo; x += passo) {
      const gr = g.createLinearGradient(x, 0, x + passo, 0);
      gr.addColorStop(0, "rgba(0,0,0,0.30)");
      gr.addColorStop(0.25, "rgba(0,0,0,0.0)");
      gr.addColorStop(0.8, "rgba(255,255,255,0.10)");
      gr.addColorStop(1, "rgba(0,0,0,0.12)");
      g.fillStyle = gr;
      g.fillRect(x, 0.045, passo, h);
    }
    g.fillStyle = escurecer(cor, 0.15);
    g.fillRect(-0.1, -0.1, w + 0.2, 0.145);
    costura(
      f,
      [
        [-0.1, 0.04],
        [w + 0.1, 0.04],
      ],
      linha,
    );
    oclusao(f, -0.1, 0.045, w + 0.2, 0.03, "cima", 0.3);
    volume(f, { luz: 0.08, sombra: 0.2, bordas: 0.04 });
  };
  return {
    partes: [
      {
        nome: "saia",
        tam: [m.troncoW * 1.04, 0.34, m.troncoD * 1.3],
        raio: 0.05,
        afunilar: 0.22,
        matriz: em(pivo, mat([0, -0.17, 0])),
      },
    ],
    livres: [],
    pele,
    pintar,
    corBase: cor,
  };
};

/* ———————————————————— femininas (13/10/2026) ———————————————————— */

/** A 2ª cor quando ela aparece no tecido; senão um tom claro do próprio tecido. */
export const segundaCor = (c: AvatarConfig, cor: string) =>
  contrasta(c.corRoupa2, cor) ? c.corRoupa2 : clarear(cor, 0.5);

/** Topo/base da saia: o topo fica quase todo dentro do tronco; a base é a boca (sombra). */
export function facesEscondidasDaSaia(f: CtxFace, cor: string): boolean {
  if (f.face === "py") {
    volume(f, { luz: 0.04, sombra: 0.14, bordas: 0.1, contorno: 0.15 });
    return true;
  }
  if (f.face === "ny") {
    escurecerTudo(f, 0.55, cor);
    return true;
  }
  return false;
}

/** Saia rodada (godê): ondas largas, cós na cintura e fita na barra na 2ª cor. */
const saiaRodada: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const fita = segundaCor(c, cor);
  const linha = corDaLinha(cor);
  const s = resolverSaia(m, e, c.sapato, {
    comp: 0.1 + m.pernaH * 0.4,
    larg: 1,
    fundo: 1,
    afunilar: 0.34,
    cintura: 0.12,
  });
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    base(f, cor);
    pano(f, "ruido", 0.6);
    if (facesEscondidasDaSaia(f, cor)) return;
    const y0 = yQueAparece(m, e, s, f.face);
    pregas(f, 0.085, 1.1, y0);
    // fita de gorgorão na barra: faixa larga + filete fino acima
    g.fillStyle = fita;
    g.fillRect(-0.1, h - 0.07, w + 0.2, 0.03);
    g.fillRect(-0.1, h - 0.092, w + 0.2, Math.max(0.006, pxs(f, 2)));
    oclusao(f, -0.1, h - 0.04, w + 0.2, 0.012, "cima", 0.2);
    cosDeSaia(f, cor, y0 + 0.045, linha);
    volume(f, { luz: 0.1, sombra: 0.22, bordas: 0.04 });
  };
  return {
    partes: [parteSaia(m, e, s)],
    livres: [],
    pele: pernasDePele(m, e, c.sapato),
    pintar,
    corBase: cor,
  };
};

/** Saia lápis: reta até o joelho, cintura alta, pences na frente e fenda atrás. */
const saiaLapis: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const linha = escurecer(cor, 0.3);
  const s = resolverSaia(m, e, c.sapato, {
    comp: 0.1 + m.pernaH * 0.52,
    larg: 1.06,
    fundo: 1.1,
    afunilar: 0.04,
  });
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    base(f, cor);
    pano(f, "brim");
    if (facesEscondidasDaSaia(f, cor)) return;
    const y0 = yQueAparece(m, e, s, f.face);
    cosDeSaia(f, cor, y0 + 0.055, linha);
    if (f.face === "pz") {
      // pences + dois botões dourados no cós
      for (const x of [w * 0.3, w * 0.7]) {
        emenda(
          f,
          [
            [x, y0 + 0.06],
            [x + (x < w / 2 ? 0.006 : -0.006), y0 + 0.2],
          ],
          0.25,
        );
      }
      for (const x of [w * 0.44, w * 0.56]) botao(f, x, y0 + 0.028, 0.009, "#d4a72c");
      dobra(f, [w * 0.2, h * 0.55, w * 0.5, h * 0.53, w * 0.8, h * 0.56], 0.009, 0.12);
    } else if (f.face === "nz") {
      // costura do meio com a fenda na barra
      emenda(
        f,
        [
          [w / 2, y0 + 0.06],
          [w / 2, h - 0.12],
        ],
        0.25,
      );
      g.fillStyle = "rgba(0,0,0,0.5)";
      g.fillRect(w / 2 - 0.004, h - 0.12, 0.008, 0.2);
      oclusao(f, w / 2, h - 0.12, 0.03, 0.12, "esq", 0.25);
    } else {
      emenda(
        f,
        [
          [w / 2, -0.1],
          [w / 2, h + 0.1],
        ],
        0.25,
      );
    }
    costura(
      f,
      [
        [-0.1, h - 0.025],
        [w + 0.1, h - 0.025],
      ],
      linha,
      { traco: 0.006 },
    );
    volume(f, { luz: 0.1, sombra: 0.18, bordas: 0.1 });
  };
  return {
    partes: [parteSaia(m, e, s)],
    livres: [],
    pele: pernasDePele(m, e, c.sapato),
    pintar,
    rugosidade: 0.7,
    corBase: cor,
  };
};

/** Saia jeans curtinha: sarja desbotada, cós com botão, bolsos e barra desfiada. */
const saiaJeans: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const s = resolverSaia(m, e, c.sapato, {
    comp: 0.1 + m.pernaH * 0.34,
    larg: 1.12,
    fundo: 1.18,
    afunilar: 0.1,
  });
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    base(f, cor);
    pano(f, "sarja");
    if (facesEscondidasDaSaia(f, cor)) return;
    const y0 = yQueAparece(m, e, s, f.face);
    desbotar(f, cor, w / 2, h * 0.55, w * 0.45, h * 0.35, 0.45);
    cosDeSaia(f, cor, y0 + 0.06, LARANJA);
    // passantes do cós
    for (const p of f.face === "pz" || f.face === "nz" ? [0.2, 0.8] : [0.5]) {
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(w * p - 0.008, y0 - 0.005, 0.02, 0.07);
      g.fillStyle = clarear(cor, 0.06);
      g.fillRect(w * p - 0.01, y0 - 0.005, 0.02, 0.07);
    }
    if (f.face === "pz") {
      // botão de cobre, braguilha e os bolsos em curva
      g.fillStyle = "#b87333";
      g.beginPath();
      g.arc(w / 2, y0 + 0.03, 0.013, 0, Math.PI * 2);
      g.fill();
      costura(
        f,
        [
          [w / 2 + 0.03, y0 + 0.06],
          [w / 2 + 0.03, y0 + 0.17],
          [w / 2 + 0.005, y0 + 0.2],
        ],
        LARANJA,
      );
      emenda(
        f,
        [
          [w / 2, y0 + 0.06],
          [w / 2, h + 0.1],
        ],
        0.3,
      );
      for (const sx of [-1, 1]) {
        const xe = sx < 0 ? 0 : w;
        costura(
          f,
          curvaPts(xe - sx * 0.1, y0 + 0.06, xe - sx * 0.09, y0 + 0.13, xe, y0 + 0.15),
          LARANJA,
          {
            duplo: 0.006,
          },
        );
        rebite(f, xe - sx * 0.012, y0 + 0.148);
      }
    } else if (f.face === "nz") {
      for (const bx of [w * 0.28, w * 0.72]) {
        const pts: [number, number][] = [
          [bx - 0.055, y0 + 0.09],
          [bx + 0.055, y0 + 0.09],
          [bx + 0.05, y0 + 0.19],
          [bx, y0 + 0.21],
          [bx - 0.05, y0 + 0.19],
        ];
        sombraDe(f, () => poligono(g, pts), 0.002, 0.004, 0.25);
        g.fillStyle = alfa(escurecer(cor, 0.1), 0.6);
        poligono(g, pts);
        g.fill();
        costura(f, [...pts, pts[0]!], LARANJA);
      }
    }
    // barra desfiada: fiapos claros pendurados
    const fio = clarear(cor, 0.6);
    g.fillStyle = alfa(fio, 0.8);
    for (let x = -f.faixa % 0.009; x < w; x += 0.009) {
      g.fillRect(x, h - 0.022, Math.max(0.0025, pxs(f, 1)), 0.03);
    }
    g.fillStyle = alfa(fio, 0.35);
    g.fillRect(-0.1, h - 0.03, w + 0.2, 0.008);
    volume(f, { luz: 0.08, sombra: 0.18, bordas: 0.12 });
  };
  return {
    partes: [parteSaia(m, e, s)],
    livres: [],
    pele: pernasDePele(m, e, c.sapato),
    pintar,
    corBase: cor,
  };
};

/** Legging: justa, brilho de lycra, cós largo de elástico e listra lateral na 2ª cor. */
const legging: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const alto = m.pernaH - alturaDoCalcado(c.sapato, m);
  const listra = contrasta(c.corRoupa2, cor) ? c.corRoupa2 : null;
  const linha = corDaLinha(cor);
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    base(f, cor);
    pano(f, "ruido", 0.4);
    if (f.parte === "cos") {
      if (f.face === "py" || f.face === "ny") return;
      for (const y of [0.012, h - 0.012])
        costura(
          f,
          [
            [-0.1, y],
            [w + 0.1, y],
          ],
          linha,
          { duplo: 0.005 },
        );
      return volume(f, { luz: 0.16, sombra: 0.2, bordas: 0.06 });
    }
    if (f.face === "py") return volume(f, { luz: 0.04, sombra: 0.14, bordas: 0.1, contorno: 0.15 });
    if (f.face === "ny") return escurecerTudo(f, 0.5, cor);
    // o brilho da lycra: faixa clara no meio da face, esfumada
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, "rgba(255,255,255,0)");
    gr.addColorStop(0.45, "rgba(255,255,255,0.16)");
    gr.addColorStop(0.55, "rgba(255,255,255,0.16)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(-0.1, -0.1, w + 0.2, h + 0.2);
    if (listra && f.face === faceExterna(f.lado)) {
      g.fillStyle = listra;
      g.fillRect(w / 2 - 0.014, -0.1, 0.028, h + 0.2);
      g.fillStyle = "rgba(0,0,0,0.2)";
      g.fillRect(w / 2 + 0.014, -0.1, Math.max(0.003, pxs(f, 1.5)), h + 0.2);
    }
    if (f.face === faceInterna(f.lado))
      emenda(
        f,
        [
          [w / 2, 0],
          [w / 2, h],
        ],
        0.25,
      );
    // franzido no tornozelo
    dobra(f, [w * 0.15, h - 0.05, w * 0.5, h - 0.065, w * 0.85, h - 0.045], 0.007, 0.16);
    dobra(f, [w * 0.2, h * 0.52, w * 0.5, h * 0.5, w * 0.8, h * 0.53], 0.007, 0.1);
    volume(f, { luz: 0.12, sombra: 0.16, bordas: 0.18, base: cor });
  };
  return {
    partes: [...pernasDaCalca(m, e, alto), ...cosSeVisivel(m, e, c)],
    livres: [],
    pintar,
    rugosidade: 0.5,
    corBase: cor,
  };
};

/** Shortinho jeans: bem curto, bolso em curva, barra desfiada e pernas de fora. */
const shortinho: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = c.corCalca;
  const comp = m.pernaH - alturaDoCalcado(c.sapato, m);
  const alto = Math.max(0.09, comp * 0.2);
  const fio = clarear(cor, 0.6);
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    if (f.parte === "cos")
      return pintarCos(f, cor, LARANJA, "sarja", { botao: "#a8874f", etiqueta: true });
    base(f, cor);
    pano(f, "sarja");
    if (f.face === "py") return volume(f, { luz: 0.04, sombra: 0.14, bordas: 0.1, contorno: 0.15 });
    if (f.face === "ny") return escurecerTudo(f, 0.5, cor);
    desbotar(f, cor, w / 2, h * 0.5, w * 0.5, h * 0.5, 0.45);
    if (f.face === "pz") {
      const xi = xInterno(f);
      const xe = w - xi;
      const sx = xe > xi ? 1 : -1;
      costura(f, curvaPts(xe - sx * 0.1, 0, xe - sx * 0.088, 0.06, xe, 0.075), LARANJA, {
        duplo: 0.006,
      });
      rebite(f, xe - sx * 0.008, 0.07);
    } else if (ehLateral(f.face)) {
      emenda(
        f,
        [
          [w / 2, -0.1],
          [w / 2, h + 0.1],
        ],
        0.3,
      );
    }
    // barra desfiada (fiapos) com o rasgadinho claro em cima
    g.fillStyle = alfa(fio, 0.85);
    for (let x = -f.faixa % 0.008; x < w; x += 0.008) {
      g.fillRect(x, h - 0.02, Math.max(0.0025, pxs(f, 1)), 0.03);
    }
    g.fillStyle = alfa(fio, 0.4);
    g.fillRect(-0.1, h - 0.028, w + 0.2, 0.008);
    volume(f, { luz: 0.06, sombra: 0.14, bordas: 0.14 });
  };
  return {
    partes: [...pernasDaCalca(m, e, alto, { baseVisivel: true }), ...cosSeVisivel(m, e, c)],
    livres: [],
    pele: canelasDePele(m, e, c.sapato, alto),
    pintar,
    corBase: cor,
  };
};

/**
 * Pantalona: perna larga e reta com a BOCA em sino (bloco afunilado no fim
 * da perna). Perna e boca só crescem para FORA e para a frente/trás: a borda
 * de dentro fica onde estava, senão as duas pernas se sobrepunham com as
 * frentes coplanares (z-fighting). A boca desce sobre o calçado (só o bico
 * aparece). Serve também às pernas do macacão (cor da roupa, sem cós).
 */
function pantalonaDe(corDe: (c: AvatarConfig) => string, comCos: boolean): CriarPeca {
  return (m, c, _q, pose) => {
    const e = esqueleto(m, pose);
    const cor = piso(corDe(c));
    const linha = corDaLinha(cor);
    const calcado = alturaDoCalcado(c.sapato, m);
    const alto = m.pernaH - calcado;
    const desce = Math.max(0, Math.min(calcado - 0.05, 0.09));
    const hb = Math.min(0.32, alto * 0.45) + desce;
    const pernaW = m.pernaW + 0.006;
    const bocaW = m.pernaW + 0.08;
    const partes: ParteMolde[] = [];
    for (const l of LADOS) {
      partes.push({
        nome: nomeLado("perna", l),
        tam: [pernaW, alto, m.pernaW + 0.03],
        raio: 0.05,
        lado: l,
        semFaces: ["ny"],
        matriz: em(e.perna(l), mat([0.003 * l, -alto / 2, 0])),
      });
      partes.push({
        nome: nomeLado("boca", l),
        tam: [bocaW, hb, m.pernaW + 0.12],
        raio: 0.05,
        lado: l,
        afunilar: 0.3,
        matriz: em(e.perna(l), mat([((bocaW - m.pernaW) / 2) * l, -alto - desce + hb / 2, 0])),
      });
    }
    const vinco = (f: CtxFace, x: number) => {
      const gr = f.g.createLinearGradient(x - 0.03, 0, x + 0.03, 0);
      gr.addColorStop(0, "rgba(0,0,0,0)");
      gr.addColorStop(0.45, "rgba(0,0,0,0.14)");
      gr.addColorStop(0.5, "rgba(255,255,255,0.16)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      f.g.fillStyle = gr;
      f.g.fillRect(x - 0.03, -0.1, 0.06, f.h + 0.2);
    };
    const pintar: Pintor = (f) => {
      const { w, h } = f;
      if (f.parte === "cos") return pintarCos(f, cor, linha, "brim");
      base(f, cor);
      pano(f, "brim", 0.7);
      if (f.face === "py")
        return volume(f, { luz: 0.04, sombra: 0.14, bordas: 0.1, contorno: 0.15 });
      if (f.face === "ny") return escurecerTudo(f, 0.55, cor);
      if (f.parte.startsWith("boca")) {
        // o sino: godê largo, vinco que continua e a barra pespontada
        pregas(f, 0.06, 0.9);
        if (f.face === "pz" || f.face === "nz") vinco(f, w / 2);
        costura(
          f,
          [
            [-0.1, h - 0.022],
            [w + 0.1, h - 0.022],
          ],
          linha,
        );
        return volume(f, { luz: 0.06, sombra: 0.22, bordas: 0.1, cor: "#000000" });
      }
      if (f.face === "pz" || f.face === "nz") {
        vinco(f, w / 2);
        if (f.face === "pz") {
          // pregas na cintura
          dobra(f, [w * 0.32, 0.02, w * 0.34, 0.08, w * 0.32, 0.14], 0.008, 0.14);
          dobra(f, [w * 0.68, 0.02, w * 0.66, 0.08, w * 0.68, 0.14], 0.008, 0.14);
        }
      } else
        emenda(
          f,
          [
            [w / 2, -0.1],
            [w / 2, h + 0.1],
          ],
          0.25,
        );
      dobra(f, [w * 0.2, h * 0.5, w * 0.5, h * 0.48, w * 0.8, h * 0.51], 0.01, 0.1);
      volume(f, { luz: 0.08, sombra: 0.16, bordas: 0.12 });
    };
    return {
      partes: comCos ? [...partes, ...cosSeVisivel(m, e, c)] : partes,
      livres: [],
      pintar,
      rugosidade: 0.75,
      corBase: cor,
    };
  };
}

const pantalona = pantalonaDe((c) => c.corCalca, true);

/**
 * O forro do vestido: um shortinho curto na cor do vestido (some embaixo da
 * saia em pé; sentado, fecha o quadril por trás, onde a saia deitada sobre
 * as coxas não chega) e as pernas de pele até o calçado.
 */
const forroDoVestido: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(escurecer(c.corRoupa, 0.1));
  const alto = 0.1;
  const pintar: Pintor = (f) => {
    base(f, cor);
    pano(f, "ruido", 0.5);
    if (f.face === "ny") return escurecerTudo(f, 0.5, cor);
    volume(f, { luz: 0.06, sombra: 0.2, bordas: 0.1 });
  };
  return {
    partes: pernasDaCalca(m, e, alto, { baseVisivel: true }),
    livres: [],
    pele: canelasDePele(m, e, c.sapato, alto),
    pintar,
    corBase: cor,
  };
};

export const PECAS_BAIXO: Record<AvatarConfig["calca"], CriarPeca> = {
  jeans,
  social: calcaSocial,
  cargo,
  jogger,
  bermuda,
  saia,
  saiaRodada,
  saiaLapis,
  legging,
  short: shortinho,
  pantalona,
  saiaJeans,
  // Novas (16/10/2026): ver `pecas-baixo-extras.ts`.
  ...PECAS_BAIXO_EXTRAS,
};

/**
 * A parte de baixo das roupas de corpo inteiro (`ROUPA_INTEIRA`): a calça
 * guardada é ignorada e as pernas saem daqui — pele embaixo do vestido,
 * pantalona na cor da roupa no macacão.
 */
const BAIXO_DA_INTEIRA: Record<string, CriarPeca> = {
  vestido: forroDoVestido,
  vestidoLongo: forroDoVestido,
  macacao: pantalonaDe((c) => c.corRoupa, false),
  // vestidos e jardineira novos da parte de cima (16/10/2026)
  vestidoTule: forroDoVestido,
  vestidoFloral: forroDoVestido,
  jardineira: forroDoVestido,
};

/** A peça de baixo que o avatar veste de fato (a calça, ou a da roupa inteira). */
export function pecaDeBaixo(c: AvatarConfig): { tipo: string; criar: CriarPeca } {
  if (ROUPA_INTEIRA.has(c.roupa) && BAIXO_DA_INTEIRA[c.roupa])
    return { tipo: `inteira-${c.roupa}`, criar: BAIXO_DA_INTEIRA[c.roupa]! };
  return { tipo: c.calca, criar: PECAS_BAIXO[c.calca] };
}

/** Chave do que muda o desenho da parte de baixo (R2.5). */
export function chaveDeBaixo(c: AvatarConfig): string {
  if (ROUPA_INTEIRA.has(c.roupa)) return `baixo|inteira-${c.roupa}|${c.corRoupa}|${c.sapato}`;
  // a parte de cima que cobre o cós muda a FORMA (sem cós nem cinto)
  const coberto = COBRE_O_COS.has(c.roupa) ? "coberto" : "";
  // as novas que mostram a pele na textura (rasgo, meia-calça) levam a cor dela (16/10/2026)
  const pele = PELE_NA_TEXTURA_BAIXO.has(c.calca) ? `|${c.pele}` : "";
  return `baixo|${c.calca}|${c.corCalca}|${c.corRoupa2}|${c.sapato}|${coberto}${pele}`;
}

export type { Peca };
