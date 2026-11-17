import type { PaginaPdfjs } from "../locais/editor/documento";
import type { ValorDeCampo } from "./modelo";

/*
 * Os campos de formulário de uma página, lidos pelo pdf.js (12/11/2026): onde fica cada um, o
 * tipo e o valor que o PDF traz. A tela que os mostra é `campos-do-formulario.tsx`.
 */

export type CampoDaPagina = {
  nome: string;
  tipo: "texto" | "marcar" | "opcao" | "lista";
  /** Em pontos, no sistema das linhas de texto (origem no alto, à esquerda). */
  x: number;
  y: number;
  l: number;
  a: number;
  inicial: ValorDeCampo;
  /** "opcao" (botão de rádio): o valor deste botão no grupo. */
  valorDoBotao?: string;
  /** "lista": as opções pelo texto que aparece, que é como o pdf-lib escolhe. */
  opcoes?: string[];
  multilinha: boolean;
  somenteLeitura: boolean;
  maximo?: number;
};

/** O pedaço de uma anotação do pdf.js que interessa aqui. */
type Anotacao = {
  subtype?: string;
  fieldType?: string;
  fieldName?: string;
  rect?: number[];
  fieldValue?: unknown;
  readOnly?: boolean;
  hidden?: boolean;
  multiLine?: boolean;
  maxLen?: number;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  buttonValue?: string;
  options?: { exportValue?: string; displayValue?: string }[];
};

type Visualizacao = { convertToViewportPoint(x: number, y: number): number[] };

/** Os campos da página, nas coordenadas das linhas de texto. Assinatura e botão ficam de fora. */
export async function camposDaPagina(
  pagina: PaginaPdfjs,
  vp: Visualizacao,
): Promise<CampoDaPagina[]> {
  const anotacoes = (await pagina.getAnnotations()) as Anotacao[];
  const campos: CampoDaPagina[] = [];
  for (const a of anotacoes) {
    if (a.subtype !== "Widget" || !a.fieldName || !a.rect || a.hidden || a.pushButton) continue;
    const [r0 = 0, r1 = 0, r2 = 0, r3 = 0] = a.rect;
    // Os dois cantos pela visualização, que já cuida do giro da página.
    const [x1 = 0, y1 = 0] = vp.convertToViewportPoint(r0, r1);
    const [x2 = 0, y2 = 0] = vp.convertToViewportPoint(r2, r3);
    const base = {
      nome: a.fieldName,
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      l: Math.abs(x2 - x1),
      a: Math.abs(y2 - y1),
      somenteLeitura: !!a.readOnly,
      multilinha: !!a.multiLine,
      maximo: a.maxLen || undefined,
    };
    const valor = typeof a.fieldValue === "string" ? a.fieldValue : "";
    if (a.fieldType === "Tx") {
      campos.push({ ...base, tipo: "texto", inicial: valor });
    } else if (a.fieldType === "Btn" && a.checkBox) {
      campos.push({ ...base, tipo: "marcar", inicial: valor !== "" && valor !== "Off" });
    } else if (a.fieldType === "Btn" && a.radioButton) {
      campos.push({
        ...base,
        tipo: "opcao",
        valorDoBotao: a.buttonValue ?? "",
        inicial: valor === "Off" ? "" : valor,
      });
    } else if (a.fieldType === "Ch") {
      const opcoes = (a.options ?? []).map((o) => o.displayValue ?? o.exportValue ?? "");
      const escolhido = Array.isArray(a.fieldValue) ? String(a.fieldValue[0] ?? "") : valor;
      const opcao = (a.options ?? []).find(
        (o) => o.exportValue === escolhido || o.displayValue === escolhido,
      );
      campos.push({
        ...base,
        tipo: "lista",
        opcoes,
        inicial: opcao?.displayValue ?? opcao?.exportValue ?? escolhido,
      });
    }
  }
  return campos;
}
