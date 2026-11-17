import type { LucideIcon } from "lucide-react";
import type { PedidoDeEdicao } from "./locais/editor/aplicar";

/*
 * Tipos da paleta de conversão de arquivos (04/11/2026).
 *
 * A paleta é feita de "blocos": cada um recebe arquivos e devolve arquivos. O
 * catálogo (`blocos.ts`) é leve e vai no pacote inicial — só rótulo, ícone e o
 * que cada bloco aceita. O trabalho pesado (pdf-lib, pdf.js, heic2any, fflate)
 * é carregado na hora, com `import()`, dentro do `executar` de cada bloco:
 * quem nunca abre o conversor não baixa nada disso, e o pdf.js sozinho passa
 * de 1 MB.
 */

export type GrupoDoBloco = "PDF" | "PARA PDF" | "IMAGEM";

/**
 * A tela intermediária que alguns blocos pedem antes de converter:
 * - "ordenar": a lista dos arquivos, para pôr na ordem (Juntar PDFs, Imagens → PDF);
 * - "paginas": miniaturas para escolher páginas (Separar páginas);
 * - "girar": miniaturas para girar páginas (Girar páginas);
 * - "formato": o formato de saída (Converter imagem);
 * - "nivel": o quanto comprimir (Comprimir PDF);
 * - "idioma": o idioma do documento (OCR);
 * - "abas": uma aba por página ou tudo numa aba (PDF → Excel);
 * - "editar": o Editor de PDF, que ocupa a tela inteira.
 */
export type EtapaDoBloco =
  "nenhuma" | "ordenar" | "paginas" | "girar" | "formato" | "nivel" | "idioma" | "abas" | "editar";

export type FormatoDeImagem = "jpg" | "png" | "webp";

/**
 * Comprimir PDF (11/11/2026): "leve" mantém o texto e regrava só as imagens de dentro;
 * "forte" refaz cada página como imagem — encolhe muito, mas o texto deixa de ser texto.
 */
export type NivelDeCompressao = "leve" | "forte";

/** OCR (12/11/2026): o português sozinho, ou com o inglês, para documento com termos técnicos. */
export type IdiomaDoOcr = "por" | "por+eng";

/** PDF → Excel (12/11/2026): cada página na sua aba, ou o relatório inteiro numa aba só. */
export type AbasDoExcel = "por-pagina" | "uma-so";

export type IdDoBloco =
  | "editar-pdf"
  | "juntar-pdfs"
  | "separar-paginas"
  | "girar-paginas"
  | "pdf-imagens"
  | "imagens-pdf"
  | "converter-imagem"
  | "reduzir-imagem"
  /* Os 7 que eram do servidor (fases 1b e 2) e, desde 11/11/2026, rodam no computador
     da pessoa: no navegador, ou pelo Office instalado no app de mesa (`soNoApp`). Só
     aparecem fora do dev quando estão em `BLOCOS_PRONTOS` (`blocos.ts`). */
  | "pdf-excel"
  | "pdf-word"
  | "ocr"
  | "comprimir-pdf"
  | "word-pdf"
  | "excel-pdf"
  | "powerpoint-pdf";

/** Um arquivo pronto para entregar à pessoa. */
export type Saida = { nome: string; blob: Blob };

/**
 * O que um bloco devolve. Quando sai mais de um arquivo (uma página por
 * arquivo, PDF → imagens), quem decide se vira um .zip é a entrega, não o
 * bloco: no navegador vai tudo num .zip só; no app de mesa, que não grava
 * .zip, cada arquivo vai separado para Downloads — ver `entregar.ts`.
 */
export type Resultado = {
  arquivos: Saida[];
  /** O nome do .zip, quando houver mais de um arquivo. */
  pacote?: string;
  /** Uma linha para o aviso de "Pronto" ("De 12 MB para 2 MB"). Sem ela, o aviso de sempre. */
  resumo?: string;
};

export type AoExecutar = {
  /** De 0 a 1. Chamado quantas vezes o bloco quiser; a barra só anda para a frente. */
  progresso: (fracao: number) => void;
  /** Cancelamento pedido pela pessoa. Fechar a paleta NÃO cancela: o resultado chega no aviso. */
  sinal?: AbortSignal;
};

/** O que a tela intermediária decidiu. Cada bloco lê só o que é dele. */
export type OpcoesDoBloco = {
  /** "separar-paginas": índices (a partir de 0) das páginas escolhidas, em ordem. */
  paginas?: number[];
  /** "separar-paginas": um PDF só com as escolhidas, ou um arquivo por página (ZIP). */
  modoDeSeparar?: "um-pdf" | "um-por-pagina";
  /** "girar-paginas": índice da página (a partir de 0) → giro a somar, em graus. */
  giros?: Record<number, 90 | 180 | 270>;
  /** "converter-imagem": o formato de saída. */
  formato?: FormatoDeImagem;
  /** "comprimir-pdf": o quanto comprimir. Sem ele, "leve". */
  nivelDeCompressao?: NivelDeCompressao;
  /** "ocr": o idioma do documento. Sem ele, "por". */
  idiomaDoOcr?: IdiomaDoOcr;
  /** "pdf-excel": como as páginas viram abas. Sem ele, "por-pagina". */
  abasDoExcel?: AbasDoExcel;
  /** "editar-pdf": o que foi feito no Editor. */
  edicao?: PedidoDeEdicao;
};

export type Bloco = {
  id: IdDoBloco;
  rotulo: string;
  /** Uma linha curta embaixo do rótulo, dizendo o que o bloco faz. */
  dica: string;
  /** A transição, em palavras da pessoa: o que entra ("2 ou mais PDFs")… */
  de: string;
  /** …e o que sai ("1 PDF"). A roda mostra os dois no centro, ligados por uma seta. */
  para: string;
  grupo: GrupoDoBloco;
  /**
   * O que se perde ou muda no caminho, dito ANTES de converter (12/11/2026): aparece no centro
   * da roda e no alto da tela intermediária. Curto: uma ou duas frases.
   */
  atencao: string;
  icone: LucideIcon;
  /**
   * O que o bloco aceita. Extensão sem ponto e em minúsculas. No arrastar só
   * existe o MIME (e às vezes nem ele: o Windows não informa tipo para .heic);
   * a extensão é conferida de novo quando o arquivo é solto.
   */
  aceita: { ext: readonly string[]; mime: readonly string[] };
  /** Aceita mais de um arquivo de uma vez. Só Juntar PDFs e Imagens → PDF. */
  varios?: boolean;
  /** Teto de arquivos quando `varios`. */
  maximo?: number;
  /**
   * Converte pelo Office instalado no computador (Word, Excel, PowerPoint): só no app de
   * mesa, a partir da versão que tem o comando. No navegador o bloco aparece apagado,
   * dizendo por quê (`porQueNaoServe`, em `blocos.ts`).
   */
  soNoApp?: boolean;
  etapa: EtapaDoBloco;
  executar: (arquivos: File[], opcoes: OpcoesDoBloco, ao: AoExecutar) => Promise<Resultado>;
};

/* ----------------------------- Estado da tela ----------------------------- */

/** A conversão em andamento — ou que falhou — de um bloco, para a tela mostrar no próprio bloco. */
export type Trabalho = {
  estado: "rodando" | "erro";
  /** De 0 a 1. */
  progresso: number;
  erro?: string;
};

/**
 * Como o bloco aparece enquanto um arquivo é arrastado (ou espera a pessoa
 * escolher o que fazer com ele): aceita, recusa, ou ainda não dá para saber.
 * `null` = nada sendo arrastado.
 */
export type Realce = "sim" | "nao" | "talvez" | null;

/**
 * De onde veio a ativação de um bloco da roda: o mouse em cima, o foco do
 * teclado ou um arquivo sendo arrastado por cima dele. O bloco ativo cresce e
 * o centro da roda passa a descrevê-lo; a origem muda só o que o centro diz
 * ("Clique para escolher" ou "Solte para converter").
 */
export type OrigemDaAtivacao = "ponteiro" | "foco" | "arraste";

/** O que a paleta mostra: a grade de blocos, ou a tela intermediária de um bloco. */
export type TelaDaPaleta =
  { tipo: "blocos" } | { tipo: "etapa"; blocoId: IdDoBloco; arquivos: File[] };

/**
 * Falha com a mensagem já pronta para a pessoa, em português — aparece no
 * próprio bloco. Qualquer outro erro vira a mensagem genérica.
 */
export class ErroDeConversao extends Error {
  constructor(
    mensagem: string,
    /** Para decidir por código, nunca pelo texto. Ex.: "PDF_PROTEGIDO", "GRANDE_DEMAIS". */
    readonly codigo = "",
  ) {
    super(mensagem);
    this.name = "ErroDeConversao";
  }
}
