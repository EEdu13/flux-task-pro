import type { LinhaDeTexto } from "../locais/editor/linhas";
import type { Rgb } from "../locais/editor/pagina";

/*
 * O que o Editor de PDF guarda enquanto a pessoa edita (05/11/2026). Tudo aqui é
 * imutável: desfazer é voltar ao estado anterior, sem nada a reverter no arquivo. O
 * PDF só é tocado na hora de salvar (`locais/editor/aplicar.ts`).
 *
 * COORDENADAS. Tudo em pontos do PDF, com a origem no canto de cima, à esquerda, e y
 * para baixo, como na tela. Cada objeto vive numa "camada" com o giro que a página
 * tinha quando ele foi criado (`giroDaCamada`): assim a assinatura posta numa página
 * deitada nasce de pé, e continua presa ao conteúdo se a página girar de novo, sem
 * precisar de rotação por objeto.
 */

export type Giro = 0 | 90 | 180 | 270;
export type Familia = "sans" | "serif" | "mono";
export type Alinhamento = "esquerda" | "centro" | "direita";

export type Ferramenta =
  "editar" | "texto" | "realce" | "desenho" | "retangulo" | "elipse" | "linha" | "seta";

export type PaginaDoEditor = {
  id: string;
  /** Índice do documento aberto (0 é o principal). `null` = página em branco. */
  documento: number | null;
  indice: number;
  /** O tamanho em pontos, com o giro que o próprio PDF já traz. */
  largura: number;
  altura: number;
  /** O giro que a pessoa deu, somado ao do PDF. */
  giro: Giro;
};

type Caixa = {
  id: string;
  paginaId: string;
  giroDaCamada: Giro;
  x: number;
  y: number;
  l: number;
  a: number;
};

export type ObjetoTexto = Caixa & {
  tipo: "texto";
  texto: string;
  familia: Familia;
  tamanho: number;
  cor: string;
  negrito: boolean;
  italico: boolean;
  alinhamento: Alinhamento;
};

export type ObjetoImagem = Caixa & { tipo: "imagem"; imagemId: string };

export type ObjetoForma = Caixa & {
  tipo: "retangulo" | "elipse";
  cor: string;
  espessura: number;
  preenchimento: string | null;
};

/** `pontos` de 0 a 1 dentro da caixa: redimensionar é só mudar a caixa. */
export type ObjetoLinha = Caixa & {
  tipo: "linha" | "seta" | "traco";
  cor: string;
  espessura: number;
  pontos: readonly (readonly [number, number])[];
};

export type ObjetoRealce = Caixa & { tipo: "realce"; cor: string };

export type Objeto = ObjetoTexto | ObjetoImagem | ObjetoForma | ObjetoLinha | ObjetoRealce;

/** A troca de uma linha que já estava no PDF. */
export type EdicaoNoEstado = {
  paginaId: string;
  linha: LinhaDeTexto;
  texto: string;
  corDeFundo: Rgb;
  corDoTexto: Rgb;
};

/** O valor de um campo de formulário: o texto, marcado ou não, ou a opção escolhida. */
export type ValorDeCampo = string | boolean;

export type EstadoDoEditor = {
  paginas: readonly PaginaDoEditor[];
  objetos: readonly Objeto[];
  /** Pela chave `paginaId:linhaId`. */
  edicoes: Readonly<Record<string, EdicaoNoEstado>>;
  /** Os campos de formulário mudados (12/11/2026), pelo nome completo do campo no PDF. */
  campos?: Readonly<Record<string, ValorDeCampo>>;
};

/**
 * O que está sendo digitado e ainda não entrou no estado (12/11/2026): a linha aberta, a caixa
 * de texto ou o campo de formulário com o cursor dentro. Entra no rascunho e no aviso de sair,
 * para um F5 no meio da digitação não perder o que foi escrito.
 */
export type Pendente =
  | {
      tipo: "linha";
      paginaId: string;
      linha: LinhaDeTexto;
      texto: string;
      cores: { fundo: Rgb; texto: Rgb };
    }
  | { tipo: "objeto"; id: string; texto: string }
  /** A caixa de texto que ainda está nascendo: ela só entra no estado ao terminar. */
  | { tipo: "novo"; objeto: ObjetoTexto }
  | { tipo: "campo"; nome: string; valor: string };

/** O estado com o que está sendo digitado já dentro, como se a pessoa tivesse confirmado. */
export function comPendente(e: EstadoDoEditor, p: Pendente | null): EstadoDoEditor {
  if (!p) return e;
  if (p.tipo === "linha") {
    const edicao: EdicaoNoEstado = {
      paginaId: p.paginaId,
      linha: p.linha,
      texto: p.texto,
      corDeFundo: p.cores.fundo,
      corDoTexto: p.cores.texto,
    };
    return { ...e, edicoes: { ...e.edicoes, [chaveDaEdicao(p.paginaId, p.linha.id)]: edicao } };
  }
  if (p.tipo === "objeto") {
    return {
      ...e,
      objetos: e.objetos.map((o) =>
        o.id === p.id && o.tipo === "texto" ? { ...o, texto: p.texto } : o,
      ),
    };
  }
  if (p.tipo === "novo") return { ...e, objetos: [...e.objetos, p.objeto] };
  return { ...e, campos: { ...e.campos, [p.nome]: p.valor } };
}

/** Fora do histórico: os bytes não mudam, e desfazer só tira o objeto que aponta para eles. */
export type ImagemGuardada = {
  bytes: Uint8Array;
  tipo: "png" | "jpg";
  largura: number;
  altura: number;
  url: string;
};

/** O que o estilo atual põe nos objetos novos. */
export type Estilo = {
  familia: Familia;
  tamanho: number;
  corDoTexto: string;
  negrito: boolean;
  italico: boolean;
  alinhamento: Alinhamento;
  corDoTraco: string;
  espessura: number;
  preenchimento: string | null;
  corDoRealce: string;
};

export const ESTILO_INICIAL: Estilo = {
  familia: "sans",
  tamanho: 12,
  corDoTexto: "#111827",
  negrito: false,
  italico: false,
  alinhamento: "esquerda",
  corDoTraco: "#dc2626",
  espessura: 2,
  preenchimento: null,
  corDoRealce: "#fde047",
};

export const CORES = ["#111827", "#ffffff", "#dc2626", "#2563eb", "#16a34a", "#f59e0b"] as const;

let contador = 0;
export function novoId(prefixo: string): string {
  return `${prefixo}-${Date.now().toString(36)}-${++contador}`;
}

export const chaveDaEdicao = (paginaId: string, linhaId: string) => `${paginaId}:${linhaId}`;

export function somarGiro(g: Giro, delta: number): Giro {
  return ((((g + delta) % 360) + 360) % 360) as Giro;
}

/** A página deitada troca largura e altura. */
export function medidasNaTela(p: { largura: number; altura: number }, giro: number) {
  const deitada = giro === 90 || giro === 270;
  return { largura: deitada ? p.altura : p.largura, altura: deitada ? p.largura : p.altura };
}

/* --------------------------------- Texto ------------------------------------ */

/** Distância entre linhas de uma caixa de texto, em corpos da letra. */
export const ENTRELINHA = 1.2;

/**
 * Onde a linha de base cai dentro da linha (em corpos da letra), com a `ENTRELINHA`
 * acima, nas fontes da tela. É o que deixa o texto salvo na mesma altura do que a
 * pessoa viu. Arial, Times New Roman e Courier New têm as mesmas larguras das fontes
 * padrão do PDF (Helvetica, Times e Courier), e por isso são elas na tela.
 */
const BASE_DA_LINHA: Record<Familia, number> = { sans: 0.9465, serif: 0.9375, mono: 0.8665 };

export const baseDaLinha = (f: Familia) => BASE_DA_LINHA[f];

export const FONTE_CSS: Record<Familia, string> = {
  sans: 'Arial, Helvetica, "Liberation Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
  mono: '"Courier New", Courier, "Liberation Mono", monospace',
};

let medidor: CanvasRenderingContext2D | null = null;

/** A largura do texto em pontos, no corpo pedido. A mesma conta na tela e ao salvar. */
export function larguraDoTexto(
  texto: string,
  f: { familia: Familia; tamanho: number; negrito: boolean; italico: boolean },
): number {
  medidor ??= document.createElement("canvas").getContext("2d");
  if (!medidor) return texto.length * f.tamanho * 0.5;
  medidor.font = `${f.italico ? "italic " : ""}${f.negrito ? "bold " : ""}100px ${FONTE_CSS[f.familia]}`;
  return (medidor.measureText(texto).width * f.tamanho) / 100;
}

/** Quebra o texto na largura da caixa: nas quebras que a pessoa deu e entre as palavras. */
export function quebrarLinhas(
  texto: string,
  largura: number,
  f: { familia: Familia; tamanho: number; negrito: boolean; italico: boolean },
): string[] {
  const saida: string[] = [];
  // Texto colado do Excel traz tabulação, que nenhuma fonte padrão escreve.
  for (const paragrafo of texto.replace(/\t/g, "    ").split(/\r?\n/)) {
    let linha = "";
    for (const palavra of paragrafo.split(/(?<= )/)) {
      const tentativa = linha + palavra;
      if (larguraDoTexto(tentativa.trimEnd(), f) <= largura || !linha) {
        linha = tentativa;
      } else {
        saida.push(linha.trimEnd());
        linha = palavra;
      }
      // Uma palavra maior que a caixa inteira: quebra no meio, letra a letra.
      while (larguraDoTexto(linha.trimEnd(), f) > largura && Array.from(linha).length > 1) {
        const letras = Array.from(linha);
        let n = letras.length - 1;
        while (n > 1 && larguraDoTexto(letras.slice(0, n).join(""), f) > largura) n--;
        saida.push(letras.slice(0, n).join(""));
        linha = letras.slice(n).join("");
      }
    }
    saida.push(linha.trimEnd());
  }
  return saida;
}

/** A altura da caixa com este texto. */
export function alturaDoTexto(
  o: Pick<ObjetoTexto, "texto" | "l" | "familia" | "tamanho" | "negrito" | "italico">,
): number {
  return quebrarLinhas(o.texto, o.l, o).length * o.tamanho * ENTRELINHA;
}

/* --------------------------------- Cores ------------------------------------- */

export function rgbDe(hexa: string): Rgb {
  const n = parseInt(hexa.replace("#", ""), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function cssDe(c: Rgb): string {
  const parte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${parte(c.r)} ${parte(c.g)} ${parte(c.b)})`;
}

/**
 * A cor do fundo e a do texto de um pedaço da página desenhada. O fundo é a cor mais
 * comum; o texto, o pixel mais diferente dela. Servem à pré-visualização enquanto se
 * digita, e para quando a linha precisa ser coberta em vez de trocada.
 */
export function amostrarCores(
  canvas: HTMLCanvasElement,
  caixa: { x0: number; y0: number; x1: number; y1: number },
): { fundo: Rgb; texto: Rgb } {
  const padrao = { fundo: { r: 1, g: 1, b: 1 }, texto: { r: 0, g: 0, b: 0 } };
  const x0 = Math.max(0, Math.floor(caixa.x0));
  const y0 = Math.max(0, Math.floor(caixa.y0));
  const l = Math.min(canvas.width - x0, Math.ceil(caixa.x1 - caixa.x0));
  const a = Math.min(canvas.height - y0, Math.ceil(caixa.y1 - caixa.y0));
  const ctx = canvas.getContext("2d");
  if (!ctx || l <= 0 || a <= 0) return padrao;
  let dados: Uint8ClampedArray;
  try {
    dados = ctx.getImageData(x0, y0, l, a).data;
  } catch {
    return padrao;
  }
  const contagem = new Map<number, number>();
  let melhor = 0;
  let maior = 0;
  for (let i = 0; i < dados.length; i += 4) {
    const chave = ((dados[i]! >> 3) << 10) | ((dados[i + 1]! >> 3) << 5) | (dados[i + 2]! >> 3);
    const n = (contagem.get(chave) ?? 0) + 1;
    contagem.set(chave, n);
    if (n > maior) {
      maior = n;
      melhor = chave;
    }
  }
  /* A média só dos pixels da cor mais comum: o fundo branco sai branco de verdade, e não
     o meio da faixa (#FCFCFC), que apareceria como um remendo na hora de cobrir. */
  let somaR = 0;
  let somaG = 0;
  let somaB = 0;
  for (let i = 0; i < dados.length; i += 4) {
    const chave = ((dados[i]! >> 3) << 10) | ((dados[i + 1]! >> 3) << 5) | (dados[i + 2]! >> 3);
    if (chave !== melhor) continue;
    somaR += dados[i]!;
    somaG += dados[i + 1]!;
    somaB += dados[i + 2]!;
  }
  const fr = somaR / Math.max(1, maior);
  const fg = somaG / Math.max(1, maior);
  const fb = somaB / Math.max(1, maior);
  let distancia = -1;
  let tr = 0;
  let tg = 0;
  let tb = 0;
  for (let i = 0; i < dados.length; i += 4) {
    const d =
      Math.abs(dados[i]! - fr) + Math.abs(dados[i + 1]! - fg) + Math.abs(dados[i + 2]! - fb);
    if (d > distancia) {
      distancia = d;
      tr = dados[i]!;
      tg = dados[i + 1]!;
      tb = dados[i + 2]!;
    }
  }
  return {
    fundo: { r: fr / 255, g: fg / 255, b: fb / 255 },
    texto: { r: tr / 255, g: tg / 255, b: tb / 255 },
  };
}
