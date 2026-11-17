import {
  FileArchive,
  FileImage,
  FilePenLine,
  FileSpreadsheet,
  FileStack,
  FileText,
  ImageDown,
  Images,
  Presentation,
  RefreshCw,
  RotateCw,
  ScanText,
  Scissors,
} from "lucide-react";
import type { AmbienteDoConversor } from "./ambiente";
import { ErroDeConversao, type Bloco, type GrupoDoBloco, type IdDoBloco } from "./tipos";

/*
 * O catálogo da paleta de conversão (04/11/2026). Um bloco novo é uma entrada
 * nova aqui — a paleta, a faixa de arraste e o Ctrl+K leem esta lista.
 *
 * A ordem dentro de cada grupo é a do desenho da paleta na especificação, com
 * os 15 blocos: os que ainda não estão prontos já têm o seu lugar.
 *
 * Desde 11/11/2026 todos rodam no computador da pessoa (decisão do usuário: sem
 * servidor, sem custo, sem o arquivo sair da máquina). Os do Office (`soNoApp`)
 * usam o Word, o Excel e o PowerPoint instalados, pelo app de mesa.
 */

/**
 * Os blocos prontos para produção. Os outros só aparecem no dev, apagados, como
 * "em breve" — é o que deixa a liberação sair só com o que já foi testado
 * (decisão do usuário, 10/11/2026). Bloco novo pronto = entrar nesta lista.
 */
export const BLOCOS_PRONTOS: ReadonlySet<IdDoBloco> = new Set<IdDoBloco>([
  "editar-pdf",
  "juntar-pdfs",
  "separar-paginas",
  "comprimir-pdf",
  "girar-paginas",
  "pdf-imagens",
  "imagens-pdf",
  "converter-imagem",
  "reduzir-imagem",
  "pdf-excel",
  "ocr",
  // Pelo Office instalado, só no app de mesa 0.2.3 em diante (11/11/2026).
  "word-pdf",
  "pdf-word",
  "excel-pdf",
  "powerpoint-pdf",
]);

/**
 * Os blocos que fazem um PDF NOVO a partir do PDF da pessoa (12/11/2026): se o PDF tiver assinatura
 * digital, o novo sai sem ela valer, e a pessoa confirma antes. O Editor pergunta na hora de salvar.
 */
export const GERAM_PDF_NOVO: ReadonlySet<IdDoBloco> = new Set<IdDoBloco>([
  "juntar-pdfs",
  "separar-paginas",
  "comprimir-pdf",
  "girar-paginas",
  "ocr",
]);

/** Teto do modo local (a especificação: 200 MB por arquivo). O navegador segura tudo na memória. */
export const LIMITE_LOCAL_BYTES = 200 * 1024 * 1024;

/** Teto de arquivos de uma vez nos blocos que aceitam vários (a especificação: juntar até 30). */
export const MAXIMO_DE_ARQUIVOS = 30;

export const GRUPOS: readonly GrupoDoBloco[] = ["PDF", "PARA PDF", "IMAGEM"];

const PDF = { ext: ["pdf"], mime: ["application/pdf"] } as const;
const JPG_PNG = {
  ext: ["jpg", "jpeg", "jpe", "jfif", "png"],
  mime: ["image/jpeg", "image/png"],
} as const;
const IMAGEM = {
  ext: ["heic", "heif", "png", "jpg", "jpeg", "jpe", "jfif", "webp"],
  mime: ["image/heic", "image/heif", "image/png", "image/jpeg", "image/webp"],
} as const;
const WORD = {
  ext: ["doc", "docx", "odt", "rtf"],
  mime: [
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.oasis.opendocument.text",
    "application/rtf",
  ],
} as const;
const EXCEL = {
  ext: ["xls", "xlsx", "ods", "csv"],
  mime: [
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.oasis.opendocument.spreadsheet",
    "text/csv",
  ],
} as const;
const POWERPOINT = {
  ext: ["ppt", "pptx", "odp"],
  mime: [
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.presentation",
  ],
} as const;

export const BLOCOS: readonly Bloco[] = [
  /* ------------------------------- PDF ------------------------------- */
  {
    id: "pdf-excel",
    rotulo: "PDF → Excel",
    dica: "Tabelas do PDF numa planilha",
    atencao:
      "Conversão aproximada: confira a planilha. PDF escaneado precisa passar pelo OCR antes.",
    de: "PDF",
    para: "Excel",
    grupo: "PDF",
    icone: FileSpreadsheet,
    aceita: PDF,
    etapa: "abas",
    executar: async (arquivos, opcoes, ao) =>
      (await import("./locais/pdf-excel")).pdfParaExcel(arquivos, opcoes, ao),
  },
  {
    id: "pdf-word",
    rotulo: "PDF → Word",
    dica: "Texto do PDF num .docx",
    atencao:
      "O Word refaz o layout: tabelas, colunas e fontes podem mudar de lugar. Confira o .docx.",
    de: "PDF",
    para: "Word",
    grupo: "PDF",
    icone: FileText,
    aceita: PDF,
    soNoApp: true,
    etapa: "nenhuma",
    executar: async (arquivos, _opcoes, ao) =>
      (await import("./locais/office")).converterNoOffice(arquivos, "docx", "Word", ao),
  },
  {
    id: "editar-pdf",
    rotulo: "Editar PDF",
    dica: "Texto, imagem, assinatura e páginas",
    atencao:
      "A assinatura digital do PDF deixa de valer. Trocar texto não é tarja: autor e datas do arquivo ficam.",
    de: "PDF",
    para: "PDF editado",
    grupo: "PDF",
    icone: FilePenLine,
    aceita: PDF,
    etapa: "editar",
    executar: async (arquivos, opcoes, ao) => {
      if (!opcoes.edicao) throw new ErroDeConversao("Nada para salvar.", "SEM_EDICAO");
      return (await import("./locais/editor/aplicar")).salvarEdicao(arquivos, opcoes.edicao, ao);
    },
  },
  {
    id: "juntar-pdfs",
    rotulo: "Juntar PDFs",
    dica: "Vários PDFs em um só",
    atencao:
      "O PDF novo sai sem os marcadores e sem assinatura digital, e os campos de formulário podem parar de funcionar.",
    de: "2 ou mais PDFs",
    para: "1 PDF",
    grupo: "PDF",
    icone: FileStack,
    aceita: PDF,
    varios: true,
    maximo: MAXIMO_DE_ARQUIVOS,
    etapa: "ordenar",
    executar: async (arquivos, _opcoes, ao) =>
      (await import("./locais/pdf")).juntarPdfs(arquivos, ao),
  },
  {
    id: "separar-paginas",
    rotulo: "Separar páginas",
    dica: "Extrai páginas num novo PDF",
    atencao:
      "O PDF novo sai sem os marcadores e sem assinatura digital, e os campos de formulário podem parar de funcionar.",
    de: "1 PDF",
    para: "PDF ou ZIP",
    grupo: "PDF",
    icone: Scissors,
    aceita: PDF,
    etapa: "paginas",
    executar: async (arquivos, opcoes, ao) =>
      (await import("./locais/pdf")).separarPaginas(arquivos, opcoes, ao),
  },
  {
    id: "comprimir-pdf",
    rotulo: "Comprimir PDF",
    dica: "Deixa o PDF mais leve",
    atencao:
      "Leve: as fotos perdem um pouco de nitidez. Forte: o texto vira imagem. A assinatura digital deixa de valer.",
    de: "PDF",
    para: "PDF menor",
    grupo: "PDF",
    icone: FileArchive,
    aceita: PDF,
    etapa: "nivel",
    executar: async (arquivos, opcoes, ao) =>
      (await import("./locais/comprimir")).comprimirPdf(arquivos, opcoes, ao),
  },
  {
    id: "girar-paginas",
    rotulo: "Girar páginas",
    dica: "Endireita páginas de lado",
    atencao: "O PDF é gravado de novo: a assinatura digital deixa de valer.",
    de: "PDF",
    para: "PDF girado",
    grupo: "PDF",
    icone: RotateCw,
    aceita: PDF,
    etapa: "girar",
    executar: async (arquivos, opcoes, ao) =>
      (await import("./locais/pdf")).girarPaginas(arquivos, opcoes, ao),
  },
  {
    id: "pdf-imagens",
    rotulo: "PDF → imagens",
    dica: "Cada página vira um PNG",
    atencao: "Cada página vira uma imagem: o texto deixa de ser texto. Até 100 páginas.",
    de: "PDF",
    para: "PNGs",
    grupo: "PDF",
    icone: Images,
    aceita: PDF,
    etapa: "nenhuma",
    executar: async (arquivos, _opcoes, ao) =>
      (await import("./locais/pdf")).pdfParaImagens(arquivos, ao),
  },
  {
    id: "ocr",
    rotulo: "OCR (escaneado)",
    dica: "PDF escaneado vira pesquisável",
    atencao:
      "A leitura depende da qualidade do escaneamento: confira o texto. Até 100 páginas; a assinatura digital deixa de valer.",
    de: "PDF escaneado",
    para: "PDF com texto",
    grupo: "PDF",
    icone: ScanText,
    aceita: PDF,
    etapa: "idioma",
    executar: async (arquivos, opcoes, ao) =>
      (await import("./locais/ocr")).ocrNoPdf(arquivos, opcoes, ao),
  },

  /* ----------------------------- PARA PDF ----------------------------- */
  {
    id: "word-pdf",
    rotulo: "Word → PDF",
    dica: ".doc, .docx, .odt",
    atencao: "Usa o Word instalado. Documento com senha é recusado: tire a senha antes.",
    de: "Word",
    para: "PDF",
    grupo: "PARA PDF",
    icone: FileText,
    aceita: WORD,
    soNoApp: true,
    etapa: "nenhuma",
    executar: async (arquivos, _opcoes, ao) =>
      (await import("./locais/office")).converterNoOffice(arquivos, "pdf", "Word", ao),
  },
  {
    id: "excel-pdf",
    rotulo: "Excel → PDF",
    dica: ".xls, .xlsx, .ods, .csv",
    atencao:
      "Usa o Excel instalado e sai como na impressão (área e quebras de página). Arquivo com senha é recusado.",
    de: "Excel",
    para: "PDF",
    grupo: "PARA PDF",
    icone: FileSpreadsheet,
    aceita: EXCEL,
    soNoApp: true,
    etapa: "nenhuma",
    executar: async (arquivos, _opcoes, ao) =>
      (await import("./locais/office")).converterNoOffice(arquivos, "pdf", "Excel", ao),
  },
  {
    id: "powerpoint-pdf",
    rotulo: "PowerPoint → PDF",
    dica: ".ppt, .pptx, .odp",
    atencao:
      "Usa o PowerPoint instalado: animação e vídeo viram imagem parada. Arquivo com senha é recusado.",
    de: "PowerPoint",
    para: "PDF",
    grupo: "PARA PDF",
    icone: Presentation,
    aceita: POWERPOINT,
    soNoApp: true,
    etapa: "nenhuma",
    executar: async (arquivos, _opcoes, ao) =>
      (await import("./locais/office")).converterNoOffice(arquivos, "pdf", "PowerPoint", ao),
  },
  {
    id: "imagens-pdf",
    rotulo: "Imagens → PDF",
    dica: "JPG e PNG num PDF",
    atencao: "Cada imagem vira uma página A4, com margem. Até 30 imagens de uma vez.",
    de: "JPG ou PNG",
    para: "1 PDF",
    grupo: "PARA PDF",
    icone: FileImage,
    aceita: JPG_PNG,
    varios: true,
    maximo: MAXIMO_DE_ARQUIVOS,
    etapa: "ordenar",
    executar: async (arquivos, _opcoes, ao) =>
      (await import("./locais/pdf")).imagensParaPdf(arquivos, ao),
  },

  /* ------------------------------ IMAGEM ------------------------------ */
  {
    id: "converter-imagem",
    rotulo: "Converter imagem",
    dica: "HEIC, PNG, JPG ou WebP",
    atencao:
      "JPG não guarda transparência (o fundo fica branco). Os dados da foto (câmera, local, data) saem.",
    de: "HEIC, PNG, JPG, WebP",
    para: "JPG, PNG, WebP",
    grupo: "IMAGEM",
    icone: RefreshCw,
    aceita: IMAGEM,
    etapa: "formato",
    executar: async (arquivos, opcoes, ao) =>
      (await import("./locais/imagem")).converterImagem(arquivos, opcoes, ao),
  },
  {
    id: "reduzir-imagem",
    rotulo: "Reduzir imagem",
    dica: "Deixa a foto mais leve",
    atencao:
      "A imagem fica com até 1600 px no lado maior: perde detalhe em impressão grande. Os dados da foto saem.",
    de: "Foto ou imagem",
    para: "Imagem leve",
    grupo: "IMAGEM",
    icone: ImageDown,
    aceita: IMAGEM,
    etapa: "nenhuma",
    executar: async (arquivos, _opcoes, ao) =>
      (await import("./locais/imagem")).reduzirImagem(arquivos, ao),
  },
];

/** Os blocos que aparecem: os prontos e, no dev, também os em construção (apagados). */
export function blocosDaPaleta(): Bloco[] {
  return BLOCOS.filter((b) => BLOCOS_PRONTOS.has(b.id) || import.meta.env.DEV);
}

/** Por que um bloco não converte aqui: o selo curto, no próprio bloco, e a frase, no centro da roda. */
export type MotivoDeIndisponivel = { selo: string; frase: string };

/**
 * O bloco serve neste ambiente? `null` = serve. Senão, o motivo: o bloco aparece
 * apagado, recusa o arquivo, e o centro da roda explica (decisão do usuário,
 * 10/11/2026: no navegador, os do Office aparecem apagados, com o aviso).
 */
export function porQueNaoServe(
  bloco: Bloco,
  ambiente: AmbienteDoConversor,
): MotivoDeIndisponivel | null {
  if (!BLOCOS_PRONTOS.has(bloco.id)) {
    return { selo: "Em breve", frase: "Em breve: este bloco ainda está em construção." };
  }
  if (bloco.soNoApp && ambiente === "navegador") {
    return {
      selo: "Só no app",
      frase: "Só no app de mesa: este bloco usa o Office instalado no computador.",
    };
  }
  if (bloco.soNoApp && ambiente === "app-antigo") {
    return {
      selo: "Atualizar",
      frase: "Este bloco precisa da versão nova do app de mesa, que chega sozinha.",
    };
  }
  return null;
}

/** "Contrato Final.PDF" → "pdf". Sem ponto → "". */
export function extensaoDe(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i > 0 ? nome.slice(i + 1).toLowerCase() : "";
}

/**
 * O arquivo serve para o bloco? Na hora de soltar ou escolher: pela extensão,
 * e pelo MIME quando o nome não tem extensão. O Windows costuma não informar
 * MIME para .heic — por isso a extensão manda.
 */
export function aceitaArquivo(bloco: Bloco, arquivo: File): boolean {
  const ext = extensaoDe(arquivo.name);
  if (ext) return bloco.aceita.ext.includes(ext);
  return arquivo.type !== "" && bloco.aceita.mime.includes(arquivo.type.toLowerCase());
}

/**
 * Durante o arraste só existe o MIME de cada item (`DataTransferItem.type`),
 * e às vezes vazio. "talvez" = não dá para saber agora; a conferência de
 * verdade é no soltar (`aceitaArquivo`).
 */
export function aceitaNoArraste(bloco: Bloco, tipos: readonly string[]): "sim" | "nao" | "talvez" {
  if (tipos.length === 0) return "talvez";
  if (tipos.length > 1 && !bloco.varios) return "nao";
  let desconhecido = false;
  for (const tipo of tipos) {
    const t = tipo.toLowerCase();
    if (!t) {
      desconhecido = true;
      continue;
    }
    if (!bloco.aceita.mime.includes(t)) return "nao";
  }
  return desconhecido ? "talvez" : "sim";
}

/** "PDF", "JPG ou PNG"… — para a frase de recusa ("Este bloco aceita: …"). */
export function oQueAceita(bloco: Bloco): string {
  const nomes = [...new Set(bloco.aceita.ext.map((e) => (e === "jpeg" ? "jpg" : e)))].map((e) =>
    e === "webp" ? "WebP" : e.toUpperCase(),
  );
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} ou ${nomes[nomes.length - 1]}`;
}

/** O atributo `accept` do seletor de arquivos ("abrir as pastas"). */
export function acceptDoSeletor(bloco: Bloco): string {
  return [...bloco.aceita.ext.map((e) => `.${e}`), ...bloco.aceita.mime].join(",");
}
