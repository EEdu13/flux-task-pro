/**
 * Planilha .xlsx sem biblioteca (pedido do usuário, 13/10/2026: "não exporte
 * nada em CSV, tudo em XLSX — CSV ninguém usa mais").
 *
 * Um .xlsx é um ZIP com meia dúzia de XMLs. Escrever o ZIP aqui (sem
 * compressão, "stored") custa ~100 linhas e evita uma dependência nova só
 * para exportar — o pacote de planilha mais comum pesa mais de 1 MB no
 * navegador. Roda igual no navegador e no servidor (só usa Uint8Array).
 *
 * O que sai: uma aba por `Aba`, a primeira linha em negrito e congelada,
 * filtro automático no cabeçalho e largura das colunas pelo conteúdo. Número
 * vai como número (dá para somar no Excel); `Date` vira data de verdade.
 */

export type Celula = string | number | Date | null | undefined;
export type Aba = { nome: string; linhas: Celula[][] };

const enc = new TextEncoder();

/** Caracteres de controle não cabem em XML 1.0 (quebra de linha e tab cabem). */
function semControle(s: string): string {
  let r = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 32 || c === 9 || c === 10 || c === 13) r += ch;
  }
  return r;
}

function xml(s: string): string {
  return semControle(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A1, B1 … Z1, AA1 … */
function coluna(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Data → número de série do Excel (dias desde 30/12/1899), no horário local. */
function serial(d: Date): number {
  const local = Date.UTC(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  );
  return local / 86_400_000 + 25569;
}

function folha(aba: Aba): string {
  const larguras: number[] = [];
  const linhas = aba.linhas
    .map((linha, r) => {
      const cels = linha
        .map((v, c) => {
          const ref = `${coluna(c)}${r + 1}`;
          const negrito = r === 0 ? ' s="1"' : "";
          const texto =
            v instanceof Date ? "00/00/0000 00:00" : v === null || v === undefined ? "" : String(v);
          larguras[c] = Math.max(larguras[c] ?? 0, Math.min(60, texto.length + 2));
          if (v === null || v === undefined || v === "") return "";
          if (typeof v === "number" && Number.isFinite(v))
            return `<c r="${ref}"${negrito}><v>${v}</v></c>`;
          if (v instanceof Date && !Number.isNaN(v.getTime()))
            return `<c r="${ref}" s="2"><v>${serial(v)}</v></c>`;
          return `<c r="${ref}" t="inlineStr"${negrito}><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cels}</row>`;
    })
    .join("");
  const cols = larguras
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, w)}" customWidth="1"/>`)
    .join("");
  const ultima = `${coluna(Math.max(0, larguras.length - 1))}${Math.max(1, aba.linhas.length)}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${linhas}</sheetData>` +
    (aba.linhas.length > 1 ? `<autoFilter ref="A1:${ultima}"/>` : "") +
    `</worksheet>`
  );
}

/** Nome de aba válido no Excel: até 31 caracteres, sem : \ / ? * [ ], sem repetir. */
function nomesDeAba(abas: Aba[]): string[] {
  const usados = new Set<string>();
  return abas.map((a, i) => {
    let n =
      (a.nome || `Aba ${i + 1}`)
        .replace(/[:\\/?*[\]]/g, " ")
        .trim()
        .slice(0, 31) || `Aba ${i + 1}`;
    const base = n.slice(0, 28);
    for (let k = 2; usados.has(n.toLowerCase()); k++) n = `${base} ${k}`;
    usados.add(n.toLowerCase());
    return n;
  });
}

/* ————————————————— ZIP (sem compressão) ————————————————— */

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABELA_CRC[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(arquivos: { nome: string; dados: Uint8Array }[]): Uint8Array {
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let pos = 0;
  for (const a of arquivos) {
    const nome = enc.encode(a.nome);
    const crc = crc32(a.dados);
    const local = new Uint8Array(30 + nome.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true); // nomes em UTF-8
    v.setUint16(8, 0, true); // stored
    v.setUint32(14, crc, true);
    v.setUint32(18, a.dados.length, true);
    v.setUint32(22, a.dados.length, true);
    v.setUint16(26, nome.length, true);
    local.set(nome, 30);
    partes.push(local, a.dados);

    const c = new Uint8Array(46 + nome.length);
    const w = new DataView(c.buffer);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint16(8, 0x0800, true);
    w.setUint16(10, 0, true);
    w.setUint32(16, crc, true);
    w.setUint32(20, a.dados.length, true);
    w.setUint32(24, a.dados.length, true);
    w.setUint16(28, nome.length, true);
    w.setUint32(42, pos, true);
    c.set(nome, 46);
    central.push(c);
    pos += local.length + a.dados.length;
  }
  const tamCentral = central.reduce((s, c) => s + c.length, 0);
  const fim = new Uint8Array(22);
  const f = new DataView(fim.buffer);
  f.setUint32(0, 0x06054b50, true);
  f.setUint16(8, arquivos.length, true);
  f.setUint16(10, arquivos.length, true);
  f.setUint32(12, tamCentral, true);
  f.setUint32(16, pos, true);
  const total = new Uint8Array(pos + tamCentral + 22);
  let o = 0;
  for (const p of [...partes, ...central, fim]) {
    total.set(p, o);
    o += p.length;
  }
  return total;
}

/** O arquivo .xlsx em bytes. */
export function gerarXlsx(abas: Aba[]): Uint8Array {
  const nomes = nomesDeAba(abas);
  const arquivos = [
    {
      nome: "[Content_Types].xml",
      texto:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        abas
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        `</Types>`,
    },
    {
      nome: "_rels/.rels",
      texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nome: "xl/workbook.xml",
      texto:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        nomes
          .map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join("") +
        `</sheets>` +
        // O filtro automático precisa do nome definido para o Excel não "reparar" o arquivo.
        `<definedNames>` +
        abas
          .map((a, i) =>
            a.linhas.length > 1
              ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(nomes[i]!.replace(/'/g, "''"))}'!$A$1:$${coluna(Math.max(0, Math.max(...a.linhas.map((l) => l.length)) - 1))}$${a.linhas.length}</definedName>`
              : "",
          )
          .join("") +
        `</definedNames></workbook>`,
    },
    {
      nome: "xl/_rels/workbook.xml.rels",
      texto:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        abas
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join("") +
        `<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      // Estilos: 0 normal, 1 negrito (cabeçalho), 2 data e hora dd/mm/aaaa hh:mm.
      nome: "xl/styles.xml",
      texto:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts>` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
        `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
        `</styleSheet>`,
    },
    ...abas.map((a, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, texto: folha(a) })),
  ];
  return zip(arquivos.map((a) => ({ nome: a.nome, dados: enc.encode(a.texto) })));
}

export const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Gera e baixa no navegador. `nome` sem extensão ou com ".xlsx". */
export function baixarXlsx(nome: string, abas: Aba[]): void {
  const bytes = gerarXlsx(abas);
  const blob = new Blob([bytes as BlobPart], { type: TIPO_XLSX });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome.toLowerCase().endsWith(".xlsx") ? nome : `${nome}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
