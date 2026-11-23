import type { Tracos } from "./tabelas";

/*
 * PDF → Excel: a tabela que está em IMAGEM (23/11/2026), a parte das contas — sem tela, sem pdf.js e
 * sem Tesseract, para testar no Node (`tests/grade-da-imagem.test.ts`). Quem desenha a imagem e chama o
 * Tesseract é `tabela-em-imagem.ts`.
 *
 * Calibrado com o PDF real do usuário (mapa de plantio: duas imagens de tabela de Excel, ~300 dpi):
 * ler a imagem inteira de uma vez errava a vírgula ("41,02" → "4102"), o "1" sozinho e o texto
 * branco sobre preto. O jeito que acertou tudo (66 de 66 linhas fechando a conta da própria tabela):
 *
 * 1. A GRADE vem da imagem: linhas finas (até ~1 pt) e retas, com fundo claro dos dois lados — o vão
 *    preto entre duas letras brancas, numa faixa escura, não tem. As faixas escuras (cabeçalho preto)
 *    dão a borda de cima e a de baixo; as verticais atravessam a faixa só por onde nenhuma frase passa
 *    (o título centralizado fica numa célula só; os títulos das colunas, cada um na sua).
 * 2. Cada CÉLULA é lida sozinha: recortada sem a borda, com o fundo virando branco (o cinza das linhas
 *    de total) ou invertida (a faixa preta), ampliada 3x.
 * 3. Duas leituras: em português (texto, acento) e, sem letras, em INGLÊS SÓ COM DÍGITOS — o modelo em
 *    inglês lê melhor número curto ("1,4", o "1" e o "0" sozinhos). Sem número válido, ele relê em 2x e
 *    em 4x. Quando as duas discordam: mesmos dígitos com e sem vírgula → fica a com vírgula (perder a
 *    vírgula é o erro comum); dígitos diferentes → uma terceira leitura desempata.
 * 4. Pela COLUNA: o mesmo texto com e sem acento, ou com "_" e espaço, vira um só (o OCR em português
 *    não escreve "_", e às vezes troca "E" por "É").
 */

/** Uma imagem em tons de cinza (0 = preto, 255 = branco), linha a linha. */
export type ImagemCinza = { largura: number; altura: number; px: Uint8Array };

/** Abaixo disto o pixel é tinta. */
const TINTA = 128;
/** Linha de grade: ao menos isto de comprimento... */
const COMPRIMENTO_DE_LINHA_PT = 6;
/** ...e no máximo isto de espessura (a faixa preta do cabeçalho é bem mais grossa). */
const ESPESSURA_DE_LINHA_PT = 1.2;
/** Fração dos pontos ao lado da linha que precisam ser claros. */
const LADOS_CLAROS = 0.9;

export type Horizontal = { y: number; x0: number; x1: number; faixa?: "topo" | "base" };
export type Vertical = { x: number; y0: number; y1: number };
export type LinhasDaImagem = {
  horizontais: Horizontal[];
  verticais: Vertical[];
  /** A imagem sem as linhas da grade (as linhas atrapalham a leitura). */
  semLinhas: Uint8Array;
};

/** Marca os pixels de tinta que estão em corridas de ao menos `minimo` na direção pedida. */
function corridas(tinta: Uint8Array, w: number, h: number, minimo: number, horizontal: boolean) {
  const saida = new Uint8Array(w * h);
  const [n1, n2] = horizontal ? [h, w] : [w, h];
  for (let a = 0; a < n1; a++) {
    let ini = -1;
    for (let b = 0; b <= n2; b++) {
      const dentro = b < n2 && tinta[horizontal ? a * w + b : b * w + a] === 1;
      if (dentro && ini < 0) ini = b;
      if (!dentro && ini >= 0) {
        if (b - ini >= minimo) {
          for (let k = ini; k < b; k++) saida[horizontal ? a * w + k : k * w + a] = 1;
        }
        ini = -1;
      }
    }
  }
  return saida;
}

/** Dos pixels marcados, fica só o que tem até `maxEsp` de espessura (a corrida na outra direção). */
function soFinos(m: Uint8Array, w: number, h: number, maxEsp: number, horizontal: boolean) {
  const saida = new Uint8Array(w * h);
  const [n1, n2] = horizontal ? [w, h] : [h, w];
  for (let a = 0; a < n1; a++) {
    let ini = -1;
    for (let b = 0; b <= n2; b++) {
      const i = horizontal ? b * w + a : a * w + b;
      const dentro = b < n2 && m[i] === 1;
      if (dentro && ini < 0) ini = b;
      if (!dentro && ini >= 0) {
        if (b - ini <= maxEsp) {
          for (let k = ini; k < b; k++) saida[horizontal ? k * w + a : a * w + k] = 1;
        }
        ini = -1;
      }
    }
  }
  return saida;
}

type Segmento = { pos: number; de: number; ate: number; ini: number; fim: number };

/** Os pixels de linha viram segmentos, juntando as fileiras vizinhas da mesma linha (a espessura). */
function segmentos(m: Uint8Array, w: number, h: number, horizontal: boolean): Segmento[] {
  const brutos: { pos: number; de: number; ate: number }[] = [];
  const [n1, n2] = horizontal ? [h, w] : [w, h];
  for (let a = 0; a < n1; a++) {
    let ini = -1;
    for (let b = 0; b <= n2; b++) {
      const dentro = b < n2 && m[horizontal ? a * w + b : b * w + a] === 1;
      if (dentro && ini < 0) ini = b;
      if (!dentro && ini >= 0) {
        brutos.push({ pos: a, de: ini, ate: b });
        ini = -1;
      }
    }
  }
  type Grupo = { ini: number; fim: number; de: number; ate: number; soma: number; n: number };
  const grupos: Grupo[] = [];
  for (const s of brutos) {
    const g = grupos.find((x) => s.pos - x.fim <= 2 && s.de <= x.ate + 3 && x.de <= s.ate + 3);
    if (g) {
      g.fim = s.pos;
      g.de = Math.min(g.de, s.de);
      g.ate = Math.max(g.ate, s.ate);
      g.soma += s.pos;
      g.n++;
    } else {
      grupos.push({ ini: s.pos, fim: s.pos, de: s.de, ate: s.ate, soma: s.pos, n: 1 });
    }
  }
  return grupos.map((g) => ({ pos: g.soma / g.n, de: g.de, ate: g.ate, ini: g.ini, fim: g.fim }));
}

/** Linha de grade de verdade tem fundo claro dos dois lados, a ~3 px, ao longo dela. */
function ladosClaros(img: ImagemCinza, s: Segmento, horizontal: boolean): boolean {
  const { largura: w, altura: h, px } = img;
  let claros = 0;
  let total = 0;
  for (let t = s.de; t < s.ate; t += 2) {
    for (const lado of [s.ini - 3, s.fim + 3]) {
      const [x, y] = horizontal ? [t, lado] : [lado, t];
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      total++;
      if (px[y * w + x]! >= TINTA) claros++;
    }
  }
  return total > 0 && claros / total >= LADOS_CLAROS;
}

/**
 * 1. As linhas da grade de uma imagem: as finas (que são apagadas da cópia que vai para o OCR) e as
 * bordas de cima e de baixo das faixas escuras (que ficam: são o fundo da faixa).
 */
export function linhasDaImagem(img: ImagemCinza, pxPorPt: number): LinhasDaImagem {
  const { largura: w, altura: h, px } = img;
  const tinta = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) tinta[i] = px[i]! < TINTA ? 1 : 0;
  const minimo = Math.round(COMPRIMENTO_DE_LINHA_PT * pxPorPt);
  const maxEsp = Math.max(2, Math.round(ESPESSURA_DE_LINHA_PT * pxPorPt));
  // O afinamento pode deixar pedaços de 1 ou 2 pixels de uma corrida grossa: segmento curto não é linha.
  const sh = segmentos(
    soFinos(corridas(tinta, w, h, minimo, true), w, h, maxEsp, true),
    w,
    h,
    true,
  ).filter((s) => s.ate - s.de >= minimo && ladosClaros(img, s, true));
  const sv = segmentos(
    soFinos(corridas(tinta, w, h, minimo, false), w, h, maxEsp, false),
    w,
    h,
    false,
  ).filter((s) => s.ate - s.de >= minimo && ladosClaros(img, s, false));

  const semLinhas = new Uint8Array(px);
  // Apaga com 1 pixel de folga: o halo do JPEG em volta da linha.
  for (const s of sh) {
    for (let y = Math.max(0, s.ini - 1); y <= Math.min(h - 1, s.fim + 1); y++) {
      for (let x = s.de; x < s.ate; x++) semLinhas[y * w + x] = 255;
    }
  }
  for (const s of sv) {
    for (let x = Math.max(0, s.ini - 1); x <= Math.min(w - 1, s.fim + 1); x++) {
      for (let y = s.de; y < s.ate; y++) semLinhas[y * w + x] = 255;
    }
  }

  const horizontais: Horizontal[] = sh.map((s) => ({ y: s.pos, x0: s.de, x1: s.ate }));
  // As bordas das faixas escuras: tinta de um lado, claro do outro, ao longo de uma linha comprida. A
  // borda de verdade tem, para FORA, 4 fileiras claras (o fundo da célula vizinha); a "borda" falsa no
  // meio do texto branco da faixa tem preto de novo logo depois.
  const claro = (x: number, y: number) => y < 0 || y >= h || px[y * w + x]! >= TINTA;
  for (let y = 0; y < h; y++) {
    for (const lado of [-1, 1] as const) {
      let ini = -1;
      for (let x = 0; x <= w; x++) {
        const borda = x < w && tinta[y * w + x] === 1 && claro(x, y + lado) && !claro(x, y - lado);
        if (borda && ini < 0) ini = x;
        if (!borda && ini >= 0) {
          let solida = x - ini >= minimo;
          for (let d = 1; solida && d <= 4; d++) {
            const yy = y + lado * d;
            if (yy < 0 || yy >= h) break; // a borda da própria imagem conta como fora
            let n = 0;
            for (let xx = ini; xx < x; xx++) if (px[yy * w + xx]! >= TINTA) n++;
            if (n < 0.8 * (x - ini)) solida = false;
          }
          if (solida) {
            horizontais.push({
              y: y + lado * 0.5,
              x0: ini,
              x1: x,
              faixa: lado < 0 ? "topo" : "base",
            });
          }
          ini = -1;
        }
      }
    }
  }
  const verticais: Vertical[] = sv.map((s) => ({ x: s.pos, y0: s.de, y1: s.ate }));
  return { horizontais, verticais, semLinhas };
}

/* ----------------------------- 1b. As faixas escuras ----------------------------- */

export type Faixa = { x0: number; y0: number; x1: number; y1: number };

/** Os pedaços da mesma borda (interrompida onde uma vertical a cruza) viram uma borda só. */
function juntarPedacos(ls: Horizontal[]): Horizontal[] {
  const saida: Horizontal[] = [];
  for (const l of [...ls].sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
    const u = saida.find((s) => Math.abs(s.y - l.y) <= 1 && l.x0 - s.x1 <= 4 && s.x0 - l.x1 <= 4);
    if (u) {
      u.x0 = Math.min(u.x0, l.x0);
      u.x1 = Math.max(u.x1, l.x1);
    } else {
      saida.push({ ...l });
    }
  }
  return saida;
}

/** As faixas escuras: cada borda de cima com a borda de baixo mais próxima que ocupa a mesma largura. */
export function faixasDaImagem(horizontais: Horizontal[]): Faixa[] {
  const topos = juntarPedacos(horizontais.filter((l) => l.faixa === "topo"));
  const bases = juntarPedacos(horizontais.filter((l) => l.faixa === "base"));
  const sobrepoe = (a: Horizontal, b: Horizontal) =>
    Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const faixas: Faixa[] = [];
  for (const t of topos) {
    const b = bases
      .filter((b) => b.y > t.y + 4 && sobrepoe(t, b) >= 0.8 * Math.min(t.x1 - t.x0, b.x1 - b.x0))
      .sort((p, q) => p.y - q.y)[0];
    if (b) faixas.push({ x0: Math.max(t.x0, b.x0), x1: Math.min(t.x1, b.x1), y0: t.y, y1: b.y });
  }
  return faixas;
}

/** Uma palavra lida, com a caixa em pixels (da imagem ou do recorte, conforme quem pergunta). */
export type PalavraNaImagem = { x0: number; y0: number; x1: number; y1: number; t: string };

/**
 * A faixa por dentro (lida inteira, em linhas de texto): o meio entre duas linhas de texto vira uma
 * divisão; cada vertical que encosta na faixa a atravessa, a partir do lado dela, enquanto nenhuma
 * FRASE passar por cima dela. Frase = palavras separadas por um espaço comum (até uma altura de letra);
 * a frase em que alguma palavra passa por cima de uma divisa (o título centralizado) fica numa célula só.
 * Muda as `verticais` (o prolongamento) e devolve as divisões novas.
 */
export function atravessarFaixa(
  f: Faixa,
  linhas: PalavraNaImagem[][],
  verticais: Vertical[],
): Horizontal[] {
  const ordenadas = linhas
    .filter((l) => l.length > 0)
    .map((ws) => ({
      ws,
      y0: Math.min(...ws.map((w) => w.y0)),
      y1: Math.max(...ws.map((w) => w.y1)),
    }))
    .sort((a, b) => a.y0 - b.y0);
  const extras: Horizontal[] = [];
  const cortes = [f.y0];
  for (let i = 1; i < ordenadas.length; i++) {
    const y = (ordenadas[i - 1]!.y1 + ordenadas[i]!.y0) / 2;
    cortes.push(y);
    extras.push({ y, x0: f.x0, x1: f.x1 });
  }
  cortes.push(f.y1);
  const internas = verticais.filter((v) => v.x >= f.x0 + 2 && v.x <= f.x1 - 2);
  const passaPorCima = (w: PalavraNaImagem, x: number) => w.x0 + 2 < x && x < w.x1 - 2;
  const sub = ordenadas.map((l, i) => {
    const ws = [...l.ws].sort((a, b) => a.x0 - b.x0);
    const frases: { x0: number; x1: number; alt: number; ws: PalavraNaImagem[] }[] = [];
    for (const w of ws) {
      const fr = frases[frases.length - 1];
      const alt = Math.max(w.y1 - w.y0, fr?.alt ?? 0);
      if (fr && w.x0 - fr.x1 <= alt) {
        fr.x1 = Math.max(fr.x1, w.x1);
        fr.ws.push(w);
        fr.alt = alt;
      } else {
        frases.push({ x0: w.x0, x1: w.x1, alt: w.y1 - w.y0, ws: [w] });
      }
    }
    const bloqueadas = new Set<Vertical>();
    for (const fr of frases) {
      if (!fr.ws.some((w) => internas.some((v) => passaPorCima(w, v.x)))) continue;
      for (const v of internas) if (fr.x0 - 2 < v.x && v.x < fr.x1 + 2) bloqueadas.add(v);
    }
    return { y0: cortes[i]!, y1: cortes[i + 1]!, ws, bloqueadas };
  });
  for (const v of internas) {
    const corta = (s: (typeof sub)[number]) =>
      s.bloqueadas.has(v) || s.ws.some((w) => passaPorCima(w, v.x));
    if (Math.abs(v.y0 - f.y1) <= 4) {
      for (const s of [...sub].reverse()) {
        if (corta(s)) break;
        v.y0 = s.y0;
      }
    } else if (Math.abs(v.y1 - f.y0) <= 4) {
      for (const s of sub) {
        if (corta(s)) break;
        v.y1 = s.y1;
      }
    }
  }
  return extras;
}

/**
 * As linhas da imagem como traços da página, em pontos (o mesmo sistema de `tabelas.ts`). A escala
 * vem por eixo: a imagem esticada para caber na página tem uma em cada.
 */
export function tracosEmPontos(
  horizontais: Horizontal[],
  verticais: Vertical[],
  escala: { x: number; y: number },
  origem: { x: number; y: number },
): Tracos {
  const X = (p: number) => origem.x + p / escala.x;
  const Y = (p: number) => origem.y + p / escala.y;
  return {
    horizontais: horizontais.map((l) => ({ x0: X(l.x0), x1: X(l.x1), y0: Y(l.y), y1: Y(l.y) })),
    verticais: verticais.map((l) => ({ x0: X(l.x), x1: X(l.x), y0: Y(l.y0), y1: Y(l.y1) })),
  };
}

/* --------------------------------- 2. A célula --------------------------------- */

/** O miolo de uma célula, em pixels da imagem (sem a borda), e se o fundo dela é escuro. */
export type Miolo = { x0: number; y0: number; x1: number; y1: number; escuro: boolean };

/** O miolo da célula entre as bordas dadas (px); `null` se ela está vazia. */
export function mioloDaCelula(
  img: ImagemCinza,
  semLinhas: Uint8Array,
  bx0: number,
  by0: number,
  bx1: number,
  by1: number,
): Miolo | null {
  const w = img.largura;
  const x0 = Math.max(0, Math.ceil(bx0) + 2);
  const y0 = Math.max(0, Math.ceil(by0) + 2);
  const x1 = Math.min(img.largura, Math.floor(bx1) - 1);
  const y1 = Math.min(img.altura, Math.floor(by1) - 1);
  if (x1 - x0 < 3 || y1 - y0 < 3) return null;
  let soma = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) soma += img.px[y * w + x]!;
  const escuro = soma / ((x1 - x0) * (y1 - y0)) < 110;
  let tinta = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = semLinhas[y * w + x]!;
      if (escuro ? v > 160 : v < TINTA) tinta++;
    }
  }
  return tinta < 6 ? null : { x0, y0, x1, y1, escuro };
}

/** Um recorte pronto para o OCR (cinza, texto escuro em fundo branco) e onde ele está na imagem. */
export type Recorte = ImagemCinza & {
  origemX: number;
  origemY: number;
  fator: number;
  margem: number;
};

/** Margem branca em volta do recorte: o Tesseract lê mal o texto encostado na borda. */
export const MARGEM_DO_RECORTE = 16;

/**
 * O miolo para o OCR: o tom do fundo vira branco (o cinza das linhas de total some), o fundo escuro
 * é invertido (o texto branco vira preto), ampliado `fator` vezes (bilinear), com margem branca.
 */
export function recortar(
  semLinhas: Uint8Array,
  larguraDaImagem: number,
  m: Miolo,
  fator: number,
): Recorte {
  const W = larguraDaImagem;
  const { x0, y0, x1, y1, escuro } = m;
  const w = x1 - x0;
  const h = y1 - y0;
  let fundo = 255;
  if (!escuro) {
    const hist = new Uint32Array(256);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[semLinhas[y * W + x]!]!++;
    let max = 0;
    for (let v = 0; v < 256; v++) {
      if (hist[v]! > max) {
        max = hist[v]!;
        fundo = v;
      }
    }
    if (fundo < 150) fundo = 255; // fundo escuro demais para ser só um cinza: não mexe
  }
  const margem = MARGEM_DO_RECORTE;
  const ww = Math.round(w * fator);
  const hh = Math.round(h * fator);
  const largura = ww + 2 * margem;
  const altura = hh + 2 * margem;
  const px = new Uint8Array(largura * altura).fill(255);
  const v = (i: number, j: number) => semLinhas[(y0 + j) * W + x0 + i]!;
  for (let Y = 0; Y < hh; Y++) {
    const sy = Math.min(h - 1, Math.max(0, (Y + 0.5) / fator - 0.5));
    const ay = Math.floor(sy);
    const by = Math.min(h - 1, ay + 1);
    const fy = sy - ay;
    for (let X = 0; X < ww; X++) {
      const sx = Math.min(w - 1, Math.max(0, (X + 0.5) / fator - 0.5));
      const ax = Math.floor(sx);
      const bx = Math.min(w - 1, ax + 1);
      const fx = sx - ax;
      let p =
        v(ax, ay) * (1 - fx) * (1 - fy) +
        v(bx, ay) * fx * (1 - fy) +
        v(ax, by) * (1 - fx) * fy +
        v(bx, by) * fx * fy;
      p = escuro ? 255 - p : fundo < 250 ? Math.min(255, (p * 255) / fundo) : p;
      px[(Y + margem) * largura + X + margem] = Math.round(p);
    }
  }
  return { largura, altura, px, origemX: x0, origemY: y0, fator, margem };
}

/** Um ponto do recorte de volta para a imagem. */
export function naImagem(r: Recorte, x: number, y: number): { x: number; y: number } {
  return { x: r.origemX + (x - r.margem) / r.fator, y: r.origemY + (y - r.margem) / r.fator };
}

/**
 * A tinta nas pontas do recorte que o OCR não leu (o "I" sozinho no começo de "I 144 - EUCALIPTO",
 * que o Tesseract pula): um pedaço de ao menos 40% da altura da letra antes da primeira palavra ou
 * depois da última, recortado para ser lido como uma letra só.
 */
export function tintaNaoLida(
  r: Recorte,
  palavras: PalavraNaImagem[],
): { lado: "esq" | "dir"; recorte: Recorte }[] {
  if (palavras.length === 0) return [];
  const { largura: W, altura: H, px } = r;
  const temTinta = (x: number) => {
    for (let y = 0; y < H; y++) if (px[y * W + x]! < TINTA) return true;
    return false;
  };
  let esq = -1;
  let dir = -1;
  for (let x = 0; x < W; x++) {
    if (temTinta(x)) {
      esq = x;
      break;
    }
  }
  for (let x = W - 1; x >= 0; x--) {
    if (temTinta(x)) {
      dir = x;
      break;
    }
  }
  const p0 = Math.min(...palavras.map((p) => p.x0));
  const p1 = Math.max(...palavras.map((p) => p.x1));
  const altura = Math.max(...palavras.map((p) => p.y1 - p.y0));
  const sobras: { lado: "esq" | "dir"; x0: number; x1: number }[] = [];
  if (esq >= 0 && p0 - esq > 0.4 * altura)
    sobras.push({ lado: "esq", x0: Math.max(0, esq - 6), x1: p0 - 2 });
  if (dir >= 0 && dir - p1 > 0.4 * altura)
    sobras.push({ lado: "dir", x0: p1 + 2, x1: Math.min(W, dir + 7) });
  return sobras.map((s) => {
    const largura = s.x1 - s.x0 + 2 * r.margem;
    const sub = new Uint8Array(largura * H).fill(255);
    for (let y = 0; y < H; y++) {
      for (let x = s.x0; x < s.x1; x++) sub[y * largura + x - s.x0 + r.margem] = px[y * W + x]!;
    }
    return { lado: s.lado, recorte: { ...r, largura, px: sub } };
  });
}

/**
 * O sublinhado entre duas palavras ("AREA_SILVICULTURA"): o OCR em português não o escreve — põe um
 * espaço, ou uma vírgula ("Micro, Regiao"). É um risco que cobre o vão entre as palavras, embaixo.
 * Devolve o texto com os "_" no lugar; `null` se não achou nenhum.
 */
export function comSublinhados(r: Recorte, palavras: PalavraNaImagem[]): string | null {
  if (palavras.length < 2) return null;
  const { largura: W, altura: H, px } = r;
  const ps = [...palavras].sort((p, q) => p.x0 - q.x0);
  let achou = false;
  let saida = ps[0]!.t;
  for (let i = 1; i < ps.length; i++) {
    const e = ps[i - 1]!;
    const d = ps[i]!;
    const altura = Math.max(e.y1 - e.y0, d.y1 - d.y0);
    const base = Math.max(e.y1, d.y1);
    const x0 = Math.max(0, e.x1 + 1);
    const x1 = Math.min(W, d.x0 - 1);
    let risco = false;
    if (x1 - x0 >= 3) {
      const de = Math.max(0, base - Math.round(0.2 * altura));
      const ate = Math.min(H - 1, base + Math.round(0.25 * altura));
      for (let y = de; y <= ate && !risco; y++) {
        let n = 0;
        for (let x = x0; x < x1; x++) if (px[y * W + x]! < TINTA) n++;
        if (n >= 0.8 * (x1 - x0)) risco = true;
      }
    }
    if (risco) {
      saida = saida.replace(/[.,;:]+$/, "") + "_" + d.t.replace(/^[.,;:]+/, "");
      achou = true;
    } else {
      saida += " " + d.t;
    }
  }
  return achou ? limparLeitura(saida) : null;
}

/* -------------------------------- 3. A leitura -------------------------------- */

/** O que sobra da borda e do fundo nas pontas da leitura ("— Quadra", "Variedade =") sai. */
export function limparLeitura(t: string): string {
  return t
    .replace(/\s+/g, " ")
    .replace(/^[\s—–=“”"'_~-]+(?=\S)/, "")
    .replace(/(?<=\S)[\s—–=“”"'|_~]+$/, "")
    .trim();
}

export function letrasEm(t: string): number {
  return (t.match(/[A-Za-zÀ-ú]/g) ?? []).length;
}

const semEspaco = (t: string) => t.replace(/\s+/g, "");
const soDigitos = (t: string) => t.replace(/\D/g, "");
const ehTraco = (t: string) => /^[-–—]{1,2}$/.test(t);

/** Uma leitura do Tesseract: o texto (já limpo), a confiança (0–100) e as palavras, no recorte. */
export type Leitura = { t: string; c: number; palavras: PalavraNaImagem[] };
/**
 * Quem lê: "por" é o português sem restrição; "eng" é o inglês só com dígitos e pontuação
 * ("0123456789,.-/:"). O modo é o do Tesseract: "7" uma linha, "6" um bloco, "10" uma letra.
 */
export type Ler = (idioma: "por" | "eng", r: Recorte, modo: "6" | "7" | "10") => Promise<Leitura>;

/** O que uma célula virou. `incerta`: as leituras não chegaram a um acordo (ou não deu para ler). */
export type CelulaLida = { texto: string; numero: string | null; incerta: boolean };

/**
 * 3. A leitura de uma célula (passo 3 do topo). `valido` diz se o texto é um número ou uma data (o
 * `lerValor` de `tabelas.ts`, que entra por parâmetro para este arquivo não importar nada).
 */
export async function lerCelula(
  semLinhas: Uint8Array,
  larguraDaImagem: number,
  m: Miolo,
  umaLinha: boolean,
  ler: Ler,
  valido: (t: string) => boolean,
): Promise<CelulaLida> {
  const modo = umaLinha ? "7" : "6";
  const r3 = recortar(semLinhas, larguraDaImagem, m, 3);
  const a = await ler("por", r3, modo);
  a.t = a.t.replace(/(^|\s)\|(?=\s|$)/g, "$1I"); // o "I" sozinho lido como "|"
  // É texto: 3 letras ou mais bem lidas; 2 letras só com mais confiança (o "0" lido "jo)" vem com
  // confiança ~60, no limite); 1 letra só com muita (o "E" da coluna, mas não o "1" lido "É").
  const n = letrasEm(a.t);
  const ehTexto =
    (n >= 3 && a.c >= 60) || (n === 2 && a.c >= 75) || (n === 1 && !/\d/.test(a.t) && a.c >= 80);

  if (ehTexto) {
    let texto = a.t;
    if (umaLinha && a.palavras.length >= 2) texto = comSublinhados(r3, a.palavras) ?? texto;
    if (umaLinha) {
      for (const s of tintaNaoLida(r3, a.palavras)) {
        const extra = (await ler("por", s.recorte, "10")).t.replace(/\|/g, "I");
        if (/^[A-Za-zÀ-ú0-9]{1,2}$/.test(extra)) {
          texto = s.lado === "esq" ? `${extra} ${texto}` : `${texto} ${extra}`;
        }
      }
    }
    return { texto, numero: null, incerta: false };
  }

  // Palavra de verdade (3 letras ou mais) lida com pouca confiança — o "1 Total" da linha cinza: a
  // leitura só de dígitos acharia o "1" e jogaria o "Total" fora. Ela só serve para ver se é o traço.
  if (n >= 3) {
    const b = await ler("eng", r3, modo);
    if (ehTraco(semEspaco(b.t))) return { texto: "-", numero: null, incerta: false };
    // Uma segunda leitura em português, em 2x: o mesmo texto confirma; senão, fica a mais confiante.
    const a2 = await ler("por", recortar(semLinhas, larguraDaImagem, m, 2), modo);
    a2.t = a2.t.replace(/(^|\s)\|(?=\s|$)/g, "$1I");
    if (a2.t === a.t) return { texto: a.t, numero: null, incerta: false };
    const melhor = a2.c > a.c ? a2 : a;
    return { texto: melhor.t, numero: null, incerta: melhor.c < 50 };
  }

  // Sem letras (ou leitura fraca): o inglês só com dígitos, em 3x, 2x e 4x, até dar número válido.
  const numeroDe = (t: string) => (valido(semEspaco(t)) ? semEspaco(t) : null);
  const aNum = letrasEm(a.t) === 0 ? numeroDe(a.t) : null;
  let bNum: string | null = null;
  let bCru = "";
  for (const fator of [3, 2, 4]) {
    const b = await ler(
      "eng",
      fator === 3 ? r3 : recortar(semLinhas, larguraDaImagem, m, fator),
      modo,
    );
    if (!bCru || ehTraco(semEspaco(b.t))) bCru = semEspaco(b.t);
    bNum = numeroDe(b.t);
    if (bNum) break;
  }
  if (aNum && bNum && aNum !== bNum) {
    // Mesmos dígitos, só a pontuação muda: perder a vírgula é o erro comum; fica a que tem.
    if (soDigitos(aNum) === soDigitos(bNum)) {
      return {
        texto: "",
        numero: /[,.]/.test(aNum) && !/[,.]/.test(bNum) ? aNum : bNum,
        incerta: false,
      };
    }
    // Dígitos diferentes: o inglês em 2x (o que melhor lê dígito sozinho) desempata; depois o português.
    const r2 = recortar(semLinhas, larguraDaImagem, m, 2);
    for (const idioma of ["eng", "por"] as const) {
      const c = semEspaco((await ler(idioma, r2, modo)).t);
      if (c === aNum || c === bNum) return { texto: "", numero: c, incerta: false };
    }
    return { texto: "", numero: a.c >= 85 ? aNum : bNum, incerta: true };
  }
  if (bNum) return { texto: "", numero: bNum, incerta: false };
  if (aNum) return { texto: "", numero: aNum, incerta: a.c < 70 };
  // O traço sozinho ("-", célula sem valor): o português lê lixo; o inglês só com dígitos lê o traço.
  if (ehTraco(bCru)) return { texto: "-", numero: null, incerta: false };
  if (a.c >= 60 || !a.t) return { texto: a.t, numero: null, incerta: false };
  // Algo que ninguém leu com segurança: "?" na planilha, para a pessoa conferir. (Sem leitura nenhuma
  // — um pontinho de sujeira numa célula vazia —, a célula fica vazia.)
  return { texto: "?", numero: null, incerta: true };
}

/* ------------------------------ 4. Pela coluna ------------------------------ */

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const chaveDe = (t: string) =>
  semAcento(t)
    .replace(/[_\s]+/g, " ")
    .trim();

/**
 * 4. O consenso da coluna: os textos iguais a menos de acento e de "_"/espaço são o mesmo valor. Num
 * grupo de 3 ou mais, cada palavra fica com o acento da maioria, e um "_" visto em ao menos 2 deles
 * vale para todos. Devolve o texto corrigido de cada texto que muda.
 */
export function consensoDaColuna(textos: string[]): Map<string, string> {
  const grupos = new Map<string, string[]>();
  for (const t of textos) {
    if (!t) continue;
    const k = chaveDe(t);
    const g = grupos.get(k);
    if (g) g.push(t);
    else grupos.set(k, [t]);
  }
  const saida = new Map<string, string>();
  for (const ts of grupos.values()) {
    if (ts.length < 3) continue;
    const partes = ts.map((t) => ({
      palavras: t.split(/[_\s]+/),
      seps: (t.match(/[_\s]+/g) ?? []).map((s) => (s.includes("_") ? "_" : " ")),
    }));
    const n = partes[0]!.palavras.length;
    if (!partes.every((p) => p.palavras.length === n)) continue;
    let canonico = "";
    for (let i = 0; i < n; i++) {
      const cont = new Map<string, number>();
      for (const p of partes) cont.set(p.palavras[i]!, (cont.get(p.palavras[i]!) ?? 0) + 1);
      canonico += [...cont].sort((x, y) => y[1] - x[1])[0]![0];
      if (i + 1 < n) canonico += partes.filter((p) => p.seps[i] === "_").length >= 2 ? "_" : " ";
    }
    for (const t of ts) if (t !== canonico) saida.set(t, canonico);
  }
  return saida;
}
