import {
  beginText,
  endText,
  PDFHexString,
  PDFName,
  popGraphicsState,
  pushGraphicsState,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  type PDFDocument,
  type PDFOperator,
  type PDFRef,
} from "pdf-lib";
import type { Bbox, RecognizeResult, Scheduler } from "tesseract.js";
import {
  ErroDeConversao,
  type AoExecutar,
  type IdiomaDoOcr,
  type OpcoesDoBloco,
  type Resultado,
} from "../tipos";
import { ateCancelar, blobDe, liberarCanvas, nomeBase, pararSeCancelado } from "./arquivos";
import { carregar } from "./pdf";
import { abrirNoPdfjs } from "./pdfjs";

/*
 * OCR: o PDF escaneado vira pesquisável (11/11/2026), no navegador e no app, sem o arquivo sair
 * do computador. O Tesseract (`tesseract.js`, Apache-2.0) lê cada página e as palavras entram
 * como TEXTO INVISÍVEL por cima da imagem original — que não é regravada, então a qualidade fica
 * igual. Dá para buscar, selecionar e copiar.
 *
 * - O Tesseract é servido pelo nosso domínio, de `public/tesseract/` (copiado por
 *   `scripts/copiar-tesseract.mjs`): nada de CDN. O padrão dele seria baixar o motor e o idioma
 *   de um CDN; por isso os três caminhos vão explícitos. O idioma fica guardado no navegador
 *   depois da primeira vez.
 * - A página que já tem texto fica como está; a página em branco é pulada.
 * - A página é desenhada a ~300 dpi (com teto de pixels); a caixa de cada palavra volta para o
 *   sistema de coordenadas do PDF pelo próprio pdf.js (`convertToPdfPoint`), que cuida do giro e
 *   da margem da página.
 *
 * Desde 12/11/2026:
 * - **Vários leitores em paralelo** (de 1 a 4, pelos núcleos e pela memória do computador), uma
 *   página em cada: 2 a 3 vezes mais rápido num PC comum. Por isso o teto subiu para 100 páginas.
 * - **Página torta ou de lado.** O Tesseract endireita a inclinação pequena (`rotateAuto`) e a
 *   caixa de cada palavra é desgirada de volta. Página lida com confiança baixa é testada nos
 *   quatro giros, numa imagem menor, e relida no giro que leu melhor (a página escaneada de lado
 *   ou de cabeça para baixo).
 * - **Qualquer letra.** O texto invisível usa uma fonte Type3 de letras VAZIAS com um mapa
 *   Unicode (`ToUnicode`), a mesma ideia da "GlyphLessFont" do próprio Tesseract: como nada é
 *   desenhado, a fonte só precisa dizer qual letra é cada código. Acabou o "?" dos símbolos que a
 *   Helvetica não tinha, e não há programa de fonte embutido para dar problema em leitor nenhum.
 * - **Inglês**, como opção (a etapa "idioma"), e o resumo aponta as páginas difíceis de ler.
 */

/** Acima disto, a espera passa do razoável mesmo com vários leitores. */
export const MAXIMO_DE_PAGINAS_NO_OCR = 100;
/** ~300 dpi: o que o Tesseract pede para ler bem texto de documento. */
const DPI_DO_OCR = 300;
/** Teto do lado maior da imagem (um A4 a 300 dpi tem ~3500 px). */
const LADO_MAXIMO = 4200;
/** Lado maior da imagem menor com que se testam os quatro giros. */
const LADO_DO_TESTE_DE_GIRO = 1600;
/** Página com menos letras que isto conta como escaneada (um carimbo ou um número de página não a faz "ter texto"). */
const LETRAS_PARA_TER_TEXTO = 20;
/** Palavra com confiança abaixo disto é ruído (borda, desenho, sujeira da digitalização). */
const CONFIANCA_MINIMA = 30;
/** Página lida com confiança média abaixo disto é testada nos outros giros. */
const CONFIANCA_PARA_TESTAR_GIROS = 55;
/** O outro giro só vence se ler claramente melhor (pontos de confiança a mais, na imagem menor). */
const VANTAGEM_DO_GIRO = 15;
/** Página com confiança média abaixo disto entra no aviso "difíceis de ler". */
const CONFIANCA_DE_AVISO = 70;
/** Fração de pixels escuros abaixo da qual a página está em branco (um ponto de sujeira não conta). */
const TINTA_MINIMA = 0.0005;
/** Largura de cada letra da fonte invisível, com a fonte em tamanho 1 (`Widths` 500 com `FontMatrix` 0,001). */
const LARGURA_DA_LETRA = 0.5;
/**
 * Prazo para um leitor abrir (motor e idioma baixados na primeira vez, numa rede lenta). Passou
 * disto, não vai abrir: com o arquivo do idioma faltando, o tesseract.js fica parado em vez de
 * falhar (visto em 12/11/2026), e a pessoa esperaria para sempre.
 */
const PRAZO_PARA_ABRIR_MS = 120_000;

/** A promessa, ou o erro de `erro()` se ela passar de `ms`. */
function comPrazo<T>(promessa: Promise<T>, ms: number, erro: () => Error): Promise<T> {
  return new Promise((ok, falha) => {
    const relogio = setTimeout(() => falha(erro()), ms);
    promessa.then(
      (v) => {
        clearTimeout(relogio);
        ok(v);
      },
      (e: unknown) => {
        clearTimeout(relogio);
        falha(e);
      },
    );
  });
}

type Visualizacao = {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
};

type PaginaDoPdfjs = {
  rotate: number;
  getViewport(o: { scale: number; rotation?: number }): Visualizacao;
  render(o: { canvas: HTMLCanvasElement; viewport: Visualizacao }): { promise: Promise<void> };
  cleanup(): void;
};

/** Uma palavra pronta para escrever: o texto e a matriz que a põe na caixa dela, no PDF. */
type PalavraNoPdf = { texto: string; matriz: number[] };

type PaginaLida = {
  n: number;
  palavras: PalavraNoPdf[];
  confianca: number;
  branca: boolean;
};

/** Quantas letras a página já tem como texto de verdade. */
async function letrasDaPagina(pagina: {
  getTextContent(): Promise<{ items: unknown[] }>;
}): Promise<number> {
  const conteudo = await pagina.getTextContent();
  let letras = 0;
  for (const item of conteudo.items) {
    const str = (item as { str?: string }).str;
    if (str) letras += str.replace(/\s/g, "").length;
  }
  return letras;
}

/** Quantos leitores em paralelo: metade dos núcleos, até 4, menos se a memória for pouca. */
function quantosLeitores(paginas: number): number {
  const nucleos = navigator.hardwareConcurrency || 2;
  // `deviceMemory` (GB) só existe no Chromium, que é o Chrome, o Edge e o app de mesa.
  const memoria = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  const pelaMemoria = memoria <= 4 ? 2 : 4;
  return Math.max(1, Math.min(4, Math.floor(nucleos / 2), pelaMemoria, paginas));
}

/** Desenha a página num canvas branco, no giro pedido, a ~300 dpi ou até `ladoMaximo`. */
async function desenhar(
  pagina: PaginaDoPdfjs,
  giro: number,
  ladoMaximo: number,
): Promise<{ canvas: HTMLCanvasElement; vista: Visualizacao }> {
  const rotacao = (pagina.rotate + giro) % 360;
  const natural = pagina.getViewport({ scale: 1, rotation: rotacao });
  const escala = Math.min(DPI_DO_OCR / 72, ladoMaximo / Math.max(natural.width, natural.height));
  const vista = pagina.getViewport({ scale: escala, rotation: rotacao });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(vista.width));
  canvas.height = Math.max(1, Math.ceil(vista.height));
  // Fundo branco: o vazio transparente atrapalharia a leitura.
  const c = canvas.getContext("2d");
  if (c) {
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, canvas.width, canvas.height);
  }
  await pagina.render({ canvas, viewport: vista }).promise;
  return { canvas, vista };
}

/**
 * A página está em branco? Conta os pixels escuros numa linha a cada seis, sem reduzir a
 * imagem (reduzida, a letra miúda viraria cinza-claro e a página de texto pareceria vazia).
 */
function quaseSemTinta(canvas: HTMLCanvasElement): boolean {
  const c = canvas.getContext("2d", { willReadFrequently: true });
  if (!c) return false;
  let escuros = 0;
  let vistos = 0;
  for (let y = 0; y < canvas.height; y += 6) {
    const { data } = c.getImageData(0, y, canvas.width, 1);
    for (let i = 0; i < data.length; i += 8) {
      const luz = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      if (luz < 140) escuros++;
      vistos++;
    }
  }
  return vistos > 0 && escuros / vistos < TINTA_MINIMA;
}

/**
 * Desfaz o endireitamento do Tesseract: com `rotateAuto`, ele gira a imagem em volta do centro,
 * mantendo o tamanho, e as caixas voltam no sistema da imagem girada. Aqui o ponto volta para a
 * imagem que foi desenhada. (O sentido foi conferido no teste de 12/11/2026, com uma página
 * desenhada torta 3°: o sentido contrário deixava a palavra 38 pontos fora do lugar.)
 */
function desgirar(x: number, y: number, largura: number, altura: number, angulo: number) {
  if (!angulo) return [x, y] as const;
  const cx = largura / 2;
  const cy = altura / 2;
  const cos = Math.cos(angulo);
  const sen = Math.sin(angulo);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cos + dy * sen, cy - dx * sen + dy * cos] as const;
}

/**
 * A matriz de texto que põe a palavra exatamente na caixa dela (com a fonte em tamanho 1): o eixo
 * x segue a linha de base e estica até a largura da caixa; o y sobe na altura dela. Funciona com a
 * página girada e com a inclinação desfeita, porque os três cantos vêm já em coordenadas do PDF.
 */
function matrizDaPalavra(
  paraOPdf: (x: number, y: number) => number[],
  caixa: Bbox,
  larguraNatural: number,
): number[] | null {
  const [ax = 0, ay = 0] = paraOPdf(caixa.x0, caixa.y1);
  const [bx = 0, by = 0] = paraOPdf(caixa.x1, caixa.y1);
  const [cx = 0, cy = 0] = paraOPdf(caixa.x0, caixa.y0);
  const largura = Math.hypot(bx - ax, by - ay);
  const altura = Math.hypot(cx - ax, cy - ay);
  if (largura < 0.5 || altura < 0.5 || larguraNatural <= 0) return null;
  const esticar = largura / larguraNatural;
  const tamanho = altura * 0.9; // a caixa inclui acentos e pernas das letras
  return [
    ((bx - ax) / largura) * esticar,
    ((by - ay) / largura) * esticar,
    ((cx - ax) / altura) * tamanho,
    ((cy - ay) / altura) * tamanho,
    ax,
    ay,
  ];
}

/** As palavras lidas, com a confiança mínima, já com a matriz no PDF. */
function palavrasDoResultado(
  resultado: RecognizeResult,
  vista: Visualizacao,
  largura: number,
  altura: number,
): PalavraNoPdf[] {
  const angulo = resultado.data.rotateRadians ?? 0;
  const paraOPdf = (x: number, y: number) => {
    const [px, py] = desgirar(x, y, largura, altura, angulo);
    return vista.convertToPdfPoint(px, py);
  };
  const palavras: PalavraNoPdf[] = [];
  for (const bloco of resultado.data.blocks ?? []) {
    for (const p of bloco.paragraphs) {
      for (const l of p.lines) {
        for (const w of l.words) {
          const texto = w.text.trim().normalize("NFC");
          if (w.confidence < CONFIANCA_MINIMA || texto === "") continue;
          const letras = [...texto].length;
          const matriz = matrizDaPalavra(paraOPdf, w.bbox, letras * LARGURA_DA_LETRA);
          if (matriz) palavras.push({ texto, matriz });
        }
      }
    }
  }
  return palavras;
}

/* ------------------------- A fonte de letras vazias ------------------------- */

/** "A" → "0041"; letra fora do plano básico vai como par de substitutos ("D83DDE00"). */
function emUtf16(letra: string): string {
  let hex = "";
  for (let i = 0; i < letra.length; i++) {
    hex += letra.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  }
  return hex;
}

/** O mapa código → Unicode que deixa buscar e copiar o texto. */
function mapaUnicode(codigos: Map<string, number>): string {
  const linhas = [...codigos].map(
    ([letra, codigo]) =>
      `<${codigo.toString(16).padStart(2, "0").toUpperCase()}> <${emUtf16(letra)}>`,
  );
  const blocos: string[] = [];
  for (let i = 0; i < linhas.length; i += 100) {
    const parte = linhas.slice(i, i + 100);
    blocos.push(`${parte.length} beginbfchar\n${parte.join("\n")}\nendbfchar`);
  }
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<00> <FF>",
    "endcodespacerange",
    ...blocos,
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
}

/**
 * A fonte Type3 do texto invisível: um código (1 a 255) por letra usada no documento, todas
 * com o mesmo desenho VAZIO e a mesma largura. Letra além da 255ª (documento com mais de 255
 * letras diferentes) sai como "?". Exportada para o teste, como `textoInvisivel`.
 */
export function fonteDeLetrasVazias(
  doc: PDFDocument,
  letras: Set<string>,
): { ref: PDFRef; codigos: Map<string, number> } {
  const codigos = new Map<string, number>([["?", 1]]);
  for (const letra of letras) {
    if (codigos.size >= 255) break;
    if (!codigos.has(letra)) codigos.set(letra, codigos.size + 1);
  }
  const ctx = doc.context;
  // Um desenho só, que não pinta nada: "d0" diz a largura (500 milésimos) e mais nada.
  const vazio = ctx.register(ctx.stream("500 0 d0"));
  const nomes = [...codigos.values()].map((c) => `g${c}`);
  const desenhos = ctx.obj({});
  for (const nome of nomes) desenhos.set(PDFName.of(nome), vazio);
  const fonte = ctx.obj({
    Type: "Font",
    Subtype: "Type3",
    FontBBox: [0, -200, 500, 800],
    FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    CharProcs: desenhos,
    Encoding: ctx.obj({ Type: "Encoding", Differences: [1, ...nomes] }),
    FirstChar: 1,
    LastChar: codigos.size,
    Widths: nomes.map(() => 500),
    Resources: ctx.obj({}),
    ToUnicode: ctx.register(ctx.flateStream(mapaUnicode(codigos))),
  });
  return { ref: ctx.register(fonte), codigos };
}

/** Os operadores do texto invisível de uma página. */
export function textoInvisivel(
  palavras: PalavraNoPdf[],
  codigos: Map<string, number>,
  chaveDaFonte: Parameters<typeof setFontAndSize>[0],
): PDFOperator[] {
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    beginText(),
    setFontAndSize(chaveDaFonte, 1),
    setTextRenderingMode(TextRenderingMode.Invisible),
  ];
  for (const { texto, matriz } of palavras) {
    const hex = [...texto].map((l) => (codigos.get(l) ?? 1).toString(16).padStart(2, "0")).join("");
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = matriz;
    ops.push(setTextMatrix(a, b, c, d, e, f), showText(PDFHexString.of(hex)));
  }
  ops.push(endText(), popGraphicsState());
  return ops;
}

/* ---------------------------------- OCR ---------------------------------- */

function listaDePaginas(numeros: number[]): string {
  if (numeros.length === 1) return `a página ${numeros[0]}`;
  const ultimos = numeros.slice(-1);
  return `as páginas ${numeros.slice(0, -1).join(", ")} e ${ultimos[0]}`;
}

export async function ocrNoPdf(
  arquivos: File[],
  opcoes: OpcoesDoBloco,
  ao: AoExecutar,
): Promise<Resultado> {
  const arquivo = arquivos[0]!;
  const idioma: IdiomaDoOcr = opcoes.idiomaDoOcr ?? "por";
  // O pdf-lib escreve o resultado; ele mesmo recusa o que não é PDF e o PDF protegido.
  const saida = await carregar(arquivo);
  pararSeCancelado(ao.sinal);
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const leitura = await abrirNoPdfjs(bytes, arquivo.name);
  let agenda: Scheduler | null = null;
  const cancelar = () => void agenda?.terminate();
  ao.sinal?.addEventListener("abort", cancelar, { once: true });
  try {
    const total = leitura.numPages;
    if (total > MAXIMO_DE_PAGINAS_NO_OCR) {
      throw new ErroDeConversao(
        `“${arquivo.name}” tem ${total} páginas. O OCR aceita até ${MAXIMO_DE_PAGINAS_NO_OCR}: separe as páginas antes.`,
        "MUITAS_PAGINAS",
      );
    }
    // Quais páginas precisam: as que não têm texto de verdade.
    const escaneadas: number[] = [];
    for (let n = 1; n <= total; n++) {
      const pagina = await leitura.getPage(n);
      if ((await letrasDaPagina(pagina)) < LETRAS_PARA_TER_TEXTO) escaneadas.push(n);
      pagina.cleanup();
    }
    if (escaneadas.length === 0) {
      throw new ErroDeConversao(
        `“${arquivo.name}” já tem texto pesquisável: não precisa de OCR.`,
        "JA_TEM_TEXTO",
      );
    }

    // O andamento de cada página em leitura (vários leitores ao mesmo tempo).
    const emLeitura = new Map<string, number>();
    let feitas = 0;
    const andar = () => {
      let parcial = 0;
      for (const f of emLeitura.values()) parcial += f;
      ao.progresso(
        0.1 + (0.88 * Math.min(escaneadas.length, feitas + parcial)) / escaneadas.length,
      );
    };

    const { createScheduler, createWorker, OEM } = await import("tesseract.js");
    ao.progresso(0.02);
    let desistiu = false;
    const criarLeitor = () => {
      const criando = createWorker(idioma === "por+eng" ? ["por", "eng"] : "por", OEM.LSTM_ONLY, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/core",
        langPath: "/tesseract/lang",
        gzip: true,
        workerBlobURL: false,
        logger: (m: { status: string; progress: number; userJobId?: string }) => {
          if (m.status !== "recognizing text" || !m.userJobId?.startsWith("pagina-")) return;
          emLeitura.set(m.userJobId, m.progress);
          andar();
        },
      });
      // Cancelado (ou desistido) enquanto o Tesseract carregava: ele termina de abrir sozinho, e é
      // encerrado ali.
      criando.then(
        (w) => {
          if (ao.sinal?.aborted || desistiu) void w.terminate();
        },
        () => {},
      );
      const noPrazo = comPrazo(criando, PRAZO_PARA_ABRIR_MS, () => {
        desistiu = true;
        return new ErroDeConversao(
          "O leitor de OCR não abriu. Recarregue a página e tente de novo.",
          "OCR_NAO_ABRIU",
        );
      });
      return ateCancelar(noPrazo, ao.sinal);
    };
    agenda = createScheduler();
    const leitores = quantosLeitores(escaneadas.length);
    // O primeiro baixa o idioma e o guarda no navegador; os outros já o acham guardado.
    agenda.addWorker(await criarLeitor());
    for (const w of await Promise.all(Array.from({ length: leitores - 1 }, criarLeitor))) {
      agenda.addWorker(w);
    }
    ao.progresso(0.1);
    const ler = (
      canvas: HTMLCanvasElement,
      id: string,
      endireitar: boolean,
      comPalavras: boolean,
    ) =>
      // O Tesseract encerrado no meio (cancelar) não avisa a leitura pendente: quem desiste é a espera.
      ateCancelar(
        agenda!.addJob(
          "recognize",
          canvas,
          { rotateAuto: endireitar },
          { blocks: comPalavras },
          id,
        ),
        ao.sinal,
      );

    /** A página de lado ou de cabeça para baixo: o giro que lê melhor, numa imagem menor. 0 = como está. */
    const melhorGiro = async (pagina: PaginaDoPdfjs, n: number): Promise<number> => {
      const notas: { giro: number; nota: number }[] = [];
      for (const giro of [0, 90, 180, 270]) {
        const { canvas } = await desenhar(pagina, giro, LADO_DO_TESTE_DE_GIRO);
        try {
          const r = await ler(canvas, `giro-${n}-${giro}`, false, false);
          notas.push({ giro, nota: r.data.confidence });
        } finally {
          liberarCanvas(canvas);
        }
      }
      const comoEsta = notas[0]!.nota;
      const melhor = notas.reduce((a, b) => (b.nota > a.nota ? b : a));
      return melhor.nota >= comoEsta + VANTAGEM_DO_GIRO ? melhor.giro : 0;
    };

    const lerPagina = async (n: number): Promise<PaginaLida> => {
      const pagina = (await leitura.getPage(n)) as unknown as PaginaDoPdfjs;
      try {
        const lerNoGiro = async (giro: number) => {
          const { canvas, vista } = await desenhar(pagina, giro, LADO_MAXIMO);
          try {
            if (giro === 0 && quaseSemTinta(canvas)) return null;
            const r = await ler(canvas, `pagina-${n}`, true, true);
            return {
              palavras: palavrasDoResultado(r, vista, canvas.width, canvas.height),
              confianca: r.data.confidence,
            };
          } finally {
            liberarCanvas(canvas);
          }
        };
        let lida = await lerNoGiro(0);
        if (!lida) return { n, palavras: [], confianca: 100, branca: true };
        if (lida.confianca < CONFIANCA_PARA_TESTAR_GIROS) {
          const giro = await melhorGiro(pagina, n);
          if (giro !== 0) {
            const outra = await lerNoGiro(giro);
            if (outra && outra.confianca > lida.confianca) lida = outra;
          }
        }
        return { n, ...lida, branca: false };
      } finally {
        pagina.cleanup();
      }
    };

    // Uma fila, com tantos "trabalhadores" quanto leitores: cada um desenha a próxima página e
    // a entrega à agenda do Tesseract, que a passa ao leitor livre.
    const fila = [...escaneadas];
    const lidas: PaginaLida[] = [];
    const trabalhar = async () => {
      for (let n = fila.shift(); n !== undefined; n = fila.shift()) {
        pararSeCancelado(ao.sinal);
        lidas.push(await lerPagina(n));
        emLeitura.delete(`pagina-${n}`);
        feitas++;
        andar();
      }
    };
    await Promise.all(Array.from({ length: leitores }, trabalhar));

    // Uma fonte só, com as letras de todas as páginas.
    const letras = new Set<string>();
    for (const p of lidas) for (const w of p.palavras) for (const l of w.texto) letras.add(l);
    const fonte = fonteDeLetrasVazias(saida, letras);
    for (const p of lidas) {
      if (p.palavras.length === 0) continue;
      const paginaDeSaida = saida.getPage(p.n - 1);
      const chave = paginaDeSaida.node.newFontDictionary("OCR", fonte.ref);
      paginaDeSaida.pushOperators(...textoInvisivel(p.palavras, fonte.codigos, chave));
    }

    const pronto = await saida.save({ useObjectStreams: true });
    ao.progresso(1);

    const brancas = lidas.filter((p) => p.branca).length;
    const dificeis = lidas
      .filter((p) => !p.branca && (p.palavras.length === 0 || p.confianca < CONFIANCA_DE_AVISO))
      .map((p) => p.n)
      .sort((a, b) => a - b);
    const lidasDeFato = escaneadas.length - brancas;
    const partes = [
      escaneadas.length === total
        ? `${lidasDeFato} ${lidasDeFato === 1 ? "página lida" : "páginas lidas"}`
        : `${lidasDeFato} de ${total} páginas lidas; as outras já tinham texto`,
    ];
    if (brancas > 0) partes.push(`${brancas} em branco`);
    if (dificeis.length > 0) partes.push(`confira ${listaDePaginas(dificeis)}, difíceis de ler`);
    return {
      arquivos: [
        {
          nome: `${nomeBase(arquivo.name)}-pesquisavel.pdf`,
          blob: blobDe(pronto, "application/pdf"),
        },
      ],
      resumo: partes.join(" · "),
    };
  } finally {
    ao.sinal?.removeEventListener("abort", cancelar);
    void agenda?.terminate();
    void leitura.loadingTask.destroy();
  }
}
