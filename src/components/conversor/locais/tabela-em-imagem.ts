import type { PSM, RecognizeResult, Worker } from "tesseract.js";
import { ateCancelar, liberarCanvas, pararSeCancelado, respirar } from "./arquivos";
import {
  atravessarFaixa,
  consensoDaColuna,
  faixasDaImagem,
  lerCelula,
  letrasEm,
  limparLeitura,
  linhasDaImagem,
  mioloDaCelula,
  naImagem,
  recortar,
  tracosEmPontos,
  type CelulaLida,
  type Faixa,
  type Horizontal,
  type ImagemCinza,
  type Ler,
  type Miolo,
  type PalavraNaImagem,
} from "./grade-da-imagem";
import { abrirLeitor, quantosLeitores } from "./leitor-ocr";
import { acharGrades, lerValor, type RegiaoParaLer, type Tracos, type Trecho } from "./tabelas";

/*
 * PDF → Excel: a tabela que está em IMAGEM, a parte do navegador (23/11/2026). As contas e as regras
 * (calibradas com o PDF real do usuário) estão em `grade-da-imagem.ts`; aqui a região da página é
 * desenhada pelo pdf.js na resolução da própria imagem, e o Tesseract lê célula por célula, com
 * vários pares de leitores (português + inglês só com dígitos) em paralelo. O resultado volta como
 * pedaços de texto e traços da página — o mesmo que o texto de verdade —, e `tabelas.ts` monta a
 * planilha do jeito de sempre.
 */

/** O pedaço da página do pdf.js que desenha. */
export type PaginaParaDesenhar = {
  getViewport(o: { scale: number; offsetX?: number; offsetY?: number }): unknown;
  render(o: { canvas: HTMLCanvasElement; viewport: unknown; transform?: number[] }): {
    promise: Promise<void>;
  };
};

/** Um par de leitores: o português (texto) e o inglês só com dígitos (número). */
type Par = { por: Worker; eng: Worker; modo: { por?: string; eng?: string } };
export type Leitores = { pares: Par[]; encerrar(): void };

const SO_DIGITOS = "0123456789,.-/:";

/** Abre os pares de leitores. O primeiro baixa os idiomas e os guarda no navegador; os outros já os acham. */
export async function abrirLeitores(sinal?: AbortSignal): Promise<Leitores> {
  const todos: Worker[] = [];
  const encerrar = () => {
    for (const w of todos) void w.terminate();
  };
  const abrirPar = async (): Promise<Par> => {
    const abertos = await Promise.allSettled([
      abrirLeitor("por", sinal),
      abrirLeitor("eng", sinal),
    ]);
    for (const a of abertos) if (a.status === "fulfilled") todos.push(a.value);
    const falha = abertos.find((a): a is PromiseRejectedResult => a.status === "rejected");
    if (falha) throw falha.reason;
    const [por, eng] = abertos.map((a) => (a as PromiseFulfilledResult<Worker>).value) as [
      Worker,
      Worker,
    ];
    await por.setParameters({ preserve_interword_spaces: "1" });
    await eng.setParameters({ tessedit_char_whitelist: SO_DIGITOS });
    return { por, eng, modo: {} };
  };
  try {
    const pares = [await abrirPar()];
    const mais = quantosLeitores(4) - 1;
    pares.push(...(await Promise.all(Array.from({ length: mais }, abrirPar))));
    return { pares, encerrar };
  } catch (e) {
    encerrar();
    throw e;
  }
}

/** O recorte (cinza) num canvas, que é o que o Tesseract aceita no navegador. */
function paraCanvas(r: ImagemCinza): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = r.largura;
  canvas.height = r.altura;
  const c = canvas.getContext("2d");
  if (c) {
    const dados = c.createImageData(r.largura, r.altura);
    for (let i = 0; i < r.px.length; i++) {
      const v = r.px[i]!;
      dados.data[i * 4] = v;
      dados.data[i * 4 + 1] = v;
      dados.data[i * 4 + 2] = v;
      dados.data[i * 4 + 3] = 255;
    }
    c.putImageData(dados, 0, 0);
  }
  return canvas;
}

/** Uma palavra lida, com a confiança do Tesseract (0–100). */
type PalavraLida = PalavraNaImagem & { c: number };

/** As palavras do resultado, linha a linha, com a caixa no recorte. */
function linhasDe(r: RecognizeResult): PalavraLida[][] {
  const linhas: PalavraLida[][] = [];
  for (const b of r.data.blocks ?? []) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) {
        const ws = l.words
          .filter((w) => w.text.trim() !== "")
          .map((w) => ({
            x0: w.bbox.x0,
            y0: w.bbox.y0,
            x1: w.bbox.x1,
            y1: w.bbox.y1,
            t: w.text,
            c: w.confidence,
          }));
        if (ws.length > 0) linhas.push(ws);
      }
    }
  }
  return linhas;
}

async function reconhecer(
  par: Par,
  idioma: "por" | "eng",
  r: ImagemCinza,
  modo: string,
  sinal?: AbortSignal,
): Promise<RecognizeResult> {
  const w = par[idioma];
  if (par.modo[idioma] !== modo) {
    await w.setParameters({ tessedit_pageseg_mode: modo as unknown as PSM });
    par.modo[idioma] = modo;
  }
  const canvas = paraCanvas(r);
  try {
    return await ateCancelar(w.recognize(canvas, { rotateAuto: false }, { blocks: true }), sinal);
  } finally {
    liberarCanvas(canvas);
  }
}

/** O `Ler` de `grade-da-imagem.ts` com um par de leitores. */
function leitorDo(par: Par, sinal?: AbortSignal): Ler {
  return async (idioma, r, modo) => {
    const res = await reconhecer(par, idioma, r, modo, sinal);
    return {
      t: limparLeitura(res.data.text),
      c: res.data.confidence,
      palavras: linhasDe(res).flat(),
    };
  };
}

/** Número ou data, lido como no Brasil (a regra de `tabelas.ts`). */
function valido(t: string): boolean {
  const v = lerValor(t);
  return typeof v === "number" || (typeof v === "object" && v !== null);
}

/**
 * Desenha a região da página na escala dela (a da própria imagem, em cada eixo: um pixel da imagem
 * vira um pixel do desenho, sem borrar) e devolve em tons de cinza.
 */
async function desenharRegiao(pagina: PaginaParaDesenhar, r: RegiaoParaLer): Promise<ImagemCinza> {
  const kx = r.pxPorPt;
  const ky = r.pxPorPtY;
  const largura = Math.max(1, Math.ceil((r.x1 - r.x0) * kx));
  const altura = Math.max(1, Math.ceil((r.y1 - r.y0) * ky));
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  try {
    const c = canvas.getContext("2d", { willReadFrequently: true });
    if (!c) throw new Error("sem contexto 2d");
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, largura, altura);
    const vista = pagina.getViewport({ scale: kx, offsetX: -r.x0 * kx, offsetY: -r.y0 * kx });
    // A escala da altura, quando difere da largura, vai por cima, já no canvas.
    await pagina.render({ canvas, viewport: vista, transform: [1, 0, 0, ky / kx, 0, 0] }).promise;
    const { data } = c.getImageData(0, 0, largura, altura);
    const px = new Uint8Array(largura * altura);
    for (let i = 0; i < px.length; i++) {
      px[i] = Math.round(
        0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!,
      );
    }
    return { largura, altura, px };
  } finally {
    liberarCanvas(canvas);
  }
}

/** A faixa escura lida inteira (invertida, em 2x), em linhas de texto, com as caixas na imagem. */
async function lerFaixa(
  par: Par,
  semLinhas: Uint8Array,
  largura: number,
  f: Faixa,
  sinal?: AbortSignal,
): Promise<PalavraNaImagem[][]> {
  const m: Miolo = {
    x0: Math.ceil(f.x0),
    y0: Math.ceil(f.y0) + 1,
    x1: Math.floor(f.x1),
    y1: Math.floor(f.y1),
    escuro: true,
  };
  if (m.x1 - m.x0 < 4 || m.y1 - m.y0 < 4) return [];
  const r = recortar(semLinhas, largura, m, 2);
  const res = await reconhecer(par, "por", r, "6", sinal);
  return linhasDe(res).map((ws) =>
    ws
      .filter((w) => w.c >= 30)
      .map((w) => {
        const a = naImagem(r, w.x0, w.y0);
        const b = naImagem(r, w.x1, w.y1);
        return { x0: a.x, y0: a.y, x1: b.x, y1: b.y, t: w.t };
      }),
  );
}

/** O texto da região fora das tabelas (ou a região inteira, sem grade): lido de uma vez, palavra por palavra. */
async function lerTextoSolto(
  par: Par,
  img: ImagemCinza,
  semLinhas: Uint8Array,
  tapar: { x0: number; y0: number; x1: number; y1: number }[],
  origem: { x: number; y: number },
  escala: { x: number; y: number },
  sinal?: AbortSignal,
): Promise<Trecho[]> {
  const { largura: w, altura: h } = img;
  const px = new Uint8Array(semLinhas);
  for (const t of tapar) {
    for (let y = Math.max(0, Math.floor(t.y0)); y < Math.min(h, Math.ceil(t.y1)); y++) {
      for (let x = Math.max(0, Math.floor(t.x0)); x < Math.min(w, Math.ceil(t.x1)); x++)
        px[y * w + x] = 255;
    }
  }
  let tinta = 0;
  for (let i = 0; i < px.length; i++) if (px[i]! < 128) tinta++;
  if (tinta < Math.max(200, 0.001 * px.length)) return [];
  const res = await reconhecer(par, "por", { largura: w, altura: h, px }, "3", sinal);
  const trechos: Trecho[] = [];
  for (const ws of linhasDe(res)) {
    for (const p of ws) {
      if (p.c < 40) continue;
      trechos.push({
        x0: origem.x + p.x0 / escala.x,
        x1: origem.x + p.x1 / escala.x,
        y: origem.y + p.y1 / escala.y,
        altura: (p.y1 - p.y0) / escala.y,
        texto: limparLeitura(p.t),
      });
    }
  }
  return trechos.filter((t) => t.texto !== "");
}

/**
 * O que saiu de cada região: os pedaços de texto e os traços dela, em pontos da página. Cada região é
 * montada à PARTE (`montarPagina` só com ela) e entra na página pela altura: misturada com o resto, a
 * moldura que o PDF desenha em volta da página inteira virava uma grade gigante, e toda a tabela lida
 * caía numa célula só dela (o PDF do usuário, 23/11/2026).
 */
export type LidoNasImagens = {
  regioes: { y: number; trechos: Trecho[]; tracos: Tracos }[];
  incertas: number;
};

/** Coluna com ao menos esta fração de números: a célula curta que não é número ali é suspeita. */
const COLUNA_DE_NUMEROS = 0.8;

/**
 * Lê as regiões de imagem de uma página: a grade de cada uma, as células (em paralelo, nos pares de
 * leitores) e o texto solto em volta. `progresso` vai de 0 a 1 nesta página.
 */
export async function lerRegioes(
  pagina: PaginaParaDesenhar,
  regioes: RegiaoParaLer[],
  leitores: Leitores,
  ao: { sinal?: AbortSignal; progresso: (fracao: number) => void },
): Promise<LidoNasImagens> {
  const saida: LidoNasImagens = { regioes: [], incertas: 0 };
  for (const [ri, regiao] of regioes.entries()) {
    const trechos: Trecho[] = [];
    pararSeCancelado(ao.sinal);
    const escala = { x: regiao.pxPorPt, y: regiao.pxPorPtY };
    const origem = { x: regiao.x0, y: regiao.y0 };
    const img = await desenharRegiao(pagina, regiao);
    await respirar();
    const linhas = linhasDaImagem(img, Math.min(escala.x, escala.y));
    await respirar();

    // 1. As faixas escuras: lidas inteiras, decidem por onde as verticais passam.
    const extras: Horizontal[] = [];
    for (const f of faixasDaImagem(linhas.horizontais)) {
      const lidas = await lerFaixa(leitores.pares[0]!, linhas.semLinhas, img.largura, f, ao.sinal);
      extras.push(...atravessarFaixa(f, lidas, linhas.verticais));
    }
    const daRegiao = tracosEmPontos(
      [...linhas.horizontais, ...extras],
      linhas.verticais,
      escala,
      origem,
    );

    // 2. As células de cada tabela (as mescladas, como um bloco só).
    const grades = acharGrades(daRegiao);
    const pxX = (v: number) => (v - origem.x) * escala.x;
    const pxY = (v: number) => (v - origem.y) * escala.y;
    const alturas = grades.flatMap((g) => g.ys.slice(1).map((y, i) => (y - g.ys[i]!) * escala.y));
    const alturaComum = alturas.sort((a, b) => a - b)[Math.floor(alturas.length / 2)] ?? 30;
    type Tarefa = { grade: number; coluna: number; miolo: Miolo };
    const tarefas: Tarefa[] = [];
    const tapar: { x0: number; y0: number; x1: number; y1: number }[] = [];
    grades.forEach((g, gi) => {
      tapar.push({
        x0: pxX(g.xs[0]!),
        y0: pxY(g.ys[0]!),
        x1: pxX(g.xs[g.xs.length - 1]!),
        y1: pxY(g.ys[g.ys.length - 1]!),
      });
      for (const reg of g.regioes) {
        const miolo = mioloDaCelula(
          img,
          linhas.semLinhas,
          pxX(g.xs[reg.coluna]!),
          pxY(g.ys[reg.linha]!),
          pxX(g.xs[reg.coluna + reg.colunas]!),
          pxY(g.ys[reg.linha + reg.linhas]!),
        );
        if (miolo) tarefas.push({ grade: gi, coluna: reg.coluna, miolo });
      }
    });
    const lidas: CelulaLida[] = new Array(tarefas.length);
    let proxima = 0;
    let feitas = 0;
    await Promise.all(
      leitores.pares.map(async (par) => {
        const ler = leitorDo(par, ao.sinal);
        for (let i = proxima++; i < tarefas.length; i = proxima++) {
          pararSeCancelado(ao.sinal);
          const t = tarefas[i]!;
          const umaLinha = t.miolo.y1 - t.miolo.y0 <= 1.6 * alturaComum;
          lidas[i] = await lerCelula(linhas.semLinhas, img.largura, t.miolo, umaLinha, ler, valido);
          feitas++;
          ao.progresso((ri + (0.95 * feitas) / tarefas.length) / regioes.length);
        }
      }),
    );

    // 3. Pela coluna: acento e "_" iguais em toda a coluna.
    const porColuna = new Map<string, number[]>();
    tarefas.forEach((t, i) => {
      const chave = `${t.grade}-${t.coluna}`;
      const lista = porColuna.get(chave);
      if (lista) lista.push(i);
      else porColuna.set(chave, [i]);
    });
    const textos: string[] = lidas.map((l) => l.numero ?? l.texto);
    const suspeitas = new Set<number>();
    for (const indices of porColuna.values()) {
      const trocas = consensoDaColuna(
        indices.filter((i) => !lidas[i]!.numero).map((i) => textos[i]!),
      );
      for (const i of indices) {
        const novo = lidas[i]!.numero ? undefined : trocas.get(textos[i]!);
        if (novo) textos[i] = novo;
      }
      // Numa coluna de números, a leitura curta que não é número nem traço ("jo)" no lugar de "0")
      // fica marcada. O título da coluna e o "Total 1" têm mais letras e passam.
      const cheias = indices.filter((i) => textos[i]);
      const numeros = cheias.filter((i) => lidas[i]!.numero).length;
      if (cheias.length >= 3 && numeros >= COLUNA_DE_NUMEROS * cheias.length) {
        for (const i of cheias) {
          const t = textos[i]!;
          if (!lidas[i]!.numero && t !== "-" && !t.endsWith("?") && letrasEm(t) <= 2) {
            suspeitas.add(i);
          }
        }
      }
    }

    // 4. Cada célula vira um pedaço de texto no meio dela: `tabelas.ts` a põe na célula certa.
    tarefas.forEach((t, i) => {
      const l = lidas[i]!;
      let texto = textos[i]!;
      if (l.incerta || suspeitas.has(i)) {
        saida.incertas++;
        // A leitura duvidosa fica visível ("43,2?") e não vira número que entra numa soma.
        if (texto && !texto.endsWith("?")) texto = `${texto}?`;
      }
      if (!texto) return;
      const m = t.miolo;
      const altura = Math.min(8, ((m.y1 - m.y0) / escala.y) * 0.6);
      const cx = origem.x + (m.x0 + m.x1) / 2 / escala.x;
      const cy = origem.y + (m.y0 + m.y1) / 2 / escala.y;
      trechos.push({ x0: cx - 0.5, x1: cx + 0.5, y: cy + 0.3 * altura, altura, texto });
    });

    // 5. O texto fora das tabelas (ou tudo, se não há grade): lido de uma vez.
    trechos.push(
      ...(await lerTextoSolto(
        leitores.pares[0]!,
        img,
        linhas.semLinhas,
        tapar,
        origem,
        escala,
        ao.sinal,
      )),
    );
    if (trechos.length > 0) saida.regioes.push({ y: regiao.y0, trechos, tracos: daRegiao });
    ao.progresso((ri + 1) / regioes.length);
  }
  return saida;
}
