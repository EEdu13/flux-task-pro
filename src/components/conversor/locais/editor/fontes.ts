import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFontEmbedder,
  StandardFonts,
} from "pdf-lib";
import type { FonteDoConteudo } from "./conteudo";

/*
 * As fontes de uma página de PDF, lidas do jeito que o Editor precisa (05/11/2026):
 * a largura de cada código, para calcular onde cada letra cai, e a ponte entre
 * código e letra, para escrever o texto novo com a mesma fonte.
 *
 * O que fica de fora, de propósito, é o que não dá para reescrever com segurança:
 * Type3 (desenho por página) e CMap próprio (código de tamanho variável). Para o
 * Editor, uma fonte assim é "desconhecida" e aquele texto é tampado em vez de trocado.
 */

export type InfoDaFonte = FonteDoConteudo & {
  /** O nome do arquivo de fonte, sem o prefixo de subconjunto. */
  nome: string;
  /** Identifica a fonte no documento, entre páginas. */
  chave: string;
  /** Os códigos que escrevem este texto (uma letra, ou "fi" numa ligadura). */
  codigosDe: (texto: string) => readonly number[] | undefined;
  /** A letra de um código. `undefined` quando o PDF não diz. */
  textoDe: (codigo: number) => string | undefined;
  /**
   * Traz todos os glifos do seu mapa. Fonte cortada ("ABCDEF+Calibri") só garante
   * os que o próprio documento usa: pedir outro desenharia um quadrado ou nada.
   */
  completa: boolean;
  negrito: boolean;
  italico: boolean;
  serifa: boolean;
  mono: boolean;
};

const nome = (s: string) => PDFName.of(s);

function textoDoNome(o: unknown): string | undefined {
  return o instanceof PDFName ? o.decodeText() : undefined;
}

function numero(o: unknown): number | undefined {
  return o instanceof PDFNumber ? o.asNumber() : undefined;
}

export function bytesDoStream(s: PDFStream): Uint8Array {
  if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
  const comConteudo = s as PDFStream & { getUnencodedContents?: () => Uint8Array };
  return comConteudo.getUnencodedContents ? comConteudo.getUnencodedContents() : s.getContents();
}

/* ------------------------------- WinAnsi ----------------------------------- */

type TabelaWinAnsi = {
  /** Código → letra. */
  letra: Map<number, string>;
  /** Letra → código. */
  codigo: Map<string, number>;
  /** Nome de glifo ("aacute") → letra. */
  porNome: Map<string, string>;
};

let winAnsi: TabelaWinAnsi | null = null;

function tabelaWinAnsi(): TabelaWinAnsi {
  if (winAnsi) return winAnsi;
  const { encoding } = embutidorPadrao(StandardFonts.Helvetica);
  const letra = new Map<number, string>();
  const codigo = new Map<string, number>();
  const porNome = new Map<string, string>();
  for (const cp of encoding.supportedCodePoints) {
    const g = encoding.encodeUnicodeCodePoint(cp);
    const ch = String.fromCodePoint(cp);
    // Há dois pontos de código para o mesmo código (espaço e espaço duro): vale o primeiro.
    if (!letra.has(g.code)) letra.set(g.code, ch);
    if (!codigo.has(ch)) codigo.set(ch, g.code);
    if (!porNome.has(g.name)) porNome.set(g.name, ch);
  }
  winAnsi = { letra, codigo, porNome };
  return winAnsi;
}

function embutidorPadrao(fonte: StandardFonts): StandardFontEmbedder {
  return StandardFontEmbedder.for(
    fonte as unknown as Parameters<typeof StandardFontEmbedder.for>[0],
  );
}

/** Pode escrever esta letra com as fontes padrão do PDF? (Elas cobrem o português inteiro.) */
export function cabeNaFontePadrao(ch: string): boolean {
  return tabelaWinAnsi().codigo.has(ch);
}

/* ------------------------------ ToUnicode ------------------------------------ */

function utf16DeHexa(hexa: string): string {
  const limpo = hexa.replace(/\s+/g, "");
  let s = "";
  for (let i = 0; i + 4 <= limpo.length; i += 4) {
    s += String.fromCharCode(parseInt(limpo.slice(i, i + 4), 16));
  }
  // CMap mal escrito, com um byte só por letra.
  if (!s && limpo.length >= 2) s = String.fromCharCode(parseInt(limpo.slice(0, 2), 16));
  return s;
}

/** O que há em `beginbfchar` e `beginbfrange`: código → texto. */
export function lerToUnicode(bytes: Uint8Array): Map<number, string> {
  let texto = "";
  for (const b of bytes) texto += String.fromCharCode(b);
  const mapa = new Map<number, string>();
  for (const bloco of texto.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const par of (bloco[1] ?? "").matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]*)>/g)) {
      mapa.set(parseInt((par[1] ?? "").replace(/\s+/g, ""), 16), utf16DeHexa(par[2] ?? ""));
    }
  }
  for (const bloco of texto.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const padrao = /<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]+)>\s*(?:<([0-9a-fA-F\s]*)>|\[([^\]]*)\])/g;
    for (const r of (bloco[1] ?? "").matchAll(padrao)) {
      const de = parseInt((r[1] ?? "").replace(/\s+/g, ""), 16);
      const ate = Math.min(parseInt((r[2] ?? "").replace(/\s+/g, ""), 16), de + 65535);
      if (r[3] !== undefined) {
        const base = utf16DeHexa(r[3]);
        for (let c = de; c <= ate; c++) {
          const ultimo = base.charCodeAt(base.length - 1) + (c - de);
          mapa.set(c, base.slice(0, -1) + String.fromCharCode(ultimo));
        }
      } else {
        const itens = [...(r[4] ?? "").matchAll(/<([0-9a-fA-F\s]*)>/g)];
        itens.forEach((it, k) => {
          if (de + k <= ate) mapa.set(de + k, utf16DeHexa(it[1] ?? ""));
        });
      }
    }
  }
  return mapa;
}

/* -------------------------------- Estilo ------------------------------------- */

type Estilo = Pick<InfoDaFonte, "negrito" | "italico" | "serifa" | "mono">;

function estiloDa(base: string, descritor: PDFDict | undefined): Estilo {
  const flags = numero(descritor?.lookup(nome("Flags"))) ?? 0;
  const peso = numero(descritor?.lookup(nome("FontWeight"))) ?? 0;
  const angulo = numero(descritor?.lookup(nome("ItalicAngle"))) ?? 0;
  const semSerifa = /arial|helvet|calibri|segoe|verdana|tahoma|aptos|sans/i.test(base);
  const comSerifa = /times|georgia|garamond|cambria|palatino|book|minion|roman|serif/i.test(base);
  return {
    negrito: /bold|black|heavy|semibold|demi/i.test(base) || peso >= 600 || !!(flags & (1 << 18)),
    italico: /ital|obli/i.test(base) || angulo !== 0 || !!(flags & 64),
    mono: /cour|mono|consol|typewriter/i.test(base) || !!(flags & 1),
    serifa: !semSerifa && (comSerifa || !!(flags & 2)),
  };
}

/** A fonte padrão do PDF que mais se parece: é ela que escreve a letra que a fonte original não traz. */
export function fontePadraoParecida(e: Partial<Estilo>): StandardFonts {
  if (e.mono) {
    if (e.negrito && e.italico) return StandardFonts.CourierBoldOblique;
    if (e.negrito) return StandardFonts.CourierBold;
    if (e.italico) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (e.serifa) {
    if (e.negrito && e.italico) return StandardFonts.TimesRomanBoldItalic;
    if (e.negrito) return StandardFonts.TimesRomanBold;
    if (e.italico) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (e.negrito && e.italico) return StandardFonts.HelveticaBoldOblique;
  if (e.negrito) return StandardFonts.HelveticaBold;
  if (e.italico) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

/* ---------------------------- Leitura das fontes ------------------------------ */

function montarMapas(mapa: Map<number, string>) {
  const inverso = new Map<string, number[]>();
  for (const [codigo, texto] of mapa) {
    if (!texto) continue;
    const lista = inverso.get(texto);
    if (lista) lista.push(codigo);
    else inverso.set(texto, [codigo]);
  }
  return {
    textoDe: (c: number) => mapa.get(c),
    codigosDe: (t: string): readonly number[] | undefined => inverso.get(t),
  };
}

function lerToUnicodeDa(d: PDFDict): Map<number, string> {
  const tu = d.lookup(nome("ToUnicode"));
  if (!(tu instanceof PDFStream)) return new Map();
  try {
    return lerToUnicode(bytesDoStream(tu));
  } catch {
    return new Map();
  }
}

function lerComposta(d: PDFDict, chave: string, base: string): InfoDaFonte | null {
  // Só Identity-H: dois bytes por código, sempre. O CMap próprio pode ter tamanho variável.
  if (textoDoNome(d.lookup(nome("Encoding"))) !== "Identity-H") return null;
  const descendentes = d.lookup(nome("DescendantFonts"));
  const filha = descendentes instanceof PDFArray ? descendentes.lookup(0) : undefined;
  if (!(filha instanceof PDFDict)) return null;
  const padrao = numero(filha.lookup(nome("DW"))) ?? 1000;
  const larguras = new Map<number, number>();
  const w = filha.lookup(nome("W"));
  if (w instanceof PDFArray) {
    let i = 0;
    while (i < w.size()) {
      const c = numero(w.lookup(i));
      const seguinte = w.lookup(i + 1);
      if (c === undefined) break;
      if (seguinte instanceof PDFArray) {
        for (let k = 0; k < seguinte.size(); k++) {
          larguras.set(c + k, numero(seguinte.lookup(k)) ?? padrao);
        }
        i += 2;
      } else {
        const ultimo = numero(seguinte);
        const valor = numero(w.lookup(i + 2));
        if (ultimo === undefined || valor === undefined) break;
        for (let k = c; k <= Math.min(ultimo, c + 65535); k++) larguras.set(k, valor);
        i += 3;
      }
    }
  }
  const descritor = filha.lookup(nome("FontDescriptor"));
  return {
    bytesPorCodigo: 2,
    largura: (c) => larguras.get(c) ?? padrao,
    nome: base.replace(/^[A-Z]{6}\+/, ""),
    chave,
    completa: false,
    ...montarMapas(lerToUnicodeDa(d)),
    ...estiloDa(base, descritor instanceof PDFDict ? descritor : undefined),
  };
}

/** O nome de uma das 14 fontes padrão do PDF, se for. */
function fontePadraoDoNome(base: string): StandardFonts | null {
  const valores = Object.values(StandardFonts) as string[];
  return valores.includes(base) ? (base as StandardFonts) : null;
}

/** A fonte traz o próprio desenho dentro do PDF? */
function temPrograma(descritor: PDFDict | undefined): boolean {
  return ["FontFile", "FontFile2", "FontFile3"].some((k) => descritor?.has(nome(k)));
}

/**
 * A parte alta da StandardEncoding, a codificação de quem não declara nenhuma. Não é
 * a WinAnsi: o código 0xE7, que na WinAnsi é "ç", aqui nem existe, e 0xE9 é "Ø".
 */
const PADRAO_ALTA: Readonly<Record<number, string>> = {
  0xa1: "exclamdown",
  0xa2: "cent",
  0xa3: "sterling",
  0xa4: "fraction",
  0xa5: "yen",
  0xa6: "florin",
  0xa7: "section",
  0xa8: "currency",
  0xa9: "quotesingle",
  0xaa: "quotedblleft",
  0xab: "guillemotleft",
  0xac: "guilsinglleft",
  0xad: "guilsinglright",
  0xae: "fi",
  0xaf: "fl",
  0xb1: "endash",
  0xb2: "dagger",
  0xb3: "daggerdbl",
  0xb4: "periodcentered",
  0xb6: "paragraph",
  0xb7: "bullet",
  0xb8: "quotesinglbase",
  0xb9: "quotedblbase",
  0xba: "quotedblright",
  0xbb: "guillemotright",
  0xbc: "ellipsis",
  0xbd: "perthousand",
  0xbf: "questiondown",
  0xc1: "grave",
  0xc2: "acute",
  0xc3: "circumflex",
  0xc4: "tilde",
  0xc5: "macron",
  0xc6: "breve",
  0xc7: "dotaccent",
  0xc8: "dieresis",
  0xca: "ring",
  0xcb: "cedilla",
  0xcd: "hungarumlaut",
  0xce: "ogonek",
  0xcf: "caron",
  0xd0: "emdash",
  0xe1: "AE",
  0xe3: "ordfeminine",
  0xe8: "Lslash",
  0xe9: "Oslash",
  0xea: "OE",
  0xeb: "ordmasculine",
  0xf1: "ae",
  0xf5: "dotlessi",
  0xf8: "lslash",
  0xf9: "oslash",
  0xfa: "oe",
  0xfb: "germandbls",
};

/** Os dois códigos ASCII em que a StandardEncoding difere da WinAnsi. */
const PADRAO_ASPAS: Readonly<Record<number, string>> = { 0x27: "quoteright", 0x60: "quoteleft" };

/** `/Differences`: código → nome de glifo. */
function lerDiferencas(encoding: unknown): Map<number, string> {
  const saida = new Map<number, string>();
  if (!(encoding instanceof PDFDict)) return saida;
  const dif = encoding.lookup(nome("Differences"));
  if (!(dif instanceof PDFArray)) return saida;
  let c = 0;
  for (let i = 0; i < dif.size(); i++) {
    const v = dif.lookup(i);
    const n = numero(v);
    if (n !== undefined) {
      c = n;
      continue;
    }
    const glifo = textoDoNome(v);
    if (glifo) saida.set(c++, glifo);
  }
  return saida;
}

function lerSimples(d: PDFDict, chave: string, base: string): InfoDaFonte | null {
  const descritorBruto = d.lookup(nome("FontDescriptor"));
  const descritor = descritorBruto instanceof PDFDict ? descritorBruto : undefined;
  /* Só é fonte padrão a que o leitor de PDF desenha: sem prefixo de subconjunto e sem
     programa embutido. "ABCDEF+Helvetica" é um recorte que traz só algumas letras: tratá-la
     como completa escreveria letra em branco, sem aviso (achado na revisão de 05/11/2026). */
  const padrao14 = temPrograma(descritor) ? null : fontePadraoDoNome(base);

  const encoding = d.lookup(nome("Encoding"));
  const nomeEncoding = textoDoNome(encoding);
  const baseEncoding =
    encoding instanceof PDFDict ? textoDoNome(encoding.lookup(nome("BaseEncoding"))) : undefined;
  const declarada = nomeEncoding ?? baseEncoding;
  const ehWinAnsi = declarada === "WinAnsiEncoding";
  const ehMac = declarada === "MacRomanEncoding" || declarada === "MacExpertEncoding";
  /* Symbol e ZapfDingbats têm tabela própria: o código 97 é "α", e não "a". */
  const propria = padrao14 === StandardFonts.Symbol || padrao14 === StandardFonts.ZapfDingbats;
  const diferencas = lerDiferencas(encoding);

  let largura: (c: number) => number;
  const widths = d.lookup(nome("Widths"));
  if (widths instanceof PDFArray) {
    const primeiro = numero(d.lookup(nome("FirstChar"))) ?? 0;
    const faltando = numero(descritor?.lookup(nome("MissingWidth"))) ?? 0;
    const lista: number[] = [];
    for (let i = 0; i < widths.size(); i++) lista.push(numero(widths.lookup(i)) ?? 0);
    largura = (c) => lista[c - primeiro] ?? faltando;
  } else if (padrao14 && !ehMac) {
    /* Sem `/Widths`, a largura vem do nome do glifo NA CODIFICAÇÃO DA FONTE: uma largura
       errada desloca tudo o que vem depois na mesma operação. Sem o mapa do Mac: desconhecida. */
    const { font, encoding: tabelaDaFonte } = embutidorPadrao(padrao14);
    const doGlifo = (glifo: string) => Number(font.getWidthOfGlyph(glifo) ?? 0);
    const tabela = new Map<number, number>();
    for (const cp of tabelaDaFonte.supportedCodePoints) {
      const g = tabelaDaFonte.encodeUnicodeCodePoint(cp);
      if (propria || ehWinAnsi || g.code < 128) tabela.set(g.code, doGlifo(g.name));
    }
    if (!propria && !ehWinAnsi) {
      for (const [c, glifo] of Object.entries(PADRAO_ASPAS)) tabela.set(Number(c), doGlifo(glifo));
      for (const [c, glifo] of Object.entries(PADRAO_ALTA)) tabela.set(Number(c), doGlifo(glifo));
    }
    for (const [c, glifo] of diferencas) tabela.set(c, doGlifo(glifo));
    largura = (c) => tabela.get(c) ?? 0;
  } else {
    return null;
  }

  /* A ponte entre código e letra. O ToUnicode vale primeiro; sem ele, a codificação
     declarada: WinAnsi, ou só a parte ASCII das outras. Com `/Differences`, cada nome
     de glifo reescreve o código dele. */
  const mapa = new Map<number, string>();
  const tabela = tabelaWinAnsi();
  const simbolica = (numero(descritor?.lookup(nome("Flags"))) ?? 0) & 4;
  if (ehWinAnsi) {
    for (const [c, l] of tabela.letra) mapa.set(c, l);
  } else if (!simbolica && !propria && (declarada || encoding instanceof PDFDict || padrao14)) {
    /* Só a parte ASCII, sem as aspas, que mudam entre as codificações. A letra acentuada
       vai para a fonte parecida: escrita com o código da WinAnsi, saía outra letra. */
    for (let c = 32; c < 127; c++) {
      const l = tabela.letra.get(c);
      if (l && (ehMac || !PADRAO_ASPAS[c])) mapa.set(c, l);
    }
  }
  for (const [c, glifo] of diferencas) {
    const uni = /^uni([0-9A-Fa-f]{4})$/.exec(glifo);
    const letra = uni ? String.fromCharCode(parseInt(uni[1]!, 16)) : tabela.porNome.get(glifo);
    if (letra) mapa.set(c, letra);
    else mapa.delete(c);
  }
  for (const [c, l] of lerToUnicodeDa(d)) mapa.set(c, l);

  const estilo = padrao14 ? estiloDa(padrao14, undefined) : estiloDa(base, descritor);
  return {
    bytesPorCodigo: 1,
    largura,
    nome: base.replace(/^[A-Z]{6}\+/, ""),
    chave,
    /* Só a fonte padrão, que quem desenha é o leitor. Embutida, nem o nome sem prefixo
       garante que veio inteira: vale só o que o documento mostrou que ela tem. */
    completa: !!padrao14,
    ...montarMapas(mapa),
    ...estilo,
  };
}

function lerFonte(d: PDFDict, chave: string): InfoDaFonte | null {
  const subtipo = textoDoNome(d.lookup(nome("Subtype")));
  const base = textoDoNome(d.lookup(nome("BaseFont"))) ?? "";
  if (subtipo === "Type0") return lerComposta(d, chave, base);
  if (subtipo === "Type1" || subtipo === "TrueType" || subtipo === "MMType1") {
    return lerSimples(d, chave, base);
  }
  return null;
}

export type CacheDeFontes = Map<string, InfoDaFonte | null>;

/**
 * O leitor das fontes de uma página, pelo nome do recurso ("F1"). Lê na hora em
 * que cada uma é pedida, e guarda no `cache` do documento: a mesma fonte costuma
 * valer para todas as páginas.
 */
export function leitorDeFontes(
  recursos: PDFDict | undefined,
  cache: CacheDeFontes,
): (nomeDoRecurso: string) => InfoDaFonte | null {
  const local = new Map<string, InfoDaFonte | null>();
  let fontes: PDFDict | undefined;
  try {
    const f = recursos?.lookup(nome("Font"));
    fontes = f instanceof PDFDict ? f : undefined;
  } catch {
    fontes = undefined;
  }
  return (nomeDoRecurso) => {
    const jaLida = local.get(nomeDoRecurso);
    if (jaLida !== undefined) return jaLida;
    let info: InfoDaFonte | null = null;
    try {
      const valor = fontes?.get(nome(nomeDoRecurso));
      const chave = valor instanceof PDFRef ? valor.toString() : "";
      const noCache = chave ? cache.get(chave) : undefined;
      if (noCache !== undefined) {
        info = noCache;
      } else {
        const d = valor instanceof PDFRef ? fontes?.context.lookup(valor) : valor;
        // Fonte escrita direto nos recursos, sem referência: vale só para esta página.
        info = d instanceof PDFDict ? lerFonte(d, chave || `direta:${nomeDoRecurso}`) : null;
        if (chave) cache.set(chave, info);
      }
    } catch (e) {
      console.warn("[editor de PDF] não consegui ler a fonte", nomeDoRecurso, e);
      info = null;
    }
    local.set(nomeDoRecurso, info);
    return info;
  };
}
