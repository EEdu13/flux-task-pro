import assert from "node:assert/strict";
import test from "node:test";
import pdfLib from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  lerValor,
  montarAbas,
  montarPagina,
  tracosDoDesenho,
  trechosDaPagina,
  type PaginaDoPdfjs,
} from "../src/components/conversor/locais/tabelas.ts";
import { gerarXlsx } from "../src/lib/planilha-xlsx.ts";

/*
 * PDF → Excel com respostas esperadas (12/11/2026): PDFs desenhados aqui com o pdf-lib, lidos pelo
 * pdf.js e montados pelo MESMO `tabelas.ts` do navegador. Os PDFs reais do usuário ficam fora do
 * git; estes cobrem os casos que eles ensinaram: tabela com bordas (e célula mesclada), formulário
 * dentro de molduras, relatório de várias páginas com cabeçalho e rodapé.
 */

const { PDFDocument, StandardFonts, rgb } = pdfLib;
type Pagina = ReturnType<InstanceType<typeof PDFDocument>["addPage"]>;
type Fonte = Awaited<ReturnType<InstanceType<typeof PDFDocument>["embedFont"]>>;

async function pdfCom(paginas: ((p: Pagina, f: Fonte) => void)[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (const desenhar of paginas) desenhar(doc.addPage([595, 842]), fonte);
  return doc.save();
}

async function ler(bytes: Uint8Array) {
  // No pdf.js 6 quem se fecha é a tarefa de abertura, não o documento.
  const tarefa = pdfjs.getDocument({ data: bytes, verbosity: 0 });
  const doc = await tarefa.promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = (await doc.getPage(n)) as unknown as PaginaDoPdfjs;
    const vista = p.getViewport({ scale: 1 });
    const trechos = await trechosDaPagina(p);
    const tracos = tracosDoDesenho(await p.getOperatorList(), pdfjs.OPS, vista.transform);
    paginas.push(montarPagina(trechos, tracos, vista.height));
  }
  await tarefa.destroy();
  return paginas;
}

const COLUNAS = [50, 110, 300, 380, 520];
const ALTURA_DA_LINHA = 20;

/** Uma tabela com bordas; `mesclar` tira as bordas internas de uma linha entre as colunas `de` e `ate`. */
function tabela(
  p: Pagina,
  f: Fonte,
  topo: number,
  linhas: string[][],
  opcoes: {
    mesclar?: { linha: number; de: number; ate: number };
    jeito?: "linha" | "retangulo";
  } = {},
) {
  const ys = Array.from({ length: linhas.length + 1 }, (_, i) => topo - i * ALTURA_DA_LINHA);
  const traco = (x0: number, y0: number, x1: number, y1: number) => {
    if (opcoes.jeito === "retangulo") {
      // O Word desenha a borda como retângulo pintado fino.
      const fino = 0.6;
      if (y0 === y1)
        p.drawRectangle({
          x: x0,
          y: y0 - fino / 2,
          width: x1 - x0,
          height: fino,
          color: rgb(0, 0, 0),
        });
      else
        p.drawRectangle({
          x: x0 - fino / 2,
          y: y1,
          width: fino,
          height: y0 - y1,
          color: rgb(0, 0, 0),
        });
    } else {
      p.drawLine({
        start: { x: x0, y: y0 },
        end: { x: x1, y: y1 },
        thickness: 0.8,
        color: rgb(0, 0, 0),
      });
    }
  };
  for (const y of ys) traco(COLUNAS[0]!, y, COLUNAS[COLUNAS.length - 1]!, y);
  linhas.forEach((_, i) => {
    COLUNAS.forEach((x, k) => {
      const m = opcoes.mesclar;
      if (m && m.linha === i && k > m.de && k <= m.ate) return;
      traco(x, ys[i]!, x, ys[i + 1]!);
    });
  });
  linhas.forEach((l, i) =>
    l.forEach((t, k) => {
      if (t) p.drawText(t, { x: COLUNAS[k]! + 4, y: ys[i]! - 14, size: 10, font: f });
    }),
  );
}

const MATERIAIS = [
  ["Item", "Descrição", "Qtd", "Valor"],
  ["001", "Parafuso sextavado", "10", "R$ 1.234,56"],
  ["002", "Arruela lisa", "5", "R$ 10,00"],
  ["Total", "", "", "R$ 1.244,56"],
];

for (const jeito of ["linha", "retangulo"] as const) {
  test(`tabela com bordas (${jeito}): células exatas, célula mesclada e tipo pela coluna`, async () => {
    const bytes = await pdfCom([
      (p, f) => {
        p.drawText("Relatório de materiais", { x: 50, y: 780, size: 12, font: f });
        tabela(p, f, 740, MATERIAIS, { mesclar: { linha: 3, de: 0, ate: 2 }, jeito });
      },
    ]);
    const [aba] = montarAbas(await ler(bytes), "por-pagina");
    assert.ok(aba);
    assert.deepEqual(aba.linhas[0], ["Relatório de materiais"]);
    assert.deepEqual(aba.linhas[1], []);
    assert.deepEqual(aba.linhas[2], ["Item", "Descrição", "Qtd", "Valor"]);
    assert.deepEqual(aba.linhas[3], [
      "001",
      "Parafuso sextavado",
      10,
      { numero: 1234.56, formato: "moeda" },
    ]);
    assert.deepEqual(aba.linhas[4], ["002", "Arruela lisa", 5, { numero: 10, formato: "moeda" }]);
    assert.deepEqual(aba.linhas[5], ["Total", null, null, { numero: 1244.56, formato: "moeda" }]);
    assert.deepEqual(aba.mesclas, [{ linha: 5, coluna: 0, linhas: 1, colunas: 3 }]);

    const xlsx = new TextDecoder().decode(gerarXlsx([{ ...aba, cabecalho: false }]));
    assert.match(xlsx, /<mergeCell ref="A6:C6"\/>/);
    assert.match(xlsx, /<c r="D4" s="5"><v>1234.56<\/v><\/c>/);
  });
}

test("moldura de formulário (caixas com várias linhas) não vira tabela", async () => {
  const bytes = await pdfCom([
    (p, f) => {
      const linha = (x0: number, y0: number, x1: number, y1: number) =>
        p.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 0.8 });
      // Duas caixas lado a lado, em duas faixas, cada uma com três linhas de rótulo e valor.
      for (const y of [700, 630, 560]) linha(50, y, 545, y);
      for (const x of [50, 300, 545]) linha(x, 700, x, 560);
      const textos = [
        ["Nome: Fulano de Tal", "CPF: 123.456.789-00", "Cidade: Belo Horizonte"],
        ["Pedido: 4521", "Data: 12/11/2026", "Setor: Compras"],
        ["Obra: Ponte Norte", "Centro de custo: 400", "Fiscal: Beltrano"],
        ["Prazo: 30 dias", "Frete: CIF", "Pagamento: 28 ddl"],
      ];
      textos.forEach((caixa, i) => {
        const x = i % 2 === 0 ? 56 : 306;
        const topo = i < 2 ? 686 : 616;
        caixa.forEach((t, k) => p.drawText(t, { x, y: topo - k * 16, size: 10, font: f }));
      });
    },
  ]);
  const [aba] = montarAbas(await ler(bytes), "por-pagina");
  assert.ok(aba);
  assert.deepEqual(aba.mesclas, []);
  const lado = aba.linhas.find((l) => l.includes("Nome: Fulano de Tal"));
  assert.ok(lado, "cada linha do formulário continua na sua linha da planilha");
  assert.ok(
    lado.includes("Pedido: 4521"),
    "o rótulo da caixa da direita fica na mesma linha, em outra coluna",
  );
  assert.ok(aba.linhas.filter((l) => l.length > 0).length >= 6);
});

/** Um relatório sem bordas: cabeçalho da empresa, títulos, três linhas e o rodapé com o número da página. */
function paginaDeRelatorio(n: number, total: number) {
  return (p: Pagina, f: Fonte) => {
    p.drawText("Larsil - Relatório de vendas", { x: 50, y: 810, size: 12, font: f });
    for (const [t, x] of [
      ["Data", 50],
      ["Cliente", 150],
      ["Valor", 400],
    ] as const) {
      p.drawText(t, { x, y: 760, size: 10, font: f });
    }
    for (let k = 0; k < 3; k++) {
      const y = 740 - k * 15;
      p.drawText(`0${n}/11/2026`, { x: 50, y, size: 10, font: f });
      p.drawText(`Cliente ${n}${k}`, { x: 150, y, size: 10, font: f });
      p.drawText(`${n}.23${k},5${k}`, { x: 400, y, size: 10, font: f });
    }
    p.drawText(`Página ${n} de ${total}`, { x: 260, y: 30, size: 9, font: f });
  };
}

test("relatório sem bordas: tudo numa aba, sem cabeçalho e rodapé repetidos", async () => {
  const paginas = await ler(await pdfCom([1, 2, 3].map((n) => paginaDeRelatorio(n, 3))));
  const [uma, ...outras] = montarAbas(paginas, "uma-so");
  assert.equal(outras.length, 0);
  assert.ok(uma);
  const textos = uma.linhas.map((l) => l.filter((v) => v !== null && v !== undefined).length);
  const linhasComTexto = uma.linhas.filter((_, i) => textos[i]! > 0);
  // 1 cabeçalho + 1 títulos + 9 linhas de dados + 1 rodapé (o da última página)
  assert.equal(linhasComTexto.length, 12);
  assert.deepEqual(linhasComTexto[0], ["Larsil - Relatório de vendas"]);
  assert.deepEqual(linhasComTexto[1], ["Data", "Cliente", "Valor"]);
  const ultima = linhasComTexto[linhasComTexto.length - 1]!;
  assert.ok(
    ultima.some((v) => v === "Página 3 de 3"),
    "o rodapé que fica é o da última página",
  );
  const dados = linhasComTexto.slice(2, 11);
  for (const l of dados) {
    const [data, , valor] = l;
    assert.ok(data && typeof data === "object" && "data" in data, "a data vira data");
    assert.ok(
      valor && typeof valor === "object" && "formato" in valor && valor.formato === "decimal",
    );
  }
  // Uma aba por página: três abas, cada uma com o seu cabeçalho e rodapé.
  const porPagina = montarAbas(paginas, "por-pagina");
  assert.equal(porPagina.length, 3);
  assert.deepEqual(porPagina[1]!.linhas[0], ["Larsil - Relatório de vendas"]);
});

test("tabela com bordas que continua na página seguinte vira uma tabela só", async () => {
  const titulos = ["Item", "Descrição", "Qtd", "Valor"];
  const paginas = await ler(
    await pdfCom([
      (p, f) =>
        tabela(p, f, 760, [
          titulos,
          ["001", "Cabo", "1", "R$ 5,00"],
          ["002", "Fita", "2", "R$ 7,50"],
          ["003", "Luva", "3", "R$ 9,90"],
        ]),
      (p, f) =>
        tabela(p, f, 760, [
          titulos,
          ["004", "Bota", "1", "R$ 120,00"],
          ["005", "Capacete", "1", "R$ 80,00"],
        ]),
    ]),
  );
  const [aba] = montarAbas(paginas, "uma-so");
  assert.ok(aba);
  assert.equal(
    aba.linhas.length,
    6,
    "títulos uma vez e as cinco linhas, sem linha em branco no meio",
  );
  assert.deepEqual(aba.linhas[0], titulos);
  assert.deepEqual(aba.linhas[5], ["005", "Capacete", 1, { numero: 80, formato: "moeda" }]);
});

test("coluna de códigos: o número sem zero à esquerda também fica texto", async () => {
  const bytes = await pdfCom([
    (p, f) =>
      tabela(p, f, 760, [
        ["Código", "Peça", "Qtd", "Preço"],
        ["00123", "Rolamento", "4", "12,50"],
        ["456", "Retentor", "2", "8"],
        ["00789", "Correia", "1", "1.020,00"],
      ]),
  ]);
  const [aba] = montarAbas(await ler(bytes), "por-pagina");
  assert.ok(aba);
  assert.deepEqual(aba.linhas[2], ["456", "Retentor", 2, { numero: 8, formato: "decimal" }]);
  assert.deepEqual(aba.linhas[3]![3], { numero: 1020, formato: "decimal" });
});

test("leitura dos valores como no Brasil (o que já valia continua)", () => {
  assert.equal(lerValor("1.234,56"), 1234.56);
  assert.equal(lerValor("(1.234,56)"), -1234.56);
  assert.equal(lerValor("R$ 1.234,56"), 1234.56);
  assert.equal(lerValor("000123"), "000123");
  assert.equal(lerValor("123.456.789-00"), "123.456.789-00");
  assert.equal(lerValor("15%"), "15%");
  const d = lerValor("11/11/2026");
  assert.ok(d && typeof d === "object" && "data" in d && d.data.getDate() === 11);
});
