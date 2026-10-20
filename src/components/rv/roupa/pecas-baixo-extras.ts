import type { EXTRAS_CALCA } from "@/lib/avatar-catalogo/baixo";
import type { Medidas } from "@/components/rv/medidas";
import type { Face } from "./caixa-roupa";
import type { CtxFace, ParteMolde, Pintor } from "./molde";
import {
  LADOS,
  alturaDoCalcado,
  ehLateral,
  em,
  esqueleto,
  faceExterna,
  faceInterna,
  mat,
  nomeLado,
  pernasDaCalca,
  type CriarPeca,
  type Esqueleto,
} from "./peca";
import {
  canelasDePele,
  cosDeSaia,
  parteSaia,
  pernasDePele,
  pregas,
  resolverSaia,
  yQueAparece,
  type SaiaResolvida,
} from "./saias";
import {
  alfa,
  base,
  botao,
  canelado,
  clarear,
  contrasta,
  corDaLinha,
  costura,
  curvaPts,
  dobra,
  emenda,
  escurecer,
  escurecerTudo,
  ilhos,
  luminancia,
  misturar,
  oclusao,
  pano,
  piso,
  poligono,
  pxs,
  rebite,
  refletivo,
  sombraDe,
  volume,
  xadrezContinuo,
  ziper,
} from "./pincel";
import {
  LARANJA,
  PECAS_BAIXO,
  cintoSeVisivel,
  cosSeVisivel,
  desbotar,
  facesEscondidasDaSaia,
  pintarCinto,
  pintarCos,
  segundaCor,
  xInterno,
} from "./pecas-baixo";

/**
 * PARTES DE BAIXO NOVAS (16/10/2026: "crie pelo menos mais 10 de cada, bem
 * criativo e dinâmico, baseado em Roblox"). Tudo sai das `Medidas` (serve a
 * qualquer tipo de corpo) e do mesmo esqueleto de `peca.ts` (em pé e
 * sentado). As saias usam `resolverSaia`/`parteSaia`: sentada, a saia deita
 * sobre as coxas e nada atravessa a cadeira.
 *
 * As que só mudam o DESENHO de uma peça antiga (cargo camuflada, jeans
 * rasgado, short com meia-calça) reaproveitam a forma dela e pintam por
 * cima — a malha fica idêntica, só o atlas muda.
 *
 * `pecas-baixo.ts` importa este arquivo (e este importa os pincéis de lá):
 * o ciclo é seguro porque nada aqui usa o que vem de lá fora das funções.
 */

export type CalcaExtra = (typeof EXTRAS_CALCA)[number]["v"];

/** As que pintam a cor da pele na textura (rasgo, meia-calça): a pele entra na chave. */
export const PELE_NA_TEXTURA_BAIXO: ReadonlySet<string> = new Set<CalcaExtra>([
  "jeansRasgado",
  "shortMeiaCalca",
]);

/* ———————————————————— utilidades ———————————————————— */

/** Ruído determinístico em [0, 1) por célula (o mesmo desenho em todo computador). */
function ruido(a: number, b: number, s = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(s | 0, 9301)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Chama `cb` em cada célula de uma grade (com tremida) que continua na volta
 * do bloco (pela `faixa`): manchas, estrelinhas e pintas não cortam na quina.
 */
function emCelulas(
  f: CtxFace,
  passo: number,
  cb: (x: number, y: number, r: number, i: number, j: number) => void,
  semente = 0,
) {
  const i0 = Math.floor((f.faixa - passo * 2) / passo);
  const i1 = Math.ceil((f.faixa + f.w + passo * 2) / passo);
  const j1 = Math.ceil(f.h / passo) + 2;
  const s = semente + (f.lado > 0 ? 101 : 0) + (f.face === "py" ? 7 : f.face === "ny" ? 13 : 0);
  for (let j = -2; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = i * passo - f.faixa + (ruido(i, j, s + 1) - 0.5) * passo * 0.6;
      const y = j * passo + (ruido(i, j, s + 2) - 0.5) * passo * 0.6;
      cb(x, y, ruido(i, j, s), i, j);
    }
  }
}

/** Topo e base da perna (dentro do quadril / boca): o tratamento de sempre. */
function facesEscondidasDaPerna(f: CtxFace, cor: string): boolean {
  if (f.face === "py") {
    volume(f, { luz: 0.04, sombra: 0.14, bordas: 0.1, contorno: 0.15 });
    return true;
  }
  if (f.face === "ny") {
    escurecerTudo(f, 0.5, cor);
    return true;
  }
  return false;
}

/** Linha reta (atalho do pesponto horizontal/vertical). */
const reta = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y1],
];

/** Brilho de tecido sintético (tactel, lycra, cetim): faixa clara vertical no meio da face. */
function brilhoVertical(f: CtxFace, a: number, larg = 0.1) {
  const { g, w, h } = f;
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, "rgba(255,255,255,0)");
  gr.addColorStop(0.5 - larg, "rgba(255,255,255,0)");
  gr.addColorStop(0.5, `rgba(255,255,255,${a})`);
  gr.addColorStop(0.5 + larg, "rgba(255,255,255,0)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(-0.1, -0.1, w + 0.2, h + 0.2);
}

/** Bolso 3D na lateral de fora da coxa + a lapela por cima (cargo, bermuda cargo). */
function bolsosLaterais(
  m: Medidas,
  e: Esqueleto,
  y: number,
  tam: [number, number, number],
): ParteMolde[] {
  const out: ParteMolde[] = [];
  for (const l of LADOS) {
    const x = l * (m.pernaW / 2 + tam[0] / 2 - 0.003);
    out.push({
      nome: nomeLado("bolso", l),
      tam,
      raio: 0.008,
      lado: l,
      matriz: em(e.perna(l), mat([x, y, 0])),
    });
    out.push({
      nome: nomeLado("lapela", l),
      tam: [tam[0] + 0.008, 0.04, tam[2] + 0.01],
      raio: 0.008,
      lado: l,
      matriz: em(e.perna(l), mat([x + l * 0.004, y + tam[1] / 2 - 0.018, 0])),
    });
  }
  return out;
}

/** Pinta o bolso lateral e a lapela (true se a face era deles). */
function pintarBolsoLateral(f: CtxFace, cor: string, linha: string): boolean {
  const { g, w, h } = f;
  if (f.parte.startsWith("bolso")) {
    base(f, cor);
    pano(f, "brim");
    if (f.face !== faceExterna(f.lado)) {
      volume(f, { luz: 0.05, sombra: 0.25, bordas: 0.1 });
      return true;
    }
    g.fillStyle = alfa(escurecer(cor, 0.2), 0.4);
    g.fillRect(w / 2 - 0.016, -0.1, 0.032, h + 0.2);
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
    volume(f, { luz: 0.1, sombra: 0.2, bordas: 0.12, contorno: 0.3 });
    return true;
  }
  if (f.parte.startsWith("lapela")) {
    base(f, escurecer(cor, 0.1));
    pano(f, "brim");
    if (f.face === faceExterna(f.lado)) {
      costura(f, reta(0.01, h - 0.009, w - 0.01, h - 0.009), linha, { traco: 0.006 });
      botao(f, w / 2, h * 0.55, 0.008, escurecer(cor, 0.45));
    }
    volume(f, { luz: 0.14, sombra: 0.28, bordas: 0.1, contorno: 0.35 });
    return true;
  }
  return false;
}

/* ———————————————————— BRIM DE CAMPO (agro / EPI) ———————————————————— */

/**
 * Calça de brim de trabalho do campo: joelheiras 3D de borracha (na 2ª cor),
 * a tira elástica delas em volta do joelho, bolso de trena na coxa, faixa
 * refletiva na canela (acende, como o colete EPI) e cinto tático.
 */
const brimCampo: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const linha = corDaLinha(cor);
  const reforco = escurecer(cor, 0.12);
  const alto = m.pernaH - alturaDoCalcado(c.sapato, m);
  const almofada = contrasta(c.corRoupa2, cor) ? piso(c.corRoupa2) : "#3a3f47";
  // o joelho fica no meio da perna; com bota alta, sobe para não colar nela
  const hJ = Math.min(0.14, alto * 0.32);
  const yJ = Math.min(m.pernaH * 0.46, alto - hJ / 2 - 0.03);
  const frente = (m.pernaW + 0.02) / 2;
  const joelheiras: ParteMolde[] = LADOS.map((l) => ({
    nome: nomeLado("joelheira", l),
    tam: [m.pernaW * 0.8, hJ, 0.03],
    raio: 0.012,
    lado: l,
    matriz: em(e.perna(l), mat([0, -yJ, frente + 0.011])),
  }));
  // faixa refletiva na canela, só se couber entre a joelheira e o calçado
  const hR = 0.032;
  const yR = alto - 0.11;
  const temRefletivo = yR - (yJ + hJ / 2) > 0.02;
  const ehPerna = (f: CtxFace) => f.parte.startsWith("perna");

  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    if (f.parte === "cos") return pintarCos(f, cor, linha, "brim");
    if (f.parte === "cinto") return pintarCinto(f, "#23262b", "tatico");
    if (f.parte.startsWith("joelheira")) {
      base(f, almofada);
      pano(f, "couro", 0.5);
      if (f.face === "pz") {
        // gomos de borracha e os rebites dos cantos
        for (let i = 1; i < 4; i++) {
          const y = (h * i) / 4;
          g.fillStyle = "rgba(0,0,0,0.35)";
          g.fillRect(0.012, y - pxs(f, 1.5), w - 0.024, Math.max(0.004, pxs(f, 2.5)));
          g.fillStyle = "rgba(255,255,255,0.14)";
          g.fillRect(0.012, y + pxs(f, 1.5), w - 0.024, Math.max(0.002, pxs(f, 1)));
        }
        for (const [x, y] of [
          [0.016, 0.014],
          [w - 0.016, 0.014],
          [0.016, h - 0.014],
          [w - 0.016, h - 0.014],
        ] as const)
          ilhos(f, x, y, 0.005, "#c0c6ce");
      }
      return volume(f, { luz: 0.2, sombra: 0.25, bordas: 0.12, contorno: 0.35, base: almofada });
    }
    base(f, cor);
    pano(f, "brim");
    if (facesEscondidasDaPerna(f, cor)) return;
    // a tira elástica da joelheira dá a volta no joelho (por trás e dos lados)
    if (f.face !== "pz") {
      const yt = yJ - 0.016;
      g.fillStyle = "#1f2227";
      g.fillRect(-0.1, yt, w + 0.2, 0.032);
      g.fillStyle = "rgba(255,255,255,0.08)";
      for (let x = -0.1; x < w + 0.1; x += 0.012) g.fillRect(x, yt, pxs(f, 1), 0.032);
      oclusao(f, -0.1, yt + 0.032, w + 0.2, 0.014, "cima", 0.3);
      if (f.face === faceExterna(f.lado)) {
        // a fivela de engate rápido
        g.fillStyle = "#3f4650";
        g.beginPath();
        g.roundRect(w / 2 - 0.022, yt - 0.006, 0.044, 0.044, 0.006);
        g.fill();
        g.fillStyle = "#6b7280";
        g.fillRect(w / 2 - 0.014, yt + 0.012, 0.028, 0.008);
      }
    }
    if (f.face === "pz") {
      const xi = xInterno(f);
      const xe = w - xi;
      const s = xe > xi ? 1 : -1;
      g.strokeStyle = "rgba(0,0,0,0.45)";
      g.lineWidth = Math.max(0.006, pxs(f, 2));
      g.beginPath();
      g.moveTo(xe - s * 0.07, -0.01);
      g.quadraticCurveTo(xe - s * 0.06, 0.09, xe, 0.12);
      g.stroke();
      costura(f, curvaPts(xe - s * 0.06, -0.01, xe - s * 0.05, 0.085, xe, 0.11), linha);
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
      // a sombra que a joelheira projeta embaixo dela
      oclusao(f, 0.02, yJ + hJ / 2, w - 0.04, 0.03, "cima", 0.3);
      dobra(f, [w * 0.2, 0.22, w * 0.45, 0.25, w * 0.75, 0.23], 0.008, 0.1);
    } else if (f.face === "nz") {
      // bolso chapado com reforço em travete
      const xi = xInterno(f);
      const s = xi > w / 2 ? -1 : 1;
      const bx = w / 2 + s * 0.008;
      sombraDe(f, () => g.rect(bx - 0.06, 0.08, 0.12, 0.13), 0.002, 0.004, 0.2);
      g.fillStyle = reforco;
      g.fillRect(bx - 0.06, 0.08, 0.12, 0.13);
      costura(
        f,
        [
          [bx - 0.054, 0.086],
          [bx - 0.054, 0.204],
          [bx + 0.054, 0.204],
          [bx + 0.054, 0.086],
        ],
        linha,
        { duplo: 0.005 },
      );
    } else {
      emenda(f, reta(w / 2, -0.1, w / 2, h + 0.1), 0.3);
      costura(f, reta(w / 2 + 0.006, 0, w / 2 + 0.006, h - 0.03), linha, { duplo: 0.005 });
      if (f.face === faceExterna(f.lado)) {
        // bolso de trena/canivete na coxa, com lapela e velcro
        const bx = w / 2 - 0.05;
        const by = 0.14;
        sombraDe(f, () => g.rect(bx, by, 0.1, 0.13), 0.002, 0.004, 0.25);
        g.fillStyle = reforco;
        g.fillRect(bx, by, 0.1, 0.13);
        costura(
          f,
          [
            [bx + 0.006, by],
            [bx + 0.006, by + 0.124],
            [bx + 0.094, by + 0.124],
            [bx + 0.094, by],
          ],
          linha,
        );
        g.fillStyle = escurecer(cor, 0.2);
        g.fillRect(bx - 0.004, by - 0.006, 0.108, 0.04);
        oclusao(f, bx, by + 0.034, 0.1, 0.012, "cima", 0.35);
      }
    }
    if (temRefletivo) {
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(-0.1, yR - 0.006, w + 0.2, 0.006);
      refletivo(f, -0.1, yR, w + 0.2, hR);
    }
    costura(f, reta(-0.1, h - 0.02, w + 0.1, h - 0.02), linha);
    volume(f, { luz: 0.08, sombra: 0.16, bordas: 0.12 });
  };
  const mascara: Pintor = (f) => {
    if (!temRefletivo || !ehPerna(f) || f.face === "py" || f.face === "ny") return;
    refletivo(f, -0.1, yR, f.w + 0.2, hR);
  };
  return {
    partes: [...pernasDaCalca(m, e, alto), ...cosSeVisivel(m, e, c), ...joelheiras],
    aneis: cintoSeVisivel(m, e, c),
    livres: [],
    pintar,
    mascara,
    emissivoFaixas: temRefletivo,
    rugosidade: 0.8,
    corBase: cor,
  };
};

/* ———————————————————— CARGO CAMUFLADA ———————————————————— */

/** Uma mancha irregular e deitada: 6 círculos sorteados ao longo de uma elipse. */
function mancha(f: CtxFace, x: number, y: number, r: number, k: number) {
  const { g } = f;
  const giro = (ruido(k, 0, 1) - 0.5) * 1.2;
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const t = (i / 5 - 0.5) * 2;
    const dx = t * r * 1.3 + (ruido(k, i, 5) - 0.5) * r * 0.5;
    const dy = (ruido(k, i, 7) - 0.5) * r * 0.9;
    const cx = x + dx * Math.cos(giro) - dy * Math.sin(giro);
    const cy = y + dx * Math.sin(giro) + dy * Math.cos(giro);
    const rr = r * (0.42 + 0.38 * ruido(k, i, 9)) * (1 - Math.abs(t) * 0.35);
    g.moveTo(cx + rr, cy);
    g.arc(cx, cy, rr, 0, Math.PI * 2);
  }
  g.fill();
}

/**
 * Camuflagem de mata pintada POR CIMA da peça pronta: manchas grandes na
 * 2ª cor, marrons e pretas (multiplicar) e claras (tela). Por cima do
 * sombreado e das costuras, então o volume e os bolsos continuam aparecendo.
 */
function camuflar(f: CtxFace, segunda: string) {
  const { g } = f;
  g.save();
  g.globalCompositeOperation = "multiply";
  const camadas: [string, number, number, number][] = [
    [misturar(segunda, "#8f8a6c", 0.4), 0.13, 0.6, 0.06],
    ["#7a6a52", 0.11, 0.45, 0.045],
    ["#3a372e", 0.09, 0.4, 0.026],
  ];
  camadas.forEach(([cor, passo, p, r], n) => {
    g.fillStyle = cor;
    emCelulas(
      f,
      passo,
      (x, y, sorte, i, j) => {
        if (sorte < p) mancha(f, x, y, r, i * 31 + j * 7 + n * 1000);
      },
      n * 40,
    );
  });
  g.globalCompositeOperation = "screen";
  g.fillStyle = "rgba(110,104,78,0.6)";
  emCelulas(
    f,
    0.12,
    (x, y, sorte, i, j) => {
      if (sorte < 0.35) mancha(f, x, y, 0.035, i * 13 + j * 5 + 5000);
    },
    160,
  );
  g.restore();
}

const cargoCamuflada: CriarPeca = (m, c, q, pose) => {
  const p = PECAS_BAIXO.cargo(m, c, q, pose);
  const segunda = contrasta(c.corRoupa2, c.corCalca) ? c.corRoupa2 : "#c8c19a";
  return {
    ...p,
    pintar: (f) => {
      p.pintar(f);
      if (f.parte === "cinto" || f.face === "ny") return;
      camuflar(f, segunda);
    },
  };
};

/* ———————————————————— AGASALHO COM FAIXA ———————————————————— */

/**
 * Calça de agasalho de tactel: faixa larga na lateral (2ª cor) com vivos,
 * bolso de zíper, zíper no tornozelo e punhos de ribana (anéis 3D).
 */
const calcaAgasalho: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const faixa = segundaCor(c, cor);
  const vivo = luminancia(faixa) > 0.6 ? escurecer(cor, 0.3) : "#f1f5f9";
  const linha = corDaLinha(cor);
  const alto = m.pernaH - alturaDoCalcado(c.sapato, m);
  const punhos: ParteMolde[] = LADOS.map((l) => ({
    nome: nomeLado("punho", l),
    tam: [m.pernaW + 0.012, 0.055, m.pernaW + 0.032],
    raio: 0.05,
    lado: l,
    ocultas: ["py", "ny"] as Face[],
    matriz: em(e.perna(l), mat([0, -alto + 0.0275, 0])),
  }));
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    base(f, cor);
    pano(f, "ruido", 0.5);
    if (f.parte === "cos") {
      if (f.face === "py" || f.face === "ny") return;
      canelado(f, -0.1, 0, w + 0.2, h, cor);
      if (f.face === "pz") {
        // o cordão saindo de dois ilhoses
        for (const s of [-1, 1]) {
          ilhos(f, w / 2 + s * 0.025, h * 0.45, 0.006);
          g.strokeStyle = faixa;
          g.lineWidth = 0.007;
          g.beginPath();
          g.moveTo(w / 2 + s * 0.025, h * 0.45);
          g.quadraticCurveTo(w / 2 + s * 0.035, h + 0.04, w / 2 + s * 0.02, h + 0.12);
          g.stroke();
        }
      }
      return volume(f, { luz: 0.08, sombra: 0.2, bordas: 0.06 });
    }
    if (f.parte.startsWith("punho")) {
      canelado(f, -0.1, -0.1, w + 0.2, h + 0.2, cor);
      return volume(f, { luz: 0.08, sombra: 0.2, bordas: 0.08 });
    }
    if (facesEscondidasDaPerna(f, cor)) return;
    brilhoVertical(f, 0.14, 0.22);
    if (f.face === faceExterna(f.lado)) {
      // a faixa com os vivos e o zíper do tornozelo
      const fw = Math.min(0.06, w * 0.24);
      g.fillStyle = faixa;
      g.fillRect(w / 2 - fw / 2, -0.1, fw, h + 0.2);
      g.fillStyle = vivo;
      g.fillRect(w / 2 - fw / 2 - 0.008, -0.1, 0.006, h + 0.2);
      g.fillRect(w / 2 + fw / 2 + 0.002, -0.1, 0.006, h + 0.2);
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.fillRect(w / 2 + fw / 2 + 0.008, -0.1, Math.max(0.003, pxs(f, 1.5)), h + 0.2);
      ziper(f, w / 2, h - Math.min(0.16, h * 0.3), h, faixa);
    } else if (f.face === "pz") {
      // bolso com zíper na diagonal
      const xi = xInterno(f);
      const xe = w - xi;
      const s = xe > xi ? 1 : -1;
      g.strokeStyle = "#2b2f36";
      g.lineWidth = 0.012;
      g.beginPath();
      g.moveTo(xe - s * 0.03, 0.06);
      g.lineTo(xe - s * 0.075, 0.2);
      g.stroke();
      g.strokeStyle = "#c7ccd3";
      g.lineWidth = Math.max(0.003, pxs(f, 1.5));
      g.setLineDash([0.004, 0.003]);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#c7ccd3";
      g.beginPath();
      g.roundRect(xe - s * 0.03 - 0.006, 0.055, 0.012, 0.03, 0.004);
      g.fill();
      dobra(f, [w * 0.15, h * 0.52, w * 0.5, h * 0.5, w * 0.85, h * 0.53], 0.01, 0.16);
    } else if (f.face === faceInterna(f.lado)) {
      costura(f, reta(w / 2, 0, w / 2, h), linha);
    }
    oclusao(f, -0.1, h - 0.07, w + 0.2, 0.04, "baixo", 0.3);
    dobra(f, [w * 0.12, h - 0.09, w * 0.5, h - 0.11, w * 0.88, h - 0.085], 0.009, 0.2);
    volume(f, { luz: 0.1, sombra: 0.18, bordas: 0.14, base: cor });
  };
  return {
    partes: [...pernasDaCalca(m, e, alto), ...cosSeVisivel(m, e, c)],
    aneis: punhos,
    livres: [],
    pintar,
    rugosidade: 0.5,
    corBase: cor,
  };
};

/* ———————————————————— JEANS RASGADO ———————————————————— */

/**
 * Um rasgo do jeans: a borda desfiada clara, a pele aparecendo e os fios
 * brancos da trama atravessando o buraco (o jeans destroyed do Roblox).
 */
function rasgo(
  f: CtxFace,
  pele: string,
  cor: string,
  cx: number,
  cy: number,
  rw: number,
  rh: number,
  k: number,
) {
  const { g } = f;
  const n = 12;
  const borda = (dentro: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([cx - rw / 2 + rw * t, cy - (rh / 2) * dentro - (ruido(k, i, 1) - 0.3) * rh * 0.7]);
    }
    for (let i = n; i >= 0; i--) {
      const t = i / n;
      pts.push([cx - rw / 2 + rw * t, cy + (rh / 2) * dentro + (ruido(k, i, 2) - 0.3) * rh * 0.7]);
    }
    return pts;
  };
  g.save();
  // franja desfiada (clara) em volta
  g.fillStyle = alfa(clarear(cor, 0.65), 0.9);
  poligono(g, borda(1.35));
  g.fill();
  // a pele
  g.fillStyle = escurecer(pele, 0.06);
  poligono(g, borda(1));
  g.fill();
  g.clip();
  oclusao(f, cx - rw, cy - rh, rw * 2, rh * 0.6, "cima", 0.3);
  // os fios da trama, levemente ondulados
  g.strokeStyle = "#eef2f7";
  g.lineWidth = Math.max(0.0025, pxs(f, 1.5));
  for (let y = cy - rh * 0.45; y < cy + rh * 0.6; y += Math.max(0.016, pxs(f, 6))) {
    g.beginPath();
    g.moveTo(cx - rw * 0.6, y);
    g.quadraticCurveTo(cx, y + 0.004 * (ruido(k, Math.round(y * 1000), 4) - 0.5), cx + rw * 0.6, y);
    g.stroke();
  }
  g.restore();
}

const jeansRasgado: CriarPeca = (m, c, q, pose) => {
  const p = PECAS_BAIXO.jeans(m, c, q, pose);
  const cor = c.corCalca;
  return {
    ...p,
    mostraPele: true,
    pintar: (f) => {
      p.pintar(f);
      if (!f.parte.startsWith("perna") || f.face !== "pz") return;
      const { w, h } = f;
      const k = f.lado > 0 ? 5 : 9;
      // joelho aberto nas duas pernas; rasgo na coxa numa, risquinhos na outra
      rasgo(f, c.pele, cor, w * 0.5, h * 0.52, w * 0.56, 0.06, k);
      if (f.lado > 0) rasgo(f, c.pele, cor, w * 0.42, h * 0.24, w * 0.34, 0.03, k + 1);
      else {
        rasgo(f, c.pele, cor, w * 0.58, h * 0.3, w * 0.22, 0.018, k + 2);
        rasgo(f, c.pele, cor, w * 0.45, h * 0.72, w * 0.2, 0.014, k + 3);
      }
    },
  };
};

/* ———————————————————— BERMUDA CARGO ———————————————————— */

const bermudaCargo: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const linha = corDaLinha(cor);
  const comp = m.pernaH - alturaDoCalcado(c.sapato, m);
  const alto = comp * 0.52;
  const tamBolso: [number, number, number] = [
    0.022,
    Math.min(0.12, alto * 0.4),
    Math.min(0.12, m.pernaW * 0.46),
  ];
  const yBolso = -alto * 0.56;
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    if (f.parte === "cos") return pintarCos(f, cor, linha, "brim");
    if (f.parte === "cinto") return pintarCinto(f, "#23262b", "tatico");
    if (pintarBolsoLateral(f, cor, linha)) return;
    base(f, cor);
    pano(f, "brim");
    if (facesEscondidasDaPerna(f, cor)) return;
    // barra dobrada
    g.fillStyle = alfa(escurecer(cor, 0.12), 0.6);
    g.fillRect(-0.1, h - 0.045, w + 0.2, 0.15);
    costura(f, reta(-0.1, h - 0.045, w + 0.1, h - 0.045), linha);
    oclusao(f, -0.1, h - 0.07, w + 0.2, 0.025, "baixo", 0.25);
    if (f.face === "pz") {
      const xi = xInterno(f);
      const xe = w - xi;
      const s = xe > xi ? 1 : -1;
      g.strokeStyle = "rgba(0,0,0,0.45)";
      g.lineWidth = Math.max(0.006, pxs(f, 2));
      g.beginPath();
      g.moveTo(xe - s * 0.07, -0.01);
      g.quadraticCurveTo(xe - s * 0.06, 0.08, xe, 0.11);
      g.stroke();
      if (f.lado > 0)
        costura(
          f,
          [
            [xi + 0.03, 0],
            [xi + 0.03, 0.11],
            [xi + 0.006, 0.135],
          ],
          linha,
        );
      dobra(f, [w * 0.2, 0.06, w * 0.5, 0.1, w * 0.8, 0.07], 0.008, 0.12);
    } else if (f.face === "nz") {
      const xi = xInterno(f);
      const s = xi > w / 2 ? -1 : 1;
      const bx = w / 2 + s * 0.008;
      sombraDe(f, () => g.rect(bx - 0.055, 0.07, 0.11, 0.1), 0.002, 0.004, 0.2);
      g.fillStyle = escurecer(cor, 0.1);
      g.fillRect(bx - 0.055, 0.07, 0.11, 0.1);
      costura(
        f,
        [
          [bx - 0.05, 0.075],
          [bx - 0.05, 0.165],
          [bx + 0.05, 0.165],
          [bx + 0.05, 0.075],
        ],
        linha,
      );
      botao(f, bx, 0.085, 0.006, escurecer(cor, 0.45));
    } else {
      emenda(f, reta(w / 2, -0.1, w / 2, h + 0.1), 0.3);
      if (f.face === faceExterna(f.lado)) {
        g.fillStyle = "rgba(0,0,0,0.2)";
        g.fillRect(w / 2 - 0.07, -yBolso + tamBolso[1] / 2, 0.14, 0.02);
      }
    }
    volume(f, { luz: 0.08, sombra: 0.16, bordas: 0.12 });
  };
  return {
    partes: [
      ...pernasDaCalca(m, e, alto, { baseVisivel: true }),
      ...cosSeVisivel(m, e, c),
      ...bolsosLaterais(m, e, yBolso, tamBolso),
    ],
    aneis: cintoSeVisivel(m, e, c),
    livres: [],
    pele: canelasDePele(m, e, c.sapato, alto),
    pintar,
    rugosidade: 0.8,
    corBase: cor,
  };
};

/* ———————————————————— SHORT DE ACADEMIA ———————————————————— */

/** Short de corrida: elástico largo, vivo na barra, fenda lateral e um raio de "marca". */
const shortAcademia: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const vivo = segundaCor(c, cor);
  const comp = m.pernaH - alturaDoCalcado(c.sapato, m);
  const alto = Math.max(0.1, comp * 0.28);
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    base(f, cor);
    pano(f, "ruido", 0.4);
    if (f.parte === "cos") {
      if (f.face === "py" || f.face === "ny") return;
      canelado(f, -0.1, 0, w + 0.2, h, cor);
      if (f.face === "pz") {
        g.strokeStyle = vivo;
        g.lineWidth = 0.007;
        g.beginPath();
        g.moveTo(w / 2 - 0.01, h * 0.6);
        g.quadraticCurveTo(w / 2 - 0.04, h + 0.02, w / 2 - 0.025, h + 0.07);
        g.moveTo(w / 2 + 0.01, h * 0.6);
        g.quadraticCurveTo(w / 2 + 0.04, h + 0.02, w / 2 + 0.025, h + 0.07);
        g.stroke();
      }
      return volume(f, { luz: 0.1, sombra: 0.2, bordas: 0.06 });
    }
    if (facesEscondidasDaPerna(f, cor)) return;
    brilhoVertical(f, 0.12, 0.25);
    // vivo na barra
    g.fillStyle = vivo;
    g.fillRect(-0.1, h - 0.02, w + 0.2, 0.03);
    if (f.face === faceExterna(f.lado)) {
      // fenda em V invertido com forro escuro e vivo em volta
      const fh = Math.min(0.06, h * 0.45);
      const pts: [number, number][] = [
        [w / 2 - 0.035, h + 0.01],
        [w / 2, h - fh],
        [w / 2 + 0.035, h + 0.01],
      ];
      g.strokeStyle = vivo;
      g.lineWidth = 0.014;
      poligono(g, pts);
      g.stroke();
      g.fillStyle = piso(escurecer(cor, 0.45));
      poligono(g, pts);
      g.fill();
      g.fillStyle = vivo;
      g.fillRect(w / 2 - 0.004, -0.1, 0.008, h - fh + 0.1);
    } else if (f.face === "pz" && f.lado > 0) {
      // o raio estampado (marca genérica)
      g.fillStyle = vivo;
      poligono(g, [
        [w * 0.66, h - 0.09],
        [w * 0.6, h - 0.055],
        [w * 0.645, h - 0.055],
        [w * 0.6, h - 0.025],
        [w * 0.7, h - 0.065],
        [w * 0.655, h - 0.065],
      ]);
      g.fill();
    }
    oclusao(f, -0.1, h - 0.03, w + 0.2, 0.012, "cima", 0.2);
    dobra(f, [w * 0.15, h * 0.45, w * 0.5, h * 0.4, w * 0.85, h * 0.46], 0.008, 0.12);
    volume(f, { luz: 0.1, sombra: 0.16, bordas: 0.14, base: cor });
  };
  return {
    partes: [...pernasDaCalca(m, e, alto, { baseVisivel: true }), ...cosSeVisivel(m, e, c)],
    livres: [],
    pele: canelasDePele(m, e, c.sapato, alto),
    pintar,
    rugosidade: 0.55,
    corBase: cor,
  };
};

/* ———————————————————— CALÇA DE COURO ———————————————————— */

/** Couro de motoqueiro: brilho forte, joelho matelassê, zíper no tornozelo e cinto preto. */
const calcaCouro: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const linha = escurecer(cor, 0.35);
  const alto = m.pernaH - alturaDoCalcado(c.sapato, m);
  const yJ = Math.min(m.pernaH * 0.5, alto - 0.1);
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    if (f.parte === "cos") return pintarCos(f, cor, linha, "couro", { botao: "#c0c4ca" });
    if (f.parte === "cinto") return pintarCinto(f, "#1b1b1f", "metal");
    base(f, cor);
    pano(f, "couro");
    if (facesEscondidasDaPerna(f, cor)) return;
    brilhoVertical(f, 0.28, 0.12);
    if (f.face === "pz") {
      // painel do joelho: costuras em arco e gomos acolchoados
      costura(f, curvaPts(0, yJ - 0.08, w / 2, yJ - 0.11, w, yJ - 0.08), linha, { duplo: 0.005 });
      costura(f, curvaPts(0, yJ + 0.08, w / 2, yJ + 0.11, w, yJ + 0.08), linha, { duplo: 0.005 });
      for (let i = -1; i <= 1; i++) {
        dobra(
          f,
          [w * 0.1, yJ + i * 0.04, w * 0.5, yJ + i * 0.04 - 0.012, w * 0.9, yJ + i * 0.04],
          0.009,
          0.3,
        );
      }
      const xi = xInterno(f);
      const xe = w - xi;
      const s = xe > xi ? 1 : -1;
      // bolso de zíper horizontal
      ziperDeitado(f, xe - s * 0.11, xe - s * 0.02, 0.07);
    } else if (f.face === faceExterna(f.lado)) {
      emenda(f, reta(w / 2, -0.1, w / 2, h + 0.1), 0.35);
      ziper(f, w / 2, h - Math.min(0.14, h * 0.28), h, cor);
    } else {
      emenda(f, reta(w / 2, -0.1, w / 2, h + 0.1), 0.3);
      if (f.face === "nz") dobra(f, [w * 0.2, yJ, w * 0.5, yJ + 0.02, w * 0.8, yJ], 0.01, 0.2);
    }
    dobra(f, [w * 0.15, h - 0.06, w * 0.5, h - 0.08, w * 0.85, h - 0.055], 0.008, 0.2);
    volume(f, { luz: 0.16, sombra: 0.2, bordas: 0.16, base: cor });
  };
  return {
    partes: [...pernasDaCalca(m, e, alto), ...cosSeVisivel(m, e, c)],
    aneis: cintoSeVisivel(m, e, c),
    livres: [],
    pintar,
    rugosidade: 0.38,
    corBase: cor,
  };
};

/** Zíper deitado (bolso): fita escura, dentes e o cursor na ponta `x0`. */
function ziperDeitado(f: CtxFace, x0: number, x1: number, y: number) {
  const { g } = f;
  const a = Math.min(x0, x1);
  const b = Math.max(x0, x1);
  g.fillStyle = "#26282d";
  g.fillRect(a, y - 0.008, b - a, 0.016);
  g.fillStyle = "#c7ccd3";
  for (let x = a + 0.004; x < b - 0.002; x += Math.max(0.006, pxs(f, 3))) {
    g.fillRect(x, y - 0.004, Math.max(0.0025, pxs(f, 1.2)), 0.008);
  }
  g.beginPath();
  g.roundRect(x0 - 0.008, y - 0.008, 0.016, 0.03, 0.004);
  g.fill();
}

/* ———————————————————— SAIAS ———————————————————— */

/** Corrente de prata pendurada (elos alternados), de (x0,y) a (x1,y) caindo `queda`. */
function corrente(f: CtxFace, x0: number, x1: number, y: number, queda: number) {
  const { g } = f;
  const n = Math.max(6, Math.round(Math.abs(x1 - x0) / 0.014));
  g.save();
  g.lineWidth = Math.max(0.003, pxs(f, 1.5));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const yy = y + queda * 4 * t * (1 - t);
    const r = i % 2 ? 0.006 : 0.0035;
    g.strokeStyle = "rgba(0,0,0,0.4)";
    g.beginPath();
    g.ellipse(x + 0.001, yy + 0.002, 0.008, r, 0, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "#e2e8f0";
    g.beginPath();
    g.ellipse(x, yy, 0.008, r, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
}

/** Saia xadrez de pregas com cinto de ilhoses e corrente (estilo e-girl do Roblox). */
const saiaXadrez: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const clara = segundaCor(c, cor);
  const s = resolverSaia(m, e, c.sapato, {
    comp: 0.1 + m.pernaH * 0.34,
    larg: 1.1,
    fundo: 1.22,
    afunilar: 0.24,
  });
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    base(f, cor);
    if (facesEscondidasDaSaia(f, cor)) return;
    const y0 = yQueAparece(m, e, s, f.face);
    xadrezContinuo(f, piso(escurecer(cor, 0.5)), clara, 0.085, clarear(cor, 0.45));
    pano(f, "brim", 0.6);
    // pregas faca: aresta viva escura + luz logo depois
    const P = 0.042;
    const ini = -(f.faixa % P) - 2 * P;
    for (let x = ini; x < w + P; x += P) {
      const gr = g.createLinearGradient(x, 0, x + P, 0);
      gr.addColorStop(0, "rgba(0,0,0,0.38)");
      gr.addColorStop(0.15, "rgba(0,0,0,0.05)");
      gr.addColorStop(0.7, "rgba(255,255,255,0.08)");
      gr.addColorStop(1, "rgba(0,0,0,0.16)");
      g.fillStyle = gr;
      g.fillRect(x, y0 + 0.05, P, h);
    }
    // cinto preto de ilhoses
    g.fillStyle = "#1c1c20";
    g.fillRect(-0.1, -0.1, w + 0.2, y0 + 0.05 + 0.1);
    for (let x = -f.faixa % 0.04; x < w; x += 0.04) ilhos(f, x, y0 + 0.025, 0.007, "#cbd5e1");
    oclusao(f, -0.1, y0 + 0.05, w + 0.2, 0.025, "cima", 0.35);
    if (f.face === "px") corrente(f, w * 0.12, w * 0.88, y0 + 0.04, 0.12);
    if (f.face === "pz") corrente(f, w * 0.62, w + 0.02, y0 + 0.04, 0.07);
    costura(f, reta(-0.1, h - 0.02, w + 0.1, h - 0.02), escurecer(cor, 0.4));
    volume(f, { luz: 0.08, sombra: 0.2, bordas: 0.04 });
  };
  return {
    partes: [parteSaia(m, e, s)],
    livres: [],
    pele: pernasDePele(m, e, c.sapato),
    pintar,
    corBase: cor,
  };
};

/** Saia plissada midi de cetim: plissê fininho com brilho e cós de elástico. */
const saiaPlissada: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const linha = escurecer(cor, 0.3);
  const s = resolverSaia(m, e, c.sapato, {
    comp: 0.12 + m.pernaH * 0.6,
    larg: 1.1,
    fundo: 1.25,
    afunilar: 0.28,
    cintura: 0.12,
  });
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    base(f, cor);
    if (facesEscondidasDaSaia(f, cor)) return;
    const y0 = yQueAparece(m, e, s, f.face);
    // plissê: vales escuros e cristas claras bem juntinhos
    const P = f.qualidade === "media" ? 0.03 : 0.022;
    const ini = -(f.faixa % P) - 2 * P;
    for (let x = ini; x < w + P; x += P) {
      const gr = g.createLinearGradient(x, 0, x + P, 0);
      gr.addColorStop(0, "rgba(0,0,0,0.26)");
      gr.addColorStop(0.45, "rgba(255,255,255,0.16)");
      gr.addColorStop(0.55, "rgba(255,255,255,0.2)");
      gr.addColorStop(1, "rgba(0,0,0,0.12)");
      g.fillStyle = gr;
      g.fillRect(x, y0, P, h);
    }
    // reflexo do cetim em diagonal
    const gr = g.createLinearGradient(0, h * 0.2, w, h * 0.7);
    gr.addColorStop(0, "rgba(255,255,255,0)");
    gr.addColorStop(0.45, "rgba(255,255,255,0.16)");
    gr.addColorStop(0.6, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(-0.1, y0, w + 0.2, h);
    // cós de elástico franzido
    cosDeSaia(f, cor, y0 + 0.06, linha);
    g.fillStyle = "rgba(0,0,0,0.14)";
    for (let x = -f.faixa % 0.012; x < w; x += 0.012) g.fillRect(x, -0.1, pxs(f, 1.5), y0 + 0.16);
    costura(f, reta(-0.1, h - 0.016, w + 0.1, h - 0.016), linha, { traco: 0.005 });
    volume(f, { luz: 0.14, sombra: 0.2, bordas: 0.04, base: cor });
  };
  return {
    partes: [parteSaia(m, e, s)],
    livres: [],
    pele: pernasDePele(m, e, c.sapato),
    pintar,
    rugosidade: 0.45,
    corBase: cor,
  };
};

/**
 * A camada de FORA do tutu, calculada a partir da de dentro para envolvê-la
 * por inteiro: 7 mm mais larga no alto e 3,5 cm na barra (as duas
 * afunilam em linha reta, então basta conferir as duas pontas).
 */
function camadaDeFora(m: Medidas, s1: SaiaResolvida): SaiaResolvida {
  const comp = s1.comp * 0.72;
  const k = 1 - s1.afunilar * (1 - comp / s1.comp);
  const wTopo = m.troncoW * s1.larg * (1 - s1.afunilar);
  const dTopo = m.troncoD * s1.fundo * (1 - s1.afunilar);
  const wBarra = m.troncoW * s1.larg * k + 0.07;
  const afunilar = Math.max(0, 1 - (wTopo + 0.014) / wBarra);
  const dBarra = Math.max(m.troncoD * s1.fundo * k + 0.07, (dTopo + 0.014) / (1 - afunilar));
  return {
    comp,
    larg: wBarra / m.troncoW,
    fundo: dBarra / m.troncoD,
    afunilar,
    cintura: s1.cintura,
  };
}

/** Saia de tule (tutu) em duas camadas: a de dentro na 2ª cor, glitter e barra ondulada. */
const saiaTule: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const dentro = segundaCor(c, cor);
  const s1 = resolverSaia(m, e, c.sapato, {
    comp: 0.1 + m.pernaH * 0.32,
    larg: 1.2,
    fundo: 1.4,
    afunilar: 0.4,
  });
  const s2 = camadaDeFora(m, s1);
  const tule = (f: CtxFace, tom: string, y0: number) => {
    const { g, w, h } = f;
    base(f, tom);
    pano(f, "tela", 0.8);
    pregas(f, 0.032, 0.8, y0);
    // camadas de tule: ondas claras sobrepostas
    for (const [y, a] of [
      [0.35, 0.16],
      [0.62, 0.2],
      [0.86, 0.24],
    ] as const) {
      g.fillStyle = alfa(clarear(tom, 0.45), a);
      g.beginPath();
      g.moveTo(-0.2, h + 0.2);
      const yy = y0 + (h - y0) * y;
      const P = 0.05;
      g.lineTo(-0.2, yy);
      for (let x = (-f.faixa % P) - P; x < w + P; x += P)
        g.quadraticCurveTo(x + P / 2, yy + 0.016, x + P, yy);
      g.lineTo(w + 0.2, h + 0.2);
      g.closePath();
      g.fill();
    }
    // glitter
    emCelulas(f, 0.03, (x, y, r) => {
      if (r > 0.3 || y < y0) return;
      const t = Math.max(0.0025, pxs(f, 1.5));
      g.fillStyle = r < 0.12 ? "#fff7d6" : "rgba(255,255,255,0.85)";
      g.fillRect(x - t * 1.5, y - t / 2, t * 3, t);
      g.fillRect(x - t / 2, y - t * 1.5, t, t * 3);
    });
    // barra recortada em ondinhas
    g.fillStyle = alfa(escurecer(tom, 0.3), 0.5);
    for (let x = (-f.faixa % 0.03) - 0.03; x < w + 0.03; x += 0.03) {
      g.beginPath();
      g.arc(x + 0.015, h + 0.006, 0.012, Math.PI, 0);
      g.fill();
    }
  };
  const pintar: Pintor = (f) => {
    const tom = f.parte === "saia" ? dentro : cor;
    if (facesEscondidasDaSaia(f, tom)) return;
    const s = f.parte === "saia" ? s1 : s2;
    const y0 = yQueAparece(m, e, s, f.face);
    tule(f, tom, y0);
    if (f.parte === "saia2") {
      // cós de cetim com um lacinho na frente
      cosDeSaia(f, dentro, y0 + 0.05, escurecer(dentro, 0.3));
      if (f.face === "pz") {
        const { g, w } = f;
        g.fillStyle = dentro;
        poligono(g, [
          [w / 2, y0 + 0.025],
          [w / 2 - 0.045, y0 - 0.0],
          [w / 2 - 0.045, y0 + 0.05],
        ]);
        g.fill();
        poligono(g, [
          [w / 2, y0 + 0.025],
          [w / 2 + 0.045, y0 - 0.0],
          [w / 2 + 0.045, y0 + 0.05],
        ]);
        g.fill();
        g.fillStyle = escurecer(dentro, 0.2);
        g.beginPath();
        g.arc(w / 2, y0 + 0.025, 0.012, 0, Math.PI * 2);
        g.fill();
      }
    }
    volume(f, { luz: 0.12, sombra: 0.22, bordas: 0.04, base: tom });
  };
  return {
    partes: [parteSaia(m, e, s1, "saia"), parteSaia(m, e, s2, "saia2")],
    livres: [],
    pele: pernasDePele(m, e, c.sapato),
    pintar,
    rugosidade: 0.7,
    corBase: cor,
  };
};

/* ———————————————————— BOCA DE SINO ———————————————————— */

/**
 * Jeans boca de sino: coxa justa e o SINO a partir do joelho (bloco
 * afunilado como o da pantalona, só crescendo para fora e para a
 * frente/trás — a borda de dentro fica no lugar, sem z-fighting entre as
 * pernas). A boca desce sobre o calçado.
 */
const bocaDeSino: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = c.corCalca;
  const calcado = alturaDoCalcado(c.sapato, m);
  const alto = m.pernaH - calcado;
  const desce = Math.max(0, Math.min(calcado - 0.05, 0.08));
  const hb = Math.min(0.3, alto * 0.42) + desce;
  const bocaW = m.pernaW + 0.07;
  const partes: ParteMolde[] = [];
  for (const l of LADOS) {
    partes.push({
      nome: nomeLado("perna", l),
      tam: [m.pernaW + 0.006, alto, m.pernaW + 0.026],
      raio: 0.05,
      lado: l,
      semFaces: ["ny"],
      matriz: em(e.perna(l), mat([0.003 * l, -alto / 2, 0])),
    });
    partes.push({
      nome: nomeLado("boca", l),
      tam: [bocaW, hb, m.pernaW + 0.11],
      raio: 0.05,
      lado: l,
      afunilar: 0.32,
      matriz: em(e.perna(l), mat([((bocaW - m.pernaW) / 2) * l, -alto - desce + hb / 2, 0])),
    });
  }
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    if (f.parte === "cos")
      return pintarCos(f, cor, LARANJA, "sarja", { botao: "#a8874f", etiqueta: true });
    base(f, cor);
    pano(f, "sarja");
    if (facesEscondidasDaPerna(f, cor)) return;
    if (f.parte.startsWith("boca")) {
      desbotar(f, cor, w / 2, h * 0.5, w * 0.45, h * 0.5, 0.3);
      pregas(f, 0.07, 0.6);
      if (ehLateral(f.face)) costura(f, reta(w / 2, -0.1, w / 2, h - 0.03), LARANJA);
      costura(f, reta(-0.1, h - 0.02, w + 0.1, h - 0.02), LARANJA);
      return volume(f, { luz: 0.06, sombra: 0.24, bordas: 0.1 });
    }
    desbotar(f, cor, w / 2, h * 0.32, w * 0.5, h * 0.3, 0.5);
    if (f.face === "pz") {
      const xi = xInterno(f);
      const xe = w - xi;
      const s = xe > xi ? 1 : -1;
      costura(f, curvaPts(xe - s * 0.1, 0, xe - s * 0.088, 0.075, xe + s * 0.01, 0.09), LARANJA, {
        duplo: 0.006,
      });
      rebite(f, xe - s * 0.008, 0.087);
      if (f.lado > 0)
        costura(
          f,
          [
            [xi + 0.035, 0],
            [xi + 0.035, 0.14],
            [xi + 0.006, 0.17],
          ],
          LARANJA,
          { duplo: 0.006 },
        );
      dobra(f, [w * 0.15, h * 0.6, w * 0.5, h * 0.58, w * 0.85, h * 0.61], 0.008, 0.16);
    } else if (f.face === "nz") {
      const xi = xInterno(f);
      const s = xi > w / 2 ? -1 : 1;
      const bx = w / 2 + s * 0.008;
      const pts: [number, number][] = [
        [bx - 0.06, 0.08],
        [bx + 0.06, 0.08],
        [bx + 0.055, 0.19],
        [bx, 0.215],
        [bx - 0.055, 0.19],
      ];
      sombraDe(f, () => poligono(g, pts), 0.002, 0.004, 0.25);
      g.fillStyle = alfa(escurecer(cor, 0.1), 0.6);
      poligono(g, pts);
      g.fill();
      costura(f, [...pts, pts[0]!], LARANJA);
    } else {
      emenda(f, reta(w / 2, -0.1, w / 2, h + 0.1), 0.3);
      costura(f, reta(w / 2 + 0.006, 0, w / 2 + 0.006, h), LARANJA);
    }
    volume(f, { luz: 0.06, sombra: 0.12, bordas: 0.14 });
  };
  return {
    partes: [...partes, ...cosSeVisivel(m, e, c)],
    livres: [],
    pintar,
    corBase: cor,
  };
};

/* ———————————————————— PIJAMA ———————————————————— */

/** Estrela de 5 pontas. */
function estrela(g: CanvasRenderingContext2D, x: number, y: number, r: number, giro: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = giro - Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    if (i) g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

/** Calça de pijama de flanela com estrelinhas e luas, cordão com laço e punho na 2ª cor. */
const calcaPijama: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const estampa = segundaCor(c, cor);
  const alto = m.pernaH - alturaDoCalcado(c.sapato, m);
  const desenhos = (f: CtxFace) => {
    const { g } = f;
    emCelulas(f, 0.085, (x, y, r, i, j) => {
      g.fillStyle = estampa;
      if (r < 0.45) estrela(g, x, y, 0.016, ruido(i, j, 77));
      else if (r < 0.7) {
        // lua: um disco menos outro deslocado
        // lua: o disco recortado por outro deslocado (só dentro do primeiro)
        g.save();
        g.beginPath();
        g.arc(x, y, 0.016, 0, Math.PI * 2);
        g.clip();
        g.beginPath();
        g.arc(x, y, 0.016, 0, Math.PI * 2);
        g.moveTo(x + 0.009 + 0.014, y - 0.005);
        g.arc(x + 0.009, y - 0.005, 0.014, 0, Math.PI * 2);
        g.fill("evenodd");
        g.restore();
      } else {
        g.beginPath();
        g.arc(x, y, 0.004, 0, Math.PI * 2);
        g.fill();
      }
    });
  };
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    base(f, cor);
    pano(f, "ruido", 0.8);
    if (f.parte === "cos") {
      if (f.face === "py" || f.face === "ny") return;
      g.fillStyle = "rgba(0,0,0,0.16)";
      for (let x = 0; x < w; x += 0.014) g.fillRect(x, 0, pxs(f, 2), h);
      if (f.face === "pz") {
        // o lacinho do cordão
        g.fillStyle = estampa;
        poligono(g, [
          [w / 2, h * 0.5],
          [w / 2 - 0.04, h * 0.2],
          [w / 2 - 0.04, h * 0.85],
        ]);
        g.fill();
        poligono(g, [
          [w / 2, h * 0.5],
          [w / 2 + 0.04, h * 0.2],
          [w / 2 + 0.04, h * 0.85],
        ]);
        g.fill();
        g.strokeStyle = estampa;
        g.lineWidth = 0.007;
        g.beginPath();
        g.moveTo(w / 2, h * 0.5);
        g.quadraticCurveTo(w / 2 - 0.02, h + 0.04, w / 2 - 0.012, h + 0.1);
        g.moveTo(w / 2, h * 0.5);
        g.quadraticCurveTo(w / 2 + 0.025, h + 0.03, w / 2 + 0.018, h + 0.09);
        g.stroke();
      }
      return volume(f, { luz: 0.08, sombra: 0.2, bordas: 0.06 });
    }
    if (facesEscondidasDaPerna(f, cor)) return;
    desenhos(f);
    // punho na 2ª cor com vivo
    g.fillStyle = escurecer(estampa, 0.05);
    g.fillRect(-0.1, h - 0.05, w + 0.2, 0.15);
    g.fillStyle = "rgba(0,0,0,0.2)";
    g.fillRect(-0.1, h - 0.052, w + 0.2, Math.max(0.003, pxs(f, 2)));
    if (ehLateral(f.face)) emenda(f, reta(w / 2, -0.1, w / 2, h + 0.1), 0.25);
    dobra(f, [w * 0.15, h * 0.5, w * 0.5, h * 0.47, w * 0.85, h * 0.51], 0.012, 0.18);
    dobra(f, [w * 0.2, h - 0.1, w * 0.5, h - 0.12, w * 0.8, h - 0.095], 0.01, 0.16);
    volume(f, { luz: 0.08, sombra: 0.18, bordas: 0.12 });
  };
  return {
    partes: [...pernasDaCalca(m, e, alto), ...cosSeVisivel(m, e, c)],
    livres: [],
    pintar,
    rugosidade: 0.95,
    corBase: cor,
  };
};

/* ———————————————————— KILT ———————————————————— */

/**
 * Kilt escocês: tartan com o avental liso na frente e pregas fundas atrás,
 * cinto de couro, alfinete, a bolsinha (sporran) 3D pendurada na frente e as
 * meias altas com as fitinhas (flashes). A bolsinha fica no MESMO pivô da
 * saia: sentado, ela deita junto, sobre as coxas.
 */
const kilt: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const clara = segundaCor(c, cor);
  const alto = m.pernaH - alturaDoCalcado(c.sapato, m);
  const s = resolverSaia(m, e, c.sapato, {
    comp: 0.1 + m.pernaH * 0.42,
    larg: 1.1,
    fundo: 1.24,
    afunilar: 0.14,
  });
  const pivo = mat([0, e.quadrilY + s.cintura, 0], e.sentado ? [-1.38, 0, 0] : [0, 0, 0]);
  const t = Math.min(0.16, s.comp * 0.45);
  const fz = 1 - s.afunilar * (1 - t / s.comp);
  const bolsa: ParteMolde = {
    nome: "bolsa",
    tam: [Math.min(0.13, m.troncoW * 0.24), Math.min(0.15, s.comp * 0.45), 0.026],
    raio: 0.01,
    matriz: em(pivo, mat([0, -t, (m.troncoD * s.fundo * fz) / 2 + 0.012])),
  };
  // meias até abaixo do joelho (entram 1 cm no calçado)
  const hM = Math.min(0.26, alto * 0.55);
  const meias: ParteMolde[] = LADOS.map((l) => ({
    nome: nomeLado("meia", l),
    tam: [m.pernaW + 0.004, hM + 0.01, m.pernaW + 0.024] as [number, number, number],
    raio: 0.05,
    lado: l,
    semFaces: ["ny"] as Face[],
    matriz: em(e.perna(l), mat([0, -alto + hM / 2 - 0.005, 0])),
  }));
  const creme = "#ece4cf";
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    if (f.parte === "bolsa") {
      base(f, "#3b2a1e");
      pano(f, "couro");
      if (f.face === "pz") {
        // pelo claro com três borlas e a tampa de couro com o fecho
        g.fillStyle = "#e9e4da";
        g.fillRect(0.008, h * 0.32, w - 0.016, h * 0.68 - 0.006);
        g.strokeStyle = "rgba(120,110,95,0.5)";
        g.lineWidth = Math.max(0.002, pxs(f, 1));
        for (let x = 0.01; x < w - 0.01; x += 0.006) {
          g.beginPath();
          g.moveTo(x, h * 0.34);
          g.lineTo(x + 0.002, h - 0.01);
          g.stroke();
        }
        for (const x of [w * 0.3, w * 0.5, w * 0.7]) {
          g.fillStyle = "#1c1c20";
          g.beginPath();
          g.roundRect(x - 0.008, h * 0.5, 0.016, h * 0.4, 0.006);
          g.fill();
          g.fillStyle = "#c9a227";
          g.fillRect(x - 0.009, h * 0.48, 0.018, 0.012);
        }
        g.fillStyle = "#2b1d14";
        g.beginPath();
        g.roundRect(0, 0, w, h * 0.34, 0.01);
        g.fill();
        g.fillStyle = "#c9a227";
        g.beginPath();
        g.arc(w / 2, h * 0.24, 0.012, 0, Math.PI * 2);
        g.fill();
      }
      return volume(f, { luz: 0.16, sombra: 0.22, bordas: 0.12, contorno: 0.35 });
    }
    if (f.parte.startsWith("meia")) {
      base(f, creme);
      pano(f, "ruido");
      if (f.face === "py") return escurecerTudo(f, 0.25, creme);
      // canelado + o punho dobrado com losangos na cor do kilt
      g.fillStyle = "rgba(0,0,0,0.08)";
      for (let x = -f.faixa % 0.012; x < w; x += 0.012) g.fillRect(x, 0.055, pxs(f, 2), h);
      g.fillStyle = clarear(creme, 0.1);
      g.fillRect(-0.1, -0.1, w + 0.2, 0.155);
      g.fillStyle = alfa(cor, 0.85);
      for (let x = (-f.faixa % 0.04) - 0.04; x < w + 0.04; x += 0.04) {
        poligono(g, [
          [x + 0.02, 0.008],
          [x + 0.034, 0.028],
          [x + 0.02, 0.048],
          [x + 0.006, 0.028],
        ]);
        g.fill();
      }
      oclusao(f, -0.1, 0.055, w + 0.2, 0.02, "cima", 0.35);
      if (f.face === faceExterna(f.lado)) {
        // as fitinhas (flashes) penduradas da liga
        g.fillStyle = cor;
        for (const dx of [-0.018, 0.006]) {
          poligono(g, [
            [w / 2 + dx, 0.05],
            [w / 2 + dx + 0.014, 0.05],
            [w / 2 + dx + 0.014, 0.13],
            [w / 2 + dx + 0.007, 0.118],
            [w / 2 + dx, 0.13],
          ]);
          g.fill();
        }
      }
      return volume(f, { luz: 0.08, sombra: 0.16, bordas: 0.12 });
    }
    base(f, cor);
    if (facesEscondidasDaSaia(f, cor)) return;
    const y0 = yQueAparece(m, e, s, f.face);
    xadrezContinuo(f, piso(escurecer(cor, 0.5)), clara, 0.1, clarear(cor, 0.5));
    pano(f, "brim", 0.6);
    if (f.face !== "pz") pregas(f, 0.05, 1.4, y0 + 0.05);
    else {
      // a beirada do avental com franja e o alfinete
      const xb = w * 0.78;
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(xb, y0, Math.max(0.004, pxs(f, 2)), h);
      g.fillStyle = alfa(clara, 0.8);
      for (let y = y0 + 0.06; y < h; y += 0.008) g.fillRect(xb - 0.012, y, 0.012, pxs(f, 1.2));
      g.strokeStyle = "#d1d5db";
      g.lineWidth = Math.max(0.003, pxs(f, 1.6));
      g.beginPath();
      g.moveTo(xb - 0.03, h - 0.12);
      g.lineTo(xb - 0.03, h - 0.04);
      g.stroke();
      g.fillStyle = "#c9a227";
      g.beginPath();
      g.arc(xb - 0.03, h - 0.04, 0.007, 0, Math.PI * 2);
      g.fill();
    }
    // o cinto de couro com a fivela na frente
    g.fillStyle = "#2b1f19";
    g.fillRect(-0.1, -0.1, w + 0.2, y0 + 0.045 + 0.1);
    costura(f, reta(-0.1, y0 + 0.008, w + 0.1, y0 + 0.008), "#6b4a33", { traco: 0.005 });
    costura(f, reta(-0.1, y0 + 0.037, w + 0.1, y0 + 0.037), "#6b4a33", { traco: 0.005 });
    if (f.face === "pz") {
      g.strokeStyle = "#cbd5e1";
      g.lineWidth = 0.007;
      g.strokeRect(w / 2 - 0.028, y0 - 0.002, 0.056, 0.05);
    }
    oclusao(f, -0.1, y0 + 0.045, w + 0.2, 0.02, "cima", 0.3);
    volume(f, { luz: 0.08, sombra: 0.2, bordas: 0.04 });
  };
  return {
    partes: [parteSaia(m, e, s), bolsa, ...meias],
    livres: [],
    pele: pernasDePele(m, e, c.sapato),
    pintar,
    corBase: cor,
  };
};

/* ———————————————————— LEGGING DE ONCINHA ———————————————————— */

const leggingOnca: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corCalca);
  const alto = m.pernaH - alturaDoCalcado(c.sapato, m);
  const pinta =
    contrasta(c.corRoupa2, cor) && luminancia(c.corRoupa2) < luminancia(cor)
      ? piso(c.corRoupa2)
      : piso(escurecer(cor, 0.72));
  const miolo = misturar(cor, escurecer(cor, 0.35), 0.6);
  const linha = corDaLinha(cor);
  const onca = (f: CtxFace) => {
    const { g } = f;
    g.save();
    g.lineCap = "round";
    emCelulas(
      f,
      0.06,
      (x, y, r, i, j) => {
        if (r < 0.62) {
          // roseta: miolo mais escuro e 3–4 arcos grossos em volta
          const rr = 0.012 + r * 0.01;
          g.fillStyle = miolo;
          g.beginPath();
          g.ellipse(x, y, rr, rr * 0.8, r * 3, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = pinta;
          g.lineWidth = Math.max(0.006, pxs(f, 2.5));
          const n = 3 + (r < 0.3 ? 1 : 0);
          for (let k = 0; k < n; k++) {
            const a = ruido(i, j, 50 + k) * 0.6 + (k * Math.PI * 2) / n;
            g.beginPath();
            g.arc(x, y, rr * 1.25, a, a + 0.9 + ruido(i, j, 60 + k) * 0.5);
            g.stroke();
          }
        } else {
          g.fillStyle = pinta;
          g.beginPath();
          g.arc(x, y, 0.004 + (r - 0.62) * 0.012, 0, Math.PI * 2);
          g.fill();
        }
      },
      200,
    );
    g.restore();
  };
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    base(f, cor);
    pano(f, "ruido", 0.4);
    if (f.parte === "cos") {
      if (f.face === "py" || f.face === "ny") return;
      base(f, pinta);
      for (const y of [0.012, h - 0.012])
        costura(f, reta(-0.1, y, w + 0.1, y), linha, { duplo: 0.005 });
      return volume(f, { luz: 0.2, sombra: 0.2, bordas: 0.06, base: pinta });
    }
    if (facesEscondidasDaPerna(f, cor)) return;
    onca(f);
    brilhoVertical(f, 0.16, 0.08);
    if (f.face === faceInterna(f.lado)) emenda(f, reta(w / 2, 0, w / 2, h), 0.25);
    dobra(f, [w * 0.15, h - 0.05, w * 0.5, h - 0.065, w * 0.85, h - 0.045], 0.007, 0.16);
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

/* ———————————————————— SHORT JEANS COM MEIA-CALÇA ———————————————————— */

/**
 * O shortinho jeans de sempre, mas as pernas abaixo dele saem de MEIA-CALÇA
 * fina preta (pano, não pele): a cor mistura a pele e o preto, mais clara no
 * meio da face (o fio esticado mostra mais pele) e escura nas bordas — o
 * efeito de transparência de meia fio 40.
 */
const shortMeiaCalca: CriarPeca = (m, c, q, pose) => {
  const p = PECAS_BAIXO.short(m, c, q, pose);
  const e = esqueleto(m, pose);
  const comp = m.pernaH - alturaDoCalcado(c.sapato, m);
  const alto = p.partes.find((x) => x.nome === "pernaD")?.tam[1] ?? Math.max(0.09, comp * 0.2);
  const meias: ParteMolde[] = LADOS.map((l) => ({
    nome: nomeLado("meia", l),
    tam: [m.pernaW - 0.012, comp - alto + 0.012, m.pernaW + 0.008] as [number, number, number],
    raio: 0.05,
    lado: l,
    ocultas: ["py", "ny"] as Face[],
    matriz: em(e.perna(l), mat([0, -alto - (comp - alto) / 2 + 0.006, 0])),
  }));
  const fundo = misturar(c.pele, "#0e0e12", 0.88);
  const esticada = misturar(c.pele, "#0e0e12", 0.62);
  const yJ = Math.min(m.pernaH * 0.5, comp - 0.08) - alto;
  return {
    ...p,
    partes: [...p.partes, ...meias],
    pele: undefined,
    mostraPele: true,
    pintar: (f) => {
      if (!f.parte.startsWith("meia")) return p.pintar(f);
      const { g, w, h } = f;
      base(f, fundo);
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, alfa(esticada, 0));
      gr.addColorStop(0.5, alfa(esticada, 0.85));
      gr.addColorStop(1, alfa(esticada, 0));
      g.fillStyle = gr;
      g.fillRect(-0.1, -0.1, w + 0.2, h + 0.2);
      if (f.face === "pz" && yJ > 0.04) {
        // o joelho esticado
        g.save();
        g.translate(w / 2, yJ);
        g.scale(1, 0.7);
        const r = g.createRadialGradient(0, 0, 0, 0, 0, w * 0.35);
        r.addColorStop(0, alfa(esticada, 0.6));
        r.addColorStop(1, alfa(esticada, 0));
        g.fillStyle = r;
        g.fillRect(-w, -w, 2 * w, 2 * w);
        g.restore();
      }
      if (f.face === "nz") emenda(f, reta(w / 2, -0.1, w / 2, h + 0.1), 0.35);
      // o reflexo fininho do fio
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.fillRect(w * 0.42, -0.1, w * 0.05, h + 0.2);
      volume(f, { luz: 0.1, sombra: 0.14, bordas: 0.2, contorno: 0.12 });
    },
  };
};

export const PECAS_BAIXO_EXTRAS: Record<CalcaExtra, CriarPeca> = {
  calcaBrimCampo: brimCampo,
  cargoCamuflada,
  calcaAgasalho,
  jeansRasgado,
  bermudaCargo,
  shortAcademia,
  calcaCouro,
  saiaXadrez,
  saiaPlissada,
  bocaDeSino,
  calcaPijama,
  kilt,
  leggingOnca,
  saiaTule,
  shortMeiaCalca,
};
