/**
 * A ata em PDF, num padrão só para a empresa inteira (20/10/2026: "padronizar
 * um negócio bem legal no CONECTA: exportar ata em PDF, completa e com os
 * planos de ação").
 *
 * Ordem do documento: cabeçalho (sala, data, participantes, quem gerou) → a
 * ata (resumo, assuntos, decisões, próximos passos, atenção) → o plano de ação
 * numa tabela, com o andamento de cada item que virou tarefa → a transcrição,
 * em letra menor, no fim.
 *
 * O jsPDF entra só no clique (import dinâmico): ninguém carrega o PDF para
 * abrir a tela de atas.
 */

export interface ItemDoPlano {
  tipo: string;
  texto: string;
  responsavel: string | null;
  prazo: string | null;
  situacao: string;
}

export interface AtaParaPdf {
  titulo: string;
  criadaEm: string;
  participantes: string[];
  geradaPor: string | null;
  markdown: string;
  plano: ItemDoPlano[];
}

const VERDE: [number, number, number] = [27, 122, 61];
const TEXTO: [number, number, number] = [24, 32, 28];
const SUAVE: [number, number, number] = [96, 110, 102];

/* As fontes padrão do PDF não têm emoji nem símbolos fora do Latin-1: o que
   não tem desenho vira nada, em vez de um quadradinho. */
const limpar = (s: string) =>
  s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\t\n\r\x20-\x7E\xA0-\xFF\u2022]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();

/** O texto sem o negrito/itálico do markdown (o PDF marca o negrito à parte). */
const semMarcas = (s: string) =>
  s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|\s)_(.+?)_(?=\s|$)/g, "$1$2");

export async function exportarAtaEmPdf(ata: AtaParaPdf): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = doc.internal.pageSize.getWidth();
  const A = doc.internal.pageSize.getHeight();
  const M = 16; // margem
  const largura = L - M * 2;
  let y = 0;

  const novaPaginaSePreciso = (altura: number) => {
    if (y + altura > A - 18) {
      doc.addPage();
      y = 18;
    }
  };

  const paragrafo = (
    texto: string,
    o: {
      tam?: number;
      negrito?: boolean;
      cor?: [number, number, number];
      recuo?: number;
      antes?: number;
      entre?: number;
    } = {},
  ) => {
    const tam = o.tam ?? 10;
    const recuo = o.recuo ?? 0;
    doc.setFont("helvetica", o.negrito ? "bold" : "normal");
    doc.setFontSize(tam);
    doc.setTextColor(...(o.cor ?? TEXTO));
    const linhas = doc.splitTextToSize(limpar(texto), largura - recuo) as string[];
    const passo = tam * 0.43;
    y += o.antes ?? 0;
    for (const l of linhas) {
      novaPaginaSePreciso(passo);
      doc.text(l, M + recuo, y);
      y += passo;
    }
    y += o.entre ?? 1.2;
  };

  /* ---------------- cabeçalho ---------------- */
  doc.setFillColor(...VERDE);
  doc.rect(0, 0, L, 34, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("PLANTSIL  ·  CONECTA", M, 10);
  doc.setFontSize(18);
  doc.text("Ata de reunião", M, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(doc.splitTextToSize(limpar(ata.titulo), largura - 50)[0] ?? "", M, 28);
  const quando = new Date(ata.criadaEm);
  doc.setFontSize(9);
  doc.text(
    `${quando.toLocaleDateString("pt-BR")} · ${quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
    L - M,
    20,
    { align: "right" },
  );
  y = 44;

  paragrafo(`Participantes: ${ata.participantes.join(", ") || "não identificados"}`, {
    tam: 9.5,
    cor: SUAVE,
  });
  if (ata.geradaPor) paragrafo(`Gerada por: ${ata.geradaPor}`, { tam: 9.5, cor: SUAVE });
  y += 2;

  /* ---------------- a ata (sem a transcrição) ---------------- */
  const corte = ata.markdown.search(/^###\s+Transcri/m);
  const corpo = corte >= 0 ? ata.markdown.slice(0, corte) : ata.markdown;
  const transcricao = corte >= 0 ? ata.markdown.slice(corte).split("\n").slice(1) : [];

  for (const bruta of corpo.split("\n")) {
    const linha = bruta.trimEnd();
    if (!linha.trim()) {
      y += 1.2;
      continue;
    }
    // O título e os participantes já estão no cabeçalho.
    if (/^##\s/.test(linha) || /^\*\*Participantes:\*\*/.test(linha)) continue;
    if (/^###\s/.test(linha)) {
      y += 3;
      novaPaginaSePreciso(12);
      doc.setFillColor(...VERDE);
      doc.rect(M, y - 3.6, 1.4, 5, "F");
      paragrafo(linha.replace(/^###\s+/, ""), { tam: 12.5, negrito: true, recuo: 4, entre: 2 });
      continue;
    }
    const caixa = /^- \[[ x]\]\s+(.*)$/.exec(linha);
    if (caixa) {
      paragrafo(`[  ]  ${semMarcas(caixa[1]!)}`, { recuo: 3 });
      continue;
    }
    const topico = /^-\s+(.*)$/.exec(linha);
    if (topico) {
      paragrafo(`•  ${semMarcas(topico[1]!)}`, { recuo: 3 });
      continue;
    }
    if (/^\*\*.+\*\*$/.test(linha.trim())) {
      paragrafo(semMarcas(linha), { negrito: true, antes: 1.5 });
      continue;
    }
    paragrafo(semMarcas(linha), { cor: /^_.*_$/.test(linha.trim()) ? SUAVE : TEXTO });
  }

  /* ---------------- plano de ação ---------------- */
  y += 4;
  novaPaginaSePreciso(24);
  doc.setFillColor(...VERDE);
  doc.rect(M, y - 3.6, 1.4, 5, "F");
  paragrafo("Plano de ação", { tam: 12.5, negrito: true, recuo: 4, entre: 2 });
  if (!ata.plano.length) {
    paragrafo("Nenhum item de plano de ação nesta ata.", { cor: SUAVE });
  } else {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [["Tipo", "Item", "Responsável", "Prazo", "Situação"]],
      body: ata.plano.map((p) => [
        limpar(p.tipo),
        limpar(p.texto),
        limpar(p.responsavel ?? "-"),
        limpar(p.prazo ?? "-"),
        limpar(p.situacao),
      ]),
      styles: { font: "helvetica", fontSize: 9, cellPadding: 2.2, textColor: TEXTO, valign: "top" },
      headStyles: { fillColor: VERDE, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [243, 247, 244] },
      columnStyles: {
        0: { cellWidth: 26 },
        2: { cellWidth: 32 },
        3: { cellWidth: 22 },
        4: { cellWidth: 28 },
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  /* ---------------- transcrição ---------------- */
  const falas = transcricao.filter((l) => l.trim());
  if (falas.length) {
    y += 4;
    novaPaginaSePreciso(20);
    doc.setFillColor(...VERDE);
    doc.rect(M, y - 3.6, 1.4, 5, "F");
    paragrafo("Transcrição da reunião", { tam: 12.5, negrito: true, recuo: 4, entre: 2 });
    for (const f of falas) paragrafo(semMarcas(f), { tam: 8.5, cor: SUAVE, entre: 0.6 });
  }

  /* ---------------- rodapé de cada página ---------------- */
  const paginas = doc.getNumberOfPages();
  const geradoEm = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...SUAVE);
    doc.text(`CONECTA · ata exportada em ${geradoEm}`, M, A - 8);
    doc.text(`Página ${i} de ${paginas}`, L - M, A - 8, { align: "right" });
  }

  const nome = limpar(ata.titulo)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  doc.save(`ata-${nome || "reuniao"}-${quando.toISOString().slice(0, 10)}.pdf`);
}
