import type { Priority, User } from "@/lib/fluxo-types";
import { sectors } from "@/lib/fluxo-types";

export interface ParsedPasteRow {
  title: string;
  description?: string;
  assigneeId?: string;
  dueDate?: string; // yyyy-mm-dd
  /** "HH:mm". */
  horario?: string;
  priority?: Priority;
  estimateHM?: string;
  sector?: string;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}
function toISODate(y: number, m: number, d: number): string | undefined {
  if (!y || !m || !d) return undefined;
  if (y < 100) y += 2000;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return undefined;
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function parseDateLoose(input: string): string | undefined {
  const s = input.trim();
  if (!s) return undefined;
  // yyyy-mm-dd
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return toISODate(+m[1], +m[2], +m[3]);
  // dd/mm/yyyy or dd/mm/yy
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
  if (m) {
    const y = m[3] ? +m[3] : new Date().getFullYear();
    return toISODate(y, +m[2], +m[1]);
  }
  // Excel serial (rough)
  if (/^\d{4,6}$/.test(s)) {
    const n = +s;
    if (n > 20000 && n < 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    }
  }
  // fallback
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) {
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }
  return undefined;
}

function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function matchAssignee(name: string, users: User[]): string | undefined {
  const q = normalize(name);
  if (!q) return undefined;
  // exact
  let hit = users.find((u) => normalize(u.name) === q);
  if (hit) return hit.id;
  // first-name / contains
  hit = users.find((u) => normalize(u.name).split(" ")[0] === q);
  if (hit) return hit.id;
  hit = users.find((u) => normalize(u.name).includes(q));
  return hit?.id;
}

export function matchSector(value: string): string | undefined {
  const q = normalize(value);
  if (!q) return undefined;
  const s = sectors.find(
    (x) => x.id === q || normalize(x.name) === q || normalize(x.name).startsWith(q),
  );
  return s?.id;
}

/** "HH:mm" a partir de "14:30", "14h30", "9h", "9" ou "14:30:00". */
function lerHorario(valor: string): string | undefined {
  const m = valor.trim().match(/^(\d{1,2})(?:[:h](\d{2}))?(?::\d{2})?\s*h?$/i);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return undefined;
  return `${pad(h)}:${pad(min)}`;
}

function lerPrioridade(valor: string): Priority | undefined {
  const v = normalize(valor);
  if (v.startsWith("alt") || v.startsWith("urg")) return "alta";
  if (v.startsWith("med") || v.startsWith("norm")) return "media";
  if (v.startsWith("baix")) return "baixa";
  return undefined;
}

/**
 * As células de uma colagem de planilha.
 *
 * Excel e Google Sheets separam coluna por TAB e linha por quebra, e põem
 * entre aspas a célula que tem quebra de linha, TAB ou aspas — com as aspas de
 * dentro dobradas. Cortar só por "\n" partia uma descrição de duas linhas em
 * duas tarefas.
 */
function lerCelulas(texto: string): string[][] {
  const t = texto.replace(/\r\n?/g, "\n");
  const linhas: string[][] = [];
  let linha: string[] = [];
  let celula = "";
  let entreAspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreAspas) {
      if (c !== '"') celula += c;
      else if (t[i + 1] === '"') {
        celula += '"';
        i++;
      } else entreAspas = false;
    } else if (c === '"' && celula === "") entreAspas = true;
    else if (c === "\t") {
      linha.push(celula);
      celula = "";
    } else if (c === "\n") {
      linha.push(celula);
      linhas.push(linha);
      linha = [];
      celula = "";
    } else celula += c;
  }
  if (celula !== "" || linha.length) {
    linha.push(celula);
    linhas.push(linha);
  }
  return linhas;
}

type Campo =
  | "titulo"
  | "descricao"
  | "responsavel"
  | "prazo"
  | "horario"
  | "prioridade"
  | "estimativa"
  | "setor";

/**
 * Colado sem cabeçalho, vale a ordem das colunas da grade — a mesma que a
 * pessoa vê na tela. Era outra (título, prazo, responsável, setor,
 * estimativa), sem descrição: a segunda coluna era lida como data, e a
 * descrição colada sumia.
 */
const ORDEM_DA_GRADE: Campo[] = [
  "titulo",
  "descricao",
  "responsavel",
  "prazo",
  "horario",
  "prioridade",
  "estimativa",
];

/** Nomes de coluna reconhecidos num cabeçalho, sem acento e sem caixa. */
const NOMES_DE_COLUNA: [Campo, string[]][] = [
  ["titulo", ["tarefa", "tarefas", "titulo", "atividade", "atividades", "nome", "nome da tarefa"]],
  [
    "descricao",
    ["descricao", "descricao da tarefa", "detalhes", "observacao", "observacoes", "obs"],
  ],
  ["responsavel", ["responsavel", "pessoa", "quem", "executor", "atribuido a"]],
  ["prazo", ["prazo", "data", "data de entrega", "entrega", "vencimento", "data limite"]],
  ["horario", ["horario", "hora"]],
  ["prioridade", ["prioridade"]],
  ["estimativa", ["estimativa", "tempo", "tempo estimado", "duracao"]],
  ["setor", ["setor", "area", "departamento"]],
];

/**
 * A primeira linha é cabeçalho? Quando pelo menos duas células são, por
 * inteiro, nomes de coluna conhecidos — a de tarefa entre elas — e sem
 * repetir. Por inteiro, e não "começa com": "Hora extra" é tarefa, não a
 * coluna de horário. Coluna de nome desconhecido ("Cliente") é ignorada.
 */
function lerCabecalho(celulas: string[]): (Campo | undefined)[] | null {
  const campos = celulas.map((c) => {
    const nome = normalize(c)
      .replace(/\(.*?\)/g, "")
      .replace(/[^a-z ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return nome ? NOMES_DE_COLUNA.find(([, nomes]) => nomes.includes(nome))?.[0] : undefined;
  });
  const reconhecidos = campos.filter((c): c is Campo => !!c);
  const semRepetir = new Set(reconhecidos).size === reconhecidos.length;
  return reconhecidos.length >= 2 && semRepetir && reconhecidos.includes("titulo") ? campos : null;
}

/**
 * Lê o que veio de uma planilha (Excel, Google Sheets) ou de uma lista em
 * texto: uma tarefa por linha.
 *
 * As colunas seguem a ordem da grade — Tarefa, Descrição, Responsável, Prazo,
 * Horário, Prioridade, Estimativa —, todas opcionais menos a primeira. Com uma
 * linha de cabeçalho ("Tarefa", "Descrição", "Prazo"…), vale a ordem dela, e
 * a coluna de nome desconhecido é ignorada.
 */
export function parseExcelPaste(text: string, users: User[]): ParsedPasteRow[] {
  if (!text) return [];
  // Sem TAB é lista de texto: uma linha, um título, e aspas são só aspas.
  const linhas = (
    text.includes("\t")
      ? lerCelulas(text)
      : text
          .replace(/\r/g, "")
          .split("\n")
          .map((l) => [l])
  ).filter((l) => l.some((c) => c.trim()));
  if (linhas.length === 0) return [];

  const cabecalho = lerCabecalho(linhas[0]);
  const ordem = cabecalho ?? ORDEM_DA_GRADE;
  const dados = cabecalho ? linhas.slice(1) : linhas;

  const rows: ParsedPasteRow[] = [];
  for (const celulas of dados) {
    const valor = (campo: Campo) => {
      const i = ordem.indexOf(campo);
      return i >= 0 ? (celulas[i] ?? "").trim() : "";
    };
    // O título é uma linha só; a quebra que vier nele vira espaço.
    const title = valor("titulo").replace(/\s+/g, " ");
    if (!title) continue;
    const responsavel = valor("responsavel");
    const prazo = valor("prazo");
    const setor = valor("setor");
    rows.push({
      title,
      description: valor("descricao") || undefined,
      assigneeId: responsavel ? matchAssignee(responsavel, users) : undefined,
      dueDate: prazo ? parseDateLoose(prazo) : undefined,
      horario: lerHorario(valor("horario")),
      priority: lerPrioridade(valor("prioridade")),
      estimateHM: valor("estimativa") || undefined,
      sector: setor ? matchSector(setor) : undefined,
    });
  }
  return rows;
}
