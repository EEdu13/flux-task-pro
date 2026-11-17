import {
  degrees,
  PDFArray,
  PDFName,
  PDFStream,
  rgb,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  analisarConteudo,
  glifosNaRegiao,
  larguraDosTrechos,
  reescreverConteudo,
  type AnaliseDoConteudo,
  type Glifo,
  type Regiao,
  type Trecho,
  type TrocaNoConteudo,
} from "./conteudo";
import {
  bytesDoStream,
  cabeNaFontePadrao,
  fontePadraoParecida,
  leitorDeFontes,
  type CacheDeFontes,
  type InfoDaFonte,
} from "./fontes";

/*
 * Trocar o que está escrito numa página do PDF (05/11/2026).
 *
 * Primeiro tenta o certo: tirar as letras antigas do conteúdo e escrever as novas
 * com a mesma fonte, no mesmo lugar. A letra que a fonte do PDF não traz (fonte
 * embutida costuma vir cortada, só com o que o documento usa) sai numa fonte padrão
 * parecida. Nada é tampado. O conteúdo antigo sai do arquivo ao salvar, quando
 * `aplicar.ts` tira os objetos que ninguém mais usa.
 *
 * Quando isso não dá, a linha é COBERTA: um retângulo da cor do fundo e o texto novo
 * por cima. Acontece com o texto de fonte desconhecida (Type3), o que está dentro de
 * um bloco reaproveitado (Form XObject) e a camada invisível de um PDF escaneado. Aí
 * o texto antigo continua no arquivo por baixo, e a tela avisa isso (`cobertas`).
 */

/** Cor em 0..1. */
export type Rgb = { r: number; g: number; b: number };

export type EdicaoDeLinha = {
  regiao: Regiao;
  /** O texto que a linha tinha: serve para conferir se as letras achadas são mesmo as dela. */
  textoOriginal: string;
  texto: string;
  /** Em fração do corpo, acima e abaixo da linha de base. É a altura do que é coberto. */
  ascendente: number;
  descendente: number;
  familia: "sans" | "serif" | "mono";
  negrito: boolean;
  italico: boolean;
  /** Lidos da página desenhada. Só valem quando a linha precisa ser coberta. */
  corDeFundo: Rgb;
  corDoTexto: Rgb;
};

export type ResumoDaTroca = {
  /** Trocadas de verdade: o texto antigo saiu do arquivo. */
  noLugar: number;
  /** Cobertas: o texto antigo continua no arquivo, por baixo. */
  cobertas: number;
  /** Quantas letras saíram numa fonte parecida, por não existirem na fonte do PDF. */
  letrasEmOutraFonte: number;
  /** Letras que nenhuma fonte disponível escreve. Saem como "?". */
  semSuporte: string[];
};

/** Os códigos que o documento usa, por fonte (`InfoDaFonte.chave`). */
export type CodigosUsados = Map<string, Set<number>>;

export function conteudoDaPagina(pagina: PDFPage): Uint8Array {
  const c = pagina.node.Contents();
  const streams: PDFStream[] = [];
  if (c instanceof PDFStream) streams.push(c);
  else if (c instanceof PDFArray) {
    for (let i = 0; i < c.size(); i++) {
      const s = c.lookup(i);
      if (s instanceof PDFStream) streams.push(s);
    }
  }
  const partes = streams.map(bytesDoStream);
  // A norma diz que os pedaços se leem como um só, com um branco entre eles.
  const total = partes.reduce((s, p) => s + p.length + 1, 0);
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    saida.set(p, pos);
    pos += p.length;
    saida[pos++] = 10;
  }
  return saida;
}

export function fontesDaPagina(pagina: PDFPage, cache: CacheDeFontes) {
  return leitorDeFontes(pagina.node.Resources(), cache);
}

/** A análise de uma página. `null` se o conteúdo não puder ser lido (filtro desconhecido). */
export function analisarPagina(
  pagina: PDFPage,
  cache: CacheDeFontes,
): { analise: AnaliseDoConteudo; bytes: Uint8Array } | null {
  try {
    const bytes = conteudoDaPagina(pagina);
    return { analise: analisarConteudo(bytes, fontesDaPagina(pagina, cache)), bytes };
  } catch (e) {
    console.warn("[editor de PDF] não consegui ler o conteúdo da página", e);
    return null;
  }
}

/** Soma os códigos que a página usa, por fonte. */
export function somarCodigosUsados(
  pagina: PDFPage,
  cache: CacheDeFontes,
  usados: CodigosUsados,
): void {
  const lida = analisarPagina(pagina, cache);
  if (!lida) return;
  const fonteDe = fontesDaPagina(pagina, cache);
  for (const op of lida.analise.ops) {
    const f = fonteDe(op.fonte);
    if (!f) continue;
    let lista = usados.get(f.chave);
    if (!lista) {
      lista = new Set();
      usados.set(f.chave, lista);
    }
    for (const el of op.elementos) if (typeof el !== "number") lista.add(el.codigo);
  }
}

/* ------------------------------ Texto → trechos ------------------------------- */

const MAIOR_LIGADURA = 3;

/** A largura de um espaço quando a fonte não tem o caractere: um quarto do corpo. */
const LARGURA_DO_ESPACO_VAZIO = 250;

type Escrita = {
  trechos: Trecho[];
  letrasEmOutraFonte: number;
  semSuporte: string[];
};

function codigoPermitido(
  fonte: InfoDaFonte,
  codigos: readonly number[] | undefined,
  usados: ReadonlySet<number> | undefined,
): number | undefined {
  if (!codigos) return undefined;
  /* Largura zero: ou a letra não existe na fonte, ou ela não anda e fica em cima da seguinte. */
  const servem = codigos.filter((c) => fonte.largura(c) > 0);
  if (fonte.completa) return servem[0];
  return usados ? servem.find((c) => usados.has(c)) : undefined;
}

/**
 * Parte o texto em trechos: o que a fonte original escreve e o que precisa de outra.
 * `outraFonte` é pedida só se alguma letra precisar — embutir fonte pesa no arquivo.
 */
async function escrever(
  texto: string,
  fonte: InfoDaFonte,
  usados: ReadonlySet<number> | undefined,
  outraFonte: () => Promise<{ fonte: PDFFont; nome: string }>,
): Promise<Escrita> {
  const letras = Array.from(texto.normalize("NFC").replace(/[\t\r\n]+/g, " "));
  const trechos: Trecho[] = [];
  let letrasEmOutraFonte = 0;
  const semSuporte: string[] = [];

  const naMesma = (codigo: number) => {
    const ultimo = trechos[trechos.length - 1];
    if (ultimo?.tipo === "mesma-fonte") {
      ultimo.codigos.push(codigo);
      ultimo.larguras.push(fonte.largura(codigo));
    } else {
      trechos.push({
        tipo: "mesma-fonte",
        codigos: [codigo],
        larguras: [fonte.largura(codigo)],
        bytesPorCodigo: fonte.bytesPorCodigo,
      });
    }
  };

  const naOutra = async (ch: string) => {
    const o = await outraFonte();
    const hexa = o.fonte.encodeText(ch).asString();
    const largura = o.fonte.widthOfTextAtSize(ch, 1000);
    const ultimo = trechos[trechos.length - 1];
    if (ultimo?.tipo === "outra-fonte") {
      ultimo.hexa += hexa;
      ultimo.larguras.push(largura);
      if (ch === " ") ultimo.espacos++;
    } else {
      trechos.push({
        tipo: "outra-fonte",
        nomeDaFonte: o.nome,
        hexa,
        larguras: [largura],
        espacos: ch === " " ? 1 : 0,
      });
    }
  };

  for (let i = 0; i < letras.length;) {
    let achou = false;
    // A ligadura primeiro: "ti" e "fi" costumam existir só juntas nas fontes cortadas.
    for (let tam = Math.min(MAIOR_LIGADURA, letras.length - i); tam >= 1; tam--) {
      const pedaco = letras.slice(i, i + tam).join("");
      const codigo = codigoPermitido(fonte, fonte.codigosDe(pedaco), usados);
      if (codigo !== undefined) {
        naMesma(codigo);
        i += tam;
        achou = true;
        break;
      }
    }
    if (achou) continue;
    const ch = letras[i]!;
    i++;
    if (ch === " ") {
      trechos.push({ tipo: "vazio", largura: LARGURA_DO_ESPACO_VAZIO });
    } else if (cabeNaFontePadrao(ch)) {
      await naOutra(ch);
      letrasEmOutraFonte++;
    } else {
      semSuporte.push(ch);
      await naOutra("?");
    }
  }
  return { trechos, letrasEmOutraFonte, semSuporte };
}

/* ------------------------------- Aplicar na página ------------------------------ */

const PROPORCAO_MINIMA_DE_LETRAS = 0.6;

function contarLetras(s: string): number {
  return s.replace(/\s+/g, "").length;
}

const semBrancos = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");

/** A letra de partida entre as visíveis, ou `null` se o que foi achado não é confiável. */
function partidaConfiavel(
  glifos: readonly Glifo[],
  e: EdicaoDeLinha,
  fonteDe: (nome: string) => InfoDaFonte | null,
): Glifo | null {
  const visiveis = glifos.filter((g) => g.op.tr !== 3 && g.op.tr !== 7);
  if (visiveis.length !== glifos.length) return null;
  /* Menos letras do que a linha tem: parte dela está num lugar que o interpretador
     não vê (bloco reaproveitado, fonte desconhecida), e trocar deixaria a outra parte. */
  if (glifos.length < contarLetras(e.textoOriginal) * PROPORCAO_MINIMA_DE_LETRAS) return null;
  /* As letras achadas dizem o mesmo que a linha? Se não, a posição enganou: trocar
     apagaria outro texto e deixaria o da linha na tela. Melhor cobrir. */
  let lido = "";
  for (const g of glifos) {
    const letra = fonteDe(g.op.fonte)?.textoDe(g.codigo);
    if (letra === undefined) return visiveis[0] ?? null; // A fonte não diz: fica só a contagem.
    lido += letra;
  }
  if (semBrancos(lido) !== semBrancos(e.textoOriginal)) return null;
  return visiveis[0] ?? null;
}

function estaDesequilibrado(a: AnaliseDoConteudo): boolean {
  return a.profundidade > 0 || a.qDemais.length > 0;
}

function gravarConteudo(doc: PDFDocument, pagina: PDFPage, conteudo: Uint8Array): void {
  const ref = doc.context.register(doc.context.flateStream(conteudo));
  pagina.node.set(PDFName.of("Contents"), doc.context.obj([ref]));
}

/**
 * Antes de desenhar por cima: com `q` sem `Q` no conteúdo, o que o pdf-lib acrescenta
 * herdaria a matriz deixada aberta, e sairia em outro lugar e noutro tamanho.
 */
export function equilibrarConteudo(doc: PDFDocument, pagina: PDFPage, cache: CacheDeFontes): void {
  const lida = analisarPagina(pagina, cache);
  if (!lida || !estaDesequilibrado(lida.analise)) return;
  gravarConteudo(
    doc,
    pagina,
    reescreverConteudo(lida.bytes, lida.analise, [], fontesDaPagina(pagina, cache)),
  );
}

/**
 * Aplica as edições na página. Deve vir antes de qualquer outro desenho nela: o
 * conteúdo é substituído inteiro. `usadosDoRecurso` diz o que o documento original
 * usa de cada fonte, pelo nome dela nesta página: a página pode ser uma cópia, e aí
 * a identidade da fonte dentro do documento já é outra.
 */
export async function aplicarEdicoes(
  doc: PDFDocument,
  pagina: PDFPage,
  edicoes: readonly EdicaoDeLinha[],
  cache: CacheDeFontes,
  usadosDoRecurso: (nomeDoRecurso: string) => ReadonlySet<number> | undefined,
): Promise<ResumoDaTroca> {
  const resumo: ResumoDaTroca = { noLugar: 0, cobertas: 0, letrasEmOutraFonte: 0, semSuporte: [] };
  if (edicoes.length === 0) return resumo;

  const lida = analisarPagina(pagina, cache);
  const fonteDe = fontesDaPagina(pagina, cache);
  const trocas: TrocaNoConteudo[] = [];
  const paraCobrir: EdicaoDeLinha[] = [];
  const embutidas = new Map<string, { fonte: PDFFont; nome: string }>();

  for (const e of edicoes) {
    const glifos = lida ? glifosNaRegiao(lida.analise, e.regiao) : [];
    const partida = partidaConfiavel(glifos, e, fonteDe);
    const fonte = partida ? fonteDe(partida.op.fonte) : null;
    if (!partida || !fonte) {
      // Tira o que der (a camada invisível de um escaneado, por exemplo) e cobre o que aparece.
      if (glifos.length) trocas.push({ glifos, trechos: [], noFim: false });
      paraCobrir.push(e);
      continue;
    }
    const usados = usadosDoRecurso(partida.op.fonte);
    const escrita = await escrever(e.texto, fonte, usados, async () => {
      const qual = fontePadraoParecida(fonte);
      let o = embutidas.get(qual);
      if (!o) {
        const f = await doc.embedFont(qual);
        o = { fonte: f, nome: pagina.node.newFontDictionary(f.name, f.ref).decodeText() };
        embutidas.set(qual, o);
      }
      return o;
    });
    resumo.letrasEmOutraFonte += escrita.letrasEmOutraFonte;
    resumo.semSuporte.push(...escrita.semSuporte);
    const noFim =
      partida.op.recorte !== 0 &&
      larguraDosTrechos(partida.op, escrita.trechos) > e.regiao.largura + 0.5;
    trocas.push({ glifos, trechos: escrita.trechos, noFim });
    resumo.noLugar++;
  }

  if (lida && (trocas.length > 0 || estaDesequilibrado(lida.analise))) {
    gravarConteudo(doc, pagina, reescreverConteudo(lida.bytes, lida.analise, trocas, fonteDe));
  }

  for (const e of paraCobrir) {
    await cobrirLinha(doc, pagina, e, resumo);
    resumo.cobertas++;
  }
  return resumo;
}

/** O recurso de exceção: pinta da cor do fundo por cima da linha e escreve o texto novo. */
async function cobrirLinha(
  doc: PDFDocument,
  pagina: PDFPage,
  e: EdicaoDeLinha,
  resumo: ResumoDaTroca,
): Promise<void> {
  const r = e.regiao;
  const angulo = (Math.atan2(r.uy, r.ux) * 180) / Math.PI;
  const giro = degrees(angulo);
  // A normal da linha de base, para descer até o pé das letras.
  const nx = -r.uy;
  const ny = r.ux;
  const abaixo = e.descendente * r.tamanho;
  const altura = (e.ascendente + e.descendente) * r.tamanho;
  pagina.drawRectangle({
    x: r.x - nx * abaixo,
    y: r.y - ny * abaixo,
    width: r.largura,
    height: altura,
    rotate: giro,
    color: rgb(e.corDeFundo.r, e.corDeFundo.g, e.corDeFundo.b),
  });
  const limpo = e.texto.normalize("NFC").replace(/[\t\r\n]+/g, " ");
  if (!limpo.trim()) return;
  const letras = Array.from(limpo).map((ch) => {
    if (cabeNaFontePadrao(ch)) return ch;
    resumo.semSuporte.push(ch);
    return "?";
  });
  const fonte = await doc.embedFont(
    fontePadraoParecida({
      serifa: e.familia === "serif",
      mono: e.familia === "mono",
      negrito: e.negrito,
      italico: e.italico,
    }),
  );
  pagina.drawText(letras.join(""), {
    x: r.x,
    y: r.y,
    size: r.tamanho,
    font: fonte,
    rotate: giro,
    color: rgb(e.corDoTexto.r, e.corDoTexto.g, e.corDoTexto.b),
  });
}
