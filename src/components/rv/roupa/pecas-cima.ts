import { CylinderGeometry, ExtrudeGeometry, Shape } from "three";
import { ROUPA_INTEIRA, type AvatarConfig } from "@/lib/avatar-3d";
import type { Qualidade } from "@/components/rv/contexto-avatar";
import type { Medidas } from "@/components/rv/medidas";
import {
  bordaCurva,
  criarRolo,
  normalizarUV,
  raioEfetivo,
  uvNoAtlas,
  type PontoRolo,
} from "./caixa-roupa";
import { desenharEstampaNaFace } from "./estampas";
import type { CtxFace, ParteMolde, Pintor, RetanguloLivre } from "./molde";
import {
  faixaDeRenas,
  flor,
  floco,
  floral,
  galhoSakura,
  grade,
  havaiana,
  numeroDeCamisa,
  patch,
  pontinhos,
  seigaiha,
} from "./padroes-cima";
import {
  barraDeBabado,
  bolinhas,
  parteSaia,
  pregas,
  renda,
  resolverSaia,
  yQueAparece,
  type OpSaia,
} from "./saias";
import {
  LADOS,
  alturaDoCalcado,
  aneisDePunho,
  ehLateral,
  em,
  esqueleto,
  faceExterna,
  faceInterna,
  mangasEBracos,
  mat,
  nomeLado,
  parteTronco,
  topoDaCoxaSentado,
  type BlocoPele,
  type CriarPeca,
  type Esqueleto,
  type Manga,
  type Peca,
} from "./peca";
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
  listrasContinuas,
  luminancia,
  misturar,
  oclusao,
  pano,
  piso,
  poligono,
  pxs,
  ilhos,
  rebite,
  refletivo,
  sombraDe,
  sombraMacia,
  trico,
  volume,
  xadrezContinuo,
  ziper,
  type Grao,
} from "./pincel";

/**
 * As PARTES DE CIMA. Cada uma devolve o molde (blocos + retângulos livres),
 * o pintor de cada face e as malhas 3D extras (capuz, colarinho, gravata,
 * faixas em relevo). As cores seguem a tabela R3 da especificação:
 * `corRoupa` = a peça (nos casacos, o casaco); `corRoupa2` = cordão, forro,
 * camiseta por baixo, listra, segunda cor do xadrez, gravata da social.
 *
 * Fase 0: moletom, social e EPI completos; o resto com pintura simples mas
 * válida (nada branco, nada quebrado) até a Fase 1.
 *
 * Femininas (13/10/2026): blusa, cropped, alcinha, ciganinha, babado,
 * cardigã, vestido, vestido longo e macacão — as três últimas vestem o
 * corpo inteiro (`ROUPA_INTEIRA`): a saia sai daqui e as pernas da
 * `pecaDeBaixo` (pecas-baixo).
 */

type RoupaNova = "moletomZiper" | "jaquetaJeans" | "bomber" | "uniformeCampo" | "blazer";
export type TipoRoupa = AvatarConfig["roupa"] | RoupaNova;

/** Peças que aceitam estampa no peito (o editor mostra o seletor só nelas). */
export const TEM_ESTAMPA: ReadonlySet<TipoRoupa> = new Set<TipoRoupa>([
  "camiseta",
  "regata",
  "moletom",
  "sueter",
  "cropped",
  "moletomZiper",
  "listrada",
  "blusa",
  "alcinha",
  // novas (16/10/2026)
  "flanelaAberta",
  "jaquetaPatches",
  "camisaTime",
  "moletomCropped",
  "jardineira",
]);

/** Casacos com painéis por cima do tronco: acessórios vão mais para a frente (R5). */
export const TEM_PAINEL: ReadonlySet<TipoRoupa> = new Set<TipoRoupa>([
  "jaqueta",
  "terno",
  "colete",
  "jaleco",
  "epi",
  "moletomZiper",
  "jaquetaJeans",
  "bomber",
  "blazer",
  "cardiga",
  // novas (16/10/2026)
  "flanelaAberta",
  "jaquetaPatches",
  "coleteCampo",
  "kimono",
]);

/** Comprimento da manga de cada peça (o relógio vai por cima da manga longa). */
export const MANGA_DE: Record<AvatarConfig["roupa"], Manga> = {
  camiseta: "curta",
  regata: "nenhuma",
  polo: "curta",
  camisa: "longa",
  social: "longa",
  xadrez: "longa",
  listrada: "longa",
  moletom: "longa",
  jaqueta: "longa",
  terno: "longa",
  colete: "longa",
  sueter: "longa",
  jaleco: "longa",
  epi: "curta",
  blusa: "cotovelo",
  cropped: "curta",
  alcinha: "nenhuma",
  ciganinha: "curta",
  babado: "curta",
  cardiga: "longa",
  vestido: "curta",
  vestidoLongo: "nenhuma",
  macacao: "nenhuma",
  // —— novas (16/10/2026) ——
  flanelaAberta: "cotovelo",
  jaquetaPatches: "longa",
  cortaVento: "longa",
  jaquetaCouro: "longa",
  brigadista: "longa",
  coleteCampo: "longa",
  camisaTime: "curta",
  moletomCropped: "longa",
  bomberCetim: "longa",
  kimono: "longa",
  sueterRenas: "longa",
  vestidoTule: "nenhuma",
  vestidoFloral: "curta",
  jardineira: "curta",
  ombroSo: "nenhuma",
  corset: "nenhuma",
  havaiana: "curta",
  poloRugby: "longa",
  uniformeSocial: "longa",
  uniformePolo: "curta",
};

const BRANCO = "#f8fafc";
/** Sombra do branco: azul-acinzentada (cinza puro deixa a camisa "suja"). */
const sombraDe_ = (cor: string) => (luminancia(cor) > 0.72 ? "#334155" : "#000000");

/* ———————————————————— utilidades de face ———————————————————— */

/**
 * Converte uma altura do MUNDO (m, acima do chão) na coordenada y da face
 * de um bloco (desdobrada, a partir do topo): faixas pintadas e faixas 3D
 * caem exatamente no mesmo lugar.
 */
function yNaFace(topoDoBloco: number, raio: number, yMundo: number): number {
  return bordaCurva(raio) + (topoDoBloco - raio - yMundo);
}

/** Gola careca: buraco do pescoço em pele + ribana em volta. */
function golaCareca(f: CtxFace, cor: string, pele: string, rx = 0.09, ry = 0.06, faixa = 0.02) {
  const { g, w } = f;
  const cx = w / 2;
  g.save();
  g.fillStyle = alfa("#000000", 0.25);
  g.beginPath();
  g.ellipse(cx, -0.004, rx + faixa + 0.004, ry + faixa + 0.006, 0, 0, Math.PI);
  g.fill();
  g.fillStyle = escurecer(cor, 0.08);
  g.beginPath();
  g.ellipse(cx, -0.006, rx + faixa, ry + faixa, 0, 0, Math.PI);
  g.fill();
  // nervuras da ribana em leque
  g.strokeStyle = "rgba(0,0,0,0.18)";
  g.lineWidth = pxs(f, f.qualidade === "media" ? 2 : 1.2);
  const n = f.qualidade === "media" ? 10 : 22;
  for (let i = 1; i < n; i++) {
    const a = (Math.PI * i) / n;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * rx, -0.006 + Math.sin(a) * ry);
    g.lineTo(cx + Math.cos(a) * (rx + faixa), -0.006 + Math.sin(a) * (ry + faixa));
    g.stroke();
  }
  g.fillStyle = pele;
  g.beginPath();
  g.ellipse(cx, -0.008, rx, ry, 0, 0, Math.PI);
  g.fill();
  // sombra do pescoço dentro da gola
  g.fillStyle = "rgba(0,0,0,0.22)";
  g.beginPath();
  g.ellipse(cx, -0.008, rx, ry * 0.55, 0, 0, Math.PI);
  g.fill();
  g.restore();
}

/**
 * Pontas de colarinho pintadas no peito (camisa, polo, social, terno):
 * cheias, com contorno e SOMBRA MACIA embaixo — só o contorno fino lia como
 * "desenho de linha" na camisa branca.
 */
function pontasDeGola(f: CtxFace, cor: string, linha: string, sombra: string, comp = 0.075) {
  const { g, w } = f;
  const cx = w / 2;
  const claro = misturar(cor, "#ffffff", 0.3);
  oclusao(f, cx - 0.12, -0.01, 0.24, 0.024, "cima", 0.2, sombra);
  for (const s of [-1, 1]) {
    const pts: [number, number][] = [
      [cx + s * 0.012, -0.012],
      [cx + s * 0.112, -0.012],
      [cx + s * 0.086, comp * 0.62],
      [cx + s * 0.022, comp],
    ];
    sombraMacia(f, pts, 0.004 * s, 0.011, 0.34, sombra);
    g.fillStyle = claro;
    poligono(g, pts);
    g.fill();
    // a dobra do colarinho: sombra na borda de cima, luz embaixo
    g.save();
    poligono(g, pts);
    g.clip();
    oclusao(f, cx - 0.12, -0.012, 0.24, 0.022, "cima", 0.16, sombra);
    oclusao(f, cx - 0.12, comp * 0.4, 0.24, comp * 0.6, "baixo", 0.08, sombra);
    g.restore();
    g.strokeStyle = alfa(sombra, 0.42);
    g.lineWidth = Math.max(0.0025, pxs(f, f.qualidade === "media" ? 2 : 1.5));
    poligono(g, pts);
    g.stroke();
    costura(
      f,
      [
        [cx + s * 0.1, -0.002],
        [cx + s * 0.077, comp * 0.58],
        [cx + s * 0.027, comp * 0.88],
      ],
      linha,
      { traco: 0.006 },
    );
  }
}

/**
 * Meia largura da lâmina da gravata na altura `y` da face. A pintada (de
 * cima) e a 3D (de baixo) usam a MESMA conta: sem degrau na emenda.
 */
function laminaDaGravata(y: number, ate: number): number {
  const larga = ate - 0.03;
  if (y <= 0.046) return 0.022;
  if (y >= larga) return 0.04 * Math.max(0, (ate - y) / 0.03);
  return 0.022 + ((y - 0.046) / (larga - 0.046)) * 0.018;
}

/** Gravata pintada: nó + lâmina até `ate` (a lâmina 3D cobre a parte de baixo). */
function gravataPintada(f: CtxFace, cor: string, ate: number) {
  const { g, w } = f;
  const cx = w / 2;
  const escura = escurecer(cor, 0.3);
  // nó
  g.save();
  sombraDe(f, () => poligono(g, noPts(cx)), 0.002, 0.005, 0.3);
  g.fillStyle = cor;
  poligono(g, noPts(cx));
  g.fill();
  oclusao(f, cx - 0.026, 0.0, 0.052, 0.03, "baixo", 0.25);
  // lâmina
  const hw = laminaDaGravata(ate - 0.03, ate);
  const lam: [number, number][] = [
    [cx - 0.022, 0.046],
    [cx + 0.022, 0.046],
    [cx + hw, ate - 0.03],
    [cx, ate],
    [cx - hw, ate - 0.03],
  ];
  sombraDe(f, () => poligono(g, lam), 0.003, 0.006, 0.25);
  g.fillStyle = cor;
  poligono(g, lam);
  g.fill();
  g.save();
  poligono(g, lam);
  g.clip();
  listrasDaGravata(f, cor, cx - 0.06, 0.04, 0.12, ate);
  // a mesma luz e sombra da lâmina 3D (22% escuros à esquerda, fio claro em 55–67%)
  const faixa = (de: number, ate_: number): [number, number][] => [
    [cx + (de * 2 - 1) * 0.022, 0.046],
    [cx + (ate_ * 2 - 1) * 0.022, 0.046],
    [cx + (ate_ * 2 - 1) * hw, ate - 0.03],
    [cx + (de * 2 - 1) * hw, ate - 0.03],
  ];
  g.fillStyle = alfa(escura, 0.4);
  poligono(g, faixa(0, 0.22));
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.12)";
  poligono(g, faixa(0.55, 0.67));
  g.fill();
  g.restore();
  g.restore();
}
const noPts = (cx: number): [number, number][] => [
  [cx - 0.026, 0.012],
  [cx + 0.026, 0.012],
  [cx + 0.018, 0.05],
  [cx - 0.018, 0.05],
];

function listrasDaGravata(f: CtxFace, cor: string, x: number, y: number, w: number, h: number) {
  const { g } = f;
  g.save();
  g.strokeStyle = alfa(clarear(cor, 0.35), 0.55);
  g.lineWidth = Math.max(0.006, pxs(f, 2));
  for (let k = -h; k < w + h; k += 0.03) {
    g.beginPath();
    g.moveTo(x + k, y);
    g.lineTo(x + k - h, y + h);
    g.stroke();
  }
  g.restore();
}

/* ———————————————————— casacos (painéis) ———————————————————— */

type OpPaineis = {
  /** Fração de W que fica aberta no meio (0,14 no EPI, 0,34 na jaqueta). */
  abertura: number;
  /** Espessura do painel (m). */
  esp?: number;
  /** Quanto desce abaixo do quadril em pé (jaleco 0,32). */
  desce?: number;
};

/**
 * Painéis de casaco: frente esquerda e direita (abertas no meio) e a
 * "costas" que abraça as laterais. A face interna fica 2 mm afastada do
 * tronco (sem z-fighting).
 *
 * Sentado (a coxa sai do quadril para a frente, com o alto em
 * `topoDaCoxaSentado`): as frentes param no alto da coxa — abaixo disso
 * ficariam dentro dela, e a sobra para fora da coxa (|x| > pernaW) descia
 * como uma tira pela lateral. A costas vira duas: a de cima abraça tudo até
 * o alto da coxa; a de baixo ("costasB") fica rente ao tronco (1,2 cm de
 * cada lado) e desce até o assento. E fica a 7 mm das costas: com as faixas em relevo
 * (3 mm) nada passa de −(D/2 + 0,01), o limite do encosto.
 */
function paineis(m: Medidas, e: Esqueleto, o: OpPaineis): ParteMolde[] {
  const W = m.troncoW;
  const D = m.troncoD;
  const esp = o.esp ?? 0.025;
  const a = (W * o.abertura) / 2;
  const fora = W / 2 + esp + 0.002;
  const pw = fora - a;
  const coxa = topoDaCoxaSentado(m, e) + 0.005;
  const baixo = e.sentado ? coxa : e.quadrilY - 0.005 - (o.desce ?? 0);
  const cima = e.topo + 0.006;
  const h = cima - baixo;
  const yc = (cima + baixo) / 2;
  const espC = e.sentado ? 0.005 : esp;
  const zTras = -(D / 2 + 0.002 + espC);
  const zFrente = D / 2 - 0.004;
  const raioC = Math.min(0.03, espC + 0.004);
  const partes: ParteMolde[] = [
    ...LADOS.map((l): ParteMolde => ({
      nome: nomeLado("painel", l),
      tam: [pw, h, esp],
      raio: 0.012,
      lado: l,
      matriz: mat([(a + pw / 2) * l, yc, D / 2 + 0.002 + esp / 2]),
    })),
    {
      nome: "costas",
      tam: [2 * fora, h, zFrente - zTras],
      raio: raioC,
      matriz: mat([0, yc, (zFrente + zTras) / 2]),
      semFaces: ["ny"],
    },
  ];
  if (e.sentado) {
    // Rente ao tronco dos lados (1,2 cm, só o bastante para cobrir o cinto da
    // calça), da frente do tronco até as costas: fecha a lateral do quadril sem
    // virar a "tira" de 3 cm que descia ao lado da coxa.
    const b0 = e.quadrilY + 0.02;
    const zF = zFrente;
    partes.push({
      nome: "costasB",
      tam: [W + 0.024, coxa - b0 + 0.01, zF - zTras],
      raio: raioC,
      matriz: mat([0, (coxa + 0.01 + b0) / 2, (zF + zTras) / 2]),
      semFaces: ["py"],
    });
  }
  return partes;
}

/* ———————————————————— MOLETOM ———————————————————— */

/** Barra de ribana (anel): cobre a cintura por fora (a calça não gera cós por baixo). */
const BARRA_ALTURA = 0.09;
/** Raio do pescoço (0,09 na base) + folga: o capuz encosta nele por trás. */
const PESCOCO = 0.098;

const suave = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/**
 * O caminho do capuz caído em volta do pescoço (espaço do avatar): grosso
 * nas costas, os lados à vista entre o ombro e a cabeça (é ele que faz o
 * moletom ler como moletom de frente, igual à ref 48) e as pontas
 * mergulhando no decote em V, onde a gola pintada continua.
 *
 * Contrato com o cabelo: nada acima de topo + 0,06; atrás, em pé, até
 * −(D/2 + 0,08). Sentado o encosto manda (precedência): até −(D/2 + 0,01) —
 * o capuz achata contra a cadeira e ganha altura no lugar da espessura.
 */
function caminhoDoCapuz(m: Medidas, e: Esqueleto, n: number): PontoRolo[] {
  const kW = 0.6 + 0.4 * (m.troncoW / 0.56);
  // Meia largura do caminho nos lados: o rolo passa da largura da cabeça
  // (0,23) e aparece de frente dos dois lados do pescoço, sem chegar à manga.
  const Rx = Math.min(0.185 * kW, m.troncoW / 2 - 0.065);
  const zc = -0.005;
  // Atrás: em pé até −(D/2 + 0,08) com folga (−0,098 − 2·0,062 = −0,222 no clássico);
  // sentado o encosto manda: −(D/2 + 0,01).
  const aB = e.sentado
    ? Math.max(0.02, (m.troncoD / 2 + 0.008 - PESCOCO) / 2)
    : Math.min(0.062, (m.troncoD / 2 + 0.075 - PESCOCO) / 2);
  // Nos lados o rolo engorda para fora (passa da cabeça) sem encostar na manga.
  const aL = Math.min(0.068, m.troncoW / 2 - Rx - 0.004);
  const bB = e.sentado ? 0.056 : 0.052;
  const RzB = zc + PESCOCO + aB;
  // Na frente as pontas descem rente à face do peito (z ≈ D/2), onde a gola em V pintada continua.
  const RzF = m.troncoD / 2 + 0.012;
  const fim = Math.PI * 0.88;
  const desce = Math.PI * 0.64;
  const meio = Math.PI / 2;
  const pts: PontoRolo[] = [];
  for (let i = 0; i <= n; i++) {
    const ph = (-1 + (2 * i) / n) * fim;
    const ap = Math.abs(ph);
    const tL = suave(ap / meio);
    const tF = suave((ap - meio) / (fim - meio));
    // grosso nas costas e nos lados (o "colarinho" do Roblox), afinando nas pontas
    const a = ap <= meio ? aB + (aL - aB) * tL : aL + (0.03 - aL) * tF;
    const b = ap <= meio ? bB + (0.046 - bB) * tL : 0.046 + (0.028 - 0.046) * tF;
    const Rz = RzB + (RzF - RzB) * suave((ap - meio) / (Math.PI * 0.26));
    // Topo do tubo: topo + 0,058 atrás (onde o capuz amontoa), + 0,05 nos lados.
    const teto = e.topo + 0.058 - 0.008 * tL;
    const yAlto = teto - b;
    const y = yAlto + (e.topo - 0.075 - yAlto) * suave((ap - desce) / (fim - desce));
    pts.push({ p: [Rx * Math.sin(ph), y, zc - Rz * Math.cos(ph)], a, b });
  }
  return pts;
}

/** Comprimento de um caminho (m): o retângulo livre do capuz tem esse tamanho. */
function comprimento(pts: readonly PontoRolo[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!.p, pts[i]!.p];
    L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return L;
}

function moletom(m: Medidas, c: AvatarConfig, q: Qualidade, pose: "em-pe" | "sentado"): Peca {
  const e = esqueleto(m, pose);
  const cor = piso(c.corRoupa);
  const cor2 = c.corRoupa2;
  const linha = corDaLinha(cor);
  // Tecido escuro (marinho do look 57, preto da ref 48): toda "luz pintada" sobe.
  const escuro = luminancia(cor) < 0.2;
  const forro = escurecer(misturar(cor, cor2, 0.3), 0.25);
  const { partes: mangas, pele, comp } = mangasEBracos(m, e, "longa", { larga: true });
  const tronco = parteTronco(m, e);
  const barra: ParteMolde = {
    nome: "barra",
    tam: [m.troncoW + 0.012, BARRA_ALTURA, m.troncoD + 0.012],
    raio: 0.066,
    matriz: mat([0, e.quadrilY - 0.005 + BARRA_ALTURA / 2, 0]),
    semFaces: ["ny"],
  };
  // Na face do tronco, a faixa que o anel da barra cobre (para o bolso pousar em cima).
  const barraNaFace = (f: CtxFace) => f.borda + (BARRA_ALTURA - 0.005 - 0.06) + 0.004;
  const caminho = caminhoDoCapuz(m, e, q === "alta" ? 36 : 22);
  const compCapuz = comprimento(caminho);
  /** Onde o rolo entra no peito (x das pontas da gola pintada). */
  const BOCA_V = 0.085;

  /** Filete claro (tecido escuro): a borda some sem ele no corpo inteiro. */
  const filete = (f: CtxFace, desenhar: () => void, a = 0.2) => {
    if (!escuro) return;
    const { g } = f;
    g.save();
    g.strokeStyle = alfa("#ffffff", a);
    g.lineWidth = Math.max(0.004, pxs(f, f.qualidade === "media" ? 2 : 1.5));
    g.beginPath();
    desenhar();
    g.stroke();
    g.restore();
  };

  const frente = (f: CtxFace) => {
    const { g, w, h } = f;
    const cx = w / 2;
    base(f, cor);
    pano(f, "ruido");
    const yb = h - barraNaFace(f);
    canelado(f, -0.1, yb, w + 0.2, h - yb + 0.1, cor);
    // —— bolso canguru ——
    const yt = yb - Math.min(0.19, h * 0.34);
    const wb = w * 0.64;
    const wt = w * 0.42;
    const contorno = () => {
      g.moveTo(cx - wt / 2, yt);
      g.lineTo(cx + wt / 2, yt);
      g.quadraticCurveTo(cx + wb / 2 - 0.005, yt + 0.03, cx + wb / 2, yb);
      g.lineTo(cx - wb / 2, yb);
      g.quadraticCurveTo(cx - wb / 2 + 0.005, yt + 0.03, cx - wt / 2, yt);
      g.closePath();
    };
    sombraDe(f, contorno, 0.003, 0.006, 0.3);
    g.fillStyle = clarear(cor, escuro ? 0.07 : 0.035);
    g.beginPath();
    contorno();
    g.fill();
    g.save();
    g.beginPath();
    contorno();
    g.clip();
    pano(f, "ruido", 0.8);
    dobra(f, [cx - wt * 0.3, yt + 0.09, cx, yt + 0.11, cx + wt * 0.3, yt + 0.085], 0.01, 0.14);
    // luz de cima no bolso (ele é uma camada a mais de pano)
    oclusao(f, cx - wb / 2, yt, wb, 0.05, "cima", escuro ? 0.12 : 0.06, "#ffffff");
    g.restore();
    for (const s of [-1, 1]) {
      // aberturas: fresta escura + aresta clara + pesponto de reforço
      g.strokeStyle = "rgba(0,0,0,0.55)";
      g.lineWidth = Math.max(0.009, pxs(f, 2));
      g.beginPath();
      g.moveTo(cx + (s * wt) / 2, yt);
      g.quadraticCurveTo(cx + s * (wb / 2 - 0.005), yt + 0.03, cx + (s * wb) / 2, yb);
      g.stroke();
      g.strokeStyle = alfa("#ffffff", escuro ? 0.34 : 0.18);
      g.lineWidth = Math.max(0.003, pxs(f, escuro ? 1.5 : 1));
      g.beginPath();
      g.moveTo(cx + s * (wt / 2 - 0.007), yt + 0.004);
      g.quadraticCurveTo(cx + s * (wb / 2 - 0.013), yt + 0.034, cx + s * (wb / 2 - 0.008), yb);
      g.stroke();
      // filete do lado de fora da boca (a borda do corpo do moletom)
      filete(f, () => {
        g.moveTo(cx + s * (wt / 2 + 0.008), yt + 0.002);
        g.quadraticCurveTo(cx + s * (wb / 2 + 0.004), yt + 0.03, cx + s * (wb / 2 + 0.009), yb);
      });
      costura(
        f,
        [
          [cx + s * (wt / 2 - 0.016), yt + 0.006],
          [cx + s * (wb / 2 - 0.02), yb - 0.004],
        ],
        linha,
      );
      g.strokeStyle = linha;
      g.lineWidth = 0.004;
      g.beginPath();
      g.moveTo(cx + s * (wt / 2 - 0.012), yt + 0.004);
      g.lineTo(cx + s * (wt / 2 - 0.022), yt + 0.016);
      g.stroke();
    }
    // a borda de cima do bolso pega luz
    filete(f, () => {
      g.moveTo(cx - wt / 2 + 0.004, yt + 0.002);
      g.lineTo(cx + wt / 2 - 0.004, yt + 0.002);
    });
    costura(
      f,
      [
        [cx - wt / 2 + 0.012, yt + 0.008],
        [cx + wt / 2 - 0.012, yt + 0.008],
      ],
      linha,
      { duplo: 0.006 },
    );
    // estampa no peito (antes do cordão, que passa por cima)
    desenharEstampaNaFace(
      f,
      c.estampa,
      cor,
      cx,
      Math.min(yt - 0.1, h * 0.36),
      Math.min(0.19, w * 0.34),
    );
    // dobras da axila para o meio e acima da barra (no escuro, com fio de luz)
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? 0.015 : w - 0.015;
      dobra(f, [x0, 0.12, x0 - s * 0.07, 0.17, x0 - s * 0.13, 0.25], 0.012, 0.18);
      dobra(f, [x0, yb - 0.03, x0 - s * 0.04, yb - 0.055, x0 - s * 0.09, yb - 0.028], 0.009, 0.16);
      filete(
        f,
        () => {
          g.moveTo(x0, 0.105);
          g.quadraticCurveTo(x0 - s * 0.07, 0.155, x0 - s * 0.13, 0.235);
        },
        0.13,
      );
    }
    // gola do capuz: as bordas descem de onde o rolo 3D entra no peito e
    // cruzam em V, com o forro aparecendo
    const fundo = 0.085;
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.beginPath();
    g.moveTo(cx - BOCA_V, -0.02);
    g.lineTo(cx + BOCA_V, -0.02);
    g.lineTo(cx, fundo);
    g.closePath();
    g.fill();
    for (const s of [1, -1]) {
      g.save();
      g.lineCap = "butt";
      g.strokeStyle = "rgba(0,0,0,0.3)";
      g.lineWidth = 0.058;
      g.beginPath();
      g.moveTo(cx - s * BOCA_V, -0.03);
      g.quadraticCurveTo(cx - s * 0.05, fundo * 0.55 + 0.006, cx + s * 0.02, fundo + 0.01);
      g.stroke();
      g.strokeStyle = s > 0 ? clarear(cor, escuro ? 0.1 : 0.06) : cor;
      g.lineWidth = 0.05;
      g.beginPath();
      g.moveTo(cx - s * BOCA_V, -0.034);
      g.quadraticCurveTo(cx - s * 0.05, fundo * 0.55, cx + s * 0.02, fundo);
      g.stroke();
      g.strokeStyle = cor2;
      g.lineWidth = Math.max(0.007, pxs(f, 2));
      g.beginPath();
      g.moveTo(cx - s * (BOCA_V - 0.018), -0.04);
      g.quadraticCurveTo(cx - s * 0.038, fundo * 0.5 - 0.012, cx + s * 0.024, fundo - 0.018);
      g.stroke();
      g.restore();
    }
    // cordões com ilhós e ponteira
    for (const s of [-1, 1]) {
      const x = cx + s * 0.042;
      const y0 = fundo * 0.55;
      const y1 = y0 + 0.16 + (s > 0 ? 0.012 : 0);
      const tracar = (dx: number, dy: number) => {
        g.beginPath();
        g.moveTo(x + dx, y0 + dy);
        g.bezierCurveTo(
          x + s * 0.01 + dx,
          y0 + 0.06,
          x - s * 0.008 + dx,
          y1 - 0.05,
          x + dx,
          y1 + dy,
        );
        g.stroke();
      };
      g.save();
      g.lineCap = "round";
      g.strokeStyle = "rgba(0,0,0,0.3)";
      g.lineWidth = 0.013;
      tracar(0.003, 0.004);
      g.strokeStyle = cor2;
      g.lineWidth = 0.0105;
      tracar(0, 0);
      g.strokeStyle = alfa("#000000", 0.18);
      g.lineWidth = Math.max(0.003, pxs(f, 1));
      tracar(0.003, 0);
      g.fillStyle = escurecer(cor2, 0.45);
      g.beginPath();
      g.roundRect(x - 0.0065, y1 - 0.002, 0.013, 0.026, 0.004);
      g.fill();
      g.strokeStyle = "#c7ccd3";
      g.lineWidth = 0.004;
      g.beginPath();
      g.arc(x, y0, 0.0075, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    volume(f, { luz: 0.1, sombra: 0.2, bordas: 0.08, base: cor });
  };

  /**
   * O rolo do capuz: x = ao longo do caminho (0 e w = as pontas no decote,
   * w/2 = meio das costas); y = em volta do tubo: 0 = fora, h/4 = embaixo
   * (apoiado no ombro), h/2 = dentro (lado do pescoço), 3h/4 = em cima.
   */
  const capuz = (f: CtxFace) => {
    const { g, w, h } = f;
    base(f, cor);
    pano(f, "ruido");
    // forro do lado do pescoço, com a borda dobrada (a "vista") clara dos dois lados
    const ini = h * 0.38;
    const fim = h * 0.62;
    g.fillStyle = forro;
    g.fillRect(-0.1, ini, w + 0.2, fim - ini);
    oclusao(f, -0.1, ini, w + 0.2, (fim - ini) / 2, "cima", 0.3);
    oclusao(f, -0.1, (ini + fim) / 2, w + 0.2, (fim - ini) / 2, "baixo", 0.3);
    g.fillStyle = clarear(cor, escuro ? 0.14 : 0.06);
    g.fillRect(-0.1, ini - 0.022, w + 0.2, 0.022);
    g.fillRect(-0.1, fim, w + 0.2, 0.022);
    costura(
      f,
      [
        [-0.1, ini - 0.011],
        [w + 0.1, ini - 0.011],
      ],
      linha,
    );
    costura(
      f,
      [
        [-0.1, fim + 0.011],
        [w + 0.1, fim + 0.011],
      ],
      linha,
    );
    // pesponto que corre por cima e por fora (a borda do rosto do capuz)
    costura(
      f,
      [
        [-0.1, h * 0.86],
        [w + 0.1, h * 0.86],
      ],
      linha,
      { duplo: 0.008 },
    );
    // costura central do capuz: no meio das costas, dando a volta por fora
    for (const [y0, y1] of [
      [h * 0.66, h + 0.02],
      [-0.02, h * 0.16],
    ] as const) {
      costura(
        f,
        [
          [w / 2, y0],
          [w / 2, y1],
        ],
        linha,
        { duplo: 0.006 },
      );
    }
    // dobras ao longo do rolo (o pano amontoado)
    for (let i = 1; i < 9; i++) {
      const x = (w * i) / 9;
      dobra(f, [x - 0.02, h * 0.7, x, h * 0.85, x + 0.02, h * 0.98], 0.01, 0.16);
    }
    // a parte de baixo, apoiada no ombro, na sombra; luz em cima
    oclusao(f, -0.1, h * 0.25, w + 0.2, h * 0.13, "cima", 0.28);
    oclusao(f, -0.1, h * 0.12, w + 0.2, h * 0.13, "baixo", 0.28);
    g.fillStyle = alfa("#ffffff", escuro ? 0.16 : 0.08);
    g.fillRect(-0.1, h * 0.7, w + 0.2, h * 0.1);
    // as pontas que entram no peito: sombra de contato
    oclusao(f, -0.1, -0.1, 0.16, h + 0.2, "esq", 0.4);
    oclusao(f, w - 0.06, -0.1, 0.16, h + 0.2, "dir", 0.4);
  };

  /** Ombros (topo do tronco, y = 0 nas costas): costura e a sombra do capuz apoiado. */
  const ombros = (f: CtxFace) => {
    const { g, w, h } = f;
    costura(
      f,
      [
        [0.01, h * 0.55],
        [w * 0.3, h * 0.55],
      ],
      linha,
    );
    costura(
      f,
      [
        [w * 0.7, h * 0.55],
        [w - 0.01, h * 0.55],
      ],
      linha,
    );
    // sombra de contato seguindo o caminho do rolo (x, z do mundo → face)
    const naFace = (x: number, z: number): [number, number] => [w / 2 + x, h / 2 + z];
    g.save();
    g.lineCap = "round";
    for (const [k, a] of [
      [1.3, 0.16],
      [0.95, 0.22],
    ] as const) {
      g.strokeStyle = `rgba(0,0,0,${a})`;
      for (let i = 1; i < caminho.length; i++) {
        const [p0, p1] = [caminho[i - 1]!, caminho[i]!];
        g.lineWidth = (p0.a + p1.a) * k;
        g.beginPath();
        g.moveTo(...naFace(p0.p[0], p0.p[2]));
        g.lineTo(...naFace(p1.p[0], p1.p[2]));
        g.stroke();
      }
    }
    g.restore();
    // a gola continua do ponto onde o rolo entra até a borda da frente
    for (const s of [-1, 1]) {
      const [x0, y0] = naFace(s * 0.11, 0.075);
      const [x1, y1] = naFace(s * BOCA_V, m.troncoD / 2 + 0.02);
      g.save();
      g.lineCap = "butt";
      g.strokeStyle = clarear(cor, escuro ? 0.06 : 0.03);
      g.lineWidth = 0.05;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      g.strokeStyle = cor2;
      g.lineWidth = Math.max(0.007, pxs(f, 2));
      g.beginPath();
      g.moveTo(x0 - s * 0.018, y0);
      g.lineTo(x1 - s * 0.018, y1);
      g.stroke();
      g.restore();
    }
    volume(f, { luz: 0.06, sombra: 0, bordas: 0.06, base: cor });
  };

  /**
   * Costas: o corpo do capuz caído pintado em U (forro na boca, costura
   * central, sombra embaixo), descendo ~1/3 das costas — o 3D é só o rolo.
   */
  const costas = (f: CtxFace) => {
    const { g, w, h } = f;
    const cx = w / 2;
    const yb = h - barraNaFace(f);
    canelado(f, -0.1, yb, w + 0.2, h - yb + 0.1, cor);
    const lw = Math.min(0.16, w * 0.3);
    const fundoU = Math.min(0.21, h * 0.36);
    const u = (): [number, number][] => {
      const pts: [number, number][] = [
        [cx - lw, -0.03],
        [cx - lw * 0.94, fundoU * 0.6],
      ];
      pts.push(...curvaPts(cx - lw * 0.94, fundoU * 0.6, cx - lw * 0.8, fundoU, cx, fundoU, 10));
      pts.push(...curvaPts(cx, fundoU, cx + lw * 0.8, fundoU, cx + lw * 0.94, fundoU * 0.6, 10));
      pts.push([cx + lw, -0.03]);
      return pts;
    };
    const pts = u();
    sombraMacia(f, pts, 0.006, 0.016, 0.34);
    g.fillStyle = clarear(cor, escuro ? 0.07 : 0.035);
    poligono(g, pts);
    g.fill();
    g.save();
    poligono(g, pts);
    g.clip();
    pano(f, "ruido", 0.8);
    // a boca do capuz embaixo do rolo: o forro aparecendo
    g.fillStyle = forro;
    g.fillRect(cx - lw, -0.03, lw * 2, 0.045);
    oclusao(f, cx - lw, 0.0, lw * 2, 0.03, "cima", 0.4);
    // o pano pendurado: luz em cima, sombra no fundo do U
    oclusao(f, cx - lw, fundoU * 0.55, lw * 2, fundoU * 0.5, "baixo", 0.22);
    dobra(
      f,
      [cx - lw * 0.6, fundoU * 0.7, cx - lw * 0.3, fundoU * 0.86, cx - lw * 0.1, fundoU * 0.8],
      0.01,
      0.16,
    );
    dobra(
      f,
      [cx + lw * 0.1, fundoU * 0.82, cx + lw * 0.35, fundoU * 0.88, cx + lw * 0.62, fundoU * 0.7],
      0.01,
      0.16,
    );
    g.restore();
    // contorno do U: traço escuro e fio de luz por dentro
    g.save();
    g.strokeStyle = "rgba(0,0,0,0.35)";
    g.lineWidth = Math.max(0.005, pxs(f, 2));
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.restore();
    filete(
      f,
      () => pts.forEach(([x, y], i) => (i ? g.lineTo(x, y - 0.006) : g.moveTo(x, y - 0.006))),
      0.12,
    );
    costura(
      f,
      [
        [cx, 0.02],
        [cx, fundoU - 0.012],
      ],
      linha,
      { duplo: 0.007 },
    );
    costura(
      f,
      pts
        .slice(1, -1)
        .map(([x, y]) => [x + (x < cx ? 0.012 : -0.012), y - 0.012] as [number, number]),
      linha,
    );
    // vincos das costas abaixo do capuz
    dobra(f, [w * 0.3, yb - 0.02, w * 0.33, yb - 0.1, w * 0.28, yb - 0.16], 0.012, 0.16);
    dobra(f, [w * 0.68, yb - 0.02, w * 0.64, yb - 0.11, w * 0.7, yb - 0.18], 0.012, 0.16);
  };

  const pintar: Pintor = (f) => {
    if (f.livre === "capuz") return capuz(f);
    if (f.parte === "tronco" && f.face === "pz") return frente(f);
    const { g, w, h } = f;
    base(f, cor);
    pano(f, "ruido");
    if (f.parte === "barra" || f.parte.startsWith("punho")) {
      if (f.face === "py" || f.face === "ny") {
        canelado(f, -0.1, -0.1, w + 0.2, h + 0.2, cor);
        return escurecerTudo(f, 0.25, cor);
      }
      canelado(f, -0.1, -0.1, w + 0.2, h + 0.2, cor);
      // costura que prende a ribana no corpo, rente ao topo
      emenda(
        f,
        [
          [-0.1, 0.004],
          [w + 0.1, 0.004],
        ],
        0.35,
      );
      return volume(f, { luz: 0.06, sombra: 0.22, bordas: 0.08, contorno: 0.15, base: cor });
    }
    if (f.parte === "tronco") {
      if (f.face === "py") return ombros(f);
      if (f.face === "nz") costas(f);
      else {
        const yb = h - barraNaFace(f);
        canelado(f, -0.1, yb, w + 0.2, h - yb + 0.1, cor);
        costura(
          f,
          [
            [w / 2, 0.02],
            [w / 2, yb],
          ],
          linha,
        );
        oclusao(f, -0.1, -0.1, w + 0.2, 0.22, "cima", 0.3);
        dobra(f, [w * 0.2, 0.08, w * 0.45, 0.14, w * 0.5, 0.24], 0.01, 0.16);
      }
      return volume(f, {
        luz: 0.1,
        sombra: 0.2,
        bordas: ehLateral(f.face) ? 0.04 : 0.08,
        base: cor,
      });
    }
    // —— mangas ——
    if (f.face === "ny") {
      escurecerTudo(f, 0.55, cor);
      g.strokeStyle = escurecer(cor, 0.1);
      g.lineWidth = 0.02;
      g.strokeRect(0.01, 0.01, w - 0.02, h - 0.02);
      return;
    }
    if (f.face === "py") return volume(f, { luz: 0.12, sombra: 0, bordas: 0.08, base: cor });
    const pb = h - 0.055;
    canelado(f, -0.1, pb, w + 0.2, h - pb + 0.1, cor);
    if (f.face === "nz") {
      const y = h * 0.52;
      dobra(f, [w * 0.15, y, w * 0.5, y - 0.03, w * 0.85, y + 0.005], 0.01, 0.22);
      dobra(f, [w * 0.2, y + 0.05, w * 0.5, y + 0.02, w * 0.8, y + 0.06], 0.01, 0.18);
    }
    if (f.face === "pz") {
      const y = h * 0.5;
      dobra(f, [w * 0.25, y, w * 0.5, y + 0.02, w * 0.75, y], 0.008, 0.16);
      dobra(f, [w * 0.15, 0.06, w * 0.4, 0.09, w * 0.55, 0.05], 0.008, 0.12);
      filete(
        f,
        () => {
          g.moveTo(w * 0.25, y - 0.006);
          g.quadraticCurveTo(w * 0.5, y + 0.014, w * 0.75, y - 0.006);
        },
        0.12,
      );
    }
    if (f.face === faceInterna(f.lado))
      costura(
        f,
        [
          [w / 2, 0],
          [w / 2, pb],
        ],
        linha,
      );
    // franzido acima do punho
    dobra(f, [w * 0.1, pb - 0.02, w * 0.5, pb - 0.04, w * 0.9, pb - 0.015], 0.009, 0.2);
    volume(f, { luz: 0.12, sombra: 0.14, bordas: ehLateral(f.face) ? 0.05 : 0.1, base: cor });
  };

  const segV = q === "alta" ? 12 : 8;
  return {
    partes: [tronco, ...mangas],
    aneis: [barra, ...aneisDePunho(m, e, comp, true)],
    // em volta do tubo: o perímetro médio da seção (≈ 2π·0,045)
    livres: [{ nome: "capuz", w: compCapuz, h: 0.3 }],
    pele,
    pintar,
    corBase: cor,
    extras: (molde) => ({
      // Já no espaço do avatar: o caminho foi calculado com o esqueleto da pose.
      capuz: {
        geo: uvNoAtlas(criarRolo(caminho, [0, -0.005], segV), molde.livres.capuz!.uv),
        matriz: mat([0, 0, 0]),
      },
    }),
  };
}

/* ———————————————————— CAMISA SOCIAL + GRAVATA ———————————————————— */

function social(m: Medidas, c: AvatarConfig, q: Qualidade, pose: "em-pe" | "sentado"): Peca {
  const e = esqueleto(m, pose);
  const cor = piso(c.corRoupa);
  const sombra = sombraDe_(cor);
  const linha = corDaLinha(cor);
  // Camisa clara: a sombra pintada precisa de mais força (o branco "come" a dobra fraca).
  const k = luminancia(cor) > 0.72 ? 1.5 : 1;
  // A gravata é a 2ª cor; se ela não contrasta com a camisa, um vinho/claro de reserva.
  const corGravata = contrasta(c.corRoupa2, cor, 0.2)
    ? piso(c.corRoupa2)
    : luminancia(cor) > 0.6
      ? "#7a2e3b"
      : "#e5e7eb";
  const { partes: mangas, pele } = mangasEBracos(m, e, "longa");
  const tronco = parteTronco(m, e);
  const botaoCor = luminancia(cor) > 0.6 ? "#f1f5f9" : clarear(cor, 0.25);
  // A gravata 3D só existe abaixo de topo − 0,12 (a barba ocupa o resto) e
  // termina a 20 cm do cinto: abaixo dela aparecem 2–3 botões da carcela.
  const gravTopo = e.topo - 0.12;
  const gravFim = e.quadrilY + 0.2;
  const gravL = gravTopo - gravFim;
  const topoT = e.topo;
  const rT = raioEfetivo(m.troncoW, m.troncoH, m.troncoD, 0.06);
  /** Na face da frente: onde a gravata acaba e onde a lâmina 3D começa. */
  const fimNaFace = yNaFace(topoT, rT, gravFim) - 0.005;
  const y3d = yNaFace(topoT, rT, gravTopo);

  /** Dobra forte o bastante para ler no branco (sombra azul-acinzentada). */
  const vinco = (
    f: CtxFace,
    p: [number, number, number, number, number, number],
    larg: number,
    forca: number,
  ) => dobra(f, p, larg, Math.min(0.42, forca * k), sombra);

  const frente = (f: CtxFace) => {
    const { g, w, h } = f;
    const cx = w / 2;
    base(f, cor);
    pano(f, "brim", 0.5);
    // a camisa "estufa" por cima do cós: sombra larga e o franzido
    oclusao(f, -0.1, h - 0.07, w + 0.2, 0.07, "baixo", 0.16 * k, sombra);
    for (let i = 0; i < 6; i++) {
      const x = w * (0.1 + i * 0.16);
      vinco(f, [x, h - 0.01, x + 0.008, h - 0.06, x - 0.004, h - 0.11], 0.007, 0.18);
    }
    vinco(f, [0.03, h - 0.13, w * 0.5, h - 0.1, w - 0.03, h - 0.14], 0.012, 0.16);
    // axilas: duas dobras diagonais de cada lado
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? 0.012 : w - 0.012;
      vinco(f, [x0, 0.09, x0 - s * 0.06, 0.14, x0 - s * 0.13, 0.22], 0.011, 0.2);
      vinco(f, [x0, 0.17, x0 - s * 0.05, 0.21, x0 - s * 0.1, 0.27], 0.009, 0.15);
    }
    // carcela: faixa com a borda sombreada, pesponto e 6 botões (os de baixo à vista)
    g.fillStyle = misturar(cor, "#ffffff", 0.35);
    g.fillRect(cx - 0.02, -0.1, 0.04, h + 0.2);
    oclusao(f, cx + 0.012, -0.1, 0.012, h + 0.2, "esq", 0.22 * k, sombra);
    g.fillStyle = alfa(sombra, 0.25 * k);
    g.fillRect(cx + 0.02, -0.1, Math.max(0.003, pxs(f, 1.5)), h + 0.2);
    for (const dx of [-0.017, 0.017])
      costura(
        f,
        [
          [cx + dx, 0.05],
          [cx + dx, h],
        ],
        linha,
        { traco: 0.006 },
      );
    const passo = (h - 0.1) / 5.6;
    for (let i = 0; i < 6; i++) botao(f, cx, 0.07 + i * passo, 0.0085, botaoCor);
    // bolso no peito esquerdo do boneco (direita de quem olha), com portinhola e botão
    const bx = cx + w * 0.23;
    const bw = 0.1;
    const by = 0.15;
    const bolso: [number, number][] = [
      [bx - bw / 2, by],
      [bx + bw / 2, by],
      [bx + bw / 2, by + 0.1],
      [bx, by + 0.116],
      [bx - bw / 2, by + 0.1],
    ];
    sombraMacia(f, bolso, 0.004, 0.008, 0.3 * k, sombra);
    g.fillStyle = misturar(cor, "#ffffff", 0.25);
    poligono(g, bolso);
    g.fill();
    oclusao(f, bx - bw / 2, by + 0.07, bw, 0.046, "baixo", 0.12 * k, sombra);
    costura(f, [...bolso.slice(2), bolso[0]!, bolso[1]!, bolso[2]!], linha, { traco: 0.006 });
    const aba: [number, number][] = [
      [bx - bw / 2 - 0.004, by - 0.006],
      [bx + bw / 2 + 0.004, by - 0.006],
      [bx + bw / 2 + 0.004, by + 0.026],
      [bx, by + 0.04],
      [bx - bw / 2 - 0.004, by + 0.026],
    ];
    sombraMacia(f, aba, 0.003, 0.009, 0.36 * k, sombra);
    g.fillStyle = misturar(cor, "#ffffff", 0.4);
    poligono(g, aba);
    g.fill();
    g.strokeStyle = alfa(sombra, 0.35);
    g.lineWidth = Math.max(0.0025, pxs(f, 1.5));
    poligono(g, aba);
    g.stroke();
    botao(f, bx, by + 0.024, 0.0065, botaoCor);
    // a sombra MACIA que a lâmina 3D projeta (acompanha o contorno dela) e a gravata pintada
    const w0 = laminaDaGravata(y3d, fimNaFace);
    sombraMacia(
      f,
      [
        [cx - w0, y3d],
        [cx + w0, y3d],
        [cx + 0.04, fimNaFace - 0.03],
        [cx, fimNaFace],
        [cx - 0.04, fimNaFace - 0.03],
      ],
      0.008,
      0.012,
      0.32 * k,
      sombra,
    );
    gravataPintada(f, corGravata, fimNaFace);
    pontasDeGola(f, cor, linha, sombra);
    volume(f, { luz: 0.1, sombra: 0.14 * k, bordas: 0.07 * k, cor: sombra, contorno: 0.2 });
  };

  /** Costas: pala com pesponto, prega macho no meio, omoplatas e o franzido da cintura. */
  const costas = (f: CtxFace) => {
    const { g, w, h } = f;
    const cx = w / 2;
    const pala = 0.11;
    // as omoplatas: sombra macia dos dois lados da prega
    for (const s of [-1, 1]) {
      const x = cx + s * w * 0.27;
      const gr = g.createRadialGradient(x, pala + 0.12, 0.01, x, pala + 0.12, 0.13);
      gr.addColorStop(0, alfa(sombra, 0));
      gr.addColorStop(0.7, alfa(sombra, 0.07 * k));
      gr.addColorStop(1, alfa(sombra, 0));
      g.fillStyle = gr;
      g.fillRect(x - 0.14, pala - 0.02, 0.28, 0.3);
    }
    // pala: a faixa de cima sobreposta, com sombra embaixo e pesponto duplo
    g.fillStyle = misturar(cor, "#ffffff", 0.3);
    g.fillRect(-0.1, -0.1, w + 0.2, pala + 0.1);
    oclusao(f, -0.1, pala, w + 0.2, 0.035, "cima", 0.24 * k, sombra);
    g.fillStyle = alfa(sombra, 0.3 * k);
    g.fillRect(-0.1, pala, w + 0.2, Math.max(0.003, pxs(f, 1.5)));
    costura(
      f,
      [
        [-0.1, pala - 0.008],
        [w + 0.1, pala - 0.008],
      ],
      linha,
      { duplo: 0.005, traco: 0.006 },
    );
    // prega macho: as duas dobras e o vão sombreado
    for (const s of [-1, 1]) {
      const x = cx + s * 0.022;
      oclusao(f, s < 0 ? x - 0.016 : x, pala, 0.016, 0.2, s < 0 ? "dir" : "esq", 0.22 * k, sombra);
      g.fillStyle = alfa(sombra, 0.3 * k);
      g.fillRect(x - 0.0015, pala, Math.max(0.003, pxs(f, 1.5)), 0.16);
    }
    vinco(f, [cx, pala + 0.16, cx, pala + 0.22, cx, pala + 0.3], 0.014, 0.16);
    // franzido da cintura
    oclusao(f, -0.1, h - 0.07, w + 0.2, 0.07, "baixo", 0.16 * k, sombra);
    for (let i = 0; i < 6; i++) {
      const x = w * (0.1 + i * 0.16);
      vinco(f, [x, h - 0.01, x - 0.005, h - 0.06, x + 0.004, h - 0.11], 0.007, 0.17);
    }
    vinco(f, [w * 0.12, h - 0.15, w * 0.5, h - 0.12, w * 0.88, h - 0.16], 0.012, 0.14);
  };

  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    if (f.livre === "gravata") {
      base(f, corGravata);
      listrasDaGravata(f, corGravata, -0.05, -0.02, w + 0.1, h + 0.04);
      // a mesma luz e sombra da gravata pintada (22% escuros à esquerda, fio claro em 55–67%)
      g.fillStyle = alfa(escurecer(corGravata, 0.3), 0.4);
      g.fillRect(-0.1, -0.1, w * 0.22 + 0.1, h + 0.2);
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.fillRect(w * 0.55, -0.1, w * 0.12, h + 0.2);
      return volume(f, { luz: 0.08, sombra: 0.2, bordas: 0.06, contorno: 0.3 });
    }
    if (f.livre === "colarinho") {
      base(f, cor);
      pano(f, "brim", 0.4);
      costura(
        f,
        [
          [-0.1, 0.008],
          [w + 0.1, 0.008],
        ],
        linha,
        { traco: 0.006 },
      );
      oclusao(f, -0.1, h * 0.45, w + 0.2, h * 0.55, "baixo", 0.3 * k, sombra);
      return volume(f, { luz: 0.12, sombra: 0.1, bordas: 0, cor: sombra, contorno: 0.2 });
    }
    if (f.parte === "tronco" && f.face === "pz") return frente(f);
    base(f, cor);
    pano(f, "brim", 0.5);
    if (f.parte === "tronco") {
      if (f.face === "py") {
        costura(
          f,
          [
            [0.01, h * 0.45],
            [w - 0.01, h * 0.45],
          ],
          linha,
          { traco: 0.006 },
        );
        oclusao(f, w * 0.3, -0.1, w * 0.4, h * 0.7, "baixo", 0.22 * k, sombra);
        return volume(f, { luz: 0.1, sombra: 0, bordas: 0.05, cor: sombra });
      }
      if (f.face === "nz") costas(f);
      else {
        // laterais: costura e as rugas da axila e da cintura
        costura(
          f,
          [
            [w / 2, 0.02],
            [w / 2, h],
          ],
          linha,
          { traco: 0.006 },
        );
        oclusao(f, -0.1, -0.1, w + 0.2, 0.2, "cima", 0.25 * k, sombra);
        vinco(f, [w * 0.15, 0.1, w * 0.4, 0.16, w * 0.55, 0.26], 0.01, 0.16);
        oclusao(f, -0.1, h - 0.07, w + 0.2, 0.07, "baixo", 0.14 * k, sombra);
      }
      return volume(f, {
        luz: 0.1,
        sombra: 0.14 * k,
        bordas: (ehLateral(f.face) ? 0.04 : 0.07) * k,
        cor: sombra,
        contorno: 0.2,
      });
    }
    // mangas: punho com 2 botões, carcela da manga, dobras fortes no cotovelo
    if (f.face === "ny") {
      escurecerTudo(f, 0.45, cor);
      return;
    }
    if (f.face === "py") return volume(f, { luz: 0.12, sombra: 0, bordas: 0.06, cor: sombra });
    const p = 0.065;
    g.fillStyle = misturar(cor, "#ffffff", 0.3);
    g.fillRect(-0.1, h - p, w + 0.2, p + 0.1);
    oclusao(f, -0.1, h - p - 0.03, w + 0.2, 0.03, "baixo", 0.26 * k, sombra);
    g.fillStyle = alfa(sombra, 0.3 * k);
    g.fillRect(-0.1, h - p, w + 0.2, Math.max(0.003, pxs(f, 1.5)));
    costura(
      f,
      [
        [-0.1, h - p + 0.007],
        [w + 0.1, h - p + 0.007],
      ],
      linha,
      { traco: 0.006 },
    );
    costura(
      f,
      [
        [-0.1, h - 0.008],
        [w + 0.1, h - 0.008],
      ],
      linha,
      { traco: 0.006 },
    );
    if (f.face === faceExterna(f.lado)) {
      for (const dx of [-0.018, 0.018]) botao(f, w * 0.5 + dx, h - p / 2, 0.007, botaoCor);
      g.fillStyle = misturar(cor, "#ffffff", 0.3);
      g.fillRect(w * 0.3 - 0.012, h - p - 0.08, 0.024, 0.08);
      oclusao(f, w * 0.3 + 0.006, h - p - 0.08, 0.008, 0.08, "esq", 0.25 * k, sombra);
      costura(
        f,
        [
          [w * 0.3 - 0.008, h - p - 0.075],
          [w * 0.3 - 0.008, h - p],
        ],
        linha,
        { traco: 0.005 },
      );
    }
    if (f.face === "nz" || f.face === "pz") {
      // cotovelo (atrás) e a dobra do braço (frente)
      const forte = f.face === "nz" ? 1 : 0.7;
      vinco(f, [w * 0.12, h * 0.5, w * 0.5, h * 0.46, w * 0.88, h * 0.52], 0.011, 0.24 * forte);
      vinco(f, [w * 0.2, h * 0.57, w * 0.5, h * 0.54, w * 0.8, h * 0.59], 0.009, 0.18 * forte);
      vinco(f, [w * 0.25, h * 0.42, w * 0.5, h * 0.4, w * 0.75, h * 0.43], 0.008, 0.12 * forte);
    }
    if (f.face === faceInterna(f.lado))
      costura(
        f,
        [
          [w / 2, 0],
          [w / 2, h - p],
        ],
        linha,
        { traco: 0.006 },
      );
    // o tecido sobra em cima do punho
    vinco(f, [w * 0.08, h - p - 0.035, w * 0.5, h - p - 0.06, w * 0.92, h - p - 0.03], 0.009, 0.2);
    oclusao(f, -0.1, -0.1, w + 0.2, 0.06, "cima", 0.14 * k, sombra);
    volume(f, { luz: 0.1, sombra: 0.12 * k, bordas: 0.06 * k, cor: sombra, contorno: 0.2 });
  };

  const seg = q === "alta" ? 28 : 16;
  return {
    partes: [tronco, ...mangas],
    livres: [
      { nome: "colarinho", w: 0.62, h: 0.06 },
      { nome: "gravata", w: 0.09, h: Math.max(0.1, gravL) },
    ],
    pele,
    pintar,
    corBase: cor,
    extras: (molde) => {
      // Colarinho: cilindro aberto na frente (o "anel de silhueta" da camisa).
      const col = new CylinderGeometry(
        0.104,
        0.114,
        0.056,
        seg,
        1,
        true,
        Math.PI * 0.12,
        Math.PI * 1.76,
      );
      // Gravata 3D: lâmina fina (4 mm) com a MESMA largura da pintada onde as
      // duas se encontram (sem degrau), alargando até a ponta.
      const w0 = laminaDaGravata(y3d, fimNaFace);
      const s = new Shape();
      s.moveTo(-w0, 0);
      s.lineTo(w0, 0);
      s.lineTo(0.04, -gravL + 0.035);
      s.lineTo(0, -gravL + 0.005);
      s.lineTo(-0.04, -gravL + 0.035);
      s.closePath();
      const grav = new ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false });
      return {
        colarinho: {
          geo: uvNoAtlas(col, molde.livres.colarinho!.uv),
          matriz: mat([0, e.topo + 0.012, 0]),
        },
        gravata: {
          geo: uvNoAtlas(normalizarUV(grav), molde.livres.gravata!.uv),
          matriz: mat([0, gravTopo, m.troncoD / 2 + 0.002]),
        },
      };
    },
  };
}

/* ———————————————————— COLETE EPI ———————————————————— */

function epi(m: Medidas, c: AvatarConfig, q: Qualidade, pose: "em-pe" | "sentado"): Peca {
  const e = esqueleto(m, pose);
  const colete = c.corRoupa;
  const camiseta = piso(c.corRoupa2);
  const linhaC = corDaLinha(colete);
  const vies = escurecer(colete, 0.28);
  const { partes: mangas, pele } = mangasEBracos(m, e, "curta");
  const tronco = parteTronco(m, e);
  const pn = paineis(m, e, { abertura: 0.14, esp: 0.025 });
  const H = pn[0]!.tam[1];
  const yc = pn[0]!.matriz.elements[13]!;
  const topoP = yc + H / 2;
  // Sentado, a costas de baixo (atrás do quadril) tem o seu próprio topo.
  const cB = pn.find((p) => p.nome === "costasB");
  const topoB = cB ? cB.matriz.elements[13]! + cB.tam[1] / 2 : topoP;
  // Alturas das faixas (centro), em metros acima do chão; a mesma conta em pé e sentado.
  const fx1 = e.topo - m.troncoH * 0.48;
  const fx2 = e.topo - m.troncoH * 0.75;
  const FAIXA = 0.045;
  const alcaX = (m.troncoW * (0.14 / 2) + m.troncoW / 2 + 0.027) / 2;

  /** Faixas pintadas numa face de painel (frente/costas/lado). */
  const faixasNaFace = (f: CtxFace, raio: number, alcas: number[]) => {
    const topoF = f.parte === "costasB" ? topoB : topoP;
    for (const y of [fx1, fx2]) {
      const yy = yNaFace(topoF, raio, y) - FAIXA / 2;
      refletivo(f, -0.1, yy, f.w + 0.2, FAIXA);
    }
    for (const x of alcas) {
      const ate = yNaFace(topoP, raio, fx1) - FAIXA / 2;
      refletivo(f, x - FAIXA / 2, -0.1, FAIXA, ate + 0.1);
    }
  };

  const painelFrente = (f: CtxFace) => {
    const { g, w, h } = f;
    base(f, colete);
    pano(f, "tela", 0.9);
    // a borda de dentro (fecho) fica do lado do meio do corpo
    const xi = f.lado > 0 ? 0 : w;
    const s = f.lado > 0 ? 1 : -1;
    // bolsinho com lapela e caneta no peito esquerdo do boneco
    if (f.lado > 0) {
      const bx = w * 0.55;
      const by = yNaFace(topoP, 0.012, fx1) - 0.17;
      const bw = 0.085;
      sombraDe(f, () => g.rect(bx - bw / 2, by, bw, 0.09), 0.002, 0.005, 0.25);
      g.fillStyle = escurecer(colete, 0.05);
      g.fillRect(bx - bw / 2, by, bw, 0.09);
      costura(
        f,
        [
          [bx - bw / 2 + 0.006, by + 0.004],
          [bx - bw / 2 + 0.006, by + 0.084],
          [bx + bw / 2 - 0.006, by + 0.084],
          [bx + bw / 2 - 0.006, by + 0.004],
        ],
        linhaC,
        { traco: 0.006 },
      );
      // caneta
      g.fillStyle = "#1d4ed8";
      g.fillRect(bx - 0.025, by - 0.045, 0.01, 0.06);
      g.fillStyle = "#cbd5e1";
      g.fillRect(bx - 0.026, by - 0.05, 0.012, 0.012);
      // lapela
      sombraDe(
        f,
        () => g.rect(bx - bw / 2 - 0.004, by - 0.004, bw + 0.008, 0.032),
        0.001,
        0.005,
        0.3,
      );
      g.fillStyle = clarear(colete, 0.06);
      g.fillRect(bx - bw / 2 - 0.004, by - 0.004, bw + 0.008, 0.032);
      costura(
        f,
        [
          [bx - bw / 2, by + 0.022],
          [bx + bw / 2, by + 0.022],
        ],
        linhaC,
        { traco: 0.005 },
      );
    }
    faixasNaFace(f, 0.012, [xi + s * (alcaX - m.troncoW * 0.07)]);
    // fecho: fita do zíper na borda de dentro
    ziper(f, xi + s * 0.008, -0.05, h + 0.05, escurecer(colete, 0.15), "#d1d5db");
    // viés em volta
    g.strokeStyle = vies;
    g.lineWidth = Math.max(0.012, pxs(f, 3));
    g.strokeRect(0, 0, w, h);
    dobra(f, [w * 0.2, h * 0.86, w * 0.5, h * 0.84, w * 0.8, h * 0.87], 0.01, 0.16);
    volume(f, { luz: 0.1, sombra: 0.18, bordas: 0.05, contorno: 0.25 });
  };

  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    if (f.livre === "refletivo") {
      refletivo(f, -0.1, -0.1, w + 0.2, h + 0.2);
      return;
    }
    if (f.parte.startsWith("painel")) {
      if (f.face === "pz") return painelFrente(f);
      base(f, colete);
      if (f.face === "nz") return escurecerTudo(f, 0.3);
      g.fillStyle = vies;
      g.fillRect(-0.1, -0.1, w + 0.2, h + 0.2);
      return volume(f, { luz: 0.1, sombra: 0.2, bordas: 0 });
    }
    if (f.parte.startsWith("costas")) {
      base(f, colete);
      pano(f, "tela", 0.9);
      if (f.face === "py") {
        // as alças passam por cima do ombro (y=0 = costas)
        for (const x of [w / 2 - alcaX, w / 2 + alcaX])
          refletivo(f, x - FAIXA / 2, -0.1, FAIXA, h + 0.2);
        oclusao(f, w * 0.25, h * 0.7, w * 0.5, h * 0.3, "baixo", 0.3);
        return volume(f, { luz: 0.1, sombra: 0, bordas: 0.05 });
      }
      if (f.face === "pz") {
        // a de baixo (sentado) mostra a frente só nos lados: é a borda do colete, com viés
        if (f.parte === "costasB") {
          g.fillStyle = vies;
          g.fillRect(-0.1, -0.1, w + 0.2, h + 0.2);
          return volume(f, { luz: 0.1, sombra: 0.2, bordas: 0 });
        }
        return escurecerTudo(f, 0.4);
      }
      if (f.face === "nz") {
        faixasNaFace(f, 0.012, [w / 2 - alcaX, w / 2 + alcaX]);
        dobra(f, [w * 0.25, h * 0.15, w * 0.5, h * 0.13, w * 0.75, h * 0.16], 0.012, 0.14);
      } else {
        faixasNaFace(f, 0.012, []);
        emenda(
          f,
          [
            [w * 0.5, 0],
            [w * 0.5, h],
          ],
          0.25,
        );
      }
      // a barra com viés: sentado, a costas de cima continua na de baixo (sem barra no meio)
      if (!(e.sentado && f.parte === "costas")) {
        g.strokeStyle = vies;
        g.lineWidth = Math.max(0.01, pxs(f, 3));
        g.beginPath();
        g.moveTo(-0.1, h);
        g.lineTo(w + 0.1, h);
        g.stroke();
      }
      return volume(f, { luz: 0.1, sombra: 0.2, bordas: 0.06, contorno: 0.25 });
    }
    // —— camiseta por baixo (tronco e mangas curtas) ——
    base(f, camiseta);
    pano(f, "ruido");
    const sombra = sombraDe_(camiseta);
    if (f.parte === "tronco") {
      if (f.face === "pz") golaCareca(f, camiseta, c.pele, 0.075, 0.05, 0.016);
      return volume(f, { luz: 0.06, sombra: 0.2, bordas: 0.12, cor: sombra });
    }
    if (f.face === "ny") return escurecerTudo(f, 0.5);
    if (f.face !== "py") {
      costura(
        f,
        [
          [-0.1, h - 0.02],
          [w + 0.1, h - 0.02],
        ],
        corDaLinha(camiseta),
        { duplo: 0.006 },
      );
      oclusao(f, -0.1, -0.1, w + 0.2, 0.06, "cima", 0.25, sombra);
      if (f.face === "nz")
        dobra(f, [w * 0.2, h * 0.5, w * 0.5, h * 0.45, w * 0.8, h * 0.52], 0.01, 0.16, sombra);
    }
    volume(f, { luz: 0.1, sombra: 0.14, bordas: 0.08, cor: sombra });
  };

  /** A máscara do brilho: só as faixas (painel, costas e as tiras 3D). */
  const mascara: Pintor = (f) => {
    if (f.livre === "refletivo") return refletivo(f, -0.1, -0.1, f.w + 0.2, f.h + 0.2);
    if (f.parte.startsWith("painel") && f.face === "pz") {
      const xi = f.lado > 0 ? 0 : f.w;
      const s = f.lado > 0 ? 1 : -1;
      return faixasNaFace(f, 0.012, [xi + s * (alcaX - m.troncoW * 0.07)]);
    }
    if (f.parte.startsWith("costas")) {
      if (f.face === "nz") return faixasNaFace(f, 0.012, [f.w / 2 - alcaX, f.w / 2 + alcaX]);
      if (f.face === "px" || f.face === "nx") return faixasNaFace(f, 0.012, []);
      if (f.face === "py") {
        for (const x of [f.w / 2 - alcaX, f.w / 2 + alcaX])
          refletivo(f, x - FAIXA / 2, -0.1, FAIXA, f.h + 0.2);
      }
    }
  };

  // Faixas em relevo (3 mm) por cima das pintadas: frente E/D, costas e as alças.
  const tiras: ParteMolde[] = [];
  const D = m.troncoD;
  const zF = D / 2 + 0.002 + 0.025 + 0.0015;
  for (const l of LADOS) {
    const P = pn[l < 0 ? 0 : 1]!;
    const px = P.matriz.elements[12]!;
    const pw = P.tam[0];
    for (const [i, y] of [fx1, fx2].entries()) {
      // Sentado, a faixa que cairia abaixo do painel (dentro da coxa) não vira relevo.
      if (y - FAIXA / 2 < P.matriz.elements[13]! - P.tam[1] / 2) continue;
      tiras.push({
        nome: `tira${i}${l}`,
        tam: [pw - 0.004, FAIXA, 0.003],
        raio: 0.0012,
        livre: "refletivo",
        matriz: mat([px, y, zF]),
      });
    }
    const xa = alcaX * l;
    const hA = topoP - (fx1 + FAIXA / 2) - 0.004;
    tiras.push({
      nome: `alca${l}`,
      tam: [FAIXA, hA, 0.003],
      raio: 0.0012,
      livre: "refletivo",
      matriz: mat([xa, fx1 + FAIXA / 2 + hA / 2, zF]),
    });
  }
  const costas = pn[2]!;
  const zT = costas.matriz.elements[14]! - costas.tam[2] / 2 - 0.0015;
  for (const [i, y] of [fx1, fx2].entries()) {
    tiras.push({
      nome: `tiraC${i}`,
      tam: [costas.tam[0] - 0.02, FAIXA, 0.003],
      raio: 0.0012,
      livre: "refletivo",
      matriz: mat([0, y, zT]),
    });
  }

  return {
    partes: [tronco, ...mangas, ...pn, ...tiras],
    livres: [{ nome: "refletivo", w: 0.3, h: 0.05 }],
    pele,
    pintar,
    mascara,
    emissivoFaixas: true,
    mostraPele: true,
    corBase: colete,
  };
}

/* ———————————————————— peças simples (Fase 0) ———————————————————— */

type Gola = "careca" | "regata" | "polo" | "camisa" | "alta";

type OpSimples = {
  cor: string;
  grao: Grao;
  gola: Gola;
  manga: Manga;
  botoes?: number;
  bolso?: boolean;
  /** O símbolo da empresa bordado no bolso (o uniforme, 19/10/2026). */
  logo?: boolean;
  /** Bandeira do Brasil na manga esquerda e do Paraná na direita (o uniforme). */
  bandeiras?: boolean;
  /** Pinta por cima da base, antes da construção (listras, xadrez, tricô). */
  padrao?: (f: CtxFace) => void;
  estampa?: boolean;
  ribana?: boolean;
  rugosidade?: number;
};

/**
 * Pintura simples mas VÁLIDA (nada branco, sombra, costura, gola, punho):
 * as peças que a Fase 1 ainda vai caprichar.
 */
function simples(o: OpSimples): CriarPeca {
  return (m, c, _q, pose) => {
    const e = esqueleto(m, pose);
    const cor = piso(o.cor === "corRoupa" ? c.corRoupa : o.cor);
    const sombra = sombraDe_(cor);
    const linha = corDaLinha(cor);
    const { partes: mangas, pele } = mangasEBracos(m, e, o.manga);
    const botaoCor = luminancia(cor) > 0.6 ? escurecer(cor, 0.25) : clarear(cor, 0.35);
    const pintar: Pintor = (f) => {
      const { g, w, h } = f;
      base(f, cor);
      pano(f, o.grao);
      o.padrao?.(f);
      if (f.parte === "tronco") {
        if (f.face === "pz") {
          const cx = w / 2;
          if (o.ribana) canelado(f, -0.1, h - 0.06, w + 0.2, 0.16, cor);
          else
            costura(
              f,
              [
                [-0.1, h - 0.02],
                [w + 0.1, h - 0.02],
              ],
              linha,
              { duplo: 0.006 },
            );
          if (o.estampa)
            desenharEstampaNaFace(f, c.estampa, cor, cx, h * 0.42, Math.min(0.2, w * 0.36));
          if (o.bolso) {
            const bx = cx + w * 0.22;
            sombraDe(f, () => g.rect(bx - 0.05, 0.14, 0.1, 0.11), 0.002, 0.004, 0.18);
            g.fillStyle = clarear(cor, 0.04);
            g.fillRect(bx - 0.05, 0.14, 0.1, 0.11);
            costura(
              f,
              [
                [bx - 0.045, 0.145],
                [bx - 0.045, 0.245],
                [bx + 0.045, 0.245],
                [bx + 0.045, 0.145],
              ],
              linha,
              { traco: 0.006 },
            );
            if (o.logo) simboloDaEmpresa(g, bx, 0.192, 0.034);
          }
          if (o.botoes) {
            g.fillStyle = alfa(sombra, 0.1);
            g.fillRect(
              cx - 0.02,
              o.gola === "polo" ? 0.02 : -0.1,
              0.04,
              o.gola === "polo" ? 0.16 : h + 0.2,
            );
            for (let i = 0; i < o.botoes; i++) {
              botao(
                f,
                cx,
                0.06 + i * (o.gola === "polo" ? 0.045 : (h - 0.12) / (o.botoes - 0.6)),
                0.0075,
                botaoCor,
              );
            }
          }
          if (o.gola === "careca") golaCareca(f, cor, c.pele);
          if (o.gola === "alta") {
            canelado(f, w * 0.3, -0.1, w * 0.4, 0.13, cor);
            oclusao(f, w * 0.3, 0.02, w * 0.4, 0.02, "baixo", 0.3);
          }
          if (o.gola === "polo" || o.gola === "camisa") pontasDeGola(f, cor, linha, sombra);
          if (o.gola === "regata") {
            g.fillStyle = c.pele;
            g.beginPath();
            g.ellipse(cx, -0.01, 0.11, 0.12, 0, 0, Math.PI);
            g.fill();
            for (const s of [-1, 1]) {
              g.beginPath();
              g.ellipse(s < 0 ? -0.02 : w + 0.02, -0.02, 0.1, 0.2, 0, 0, Math.PI * 2);
              g.fill();
            }
            g.strokeStyle = c.corRoupa2;
            g.lineWidth = 0.01;
            g.beginPath();
            g.ellipse(cx, -0.01, 0.115, 0.125, 0, 0, Math.PI);
            g.stroke();
          }
          for (const s of [-1, 1]) {
            const x0 = s < 0 ? 0.015 : w - 0.015;
            dobra(f, [x0, 0.12, x0 - s * 0.06, 0.17, x0 - s * 0.12, 0.25], 0.011, 0.16, sombra);
          }
        } else if (f.face === "nz") {
          if (o.ribana) canelado(f, -0.1, h - 0.06, w + 0.2, 0.16, cor);
          if (o.gola === "camisa" || o.gola === "polo")
            costura(
              f,
              [
                [-0.1, 0.1],
                [w + 0.1, 0.1],
              ],
              linha,
              { duplo: 0.005 },
            );
          if (o.gola === "regata") {
            g.fillStyle = c.pele;
            for (const s of [-1, 1]) {
              g.beginPath();
              g.ellipse(s < 0 ? -0.02 : w + 0.02, -0.02, 0.1, 0.2, 0, 0, Math.PI * 2);
              g.fill();
            }
          }
          dobra(f, [w * 0.25, h * 0.55, w * 0.5, h * 0.5, w * 0.75, h * 0.56], 0.012, 0.14, sombra);
        } else if (f.face === "py") {
          if (o.gola === "regata") {
            g.fillStyle = c.pele;
            g.fillRect(-0.1, -0.1, w * 0.3 + 0.1, h + 0.2);
            g.fillRect(w * 0.7, -0.1, w * 0.3 + 0.1, h + 0.2);
          }
          costura(
            f,
            [
              [0.01, h * 0.5],
              [w - 0.01, h * 0.5],
            ],
            linha,
          );
        } else {
          if (o.gola === "regata") {
            g.fillStyle = c.pele;
            g.beginPath();
            g.ellipse(w / 2, -0.02, w * 0.6, 0.2, 0, 0, Math.PI * 2);
            g.fill();
          }
          if (o.ribana) canelado(f, -0.1, h - 0.06, w + 0.2, 0.16, cor);
          costura(
            f,
            [
              [w / 2, 0.02],
              [w / 2, h],
            ],
            linha,
          );
          oclusao(f, -0.1, -0.1, w + 0.2, 0.2, "cima", 0.25);
        }
        return volume(f, {
          luz: 0.1,
          sombra: 0.18,
          bordas: ehLateral(f.face) ? 0.04 : 0.08,
          cor: sombra,
        });
      }
      // mangas
      if (f.face === "ny") return escurecerTudo(f, 0.5);
      // As bandeiras na face de FORA de cada manga, na altura do ombro.
      if (o.bandeiras && f.face === (f.lado === 1 ? "px" : "nx"))
        bandeira(g, f.lado === 1 ? "brasil" : "parana", w / 2, 0.085, Math.min(0.1, w * 0.8));
      if (f.face !== "py") {
        if (o.manga === "longa" && o.ribana) canelado(f, -0.1, h - 0.055, w + 0.2, 0.155, cor);
        else if (o.manga === "longa") {
          costura(
            f,
            [
              [-0.1, h - 0.06],
              [w + 0.1, h - 0.06],
            ],
            linha,
          );
          oclusao(f, -0.1, h - 0.085, w + 0.2, 0.025, "baixo", 0.2, sombra);
        } else
          costura(
            f,
            [
              [-0.1, h - 0.02],
              [w + 0.1, h - 0.02],
            ],
            linha,
            { duplo: 0.006 },
          );
        if (f.face === "nz")
          dobra(f, [w * 0.15, h * 0.5, w * 0.5, h * 0.46, w * 0.85, h * 0.52], 0.01, 0.18, sombra);
        if (f.face === faceInterna(f.lado))
          costura(
            f,
            [
              [w / 2, 0],
              [w / 2, h - 0.06],
            ],
            linha,
          );
        oclusao(f, -0.1, -0.1, w + 0.2, 0.05, "cima", 0.15, sombra);
      }
      volume(f, { luz: 0.1, sombra: 0.14, bordas: 0.08, cor: sombra });
    };
    return {
      partes: [parteTronco(m, e), ...mangas],
      livres: [],
      pele,
      pintar,
      mostraPele: o.gola === "careca" || o.gola === "regata",
      rugosidade: o.rugosidade,
      corBase: cor,
    };
  };
}

type OpCasaco = {
  casaco: (c: AvatarConfig) => string;
  baixo: (c: AvatarConfig) => string;
  abertura: number;
  esp?: number;
  desce?: number;
  rugosidade?: number;
  gravata?: string;
  lapela?: boolean;
  ziper?: boolean;
  /** As mangas são da camisa de baixo (colete), não do casaco. */
  mangaDeBaixo?: boolean;
  grao: Grao;
  /** Malha de tricô (cardigã): pontos de meia, ribana na barra e no punho, botões na frente. */
  trico?: boolean;
};

/** Botão de pérola do cardigã. */
const BOTAO_PEROLA = "#f5efe6";

/** Casaco aberto (jaqueta, terno, colete, jaleco, cardigã) em pintura simples. */
function casacoSimples(o: OpCasaco): CriarPeca {
  return (m, c, _q, pose) => {
    const e = esqueleto(m, pose);
    const cc = piso(o.casaco(c));
    const cb = piso(o.baixo(c));
    const sombraC = sombraDe_(cc);
    const sombraB = sombraDe_(cb);
    const linhaC = corDaLinha(cc);
    const { partes: mangas, pele } = mangasEBracos(m, e, "longa");
    const pn = paineis(m, e, { abertura: o.abertura, esp: o.esp, desce: o.desce });
    const corManga = o.mangaDeBaixo ? cb : cc;
    const pintar: Pintor = (f) => {
      const { g, w, h } = f;
      if (f.parte === "tronco") {
        base(f, cb);
        pano(f, "ruido");
        if (f.face === "pz") {
          const cx = w / 2;
          if (o.gravata) {
            pontasDeGola(f, cb, corDaLinha(cb), sombraB, 0.06);
            gravataPintada(f, o.gravata, h * 0.62);
          } else golaCareca(f, cb, c.pele, 0.075, 0.05, 0.016);
          if (!o.gravata)
            dobra(f, [cx - 0.05, h * 0.5, cx, h * 0.55, cx + 0.05, h * 0.5], 0.008, 0.12, sombraB);
        }
        return volume(f, { luz: 0.06, sombra: 0.22, bordas: 0.16, cor: sombraB });
      }
      if (f.parte.startsWith("manga")) {
        base(f, corManga);
        pano(f, o.mangaDeBaixo ? "ruido" : o.grao);
        if (f.face === "ny") return escurecerTudo(f, 0.5);
        if (o.trico && f.face !== "py") {
          trico(f, corManga);
          canelado(f, -0.1, h - 0.07, w + 0.2, 0.17, corManga);
          return volume(f, { luz: 0.12, sombra: 0.14, bordas: 0.08, cor: sombraDe_(corManga) });
        }
        const lc = corDaLinha(corManga);
        if (f.face !== "py") {
          costura(
            f,
            [
              [-0.1, h - 0.05],
              [w + 0.1, h - 0.05],
            ],
            lc,
          );
          if (f.face === "nz")
            dobra(f, [w * 0.15, h * 0.5, w * 0.5, h * 0.46, w * 0.85, h * 0.52], 0.01, 0.22);
          if (f.face === faceInterna(f.lado))
            costura(
              f,
              [
                [w / 2, 0],
                [w / 2, h - 0.05],
              ],
              lc,
            );
          dobra(f, [w * 0.2, h * 0.75, w * 0.5, h * 0.72, w * 0.8, h * 0.76], 0.009, 0.16);
        }
        return volume(f, { luz: 0.12, sombra: 0.14, bordas: 0.08, cor: sombraDe_(corManga) });
      }
      // painéis e costas do casaco
      base(f, cc);
      pano(f, o.grao);
      if (o.trico && f.face !== "py" && f.face !== "ny") {
        trico(f, cc);
        canelado(f, -0.1, h - 0.07, w + 0.2, 0.17, cc);
      }
      if (f.parte.startsWith("painel") && f.face === "pz") {
        const xi = f.lado > 0 ? 0 : w;
        const s = f.lado > 0 ? 1 : -1;
        if (o.trico) {
          // a carcela de ribana e os botões (na frente direita do boneco)
          canelado(f, xi - (s > 0 ? 0.004 : 0.036), -0.1, 0.04, h + 0.2, cc);
          if (f.lado < 0)
            for (let i = 0; i < 5; i++)
              botao(f, xi + s * 0.018, 0.05 + i * ((h - 0.14) / 4), 0.011, BOTAO_PEROLA);
        }
        if (o.lapela) {
          // lapela: triângulo do ombro até o 1º botão, com sombra projetada
          const pts: [number, number][] = [
            [xi, -0.02],
            [xi + s * Math.min(0.13, w * 0.7), -0.02],
            [xi + s * 0.02, h * 0.5],
            [xi, h * 0.5],
          ];
          sombraDe(f, () => poligono(g, pts), 0.003 * s, 0.006, 0.35);
          g.fillStyle = clarear(cc, 0.06);
          poligono(g, pts);
          g.fill();
          costura(
            f,
            [
              [xi + s * Math.min(0.12, w * 0.65), -0.01],
              [xi + s * 0.025, h * 0.48],
            ],
            linhaC,
            { traco: 0.006 },
          );
          if (f.lado < 0)
            for (let i = 0; i < 2; i++)
              botao(f, xi + s * 0.03, h * (0.58 + i * 0.15), 0.011, escurecer(cc, 0.5));
          // bolso faca
          g.fillStyle = "rgba(0,0,0,0.35)";
          g.fillRect(w * 0.25, h * 0.72, w * 0.5, Math.max(0.006, pxs(f, 2)));
        }
        if (o.ziper) ziper(f, xi + s * 0.008, -0.05, h + 0.05, cc);
        dobra(f, [w * 0.2, h * 0.3, w * 0.5, h * 0.36, w * 0.8, h * 0.32], 0.012, 0.18, sombraC);
        if (!o.lapela) {
          g.fillStyle = alfa(sombraC, 0.1);
          g.fillRect(w * 0.2, h * 0.66, w * 0.6, 0.1);
          costura(
            f,
            [
              [w * 0.2, h * 0.66],
              [w * 0.8, h * 0.66],
            ],
            linhaC,
          );
        }
      } else if (f.face === "nz") {
        dobra(f, [w * 0.25, h * 0.2, w * 0.5, h * 0.17, w * 0.75, h * 0.21], 0.014, 0.18, sombraC);
        emenda(
          f,
          [
            [w / 2, 0],
            [w / 2, h],
          ],
          0.2,
        );
      } else if (f.face === "pz" || f.face === "ny") {
        return escurecerTudo(f, 0.4);
      }
      return volume(f, { luz: 0.12, sombra: 0.2, bordas: 0.08, cor: sombraC, contorno: 0.25 });
    };
    return {
      partes: [parteTronco(m, e), ...mangas, ...pn],
      livres: [],
      pele,
      pintar,
      mostraPele: !o.gravata,
      rugosidade: o.rugosidade,
      corBase: cc,
    };
  };
}

/** Flanela xadrez: tartan de 3 cores contínuo nas quinas e entre tronco e mangas. */
const xadrez: CriarPeca = (m, c, q, pose) => {
  const escura = escurecer(c.corRoupa, 0.45);
  const clara = clarear(c.corRoupa2, 0.1);
  return simples({
    cor: "corRoupa",
    grao: "sarja",
    gola: "camisa",
    manga: "longa",
    botoes: 6,
    bolso: true,
    padrao: (f) => xadrezContinuo(f, escura, clara, 0.09, misturar(c.corRoupa, c.corRoupa2, 0.5)),
  })(m, c, q, pose);
};

const listrada: CriarPeca = (m, c, q, pose) =>
  simples({
    cor: "corRoupa",
    grao: "ruido",
    gola: "careca",
    manga: "longa",
    estampa: true,
    padrao: (f) => listrasContinuas(f, alfa(c.corRoupa2, 0.85), 0.05, 0.03),
  })(m, c, q, pose);

const sueter: CriarPeca = (m, c, q, pose) =>
  simples({
    cor: "corRoupa",
    grao: "ruido",
    gola: "careca",
    manga: "longa",
    ribana: true,
    estampa: true,
    padrao: (f) => trico(f, c.corRoupa),
  })(m, c, q, pose);

/* ———————————————————— femininas (13/10/2026) ———————————————————— */

/**
 * Decote da blusa/vestido: redondo, canoa (raso e largo), V, alcinha
 * (ombros de fora, alças finas) e ciganinha (ombros e o alto dos braços de
 * fora, elástico franzido na linha do peito).
 */
type Decote = "redondo" | "canoa" | "v" | "alca" | "ciganinha";

type OpBlusa = {
  decote: Decote;
  manga: Manga;
  /** Bufante: o topo da manga mais largo; sino: a boca mais larga. */
  formaManga?: "bufante" | "sino";
  /** Barriguinha de fora: pele pintada da barra até o cós. */
  cropped?: boolean;
  /** Babado 3D: na cintura (peplum, cobre o cós) ou na linha dos ombros (ciganinha). */
  babado?: "cintura" | "ombros";
  /** Laço 3D na cor de destaque: no decote ou na cintura. */
  laco?: "decote" | "cintura";
  estampa?: boolean;
  /** Poá na cor de destaque. */
  bolinhas?: boolean;
  /** Padrão corrido por cima da base (floral, 16/10/2026). */
  padrao?: (f: CtxFace, c: AvatarConfig, cor: string) => void;
  /** Renda na cor de destaque no decote (e na boca da manga sino). */
  renda?: boolean;
  /** Faixa na cintura na cor de destaque (vestido, macacão). */
  cinto?: boolean;
  /** Saia de vestido (corpo inteiro): o comprimento depende da perna e do calçado. */
  saia?: { op: (m: Medidas, sapato: string) => OpSaia; babado?: boolean; fenda?: boolean };
  grao?: Grao;
  rugosidade?: number;
};

/** Linha do decote da alcinha e da ciganinha, em y da FACE do tronco (m). */
const Y_ALCA = 0.12;
const Y_CIGANINHA = 0.1;

/** A cor de destaque (laço, babado, poá): a 2ª cor, ou um rosa se ela some no tecido. */
const corDeDestaque = (c: AvatarConfig, cor: string) =>
  contrasta(c.corRoupa2, cor) ? c.corRoupa2 : luminancia(cor) > 0.55 ? "#db2777" : "#f9a8d4";

/**
 * O laço 3D: nó, duas alças inclinadas e duas pontas caindo, de frente
 * para +z. `k` escala (1 = laço de cintura, ~12 cm de ponta a ponta).
 */
function lacoPartes(x: number, y: number, z: number, k: number): ParteMolde[] {
  const p = (
    nome: string,
    tam: [number, number, number],
    pos: [number, number, number],
    rz: number,
  ): ParteMolde => ({
    nome,
    tam: tam.map((v) => v * k) as [number, number, number],
    raio: 0.01 * k,
    matriz: mat([x + pos[0] * k, y + pos[1] * k, z + pos[2] * k], [0, 0, rz]),
  });
  return [
    p("lacoA", [0.072, 0.05, 0.022], [-0.046, 0.006, -0.002], -0.3),
    p("lacoB", [0.072, 0.05, 0.022], [0.046, 0.006, -0.002], 0.3),
    p("lacoC", [0.022, 0.07, 0.012], [-0.02, -0.044, 0], -0.35),
    p("lacoD", [0.022, 0.07, 0.012], [0.02, -0.044, 0], 0.35),
    p("lacoN", [0.032, 0.034, 0.028], [0, 0.004, 0.003], 0),
  ];
}

/** Uma face do laço: cetim com o franzido puxando para o nó. */
function pintarLaco(f: CtxFace, cor: string) {
  const { g, w, h } = f;
  base(f, cor);
  if (f.face === "ny" || f.face === "nz") return escurecerTudo(f, 0.3, cor);
  if (f.parte === "lacoN") {
    g.strokeStyle = "rgba(0,0,0,0.3)";
    g.lineWidth = Math.max(0.003, pxs(f, 1.5));
    for (const x of [w * 0.35, w * 0.65]) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    return volume(f, { luz: 0.2, sombra: 0.3, bordas: 0.2, contorno: 0.3 });
  }
  if (f.face === "pz" && (f.parte === "lacoA" || f.parte === "lacoB")) {
    // a alça A fica à direita do boneco (x < 0): o nó está do lado +x dela
    const noDaDireita = f.parte === "lacoA";
    oclusao(
      f,
      noDaDireita ? w * 0.65 : -0.1,
      -0.1,
      w * 0.35 + 0.1,
      h + 0.2,
      noDaDireita ? "dir" : "esq",
      0.4,
    );
    dobra(f, [w * 0.15, h * 0.5, w * 0.5, h * 0.42, w * 0.9, h * 0.5], 0.004, 0.25);
  }
  // o brilho do cetim
  g.fillStyle = "rgba(255,255,255,0.2)";
  g.fillRect(w * 0.15, h * 0.18, w * 0.7, Math.max(0.003, h * 0.12));
  volume(f, { luz: 0.18, sombra: 0.25, bordas: 0.12, contorno: 0.3 });
}

/** Franzido de elástico: riscos verticais curtos numa faixa de 3 cm a partir de `y`. */
function elasticoFranzido(f: CtxFace, y: number) {
  const { g, w } = f;
  const passo = 0.012;
  g.fillStyle = "rgba(0,0,0,0.18)";
  for (let x = -f.faixa % passo; x < w + passo; x += passo)
    g.fillRect(x, y, Math.max(0.003, pxs(f, 1.5)), 0.03);
  oclusao(f, -0.1, y + 0.03, w + 0.2, 0.02, "cima", 0.18);
}

/** Pele do decote na FRENTE do tronco + o acabamento da borda (viés, alças, renda). */
function decoteFrente(
  f: CtxFace,
  d: Decote,
  cor: string,
  pele: string,
  destaque: string,
  comRenda: boolean,
) {
  const { g, w } = f;
  const cx = w / 2;
  g.save();
  g.fillStyle = pele;
  g.beginPath();
  if (d === "redondo") g.ellipse(cx, -0.01, 0.105, 0.085, 0, 0, Math.PI * 2);
  else if (d === "canoa") g.ellipse(cx, -0.01, 0.17, 0.05, 0, 0, Math.PI * 2);
  else if (d === "v") {
    g.moveTo(cx - 0.1, -0.02);
    g.lineTo(cx + 0.1, -0.02);
    g.lineTo(cx, 0.17);
    g.closePath();
  } else {
    // alcinha: reta com um "coraçãozinho" no meio; ciganinha: reta
    const y = d === "alca" ? Y_ALCA : Y_CIGANINHA;
    g.moveTo(-0.2, -0.2);
    g.lineTo(w + 0.2, -0.2);
    g.lineTo(w + 0.2, y);
    if (d === "alca") {
      g.quadraticCurveTo(w * 0.72, y - 0.035, cx, y + 0.012);
      g.quadraticCurveTo(w * 0.28, y - 0.035, -0.2, y);
    } else g.lineTo(-0.2, y);
    g.closePath();
  }
  g.fill();
  // o viés na borda do decote
  g.strokeStyle = escurecer(cor, 0.12);
  g.lineWidth = Math.max(0.01, pxs(f, 2));
  g.stroke();
  g.restore();
  if (d === "alca") {
    // as alças finas subindo até o ombro
    for (const x of [w * 0.3, w * 0.7]) {
      g.fillStyle = "rgba(0,0,0,0.2)";
      g.fillRect(x - 0.009, -0.1, 0.022, Y_ALCA + 0.08);
      g.fillStyle = cor;
      g.fillRect(x - 0.011, -0.1, 0.022, Y_ALCA + 0.07);
    }
    if (comRenda) renda(f, destaque, Y_ALCA - 0.012);
  } else if (d === "ciganinha") {
    elasticoFranzido(f, Y_CIGANINHA);
    if (comRenda) renda(f, destaque, Y_CIGANINHA - 0.01);
  } else {
    if (comRenda) renda(f, destaque, 0.004, cx - 0.12, cx + 0.12, 0.022);
    // a sombra do pescoço dentro do decote
    g.fillStyle = "rgba(0,0,0,0.14)";
    g.beginPath();
    g.ellipse(cx, -0.01, 0.07, 0.035, 0, 0, Math.PI);
    g.fill();
  }
}

/** Cavas da regata nos cantos de cima (frente e costas, sem manga). */
function cavas(f: CtxFace, pele: string) {
  const { g, w } = f;
  g.fillStyle = pele;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(s < 0 ? -0.02 : w + 0.02, -0.02, 0.1, 0.2, 0, 0, Math.PI * 2);
    g.fill();
  }
}

/**
 * A blusa feminina — e o corpo de cima dos vestidos e do macacão: tronco,
 * mangas com forma, decote com pele e os enfeites 3D (babado, laço).
 */
function blusa(o: OpBlusa): CriarPeca {
  return (m, c, _q, pose) => {
    const e = esqueleto(m, pose);
    const cor = piso(c.corRoupa);
    const sombra = sombraDe_(cor);
    const linha = corDaLinha(cor);
    const destaque = corDeDestaque(c, cor);
    const grao = o.grao ?? "ruido";
    const semManga = o.manga === "nenhuma";
    const ombroDeFora = o.decote === "alca" || o.decote === "ciganinha";
    const { partes: mangasRetas, pele } = mangasEBracos(m, e, o.manga);
    // Bufante: o topo 18% mais largo (o excesso entra no tronco); sino: a boca alarga.
    const mangas = mangasRetas.map((p): ParteMolde => {
      const [w, h, d] = p.tam;
      if (o.formaManga === "bufante")
        return { ...p, tam: [w * 1.05, h, d * 1.05], afunilar: -0.18 };
      if (o.formaManga === "sino") return { ...p, tam: [w * 1.22, h, d * 1.22], afunilar: 0.2 };
      return p;
    });
    const tronco = parteTronco(m, e);
    const partes: ParteMolde[] = [tronco, ...mangas];
    const aneis: ParteMolde[] = [];
    const saia = o.saia ? resolverSaia(m, e, c.sapato, o.saia.op(m, c.sapato)) : null;
    if (saia) partes.push(parteSaia(m, e, saia));

    /** y (na face do tronco) de uma altura do mundo. */
    const yT = (yMundo: number) => yNaFace(e.topo, tronco.raio, yMundo);
    /** y (na face da manga) de uma altura do mundo: a manga começa no topo do tronco. */
    const yM = (yMundo: number) => yNaFace(e.topo, 0.05, yMundo);
    /** A linha da ciganinha no mundo (o y_face Y_CIGANINHA do tronco). */
    const yLinha = e.topo - tronco.raio - (Y_CIGANINHA - bordaCurva(tronco.raio));

    // —— babado 3D: anel com roda (a boca 3,5–5 cm maior que o tronco) ——
    if (o.babado === "cintura") {
      aneis.push({
        nome: "babado",
        tam: [m.troncoW + 0.05, 0.09, m.troncoD + 0.05],
        raio: 0.05,
        afunilar: 0.1,
        matriz: mat([0, e.quadrilY + 0.04, 0]),
        ocultas: ["py"],
      });
    } else if (o.babado === "ombros") {
      aneis.push({
        nome: "babado",
        tam: [m.troncoW + 0.035, 0.075, m.troncoD + 0.035],
        raio: 0.05,
        afunilar: 0.06,
        matriz: mat([0, yLinha - 0.075 / 2 + 0.006, 0]),
        ocultas: ["py"],
      });
    }

    // —— laço 3D ——
    const frente = m.troncoD / 2 + 0.016;
    if (o.laco === "decote") partes.push(...lacoPartes(0, e.topo - 0.075, frente, 0.85));
    else if (o.laco === "cintura") {
      // Sentado, a coxa (e a saia deitada nela) cobre a cintura: o laço sobe.
      const y = !e.sentado
        ? e.quadrilY + 0.03
        : saia
          ? e.quadrilY + 0.105 + 0.5 * saia.fundo * m.troncoD * 0.86
          : topoDaCoxaSentado(m, e) + 0.035;
      partes.push(...lacoPartes(0, y, frente, 1));
    }

    const pintarTronco = (f: CtxFace) => {
      const { g, w, h } = f;
      const cx = w / 2;
      if (f.face === "pz") {
        if (o.estampa) {
          const ye = o.cropped ? h * 0.32 : o.decote === "alca" ? h * 0.46 : h * 0.42;
          const lado = Math.min(o.cropped ? 0.16 : 0.19, w * 0.34);
          desenharEstampaNaFace(f, c.estampa, cor, cx, ye, lado);
        }
        decoteFrente(f, o.decote, cor, c.pele, destaque, !!o.renda);
        if (semManga && !ombroDeFora) cavas(f, c.pele);
        for (const s of [-1, 1]) {
          const x0 = s < 0 ? 0.03 : w - 0.03;
          dobra(f, [x0, 0.16, x0 - s * 0.05, 0.22, x0 - s * 0.1, 0.3], 0.01, 0.13, sombra);
        }
      } else if (f.face === "nz") {
        g.fillStyle = c.pele;
        g.beginPath();
        if (ombroDeFora) {
          const y = o.decote === "alca" ? Y_ALCA - 0.01 : Y_CIGANINHA;
          g.rect(-0.2, -0.2, w + 0.4, y + 0.2);
        } else if (o.decote === "canoa") g.ellipse(cx, -0.01, 0.17, 0.04, 0, 0, Math.PI * 2);
        else g.ellipse(cx, -0.01, 0.09, o.decote === "v" ? 0.06 : 0.04, 0, 0, Math.PI * 2);
        g.fill();
        if (semManga && !ombroDeFora) cavas(f, c.pele);
        if (o.decote === "alca") {
          g.fillStyle = cor;
          for (const x of [w * 0.3, w * 0.7]) g.fillRect(x - 0.011, -0.1, 0.022, Y_ALCA + 0.06);
        }
        if (o.decote === "ciganinha") elasticoFranzido(f, Y_CIGANINHA);
        dobra(f, [w * 0.25, h * 0.55, w * 0.5, h * 0.5, w * 0.75, h * 0.56], 0.012, 0.12, sombra);
      } else if (f.face === "py") {
        g.fillStyle = c.pele;
        if (ombroDeFora) {
          g.fillRect(-0.1, -0.1, w + 0.2, h + 0.2);
          if (o.decote === "alca") {
            g.fillStyle = cor;
            for (const x of [w * 0.3, w * 0.7]) g.fillRect(x - 0.011, -0.1, 0.022, h + 0.2);
          }
        } else {
          if (semManga) {
            g.fillRect(-0.1, -0.1, w * 0.3 + 0.1, h + 0.2);
            g.fillRect(w * 0.7, -0.1, w * 0.3 + 0.1, h + 0.2);
          }
          if (o.decote === "canoa") {
            g.beginPath();
            g.ellipse(cx, h * 0.5, 0.17, h * 0.42, 0, 0, Math.PI * 2);
            g.fill();
          }
        }
        return volume(f, { luz: 0.1, sombra: 0, bordas: 0.04, cor: sombra, contorno: 0.12 });
      } else {
        // laterais: as cavas
        g.fillStyle = c.pele;
        if (o.decote === "alca") g.fillRect(-0.1, -0.1, w + 0.2, Y_ALCA + 0.13);
        else if (o.decote === "ciganinha") {
          g.fillRect(-0.1, -0.1, w + 0.2, Y_CIGANINHA + 0.1);
          elasticoFranzido(f, Y_CIGANINHA);
        } else if (semManga) {
          g.beginPath();
          g.ellipse(w / 2, -0.02, w * 0.6, 0.2, 0, 0, Math.PI * 2);
          g.fill();
        }
        emenda(
          f,
          [
            [w / 2, 0.2],
            [w / 2, h + 0.1],
          ],
          0.2,
        );
      }
      if (o.cinto) {
        // faixa na cintura, na cor de destaque
        const y0 = yT(e.quadrilY + 0.055);
        g.fillStyle = "rgba(0,0,0,0.25)";
        g.fillRect(-0.1, y0 - 0.006, w + 0.2, 0.006);
        g.fillStyle = destaque;
        g.fillRect(-0.1, y0, w + 0.2, h - y0 + 0.1);
        g.fillStyle = "rgba(255,255,255,0.15)";
        g.fillRect(-0.1, y0 + 0.006, w + 0.2, Math.max(0.004, pxs(f, 2)));
      }
      if (o.cropped) {
        // a barra sobe e a barriga aparece até o cós
        const yc = yT(e.quadrilY + 0.15);
        g.fillStyle = c.pele;
        g.fillRect(-0.1, yc, w + 0.2, h - yc + 0.1);
        oclusao(f, -0.1, yc, w + 0.2, 0.025, "cima", 0.22);
        g.fillStyle = escurecer(cor, 0.06);
        g.fillRect(-0.1, yc - 0.03, w + 0.2, 0.03);
        costura(
          f,
          [
            [-0.1, yc - 0.012],
            [w + 0.1, yc - 0.012],
          ],
          linha,
          { duplo: 0.005 },
        );
        if (f.face === "pz") {
          // o umbigo
          g.fillStyle = "rgba(0,0,0,0.3)";
          g.beginPath();
          g.ellipse(cx, yT(e.quadrilY + 0.105), 0.007, 0.011, 0, 0, Math.PI * 2);
          g.fill();
        }
      } else if (!o.cinto && !saia && o.babado !== "cintura") {
        costura(
          f,
          [
            [-0.1, h - 0.02],
            [w + 0.1, h - 0.02],
          ],
          linha,
          { duplo: 0.006 },
        );
      }
      return volume(f, {
        luz: 0.1,
        sombra: 0.18,
        bordas: ehLateral(f.face) ? 0.04 : 0.08,
        cor: sombra,
      });
    };

    const pintarManga = (f: CtxFace) => {
      const { g, w, h } = f;
      if (f.face === "ny") return escurecerTudo(f, 0.5, cor);
      if (o.decote === "ciganinha") {
        // o alto do braço fica de fora: a manga começa no elástico
        g.fillStyle = c.pele;
        if (f.face === "py") return g.fillRect(-0.1, -0.1, w + 0.2, h + 0.2);
        const yl = yM(yLinha);
        g.fillRect(-0.1, -0.1, w + 0.2, yl + 0.1);
        elasticoFranzido(f, yl);
      }
      if (f.face === "py") return volume(f, { luz: 0.1, sombra: 0, bordas: 0.04, cor: sombra });
      if (o.formaManga === "bufante") {
        // o franzido do bufante, preso num punho na barra
        for (let x = -f.faixa % 0.03; x < w; x += 0.03)
          dobra(f, [x, h * 0.45, x + 0.006, h * 0.7, x, h - 0.03], 0.004, 0.18, sombra);
        g.fillStyle = escurecer(cor, 0.06);
        g.fillRect(-0.1, h - 0.028, w + 0.2, 0.04);
        oclusao(f, -0.1, h - 0.036, w + 0.2, 0.01, "baixo", 0.25, sombra);
      } else if (o.formaManga === "sino") {
        pregas(f, 0.05, 0.8, h * 0.35);
        if (o.renda) renda(f, destaque, h - 0.012);
      }
      costura(
        f,
        [
          [-0.1, h - 0.018],
          [w + 0.1, h - 0.018],
        ],
        linha,
        { duplo: 0.005 },
      );
      if (f.face === faceInterna(f.lado))
        costura(
          f,
          [
            [w / 2, 0],
            [w / 2, h - 0.04],
          ],
          linha,
        );
      oclusao(f, -0.1, -0.1, w + 0.2, 0.05, "cima", 0.15, sombra);
      volume(f, { luz: 0.1, sombra: 0.14, bordas: 0.08, cor: sombra });
    };

    const pintarSaiaDoVestido = (f: CtxFace) => {
      const { g, w, h } = f;
      if (f.face === "py")
        return volume(f, { luz: 0.04, sombra: 0.14, bordas: 0.1, contorno: 0.15 });
      if (f.face === "ny") return escurecerTudo(f, 0.55, cor);
      const y0 = saia ? yQueAparece(m, e, saia, f.face) : 0;
      pregas(f, 0.075, 1, y0);
      oclusao(f, -0.1, y0, w + 0.2, 0.03, "cima", 0.3, sombra);
      if (o.saia?.babado) barraDeBabado(f, destaque, h - 0.075);
      if (o.saia?.fenda && f.face === "pz") {
        // fenda na lateral da frente: a perna aparece
        const x = w * 0.74;
        const pts: [number, number][] = [
          [x - 0.004, h - 0.3],
          [x + 0.004, h - 0.3],
          [x + 0.035, h + 0.1],
          [x - 0.035, h + 0.1],
        ];
        g.fillStyle = c.pele;
        poligono(g, pts);
        g.fill();
        g.strokeStyle = alfa(sombra, 0.35);
        g.lineWidth = Math.max(0.004, pxs(f, 2));
        g.stroke();
      }
      volume(f, { luz: 0.1, sombra: 0.22, bordas: 0.04, cor: sombra });
    };

    const pintarBabado = (f: CtxFace) => {
      const { g, w, h } = f;
      if (f.face === "py" || f.face === "ny") return escurecerTudo(f, 0.4, cor);
      pregas(f, 0.035, 1.2);
      oclusao(f, -0.1, -0.1, w + 0.2, 0.04, "cima", 0.3, sombra);
      // o viés na beirada, na cor de destaque
      g.fillStyle = destaque;
      g.fillRect(-0.1, h - 0.014, w + 0.2, 0.024);
      volume(f, { luz: 0.12, sombra: 0.2, bordas: 0.04, cor: sombra });
    };

    const pintar: Pintor = (f) => {
      if (f.parte.startsWith("laco")) return pintarLaco(f, destaque);
      base(f, cor);
      pano(f, grao);
      if (o.bolinhas && contrasta(destaque, cor)) bolinhas(f, destaque);
      o.padrao?.(f, c, cor);
      if (f.parte === "tronco") return pintarTronco(f);
      if (f.parte === "saia") return pintarSaiaDoVestido(f);
      if (f.parte === "babado") return pintarBabado(f);
      return pintarManga(f);
    };
    return {
      partes,
      aneis,
      livres: [],
      pele,
      pintar,
      mostraPele: true,
      rugosidade: o.rugosidade,
      corBase: cor,
    };
  };
}

/* ———————————————————— NOVAS (16/10/2026) ————————————————————
 *
 * "Crie pelo menos mais 10, bem criativo, baseado em Roblox": flanela
 * aberta, jaqueta jeans com patches, corta-vento, couro, brigadista,
 * colete de campo, camisa de time, moletom cropped, bomber de cetim,
 * kimono, suéter de renas, vestidos de tule e floral, jardineira, um ombro
 * só, corset, havaiana e polo rugby. Tudo sai das `Medidas` (serve a
 * qualquer corpo, inclusive os que entrarem depois). Bloco 3D pendurado no
 * braço só CENTRADO no braço: o aceno separa o braço pelo centro de cada
 * bloco (`obterSeparado`), e um enfeite fora do eixo ficaria no ombro.
 */

/** A 2ª cor quando ela aparece no tecido; senão grafite (tecido claro) ou branco. */
const segunda = (c: AvatarConfig, cor: string) =>
  contrasta(c.corRoupa2, cor) ? piso(c.corRoupa2) : luminancia(cor) > 0.55 ? "#1f2937" : BRANCO;

/** `d` metros abaixo do topo do tronco → y na face do tronco (raio 0,06). */
const yT = (d: number) => bordaCurva(0.06) + d - 0.06;
/** A mesma altura na face da manga (o alto da manga é o topo do tronco; raio 0,05). */
const yM = (d: number) => bordaCurva(0.05) + d - 0.05;

type Punho = "ribana" | "punho" | "bainha" | "nada";

/** Acabamento comum de manga: boca escura, punho, costura de baixo e volume. */
function acabarManga(f: CtxFace, cor: string, punho: Punho) {
  const { w, h } = f;
  const sombra = sombraDe_(cor);
  const linha = corDaLinha(cor);
  if (f.face === "ny") return escurecerTudo(f, 0.5, cor);
  if (f.face === "py")
    return volume(f, { luz: 0.1, sombra: 0, bordas: 0.06, cor: sombra, base: cor });
  if (punho === "ribana") canelado(f, -0.1, h - 0.055, w + 0.2, 0.155, cor);
  else if (punho === "punho") {
    costura(
      f,
      [
        [-0.1, h - 0.06],
        [w + 0.1, h - 0.06],
      ],
      linha,
    );
    oclusao(f, -0.1, h - 0.085, w + 0.2, 0.025, "baixo", 0.2, sombra);
  } else if (punho === "bainha")
    costura(
      f,
      [
        [-0.1, h - 0.02],
        [w + 0.1, h - 0.02],
      ],
      linha,
      { duplo: 0.006 },
    );
  if (f.face === "nz")
    dobra(f, [w * 0.15, h * 0.5, w * 0.5, h * 0.46, w * 0.85, h * 0.52], 0.01, 0.18, sombra);
  if (f.face === faceInterna(f.lado))
    costura(
      f,
      [
        [w / 2, 0],
        [w / 2, h - 0.06],
      ],
      linha,
    );
  oclusao(f, -0.1, -0.1, w + 0.2, 0.05, "cima", 0.15, sombra);
  volume(f, { luz: 0.1, sombra: 0.14, bordas: 0.08, cor: sombra, base: cor });
}

/** Anel de ribana (barra, punho, gola): nervuras, emenda no topo e volume. */
function anelDeRibana(f: CtxFace, cor: string, listra?: string) {
  const { g, w, h } = f;
  base(f, cor);
  canelado(f, -0.1, -0.1, w + 0.2, h + 0.2, cor);
  if (f.face === "py" || f.face === "ny") return escurecerTudo(f, 0.25, cor);
  if (listra) {
    // duas listras de malha (bomber, college)
    for (const k of [0.3, 0.56]) {
      g.fillStyle = alfa(listra, 0.9);
      g.fillRect(-0.1, h * k, w + 0.2, Math.max(h * 0.12, pxs(f, 2)));
    }
    canelado(f, -0.1, -0.1, w + 0.2, 0, cor);
  }
  emenda(
    f,
    [
      [-0.1, 0.004],
      [w + 0.1, 0.004],
    ],
    0.35,
  );
  volume(f, { luz: 0.06, sombra: 0.22, bordas: 0.08, contorno: 0.15, base: cor });
}

/** Barra de ribana em anel por fora da cintura (a calça perde o cós: `COBRE_O_COS`). */
function anelDaBarra(m: Medidas, e: Esqueleto, alto = BARRA_ALTURA): ParteMolde {
  return {
    nome: "barra",
    tam: [m.troncoW + 0.012, alto, m.troncoD + 0.012],
    raio: 0.066,
    matriz: mat([0, e.quadrilY - 0.005 + alto / 2, 0]),
    semFaces: ["ny"],
  };
}

/** Uma faixa de cor que segue a curva `y(x)` até embaixo (`ate`), com pesponto na borda. */
function blocoAbaixo(
  f: CtxFace,
  y: (x: number) => number,
  ate: (x: number) => number,
  cor: string,
) {
  const { g, w } = f;
  const n = 24;
  g.fillStyle = cor;
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const x = -0.1 + ((w + 0.2) * i) / n;
    if (i) g.lineTo(x, y(x));
    else g.moveTo(x, y(x));
  }
  for (let i = n; i >= 0; i--) {
    const x = -0.1 + ((w + 0.2) * i) / n;
    g.lineTo(x, ate(x));
  }
  g.closePath();
  g.fill();
}

/* ———— esqueleto de casaco ABERTO (painéis) com pintura por encomenda ———— */

type OpAberta = {
  abertura: number;
  esp: number;
  desce?: number;
  manga: Manga;
  /** Mangas prontas (manga dobrada, manga larga); sem isto, `mangasEBracos`. */
  mangas?: { partes: ParteMolde[]; pele: BlocoPele[] };
  casaco: string;
  /** Cor da manga quando ela é da peça de baixo (colete). */
  corManga?: string;
  grao: Grao;
  rugosidade?: number;
  /** Padrão corrido do casaco (xadrez, ondas): painéis, costas e mangas. */
  padrao?: (f: CtxFace) => void;
  punho: Punho;
  /** O tronco que aparece no vão (camiseta, regata, camisa). */
  miolo: (f: CtxFace) => void;
  /** Detalhes da frente de cada painel: `xi` = borda de dentro (o fecho), `s` = para fora. */
  frente?: (f: CtxFace, xi: number, s: 1 | -1) => void;
  costas?: (f: CtxFace) => void;
  mangaDetalhe?: (f: CtxFace) => void;
  partesExtra?: ParteMolde[];
  aneis?: ParteMolde[];
  /** Pinta as partes extras; devolve true quando a face era dela. */
  pintarExtra?: (f: CtxFace) => boolean;
};

function jaquetaAberta(m: Medidas, e: Esqueleto, o: OpAberta): Peca {
  const { partes: mangas, pele } = o.mangas ?? mangasEBracos(m, e, o.manga);
  const pn = paineis(m, e, { abertura: o.abertura, esp: o.esp, desce: o.desce });
  const cc = o.casaco;
  const sombraC = sombraDe_(cc);
  const linhaC = corDaLinha(cc);
  const corManga = o.corManga ?? cc;
  const pintar: Pintor = (f) => {
    if (o.pintarExtra?.(f)) return;
    const { w, h } = f;
    if (f.parte === "tronco") return o.miolo(f);
    if (f.parte.startsWith("manga")) {
      base(f, corManga);
      pano(f, o.corManga ? "ruido" : o.grao);
      if (!o.corManga) o.padrao?.(f);
      if (f.face !== "ny" && f.face !== "py") o.mangaDetalhe?.(f);
      return acabarManga(f, corManga, o.punho);
    }
    base(f, cc);
    pano(f, o.grao);
    o.padrao?.(f);
    if (f.parte.startsWith("painel")) {
      if (f.face === "pz") {
        o.frente?.(f, f.lado > 0 ? 0 : w, f.lado > 0 ? 1 : -1);
        dobra(f, [w * 0.2, h * 0.3, w * 0.5, h * 0.36, w * 0.8, h * 0.32], 0.012, 0.16, sombraC);
        return volume(f, {
          luz: 0.12,
          sombra: 0.2,
          bordas: 0.06,
          cor: sombraC,
          contorno: 0.25,
          base: cc,
        });
      }
      if (f.face === "nz") return escurecerTudo(f, 0.35, cc);
      return volume(f, { luz: 0.1, sombra: 0.2, bordas: 0, cor: sombraC, base: cc });
    }
    // costas (e a de baixo, sentado)
    if (f.face === "pz" || f.face === "ny") return escurecerTudo(f, 0.4, cc);
    if (f.face === "nz") {
      o.costas?.(f);
      dobra(f, [w * 0.25, h * 0.2, w * 0.5, h * 0.17, w * 0.75, h * 0.21], 0.014, 0.16, sombraC);
    } else if (f.face === "py") {
      costura(
        f,
        [
          [0.01, h * 0.5],
          [w - 0.01, h * 0.5],
        ],
        linhaC,
      );
    } else
      emenda(
        f,
        [
          [w / 2, 0],
          [w / 2, h],
        ],
        0.2,
      );
    return volume(f, {
      luz: 0.12,
      sombra: 0.2,
      bordas: 0.08,
      cor: sombraC,
      contorno: 0.25,
      base: cc,
    });
  };
  return {
    partes: [parteTronco(m, e), ...mangas, ...pn, ...(o.partesExtra ?? [])],
    aneis: o.aneis,
    livres: [],
    pele,
    pintar,
    mostraPele: true,
    rugosidade: o.rugosidade,
    corBase: cc,
  };
}

/* ———— esqueleto de peça FECHADA (tronco + mangas) com pintura por encomenda ———— */

type OpFechada = {
  cor: string;
  manga: Manga;
  /** Manga afunilando para o punho (moletom, corta-vento). */
  larga?: boolean;
  mangas?: { partes: ParteMolde[]; pele: BlocoPele[] };
  grao: Grao;
  rugosidade?: number;
  /** Padrão/cor corrida das faces de pano, antes da construção. */
  tecido?: (f: CtxFace) => void;
  frente?: (f: CtxFace) => void;
  costas?: (f: CtxFace) => void;
  lados?: (f: CtxFace) => void;
  ombros?: (f: CtxFace) => void;
  mangaDetalhe?: (f: CtxFace) => void;
  punho: Punho;
  /** Barra do tronco pintada (com anel de barra, "nada"). */
  barra: "ribana" | "bainha" | "nada";
  partesExtra?: ParteMolde[];
  aneis?: ParteMolde[];
  livres?: RetanguloLivre[];
  pintarExtra?: (f: CtxFace) => boolean;
  mostraPele?: boolean;
  mascara?: Pintor;
};

function fechada(m: Medidas, e: Esqueleto, o: OpFechada): Peca {
  const { partes: mangas, pele } = o.mangas ?? mangasEBracos(m, e, o.manga, { larga: o.larga });
  const cor = o.cor;
  const sombra = sombraDe_(cor);
  const linha = corDaLinha(cor);
  const pintar: Pintor = (f) => {
    if (o.pintarExtra?.(f)) return;
    const { w, h } = f;
    if (f.parte === "tronco") {
      base(f, cor);
      pano(f, o.grao);
      o.tecido?.(f);
      if (f.face === "py") {
        o.ombros?.(f);
        return volume(f, { luz: 0.1, sombra: 0, bordas: 0.04, cor: sombra, base: cor });
      }
      if (o.barra === "ribana") canelado(f, -0.1, h - 0.07, w + 0.2, 0.17, cor);
      else if (o.barra === "bainha")
        costura(
          f,
          [
            [-0.1, h - 0.02],
            [w + 0.1, h - 0.02],
          ],
          linha,
          { duplo: 0.006 },
        );
      if (f.face === "pz") {
        o.frente?.(f);
        for (const s of [-1, 1]) {
          const x0 = s < 0 ? 0.015 : w - 0.015;
          dobra(f, [x0, 0.12, x0 - s * 0.06, 0.17, x0 - s * 0.12, 0.25], 0.011, 0.14, sombra);
        }
      } else if (f.face === "nz") {
        o.costas?.(f);
        dobra(f, [w * 0.25, h * 0.55, w * 0.5, h * 0.5, w * 0.75, h * 0.56], 0.012, 0.14, sombra);
      } else {
        o.lados?.(f);
        emenda(
          f,
          [
            [w / 2, 0.02],
            [w / 2, h],
          ],
          0.2,
        );
      }
      return volume(f, {
        luz: 0.1,
        sombra: 0.18,
        bordas: ehLateral(f.face) ? 0.04 : 0.08,
        cor: sombra,
        base: cor,
      });
    }
    if (f.parte.startsWith("manga")) {
      base(f, cor);
      pano(f, o.grao);
      o.tecido?.(f);
      if (f.face !== "ny" && f.face !== "py") o.mangaDetalhe?.(f);
      return acabarManga(f, cor, o.punho);
    }
    // anéis de ribana (barra, punho) e o que sobrar
    anelDeRibana(f, cor);
  };
  return {
    partes: [parteTronco(m, e), ...mangas, ...(o.partesExtra ?? [])],
    aneis: o.aneis,
    livres: o.livres ?? [],
    pele,
    pintar,
    mostraPele: o.mostraPele,
    rugosidade: o.rugosidade,
    mascara: o.mascara,
    emissivoFaixas: o.mascara ? true : undefined,
    corBase: cor,
  };
}

/* ———————————————————— 1. flanela aberta + regata ———————————————————— */

/** Gola de camisa aberta deitada no peito (uma ponta por painel). */
function golaAberta(
  f: CtxFace,
  xi: number,
  s: 1 | -1,
  cor: string,
  linha: string,
  padrao?: () => void,
) {
  const { g } = f;
  const sombra = sombraDe_(cor);
  const pts: [number, number][] = [
    [xi - s * 0.004, -0.02],
    [xi + s * 0.12, -0.02],
    [xi + s * 0.078, 0.075],
    [xi + s * 0.012, 0.115],
  ];
  sombraMacia(f, pts, 0.004 * s, 0.012, 0.36, sombra);
  g.fillStyle = clarear(cor, 0.05);
  poligono(g, pts);
  g.fill();
  g.save();
  poligono(g, pts);
  g.clip();
  padrao?.();
  oclusao(f, xi - 0.15, -0.02, 0.3, 0.025, "cima", 0.22, sombra);
  g.restore();
  g.strokeStyle = alfa(sombra, 0.45);
  g.lineWidth = Math.max(0.0025, pxs(f, f.qualidade === "media" ? 2 : 1.5));
  poligono(g, pts);
  g.stroke();
  costura(
    f,
    [
      [xi + s * 0.104, -0.006],
      [xi + s * 0.068, 0.066],
      [xi + s * 0.018, 0.1],
    ],
    linha,
    { traco: 0.006 },
  );
}

/** Bolso de peito com lapela e botão (camisa, jeans). */
function bolsoDePeito(
  f: CtxFace,
  x: number,
  y: number,
  bw: number,
  cor: string,
  linha: string,
  botaoCor: string,
  padrao?: () => void,
) {
  const { g } = f;
  const bh = bw * 1.15;
  sombraDe(f, () => g.rect(x - bw / 2, y, bw, bh), 0.002, 0.004, 0.2);
  g.fillStyle = cor;
  g.fillRect(x - bw / 2, y, bw, bh);
  g.save();
  g.beginPath();
  g.rect(x - bw / 2, y, bw, bh);
  g.clip();
  padrao?.();
  g.restore();
  costura(
    f,
    [
      [x - bw / 2 + 0.005, y + 0.004],
      [x - bw / 2 + 0.005, y + bh - 0.005],
      [x + bw / 2 - 0.005, y + bh - 0.005],
      [x + bw / 2 - 0.005, y + 0.004],
    ],
    linha,
    { traco: 0.006 },
  );
  // lapela em bico
  const lap: [number, number][] = [
    [x - bw / 2 - 0.003, y - 0.006],
    [x + bw / 2 + 0.003, y - 0.006],
    [x + bw / 2 + 0.003, y + bh * 0.3],
    [x, y + bh * 0.42],
    [x - bw / 2 - 0.003, y + bh * 0.3],
  ];
  sombraMacia(f, lap, 0.002, 0.007, 0.32);
  g.fillStyle = clarear(cor, 0.05);
  poligono(g, lap);
  g.fill();
  g.save();
  poligono(g, lap);
  g.clip();
  padrao?.();
  g.restore();
  g.strokeStyle = "rgba(0,0,0,0.3)";
  g.lineWidth = Math.max(0.0025, pxs(f, 1.5));
  poligono(g, lap);
  g.stroke();
  botao(f, x, y + bh * 0.3, 0.0075, botaoCor);
}

const flanelaAberta: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corRoupa);
  const regata = segunda(c, cor);
  const escura = escurecer(cor, 0.55);
  const clara = clarear(cor, 0.35);
  const fio = misturar(cor, "#ffffff", 0.65);
  const linha = corDaLinha(cor);
  const sombra = sombraDe_(cor);
  const ABRE = 0.44;
  const xadrezF = (f: CtxFace) => xadrezContinuo(f, escura, clara, 0.085, fio);
  // A manga dobrada até o cotovelo: o anel do punho vira a dobra (o avesso da flanela).
  const mg = mangasEBracos(m, e, "cotovelo");
  return jaquetaAberta(m, e, {
    abertura: ABRE,
    esp: 0.014,
    desce: 0.035,
    manga: "cotovelo",
    mangas: mg,
    casaco: cor,
    grao: "sarja",
    padrao: xadrezF,
    punho: "nada",
    aneis: aneisDePunho(m, e, mg.comp, false),
    miolo: (f) => {
      const { w, h } = f;
      base(f, regata);
      pano(f, "ruido");
      if (f.face === "pz") {
        const lado = Math.min(0.17, m.troncoW * ABRE * 0.78);
        desenharEstampaNaFace(f, c.estampa, regata, w / 2, h * 0.45, lado);
        golaCareca(f, regata, c.pele, 0.1, 0.08, 0.014);
      }
      volume(f, { luz: 0.06, sombra: 0.22, bordas: 0.16, cor: sombraDe_(regata) });
    },
    frente: (f, xi, s) => {
      const { g, w, h } = f;
      // carcela na borda de dentro: botões de um lado, casas do outro
      g.fillStyle = alfa(sombra, 0.12);
      g.fillRect(s > 0 ? xi : xi - 0.032, -0.1, 0.032, h + 0.2);
      costura(
        f,
        [
          [xi + s * 0.03, 0.1],
          [xi + s * 0.03, h],
        ],
        linha,
      );
      for (let i = 0; i < 5; i++) {
        const y = 0.15 + i * ((h - 0.22) / 4);
        if (f.lado < 0) botao(f, xi + s * 0.016, y, 0.0085, "#e7e5e4");
        else {
          g.fillStyle = "rgba(0,0,0,0.45)";
          g.fillRect(xi + s * 0.016 - 0.009, y - 0.0025, 0.018, Math.max(0.004, pxs(f, 2)));
        }
      }
      golaAberta(f, xi, s, cor, linha, () => xadrezF(f));
      bolsoDePeito(
        f,
        xi + s * w * 0.55,
        0.17,
        Math.min(0.085, w * 0.5),
        cor,
        linha,
        "#e7e5e4",
        () => xadrezF(f),
      );
      // a fralda: a barra curva da camisa (sombra na ponta)
      oclusao(f, -0.1, h - 0.04, w + 0.2, 0.04, "baixo", 0.25, sombra);
    },
    costas: (f) => {
      const { w } = f;
      // pala com prega-macho no meio
      costura(
        f,
        [
          [-0.1, 0.12],
          [w + 0.1, 0.12],
        ],
        linha,
        { duplo: 0.006 },
      );
      oclusao(f, w / 2 - 0.03, 0.12, 0.06, 0.2, "cima", 0.2, sombra);
      emenda(
        f,
        [
          [w / 2 - 0.02, 0.125],
          [w / 2 - 0.02, 0.3],
        ],
        0.25,
      );
      emenda(
        f,
        [
          [w / 2 + 0.02, 0.125],
          [w / 2 + 0.02, 0.3],
        ],
        0.25,
      );
    },
    pintarExtra: (f) => {
      if (!f.parte.startsWith("punho")) return false;
      // a dobra da manga: o avesso, xadrez desbotado, vincos escuros em cima e embaixo
      const { g, w, h } = f;
      base(f, clarear(cor, 0.14));
      pano(f, "sarja");
      if (f.face === "py" || f.face === "ny") {
        escurecerTudo(f, 0.3, cor);
        return true;
      }
      g.save();
      g.globalAlpha = 0.6;
      xadrezF(f);
      g.restore();
      oclusao(f, -0.1, -0.1, w + 0.2, 0.022, "cima", 0.4, sombra);
      oclusao(f, -0.1, h - 0.016, w + 0.2, 0.026, "baixo", 0.35, sombra);
      volume(f, { luz: 0.12, sombra: 0.15, bordas: 0.08, contorno: 0.2, cor: sombra });
      return true;
    },
  });
};

/* ———————————————————— 2. jaqueta jeans com patches ———————————————————— */

/** Pesponto de jeans: o fio dourado de sempre. */
const FIO_JEANS = "#d99a3a";
const COBRE = "#b87333";

const jaquetaPatches: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const jeans = piso(c.corRoupa);
  const tee = segunda(c, jeans);
  const sombra = sombraDe_(jeans);
  const ABRE = 0.3;
  /** Desbotado do jeans: o meio clareia (lavagem). */
  const lavagem = (f: CtxFace) => {
    const { g, w, h } = f;
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, "rgba(255,255,255,0)");
    gr.addColorStop(0.5, "rgba(255,255,255,0.09)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(-0.1, -0.1, w + 0.2, h + 0.2);
  };
  const pesponto = (f: CtxFace, pts: [number, number][]) =>
    costura(f, pts, FIO_JEANS, { duplo: 0.007, traco: 0.007 });
  return jaquetaAberta(m, e, {
    abertura: ABRE,
    esp: 0.026,
    manga: "longa",
    casaco: jeans,
    grao: "sarja",
    padrao: lavagem,
    punho: "nada",
    miolo: (f) => {
      const { w, h } = f;
      base(f, tee);
      pano(f, "ruido");
      if (f.face === "pz") {
        const lado = Math.min(0.14, m.troncoW * ABRE * 0.82);
        desenharEstampaNaFace(f, c.estampa, tee, w / 2, h * 0.42, lado);
        golaCareca(f, tee, c.pele, 0.075, 0.05, 0.016);
      }
      volume(f, { luz: 0.06, sombra: 0.22, bordas: 0.16, cor: sombraDe_(tee) });
    },
    frente: (f, xi, s) => {
      const { g, w, h } = f;
      // pala do peito, pregas verticais e o cós da jaqueta
      pesponto(f, [
        [-0.1, 0.11],
        [w + 0.1, 0.11],
      ]);
      pesponto(f, [
        [xi + s * w * 0.68, 0.115],
        [xi + s * w * 0.68, h - 0.07],
      ]);
      g.fillStyle = alfa(sombra, 0.12);
      g.fillRect(-0.1, h - 0.065, w + 0.2, 0.065);
      pesponto(f, [
        [-0.1, h - 0.06],
        [w + 0.1, h - 0.06],
      ]);
      bolsoDePeito(f, xi + s * w * 0.42, 0.14, Math.min(0.08, w * 0.45), jeans, FIO_JEANS, COBRE);
      // botões de cobre na carcela (um lado), casas no outro
      for (let i = 0; i < 5; i++) {
        const y = 0.06 + i * ((h - 0.1) / 4);
        if (f.lado < 0) {
          botao(f, xi + s * 0.017, y, 0.0095, COBRE);
          rebite(f, xi + s * 0.017, y, 0.004);
        } else {
          g.fillStyle = "rgba(0,0,0,0.45)";
          g.fillRect(xi + s * 0.017 - 0.009, y - 0.0025, 0.018, Math.max(0.004, pxs(f, 2)));
        }
      }
      pesponto(f, [
        [xi + s * 0.032, 0.1],
        [xi + s * 0.032, h],
      ]);
      golaAberta(f, xi, s, jeans, FIO_JEANS);
      // patches bordados
      if (f.lado > 0) patch(f, "estrela", w * 0.5, h * 0.6, Math.min(0.034, w * 0.22));
      else {
        patch(f, "smile", w * 0.42, h * 0.52, Math.min(0.03, w * 0.2));
        patch(f, "coracao", w * 0.6, h * 0.72, Math.min(0.024, w * 0.16));
      }
    },
    costas: (f) => {
      const { w, h } = f;
      pesponto(f, [
        [-0.1, 0.13],
        [w * 0.5, 0.17],
        [w + 0.1, 0.13],
      ]);
      for (const x of [w * 0.22, w * 0.78])
        pesponto(f, [
          [x, 0.16],
          [x, h - 0.07],
        ]);
      pesponto(f, [
        [-0.1, h - 0.06],
        [w + 0.1, h - 0.06],
      ]);
      // o patch grandão das costas
      patch(f, "pinheiro", w / 2, h * 0.45, Math.min(0.085, w * 0.2, h * 0.2));
    },
    mangaDetalhe: (f) => {
      const { g, w, h } = f;
      // punho abotoado
      g.fillStyle = alfa(sombra, 0.14);
      g.fillRect(-0.1, h - 0.06, w + 0.2, 0.06);
      pesponto(f, [
        [-0.1, h - 0.058],
        [w + 0.1, h - 0.058],
      ]);
      if (f.face === faceExterna(f.lado)) {
        botao(f, w / 2, h - 0.03, 0.0085, COBRE);
        patch(f, f.lado > 0 ? "raio" : "flor", w / 2, 0.13, Math.min(0.034, w * 0.15));
      }
      // desbotado no cotovelo
      oclusao(f, -0.1, h * 0.45, w + 0.2, 0.06, "baixo", 0.1, "#ffffff");
    },
  });
};

/* ———————————————————— 3. corta-vento colorido ———————————————————— */

const cortaVento: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const A = piso(c.corRoupa);
  const B = segunda(c, A);
  const C = contrasta(BRANCO, A, 0.3) && contrasta(BRANCO, B, 0.3) ? BRANCO : "#1f2937";
  const D1 = Math.min(0.2, m.troncoH * 0.34);
  const FAIXA = 0.035;
  const { partes, pele, comp } = mangasEBracos(m, e, "longa", { larga: true });
  /** Colorblock: em cima B, faixa C, embaixo A (a base). `y0` = a linha na face. */
  const blocos = (f: CtxFace, linhaY: (x: number) => number) => {
    blocoAbaixo(f, () => -0.2, linhaY, B);
    blocoAbaixo(f, linhaY, (x) => linhaY(x) + FAIXA, C);
    for (const dy of [0.004, FAIXA - 0.004])
      costura(
        f,
        Array.from({ length: 13 }, (_, i) => {
          const x = -0.1 + ((f.w + 0.2) * i) / 12;
          return [x, linhaY(x) + dy] as [number, number];
        }),
        corDaLinha(C),
        { traco: 0.007 },
      );
  };
  /** O brilho do náilon: uma faixa diagonal de luz. */
  const nailon = (f: CtxFace) => {
    const { g, w, h } = f;
    g.fillStyle = "rgba(255,255,255,0.07)";
    poligono(g, [
      [w * 0.15, -0.1],
      [w * 0.45, -0.1],
      [w * 0.15, h + 0.1],
      [-0.15, h + 0.1],
    ]);
    g.fill();
  };
  return fechada(m, e, {
    cor: A,
    manga: "longa",
    mangas: { partes, pele },
    grao: "tela",
    rugosidade: 0.5,
    punho: "nada",
    barra: "nada",
    aneis: [anelDaBarra(m, e, 0.075), ...aneisDePunho(m, e, comp, true)],
    tecido: nailon,
    frente: (f) => {
      const { g, w } = f;
      const cx = w / 2;
      const y0 = yT(D1);
      blocos(f, (x) => y0 + 0.075 * Math.max(0, 1 - Math.abs(x - cx) / (w / 2)));
      // gola alta pintada + meio-zíper
      g.fillStyle = escurecer(B, 0.12);
      g.fillRect(-0.1, -0.1, w + 0.2, 0.13);
      costura(
        f,
        [
          [-0.1, 0.022],
          [w + 0.1, 0.022],
        ],
        corDaLinha(B),
      );
      oclusao(f, -0.1, 0.03, w + 0.2, 0.02, "cima", 0.3);
      ziper(f, cx, -0.02, y0 + 0.11, escurecer(B, 0.1));
      // logo: triângulo na faixa do peito
      g.fillStyle = C;
      poligono(g, [
        [w * 0.74, y0 - 0.075],
        [w * 0.74 + 0.026, y0 - 0.03],
        [w * 0.74 - 0.026, y0 - 0.03],
      ]);
      g.fill();
      // bolsos de zíper na barriga
      for (const s of [-1, 1]) {
        const x0 = cx + s * w * 0.12;
        const x1 = cx + s * w * 0.38;
        const y = f.h - 0.17;
        g.strokeStyle = "rgba(0,0,0,0.5)";
        g.lineWidth = Math.max(0.006, pxs(f, 2));
        g.beginPath();
        g.moveTo(x0, y);
        g.lineTo(x1, y + 0.03);
        g.stroke();
        g.fillStyle = "#c7ccd3";
        g.fillRect(x0 - 0.004, y - 0.004, 0.012, 0.022);
      }
    },
    costas: (f) => {
      const { g, w } = f;
      const y0 = yT(D1);
      blocos(f, () => y0);
      // a ventilação embaixo da pala
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(w * 0.2, y0 - 0.012, w * 0.6, Math.max(0.005, pxs(f, 2)));
      oclusao(f, w * 0.2, y0 - 0.01, w * 0.6, 0.03, "cima", 0.2);
    },
    lados: (f) => blocos(f, () => yT(D1)),
    ombros: (f) => {
      f.g.fillStyle = B;
      f.g.fillRect(-0.1, -0.1, f.w + 0.2, f.h + 0.2);
    },
    mangaDetalhe: (f) => blocos(f, () => yM(D1)),
  });
};

/* ———————————————————— 4. jaqueta de couro (biker) ———————————————————— */

const jaquetaCouro: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corRoupa);
  const tee = segunda(c, cor);
  const metal = "#d1d5db";
  const escuro = luminancia(cor) < 0.2;
  const linha = corDaLinha(cor);
  const sombra = sombraDe_(cor);
  /** Couro: reflexos largos e macios. */
  const brilho = (f: CtxFace) => {
    const { g, w, h } = f;
    g.fillStyle = alfa("#ffffff", escuro ? 0.1 : 0.06);
    g.beginPath();
    g.ellipse(w * 0.3, h * 0.35, w * 0.12, h * 0.3, 0.3, 0, Math.PI * 2);
    g.fill();
  };
  /** Um zíper de `a` até `b` (gira o pincel do zíper vertical). */
  const ziperEntre = (f: CtxFace, a: [number, number], b: [number, number], fita: string) => {
    const { g } = f;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    g.save();
    g.translate(a[0], a[1]);
    g.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.PI / 2);
    ziper(f, 0, 0, L, fita, metal);
    g.restore();
  };
  const tacha = (f: CtxFace, x: number, y: number) => {
    const { g } = f;
    g.fillStyle = "rgba(0,0,0,0.4)";
    g.beginPath();
    g.arc(x + 0.002, y + 0.003, 0.0075, 0, Math.PI * 2);
    g.fill();
    const gr = g.createRadialGradient(x - 0.002, y - 0.002, 0.001, x, y, 0.007);
    gr.addColorStop(0, "#ffffff");
    gr.addColorStop(1, "#9ca3af");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, 0.007, 0, Math.PI * 2);
    g.fill();
  };
  const cinto: ParteMolde = {
    nome: "cinto",
    tam: [m.troncoW + 0.022, 0.05, m.troncoD + 0.022],
    raio: 0.035,
    matriz: mat([0, e.quadrilY + 0.045, 0]),
    ocultas: ["py", "ny"],
  };
  return fechada(m, e, {
    cor,
    manga: "longa",
    grao: "couro",
    rugosidade: 0.4,
    punho: "nada",
    barra: "nada",
    mostraPele: true,
    aneis: [cinto],
    tecido: brilho,
    frente: (f) => {
      const { g, w, h } = f;
      const cx = w / 2;
      // a camiseta no V do decote, com o pescoço
      g.fillStyle = tee;
      poligono(g, [
        [cx - 0.09, -0.02],
        [cx + 0.11, -0.02],
        [cx + 0.03, 0.14],
      ]);
      g.fill();
      g.fillStyle = c.pele;
      g.beginPath();
      g.ellipse(cx + 0.01, -0.012, 0.075, 0.045, 0, 0, Math.PI * 2);
      g.fill();
      oclusao(f, cx - 0.1, 0.02, 0.22, 0.03, "cima", 0.25);
      // zíper diagonal (o fecho do motoqueiro)
      const z0: [number, number] = [cx + 0.07, 0.11];
      const z1: [number, number] = [cx - w * 0.2, h + 0.01];
      g.strokeStyle = "rgba(0,0,0,0.5)";
      g.lineWidth = 0.008;
      g.beginPath();
      g.moveTo(...z0);
      g.lineTo(...z1);
      g.stroke();
      ziperEntre(f, z0, z1, cor);
      // lapelas largas com tachas nas pontas
      const lapelas: [number, number][][] = [
        [
          [cx + 0.11, -0.03],
          [cx + 0.23, -0.03],
          [cx + 0.21, 0.07],
          [cx + 0.25, 0.1],
          [cx + 0.11, 0.2],
          [cx + 0.07, 0.11],
        ],
        [
          [cx - 0.09, -0.03],
          [cx - 0.21, -0.03],
          [cx - 0.19, 0.07],
          [cx - 0.23, 0.1],
          [cx - 0.05, 0.27],
          [cx - 0.01, 0.12],
        ],
      ];
      for (const pts of lapelas) {
        sombraMacia(f, pts, 0.004, 0.012, 0.45);
        g.fillStyle = clarear(cor, escuro ? 0.08 : 0.05);
        poligono(g, pts);
        g.fill();
        g.strokeStyle = alfa(sombra, 0.5);
        g.lineWidth = Math.max(0.003, pxs(f, 1.5));
        poligono(g, pts);
        g.stroke();
        costura(f, pts.slice(1, 5), linha, { traco: 0.006 });
        tacha(f, pts[3]![0] + (pts[3]![0] > cx ? -0.02 : 0.02), pts[3]![1]);
      }
      // bolso de zíper inclinado no peito e o de baixo
      ziperEntre(f, [w * 0.7, 0.3], [w * 0.86, 0.4], escurecer(cor, 0.1));
      ziperEntre(f, [w * 0.1, h - 0.15], [w * 0.32, h - 0.15], escurecer(cor, 0.1));
    },
    costas: (f) => {
      const { w } = f;
      costura(f, curvaPts(-0.1, 0.14, w / 2, 0.2, w + 0.1, 0.14), linha, { duplo: 0.006 });
      for (const x of [w * 0.25, w * 0.75])
        costura(
          f,
          [
            [x, 0.18],
            [x, f.h],
          ],
          linha,
        );
    },
    ombros: (f) => {
      // dragonas com botão de pressão
      const { g, w, h } = f;
      for (const x of [0.02, w - 0.11]) {
        g.fillStyle = "rgba(0,0,0,0.3)";
        g.fillRect(x + 0.002, h * 0.36 + 0.003, 0.09, h * 0.28);
        g.fillStyle = clarear(cor, 0.06);
        g.fillRect(x, h * 0.36, 0.09, h * 0.28);
        tacha(f, x + (x < w / 2 ? 0.07 : 0.02), h * 0.5);
      }
    },
    mangaDetalhe: (f) => {
      const { g, w, h } = f;
      // acolchoado no cotovelo
      g.save();
      g.strokeStyle = alfa(sombra, 0.35);
      g.lineWidth = Math.max(0.003, pxs(f, 1.5));
      for (let y = h * 0.4; y < h * 0.62; y += 0.025) {
        g.beginPath();
        g.moveTo(-0.1, y);
        g.lineTo(w + 0.1, y);
        g.stroke();
      }
      g.restore();
      if (f.face === faceExterna(f.lado)) ziper(f, w / 2, h - 0.13, h, cor, metal);
      brilho(f);
    },
    pintarExtra: (f) => {
      if (f.parte !== "cinto") return false;
      const { g, w, h } = f;
      const corC = escurecer(cor, 0.12);
      base(f, corC);
      pano(f, "couro");
      costura(
        f,
        [
          [-0.1, 0.008],
          [w + 0.1, 0.008],
        ],
        linha,
        { traco: 0.005 },
      );
      costura(
        f,
        [
          [-0.1, h - 0.008],
          [w + 0.1, h - 0.008],
        ],
        linha,
        { traco: 0.005 },
      );
      if (f.face === "pz") {
        const cx = w / 2;
        g.strokeStyle = "rgba(0,0,0,0.4)";
        g.lineWidth = 0.009;
        g.strokeRect(cx - 0.03 + 0.002, 0.004 + 0.003, 0.06, h - 0.008);
        g.strokeStyle = metal;
        g.lineWidth = 0.007;
        g.strokeRect(cx - 0.03, 0.004, 0.06, h - 0.008);
        g.fillStyle = metal;
        g.fillRect(cx - 0.003, h * 0.2, 0.006, h * 0.6);
      }
      volume(f, { luz: 0.18, sombra: 0.25, bordas: 0.06, contorno: 0.2 });
      return true;
    },
  });
};

/* ———————————————————— 5. brigadista florestal ———————————————————— */

const brigadista: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corRoupa);
  const pala = segunda(c, cor);
  const linha = corDaLinha(cor);
  const sombra = sombraDe_(cor);
  const FX = 0.045;
  const dFaixa = m.troncoH * 0.66;
  const mg = mangasEBracos(m, e, "longa");
  // Faixas das mangas: anéis CENTRADOS no braço (o aceno leva junto).
  const faixasManga: ParteMolde[] = [];
  for (const l of LADOS)
    for (const [i, y] of [0.06 - mg.comp * 0.5, 0.06 - mg.comp * 0.8].entries())
      faixasManga.push({
        nome: `faixaM${i}${nomeLado("", l)}`,
        tam: [m.bracoW + 0.016, FX, m.bracoW + 0.031],
        raio: 0.05,
        lado: l,
        livre: "refletivo",
        semFaces: ["py", "ny"],
        matriz: em(e.braco(l), mat([0, y, 0])),
      });
  // A faixa do tronco em relevo, frente e costas (as laterais ficam pintadas).
  const yF = e.topo - dFaixa;
  const zF = m.troncoD / 2 + 0.0015;
  const tiras: ParteMolde[] = [1, -1].map((s) => ({
    nome: s > 0 ? "tiraF" : "tiraT",
    tam: [m.troncoW - 0.1, FX, 0.003] as [number, number, number],
    raio: 0.0012,
    livre: "refletivo",
    matriz: mat([0, yF, s * zF]),
  }));
  const faixaPintada = (f: CtxFace) => refletivo(f, -0.1, yT(dFaixa) - FX / 2, f.w + 0.2, FX);
  const emblema = (f: CtxFace, x: number, y: number, r: number) => {
    const { g } = f;
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.beginPath();
    g.arc(x + r * 0.08, y + r * 0.12, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#14532d";
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#facc15";
    g.lineWidth = r * 0.14;
    g.beginPath();
    g.arc(x, y, r * 0.86, 0, Math.PI * 2);
    g.stroke();
    // chama e pinheiro
    g.fillStyle = "#f97316";
    g.beginPath();
    g.moveTo(x, y - r * 0.6);
    g.quadraticCurveTo(x + r * 0.5, y, x, y + r * 0.45);
    g.quadraticCurveTo(x - r * 0.5, y, x, y - r * 0.6);
    g.fill();
    g.fillStyle = "#4ade80";
    poligono(g, [
      [x, y - r * 0.3],
      [x + r * 0.28, y + r * 0.42],
      [x - r * 0.28, y + r * 0.42],
    ]);
    g.fill();
  };
  return fechada(m, e, {
    cor,
    manga: "longa",
    mangas: mg,
    grao: "tela",
    punho: "punho",
    barra: "bainha",
    partesExtra: [...faixasManga, ...tiras],
    livres: [{ nome: "refletivo", w: 0.3, h: 0.05 }],
    pintarExtra: (f) => {
      if (f.livre !== "refletivo") return false;
      refletivo(f, -0.1, -0.1, f.w + 0.2, f.h + 0.2);
      return true;
    },
    mascara: (f) => {
      if (f.livre === "refletivo") return refletivo(f, -0.1, -0.1, f.w + 0.2, f.h + 0.2);
      if (f.parte === "tronco" && f.face !== "py") faixaPintada(f);
    },
    frente: (f) => {
      const { g, w, h } = f;
      const cx = w / 2;
      // pala de ombro na 2ª cor
      g.fillStyle = pala;
      g.fillRect(-0.1, -0.1, w + 0.2, 0.18);
      costura(
        f,
        [
          [-0.1, 0.075],
          [w + 0.1, 0.075],
        ],
        corDaLinha(pala),
        { duplo: 0.006 },
      );
      // carcela com botões
      g.fillStyle = alfa(sombra, 0.12);
      g.fillRect(cx - 0.02, 0.05, 0.04, h);
      for (let i = 0; i < 6; i++)
        botao(f, cx, 0.1 + i * ((h - 0.16) / 5), 0.0075, escurecer(cor, 0.35));
      // dois bolsos de peito com lapela e a caneta no da direita
      for (const s of [-1, 1])
        bolsoDePeito(
          f,
          cx + s * w * 0.24,
          0.17,
          Math.min(0.1, w * 0.18),
          cor,
          linha,
          escurecer(cor, 0.35),
        );
      g.fillStyle = "#1f2937";
      g.fillRect(cx - w * 0.24 - 0.03, 0.125, 0.01, 0.06);
      g.fillStyle = "#cbd5e1";
      g.fillRect(cx - w * 0.24 - 0.031, 0.12, 0.012, 0.012);
      // a gola na cor do uniforme, por cima da pala
      pontasDeGola(f, cor, linha, sombra, 0.075);
      faixaPintada(f);
    },
    costas: (f) => {
      const { g, w } = f;
      g.fillStyle = pala;
      g.fillRect(-0.1, -0.1, w + 0.2, 0.2);
      costura(
        f,
        [
          [-0.1, 0.095],
          [w + 0.1, 0.095],
        ],
        corDaLinha(pala),
        { duplo: 0.006 },
      );
      const texto = luminancia(cor) > 0.5 ? "#1f2937" : BRANCO;
      numeroDeCamisa(
        f,
        "BRIGADA",
        w / 2,
        yT(dFaixa) - 0.11,
        Math.min(0.075, w * 0.12),
        texto,
        alfa("#000000", 0.35),
      );
      emblema(f, w / 2, 0.05 + Math.min(0.045, w * 0.08), Math.min(0.045, w * 0.08));
      faixaPintada(f);
    },
    lados: faixaPintada,
    ombros: (f) => {
      f.g.fillStyle = pala;
      f.g.fillRect(-0.1, -0.1, f.w + 0.2, f.h + 0.2);
    },
    mangaDetalhe: (f) => {
      const { g, w } = f;
      g.fillStyle = pala;
      g.fillRect(-0.1, -0.1, w + 0.2, 0.05);
      if (f.face === faceExterna(f.lado) && f.lado > 0)
        emblema(f, w / 2, 0.12, Math.min(0.04, w * 0.16));
    },
  });
};

/* ———————————————————— 6. colete de campo (agro) ———————————————————— */

const coleteCampo: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const colete = piso(c.corRoupa);
  const camisa = segunda(c, colete);
  const vies = escurecer(colete, 0.3);
  const linha = corDaLinha(colete);
  const sombra = sombraDe_(colete);
  const ESP = 0.03;
  const ABRE = 0.16;
  // Os bolsos 3D ficam nos painéis: a mesma conta de `paineis` (sentado eles encolhem junto).
  const pn = paineis(m, e, { abertura: ABRE, esp: ESP });
  const zF = m.troncoD / 2 + 0.002 + ESP;
  const bolsos: ParteMolde[] = [];
  for (const l of LADOS) {
    const P = pn.find((p) => p.nome === nomeLado("painel", l))!;
    const px = P.matriz.elements[12]!;
    const yc = P.matriz.elements[13]!;
    const [pw, H] = P.tam;
    const hA = Math.min(0.09, H * 0.2);
    const hB = Math.min(0.12, H * 0.28);
    bolsos.push(
      {
        nome: nomeLado("bolsoA", l),
        tam: [pw * 0.62, hA, 0.016],
        raio: 0.006,
        matriz: mat([px + l * pw * 0.05, yc + H * 0.2, zF + 0.008]),
      },
      {
        nome: nomeLado("bolsoB", l),
        tam: [pw * 0.76, hB, 0.02],
        raio: 0.006,
        matriz: mat([px, yc - H * 0.27, zF + 0.01]),
      },
    );
  }
  return jaquetaAberta(m, e, {
    abertura: ABRE,
    esp: ESP,
    manga: "longa",
    casaco: colete,
    corManga: camisa,
    grao: "tela",
    rugosidade: 0.85,
    punho: "punho",
    partesExtra: bolsos,
    miolo: (f) => {
      const { w } = f;
      base(f, camisa);
      pano(f, "brim");
      if (f.face === "pz") {
        pontasDeGola(f, camisa, corDaLinha(camisa), sombraDe_(camisa), 0.07);
        for (let i = 0; i < 5; i++) botao(f, w / 2, 0.11 + i * 0.09, 0.007, escurecer(camisa, 0.3));
      }
      volume(f, { luz: 0.06, sombra: 0.22, bordas: 0.16, cor: sombraDe_(camisa) });
    },
    frente: (f, xi, s) => {
      const { g, w, h } = f;
      ziper(f, xi + s * 0.01, -0.05, h + 0.05, escurecer(colete, 0.15));
      // argola de metal no ombro (para o rádio)
      g.strokeStyle = "rgba(0,0,0,0.35)";
      g.lineWidth = 0.007;
      g.beginPath();
      g.arc(xi + s * w * 0.6 + 0.002, 0.06 + 0.003, 0.012, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = "#c7ccd3";
      g.lineWidth = 0.005;
      g.beginPath();
      g.arc(xi + s * w * 0.6, 0.06, 0.012, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = vies;
      g.lineWidth = Math.max(0.012, pxs(f, 3));
      g.strokeRect(0, 0, w, h);
    },
    costas: (f) => {
      const { g, w, h } = f;
      // bolso traseiro grande ("de caça") com zíper
      const y0 = h * 0.5;
      g.fillStyle = alfa(sombra, 0.14);
      g.fillRect(w * 0.12, y0, w * 0.76, h * 0.42);
      costura(
        f,
        [
          [w * 0.12, y0],
          [w * 0.12, y0 + h * 0.42],
          [w * 0.88, y0 + h * 0.42],
          [w * 0.88, y0],
        ],
        linha,
      );
      ziper(f, w * 0.12 + 0.02, y0 + 0.02, y0 + 0.03, colete);
      g.fillStyle = "rgba(0,0,0,0.45)";
      g.fillRect(w * 0.14, y0 + 0.01, w * 0.72, Math.max(0.005, pxs(f, 2)));
      refletivo(f, -0.1, 0.11, w + 0.2, 0.014);
      g.strokeStyle = vies;
      g.lineWidth = Math.max(0.012, pxs(f, 3));
      g.beginPath();
      g.moveTo(-0.1, h);
      g.lineTo(w + 0.1, h);
      g.stroke();
    },
    pintarExtra: (f) => {
      if (!f.parte.startsWith("bolso")) return false;
      const { g, w, h } = f;
      base(f, colete);
      pano(f, "tela");
      if (f.face !== "pz") {
        escurecerTudo(f, f.face === "py" ? 0.05 : 0.25, colete);
        if (ehLateral(f.face)) dobra(f, [w / 2, 0, w / 2 + 0.002, h / 2, w / 2, h], 0.004, 0.3);
        volume(f, { luz: 0.1, sombra: 0.2, bordas: 0, cor: sombra });
        return true;
      }
      // lapela com velcro e o fole
      const lap = h * 0.36;
      g.fillStyle = clarear(colete, 0.06);
      g.fillRect(-0.1, -0.1, w + 0.2, lap + 0.1);
      oclusao(f, -0.1, lap, w + 0.2, 0.014, "cima", 0.35, sombra);
      costura(
        f,
        [
          [0.006, lap - 0.007],
          [w - 0.006, lap - 0.007],
        ],
        linha,
        { traco: 0.005 },
      );
      costura(
        f,
        [
          [0.006, 0.006],
          [0.006, h - 0.006],
          [w - 0.006, h - 0.006],
          [w - 0.006, 0.006],
        ],
        linha,
        { traco: 0.005 },
      );
      // passadores de caneta no bolso de cima do lado esquerdo
      if (f.parte === "bolsoAE") {
        for (const x of [w * 0.62, w * 0.78]) {
          g.fillStyle = "#1d4ed8";
          g.fillRect(x - 0.005, -0.02, 0.01, lap + 0.02);
          g.fillStyle = escurecer(colete, 0.1);
          g.fillRect(x - 0.008, lap * 0.4, 0.016, 0.016);
        }
      }
      volume(f, { luz: 0.12, sombra: 0.2, bordas: 0.06, contorno: 0.3, cor: sombra });
      return true;
    },
  });
};

/* ———————————————————— 7. camisa de time ———————————————————— */

const camisaTime: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corRoupa);
  const B = segunda(c, cor);
  const contorno = luminancia(B) > 0.45 ? escurecer(cor, 0.5) : clarear(cor, 0.55);
  /** Tecido de jogo: furinhos de dry-fit e risca diagonal sublimada. */
  const dryfit = (f: CtxFace) => {
    const { g, w, h } = f;
    g.save();
    g.strokeStyle = alfa(B, 0.13);
    g.lineWidth = Math.max(0.008, pxs(f, 2));
    for (let k = -h; k < w + h; k += 0.045) {
      g.beginPath();
      g.moveTo(k, -0.1);
      g.lineTo(k + h * 0.6, h + 0.1);
      g.stroke();
    }
    if (f.qualidade === "alta") {
      g.fillStyle = "rgba(0,0,0,0.06)";
      for (let y = 0; y < h; y += 0.012)
        for (let x = (y / 0.012) % 2 ? 0.006 : 0; x < w; x += 0.012) g.fillRect(x, y, 0.003, 0.003);
    }
    g.restore();
  };
  const laterais = (f: CtxFace) => {
    const { g, w, h } = f;
    g.fillStyle = B;
    g.fillRect(-0.1, 0.12, 0.13, h);
    g.fillRect(w - 0.03, 0.12, 0.13, h);
  };
  return fechada(m, e, {
    cor,
    manga: "curta",
    grao: "ruido",
    punho: "nada",
    barra: "bainha",
    mostraPele: true,
    tecido: dryfit,
    frente: (f) => {
      const { g, w, h } = f;
      const cx = w / 2;
      laterais(f);
      // gola V com a ribana na 2ª cor
      g.fillStyle = c.pele;
      poligono(g, [
        [cx - 0.075, -0.02],
        [cx + 0.075, -0.02],
        [cx, 0.105],
      ]);
      g.fill();
      oclusao(f, cx - 0.06, -0.02, 0.12, 0.05, "cima", 0.25);
      g.strokeStyle = B;
      g.lineWidth = 0.02;
      g.lineJoin = "miter";
      g.beginPath();
      g.moveTo(cx - 0.085, -0.03);
      g.lineTo(cx, 0.112);
      g.lineTo(cx + 0.085, -0.03);
      g.stroke();
      g.lineJoin = "round";
      // escudo no peito esquerdo
      const ex = w * 0.72;
      const ey = 0.17;
      const r = Math.min(0.03, w * 0.06);
      const escudo: [number, number][] = [
        [ex - r, ey - r],
        [ex + r, ey - r],
        [ex + r, ey + r * 0.2],
        [ex, ey + r * 1.25],
        [ex - r, ey + r * 0.2],
      ];
      sombraMacia(f, escudo, 0.002, 0.005, 0.3);
      g.fillStyle = B;
      poligono(g, escudo);
      g.fill();
      g.strokeStyle = contorno;
      g.lineWidth = Math.max(0.003, pxs(f, 1.5));
      g.stroke();
      g.fillStyle = cor;
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rr = k % 2 ? r * 0.25 : r * 0.6;
        g.lineTo(ex + Math.cos(a) * rr, ey + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      // estrelinha de título em cima do escudo
      g.fillStyle = "#facc15";
      g.beginPath();
      g.arc(ex, ey - r * 1.5, r * 0.22, 0, Math.PI * 2);
      g.fill();
      desenharEstampaNaFace(f, c.estampa, cor, cx, h * 0.47, Math.min(0.17, w * 0.3));
    },
    costas: (f) => {
      const { w, h } = f;
      laterais(f);
      numeroDeCamisa(f, "CRAQUE", w / 2, 0.11, Math.min(0.045, w * 0.08), B, contorno);
      numeroDeCamisa(f, "10", w / 2, h * 0.45, Math.min(0.2, h * 0.34, w * 0.4), B, contorno);
    },
    lados: (f) => {
      f.g.fillStyle = B;
      f.g.fillRect(-0.1, 0.1, f.w + 0.2, f.h);
      dryfit(f);
    },
    mangaDetalhe: (f) => {
      const { g, w, h } = f;
      g.fillStyle = B;
      g.fillRect(-0.1, h - 0.04, w + 0.2, 0.05);
      g.fillStyle = contorno;
      g.fillRect(-0.1, h - 0.046, w + 0.2, Math.max(0.005, pxs(f, 2)));
    },
  });
};

/* ———————————————————— 8. moletom cropped ———————————————————— */

/**
 * O moletom de capuz inteiro (capuz 3D, cordão, bolso canguru), mas a barra
 * sobe e a barriga aparece até o cós. A pintura do moletom roda numa face
 * "encurtada" (h até o corte): o bolso e a ribana se ajustam sozinhos.
 */
const moletomCropped: CriarPeca = (m, c, q, pose) => {
  const p = moletom(m, c, q, pose);
  const sobe = Math.min(0.17, m.troncoH * 0.3);
  const ergue = mat([0, sobe, 0]);
  const aneis = (p.aneis ?? []).map((a) =>
    a.nome === "barra" ? { ...a, matriz: ergue.clone().multiply(a.matriz) } : a,
  );
  const pintar: Pintor = (f) => {
    if (f.parte !== "tronco" || f.face === "py" || f.face === "ny") return p.pintar(f);
    const hCorte = f.h - sobe;
    p.pintar({ ...f, h: hCorte });
    const { g, w, h } = f;
    g.fillStyle = c.pele;
    g.fillRect(-0.1, hCorte - 0.002, w + 0.2, h - hCorte + 0.1);
    oclusao(f, -0.1, hCorte, w + 0.2, 0.03, "cima", 0.28);
    if (f.face === "pz") {
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.beginPath();
      g.ellipse(w / 2, h - 0.1, 0.007, 0.011, 0, 0, Math.PI * 2);
      g.fill();
    }
    volume(f, { luz: 0, sombra: 0.12, bordas: 0.06, contorno: 0.12 });
  };
  return { ...p, aneis, pintar, mostraPele: true };
};

/* ———————————————————— 9. bomber de cetim (sukajan) ———————————————————— */

const bomberCetim: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corRoupa);
  const B = segunda(c, cor);
  const ouro = "#d4af37";
  const { partes, pele, comp } = mangasEBracos(m, e, "longa", { larga: true });
  const lua = misturar(cor, "#fef3c7", 0.55);
  /** O brilho do cetim: faixas verticais de luz que acompanham as dobras. */
  const cetim = (f: CtxFace) => {
    const { g, w, h } = f;
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, "rgba(255,255,255,0)");
    gr.addColorStop(0.28, "rgba(255,255,255,0.18)");
    gr.addColorStop(0.42, "rgba(255,255,255,0.02)");
    gr.addColorStop(0.72, "rgba(255,255,255,0.12)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(-0.1, -0.1, w + 0.2, h + 0.2);
  };
  const golaRibana = (f: CtxFace) => {
    const { g, w } = f;
    canelado(f, -0.1, -0.1, w + 0.2, 0.14, cor);
    g.fillStyle = alfa(B, 0.9);
    g.fillRect(-0.1, 0.012, w + 0.2, 0.008);
    oclusao(f, -0.1, 0.04, w + 0.2, 0.02, "cima", 0.3);
  };
  return fechada(m, e, {
    cor,
    manga: "longa",
    mangas: { partes, pele },
    grao: "ruido",
    rugosidade: 0.32,
    punho: "nada",
    barra: "nada",
    aneis: [anelDaBarra(m, e, 0.075), ...aneisDePunho(m, e, comp, true)],
    tecido: cetim,
    frente: (f) => {
      const { g, w, h } = f;
      const cx = w / 2;
      golaRibana(f);
      galhoSakura(f, w * 0.77, 0.2, Math.min(0.5, w * 0.9));
      galhoSakura(f, w * 0.23, 0.24, Math.min(0.42, w * 0.75), true);
      // bolsos-faca com debrum na 2ª cor
      for (const s of [-1, 1]) {
        const x = cx + s * w * 0.3;
        g.strokeStyle = B;
        g.lineWidth = 0.012;
        g.beginPath();
        g.moveTo(x - s * 0.02, h - 0.2);
        g.lineTo(x + s * 0.02, h - 0.09);
        g.stroke();
        g.strokeStyle = "rgba(0,0,0,0.5)";
        g.lineWidth = Math.max(0.004, pxs(f, 2));
        g.stroke();
      }
      ziper(f, cx, 0.02, h + 0.02, cor, ouro);
    },
    costas: (f) => {
      const { g, w, h } = f;
      golaRibana(f);
      const r = Math.min(0.13, w * 0.24, h * 0.26);
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.beginPath();
      g.arc(w / 2 + 0.004, h * 0.44 + 0.006, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = lua;
      g.beginPath();
      g.arc(w / 2, h * 0.44, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = ouro;
      g.lineWidth = Math.max(0.006, pxs(f, 2));
      g.stroke();
      galhoSakura(f, w / 2, h * 0.46, Math.min(1.1, w * 2));
    },
    lados: golaRibana,
    mangaDetalhe: (f) => {
      const { g, w } = f;
      if (f.face !== faceExterna(f.lado) || f.lado < 0) return;
      // bolsinho de zíper na manga (o clássico da bomber)
      g.fillStyle = alfa(sombraDe_(cor), 0.14);
      g.fillRect(w * 0.2, 0.08, w * 0.6, 0.1);
      costura(
        f,
        [
          [w * 0.2, 0.08],
          [w * 0.2, 0.18],
          [w * 0.8, 0.18],
          [w * 0.8, 0.08],
        ],
        corDaLinha(cor),
        { traco: 0.005 },
      );
      g.fillStyle = "rgba(0,0,0,0.45)";
      g.fillRect(w * 0.24, 0.095, w * 0.52, Math.max(0.005, pxs(f, 2)));
      g.fillStyle = ouro;
      g.fillRect(w * 0.24, 0.09, 0.008, 0.02);
    },
    pintarExtra: (f) => {
      if (f.parte !== "barra" && !f.parte.startsWith("punho")) return false;
      anelDeRibana(f, cor, B);
      return true;
    },
  });
};

/* ———————————————————— 10. kimono haori ———————————————————— */

const kimono: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corRoupa);
  const faixa = segunda(c, cor);
  const interno =
    contrasta(BRANCO, cor, 0.3) && contrasta(BRANCO, faixa, 0.25) ? BRANCO : "#1f2937";
  const onda = misturar(cor, luminancia(cor) > 0.55 ? "#1f2937" : BRANCO, 0.42);
  const linha = corDaLinha(cor);
  const ABRE = 0.36;
  const ESP = 0.012;
  // Manga larga e reta do haori (40% mais larga); o antebraço continua dentro.
  const mg = mangasEBracos(m, e, "longa");
  const mangas = {
    pele: mg.pele,
    partes: mg.partes.map((p): ParteMolde => ({
      ...p,
      tam: [p.tam[0] * 1.4, p.tam[1], p.tam[2] * 1.3],
      raio: 0.03,
    })),
  };
  // O himo: o cordão que amarra a frente, atravessando o vão no peito.
  const a = (m.troncoW * ABRE) / 2;
  const yH = e.topo - m.troncoH * 0.4;
  const zH = m.troncoD / 2 + 0.002 + ESP + 0.004;
  const himo: ParteMolde[] = [
    { nome: "himo", tam: [2 * a + 0.04, 0.011, 0.01], raio: 0.004, matriz: mat([0, yH, zH]) },
    {
      nome: "himoN",
      tam: [0.03, 0.03, 0.02],
      raio: 0.009,
      matriz: mat([0, yH - 0.003, zH + 0.005]),
    },
    {
      nome: "himoP",
      tam: [0.014, 0.055, 0.012],
      raio: 0.005,
      matriz: mat([0.006, yH - 0.04, zH + 0.004], [0, 0, 0.12]),
    },
  ];
  const ondas = (f: CtxFace) => seigaiha(f, onda, cor);
  return jaquetaAberta(m, e, {
    abertura: ABRE,
    esp: ESP,
    desce: 0.2,
    manga: "longa",
    mangas,
    casaco: cor,
    grao: "ruido",
    padrao: ondas,
    punho: "nada",
    partesExtra: himo,
    miolo: (f) => {
      base(f, interno);
      pano(f, "ruido");
      if (f.face === "pz") golaCareca(f, interno, c.pele, 0.08, 0.055, 0.016);
      volume(f, { luz: 0.06, sombra: 0.22, bordas: 0.16, cor: sombraDe_(interno) });
    },
    frente: (f, xi, s) => {
      const { g, h } = f;
      // a gola-faixa (eri) correndo pela borda de dentro, com o laço do himo
      const lf = 0.05;
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(s > 0 ? xi + lf : xi - lf - 0.006, -0.1, 0.006, h + 0.2);
      g.fillStyle = faixa;
      g.fillRect(s > 0 ? xi : xi - lf, -0.1, lf, h + 0.2);
      costura(
        f,
        [
          [xi + s * (lf - 0.008), -0.1],
          [xi + s * (lf - 0.008), h],
        ],
        corDaLinha(faixa),
      );
      oclusao(f, s > 0 ? xi : xi - lf, -0.1, lf, h + 0.2, s > 0 ? "esq" : "dir", 0.2);
      // a barra do haori
      g.fillStyle = alfa(escurecer(cor, 0.3), 0.6);
      g.fillRect(-0.1, h - 0.012, f.w + 0.2, 0.02);
    },
    costas: (f) => {
      const { g, w } = f;
      // o brasão da família (mon) no alto das costas
      const r = Math.min(0.045, w * 0.09);
      g.fillStyle = faixa;
      g.beginPath();
      g.arc(w / 2, 0.06 + r, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = cor;
      g.lineWidth = r * 0.12;
      g.beginPath();
      g.arc(w / 2, 0.06 + r, r * 0.82, 0, Math.PI * 2);
      g.stroke();
      flor(g, w / 2, 0.06 + r, r * 0.6, cor, faixa);
      emenda(
        f,
        [
          [w / 2, 0.06 + 2 * r + 0.01],
          [w / 2, f.h],
        ],
        0.2,
      );
    },
    mangaDetalhe: (f) => {
      const { g, w, h } = f;
      g.fillStyle = faixa;
      g.fillRect(-0.1, h - 0.03, w + 0.2, 0.04);
      costura(
        f,
        [
          [-0.1, h - 0.032],
          [w + 0.1, h - 0.032],
        ],
        linha,
      );
    },
    pintarExtra: (f) => {
      if (!f.parte.startsWith("himo")) return false;
      const { g, w, h } = f;
      base(f, faixa);
      // cordão torcido: riscas diagonais
      g.strokeStyle = alfa(escurecer(faixa, 0.4), 0.6);
      g.lineWidth = Math.max(0.002, pxs(f, 1.5));
      for (let x = -h; x < w + h; x += 0.006) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + h, h);
        g.stroke();
      }
      volume(f, { luz: 0.2, sombra: 0.3, bordas: 0.1, contorno: 0.3 });
      return true;
    },
  });
};

/* ———————————————————— 11. suéter de renas ———————————————————— */

const sueterRenas: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corRoupa);
  const B = segunda(c, cor);
  const motivo = contrasta(BRANCO, B, 0.3) ? BRANCO : "#7f1d1d";
  const D0 = 0.08;
  const ALTO = Math.min(0.11, m.troncoH * 0.19);
  const D1 = m.troncoH * 0.66;
  const faixas = (f: CtxFace, y: (d: number) => number) => {
    const { g, w } = f;
    const y0 = y(D0);
    faixaDeRenas(f, y0, ALTO, motivo, B);
    g.save();
    g.beginPath();
    g.rect(-0.1, y0, w + 0.2, ALTO);
    g.clip();
    trico(f, B);
    g.restore();
    pontinhos(f, y0 - 0.026, B);
    pontinhos(f, y0 + ALTO + 0.018, B);
    // a fileira de flocos de baixo
    const y1 = y(D1);
    const P = 0.075;
    const x0 = -(f.faixa % P) - P;
    for (let x = x0; x < w + P; x += P) floco(g, x, y1, 0.018, B);
    pontinhos(f, y1 - 0.035, B, 0.03);
    pontinhos(f, y1 + 0.03, B, 0.03);
  };
  return fechada(m, e, {
    cor,
    manga: "longa",
    grao: "ruido",
    punho: "ribana",
    barra: "ribana",
    mostraPele: true,
    tecido: (f) => trico(f, cor),
    frente: (f) => {
      faixas(f, yT);
      golaCareca(f, cor, c.pele);
    },
    costas: (f) => faixas(f, yT),
    lados: (f) => faixas(f, yT),
    mangaDetalhe: (f) => faixas(f, yM),
  });
};

/* ———————————————————— 12–14. vestidos e jardineira ———————————————————— */

/** Tule: base clara, camadas onduladas, pregas, rede fina, brilhos e a barra em ondinhas. */
function pintarTule(f: CtxFace, cor: string, brilho: string, y0: number) {
  const { g, w, h } = f;
  if (f.face === "py") return volume(f, { luz: 0.04, sombra: 0.14, bordas: 0.1, contorno: 0.15 });
  if (f.face === "ny") return escurecerTudo(f, 0.4, cor);
  base(f, cor);
  const sombra = sombraDe_(cor);
  pregas(f, 0.05, 1.1, y0);
  // camadas: cada uma termina numa borda ondulada um pouco mais clara
  const ondas = (yb: number, cl: string, a: number) => {
    g.fillStyle = alfa(cl, a);
    g.beginPath();
    g.moveTo(-0.1, y0);
    g.lineTo(w + 0.1, y0);
    const P = 0.04;
    const x0 = -(f.faixa % P) - P;
    g.lineTo(w + 0.1, yb);
    for (let x = w + P; x >= x0; x -= P) g.quadraticCurveTo(x - P / 2, yb + 0.018, x - P, yb);
    g.closePath();
    g.fill();
  };
  ondas(y0 + (h - y0) * 0.72, clarear(cor, 0.35), 0.35);
  ondas(y0 + (h - y0) * 0.42, clarear(cor, 0.5), 0.3);
  if (f.qualidade === "alta") {
    // a rede do tule
    g.save();
    g.strokeStyle = "rgba(255,255,255,0.07)";
    g.lineWidth = pxs(f, 1);
    for (let k = -h; k < w + h; k += 0.008) {
      g.beginPath();
      g.moveTo(k, y0);
      g.lineTo(k + h, y0 + h);
      g.moveTo(k + h, y0);
      g.lineTo(k, y0 + h);
      g.stroke();
    }
    g.restore();
  }
  // brilhos (estrelinhas de 4 pontas)
  grade(f, 0.06, (x, y, i, j) => {
    if (y < y0 + 0.02 || (i * 7 + j * 3) % 3) return;
    const r = 0.007;
    g.fillStyle = brilho;
    g.beginPath();
    g.moveTo(x, y - r * 1.6);
    g.lineTo(x + r * 0.35, y - r * 0.35);
    g.lineTo(x + r * 1.6, y);
    g.lineTo(x + r * 0.35, y + r * 0.35);
    g.lineTo(x, y + r * 1.6);
    g.lineTo(x - r * 0.35, y + r * 0.35);
    g.lineTo(x - r * 1.6, y);
    g.lineTo(x - r * 0.35, y - r * 0.35);
    g.closePath();
    g.fill();
  });
  // barra em ondinhas
  const P = 0.03;
  const x0 = -(f.faixa % P) - P;
  g.strokeStyle = alfa(escurecer(cor, 0.25), 0.6);
  g.lineWidth = Math.max(0.004, pxs(f, 2));
  g.beginPath();
  for (let x = x0; x < w + P; x += P) {
    g.moveTo(x, h - 0.012);
    g.quadraticCurveTo(x + P / 2, h + 0.004, x + P, h - 0.012);
  }
  g.stroke();
  oclusao(f, -0.1, y0, w + 0.2, 0.03, "cima", 0.3, sombra);
  volume(f, { luz: 0.12, sombra: 0.2, bordas: 0.04, cor: sombra });
}

const vestidoTule: CriarPeca = (m, c, q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corRoupa);
  const brilho = contrasta(c.corRoupa2, cor) ? c.corRoupa2 : "#ffffff";
  const opSaia = (mm: Medidas): OpSaia => ({
    comp: 0.1 + mm.pernaH * 0.5,
    larg: 1.25,
    fundo: 1.3,
    afunilar: 0.42,
  });
  const p = blusa({
    decote: "alca",
    manga: "nenhuma",
    cinto: true,
    renda: true,
    laco: "cintura",
    saia: { op: opSaia },
  })(m, c, q, pose);
  // A 2ª camada de tule: mais curta e mais armada, SEMPRE por fora da 1ª
  // (no topo 1,2 cm mais larga; abaixo dele abre mais rápido).
  const s1 = resolverSaia(m, e, c.sapato, opSaia(m));
  const a2 = Math.min(0.45, s1.afunilar + 0.04);
  const W = m.troncoW;
  const D = m.troncoD;
  const s2 = {
    ...s1,
    comp: s1.comp * 0.7,
    afunilar: a2,
    larg: (W * s1.larg * (1 - s1.afunilar) + 0.024) / (W * (1 - a2)),
    fundo: (D * s1.fundo * (1 - s1.afunilar) + 0.024) / (D * (1 - a2)),
  };
  const tule2 = parteSaia(m, e, s2, "saia2");
  const yTopo = (f: CtxFace) => yQueAparece(m, e, f.parte === "saia2" ? s2 : s1, f.face);
  const corTule = clarear(cor, 0.12);
  const pintar: Pintor = (f) => {
    if (f.parte === "saia") return pintarTule(f, cor, brilho, yTopo(f));
    if (f.parte === "saia2") return pintarTule(f, corTule, brilho, yTopo(f));
    p.pintar(f);
    // paetês no corpete (entre o decote e a faixa da cintura)
    if (f.parte === "tronco" && f.face !== "py") {
      const { g } = f;
      const yC = yNaFace(e.topo, 0.06, e.quadrilY + 0.055);
      grade(f, 0.03, (x, y, i, j) => {
        if (y < Y_ALCA + 0.025 || y > yC - 0.012 || (i + j) % 2) return;
        g.fillStyle = alfa(brilho, 0.75);
        g.beginPath();
        g.arc(x, y, 0.0045, 0, Math.PI * 2);
        g.fill();
      });
    }
  };
  return { ...p, partes: [...p.partes, tule2], pintar };
};

const vestidoFloral = blusa({
  decote: "v",
  manga: "curta",
  formaManga: "bufante",
  cinto: true,
  padrao: (f, c, cor) => {
    const flor1 = contrasta(c.corRoupa2, cor)
      ? c.corRoupa2
      : luminancia(cor) > 0.55
        ? "#db2777"
        : "#fde68a";
    floral(f, flor1, misturar(flor1, "#ffffff", 0.55), misturar(cor, "#166534", 0.65), "#facc15");
  },
  saia: {
    op: (m) => ({ comp: 0.1 + m.pernaH * 0.6, larg: 1.05, fundo: 1.05, afunilar: 0.3 }),
    babado: true,
  },
});

const jardineira: CriarPeca = (m, c, q, pose) => {
  const e = esqueleto(m, pose);
  const jeans = piso(c.corRoupa);
  const tee = segunda(c, jeans);
  const sombraJ = sombraDe_(jeans);
  const opSaia = (mm: Medidas): OpSaia => ({
    comp: 0.1 + mm.pernaH * 0.36,
    larg: 1.04,
    fundo: 1.06,
    afunilar: 0.16,
  });
  const p = blusa({ decote: "redondo", manga: "curta", saia: { op: opSaia } })(m, c, q, pose);
  const s1 = resolverSaia(m, e, c.sapato, opSaia(m));
  const yCos = yNaFace(e.topo, 0.06, e.quadrilY + 0.12);
  const ALCA = 0.04;
  const pesp = (f: CtxFace, pts: [number, number][]) =>
    costura(f, pts, FIO_JEANS, { duplo: 0.006, traco: 0.007 });
  const brim = (f: CtxFace, desenhar: () => void) => {
    const { g } = f;
    g.save();
    g.beginPath();
    g.fillStyle = jeans;
    desenhar();
    g.fill();
    g.clip();
    pano(f, "sarja");
    g.restore();
  };
  const fivela = (f: CtxFace, x: number, y: number) => {
    const { g } = f;
    g.strokeStyle = "rgba(0,0,0,0.4)";
    g.lineWidth = 0.007;
    g.strokeRect(x - 0.018 + 0.002, y - 0.012 + 0.003, 0.036, 0.024);
    g.strokeStyle = "#d1d5db";
    g.lineWidth = 0.006;
    g.strokeRect(x - 0.018, y - 0.012, 0.036, 0.024);
    botao(f, x, y + 0.03, 0.008, COBRE);
  };
  const troncoJ = (f: CtxFace) => {
    const { g, w, h } = f;
    base(f, tee);
    pano(f, "ruido");
    const cx = w / 2;
    if (f.face === "py") {
      for (const x of [w * 0.24, w * 0.76])
        brim(f, () => g.rect(x - ALCA / 2, -0.1, ALCA, h + 0.2));
      return volume(f, { luz: 0.1, sombra: 0, bordas: 0.04, cor: sombraJ });
    }
    if (f.face === "pz") {
      golaCareca(f, tee, c.pele, 0.085, 0.06, 0.016);
      const yB = 0.17;
      const x0 = w * 0.2;
      const x1 = w * 0.8;
      for (const x of [w * 0.24, w * 0.76])
        brim(f, () => g.rect(x - ALCA / 2, -0.1, ALCA, yB + 0.12));
      brim(f, () => {
        g.beginPath();
        g.rect(x0, yB, x1 - x0, h - yB + 0.1);
        g.rect(-0.1, yCos, w + 0.2, h - yCos + 0.1);
      });
      oclusao(f, x0, yB, x1 - x0, 0.02, "cima", 0.25, sombraJ);
      pesp(f, [
        [x0 + 0.008, yCos],
        [x0 + 0.008, yB + 0.008],
        [x1 - 0.008, yB + 0.008],
        [x1 - 0.008, yCos],
      ]);
      pesp(f, [
        [-0.1, yCos + 0.008],
        [w + 0.1, yCos + 0.008],
      ]);
      // bolso do peitilho (com a estampa, se houver)
      const bw = (x1 - x0) * 0.62;
      const by = yB + 0.05;
      const bh = Math.min(0.12, (yCos - by) * 0.9);
      sombraDe(f, () => g.rect(cx - bw / 2, by, bw, bh), 0.002, 0.004, 0.22);
      brim(f, () => {
        g.beginPath();
        g.rect(cx - bw / 2, by, bw, bh);
      });
      desenharEstampaNaFace(f, c.estampa, jeans, cx, by + bh / 2, Math.min(bh * 0.9, bw * 0.85));
      pesp(f, [
        [cx - bw / 2 + 0.006, by + 0.006],
        [cx - bw / 2 + 0.006, by + bh - 0.006],
        [cx + bw / 2 - 0.006, by + bh - 0.006],
        [cx + bw / 2 - 0.006, by + 0.006],
      ]);
      for (const x of [w * 0.24, w * 0.76]) fivela(f, x, yB + 0.005);
      rebite(f, cx - bw / 2 + 0.006, by + 0.006);
      rebite(f, cx + bw / 2 - 0.006, by + 0.006);
    } else if (f.face === "nz") {
      // as alças cruzam em X nas costas
      g.save();
      g.lineCap = "butt";
      for (const [xa, xb] of [
        [w * 0.24, w * 0.66],
        [w * 0.76, w * 0.34],
      ] as const) {
        g.strokeStyle = "rgba(0,0,0,0.25)";
        g.lineWidth = ALCA + 0.006;
        g.beginPath();
        g.moveTo(xa + 0.003, -0.1);
        g.lineTo(xb + 0.003, yCos + 0.004);
        g.stroke();
        g.strokeStyle = jeans;
        g.lineWidth = ALCA;
        g.beginPath();
        g.moveTo(xa, -0.1);
        g.lineTo(xb, yCos);
        g.stroke();
      }
      g.restore();
      brim(f, () => {
        g.beginPath();
        g.rect(-0.1, yCos, w + 0.2, h - yCos + 0.1);
      });
      pesp(f, [
        [-0.1, yCos + 0.008],
        [w + 0.1, yCos + 0.008],
      ]);
    } else {
      brim(f, () => {
        g.beginPath();
        g.rect(-0.1, yCos, w + 0.2, h - yCos + 0.1);
      });
      botao(f, w / 2, yCos + 0.03, 0.009, COBRE);
    }
    volume(f, { luz: 0.1, sombra: 0.18, bordas: ehLateral(f.face) ? 0.04 : 0.08, cor: sombraJ });
  };
  const saiaJ = (f: CtxFace) => {
    const { g, w, h } = f;
    base(f, jeans);
    pano(f, "sarja");
    if (f.face === "py") return volume(f, { luz: 0.04, sombra: 0.14, bordas: 0.1, contorno: 0.15 });
    if (f.face === "ny") return escurecerTudo(f, 0.5, jeans);
    const y0 = yQueAparece(m, e, s1, f.face);
    if (f.face === "pz") {
      pesp(f, [
        [w / 2, y0],
        [w / 2, h],
      ]);
      for (const s of [-1, 1]) {
        const bx = w / 2 + s * w * 0.24;
        const bw = Math.min(0.09, w * 0.22);
        const by = y0 + 0.03;
        pesp(f, [
          [bx - bw / 2, by],
          [bx - bw / 2, by + bw * 0.9],
          [bx, by + bw * 1.05],
          [bx + bw / 2, by + bw * 0.9],
          [bx + bw / 2, by],
        ]);
        rebite(f, bx - bw / 2, by);
        rebite(f, bx + bw / 2, by);
      }
    }
    pesp(f, [
      [-0.1, h - 0.02],
      [w + 0.1, h - 0.02],
    ]);
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(-0.1, h - 0.01, w + 0.2, 0.02);
    oclusao(f, -0.1, y0, w + 0.2, 0.03, "cima", 0.3, sombraJ);
    volume(f, { luz: 0.1, sombra: 0.22, bordas: 0.04, cor: sombraJ });
  };
  const pintar: Pintor = (f) => {
    if (f.parte === "tronco") return troncoJ(f);
    if (f.parte === "saia") return saiaJ(f);
    // mangas da camiseta
    base(f, tee);
    pano(f, "ruido");
    acabarManga(f, tee, "bainha");
  };
  return { ...p, pintar, rugosidade: 0.85, corBase: jeans };
};

/* ———————————————————— 15. blusa de um ombro só ———————————————————— */

const ombroSo: CriarPeca = (m, c, _q, pose) => {
  const e = esqueleto(m, pose);
  const cor = piso(c.corRoupa);
  const destaque = corDeDestaque(c, cor);
  const sombra = sombraDe_(cor);
  const linha = corDaLinha(cor);
  // O ombro coberto é o esquerdo do boneco (x > 0): manga bufante só nele.
  const com = mangasEBracos(m, e, "curta");
  const sem = mangasEBracos(m, e, "nenhuma");
  const manga = com.partes
    .filter((p) => p.lado === 1)
    .map((p): ParteMolde => ({
      ...p,
      tam: [p.tam[0] * 1.06, p.tam[1], p.tam[2] * 1.06],
      afunilar: -0.2,
    }));
  const pele = [sem.pele[0]!, com.pele[1]!];
  // A linha do decote em diagonal, no MUNDO: do ombro esquerdo até debaixo do braço direito.
  const W = m.troncoW;
  const P1: [number, number] = [W / 2 - 0.08, e.topo - 0.012];
  const P2: [number, number] = [-W / 2 + 0.01, e.topo - 0.2];
  const ang = Math.atan2(P1[1] - P2[1], P1[0] - P2[0]);
  const L = Math.hypot(P1[0] - P2[0], P1[1] - P2[1]) + 0.04;
  const ALTO = 0.07;
  // O babado 3D acompanha a linha: o alto dele fica 1 cm acima dela.
  const nx = Math.sin(ang);
  const ny = -Math.cos(ang);
  const meio: [number, number] = [
    (P1[0] + P2[0]) / 2 + nx * (ALTO / 2 - 0.01),
    (P1[1] + P2[1]) / 2 + ny * (ALTO / 2 - 0.01),
  ];
  const babados: ParteMolde[] = [1, -1].map((s) => ({
    nome: s > 0 ? "babadoF" : "babadoT",
    tam: [L, ALTO, 0.022] as [number, number, number],
    raio: 0.01,
    matriz: mat([meio[0], meio[1], s * (m.troncoD / 2 + 0.012)], [0, 0, ang]),
  }));
  /** Linha do decote na face: x da face → y da face (frente; atrás espelha). */
  const xNaFace = (xm: number, w: number, espelho: boolean) => (espelho ? w / 2 - xm : w / 2 + xm);
  const decote = (f: CtxFace, espelho: boolean) => {
    const { g, w } = f;
    const a: [number, number] = [xNaFace(P1[0], w, espelho), yNaFace(e.topo, 0.06, P1[1])];
    const b: [number, number] = [xNaFace(P2[0], w, espelho), yNaFace(e.topo, 0.06, P2[1])];
    // estende a reta até fora da face nos dois lados
    const k = (b[1] - a[1]) / (b[0] - a[0]);
    const yEm = (x: number) => a[1] + k * (x - a[0]);
    g.fillStyle = c.pele;
    g.beginPath();
    g.moveTo(-0.2, -0.2);
    g.lineTo(w + 0.2, -0.2);
    g.lineTo(w + 0.2, yEm(w + 0.2));
    g.lineTo(-0.2, yEm(-0.2));
    g.closePath();
    g.fill();
  };
  const pintar: Pintor = (f) => {
    const { g, w, h } = f;
    if (f.parte.startsWith("babado")) {
      base(f, cor);
      if (f.face === "py" || f.face === "ny" || f.face === "nz") return escurecerTudo(f, 0.35, cor);
      pregas(f, 0.03, 1.2);
      oclusao(f, -0.1, -0.1, w + 0.2, 0.025, "cima", 0.3, sombra);
      g.fillStyle = destaque;
      g.fillRect(-0.1, h - 0.012, w + 0.2, 0.022);
      return volume(f, { luz: 0.12, sombra: 0.2, bordas: 0.04, cor: sombra, contorno: 0.2 });
    }
    base(f, cor);
    pano(f, "ruido");
    if (f.parte !== "tronco") {
      if (f.face !== "py" && f.face !== "ny") {
        for (let x = -f.faixa % 0.03; x < w; x += 0.03)
          dobra(f, [x, h * 0.45, x + 0.006, h * 0.7, x, h - 0.03], 0.004, 0.18, sombra);
        g.fillStyle = destaque;
        g.fillRect(-0.1, h - 0.024, w + 0.2, 0.03);
      }
      return acabarManga(f, cor, "nada");
    }
    if (f.face === "pz" || f.face === "nz") {
      // franzido diagonal acompanhando o decote
      for (let i = 1; i < 6; i++) {
        const y = 0.12 + i * 0.07;
        dobra(f, [w * 0.15, y + 0.05, w * 0.5, y, w * 0.85, y - 0.05], 0.008, 0.12, sombra);
      }
      decote(f, f.face === "nz");
    } else if (f.face === "nx") {
      // o lado do ombro de fora: pele até debaixo do braço
      g.fillStyle = c.pele;
      g.fillRect(-0.1, -0.1, w + 0.2, yNaFace(e.topo, 0.06, P2[1]) + 0.1);
    } else if (f.face === "py") {
      g.fillStyle = c.pele;
      g.fillRect(-0.1, -0.1, w - 0.14 + 0.1, h + 0.2);
      return volume(f, { luz: 0.1, sombra: 0, bordas: 0.04, cor: sombra });
    }
    costura(
      f,
      [
        [-0.1, h - 0.02],
        [w + 0.1, h - 0.02],
      ],
      linha,
      { duplo: 0.006 },
    );
    volume(f, { luz: 0.1, sombra: 0.18, bordas: ehLateral(f.face) ? 0.04 : 0.08, cor: sombra });
  };
  return {
    partes: [parteTronco(m, e), ...manga, ...babados],
    livres: [],
    pele,
    pintar,
    mostraPele: true,
    corBase: cor,
  };
};

/* ———————————————————— 16. corset ———————————————————— */

const corset: CriarPeca = (m, c, q, pose) => {
  const p = blusa({ decote: "alca", manga: "nenhuma", renda: true, rugosidade: 0.5 })(
    m,
    c,
    q,
    pose,
  );
  const cor = piso(c.corRoupa);
  const laco = corDeDestaque(c, cor);
  const sombra = sombraDe_(cor);
  const ilhoses = (f: CtxFace, cx: number, y0: number, y1: number) => {
    const { g } = f;
    const passo = 0.03;
    const pts: number[] = [];
    for (let y = y0; y < y1; y += passo) pts.push(y);
    // o vão do amarrado mostrando o forro
    g.fillStyle = escurecer(laco, 0.35);
    g.fillRect(cx - 0.016, y0 - 0.01, 0.032, y1 - y0 + 0.01);
    // cadarço cruzado
    g.strokeStyle = laco;
    g.lineWidth = Math.max(0.005, pxs(f, 2));
    g.beginPath();
    pts.forEach((y, i) => {
      if (i === pts.length - 1) return;
      g.moveTo(cx - 0.02, y);
      g.lineTo(cx + 0.02, y + passo);
      g.moveTo(cx + 0.02, y);
      g.lineTo(cx - 0.02, y + passo);
    });
    g.stroke();
    for (const y of pts) for (const s of [-1, 1]) ilhos(f, cx + s * 0.02, y, 0.006, "#d1d5db");
    // lacinho no alto
    g.fillStyle = laco;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + s * 0.016, y0 - 0.012, 0.016, 0.009, s * 0.3, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = laco;
    g.lineWidth = 0.004;
    g.beginPath();
    g.moveTo(cx, y0 - 0.01);
    g.lineTo(cx - 0.012, y0 + 0.03);
    g.moveTo(cx, y0 - 0.01);
    g.lineTo(cx + 0.014, y0 + 0.032);
    g.stroke();
  };
  const barbatanas = (f: CtxFace) => {
    const { g, w, h } = f;
    for (const k of [0.16, 0.33, 0.67, 0.84]) {
      const x = w * k;
      emenda(
        f,
        [
          [x, Y_ALCA + 0.02],
          [x, h],
        ],
        0.3,
      );
      // o brilho do cetim de cada gomo
      const gr = g.createLinearGradient(x, 0, x + w * 0.16, 0);
      gr.addColorStop(0, "rgba(255,255,255,0)");
      gr.addColorStop(0.5, "rgba(255,255,255,0.12)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(x, Y_ALCA + 0.02, w * 0.16, h);
    }
    // a barra em bico com viés
    g.strokeStyle = laco;
    g.lineWidth = Math.max(0.008, pxs(f, 2));
    g.beginPath();
    g.moveTo(-0.1, h - 0.05);
    g.lineTo(w / 2, h - 0.01);
    g.lineTo(w + 0.1, h - 0.05);
    g.stroke();
    oclusao(f, -0.1, h - 0.06, w + 0.2, 0.05, "baixo", 0.15, sombra);
  };
  const pintar: Pintor = (f) => {
    p.pintar(f);
    if (f.parte !== "tronco" || f.face === "py") return;
    if (f.face === "pz" || f.face === "nz") {
      barbatanas(f);
      ilhoses(f, f.w / 2, Y_ALCA + 0.05, f.h - 0.04);
    } else
      emenda(
        f,
        [
          [f.w / 2, Y_ALCA + 0.02],
          [f.w / 2, f.h],
        ],
        0.3,
      );
  };
  return { ...p, pintar };
};

/* ———————————————————— 17–18. havaiana e polo rugby ———————————————————— */

const camisaHavaiana: CriarPeca = (m, c, q, pose) => {
  const cor = piso(c.corRoupa);
  const flor1 = segunda(c, cor);
  const flor2 = misturar(flor1, contrasta("#fb7185", cor) ? "#fb7185" : "#fde047", 0.6);
  const folha = misturar(cor, luminancia(cor) > 0.5 ? "#166534" : "#4ade80", 0.6);
  return simples({
    cor: "corRoupa",
    grao: "ruido",
    gola: "camisa",
    manga: "curta",
    botoes: 5,
    bolso: true,
    padrao: (f) => havaiana(f, flor1, flor2, folha),
  })(m, c, q, pose);
};

const poloRugby: CriarPeca = (m, c, q, pose) => {
  const cor = piso(c.corRoupa);
  const listra = segunda(c, cor);
  const p = simples({
    cor: "corRoupa",
    grao: "ruido",
    gola: "polo",
    manga: "longa",
    ribana: true,
    padrao: (f) => listrasContinuas(f, listra, 0.12, 0.05),
  })(m, c, q, pose);
  const gola = BRANCO;
  const pintar: Pintor = (f) => {
    p.pintar(f);
    if (f.parte !== "tronco" || f.face !== "pz") return;
    // carcela e gola brancas (o rugby clássico), botões de borracha
    const { g, w } = f;
    const cx = w / 2;
    g.fillStyle = "rgba(0,0,0,0.2)";
    g.fillRect(cx - 0.024 + 0.002, 0.0, 0.048, 0.19);
    g.fillStyle = gola;
    g.fillRect(cx - 0.024, -0.02, 0.048, 0.2);
    costura(
      f,
      [
        [cx - 0.018, 0.0],
        [cx - 0.018, 0.17],
        [cx + 0.018, 0.17],
        [cx + 0.018, 0.0],
      ],
      corDaLinha(gola),
      { traco: 0.006 },
    );
    for (let i = 0; i < 3; i++) botao(f, cx, 0.05 + i * 0.045, 0.0075, "#e7e5e4");
    pontasDeGola(f, gola, corDaLinha(gola), sombraDe_(gola), 0.085);
  };
  return { ...p, pintar };
};

export const PECAS_CIMA: Record<AvatarConfig["roupa"], CriarPeca> = {
  camiseta: simples({
    cor: "corRoupa",
    grao: "ruido",
    gola: "careca",
    manga: "curta",
    estampa: true,
  }),
  regata: simples({
    cor: "corRoupa",
    grao: "ruido",
    gola: "regata",
    manga: "nenhuma",
    estampa: true,
  }),
  polo: simples({ cor: "corRoupa", grao: "ruido", gola: "polo", manga: "curta", botoes: 3 }),
  camisa: simples({
    cor: "corRoupa",
    grao: "brim",
    gola: "camisa",
    manga: "longa",
    botoes: 6,
    bolso: true,
  }),
  social,
  xadrez,
  listrada,
  moletom,
  jaqueta: casacoSimples({
    casaco: (c) => c.corRoupa,
    baixo: (c) => c.corRoupa2,
    abertura: 0.34,
    esp: 0.03,
    rugosidade: 0.45,
    ziper: true,
    grao: "couro",
  }),
  terno: casacoSimples({
    casaco: (c) => c.corRoupa,
    baixo: (c) => (contrasta(c.corRoupa2, c.corRoupa) ? c.corRoupa2 : BRANCO),
    abertura: 0.28,
    gravata: "#b91c1c",
    lapela: true,
    grao: "brim",
  }),
  colete: casacoSimples({
    casaco: (c) => c.corRoupa,
    baixo: (c) => (contrasta(c.corRoupa2, c.corRoupa) ? c.corRoupa2 : BRANCO),
    abertura: 0.22,
    esp: 0.02,
    gravata: "#7c2d12",
    lapela: true,
    mangaDeBaixo: true,
    grao: "brim",
  }),
  sueter,
  jaleco: casacoSimples({
    casaco: () => BRANCO,
    baixo: (c) => c.corRoupa,
    abertura: 0.3,
    esp: 0.02,
    desce: 0.32,
    lapela: true,
    grao: "brim",
  }),
  epi,
  // —— femininas (13/10/2026) ——
  blusa: blusa({ decote: "canoa", manga: "cotovelo", formaManga: "sino", estampa: true }),
  cropped: blusa({ decote: "redondo", manga: "curta", cropped: true, estampa: true }),
  alcinha: blusa({ decote: "alca", manga: "nenhuma", renda: true, estampa: true }),
  ciganinha: blusa({
    decote: "ciganinha",
    manga: "curta",
    formaManga: "bufante",
    babado: "ombros",
  }),
  babado: blusa({
    decote: "redondo",
    manga: "curta",
    formaManga: "bufante",
    babado: "cintura",
    laco: "decote",
  }),
  cardiga: casacoSimples({
    casaco: (c) => c.corRoupa,
    baixo: (c) => (contrasta(c.corRoupa2, c.corRoupa) ? c.corRoupa2 : BRANCO),
    abertura: 0.3,
    esp: 0.018,
    trico: true,
    grao: "ruido",
  }),
  vestido: blusa({
    decote: "redondo",
    manga: "curta",
    formaManga: "bufante",
    cinto: true,
    laco: "cintura",
    bolinhas: true,
    saia: {
      op: (m) => ({ comp: 0.1 + m.pernaH * 0.42, larg: 1, fundo: 1, afunilar: 0.32 }),
      babado: true,
    },
  }),
  vestidoLongo: blusa({
    decote: "alca",
    manga: "nenhuma",
    cinto: true,
    renda: true,
    saia: {
      op: (m, sapato) => ({
        comp: 0.1 + m.pernaH - alturaDoCalcado(sapato, m) - 0.035,
        larg: 1,
        fundo: 1,
        afunilar: 0.22,
      }),
      fenda: true,
    },
  }),
  macacao: blusa({ decote: "v", manga: "nenhuma", cinto: true, laco: "cintura", grao: "brim" }),
  // —— novas (16/10/2026) ——
  flanelaAberta,
  jaquetaPatches,
  cortaVento,
  jaquetaCouro,
  brigadista,
  coleteCampo,
  camisaTime,
  moletomCropped,
  bomberCetim,
  kimono,
  sueterRenas,
  vestidoTule,
  vestidoFloral,
  jardineira,
  ombroSo,
  corset,
  havaiana: camisaHavaiana,
  poloRugby,
  /* O uniforme (19/10/2026: "camisa social azul-clara com o logo, só a
     bolinha, no bolso" e "polo azul-marinho com logo no bolso também"). Cor
     fixa — uniforme não troca de cor; o seletor de cor não mexe nele. */
  uniformeSocial: simples({
    bandeiras: true,
    cor: "#62c0ff",
    grao: "brim",
    gola: "camisa",
    manga: "longa",
    botoes: 6,
    bolso: true,
    logo: true,
  }),
  uniformePolo: simples({
    cor: "#1f2f56",
    grao: "ruido",
    gola: "polo",
    manga: "curta",
    botoes: 3,
    bolso: true,
    logo: true,
  }),
};

/**
 * Bandeira bordada na manga (19/10/2026: "na azul tem uma bandeira do Paraná
 * de um lado e do Brasil do outro"). Centro em (x, y), largura `l` (m), na
 * proporção 10:7; simplificadas para o tamanho de um patch.
 */
function bandeira(
  g: CanvasRenderingContext2D,
  qual: "brasil" | "parana",
  x: number,
  y: number,
  l: number,
) {
  const a = l * 0.7;
  g.save();
  g.translate(x - l / 2, y - a / 2);
  // a borda do patch
  g.fillStyle = "#f8fafc";
  g.fillRect(-l * 0.04, -l * 0.04, l * 1.08, a + l * 0.08);
  if (qual === "brasil") {
    g.fillStyle = "#009c3b";
    g.fillRect(0, 0, l, a);
    g.fillStyle = "#ffdf00";
    g.beginPath();
    g.moveTo(l * 0.5, a * 0.1);
    g.lineTo(l * 0.92, a * 0.5);
    g.lineTo(l * 0.5, a * 0.9);
    g.lineTo(l * 0.08, a * 0.5);
    g.closePath();
    g.fill();
    g.fillStyle = "#002776";
    g.beginPath();
    g.arc(l * 0.5, a * 0.5, a * 0.25, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#ffffff";
    g.lineWidth = a * 0.05;
    g.beginPath();
    g.arc(l * 0.5, a * 0.9, a * 0.5, Math.PI * 1.32, Math.PI * 1.68);
    g.stroke();
  } else {
    // Paraná: verde com a faixa branca na diagonal e a esfera azul no meio.
    g.fillStyle = "#00953a";
    g.fillRect(0, 0, l, a);
    g.save();
    g.beginPath();
    g.rect(0, 0, l, a);
    g.clip();
    g.strokeStyle = "#ffffff";
    g.lineWidth = a * 0.42;
    g.beginPath();
    g.moveTo(-l * 0.05, a * 1.05);
    g.lineTo(l * 1.05, -a * 0.05);
    g.stroke();
    g.restore();
    g.fillStyle = "#1f3f8f";
    g.beginPath();
    g.arc(l * 0.5, a * 0.5, a * 0.23, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#ffffff";
    g.lineWidth = a * 0.045;
    g.beginPath();
    g.arc(l * 0.5, a * 0.78, a * 0.32, Math.PI * 1.3, Math.PI * 1.7);
    g.stroke();
    // os ramos (pinheiro e erva-mate), em volta da esfera
    g.strokeStyle = "#0b6b2b";
    g.lineWidth = a * 0.05;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(
        l * 0.5,
        a * 0.5,
        a * 0.33,
        Math.PI * (s < 0 ? 0.6 : 0.05),
        Math.PI * (s < 0 ? 0.95 : 0.4),
      );
      g.stroke();
    }
  }
  g.restore();
}

/**
 * O símbolo da empresa (só a "bolinha", sem o nome), em vetor para ficar
 * nítido em qualquer tamanho: o arco verde-claro em volta, a folha verde-
 * escura em pé à esquerda e a folha verde deitada embaixo — o desenho do
 * logo, simplificado para caber num bolso. Centro em (x, y), raio `r` (m).
 */
function simboloDaEmpresa(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.save();
  g.translate(x, y);
  g.lineCap = "round";
  // o arco claro, aberto embaixo à esquerda
  g.strokeStyle = "#a3cf62";
  g.lineWidth = r * 0.2;
  g.beginPath();
  g.arc(r * 0.08, -r * 0.05, r * 0.88, -Math.PI * 0.62, Math.PI * 0.28);
  g.stroke();
  // a folha escura, em pé, com o veio claro no meio
  const folha = (cx: number, cy: number, comp: number, larg: number, giro: number) => {
    g.save();
    g.translate(cx, cy);
    g.rotate(giro);
    g.beginPath();
    g.moveTo(0, -comp / 2);
    g.quadraticCurveTo(larg, 0, 0, comp / 2);
    g.quadraticCurveTo(-larg, 0, 0, -comp / 2);
    g.closePath();
    g.restore();
  };
  folha(-r * 0.32, -r * 0.08, r * 1.5, r * 0.75, 0.12);
  g.fillStyle = "#2d5a2b";
  g.fill();
  folha(-r * 0.3, -r * 0.08, r * 0.95, r * 0.34, 0.12);
  g.fillStyle = "#4f8a3c";
  g.fill();
  // a folha verde, deitada, embaixo à direita
  folha(r * 0.32, r * 0.42, r * 1.25, r * 0.55, Math.PI / 2 - 0.15);
  g.fillStyle = "#4fb760";
  g.fill();
  folha(r * 0.32, r * 0.42, r * 0.7, r * 0.22, Math.PI / 2 - 0.15);
  g.fillStyle = "#86d38f";
  g.fill();
  g.restore();
}

/** Partes de cima cuja textura usa a cor da pele (decote, cava, barriga): a pele entra na chave. */
const PINTA_PELE: ReadonlySet<string> = new Set([
  "camiseta",
  "regata",
  "listrada",
  "sueter",
  "epi",
  "jaqueta",
  "jaleco",
  "blusa",
  "cropped",
  "alcinha",
  "ciganinha",
  "babado",
  "cardiga",
  "vestido",
  "vestidoLongo",
  "macacao",
  // novas (16/10/2026)
  "flanelaAberta",
  "jaquetaPatches",
  "jaquetaCouro",
  "camisaTime",
  "moletomCropped",
  "kimono",
  "sueterRenas",
  "vestidoTule",
  "vestidoFloral",
  "jardineira",
  "ombroSo",
  "corset",
]);

/** Chave do que muda o DESENHO da parte de cima (R2.5). */
export function chaveDeCima(c: AvatarConfig): string {
  const pele = PINTA_PELE.has(c.roupa) ? c.pele : "";
  // a saia do vestido encurta sentada conforme o calçado (não engole o pé)
  const pe = ROUPA_INTEIRA.has(c.roupa) ? c.sapato : "";
  return `cima|${c.roupa}|${c.corRoupa}|${c.corRoupa2}|${c.estampa}|${pele}|${pe}`;
}
