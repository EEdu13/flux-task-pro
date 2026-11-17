import type { AnaliseDoConteudo, Glifo, Regiao } from "./conteudo";
import { glifosNaRegiao } from "./conteudo";
import type { InfoDaFonte } from "./fontes";

/*
 * As linhas de texto que o Editor de PDF oferece para editar (05/11/2026).
 *
 * Quem diz o que está escrito é o pdf.js: ele entende qualquer fonte, até as que o
 * Editor não consegue reescrever. Só que ele junta tudo o que tem a mesma fonte: num
 * "texto em vermelho no meio da frase", a linha viria inteira, e trocar uma letra
 * pintaria a frase de uma cor só. Por isso cada linha passa depois pelo interpretador
 * do conteúdo (`conteudo.ts`), que sabe a cor de cada letra, e é cortada onde o estilo
 * muda, ou onde duas células de tabela ficaram coladas.
 */

export type FamiliaDaFonte = "sans" | "serif" | "mono";

export type LinhaDeTexto = {
  /** Único na página, e sempre o mesmo para a mesma página: é a chave das edições. */
  id: string;
  texto: string;
  regiao: Regiao;
  /** Em fração do corpo, acima e abaixo da linha de base. */
  ascendente: number;
  descendente: number;
  familia: FamiliaDaFonte;
  negrito: boolean;
  italico: boolean;
};

type ItemDeTexto = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
};

type EstiloDoPdfjs = { fontFamily: string; ascent: number; descent: number; vertical: boolean };

export type TextoDoPdfjs = {
  items: readonly object[];
  styles: Record<string, EstiloDoPdfjs>;
};

/** Vão maior que isto (em corpos da letra) separa duas linhas: colunas, células. */
const VAO_MAXIMO = 0.6;
/** O maior vão, em corpos da letra, que ainda pode ser uma frase, se for feito de espaços. */
const VAO_MAXIMO_COM_ESPACOS = 3;
/** Vão entre letras a partir do qual conta como um espaço que não foi escrito. */
const VAO_DE_ESPACO = 0.1;
/** O quanto as linhas de base podem diferir e ainda ser a mesma linha, em corpos da letra. */
const TOLERANCIA_DE_BASE = 0.2;

function ehItem(o: object): o is ItemDeTexto {
  return "str" in o && "transform" in o;
}

function familiaDe(css: string | undefined): FamiliaDaFonte {
  if (css === "monospace") return "mono";
  if (css === "serif") return "serif";
  return "sans";
}

type EmMontagem = {
  texto: string;
  regiao: Regiao;
  fontName: string;
  ascendente: number;
  descendente: number;
  familia: FamiliaDaFonte;
};

/** Junta os itens do pdf.js em linhas, sem olhar o conteúdo da página. */
export function linhasDoTexto(
  conteudo: TextoDoPdfjs,
): Omit<LinhaDeTexto, "id" | "negrito" | "italico">[] {
  const saida: EmMontagem[] = [];
  let atual: EmMontagem | null = null;
  const fechar = () => {
    if (atual && atual.texto.trim()) saida.push(atual);
    atual = null;
  };

  for (const item of conteudo.items) {
    if (!ehItem(item)) continue;
    const t = item.transform;
    const estilo = conteudo.styles[item.fontName];
    if (estilo?.vertical) continue;
    const a = t[0] ?? 0;
    const b = t[1] ?? 0;
    const tamanho = Math.hypot(t[2] ?? 0, t[3] ?? 0);
    const largura = Math.hypot(a, b);
    const vazio = item.str.trim() === "";

    if (vazio) {
      // Sem largura é só a marca de fim de linha do pdf.js. Com largura, é um vão.
      if (atual && item.width > 0) {
        const m: EmMontagem = atual;
        if (item.width <= VAO_MAXIMO * m.regiao.tamanho) {
          if (!m.texto.endsWith(" ")) m.texto += " ";
          m.regiao = { ...m.regiao, largura: m.regiao.largura + item.width };
        } else {
          fechar();
        }
      }
      if (item.hasEOL) fechar();
      continue;
    }
    if (tamanho <= 0 || largura <= 0) continue;

    const ux = a / largura;
    const uy = b / largura;
    const x = t[4] ?? 0;
    const y = t[5] ?? 0;

    let juntou = false;
    if (atual) {
      const m: EmMontagem = atual;
      const r = m.regiao;
      const dx = x - r.x;
      const dy = y - r.y;
      const u = dx * r.ux + dy * r.uy;
      const v = -dx * r.uy + dy * r.ux;
      const vao = u - r.largura;
      const mesmaLinha =
        item.fontName === m.fontName &&
        Math.abs(tamanho - r.tamanho) < 0.1 * r.tamanho &&
        Math.abs(ux * r.ux + uy * r.uy) > 0.99 &&
        Math.abs(v) < TOLERANCIA_DE_BASE * r.tamanho &&
        vao > -0.3 * r.tamanho &&
        vao < VAO_MAXIMO * r.tamanho;
      if (mesmaLinha) {
        const precisaDeEspaco =
          vao > VAO_DE_ESPACO * r.tamanho && !m.texto.endsWith(" ") && !item.str.startsWith(" ");
        m.texto += (precisaDeEspaco ? " " : "") + item.str;
        m.regiao = { ...r, largura: Math.max(r.largura, u + item.width) };
        juntou = true;
      }
    }
    if (!juntou) {
      fechar();
      atual = {
        texto: item.str,
        regiao: { x, y, ux, uy, largura: item.width, tamanho },
        fontName: item.fontName,
        // O pdf.js devolve 0 quando a fonte não informa: usa as medidas de uma fonte comum.
        ascendente: estilo?.ascent ? Math.abs(estilo.ascent) : 0.9,
        descendente: estilo?.descent ? Math.abs(estilo.descent) : 0.22,
        familia: familiaDe(estilo?.fontFamily),
      };
    }
    if (item.hasEOL) fechar();
  }
  fechar();
  return saida.map(({ fontName: _f, ...resto }) => resto);
}

/* ------------------------------ Juntar palavras --------------------------------- */

/**
 * Junta as linhas que o pdf.js partiu num espaço largo. Em texto justificado o espaço
 * entre as palavras cresce (`Tw`) e passa do que ele considera um espaço, e cada
 * palavra viraria uma linha. O que decide aqui é o conteúdo: se o vão é feito de
 * caracteres de espaço, é a mesma frase. Células de tabela não têm nada escrito no vão.
 */
export function juntarPorEspacos<T extends Omit<LinhaDeTexto, "id" | "negrito" | "italico">>(
  linhas: readonly T[],
  analise: AnaliseDoConteudo,
  fonteDe: (nome: string) => InfoDaFonte | null,
): T[] {
  const saida: T[] = [];
  for (const linha of linhas) {
    const ant = saida[saida.length - 1];
    if (ant) {
      const a = ant.regiao;
      const r = linha.regiao;
      const dx = r.x - a.x;
      const dy = r.y - a.y;
      const u = dx * a.ux + dy * a.uy;
      const v = -dx * a.uy + dy * a.ux;
      const vao = u - a.largura;
      const alinhada =
        Math.abs(r.ux * a.ux + r.uy * a.uy) > 0.99 &&
        Math.abs(r.tamanho - a.tamanho) < 0.1 * a.tamanho &&
        Math.abs(v) < TOLERANCIA_DE_BASE * a.tamanho;
      if (alinhada && vao > 0 && vao < VAO_MAXIMO_COM_ESPACOS * a.tamanho) {
        const noVao = glifosNaRegiao(analise, {
          ...a,
          x: a.x + a.ux * a.largura,
          y: a.y + a.uy * a.largura,
          largura: vao,
        });
        if (noVao.length > 0 && noVao.every((g) => ehEspaco(g, fonteDe))) {
          saida[saida.length - 1] = {
            ...ant,
            texto: `${ant.texto} ${linha.texto}`,
            regiao: { ...a, largura: u + r.largura },
          };
          continue;
        }
      }
    }
    saida.push(linha);
  }
  return saida;
}

/* ----------------------------- Cortar por estilo ------------------------------ */

function semEspacos(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "");
}

function ehEspaco(g: Glifo, fonteDe: (n: string) => InfoDaFonte | null): boolean {
  return fonteDe(g.op.fonte)?.textoDe(g.codigo)?.trim() === "";
}

/**
 * Corta a linha onde a cor ou a fonte mudam, e entre células de tabela coladas: dois
 * blocos de texto (`BT`) separados por um vão sem espaço escrito. Devolve a linha
 * inteira, como veio, quando a leitura dos códigos não bate com o que o pdf.js leu.
 */
export function cortarPorEstilo<T extends Omit<LinhaDeTexto, "id" | "negrito" | "italico">>(
  linha: T,
  analise: AnaliseDoConteudo,
  fonteDe: (nome: string) => InfoDaFonte | null,
): (T & { negrito: boolean; italico: boolean })[] {
  const glifos = glifosNaRegiao(analise, linha.regiao);
  const estiloDe = (g: Glifo | undefined) => {
    const f = g ? fonteDe(g.op.fonte) : null;
    return { negrito: !!f?.negrito, italico: !!f?.italico };
  };
  const inteira = () => [{ ...linha, ...estiloDe(glifos[0]) }];
  if (glifos.length < 2) return inteira();

  const { ux, uy } = linha.regiao;
  const tamanho = linha.regiao.tamanho;
  const grupos: Glifo[][] = [];
  let grupo: Glifo[] = [];
  let anterior: Glifo | null = null;
  for (const g of glifos) {
    const espaco = ehEspaco(g, fonteDe);
    if (anterior && !espaco) {
      const fim = (anterior.x + anterior.ax) * ux + (anterior.y + anterior.ay) * uy;
      const vao = g.x * ux + g.y * uy - fim;
      const estiloMudou =
        g.op.cor !== anterior.op.cor ||
        g.op.fonte !== anterior.op.fonte ||
        Math.abs(g.op.tamanho - anterior.op.tamanho) > 1e-3;
      const outraCelula =
        g.op.bloco !== anterior.op.bloco &&
        vao > VAO_DE_ESPACO * tamanho &&
        !ehEspaco(grupo[grupo.length - 1] ?? g, fonteDe);
      if (estiloMudou || outraCelula) {
        grupos.push(grupo);
        grupo = [];
      }
    }
    grupo.push(g);
    if (!espaco) anterior = g;
  }
  grupos.push(grupo);

  const partes: (T & { negrito: boolean; italico: boolean })[] = [];
  let lido = "";
  for (const gs of grupos) {
    let texto = "";
    let ultimo: Glifo | null = null;
    for (const g of gs) {
      const letra = fonteDe(g.op.fonte)?.textoDe(g.codigo);
      if (letra === undefined) return inteira();
      if (ultimo) {
        const fim = (ultimo.x + ultimo.ax) * ux + (ultimo.y + ultimo.ay) * uy;
        const vao = g.x * ux + g.y * uy - fim;
        if (vao > VAO_DE_ESPACO * tamanho && !texto.endsWith(" ") && !letra.startsWith(" ")) {
          texto += " ";
        }
      }
      texto += letra;
      ultimo = g;
    }
    lido += texto;
    const primeiro = gs[0]!;
    const ultimoG = gs[gs.length - 1]!;
    const inicio = primeiro.x * ux + primeiro.y * uy;
    const fim = (ultimoG.x + ultimoG.ax) * ux + (ultimoG.y + ultimoG.ay) * uy;
    partes.push({
      ...linha,
      texto,
      regiao: { ...linha.regiao, x: primeiro.x, y: primeiro.y, largura: Math.max(0, fim - inicio) },
      ...estiloDe(primeiro),
    });
  }
  // Os códigos dizem outra coisa do que o pdf.js leu: melhor não cortar do que cortar errado.
  if (semEspacos(lido) !== semEspacos(linha.texto)) return inteira();
  return partes.filter((p) => p.texto.trim());
}
