import {
  decodePDFRawStream,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  type PDFDocument,
  type PDFPage,
} from "pdf-lib";

/*
 * O texto antigo que fica fora da página (12/11/2026). Trocar uma linha no Editor tira as letras
 * velhas do conteúdo, mas o mesmo texto pode estar guardado em outros cantos do arquivo:
 * - no título, no assunto e nas palavras-chave do documento (o Word põe o título ali);
 * - nos metadados XMP, a cópia em XML dessas informações;
 * - nos marcadores (o sumário lateral), quando a linha era um título;
 * - na miniatura embutida da página, que é uma IMAGEM da página antiga.
 * Aqui o texto antigo vira o novo nesses lugares, e a miniatura das páginas editadas sai (o
 * leitor de PDF desenha outra). O `/ActualText` de dentro da página é tratado no próprio
 * conteúdo (`conteudo.ts`). Não é uma tarja certificada: autor, programa e datas ficam.
 */

export type TrocaDeTexto = { antes: string; depois: string };

/** Texto com menos que isto é comum demais ("de", "R$") para ser trocado fora da página. */
const MINIMO_PARA_TROCAR = 3;

function textoDe(v: unknown): string | null {
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : null;
}

function escaparXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function limparRastros(
  doc: PDFDocument,
  trocas: readonly TrocaDeTexto[],
  paginasEditadas: readonly PDFPage[],
): void {
  for (const p of paginasEditadas) p.node.delete(PDFName.of("Thumb"));

  const uteis = trocas
    .map((t) => ({ antes: t.antes.trim(), depois: t.depois.trim() }))
    .filter((t) => t.antes.length >= MINIMO_PARA_TROCAR && t.antes !== t.depois);
  if (uteis.length === 0) return;
  const trocar = (s: string) => uteis.reduce((acc, t) => acc.split(t.antes).join(t.depois), s);
  const ctx = doc.context;

  // O título, o assunto e as palavras-chave.
  const info = ctx.trailerInfo.Info ? ctx.lookup(ctx.trailerInfo.Info) : undefined;
  if (info instanceof PDFDict) {
    for (const chave of ["Title", "Subject", "Keywords"]) {
      const antes = textoDe(info.lookup(PDFName.of(chave)));
      if (antes === null) continue;
      const depois = trocar(antes);
      if (depois !== antes) info.set(PDFName.of(chave), PDFHexString.fromText(depois));
    }
  }

  // Os metadados XMP (um XML em UTF-8, às vezes comprimido).
  const chaveXmp = PDFName.of("Metadata");
  const xmp = doc.catalog.lookup(chaveXmp);
  if (xmp instanceof PDFRawStream) {
    try {
      const xml = new TextDecoder().decode(decodePDFRawStream(xmp).decode());
      const novo = uteis.reduce(
        (acc, t) => acc.split(escaparXml(t.antes)).join(escaparXml(t.depois)),
        xml,
      );
      if (novo !== xml) {
        const fluxo = ctx.stream(new TextEncoder().encode(novo), {
          Type: "Metadata",
          Subtype: "XML",
        });
        const ref = doc.catalog.get(chaveXmp);
        if (ref instanceof PDFRef) ctx.assign(ref, fluxo);
        else doc.catalog.set(chaveXmp, ctx.register(fluxo));
      }
    } catch {
      // XMP que não dá para ler fica como está: o resto do salvar não depende dele.
    }
  }

  // Os marcadores: a árvore de /First e /Next, sem voltar a um que já passou.
  const raiz = doc.catalog.lookup(PDFName.of("Outlines"));
  if (raiz instanceof PDFDict) {
    const vistos = new Set<PDFDict>();
    const fila: unknown[] = [raiz.lookup(PDFName.of("First"))];
    while (fila.length > 0) {
      const item = fila.pop();
      if (!(item instanceof PDFDict) || vistos.has(item)) continue;
      vistos.add(item);
      const antes = textoDe(item.lookup(PDFName.of("Title")));
      if (antes !== null) {
        const depois = trocar(antes);
        if (depois !== antes) item.set(PDFName.of("Title"), PDFHexString.fromText(depois));
      }
      fila.push(item.lookup(PDFName.of("First")), item.lookup(PDFName.of("Next")));
    }
  }
}
