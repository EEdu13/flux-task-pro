import type { Celula, Mescla } from "@/lib/planilha-xlsx";

/*
 * PDF → Excel, a parte das contas (11/11/2026): de pedaços de texto com posição para as linhas
 * de uma planilha. Sem tela e sem pdf.js, para testar no Node com PDFs de verdade
 * (`tests/pdf-excel.test.ts`).
 *
 * O jeito, desenhado com os pedidos reais do usuário (tabela com bordas e formulário de rótulo e
 * valor, A4 deitada):
 * 1. Cada linha do PDF vira uma linha da planilha: os pedaços com a mesma linha de base se
 *    juntam, e os vizinhos quase colados viram um só.
 * 2. As colunas saem dos COMEÇOS dos pedaços: começos que nunca aparecem juntos na mesma linha e
 *    cujas faixas se sobrepõem são a mesma coluna (cabeçalho centralizado em cima do dado, número
 *    alinhado à direita). A primeira ideia, a dos corredores vazios de cima a baixo, falhou no
 *    formulário: uma linha comprida e os separadores "-" fechavam os corredores.
 * 3. Cada pedaço entra na coluna onde começa (o texto longo fica nela e transborda, como no
 *    Excel). Um vão grande entre linhas vira uma linha em branco, separando os blocos.
 * 4. O valor é lido como no Brasil: "1.234,56", "R$ 1.234,56" e "(1.234,56)" viram número;
 *    "dd/mm/aaaa" vira data. Código com zero à esquerda, CPF, CNPJ, CEP, telefone e porcentagem
 *    continuam texto.
 *
 * Desde 12/11/2026:
 * 5. **A grade desenhada.** Quando o PDF desenha as bordas da tabela, elas mandam: os traços retos
 *    (linhas e retângulos finos) viram uma grade, cada célula é um retângulo exato, o texto em duas
 *    linhas dentro da célula fica numa célula só, e a célula que ocupa várias colunas sai MESCLADA
 *    no Excel. Uma grade só vale como tabela com ao menos 2×2 células e a maioria das células com
 *    até 2 linhas de texto: a caixa em volta de uma seção de formulário não é tabela, e o texto
 *    dela segue o jeito do item 2.
 * 6. **Tudo numa aba**, como opção: o relatório de várias páginas vira uma tabela só. Saem o
 *    cabeçalho e o rodapé que se repetem em cada página (o cabeçalho fica o da primeira; o
 *    rodapé, o da última) e a linha de títulos repetida no alto da tabela de cada página.
 * 7. **O tipo pela coluna inteira**: coluna de códigos com zero à esquerda deixa todos os números
 *    dela como texto; coluna com "R$" sai toda em moeda, e coluna com centavos, toda com duas
 *    casas.
 */

/** Um pedaço de texto da página na orientação de leitura: x da esquerda para a direita, y da
 *  linha de base de cima para baixo, em pontos. */
export type Trecho = { x0: number; x1: number; y: number; altura: number; texto: string };

/** `naBorda`: a linha mora na faixa do alto ou do pé da página, onde ficam cabeçalho e rodapé. */
export type Linha = { y: number; altura: number; trechos: Trecho[]; naBorda?: boolean };
/** Uma coluna: onde começam os pedaços dela (`inicio` a `ultimoComeco`) e até onde vão (`fim`). */
type Coluna = { inicio: number; ultimoComeco: number; fim: number };

/** O pedaço do pdf.js que interessa aqui (a página aberta), sem depender dele para testar. */
export type PaginaDoPdfjs = {
  getViewport(opcoes: { scale: number }): { transform: number[]; width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(): Promise<ListaDeOperacoes>;
  cleanup(): void;
};

/** O desenho da página, como o pdf.js o entrega (`getOperatorList`). */
export type ListaDeOperacoes = { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> };

/** Matriz 2D: aplica `m2` e depois `m1` (o `Util.transform` do pdf.js). */
function compor(m1: number[], m2: number[]): number[] {
  const [a1, b1, c1, d1, e1, f1] = m1 as [number, number, number, number, number, number];
  const [a2, b2, c2, d2, e2, f2] = m2 as [number, number, number, number, number, number];
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/**
 * 0. O texto da página na orientação de leitura. A matriz da visualização já desfaz o giro da
 * página (/Rotate) e põe o y de cima para baixo; o texto que fica de lado mesmo assim (uma
 * etiqueta vertical na margem) fica de fora, porque não cabe numa linha da planilha.
 */
export async function trechosDaPagina(pagina: PaginaDoPdfjs): Promise<Trecho[]> {
  const visualizacao = pagina.getViewport({ scale: 1 });
  const conteudo = await pagina.getTextContent();
  const trechos: Trecho[] = [];
  for (const item of conteudo.items) {
    const i = item as { str?: string; transform?: number[]; width?: number; height?: number };
    if (!i.str || !i.str.trim() || !i.transform) continue;
    const [a, b, c, d, e, f] = compor(visualizacao.transform, i.transform) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    if (a <= 0 || Math.abs(b) > Math.abs(a) * 0.2) continue;
    const altura = Math.hypot(c, d) || i.height || 0;
    trechos.push({ x0: e, x1: e + (i.width ?? 0), y: f, altura, texto: i.str });
  }
  return trechos;
}

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const s = [...valores].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Pedaços quase colados na mesma linha (menos de ~1 espaço e meio) são um texto só. */
function juntarVizinhos(trechos: Trecho[]): Trecho[] {
  const juntos: Trecho[] = [];
  for (const t of trechos) {
    const anterior = juntos[juntos.length - 1];
    const vao = anterior ? t.x0 - anterior.x1 : Infinity;
    if (anterior && vao < 0.4 * Math.max(anterior.altura, t.altura)) {
      const espaco = vao > 0.1 * anterior.altura ? " " : "";
      juntos[juntos.length - 1] = {
        ...anterior,
        x1: Math.max(anterior.x1, t.x1),
        altura: Math.max(anterior.altura, t.altura),
        texto: anterior.texto + espaco + t.texto,
      };
    } else {
      juntos.push({ ...t });
    }
  }
  return juntos.map((t) => ({ ...t, texto: t.texto.replace(/\s+/g, " ").trim() }));
}

/** 1. As linhas, de cima para baixo: mesma linha de base, com folga de meia altura de letra. */
export function agruparLinhas(trechos: Trecho[]): Linha[] {
  const ordenados = trechos
    .filter((t) => t.texto.trim() !== "" && Number.isFinite(t.x0) && Number.isFinite(t.y))
    .sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const linhas: Linha[] = [];
  for (const t of ordenados) {
    const ultima = linhas[linhas.length - 1];
    const folga = Math.max(2, 0.5 * Math.min(t.altura, ultima?.altura ?? t.altura));
    if (ultima && t.y - ultima.y <= folga) ultima.trechos.push(t);
    else linhas.push({ y: t.y, altura: t.altura, trechos: [t] });
  }
  for (const l of linhas) {
    l.trechos = juntarVizinhos(l.trechos.sort((a, b) => a.x0 - b.x0));
    l.altura = Math.max(...l.trechos.map((t) => t.altura));
  }
  return linhas;
}

/** Folga para dois pedaços contarem como "começando no mesmo lugar", em pontos. */
const FOLGA_DO_COMECO = 2;

/**
 * 2. As colunas. Cada começo de pedaço (x0) é uma candidata; duas candidatas vizinhas viram uma
 * coluna só quando NUNCA aparecem na mesma linha e uma ocupa a faixa da outra — o cabeçalho
 * centralizado em cima do dado, o número alinhado à direita, a linha comprida de cima da página.
 * Assim, dois pedaços da mesma linha nunca caem na mesma célula.
 */
export function acharColunas(linhas: Linha[]): Coluna[] {
  type Grupo = Coluna & { linhas: Set<number> };
  const pedacos = linhas
    .flatMap((l, i) => l.trechos.map((t) => ({ t, i })))
    .sort((a, b) => a.t.x0 - b.t.x0);
  const grupos: Grupo[] = [];
  for (const { t, i } of pedacos) {
    const g = grupos[grupos.length - 1];
    if (g && t.x0 - g.ultimoComeco <= FOLGA_DO_COMECO) {
      g.ultimoComeco = t.x0;
      g.fim = Math.max(g.fim, t.x1);
      g.linhas.add(i);
    } else {
      grupos.push({ inicio: t.x0, ultimoComeco: t.x0, fim: t.x1, linhas: new Set([i]) });
    }
  }
  for (let k = 0; k + 1 < grupos.length;) {
    const a = grupos[k]!;
    const b = grupos[k + 1]!;
    const juntosNumaLinha = [...b.linhas].some((i) => a.linhas.has(i));
    const sobrepoem = b.inicio <= a.fim && a.inicio <= b.fim;
    if (!juntosNumaLinha && sobrepoem) {
      grupos.splice(k, 2, {
        inicio: Math.min(a.inicio, b.inicio),
        ultimoComeco: Math.max(a.ultimoComeco, b.ultimoComeco),
        fim: Math.max(a.fim, b.fim),
        linhas: new Set([...a.linhas, ...b.linhas]),
      });
      k = Math.max(0, k - 1); // a junção pode agora encostar na vizinha da esquerda
    } else {
      k++;
    }
  }
  return grupos.map(({ inicio, ultimoComeco, fim }) => ({ inicio, ultimoComeco, fim }));
}

/**
 * 3. A coluna de um pedaço: a que tem o começo dele. O pedaço que não ajudou a achar as colunas
 * (o rodapé centralizado) vai para a coluna onde está o meio dele, ou para a última que começa
 * antes dele.
 */
function colunaDe(t: Trecho, colunas: Coluna[]): number {
  const i = colunas.findIndex((c) => t.x0 >= c.inicio - 0.01 && t.x0 <= c.ultimoComeco + 0.01);
  if (i >= 0) return i;
  const meio = (t.x0 + t.x1) / 2;
  const peloMeio = colunas.findIndex((c) => meio >= c.inicio && meio <= c.fim);
  if (peloMeio >= 0) return peloMeio;
  let antes = 0;
  colunas.forEach((c, k) => {
    if (c.inicio <= t.x0) antes = k;
  });
  return antes;
}

const DATA = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const NUMERO = /^(R\$\s?)?(\(?)(-?)\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(\)?)(-?)$/;

/** 4. O valor de uma célula, lido como no Brasil. */
export function lerValor(bruto: string): Celula {
  const texto = bruto.replace(/\u00a0/g, " ").trim();
  if (!texto) return null;

  const d = DATA.exec(texto);
  if (d) {
    const [dia, mes, ano] = [Number(d[1]), Number(d[2]), Number(d[3])];
    const data = new Date(
      ano,
      mes - 1,
      dia,
      Number(d[4] ?? 0),
      Number(d[5] ?? 0),
      Number(d[6] ?? 0),
    );
    const valida =
      data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia;
    if (!valida) return texto;
    return d[4] === undefined ? { data } : data;
  }

  const n = NUMERO.exec(texto);
  if (n) {
    const [, moeda, abre, menos, inteiro, decimais, fecha, menosNoFim] = n;
    if (Boolean(abre) !== Boolean(fecha)) return texto;
    const digitos = inteiro!.replace(/\./g, "");
    // Zero à esquerda sem vírgula é código (pedido 000123), não número; acima de 15 dígitos o Excel arredonda.
    if (digitos.length > 1 && digitos.startsWith("0") && !decimais && !moeda) return texto;
    if (digitos.length > 15) return texto;
    const valor = Number(decimais ? `${digitos}.${decimais}` : digitos);
    return abre || menos || menosNoFim ? -valor : valor;
  }
  return texto;
}

/* ---------------------- 7. O tipo pela coluna inteira ---------------------- */

type FormatoDaColuna = { codigos: boolean; moeda: boolean; decimal: boolean };

function formatoDaColuna(textos: string[]): FormatoDaColuna {
  let codigos = 0;
  let inteiros = 0;
  let moeda = false;
  let decimal = false;
  for (const bruto of textos) {
    const t = bruto.replace(/\u00a0/g, " ").trim();
    if (!t) continue;
    if (/^0\d+$/.test(t)) codigos++;
    else if (/^[1-9]\d*$/.test(t)) inteiros++;
    if (typeof lerValor(t) !== "number") continue;
    if (/R\$/.test(t)) moeda = true;
    else if (/,\d+\)?-?$/.test(t)) decimal = true;
  }
  return { codigos: codigos > 0 && codigos >= inteiros, moeda, decimal };
}

function valorNaColuna(bruto: string, formato: FormatoDaColuna): Celula {
  const v = lerValor(bruto);
  if (typeof v !== "number") return v;
  // Na coluna de códigos ("000123"), o "123" também é código, não número.
  if (formato.codigos && /^\d+$/.test(bruto.trim())) return bruto.trim();
  if (formato.moeda) return { numero: v, formato: "moeda" };
  if (formato.decimal) return { numero: v, formato: "decimal" };
  return v;
}

/** Os textos de uma parte da planilha, lidos coluna a coluna. */
function tiparColunas(textos: string[][]): Celula[][] {
  const largura = Math.max(0, ...textos.map((l) => l.length));
  const formatos = Array.from({ length: largura }, (_, c) =>
    formatoDaColuna(textos.map((l) => l[c] ?? "")),
  );
  return textos.map((l) => {
    let fim = l.length;
    while (fim > 0 && !l[fim - 1]) fim--;
    return l.slice(0, fim).map((t, c) => valorNaColuna(t, formatos[c]!));
  });
}

/* ------------------------- 5. A grade desenhada ------------------------- */

/** Um traço reto, horizontal ou vertical, na orientação de leitura (a mesma dos trechos). */
export type Traco = { x0: number; y0: number; x1: number; y1: number };
export type Tracos = { horizontais: Traco[]; verticais: Traco[] };

/** Os códigos do pdf.js (`OPS`) de que a leitura do desenho precisa. */
export type CodigosDoPdfjs = {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  stroke: number;
  closeStroke: number;
  fill: number;
  eoFill: number;
  fillStroke: number;
  eoFillStroke: number;
  closeFillStroke: number;
  closeEOFillStroke: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageMaskXObject: number;
};

// Os comandos de dentro de um caminho no pdf.js 6 (o `DrawOPS` dele, que não é exportado).
const MOVER = 0;
const RETA = 1;
const CURVA = 2;
const CURVA_SIMPLES = 3;
const FECHAR = 4;

/** Retângulo pintado com até isto de espessura é uma linha (a borda que o Word desenha assim). */
const ESPESSURA_DE_TRACO = 3;
/** Desvio aceito para um traço contar como horizontal ou vertical, em pontos. */
const DESVIO_DO_RETO = 1;
/** Folga para dois traços se encostarem, em pontos. */
const ENCOSTA = 2.5;
/** Uma célula de tabela de verdade tem até isto de linhas de texto (a da maioria). */
const LINHAS_POR_CELULA = 2;

type Ponto = { x: number; y: number; porReta: boolean };

/** O caminho do pdf.js em pedaços: cada um com os seus pontos e se fecha. */
function subcaminhos(d: ArrayLike<number>): { pontos: Ponto[]; fechado: boolean }[] {
  const saida: { pontos: Ponto[]; fechado: boolean }[] = [];
  let atual: { pontos: Ponto[]; fechado: boolean } | null = null;
  for (let i = 0; i < d.length;) {
    const op = d[i++];
    if (op === MOVER) {
      atual = { pontos: [{ x: d[i]!, y: d[i + 1]!, porReta: false }], fechado: false };
      saida.push(atual);
      i += 2;
    } else if (op === RETA) {
      atual?.pontos.push({ x: d[i]!, y: d[i + 1]!, porReta: true });
      i += 2;
    } else if (op === CURVA) {
      atual?.pontos.push({ x: d[i + 4]!, y: d[i + 5]!, porReta: false });
      i += 6;
    } else if (op === CURVA_SIMPLES) {
      atual?.pontos.push({ x: d[i + 2]!, y: d[i + 3]!, porReta: false });
      i += 4;
    } else if (op === FECHAR) {
      if (atual) atual.fechado = true;
    } else {
      break; // comando desconhecido: o resto do caminho não dá para ler
    }
  }
  return saida;
}

/** Traços quase colados na mesma reta viram um só. */
function juntarColineares(tracos: Traco[], horizontal: boolean): Traco[] {
  const posicao = (t: Traco) => (horizontal ? t.y0 : t.x0);
  const inicio = (t: Traco) => (horizontal ? t.x0 : t.y0);
  const ordenados = [...tracos].sort((a, b) => posicao(a) - posicao(b) || inicio(a) - inicio(b));
  const saida: Traco[] = [];
  for (const t of ordenados) {
    let juntou = false;
    for (let k = saida.length - 1; k >= 0; k--) {
      const s = saida[k]!;
      if (posicao(t) - posicao(s) > 1.5) break;
      const fim = horizontal ? s.x1 : s.y1;
      if (inicio(t) <= fim + ENCOSTA) {
        if (horizontal) s.x1 = Math.max(s.x1, t.x1);
        else s.y1 = Math.max(s.y1, t.y1);
        juntou = true;
        break;
      }
    }
    if (!juntou) saida.push({ ...t });
  }
  return saida;
}

/**
 * 5a. Os traços retos do desenho da página, na orientação de leitura: os contornos (linhas e
 * retângulos riscados) e os retângulos pintados finos. Curvas, diagonais e retângulos pintados
 * grossos (o fundo cinza de um cabeçalho) não contam.
 */
export function tracosDoDesenho(
  lista: ListaDeOperacoes,
  ops: CodigosDoPdfjs,
  visualizacao: number[],
): Tracos {
  const horizontais: Traco[] = [];
  const verticais: Traco[] = [];
  const contornos = new Set([
    ops.stroke,
    ops.closeStroke,
    ops.fillStroke,
    ops.eoFillStroke,
    ops.closeFillStroke,
    ops.closeEOFillStroke,
  ]);
  const pinturas = new Set([ops.fill, ops.eoFill]);
  let ctm = [1, 0, 0, 1, 0, 0];
  const pilha: number[][] = [];
  const guardar = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if (dy <= DESVIO_DO_RETO && dx > DESVIO_DO_RETO) {
      const y = (a.y + b.y) / 2;
      horizontais.push({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: y, y1: y });
    } else if (dx <= DESVIO_DO_RETO && dy > DESVIO_DO_RETO) {
      const x = (a.x + b.x) / 2;
      verticais.push({ x0: x, x1: x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
    }
  };
  for (let i = 0; i < lista.fnArray.length; i++) {
    const fn = lista.fnArray[i];
    const args = lista.argsArray[i] as unknown[] | null | undefined;
    if (fn === ops.save) pilha.push(ctm);
    else if (fn === ops.restore) ctm = pilha.pop() ?? ctm;
    else if (fn === ops.transform && args) ctm = compor(ctm, Array.from(args as number[]));
    else if (fn === ops.paintFormXObjectBegin) {
      pilha.push(ctm);
      const matriz = args?.[0] as ArrayLike<number> | null | undefined;
      if (matriz && matriz.length === 6) ctm = compor(ctm, Array.from(matriz));
    } else if (fn === ops.paintFormXObjectEnd) ctm = pilha.pop() ?? ctm;
    else if (fn === ops.constructPath && args) {
      const pintura = args[0] as number;
      const caminho = (args[1] as unknown[] | undefined)?.[0] as ArrayLike<number> | undefined;
      if (!caminho || (!contornos.has(pintura) && !pinturas.has(pintura))) continue;
      const m = compor(visualizacao, ctm) as [number, number, number, number, number, number];
      const naPagina = (p: Ponto) => ({
        x: m[0] * p.x + m[2] * p.y + m[4],
        y: m[1] * p.x + m[3] * p.y + m[5],
        porReta: p.porReta,
      });
      for (const s of subcaminhos(caminho)) {
        const pts = s.pontos.map(naPagina);
        if (contornos.has(pintura)) {
          for (let k = 1; k < pts.length; k++) if (pts[k]!.porReta) guardar(pts[k - 1]!, pts[k]!);
          if (s.fechado && pts.length > 2) guardar(pts[pts.length - 1]!, pts[0]!);
        } else if (pts.length >= 4 && pts.every((p, k) => k === 0 || p.porReta)) {
          const xs = pts.map((p) => p.x);
          const ys = pts.map((p) => p.y);
          const [x0, x1, y0, y1] = [
            Math.min(...xs),
            Math.max(...xs),
            Math.min(...ys),
            Math.max(...ys),
          ];
          if (y1 - y0 <= ESPESSURA_DE_TRACO && x1 - x0 > ESPESSURA_DE_TRACO) {
            const y = (y0 + y1) / 2;
            horizontais.push({ x0, x1, y0: y, y1: y });
          } else if (x1 - x0 <= ESPESSURA_DE_TRACO && y1 - y0 > ESPESSURA_DE_TRACO) {
            const x = (x0 + x1) / 2;
            verticais.push({ x0: x, x1: x, y0, y1 });
          }
        }
      }
    }
  }
  return {
    horizontais: juntarColineares(horizontais, true),
    verticais: juntarColineares(verticais, false),
  };
}

/* ------------------------- 8. As imagens da página ------------------------- */

/** Uma imagem pintada na página: onde (em pontos, na orientação de leitura) e com quantos pixels. */
export type ImagemDoDesenho = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pxLargura: number;
  pxAltura: number;
};

/**
 * 8a. As imagens do desenho da página (23/11/2026): a tabela que veio como imagem (print do Excel
 * colado no PDF) não tem texto para o pdf.js ler — `tabela-em-imagem.ts` a lê com o OCR. A imagem é
 * pintada no quadrado 0..1 da matriz do momento, como no `tracosDoDesenho`.
 */
export function imagensDoDesenho(
  lista: ListaDeOperacoes,
  ops: CodigosDoPdfjs,
  visualizacao: number[],
): ImagemDoDesenho[] {
  const imagens: ImagemDoDesenho[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const pilha: number[][] = [];
  for (let i = 0; i < lista.fnArray.length; i++) {
    const fn = lista.fnArray[i];
    const args = lista.argsArray[i] as unknown[] | null | undefined;
    if (fn === ops.save) pilha.push(ctm);
    else if (fn === ops.restore) ctm = pilha.pop() ?? ctm;
    else if (fn === ops.transform && args) ctm = compor(ctm, Array.from(args as number[]));
    else if (fn === ops.paintFormXObjectBegin) {
      pilha.push(ctm);
      const matriz = args?.[0] as ArrayLike<number> | null | undefined;
      if (matriz && matriz.length === 6) ctm = compor(ctm, Array.from(matriz));
    } else if (fn === ops.paintFormXObjectEnd) ctm = pilha.pop() ?? ctm;
    else if (
      (fn === ops.paintImageXObject ||
        fn === ops.paintInlineImageXObject ||
        fn === ops.paintImageMaskXObject) &&
      args
    ) {
      // paintImageXObject: [id, largura, altura]; as outras: [{ width, height, ... }].
      const dados = args[0] as { width?: number; height?: number } | string | undefined;
      const pxLargura = typeof dados === "object" ? (dados?.width ?? 0) : Number(args[1] ?? 0);
      const pxAltura = typeof dados === "object" ? (dados?.height ?? 0) : Number(args[2] ?? 0);
      const m = compor(visualizacao, ctm) as [number, number, number, number, number, number];
      const cantos = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([x, y]) => [m[0] * x! + m[2] * y! + m[4], m[1] * x! + m[3] * y! + m[5]] as const);
      const xs = cantos.map((c) => c[0]);
      const ys = cantos.map((c) => c[1]);
      imagens.push({
        x0: Math.min(...xs),
        x1: Math.max(...xs),
        y0: Math.min(...ys),
        y1: Math.max(...ys),
        pxLargura,
        pxAltura,
      });
    }
  }
  return imagens;
}

/**
 * Uma região da página para o OCR, e a escala (pixels por ponto) em que ela vai ser desenhada: na
 * largura (`pxPorPt`) e na altura (`pxPorPtY`). As duas seguem a imagem — a escaneada esticada para
 * caber na página tem uma escala em cada eixo, e desenhá-la com uma só borra as letras.
 */
export type RegiaoParaLer = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pxPorPt: number;
  pxPorPtY: number;
};

/** Imagem menor que isto (fração da página) é logo, carimbo, assinatura — não tabela. */
const AREA_MINIMA_DA_IMAGEM = 0.02;
/** Mais letras de texto de verdade que isto por cima da imagem: ela já tem texto (o PDF que passou pelo OCR). */
const LETRAS_POR_CIMA = 15;
/** A escala do desenho: a da própria imagem, entre ~180 e ~400 dpi... */
const ESCALA_MINIMA = 2.5;
const ESCALA_MAXIMA = 5.5;
/** ...e com teto de pixels (a página inteira escaneada, a 400 dpi, passa de 15 milhões). */
const PIXELS_MAXIMOS = 36_000_000;

/**
 * 8b. As imagens que valem ler com o OCR: grandes (2% da página ou mais, ao menos 1 polegada de largura)
 * e sem texto de verdade por cima. As que se encostam (a imagem cortada em faixas) viram uma região só.
 */
export function regioesParaLer(
  imagens: ImagemDoDesenho[],
  trechos: Trecho[],
  larguraDaPagina: number,
  alturaDaPagina: number,
): RegiaoParaLer[] {
  const areaDaPagina = larguraDaPagina * alturaDaPagina;
  const candidatas = imagens
    .map((im) => ({
      x0: Math.max(0, im.x0),
      y0: Math.max(0, im.y0),
      x1: Math.min(larguraDaPagina, im.x1),
      y1: Math.min(alturaDaPagina, im.y1),
      nativa: im.x1 > im.x0 ? im.pxLargura / (im.x1 - im.x0) : 0,
      // Altura sobre largura, na escala da imagem (1 = não esticada). Fora de 1/2..2, algo estranho
      // (imagem girada): desenha sem esticar.
      proporcao: (() => {
        const kx = im.x1 > im.x0 ? im.pxLargura / (im.x1 - im.x0) : 0;
        const ky = im.y1 > im.y0 ? im.pxAltura / (im.y1 - im.y0) : 0;
        const p = kx > 0 && ky > 0 ? ky / kx : 1;
        return p >= 0.5 && p <= 2 ? p : 1;
      })(),
    }))
    .filter(
      (r) =>
        r.x1 - r.x0 >= 72 &&
        r.y1 - r.y0 >= 30 &&
        (r.x1 - r.x0) * (r.y1 - r.y0) >= AREA_MINIMA_DA_IMAGEM * areaDaPagina,
    );
  // As que se encostam (até 2 pt) viram uma só.
  const juntas: typeof candidatas = [];
  for (const c of candidatas) {
    const outra = juntas.find(
      (j) => c.x0 <= j.x1 + 2 && j.x0 <= c.x1 + 2 && c.y0 <= j.y1 + 2 && j.y0 <= c.y1 + 2,
    );
    if (outra) {
      outra.x0 = Math.min(outra.x0, c.x0);
      outra.y0 = Math.min(outra.y0, c.y0);
      outra.x1 = Math.max(outra.x1, c.x1);
      outra.y1 = Math.max(outra.y1, c.y1);
      if (c.nativa > outra.nativa) {
        outra.nativa = c.nativa;
        outra.proporcao = c.proporcao;
      }
    } else {
      juntas.push({ ...c });
    }
  }
  return juntas
    .filter((r) => {
      let letras = 0;
      for (const t of trechos) {
        const p = centro(t);
        if (p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) {
          letras += t.texto.replace(/\s/g, "").length;
        }
      }
      return letras <= LETRAS_POR_CIMA;
    })
    .map((r) => {
      const area = (r.x1 - r.x0) * (r.y1 - r.y0);
      const escala = Math.min(
        Math.max(r.nativa, ESCALA_MINIMA),
        ESCALA_MAXIMA,
        Math.sqrt(PIXELS_MAXIMOS / (area * r.proporcao)),
      );
      return {
        x0: r.x0,
        y0: r.y0,
        x1: r.x1,
        y1: r.y1,
        pxPorPt: escala,
        pxPorPtY: escala * r.proporcao,
      };
    });
}

/** Uma célula da grade, ou um bloco de células mescladas (0 = a primeira). */
export type Regiao = Mescla;
/** As retas da grade (`xs` da esquerda para a direita, `ys` de cima para baixo) e as células. */
export type Grade = { xs: number[]; ys: number[]; regioes: Regiao[] };

/** Valores quase iguais viram um só (a média). */
function agruparValores(valores: number[], folga: number): number[] {
  const grupos: number[][] = [];
  for (const v of [...valores].sort((a, b) => a - b)) {
    const g = grupos[grupos.length - 1];
    if (g && v - g[g.length - 1]! <= folga) g.push(v);
    else grupos.push([v]);
  }
  return grupos.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
}

/** Há traço na `posicao` cobrindo ao menos 60% do trecho de `de` a `ate`? */
function temBorda(tracos: Traco[], horizontal: boolean, posicao: number, de: number, ate: number) {
  const pedacos: [number, number][] = [];
  for (const t of tracos) {
    if (Math.abs((horizontal ? t.y0 : t.x0) - posicao) > ENCOSTA) continue;
    const a = Math.max(de, horizontal ? t.x0 : t.y0);
    const b = Math.min(ate, horizontal ? t.x1 : t.y1);
    if (b > a) pedacos.push([a, b]);
  }
  pedacos.sort((p, q) => p[0] - q[0]);
  let coberto = 0;
  let ate_ = de;
  for (const [a, b] of pedacos) {
    if (b <= ate_) continue;
    coberto += b - Math.max(a, ate_);
    ate_ = b;
  }
  return coberto >= 0.6 * (ate - de);
}

/** 5b. As grades da página: os traços que se tocam, com ao menos 2×2 células. */
export function acharGrades(tracos: Tracos): Grade[] {
  const { horizontais: hs, verticais: vs } = tracos;
  const pai = Array.from({ length: hs.length + vs.length }, (_, i) => i);
  const raiz = (i: number): number => {
    while (pai[i] !== i) {
      pai[i] = pai[pai[i]!]!;
      i = pai[i]!;
    }
    return i;
  };
  hs.forEach((h, i) =>
    vs.forEach((v, j) => {
      const toca =
        v.x0 >= h.x0 - ENCOSTA &&
        v.x0 <= h.x1 + ENCOSTA &&
        h.y0 >= v.y0 - ENCOSTA &&
        h.y0 <= v.y1 + ENCOSTA;
      if (toca) pai[raiz(i)] = raiz(hs.length + j);
    }),
  );
  const conjuntos = new Map<number, { h: Traco[]; v: Traco[] }>();
  [...hs, ...vs].forEach((t, i) => {
    const r = raiz(i);
    const c = conjuntos.get(r) ?? { h: [], v: [] };
    (i < hs.length ? c.h : c.v).push(t);
    conjuntos.set(r, c);
  });

  const grades: Grade[] = [];
  for (const { h, v } of conjuntos.values()) {
    if (h.length < 2 || v.length < 2) continue;
    let xs = agruparValores(
      v.map((t) => t.x0),
      ENCOSTA,
    );
    let ys = agruparValores(
      h.map((t) => t.y0),
      ENCOSTA,
    );
    // Tabela sem a borda de fora: a ponta das linhas faz o papel dela.
    const [minX, maxX] = [Math.min(...h.map((t) => t.x0)), Math.max(...h.map((t) => t.x1))];
    const [minY, maxY] = [Math.min(...v.map((t) => t.y0)), Math.max(...v.map((t) => t.y1))];
    if (minX < xs[0]! - 5) xs = [minX, ...xs];
    if (maxX > xs[xs.length - 1]! + 5) xs = [...xs, maxX];
    if (minY < ys[0]! - 5) ys = [minY, ...ys];
    if (maxY > ys[ys.length - 1]! + 5) ys = [...ys, maxY];
    if (xs.length < 3 || ys.length < 3) continue;

    // As células, juntando as vizinhas sem borda entre elas (a célula mesclada).
    const nl = ys.length - 1;
    const nc = xs.length - 1;
    const dono = Array.from({ length: nl * nc }, (_, i) => i);
    const raizC = (i: number): number => {
      while (dono[i] !== i) {
        dono[i] = dono[dono[i]!]!;
        i = dono[i]!;
      }
      return i;
    };
    for (let r = 0; r < nl; r++) {
      for (let c = 0; c < nc; c++) {
        if (c + 1 < nc && !temBorda(v, false, xs[c + 1]!, ys[r]!, ys[r + 1]!)) {
          dono[raizC(r * nc + c)] = raizC(r * nc + c + 1);
        }
        if (r + 1 < nl && !temBorda(h, true, ys[r + 1]!, xs[c]!, xs[c + 1]!)) {
          dono[raizC(r * nc + c)] = raizC((r + 1) * nc + c);
        }
      }
    }
    // Cada grupo de células sem borda entre elas. O grupo que não é um retângulo cheio (um "L", como no
    // carimbo do mapa de plantio, 23/11/2026) não vira uma mescla só: a caixa dele invadia a célula
    // vizinha, e o Excel pedia para "reparar" a planilha e tirava TODAS as mesclas da aba. Ele vira um
    // bloco por linha, com as células seguidas daquela linha.
    const grupos = new Map<number, number[]>();
    for (let i = 0; i < nl * nc; i++) {
      const k = raizC(i);
      const g = grupos.get(k);
      if (g) g.push(i);
      else grupos.set(k, [i]);
    }
    const regioes: Regiao[] = [];
    for (const celulas of grupos.values()) {
      let [r0, r1, c0, c1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const i of celulas) {
        const [r, c] = [Math.floor(i / nc), i % nc];
        [r0, r1, c0, c1] = [Math.min(r0, r), Math.max(r1, r), Math.min(c0, c), Math.max(c1, c)];
      }
      if (celulas.length === (r1 - r0 + 1) * (c1 - c0 + 1)) {
        regioes.push({ linha: r0, coluna: c0, linhas: r1 - r0 + 1, colunas: c1 - c0 + 1 });
        continue;
      }
      const porLinha = new Map<number, number[]>();
      for (const i of celulas) {
        const r = Math.floor(i / nc);
        const cs = porLinha.get(r);
        if (cs) cs.push(i % nc);
        else porLinha.set(r, [i % nc]);
      }
      for (const [r, cs] of porLinha) {
        cs.sort((a, b) => a - b);
        let ini = cs[0]!;
        for (let j = 1; j <= cs.length; j++) {
          if (j < cs.length && cs[j] === cs[j - 1]! + 1) continue;
          regioes.push({ linha: r, coluna: ini, linhas: 1, colunas: cs[j - 1]! - ini + 1 });
          if (j < cs.length) ini = cs[j]!;
        }
      }
    }
    regioes.sort((a, b) => a.linha - b.linha || a.coluna - b.coluna);
    if (regioes.length < 2) continue;
    grades.push({ xs, ys, regioes });
  }
  return grades.sort((a, b) => a.ys[0]! - b.ys[0]!);
}

/** O intervalo de `bordas` onde `v` cai (o primeiro ou o último, se cair fora). */
function intervaloDe(bordas: number[], v: number): number {
  for (let i = 0; i + 1 < bordas.length; i++) if (v < bordas[i + 1]!) return i;
  return Math.max(0, bordas.length - 2);
}

/**
 * Um pedaço do pdf.js que atravessa uma borda da grade ("Total   1.234,56" num item só) é
 * partido nela, na proporção das letras.
 */
function partirNasBordas(trechos: Trecho[], xs: number[]): Trecho[] {
  const saida: Trecho[] = [];
  for (const t of trechos) {
    const cortes = xs.slice(1, -1).filter((x) => x > t.x0 + 1.5 && x < t.x1 - 1.5);
    if (cortes.length === 0) {
      saida.push(t);
      continue;
    }
    const letras = [...t.texto];
    const largura = t.x1 - t.x0;
    let inicio = 0;
    let x0 = t.x0;
    for (const x of [...cortes, t.x1]) {
      const fim = x === t.x1 ? letras.length : Math.round(((x - t.x0) / largura) * letras.length);
      const texto = letras.slice(inicio, fim).join("").trim();
      if (texto) saida.push({ ...t, x0, x1: x, texto });
      inicio = fim;
      x0 = x;
    }
  }
  return saida;
}

/** O ponto de um pedaço que decide a célula dele: o meio, um pouco acima da linha de base. */
function centro(t: Trecho): { x: number; y: number } {
  return { x: (t.x0 + t.x1) / 2, y: t.y - 0.3 * t.altura };
}

/* ------------------------ A página montada em partes ------------------------ */

export type Secao =
  { tipo: "texto"; linhas: Linha[] } | { tipo: "tabela"; celulas: string[][]; regioes: Regiao[] };
export type PaginaMontada = { altura: number; secoes: Secao[] };

/** As células de uma grade com o texto dela; `null` se a grade não for uma tabela de verdade. */
function tabelaDaGrade(g: Grade, trechos: Trecho[]): Secao | null {
  const nc = g.xs.length - 1;
  const dono = new Map<number, number>();
  g.regioes.forEach((reg, i) => {
    for (let r = reg.linha; r < reg.linha + reg.linhas; r++) {
      for (let c = reg.coluna; c < reg.coluna + reg.colunas; c++) dono.set(r * nc + c, i);
    }
  });
  const porRegiao: Trecho[][] = g.regioes.map(() => []);
  for (const t of partirNasBordas(trechos, g.xs)) {
    const p = centro(t);
    const i = dono.get(intervaloDe(g.ys, p.y) * nc + intervaloDe(g.xs, p.x));
    if (i !== undefined) porRegiao[i]!.push(t);
  }
  const linhasPorRegiao = porRegiao.map((ts) => agruparLinhas(ts));
  const comTexto = linhasPorRegiao.filter((ls) => ls.length > 0);
  if (comTexto.length === 0) return null;
  if (comTexto.filter((ls) => ls.length <= LINHAS_POR_CELULA).length < 0.6 * comTexto.length) {
    return null;
  }
  const celulas = Array.from({ length: g.ys.length - 1 }, () =>
    Array.from({ length: nc }, () => ""),
  );
  g.regioes.forEach((reg, i) => {
    celulas[reg.linha]![reg.coluna] = linhasPorRegiao[i]!.map((l) =>
      l.trechos.map((t) => t.texto).join(" "),
    )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  });
  return { tipo: "tabela", celulas, regioes: g.regioes };
}

/**
 * A página em partes, de cima para baixo: o texto solto (que vai pelas colunas do item 2) e as
 * tabelas desenhadas (item 5). `prontas`: partes montadas à parte, que entram pela altura `y` — a
 * tabela em imagem lida pelo OCR (23/11/2026), montada só com ela para não cair dentro da moldura
 * que o PDF desenha em volta da página.
 */
export function montarPagina(
  trechos: Trecho[],
  tracos: Tracos,
  altura: number,
  prontas: { y: number; secoes: Secao[] }[] = [],
): PaginaMontada {
  const grades = acharGrades(tracos);
  const dentro = grades.map((): Trecho[] => []);
  const fora: Trecho[] = [];
  for (const t of trechos) {
    const p = centro(t);
    const i = grades.findIndex(
      (g) =>
        p.x >= g.xs[0]! &&
        p.x <= g.xs[g.xs.length - 1]! &&
        p.y >= g.ys[0]! &&
        p.y <= g.ys[g.ys.length - 1]!,
    );
    if (i >= 0) dentro[i]!.push(t);
    else fora.push(t);
  }
  const tabelas: { y: number; secoes: Secao[] }[] = [];
  grades.forEach((g, i) => {
    const tabela = tabelaDaGrade(g, dentro[i]!);
    if (tabela) tabelas.push({ y: g.ys[0]!, secoes: [tabela] });
    else fora.push(...dentro[i]!); // moldura de seção, não tabela: o texto volta para o jeito comum
  });
  tabelas.push(...prontas.filter((p) => p.secoes.length > 0));
  tabelas.sort((a, b) => a.y - b.y);
  const secoes: Secao[] = [];
  let atual: Linha[] = [];
  let k = 0;
  const fecharTexto = () => {
    if (atual.length > 0) secoes.push({ tipo: "texto", linhas: atual });
    atual = [];
  };
  for (const l of agruparLinhas(fora)) {
    l.naBorda =
      altura > 0 && (l.y < altura * FAIXA_DA_BORDA || l.y > altura * (1 - FAIXA_DA_BORDA));
    while (k < tabelas.length && tabelas[k]!.y < l.y - l.altura) {
      fecharTexto();
      secoes.push(...tabelas[k++]!.secoes);
    }
    atual.push(l);
  }
  fecharTexto();
  while (k < tabelas.length) secoes.push(...tabelas[k++]!.secoes);
  return { altura, secoes };
}

/* ------------------------------ As abas ------------------------------ */

export type AbaMontada = { nome: string; linhas: Celula[][]; mesclas: Mescla[] };

function textoDaLinha(l: Linha): string {
  return l.trechos.map((t) => t.texto).join(" ");
}

/** Para comparar cabeçalhos e rodapés de páginas diferentes: sem caixa, sem espaços, e os números viram "#". */
function semNumeros(s: string): string {
  return s.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

/** A faixa do alto e do pé da página onde moram o cabeçalho e o rodapé. */
const FAIXA_DA_BORDA = 0.12;

/**
 * 6. Todas as páginas numa parte só: sai o cabeçalho e o rodapé repetidos (fica o cabeçalho da
 * primeira página e o rodapé da última), sai a linha de títulos repetida no alto da tabela de cada
 * página, e a tabela que continua na página seguinte (mesmo número de colunas) continua junta.
 */
function juntarPaginas(paginas: PaginaMontada[]): Secao[] {
  const n = paginas.length;
  const faixa = (p: PaginaMontada, l: Linha) =>
    l.y < p.altura * FAIXA_DA_BORDA ? "alto" : l.y > p.altura * (1 - FAIXA_DA_BORDA) ? "pe" : null;
  const vezes = { alto: new Map<string, Set<number>>(), pe: new Map<string, Set<number>>() };
  paginas.forEach((p, i) => {
    for (const s of p.secoes) {
      if (s.tipo !== "texto") continue;
      for (const l of s.linhas) {
        const f = faixa(p, l);
        if (!f) continue;
        const chave = semNumeros(textoDaLinha(l));
        vezes[f].set(chave, (vezes[f].get(chave) ?? new Set<number>()).add(i));
      }
    }
  });
  const repete = (f: "alto" | "pe", l: Linha) =>
    n >= 2 &&
    (vezes[f].get(semNumeros(textoDaLinha(l)))?.size ?? 0) >= Math.max(2, Math.ceil(n / 2));

  const secoes: Secao[] = [];
  let titulos: string | null = null;
  paginas.forEach((p, i) => {
    for (const s of p.secoes) {
      if (s.tipo === "texto") {
        const linhas = s.linhas.filter((l) => {
          const f = faixa(p, l);
          if (f === "alto" && repete("alto", l)) return i === 0;
          if (f === "pe" && repete("pe", l)) return i === n - 1;
          return true;
        });
        if (linhas.length === 0) continue;
        // O texto que continua na página seguinte continua junto, sem linha em branco no meio.
        const anterior = secoes[secoes.length - 1];
        if (anterior?.tipo === "texto") anterior.linhas.push(...linhas);
        else secoes.push({ tipo: "texto", linhas });
        continue;
      }
      let { celulas, regioes } = s;
      const primeira = semNumeros(celulas[0]?.join("|") ?? "");
      if (titulos === null) titulos = primeira;
      else if (primeira === titulos && celulas.length > 1) {
        celulas = celulas.slice(1);
        regioes = regioes.filter((r) => r.linha > 0).map((r) => ({ ...r, linha: r.linha - 1 }));
      }
      const anterior = secoes[secoes.length - 1];
      if (anterior?.tipo === "tabela" && anterior.celulas[0]?.length === celulas[0]?.length) {
        const desloca = anterior.celulas.length;
        anterior.celulas.push(...celulas);
        anterior.regioes.push(...regioes.map((r) => ({ ...r, linha: r.linha + desloca })));
      } else {
        secoes.push({ tipo: "tabela", celulas: [...celulas], regioes: [...regioes] });
      }
    }
  });
  return secoes;
}

/** As partes viram as linhas de uma aba: o texto pelas colunas do item 2, as tabelas como estão. */
function montarAba(secoes: Secao[]): { linhas: Celula[][]; mesclas: Mescla[] } {
  const linhasDeTexto = secoes.flatMap((s) => (s.tipo === "texto" ? s.linhas : []));
  // A linha solta do alto ou do pé (cabeçalho, rodapé) não define coluna: ela só cai numa.
  const colunas = acharColunas(linhasDeTexto.filter((l) => !(l.naBorda && l.trechos.length === 1)));
  const passos = secoes.flatMap((s) =>
    s.tipo === "texto" ? s.linhas.slice(1).map((l, i) => l.y - s.linhas[i]!.y) : [],
  );
  const passoComum = mediana(passos.filter((p) => p > 0));
  const saida: Celula[][] = [];
  const mesclas: Mescla[] = [];
  for (const s of secoes) {
    if (saida.length > 0) saida.push([]); // uma linha em branco entre as partes
    if (s.tipo === "tabela") {
      const inicio = saida.length;
      saida.push(...tiparColunas(s.celulas));
      for (const r of s.regioes) {
        if (r.linhas * r.colunas > 1) mesclas.push({ ...r, linha: r.linha + inicio });
      }
      continue;
    }
    const textos: string[][] = [];
    s.linhas.forEach((l, i) => {
      if (i > 0 && passoComum > 0 && l.y - s.linhas[i - 1]!.y > 2.2 * passoComum) textos.push([]);
      const t: string[] = Array.from({ length: Math.max(1, colunas.length) }, () => "");
      for (const tr of l.trechos) {
        const c = colunas.length > 0 ? colunaDe(tr, colunas) : 0;
        t[c] = t[c] ? `${t[c]} ${tr.texto}` : tr.texto;
      }
      textos.push(t);
    });
    saida.push(...tiparColunas(textos));
  }
  return { linhas: saida, mesclas };
}

/** 6. As abas da planilha: uma por página, ou todas as páginas numa aba só. */
export function montarAbas(paginas: PaginaMontada[], modo: "por-pagina" | "uma-so"): AbaMontada[] {
  if (modo === "uma-so" && paginas.length > 1) {
    return [{ nome: "Todas as páginas", ...montarAba(juntarPaginas(paginas)) }];
  }
  return paginas.map((p, i) => ({ nome: `Página ${i + 1}`, ...montarAba(p.secoes) }));
}

/** A página só com o texto (sem desenho): as linhas da planilha, já com os valores lidos. */
export function montarLinhas(trechos: Trecho[]): Celula[][] {
  return montarAba(montarPagina(trechos, { horizontais: [], verticais: [] }, 0).secoes).linhas;
}
