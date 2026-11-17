/*
 * O conteúdo de uma página de PDF, lido e reescrito (05/11/2026).
 *
 * É o coração de "editar o que está escrito" no Editor de PDF. Uma página é uma
 * lista de operadores ("escreva isto", "ande até ali", "troque de fonte"), e nem
 * o pdf-lib nem o pdf.js oferecem trocar um texto dela. Aqui o conteúdo é
 * percorrido operador a operador, com a posição de cada letra calculada igual ao
 * que o leitor de PDF faz, para poder:
 *   1. achar as letras que ocupam uma linha da página;
 *   2. tirá-las de verdade do arquivo, e não só tampar;
 *   3. escrever o texto novo no mesmo lugar, com a mesma fonte, a mesma cor, o
 *      mesmo recorte e a mesma transparência (o estado segue valendo ali).
 * O resto do conteúdo é devolvido byte a byte, intacto.
 *
 * Este arquivo não conhece pdf-lib nem pdf.js: recebe e devolve bytes. As fontes
 * vêm de `fontes.ts`; quem junta tudo é `pagina.ts`.
 */

export type Matriz = readonly [number, number, number, number, number, number];

export const IDENTIDADE: Matriz = [1, 0, 0, 1, 0, 0];

/** `m × n`: aplica `m` primeiro. É a ordem da norma do PDF. */
export function multiplicar(m: Matriz, n: Matriz): Matriz {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

const deslocamento = (x: number, y: number): Matriz => [1, 0, 0, 1, x, y];

/* ------------------------------- Leitor ------------------------------------ */

/** Número, nome (sem a barra e sem decodificar), texto, lista, ou `null` para o resto (dicionário, true, false). */
export type Operando = number | string | Uint8Array | Operando[] | null;

const BRANCO = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) BRANCO[c] = 1;
const DELIMITADOR = new Uint8Array(256);
for (const c of "()<>[]{}/%") DELIMITADOR[c.charCodeAt(0)] = 1;

const FIM = Symbol("fim");
const PALAVRA = Symbol("palavra");
const FECHA_LISTA = Symbol("fecha-lista");
const FECHA_DICIONARIO = Symbol("fecha-dicionario");
type Lido = Operando | typeof FIM | typeof PALAVRA | typeof FECHA_LISTA | typeof FECHA_DICIONARIO;

/** Listas e dicionários aninhados além disto são lixo, ou má-fé: não valem estourar a pilha. */
const PROFUNDIDADE_MAXIMA = 32;
/** Nenhum operador do PDF pede mais de 33 operandos. */
const OPERANDOS_MAXIMOS = 64;

function valorHexa(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

/**
 * Percorre o conteúdo e chama `aoOperar` para cada operador, com os operandos e
 * os bytes que ele ocupa (`inicio` é o do primeiro operando). Tolera lixo: pula o
 * que não entende e nunca fica parado no mesmo lugar.
 */
export function percorrerConteudo(
  b: Uint8Array,
  aoOperar: (op: string, args: Operando[], inicio: number, fim: number) => void,
): void {
  const n = b.length;
  let i = 0;
  let palavra = "";

  const pularBranco = () => {
    for (;;) {
      while (i < n && BRANCO[b[i]!]) i++;
      if (i < n && b[i] === 0x25) {
        while (i < n && b[i] !== 10 && b[i] !== 13) i++;
        continue;
      }
      return;
    }
  };

  const lerLiteral = (): Uint8Array => {
    i++; // "("
    const saida: number[] = [];
    let nivel = 1;
    while (i < n) {
      const c = b[i++]!;
      if (c === 0x28) {
        nivel++;
        saida.push(c);
      } else if (c === 0x29) {
        if (--nivel === 0) break;
        saida.push(c);
      } else if (c === 0x5c) {
        const e = b[i++];
        if (e === undefined) break;
        if (e === 0x6e) saida.push(10);
        else if (e === 0x72) saida.push(13);
        else if (e === 0x74) saida.push(9);
        else if (e === 0x62) saida.push(8);
        else if (e === 0x66) saida.push(12);
        else if (e >= 0x30 && e <= 0x37) {
          let v = e - 0x30;
          for (let k = 0; k < 2 && i < n && b[i]! >= 0x30 && b[i]! <= 0x37; k++) {
            v = v * 8 + (b[i++]! - 0x30);
          }
          saida.push(v & 0xff);
        } else if (e === 13) {
          // Barra no fim da linha continua o texto na linha de baixo.
          if (b[i] === 10) i++;
        } else if (e !== 10) {
          saida.push(e);
        }
      } else {
        saida.push(c);
      }
    }
    return Uint8Array.from(saida);
  };

  const lerHexa = (): Uint8Array => {
    i++; // "<"
    const saida: number[] = [];
    let alto = -1;
    while (i < n) {
      const c = b[i++]!;
      if (c === 0x3e) break;
      const v = valorHexa(c);
      if (v < 0) continue;
      if (alto < 0) alto = v;
      else {
        saida.push(alto * 16 + v);
        alto = -1;
      }
    }
    // Número ímpar de dígitos: a norma manda completar com zero.
    if (alto >= 0) saida.push(alto * 16);
    return Uint8Array.from(saida);
  };

  const lerRegular = (): string => {
    const inicio = i;
    while (i < n && !BRANCO[b[i]!] && !DELIMITADOR[b[i]!]) i++;
    let s = "";
    for (let k = inicio; k < i; k++) s += String.fromCharCode(b[k]!);
    return s;
  };

  const ler = (profundidade: number): Lido => {
    for (;;) {
      pularBranco();
      if (i >= n) return FIM;
      const c = b[i]!;
      if (c === 0x28) return lerLiteral();
      if (c === 0x3c) {
        if (b[i + 1] !== 0x3c) return lerHexa();
        i += 2;
        if (profundidade < PROFUNDIDADE_MAXIMA) {
          for (;;) {
            const r = ler(profundidade + 1);
            if (r === FIM || r === FECHA_DICIONARIO) break;
          }
        }
        return null;
      }
      if (c === 0x3e) {
        if (b[i + 1] === 0x3e) {
          i += 2;
          return FECHA_DICIONARIO;
        }
        i++;
        continue;
      }
      if (c === 0x5b) {
        i++;
        const lista: Operando[] = [];
        if (profundidade < PROFUNDIDADE_MAXIMA) {
          for (;;) {
            const r = ler(profundidade + 1);
            if (r === FIM || r === FECHA_LISTA) break;
            if (r === PALAVRA || r === FECHA_DICIONARIO) continue;
            lista.push(r);
          }
        }
        return lista;
      }
      if (c === 0x5d) {
        i++;
        return FECHA_LISTA;
      }
      if (c === 0x2f) {
        i++;
        return lerRegular();
      }
      if (DELIMITADOR[c]) {
        i++; // ")", "{" ou "}" soltos: não fazem parte de conteúdo de página.
        continue;
      }
      const texto = lerRegular();
      const primeira = texto.charCodeAt(0);
      if (
        (primeira >= 0x30 && primeira <= 0x39) ||
        primeira === 0x2d ||
        primeira === 0x2b ||
        primeira === 0x2e
      ) {
        const numero = Number(texto);
        if (!Number.isNaN(numero)) return numero;
        // Há gerador que escreve "--5" ou "1.2.3". O leitor de PDF tolera; aqui vale o que dá para ler.
        const parcial = parseFloat(texto.replace(/^[-+]+/, "-"));
        return Number.isNaN(parcial) ? 0 : parcial;
      }
      if (texto === "true" || texto === "false" || texto === "null") return null;
      palavra = texto;
      return PALAVRA;
    }
  };

  /* Imagem no meio do conteúdo: `BI … ID <bytes crus> EI`. Os bytes podem conter
     qualquer coisa, inclusive "EI": vale a mesma conferência do pdf.js, de que o
     que vem depois parece conteúdo de página, e não dado binário. */
  const pularImagem = () => {
    for (;;) {
      const r = ler(0);
      if (r === FIM) return;
      if (r === PALAVRA && palavra === "ID") break;
    }
    i++; // o branco único depois do ID
    for (; i < n; i++) {
      if (b[i] !== 0x45 || b[i + 1] !== 0x49) continue;
      const depois = b[i + 2];
      if (depois !== undefined && !BRANCO[depois]) continue;
      let pareceTexto = true;
      for (let k = i + 3; k < Math.min(n, i + 13); k++) {
        const v = b[k]!;
        if (v !== 10 && v !== 13 && v !== 9 && (v < 0x20 || v > 0x7e)) {
          pareceTexto = false;
          break;
        }
      }
      if (pareceTexto) {
        i += 2;
        return;
      }
    }
  };

  let args: Operando[] = [];
  let inicio = -1;
  for (;;) {
    pularBranco();
    if (i >= n) break;
    const posicao = i;
    const r = ler(0);
    if (r === FIM) break;
    if (r === FECHA_LISTA || r === FECHA_DICIONARIO) continue;
    if (r === PALAVRA) {
      const comeco = inicio < 0 ? posicao : inicio;
      if (palavra === "BI") pularImagem();
      aoOperar(palavra === "BI" ? "BI" : palavra, args, comeco, i);
      args = [];
      inicio = -1;
      continue;
    }
    if (inicio < 0) inicio = posicao;
    if (args.length < OPERANDOS_MAXIMOS) args.push(r);
  }
}

/* ----------------------------- Interpretador -------------------------------- */

/** O que o interpretador precisa saber de uma fonte para calcular as posições. */
export type FonteDoConteudo = {
  /** 1 nas fontes simples; 2 nas compostas Identity-H. */
  bytesPorCodigo: 1 | 2;
  /** Largura do glifo em milésimos do corpo (a unidade de `/Widths`). */
  largura: (codigo: number) => number;
};

export type Glifo = {
  codigo: number;
  /** A origem da letra, no espaço do usuário (o da página, sem o giro de exibição). */
  x: number;
  y: number;
  /** O avanço até a letra seguinte, no mesmo espaço. */
  ax: number;
  ay: number;
  /** Quanto o cursor andou no espaço do texto, do começo da operação até esta letra. */
  tx: number;
  op: OperacaoDeTexto;
};

/**
 * Um trecho marcado (`BDC`) com `/ActualText`: o texto "de verdade" que a busca e o copiar
 * usam no lugar das letras desenhadas (a ligadura "ﬁ" que se lê "fi"). `inicio` e `fim` são os
 * bytes do `BDC` com o dicionário dele.
 */
export type MarcaComTexto = { inicio: number; fim: number };

export type OperacaoDeTexto = {
  inicio: number;
  fim: number;
  tipo: "Tj" | "TJ" | "'" | '"';
  /** Os trechos marcados com `/ActualText` em volta desta operação, de fora para dentro. */
  marcas: readonly MarcaComTexto[];
  /** Só no operador `"`: os valores que ele grava em Tw e Tc. */
  aw: number;
  ac: number;
  /** As letras e, entre elas, os ajustes numéricos do `TJ`. */
  elementos: (Glifo | number)[];
  /** `false` quando a fonte não é conhecida (Type3, CMap próprio): não dá para mexer. */
  conhecida: boolean;
  fonte: string;
  tamanho: number;
  tc: number;
  tw: number;
  th: number;
  ts: number;
  tr: number;
  /** Os operadores de cor crus, para repetir igual onde for preciso. */
  cor: string;
  /** Os `gs` em vigor (transparência, entre outros). */
  gs: readonly string[];
  /** Muda a cada `W`: identifica a região de recorte. 0 = sem recorte. */
  recorte: number;
  /** Muda a cada `BT`: identifica o bloco de texto. */
  bloco: number;
  tm: Matriz;
  ctm: Matriz;
};

export type AnaliseDoConteudo = {
  ops: OperacaoDeTexto[];
  /** Quantos `q` ficaram sem `Q` no fim: precisam fechar antes de escrever por cima. */
  profundidade: number;
  /**
   * Os `Q` sem `q`. O leitor de PDF os ignora, mas com o conteúdo entre `q` e `Q` eles
   * passariam a desfazer o de fora, e o que vem depois mudaria de lugar: saem do conteúdo.
   */
  qDemais: { inicio: number; fim: number }[];
};

type Grafico = {
  ctm: Matriz;
  fonte: string | null;
  tamanho: number;
  tc: number;
  tw: number;
  th: number;
  tl: number;
  ts: number;
  tr: number;
  cor: string;
  corCs: string;
  gs: readonly string[];
  recorte: number;
};

const numeroDe = (v: Operando | undefined): number => (typeof v === "number" ? v : 0);

/** Os seis operandos de `cm` e `Tm`. Faltando algum, o operador é ignorado, como no leitor de PDF. */
function matrizDe(a: readonly Operando[]): Matriz | null {
  if (a.length < 6) return null;
  return [
    numeroDe(a[0]),
    numeroDe(a[1]),
    numeroDe(a[2]),
    numeroDe(a[3]),
    numeroDe(a[4]),
    numeroDe(a[5]),
  ];
}

function latin1(b: Uint8Array, inicio: number, fim: number): string {
  let s = "";
  for (let k = inicio; k < fim; k++) s += String.fromCharCode(b[k]!);
  return s;
}

/** Lê os operadores de texto, cor e posição de uma página, e calcula onde cada letra cai. */
export function analisarConteudo(
  b: Uint8Array,
  fonteDe: (nome: string) => FonteDoConteudo | null,
): AnaliseDoConteudo {
  const ops: OperacaoDeTexto[] = [];
  const pilha: Grafico[] = [];
  let contadorDeRecorte = 0;
  let contadorDeBloco = 0;
  let bloco = 0;
  let g: Grafico = {
    ctm: IDENTIDADE,
    fonte: null,
    tamanho: 0,
    tc: 0,
    tw: 0,
    th: 1,
    tl: 0,
    ts: 0,
    tr: 0,
    cor: "",
    corCs: "",
    gs: [],
    recorte: 0,
  };
  let tm: Matriz = IDENTIDADE;
  let tlm: Matriz = IDENTIDADE;
  /** Passou texto de fonte desconhecida: sem as larguras, não se sabe mais onde o cursor está. */
  let posicaoIncerta = false;
  const qDemais: AnaliseDoConteudo["qDemais"] = [];
  /** Os trechos marcados abertos (`BMC`/`BDC` até o `EMC`): `null` nos que não têm `/ActualText`. */
  const marcas: (MarcaComTexto | null)[] = [];

  const proximaLinha = () => {
    tlm = multiplicar(deslocamento(0, -g.tl), tlm);
    tm = tlm;
    posicaoIncerta = false;
  };

  const mostrar = (
    tipo: OperacaoDeTexto["tipo"],
    conteudo: readonly Operando[],
    inicio: number,
    fim: number,
    aw = 0,
    ac = 0,
  ) => {
    const nomeDaFonte = g.fonte ?? "";
    const fonte = g.fonte ? fonteDe(g.fonte) : null;
    const op: OperacaoDeTexto = {
      inicio,
      fim,
      tipo,
      marcas: marcas.filter((m): m is MarcaComTexto => m !== null),
      aw,
      ac,
      elementos: [],
      conhecida: !!fonte,
      fonte: nomeDaFonte,
      tamanho: g.tamanho,
      tc: g.tc,
      tw: g.tw,
      th: g.th,
      ts: g.ts,
      tr: g.tr,
      cor: g.cor,
      gs: g.gs,
      recorte: g.recorte,
      bloco,
      tm,
      ctm: g.ctm,
    };
    ops.push(op);
    /* Fonte desconhecida: sem as larguras não se sabe onde o texto termina. O que vier
       depois sem posição própria também não se sabe onde cai, e trocar pela posição
       calculada mexeria na letra errada. Até o próximo posicionamento, não se toca em nada. */
    if (!fonte) posicaoIncerta = true;
    if (!fonte || posicaoIncerta) {
      op.conhecida = false;
      return;
    }

    const m = multiplicar(tm, g.ctm);
    let tx = 0;
    for (const el of conteudo) {
      if (typeof el === "number") {
        op.elementos.push(el);
        tx -= (el / 1000) * g.tamanho * g.th;
        continue;
      }
      if (!(el instanceof Uint8Array)) continue;
      const passo = fonte.bytesPorCodigo;
      for (let k = 0; k + passo <= el.length; k += passo) {
        const codigo = passo === 2 ? el[k]! * 256 + el[k + 1]! : el[k]!;
        const espaco = passo === 1 && codigo === 32 ? g.tw : 0;
        const avanco = ((fonte.largura(codigo) / 1000) * g.tamanho + g.tc + espaco) * g.th;
        op.elementos.push({
          codigo,
          x: m[0] * tx + m[2] * g.ts + m[4],
          y: m[1] * tx + m[3] * g.ts + m[5],
          ax: m[0] * avanco,
          ay: m[1] * avanco,
          tx,
          op,
        });
        tx += avanco;
      }
    }
    tm = multiplicar(deslocamento(tx, 0), tm);
  };

  percorrerConteudo(b, (op, a, inicio, fim) => {
    switch (op) {
      case "q":
        pilha.push(g);
        g = { ...g };
        break;
      case "Q": {
        const anterior = pilha.pop();
        if (anterior) g = anterior;
        else qDemais.push({ inicio, fim });
        break;
      }
      case "cm": {
        const m = matrizDe(a);
        if (m) g.ctm = multiplicar(m, g.ctm);
        break;
      }
      case "BT":
        tm = IDENTIDADE;
        tlm = IDENTIDADE;
        posicaoIncerta = false;
        bloco = ++contadorDeBloco;
        break;
      case "Tf":
        g.fonte = typeof a[0] === "string" ? a[0] : null;
        g.tamanho = numeroDe(a[1]);
        break;
      case "Tc":
        g.tc = numeroDe(a[0]);
        break;
      case "Tw":
        g.tw = numeroDe(a[0]);
        break;
      case "Tz":
        g.th = numeroDe(a[0]) / 100;
        break;
      case "TL":
        g.tl = numeroDe(a[0]);
        break;
      case "Ts":
        g.ts = numeroDe(a[0]);
        break;
      case "Tr":
        g.tr = numeroDe(a[0]);
        break;
      case "Td":
        tlm = multiplicar(deslocamento(numeroDe(a[0]), numeroDe(a[1])), tlm);
        tm = tlm;
        posicaoIncerta = false;
        break;
      case "TD":
        g.tl = -numeroDe(a[1]);
        tlm = multiplicar(deslocamento(numeroDe(a[0]), numeroDe(a[1])), tlm);
        tm = tlm;
        posicaoIncerta = false;
        break;
      case "Tm": {
        const m = matrizDe(a);
        if (m) {
          tlm = m;
          tm = m;
          posicaoIncerta = false;
        }
        break;
      }
      case "T*":
        proximaLinha();
        break;
      case "Tj":
        mostrar("Tj", a, inicio, fim);
        break;
      case "TJ":
        mostrar("TJ", Array.isArray(a[0]) ? a[0] : [], inicio, fim);
        break;
      case "'":
        proximaLinha();
        mostrar("'", a, inicio, fim);
        break;
      case '"': {
        const aw = numeroDe(a[0]);
        const ac = numeroDe(a[1]);
        g.tw = aw;
        g.tc = ac;
        proximaLinha();
        mostrar('"', a.slice(2), inicio, fim, aw, ac);
        break;
      }
      case "W":
      case "W*":
        g.recorte = ++contadorDeRecorte;
        break;
      case "gs":
        if (typeof a[0] === "string") g.gs = [...g.gs, a[0]];
        break;
      case "BMC":
        marcas.push(null);
        break;
      case "BDC":
        // O dicionário vem cru: basta saber se ele traz o texto "de verdade".
        marcas.push(/\/ActualText\b/.test(latin1(b, inicio, fim)) ? { inicio, fim } : null);
        break;
      case "EMC":
        marcas.pop();
        break;
      case "g":
      case "rg":
      case "k":
        g.cor = latin1(b, inicio, fim);
        g.corCs = "";
        break;
      case "cs":
        g.corCs = latin1(b, inicio, fim);
        g.cor = g.corCs;
        break;
      case "sc":
      case "scn":
        g.cor = g.corCs ? `${g.corCs} ${latin1(b, inicio, fim)}` : latin1(b, inicio, fim);
        break;
    }
  });

  return { ops, profundidade: pilha.length, qDemais };
}

/* ------------------------- Achar as letras de uma linha ---------------------- */

/** Uma linha da página: o início da linha de base, a direção, o comprimento e o corpo da letra. */
export type Regiao = {
  x: number;
  y: number;
  /** Vetor unitário ao longo da linha de base. */
  ux: number;
  uy: number;
  largura: number;
  tamanho: number;
};

/** As letras cujo centro cai na região, ordenadas da esquerda para a direita. */
export function glifosNaRegiao(analise: AnaliseDoConteudo, r: Regiao): Glifo[] {
  /* Folga mínima, só para arredondamento: quem decide é o CENTRO da letra, que já
     dá meia letra de margem. Uma folga maior pegaria o espaço logo antes da palavra,
     que às vezes é de outra cor, e o texto novo nasceria nela. */
  const folga = 0.02 * r.tamanho;
  const alturaMaxima = 0.4 * r.tamanho;
  const achados: { g: Glifo; u: number }[] = [];
  for (const op of analise.ops) {
    for (const el of op.elementos) {
      if (typeof el === "number") continue;
      const dx = el.x + el.ax / 2 - r.x;
      const dy = el.y + el.ay / 2 - r.y;
      const u = dx * r.ux + dy * r.uy;
      if (u < -folga || u > r.largura + folga) continue;
      const v = -dx * r.uy + dy * r.ux;
      if (Math.abs(v) > alturaMaxima) continue;
      // Texto em outra direção cruzando a linha (um carimbo de lado, por exemplo) não é dela.
      const comprimento = Math.hypot(el.ax, el.ay);
      if (comprimento > 0 && Math.abs(el.ax * r.ux + el.ay * r.uy) < 0.7 * comprimento) continue;
      achados.push({ g: el, u });
    }
  }
  achados.sort((a, b) => a.u - b.u);
  return achados.map((a) => a.g);
}

/* ------------------------------- Reescrever ---------------------------------- */

/** Um pedaço do texto novo. */
export type Trecho =
  /** Na fonte que já estava ali. `larguras` em milésimos do corpo, uma por código. */
  | { tipo: "mesma-fonte"; codigos: number[]; larguras: number[]; bytesPorCodigo: 1 | 2 }
  /** Numa fonte padrão, para a letra que a fonte do PDF não traz. `hexa` já está codificado. */
  | { tipo: "outra-fonte"; nomeDaFonte: string; hexa: string; larguras: number[]; espacos: number }
  /** Um espaço sem letra: a fonte do PDF não traz o caractere de espaço. */
  | { tipo: "vazio"; largura: number };

export type TrocaNoConteudo = {
  /** As letras que saem, da esquerda para a direita. */
  glifos: Glifo[];
  /** O que entra no lugar (vazio para só apagar). */
  trechos: Trecho[];
  /**
   * Escrever no fim do conteúdo, e não no lugar: o texto novo é mais largo que o
   * antigo e o recorte em vigor (o da célula de uma tabela do Excel, por exemplo)
   * o cortaria. Perde só a ordem de pintura em relação ao que vem depois.
   */
  noFim: boolean;
};

/**
 * Oito casas, e como texto: `Tf` minúsculo com a escala grande na matriz é comum, e o
 * arredondamento mudava o tamanho do resto da linha. Sem passar por `Number`, que
 * escreveria "1e-7", e o PDF não aceita expoente.
 */
function formatar(v: number): string {
  const s = v.toFixed(8).replace(/\.?0+$/, "");
  return s === "-0" || s === "" ? "0" : s;
}

function hexaDoCodigo(codigo: number, bytes: 1 | 2): string {
  return codigo
    .toString(16)
    .toUpperCase()
    .padStart(bytes * 2, "0");
}

/** Em milésimos do corpo, quanto o cursor anda ao mostrar o código: largura, Tc e Tw. */
function avancoEmMilesimos(op: OperacaoDeTexto, largura: number, ehEspaco: boolean): number {
  if (op.tamanho === 0) return 0;
  return largura + ((op.tc + (ehEspaco ? op.tw : 0)) * 1000) / op.tamanho;
}

function avancoDoTrecho(op: OperacaoDeTexto, t: Trecho): number {
  if (t.tipo === "vazio") return avancoEmMilesimos(op, t.largura, false);
  if (t.tipo === "outra-fonte") {
    let soma = 0;
    for (const l of t.larguras) soma += avancoEmMilesimos(op, l, false);
    // A fonte padrão é de um byte: o Tw vale nos espaços dela.
    if (op.tamanho !== 0) soma += (t.espacos * op.tw * 1000) / op.tamanho;
    return soma;
  }
  let soma = 0;
  t.larguras.forEach((l, k) => {
    soma += avancoEmMilesimos(op, l, t.bytesPorCodigo === 1 && t.codigos[k] === 32);
  });
  return soma;
}

/** A largura, no espaço do usuário, que os trechos ocupam escritos na operação `op`. */
export function larguraDosTrechos(op: OperacaoDeTexto, trechos: readonly Trecho[]): number {
  let milesimos = 0;
  for (const t of trechos) milesimos += avancoDoTrecho(op, t);
  const m = multiplicar(op.tm, op.ctm);
  return (milesimos / 1000) * op.tamanho * op.th * Math.hypot(m[0], m[1]);
}

/** O texto que entra no lugar da operação, com as letras tiradas e o texto novo inserido. */
function gerarOperacao(
  op: OperacaoDeTexto,
  bytes: 1 | 2,
  larguraDe: (codigo: number) => number,
  saindo: ReadonlySet<Glifo>,
  entrando: ReadonlyMap<Glifo, readonly Trecho[]>,
): string {
  let s = "";
  if (op.tipo === "'") s += "T*\n";
  if (op.tipo === '"') s += `${formatar(op.aw)} Tw ${formatar(op.ac)} Tc T*\n`;

  let lista = "";
  let hexa = "";
  let pendente = 0;
  const fecharHexa = () => {
    if (hexa) lista += `<${hexa}>`;
    hexa = "";
  };
  const soltarPendente = () => {
    if (Math.abs(pendente) > 1e-4) {
      fecharHexa();
      lista += ` ${formatar(pendente)} `;
    }
    pendente = 0;
  };
  const fecharLista = () => {
    soltarPendente();
    fecharHexa();
    if (lista) s += `[${lista}]TJ\n`;
    lista = "";
  };

  for (const el of op.elementos) {
    if (typeof el === "number") {
      pendente += el;
      continue;
    }
    const trechos = entrando.get(el);
    if (trechos) {
      let total = 0;
      for (const t of trechos) {
        total += avancoDoTrecho(op, t);
        if (t.tipo === "mesma-fonte") {
          soltarPendente();
          for (const c of t.codigos) hexa += hexaDoCodigo(c, t.bytesPorCodigo);
        } else if (t.tipo === "vazio") {
          pendente -= avancoEmMilesimos(op, t.largura, false);
        } else {
          fecharLista();
          s += `/${t.nomeDaFonte} ${formatar(op.tamanho)} Tf <${t.hexa}> Tj\n/${op.fonte} ${formatar(op.tamanho)} Tf\n`;
        }
      }
      // O cursor volta ao ponto de partida: quem vem depois nesta operação fica onde estava.
      pendente += total;
    }
    if (saindo.has(el)) {
      // A letra sai, mas o avanço dela fica: quem vem depois não pode mudar de lugar.
      pendente -= avancoEmMilesimos(op, larguraDe(el.codigo), bytes === 1 && el.codigo === 32);
    } else {
      soltarPendente();
      hexa += hexaDoCodigo(el.codigo, bytes);
    }
  }
  fecharLista();
  return s;
}

/** O mesmo texto novo, escrito no fim do conteúdo com o estado copiado da letra de partida. */
function gerarNoFim(g: Glifo, trechos: readonly Trecho[]): string {
  const op = g.op;
  const m = multiplicar(multiplicar(deslocamento(g.tx, 0), op.tm), op.ctm);
  let s = "q\n";
  for (const nome of op.gs) s += `/${nome} gs\n`;
  if (op.cor) s += `${op.cor}\n`;
  s += `BT\n/${op.fonte} ${formatar(op.tamanho)} Tf\n`;
  if (op.tc) s += `${formatar(op.tc)} Tc\n`;
  if (op.tw) s += `${formatar(op.tw)} Tw\n`;
  if (op.th !== 1) s += `${formatar(op.th * 100)} Tz\n`;
  if (op.ts) s += `${formatar(op.ts)} Ts\n`;
  if (op.tr) s += `${formatar(op.tr)} Tr\n`;
  s += `${m.map(formatar).join(" ")} Tm\n`;
  for (const t of trechos) {
    if (t.tipo === "mesma-fonte") {
      s += `<${t.codigos.map((c) => hexaDoCodigo(c, t.bytesPorCodigo)).join("")}> Tj\n`;
    } else if (t.tipo === "vazio") {
      s += `[${formatar(-t.largura)}]TJ\n`;
    } else {
      s += `/${t.nomeDaFonte} ${formatar(op.tamanho)} Tf <${t.hexa}> Tj\n/${op.fonte} ${formatar(op.tamanho)} Tf\n`;
    }
  }
  return `${s}ET\nQ\n`;
}

/**
 * O `BDC` sem a chave `/ActualText` (e o valor dela: texto entre parênteses, com os escapes e
 * os parênteses aninhados, ou hexadecimal entre `<` e `>`). O resto do dicionário fica.
 */
function semTextoReal(s: string): string {
  const k = s.indexOf("/ActualText");
  if (k < 0) return s;
  let i = k + "/ActualText".length;
  while (i < s.length && /\s/.test(s[i]!)) i++;
  let fim = i;
  if (s[i] === "(") {
    let nivel = 0;
    for (fim = i; fim < s.length; fim++) {
      const c = s[fim];
      if (c === "\\") {
        fim++;
        continue;
      }
      if (c === "(") nivel++;
      else if (c === ")" && --nivel === 0) {
        fim++;
        break;
      }
    }
  } else if (s[i] === "<") {
    const fecha = s.indexOf(">", i);
    fim = fecha < 0 ? s.length : fecha + 1;
  }
  return semTextoReal(`${s.slice(0, k)} ${s.slice(fim)}`);
}

function bytesDoTexto(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let k = 0; k < s.length; k++) b[k] = s.charCodeAt(k) & 0xff;
  return b;
}

/**
 * Aplica as trocas e devolve o conteúdo novo. Só as operações tocadas mudam: o
 * resto sai byte a byte como entrou. Tudo fica entre `q` e `Q` para o que for
 * desenhado depois não herdar uma matriz deixada solta (o Chrome começa a página
 * com um `cm` fora de qualquer `q`).
 */
export function reescreverConteudo(
  original: Uint8Array,
  analise: AnaliseDoConteudo,
  trocas: readonly TrocaNoConteudo[],
  fonteDe: (nome: string) => FonteDoConteudo | null,
): Uint8Array {
  const saindo = new Set<Glifo>();
  const entrando = new Map<Glifo, readonly Trecho[]>();
  let noFim = "";
  for (const t of trocas) {
    const primeiro = t.glifos[0];
    if (!primeiro) continue;
    for (const g of t.glifos) saindo.add(g);
    if (t.trechos.length === 0) continue;
    if (t.noFim) noFim += gerarNoFim(primeiro, t.trechos);
    else entrando.set(primeiro, t.trechos);
  }

  const tocadas = new Set<OperacaoDeTexto>();
  for (const g of saindo) tocadas.add(g.op);

  /* O que muda, em ordem no arquivo: as operações tocadas e os `Q` sem `q`. */
  const mudancas: { inicio: number; fim: number; texto: string }[] = [];
  for (const op of analise.ops) {
    if (!tocadas.has(op)) continue;
    const fonte = fonteDe(op.fonte);
    if (!fonte) continue;
    mudancas.push({
      inicio: op.inicio,
      fim: op.fim,
      texto: gerarOperacao(op, fonte.bytesPorCodigo, fonte.largura, saindo, entrando),
    });
  }
  for (const q of analise.qDemais) mudancas.push({ ...q, texto: "" });
  /* O trecho marcado com `/ActualText` em volta de uma letra trocada perde o `/ActualText`:
     senão a busca e o copiar continuariam lendo o texto ANTIGO no lugar do novo (12/11/2026).
     As letras de verdade, que já são as novas, passam a valer. */
  const marcasTocadas = new Set<MarcaComTexto>();
  for (const op of tocadas) for (const m of op.marcas) marcasTocadas.add(m);
  for (const m of marcasTocadas) {
    mudancas.push({ ...m, texto: semTextoReal(latin1(original, m.inicio, m.fim)) });
  }
  mudancas.sort((a, b) => a.inicio - b.inicio);

  const pedacos: Uint8Array[] = [bytesDoTexto("q\n")];
  let cursor = 0;
  for (const m of mudancas) {
    pedacos.push(original.subarray(cursor, m.inicio));
    pedacos.push(bytesDoTexto(m.texto));
    cursor = m.fim;
  }
  pedacos.push(original.subarray(cursor));
  pedacos.push(bytesDoTexto(`\n${"Q\n".repeat(analise.profundidade + 1)}${noFim}`));

  const total = pedacos.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of pedacos) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}
