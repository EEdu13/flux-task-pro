import {
  PDFCheckBox,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  type PDFDocument,
  type PDFForm,
} from "pdf-lib";
import type { ValorDeCampo } from "../../editor/modelo";
import { cabeNaFontePadrao } from "./fontes";

/*
 * Formulário de PDF no Editor (12/11/2026): os campos de preencher (texto, marcar, escolher
 * uma opção, lista) que o PDF já traz. A tela põe uma caixa por cima de cada campo, lida pelo
 * pdf.js (`page.getAnnotations()`); aqui fica o que é do arquivo: o que ele tem e o salvar.
 *
 * - O valor vai no próprio campo, e o pdf-lib redesenha a aparência só dos campos mudados.
 * - "Travar" achata o formulário: os campos viram desenho na página e ninguém mais altera.
 * - O formulário XFA (o do Adobe LiveCycle) guarda os dados num XML à parte, que o Acrobat
 *   mostraria no lugar dos campos: preenchendo, o XFA sai e valem os campos comuns.
 * - Assinatura digital: salvar com qualquer mudança a invalida, e a tela avisa antes.
 */

export type SobreOFormulario = {
  /** Quantos campos de preencher o PDF tem (assinatura e botão não contam). */
  campos: number;
  /** O formulário é XFA (dinâmico, do Adobe LiveCycle). */
  xfa: boolean;
  /** Há assinatura digital aplicada. */
  assinado: boolean;
};

const SEM_FORMULARIO: SobreOFormulario = { campos: 0, xfa: false, assinado: false };

/** O formulário do PDF, ou `null` se ele não tem. Sem criar um vazio no documento. */
function formularioDe(doc: PDFDocument): PDFForm | null {
  if (!doc.catalog.lookup(PDFName.of("AcroForm"))) return null;
  try {
    return doc.getForm();
  } catch {
    return null;
  }
}

/** O que o PDF tem de formulário, para os avisos do Editor. */
export function sobreOFormulario(doc: PDFDocument): SobreOFormulario {
  const form = formularioDe(doc);
  if (!form) return SEM_FORMULARIO;
  let campos = 0;
  let assinado = false;
  for (const campo of form.getFields()) {
    if (campo instanceof PDFSignature) {
      if (campo.acroField.dict.has(PDFName.of("V"))) assinado = true;
    } else if (
      campo instanceof PDFTextField ||
      campo instanceof PDFCheckBox ||
      campo instanceof PDFRadioGroup ||
      campo instanceof PDFDropdown ||
      campo instanceof PDFOptionList
    ) {
      campos++;
    }
  }
  let xfa = false;
  try {
    xfa = form.hasXFA();
  } catch {
    // dicionário de formulário estranho: sem XFA para o aviso
  }
  return { campos, xfa, assinado };
}

/** A letra que a Helvetica não escreve vira "?": a aparência do campo é desenhada com ela. */
function escrevivel(texto: string): string {
  return [...texto.normalize("NFC")]
    .map((c) => (c === "\n" || cabeNaFontePadrao(c) ? c : "?"))
    .join("");
}

type ComPagina = { findWidgetPage(w: unknown): unknown };

/**
 * Põe os valores nos campos e, com `travar`, achata o formulário. Devolve um aviso para a
 * pessoa quando algo não deu (o campo que não aceitou o valor, o formulário que não travou),
 * ou `null`.
 */
export function preencherFormulario(
  doc: PDFDocument,
  valores: Readonly<Record<string, ValorDeCampo>>,
  travar: boolean,
): string | null {
  const nomes = Object.keys(valores);
  if (nomes.length === 0 && !travar) return null;
  const form = formularioDe(doc);
  if (!form) return null;
  const recusados: string[] = [];
  for (const nome of nomes) {
    const campo = form.getFieldMaybe(nome);
    const valor = valores[nome];
    if (!campo || valor === undefined) continue;
    try {
      if (campo instanceof PDFTextField) campo.setText(escrevivel(String(valor)));
      else if (campo instanceof PDFCheckBox) {
        if (valor === true) campo.check();
        else campo.uncheck();
      } else if (
        campo instanceof PDFRadioGroup ||
        campo instanceof PDFDropdown ||
        campo instanceof PDFOptionList
      ) {
        if (typeof valor === "string" && valor) campo.select(valor);
        else campo.clear();
      }
    } catch (e) {
      console.warn("[editor de PDF] o campo não aceitou o valor", nome, e);
      recusados.push(nome);
    }
  }
  // Com o XFA, o Acrobat mostraria os dados velhos dele no lugar dos campos preenchidos aqui.
  if (nomes.length > 0) {
    try {
      if (form.hasXFA()) form.deleteXFA();
    } catch {
      // sem XFA legível: nada a tirar
    }
  }
  let aviso = recusados.length > 0 ? `${recusados.length} campo(s) não aceitaram o valor` : null;
  if (!travar) return aviso;
  try {
    form.flatten();
  } catch {
    /* O campo de uma página apagada: o achatar não acha onde ele mora e para no meio. Esse
       campo sai do formulário, e o achatar continua com os outros. */
    const comPagina = form as unknown as ComPagina;
    for (const campo of form.getFields()) {
      const semPagina = campo.acroField.getWidgets().some((w) => {
        try {
          comPagina.findWidgetPage(w);
          return false;
        } catch {
          return true;
        }
      });
      if (semPagina) form.acroForm.removeField(campo.acroField);
    }
    try {
      form.flatten();
    } catch (e) {
      console.warn("[editor de PDF] o formulário não travou", e);
      aviso = "o formulário não pôde ser travado: os campos continuam editáveis";
    }
  }
  return aviso;
}
