// O que as rotas da API de integração fazem com as tarefas (17/11/2026). EXCLUSIVO do servidor.
// A portaria (chave, limite, respostas em JSON) é `api-integracao.server.ts`; o manual para quem
// integra é `docs/api-integracao-tarefas.md`.
//
// Como uma tarefa da integração se reconhece: as colunas `gestor.tarefas.sistema_origem` (o nome do
// sistema da chave) e `id_externo` (o `idExterno` do pedido), criadas em 17/11/2026 com o OK do
// usuário (`db/migracoes/2026-11-17-tarefas-origem-da-integracao.sql`). Vazias = criada na tela.
//   • o reenvio do mesmo idExterno não duplica a tarefa: devolve a que já existe. Quem garante é o
//     índice único (sistema_origem, id_externo), e não só a fila em memória daqui;
//   • cada sistema só lê as tarefas que ELE criou. Pedir por id a tarefa de outra pessoa dá 404,
//     igual a uma que não existe (a chave de um sistema não abre o quadro da empresa).
//
// A tarefa nasce pela MESMA gravação da tela (`criarTarefaPeloServidor` → `gravarNoBanco`): aviso
// "Nova tarefa" na sineta do responsável, histórico "criou esta tarefa pela integração <sistema>",
// "atribuiu para", etiquetas do projeto. O que a tela grava à parte (passos e as etiquetas pedidas) vai num
// segundo passo, numa transação; se ele falhar, a tarefa é arquivada e o pedido volta 500, para o
// sistema repetir sem deixar uma tarefa pela metade no quadro de ninguém.
import { ErroDaApi } from "@/lib/api-integracao.server";

const PRIORIDADES = ["baixa", "media", "alta"] as const;
type Prioridade = (typeof PRIORIDADES)[number];
const SITUACOES = ["pendente", "andamento", "concluida"] as const;
type Situacao = (typeof SITUACOES)[number];

/** Brasília é UTC−3 o ano inteiro desde 2019 (a mesma conta de `telegram-diario`). */
const FUSO_BRASILIA_MS = 3 * 3600_000;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_EXTERNO = /^[A-Za-z0-9._:-]{1,36}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const SO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATA_E_HORA =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/i;
/** Caracteres de controle quebram a tela; o código 31 é o separador das etiquetas no SQL. */
const ehControle = (codigo: number) => codigo < 32 || codigo === 127;
const temControle = (s: string) => [...s].some((ch) => ehControle(ch.charCodeAt(0)));
/** Tira os caracteres de controle, menos a quebra de linha e a tabulação (a descrição tem linhas). */
const semControle = (s: string) =>
  [...s]
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c === 9 || c === 10 || !ehControle(c);
    })
    .join("");

const LIMITES = {
  titulo: 200,
  descricao: 20_000,
  passos: 50,
  passo: 300,
  etiquetas: 5,
  etiqueta: 40,
  pontos: 100,
  minutos: 24 * 60,
} as const;

/** Os pontos de uma tarefa nova quando o pedido não diz: os mesmos da criação pela tela. */
const PONTOS_PADRAO = 10;

/* ------------------------------ Tipos de saída ------------------------------ */

export type PessoaDaApi = {
  id: number;
  nome: string;
  email: string | null;
  setor: string | null;
  cargo: string | null;
};

type PessoaNaTarefa = { id: number; nome: string | null; email: string | null };

export type TarefaDaApi = {
  id: string;
  idExterno: string | null;
  titulo: string;
  descricao: string | null;
  situacao: Situacao;
  arquivada: boolean;
  prioridade: Prioridade;
  pontos: number;
  /** O instante do prazo, em UTC (ISO 8601). `null` = sem prazo. */
  prazo: string | null;
  /** O dia do prazo em Brasília ("AAAA-MM-DD"). */
  prazoData: string | null;
  /** "HH:mm" em Brasília, quando a tarefa tem horário; `null` = vence no fim do dia. */
  prazoHorario: string | null;
  responsavel: PessoaNaTarefa;
  solicitante: PessoaNaTarefa;
  setor: string;
  projetoId: string | null;
  exigeComprovante: boolean;
  minutosEstimados: number | null;
  checklist: { texto: string; feito: boolean }[];
  etiquetas: string[];
  criadaEm: string;
  concluidaEm: string | null;
  /** "AAAA-MM-DD": o dia em que a pessoa disse que de fato terminou, quando informou. */
  dataRealDeConclusao: string | null;
};

/* ------------------------------ Conferência do pedido ------------------------------ */

type ReferenciaDePessoa = { id: number } | { email: string };

type PedidoDeCriacao = {
  titulo: string;
  descricao: string | null;
  responsavel: ReferenciaDePessoa;
  solicitante: ReferenciaDePessoa;
  prazoData: string | null;
  horario: string | null;
  prioridade: Prioridade;
  pontos: number;
  projetoId: string | null;
  exigeComprovante: boolean;
  minutosEstimados: number | null;
  checklist: string[];
  etiquetas: string[];
  idExterno: string | null;
};

const CAMPOS_DA_CRIACAO = [
  "titulo",
  "descricao",
  "responsavel",
  "solicitante",
  "prazo",
  "horario",
  "prioridade",
  "pontos",
  "projetoId",
  "exigeComprovante",
  "minutosEstimados",
  "checklist",
  "etiquetas",
  "idExterno",
] as const;

type Erros = { campo: string; mensagem: string }[];

const ausente = (v: unknown) => v === undefined || v === null;

function diaExiste(ano: number, mes: number, dia: number): boolean {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function referenciaDePessoa(v: unknown, campo: string, erros: Erros): ReferenciaDePessoa | null {
  const exemplo = '{ "id": 123 } ou { "email": "nome@larsil.com.br" }';
  if (ausente(v)) {
    erros.push({ campo, mensagem: `Obrigatório: ${exemplo}.` });
    return null;
  }
  if (typeof v !== "object" || Array.isArray(v)) {
    erros.push({ campo, mensagem: `Precisa ser um objeto: ${exemplo}.` });
    return null;
  }
  const o = v as Record<string, unknown>;
  const outros = Object.keys(o).filter((k) => k !== "id" && k !== "email");
  if (outros.length) {
    erros.push({ campo: `${campo}.${outros[0]}`, mensagem: 'Use só "id" ou "email".' });
    return null;
  }
  const temId = !ausente(o.id) && o.id !== "";
  const temEmail = !ausente(o.email) && o.email !== "";
  if (temId === temEmail) {
    erros.push({ campo, mensagem: 'Informe "id" OU "email" (exatamente um dos dois).' });
    return null;
  }
  if (temId) {
    const n = typeof o.id === "string" && /^\d+$/.test(o.id.trim()) ? Number(o.id) : o.id;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > 2_147_483_647) {
      erros.push({
        campo: `${campo}.id`,
        mensagem: "Precisa ser um número inteiro positivo: o id da pessoa no CONECTA.",
      });
      return null;
    }
    return { id: n };
  }
  const email = typeof o.email === "string" ? o.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    erros.push({ campo: `${campo}.email`, mensagem: "E-mail inválido." });
    return null;
  }
  return { email };
}

/** Lista de textos curtos (checklist, etiquetas): confere tipo, quantidade e tamanho de cada um. */
function listaDeTextos(
  v: unknown,
  campo: string,
  maximo: number,
  tamanho: number,
  erros: Erros,
): string[] {
  if (ausente(v)) return [];
  if (!Array.isArray(v)) {
    erros.push({ campo, mensagem: 'Precisa ser uma lista de textos: ["...", "..."].' });
    return [];
  }
  if (v.length > maximo) {
    erros.push({ campo, mensagem: `Tem ${v.length} itens; o máximo é ${maximo}.` });
    return [];
  }
  const saida: string[] = [];
  v.forEach((item, i) => {
    const onde = `${campo}[${i}]`;
    if (typeof item !== "string") {
      erros.push({ campo: onde, mensagem: "Precisa ser texto." });
      return;
    }
    const t = item.replace(/\s+/g, " ").trim();
    if (!t) erros.push({ campo: onde, mensagem: "Está vazio." });
    else if (temControle(t)) erros.push({ campo: onde, mensagem: "Tem caractere inválido." });
    else if (t.length > tamanho) {
      erros.push({ campo: onde, mensagem: `Tem ${t.length} caracteres; o máximo é ${tamanho}.` });
    } else saida.push(t);
  });
  return saida;
}

function conferirCriacao(c: Record<string, unknown>): PedidoDeCriacao {
  const erros: Erros = [];

  for (const k of Object.keys(c)) {
    if (!(CAMPOS_DA_CRIACAO as readonly string[]).includes(k)) {
      erros.push({
        campo: k,
        mensagem: "Campo desconhecido. Confira o nome no manual (maiúsculas e minúsculas contam).",
      });
    }
  }

  // Título: uma linha só. Quebras e espaços repetidos viram um espaço.
  let titulo = "";
  if (typeof c.titulo !== "string" || !c.titulo.trim()) {
    erros.push({
      campo: "titulo",
      mensagem: `Obrigatório: um texto de 1 a ${LIMITES.titulo} caracteres.`,
    });
  } else {
    titulo = c.titulo.replace(/\s+/g, " ").trim();
    if (temControle(titulo)) {
      erros.push({ campo: "titulo", mensagem: "Tem caractere inválido." });
    } else if (titulo.length > LIMITES.titulo) {
      erros.push({
        campo: "titulo",
        mensagem: `Tem ${titulo.length} caracteres; o máximo é ${LIMITES.titulo}.`,
      });
    }
  }

  // Descrição: pode ter várias linhas.
  let descricao: string | null = null;
  if (!ausente(c.descricao)) {
    if (typeof c.descricao !== "string") {
      erros.push({ campo: "descricao", mensagem: "Precisa ser texto." });
    } else {
      const d = semControle(c.descricao.replace(/\r\n?/g, "\n")).trim();
      if (d.length > LIMITES.descricao) {
        erros.push({
          campo: "descricao",
          mensagem: `Tem ${d.length} caracteres; o máximo é ${LIMITES.descricao}.`,
        });
      }
      descricao = d || null;
    }
  }

  const responsavel = referenciaDePessoa(c.responsavel, "responsavel", erros);
  const solicitante = referenciaDePessoa(c.solicitante, "solicitante", erros);

  /* O prazo: "AAAA-MM-DD" (vence no fim desse dia, ou no "horario", se vier) ou data e hora ISO
     8601 com fuso, que vira o dia e a hora de Brasília. Sem prazo, a tarefa fica "sem prazo". */
  let prazoData: string | null = null;
  let horario: string | null = null;
  let prazoTemHora = false;
  const semPrazo = ausente(c.prazo) || c.prazo === "";
  if (!semPrazo) {
    const formatos =
      'Use "AAAA-MM-DD" (ex.: "2026-11-20") ou data e hora ISO 8601 com fuso (ex.: "2026-11-20T17:00:00-03:00").';
    const s = typeof c.prazo === "string" ? c.prazo.trim() : "";
    const soData = SO_DATA.exec(s);
    const comHora = DATA_E_HORA.exec(s);
    if (soData) {
      if (!diaExiste(+soData[1]!, +soData[2]!, +soData[3]!)) {
        erros.push({ campo: "prazo", mensagem: "Essa data não existe no calendário." });
      } else prazoData = s;
    } else if (comHora) {
      const instante = new Date(s);
      if (
        !diaExiste(+comHora[1]!, +comHora[2]!, +comHora[3]!) ||
        +comHora[4]! > 23 ||
        +comHora[5]! > 59 ||
        Number.isNaN(instante.getTime())
      ) {
        erros.push({ campo: "prazo", mensagem: "Data e hora inválidas." });
      } else {
        const br = new Date(instante.getTime() - FUSO_BRASILIA_MS).toISOString();
        prazoData = br.slice(0, 10);
        horario = br.slice(11, 16);
        prazoTemHora = true;
      }
    } else {
      erros.push({ campo: "prazo", mensagem: formatos });
    }
    if (prazoData) {
      const ano = Number(prazoData.slice(0, 4));
      if (ano < 2020 || ano > 2100) {
        erros.push({ campo: "prazo", mensagem: "Ano fora do intervalo aceito (2020 a 2100)." });
        prazoData = null;
        horario = null;
      }
    }
  }
  if (!ausente(c.horario) && c.horario !== "") {
    if (typeof c.horario !== "string" || !HORA.test(c.horario.trim())) {
      erros.push({
        campo: "horario",
        mensagem: 'Use "HH:mm", de "00:00" a "23:59" (horário de Brasília).',
      });
    } else if (prazoTemHora) {
      erros.push({
        campo: "horario",
        mensagem: 'Não envie "horario" quando o "prazo" já traz a hora.',
      });
    } else if (semPrazo) {
      erros.push({
        campo: "horario",
        mensagem: 'O "horario" só vale junto com um "prazo" no formato "AAAA-MM-DD".',
      });
    } else if (prazoData) {
      horario = c.horario.trim();
    }
  }

  let prioridade: Prioridade = "media";
  if (!ausente(c.prioridade)) {
    const p = typeof c.prioridade === "string" ? semAcento(c.prioridade.trim().toLowerCase()) : "";
    if ((PRIORIDADES as readonly string[]).includes(p)) prioridade = p as Prioridade;
    else erros.push({ campo: "prioridade", mensagem: 'Use "baixa", "media" ou "alta".' });
  }

  let pontos = PONTOS_PADRAO;
  if (!ausente(c.pontos)) {
    if (
      typeof c.pontos !== "number" ||
      !Number.isInteger(c.pontos) ||
      c.pontos < 0 ||
      c.pontos > LIMITES.pontos
    ) {
      erros.push({
        campo: "pontos",
        mensagem: `Precisa ser um número inteiro de 0 a ${LIMITES.pontos}.`,
      });
    } else pontos = c.pontos;
  }

  let projetoId: string | null = null;
  if (!ausente(c.projetoId) && c.projetoId !== "") {
    if (typeof c.projetoId !== "string" || !GUID.test(c.projetoId.trim())) {
      erros.push({
        campo: "projetoId",
        mensagem: "Precisa ser o id (GUID) de um projeto do CONECTA.",
      });
    } else projetoId = c.projetoId.trim().toLowerCase();
  }

  let exigeComprovante = false;
  if (!ausente(c.exigeComprovante)) {
    if (typeof c.exigeComprovante !== "boolean") {
      erros.push({ campo: "exigeComprovante", mensagem: "Precisa ser true ou false." });
    } else exigeComprovante = c.exigeComprovante;
  }

  let minutosEstimados: number | null = null;
  if (!ausente(c.minutosEstimados)) {
    const m = c.minutosEstimados;
    if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > LIMITES.minutos) {
      erros.push({
        campo: "minutosEstimados",
        mensagem: `Precisa ser um número inteiro de 1 a ${LIMITES.minutos} (minutos).`,
      });
    } else minutosEstimados = m;
  }

  const checklist = listaDeTextos(c.checklist, "checklist", LIMITES.passos, LIMITES.passo, erros);

  // Etiquetas: sem repetir (maiúsculas não contam, como no banco).
  const etiquetas: string[] = [];
  for (const e of listaDeTextos(
    c.etiquetas,
    "etiquetas",
    LIMITES.etiquetas,
    LIMITES.etiqueta,
    erros,
  )) {
    if (!etiquetas.some((x) => x.toLowerCase() === e.toLowerCase())) etiquetas.push(e);
  }

  let idExterno: string | null = null;
  if (!ausente(c.idExterno) && c.idExterno !== "") {
    const s = typeof c.idExterno === "string" ? c.idExterno.trim() : "";
    if (!ID_EXTERNO.test(s)) {
      erros.push({
        campo: "idExterno",
        mensagem:
          "De 1 a 36 caracteres: letras sem acento, números, ponto, hífen, sublinhado ou dois-pontos.",
      });
    } else idExterno = s;
  }

  if (erros.length || !responsavel || !solicitante) {
    throw new ErroDaApi(
      400,
      "dados_invalidos",
      `${erros.length} problema(s) no pedido: veja "detalhes".`,
      erros,
    );
  }
  return {
    titulo,
    descricao,
    responsavel,
    solicitante,
    prazoData,
    horario,
    prioridade,
    pontos,
    projetoId,
    exigeComprovante,
    minutosEstimados,
    checklist,
    etiquetas,
    idExterno,
  };
}

/* ------------------------------ Pessoas e projetos ------------------------------ */

/**
 * Quem pode ser responsável ou solicitante: o mesmo quadro do app (quem já entrou no CONECTA ao
 * menos uma vez e está ativo na IAM), com o setor e o cargo do organograma. Cópia de um minuto.
 */
export async function pessoasDaApi(): Promise<PessoaDaApi[]> {
  const { pessoasDoQuadro } = await import("@/lib/perfil.functions");
  return (await pessoasDoQuadro()).map((p) => ({
    id: Number(p.id),
    nome: p.nome,
    email: p.email?.trim() || null,
    setor: p.setor || null,
    cargo: p.funcao || null,
  }));
}

/** A lista de pessoas da rota GET /pessoas, com os filtros `email` e `busca`. */
export async function listarPessoasDaApi(q: URLSearchParams): Promise<{ pessoas: PessoaDaApi[] }> {
  conferirParametros(q, ["email", "busca"]);
  const email = q.get("email")?.trim().toLowerCase() || null;
  const busca = semAcento(q.get("busca")?.trim().toLowerCase() ?? "");
  let pessoas = await pessoasDaApi();
  if (email) pessoas = pessoas.filter((p) => p.email?.toLowerCase() === email);
  if (busca) {
    pessoas = pessoas.filter((p) =>
      semAcento(`${p.nome} ${p.email ?? ""}`.toLowerCase()).includes(busca),
    );
  }
  return { pessoas };
}

/** Os projetos do CONECTA, para o `projetoId` da criação. */
export async function listarProjetosDaApi(
  q: URLSearchParams,
): Promise<{ projetos: { id: string; nome: string; setor: string | null; situacao: string }[] }> {
  conferirParametros(q, []);
  const { getPool } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .query(`SELECT id, nome, setor, situacao FROM gestor.projetos ORDER BY nome`);
  return {
    projetos: (
      r.recordset as { id: string; nome: string; setor: string | null; situacao: string }[]
    ).map((p) => ({ id: p.id.toLowerCase(), nome: p.nome, setor: p.setor, situacao: p.situacao })),
  };
}

/** Responsável e solicitante do pedido, achados no quadro. Os dois que faltarem saem juntos no erro. */
async function acharPessoas(
  d: PedidoDeCriacao,
): Promise<{ responsavel: PessoaDaApi; solicitante: PessoaDaApi }> {
  const lista = await pessoasDaApi();
  const achar = (ref: ReferenciaDePessoa) =>
    "id" in ref
      ? lista.find((p) => p.id === ref.id)
      : lista.find((p) => p.email?.toLowerCase() === ref.email);
  const responsavel = achar(d.responsavel);
  const solicitante = achar(d.solicitante);
  const faltam: Erros = [];
  const descrever = (ref: ReferenciaDePessoa) => ("id" in ref ? `id ${ref.id}` : ref.email);
  if (!responsavel) {
    faltam.push({
      campo: "responsavel",
      mensagem: `Ninguém no CONECTA com ${descrever(d.responsavel)}.`,
    });
  }
  if (!solicitante) {
    faltam.push({
      campo: "solicitante",
      mensagem: `Ninguém no CONECTA com ${descrever(d.solicitante)}.`,
    });
  }
  if (!responsavel || !solicitante) {
    throw new ErroDaApi(
      422,
      "pessoa_nao_encontrada",
      "Pessoa não encontrada. Ela precisa ter entrado no CONECTA ao menos uma vez e estar ativa; a lista está em GET /api/public/v1/pessoas.",
      faltam,
    );
  }
  return { responsavel, solicitante };
}

async function conferirProjeto(id: string): Promise<void> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.UniqueIdentifier, id)
    .query(`SELECT situacao FROM gestor.projetos WHERE id = @id`);
  const p = r.recordset[0] as { situacao: string } | undefined;
  if (!p) {
    throw new ErroDaApi(422, "projeto_nao_encontrado", "Projeto não encontrado.", [
      {
        campo: "projetoId",
        mensagem: "Nenhum projeto com esse id. A lista está em GET /api/public/v1/projetos.",
      },
    ]);
  }
  if (p.situacao === "concluido") {
    throw new ErroDaApi(422, "projeto_concluido", "Esse projeto já foi concluído.", [
      { campo: "projetoId", mensagem: "Não dá para criar tarefa num projeto concluído." },
    ]);
  }
}

/* ------------------------------ Leitura das tarefas ------------------------------ */

type LinhaDaApi = {
  id: string;
  id_externo: string | null;
  titulo: string;
  descricao: string | null;
  setor: string;
  criado_por: number;
  responsavel_id: number;
  projeto_id: string | null;
  situacao: string;
  prioridade: string;
  pontos: number;
  prazo: Date | null;
  horario: string | null;
  minutos_estimados: number | null;
  exige_comprovante: boolean;
  criada_em: Date;
  concluida_em: Date | null;
  arquivada_em: Date | null;
  data_real_de_conclusao: Date | null;
  resp_nome: string | null;
  resp_email: string | null;
  cria_nome: string | null;
  cria_email: string | null;
  etiquetas: string | null;
  total?: number;
};

const COLUNAS_DA_API = `t.id, t.id_externo, t.titulo, t.descricao, t.setor, t.criado_por, t.responsavel_id,
       t.projeto_id, t.situacao, t.prioridade, t.pontos, t.prazo,
       CONVERT(CHAR(5), t.horario, 108) AS horario, t.minutos_estimados, t.exige_comprovante,
       t.criada_em, t.concluida_em, t.arquivada_em, t.data_real_de_conclusao,
       rp.nome AS resp_nome, rp.email AS resp_email, cp.nome AS cria_nome, cp.email AS cria_email,
       (SELECT STRING_AGG(CAST(e.nome AS NVARCHAR(MAX)), NCHAR(31)) WITHIN GROUP (ORDER BY e.nome)
          FROM gestor.tarefa_etiquetas te
          JOIN gestor.etiquetas e ON e.id = te.etiqueta_id
         WHERE te.tarefa_id = t.id) AS etiquetas`;

const JUNCOES_DA_API = `FROM gestor.tarefas t
  LEFT JOIN gestor.perfis rp ON rp.pessoa_id = t.responsavel_id
  LEFT JOIN gestor.perfis cp ON cp.pessoa_id = t.criado_por`;

function paraApi(
  t: LinhaDaApi,
  passos: Map<string, { texto: string; feito: boolean }[]>,
): TarefaDaApi {
  const id = t.id.toLowerCase();
  return {
    id,
    idExterno: t.id_externo,
    titulo: t.titulo,
    descricao: t.descricao,
    situacao: (SITUACOES as readonly string[]).includes(t.situacao)
      ? (t.situacao as Situacao)
      : "pendente",
    arquivada: t.arquivada_em !== null,
    prioridade: (PRIORIDADES as readonly string[]).includes(t.prioridade)
      ? (t.prioridade as Prioridade)
      : "media",
    pontos: t.pontos,
    prazo: t.prazo ? t.prazo.toISOString() : null,
    prazoData: t.prazo
      ? new Date(t.prazo.getTime() - FUSO_BRASILIA_MS).toISOString().slice(0, 10)
      : null,
    prazoHorario: t.prazo && t.horario ? t.horario : null,
    responsavel: { id: t.responsavel_id, nome: t.resp_nome, email: t.resp_email?.trim() || null },
    solicitante: { id: t.criado_por, nome: t.cria_nome, email: t.cria_email?.trim() || null },
    setor: t.setor,
    projetoId: t.projeto_id ? t.projeto_id.toLowerCase() : null,
    exigeComprovante: !!t.exige_comprovante,
    minutosEstimados: t.minutos_estimados,
    checklist: passos.get(id) ?? [],
    etiquetas: (t.etiquetas ?? "").split("\u001f").filter(Boolean),
    criadaEm: t.criada_em.toISOString(),
    concluidaEm: t.concluida_em ? t.concluida_em.toISOString() : null,
    // DATE: o driver entrega meia-noite UTC do dia (ver `LinhaTarefa`).
    dataRealDeConclusao: t.data_real_de_conclusao
      ? t.data_real_de_conclusao.toISOString().slice(0, 10)
      : null,
  };
}

/** Os passos (checklist) de várias tarefas de uma vez, por id. */
async function passosDas(ids: string[]): Promise<Map<string, { texto: string; feito: boolean }[]>> {
  const mapa = new Map<string, { texto: string; feito: boolean }[]>();
  if (ids.length === 0) return mapa;
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("ids", sql.NVarChar(sql.MAX), JSON.stringify(ids))
    .query(
      `SELECT i.tarefa_id, i.texto, i.feito
         FROM gestor.itens_de_checklist i
        WHERE i.tarefa_id IN (SELECT TRY_CAST(value AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))
        ORDER BY i.tarefa_id, i.ordem`,
    );
  for (const l of r.recordset as { tarefa_id: string; texto: string; feito: boolean }[]) {
    const k = l.tarefa_id.toLowerCase();
    mapa.set(k, [...(mapa.get(k) ?? []), { texto: l.texto, feito: !!l.feito }]);
  }
  return mapa;
}

/** Uma tarefa DESTE sistema, pelo id do CONECTA. `null` = não existe ou é de outro lugar. */
export async function lerTarefaDaApi(sistema: string, id: string): Promise<TarefaDaApi | null> {
  if (!GUID.test(id)) {
    throw new ErroDaApi(400, "parametro_invalido", "O id da tarefa precisa ser um GUID.");
  }
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.UniqueIdentifier, id)
    .input("sistema", sql.NVarChar(16), sistema)
    .query(
      `SELECT ${COLUNAS_DA_API}
         ${JUNCOES_DA_API}
        WHERE t.id = @id AND t.sistema_origem = @sistema`,
    );
  const linha = r.recordset[0] as LinhaDaApi | undefined;
  if (!linha) return null;
  return paraApi(linha, await passosDas([linha.id.toLowerCase()]));
}

async function tarefaPeloIdExterno(
  sistema: string,
  idExterno: string,
): Promise<TarefaDaApi | null> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("sistema", sql.NVarChar(16), sistema)
    .input("id_externo", sql.NVarChar(36), idExterno)
    .query(
      `SELECT ${COLUNAS_DA_API} ${JUNCOES_DA_API}
        WHERE t.sistema_origem = @sistema AND t.id_externo = @id_externo`,
    );
  const linha = r.recordset[0] as LinhaDaApi | undefined;
  if (!linha) return null;
  return paraApi(linha, await passosDas([linha.id.toLowerCase()]));
}

/** Parâmetro de URL que a rota não conhece é erro: um nome digitado errado não pode passar calado. */
function conferirParametros(q: URLSearchParams, aceitos: string[]): void {
  const desconhecidos = [...new Set(q.keys())].filter((k) => !aceitos.includes(k));
  if (desconhecidos.length) {
    throw new ErroDaApi(
      400,
      "parametro_desconhecido",
      aceitos.length
        ? `Parâmetro desconhecido: ${desconhecidos.join(", ")}. Esta rota aceita: ${aceitos.join(", ")}.`
        : `Parâmetro desconhecido: ${desconhecidos.join(", ")}. Esta rota não aceita parâmetros.`,
    );
  }
}

/**
 * As tarefas que ESTE sistema criou, das mais novas para as mais antigas, com filtros: `idExterno`,
 * `situacao`, `criadasDesde` ("AAAA-MM-DD", em Brasília), `incluirArquivadas`, `limite` e `pagina`.
 */
export async function listarTarefasDaApi(
  sistema: string,
  q: URLSearchParams,
): Promise<{ tarefas: TarefaDaApi[]; pagina: number; limite: number; total: number }> {
  conferirParametros(q, [
    "idExterno",
    "situacao",
    "criadasDesde",
    "incluirArquivadas",
    "limite",
    "pagina",
  ]);
  const erros: Erros = [];

  const idExterno = q.get("idExterno")?.trim() || null;
  if (idExterno && !ID_EXTERNO.test(idExterno)) {
    erros.push({ campo: "idExterno", mensagem: "Formato inválido (de 1 a 36 caracteres)." });
  }
  const situacao = q.get("situacao")?.trim().toLowerCase() || null;
  if (situacao && !(SITUACOES as readonly string[]).includes(situacao)) {
    erros.push({ campo: "situacao", mensagem: 'Use "pendente", "andamento" ou "concluida".' });
  }
  const desde = q.get("criadasDesde")?.trim() || null;
  const d = desde ? SO_DATA.exec(desde) : null;
  if (desde && (!d || !diaExiste(+d[1]!, +d[2]!, +d[3]!))) {
    erros.push({ campo: "criadasDesde", mensagem: 'Use "AAAA-MM-DD".' });
  }
  const arquivadas = q.get("incluirArquivadas")?.trim().toLowerCase() ?? "false";
  if (arquivadas !== "true" && arquivadas !== "false") {
    erros.push({ campo: "incluirArquivadas", mensagem: 'Use "true" ou "false".' });
  }
  const inteiro = (nome: string, padrao: number, min: number, max: number) => {
    const bruto = q.get(nome);
    if (bruto === null || bruto.trim() === "") return padrao;
    const n = Number(bruto);
    if (!Number.isInteger(n) || n < min || n > max) {
      erros.push({ campo: nome, mensagem: `Precisa ser um inteiro de ${min} a ${max}.` });
      return padrao;
    }
    return n;
  };
  const limite = inteiro("limite", 50, 1, 100);
  const pagina = inteiro("pagina", 1, 1, 100_000);
  if (erros.length) {
    throw new ErroDaApi(
      400,
      "parametro_invalido",
      `${erros.length} parâmetro(s) com problema: veja "detalhes".`,
      erros,
    );
  }

  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("sistema", sql.NVarChar(16), sistema)
    .input("id_externo", sql.NVarChar(36), idExterno)
    .input("situacao", sql.NVarChar(12), situacao)
    .input("desde", sql.DateTimeOffset, desde ? new Date(`${desde}T00:00:00-03:00`) : null)
    .input("arquivadas", sql.Bit, arquivadas === "true")
    .input("pular", sql.Int, (pagina - 1) * limite)
    .input("limite", sql.Int, limite)
    .query(
      `SELECT ${COLUNAS_DA_API}, COUNT(*) OVER () AS total
         ${JUNCOES_DA_API}
        WHERE t.sistema_origem = @sistema
          AND (@id_externo IS NULL OR t.id_externo = @id_externo)
          AND (@situacao IS NULL OR t.situacao = @situacao)
          AND (@desde IS NULL OR t.criada_em >= @desde)
          -- Pelo idExterno, a tarefa vem mesmo arquivada: é a busca por uma tarefa específica.
          AND (@arquivadas = 1 OR @id_externo IS NOT NULL OR t.arquivada_em IS NULL)
        ORDER BY t.criada_em DESC, t.id
        OFFSET @pular ROWS FETCH NEXT @limite ROWS ONLY`,
    );
  const linhas = r.recordset as LinhaDaApi[];
  const passos = await passosDas(linhas.map((l) => l.id.toLowerCase()));
  return {
    tarefas: linhas.map((l) => paraApi(l, passos)),
    pagina,
    limite,
    // Página além do fim não traz linha nenhuma, e o total não vem junto: aí a conta é à parte.
    total:
      linhas[0]?.total ??
      (pagina > 1 ? await contar(sistema, idExterno, situacao, desde, arquivadas === "true") : 0),
  };
}

async function contar(
  sistema: string,
  idExterno: string | null,
  situacao: string | null,
  desde: string | null,
  arquivadas: boolean,
): Promise<number> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("sistema", sql.NVarChar(16), sistema)
    .input("id_externo", sql.NVarChar(36), idExterno)
    .input("situacao", sql.NVarChar(12), situacao)
    .input("desde", sql.DateTimeOffset, desde ? new Date(`${desde}T00:00:00-03:00`) : null)
    .input("arquivadas", sql.Bit, arquivadas)
    .query(
      `SELECT COUNT(*) AS n FROM gestor.tarefas t
        WHERE t.sistema_origem = @sistema
          AND (@id_externo IS NULL OR t.id_externo = @id_externo)
          AND (@situacao IS NULL OR t.situacao = @situacao)
          AND (@desde IS NULL OR t.criada_em >= @desde)
          AND (@arquivadas = 1 OR @id_externo IS NOT NULL OR t.arquivada_em IS NULL)`,
    );
  return (r.recordset[0] as { n: number }).n;
}

/* ------------------------------ Criação ------------------------------ */

/* Dois pedidos com o mesmo idExterno ao mesmo tempo (o sistema repetiu antes da resposta) passam
   um de cada vez: o segundo encontra a tarefa do primeiro. Em memória, porque é uma réplica só; se
   um dia houver duas, o índice único do banco segura (ver `criarTarefaDaApi`). */
const filas = new Map<string, Promise<void>>();

async function umDeCadaVez<T>(chave: string | null, fazer: () => Promise<T>): Promise<T> {
  if (!chave) return fazer();
  const antes = filas.get(chave) ?? Promise.resolve();
  let soltar!: () => void;
  const vez = new Promise<void>((r) => (soltar = r));
  const fila = antes.then(() => vez);
  filas.set(chave, fila);
  await antes;
  try {
    return await fazer();
  } finally {
    soltar();
    if (filas.get(chave) === fila) filas.delete(chave);
  }
}

/**
 * Cria a tarefa pedida por `sistema`. Com `idExterno` já usado por este sistema, não cria outra:
 * devolve a existente com `jaExistia: true` (o corpo novo é ignorado; a tarefa se edita na tela).
 */
export async function criarTarefaDaApi(
  sistema: string,
  corpo: Record<string, unknown>,
): Promise<{ tarefa: TarefaDaApi; jaExistia: boolean }> {
  const d = conferirCriacao(corpo);
  const fila = d.idExterno ? `${sistema}:${d.idExterno}` : null;

  return umDeCadaVez(fila, async () => {
    if (d.idExterno) {
      const existente = await tarefaPeloIdExterno(sistema, d.idExterno);
      if (existente) return { tarefa: existente, jaExistia: true };
    }

    const { responsavel, solicitante } = await acharPessoas(d);
    if (d.projetoId) await conferirProjeto(d.projetoId);

    /* O prazo como a tela grava: com horário, o dia dele (o SQL acerta a hora em Brasília); sem
       horário, o fim do dia (23:59 de Brasília), como na grade de criação. */
    const prazo = d.prazoData
      ? new Date(`${d.prazoData}T${d.horario ? "12:00" : "23:59"}:00-03:00`)
      : null;

    const { criarTarefaPeloServidor } = await import("@/lib/tarefas.functions");
    const id = await criarTarefaPeloServidor(solicitante.id, {
      titulo: d.titulo,
      descricao: d.descricao,
      // O setor é o de quem vai fazer, como no WhatsApp: quem pede de fora não sabe o setor.
      setor: responsavel.setor || "sem-setor",
      responsavelId: responsavel.id,
      projetoId: d.projetoId,
      frequencia: "diaria",
      prioridade: d.prioridade,
      pontos: d.pontos,
      prazo,
      horario: d.horario,
      recorrente: false,
      recorreAte: null,
      diaDoMes: null,
      minutosEstimados: d.minutosEstimados,
      exigeComprovante: d.exigeComprovante,
      noPack: false,
      ordem: 0,
      origem: `criou esta tarefa pela integração ${sistema}${d.idExterno ? ` (ref. ${d.idExterno})` : ""}`,
    });

    try {
      await completar(id, sistema, d, solicitante.id);
    } catch (e) {
      /* A tarefa existe, mas sem a marca da integração, os passos ou as etiquetas. Arquivada,
         ela sai do quadro do responsável. */
      await arquivarPelaMetade(id);
      /* O índice único recusou: outro pedido com o mesmo idExterno chegou antes, por um caminho
         que a fila daqui não viu (duas réplicas). A tarefa dele é a que vale e volta como
         "já existia"; esta, arquivada, não aparece para ninguém. */
      const numero =
        (e as { number?: number })?.number ??
        (e as { originalError?: { info?: { number?: number } } })?.originalError?.info?.number;
      if (d.idExterno && (numero === 2601 || numero === 2627)) {
        const existente = await tarefaPeloIdExterno(sistema, d.idExterno);
        if (existente) {
          console.warn(
            `[api] ${sistema}: idExterno repetido ao mesmo tempo; a tarefa ${id} foi arquivada`,
          );
          return { tarefa: existente, jaExistia: true };
        }
      }
      /* Outra falha: o sistema recebe 500 e repete, e a repetição cria certo (sem a marca, o
         idExterno ainda está livre). */
      console.error(
        `[api] tarefa ${id} de ${sistema} ficou pela metade e foi arquivada:`,
        (e as Error)?.message,
      );
      throw e;
    }

    const tarefa = await lerTarefaDaApi(sistema, id);
    if (!tarefa) throw new Error(`a tarefa ${id} foi criada mas não foi lida de volta`);
    return { tarefa, jaExistia: false };
  });
}

/** A marca da integração, os passos e as etiquetas: tudo ou nada. */
async function completar(
  id: string,
  sistema: string,
  d: PedidoDeCriacao,
  solicitante: number,
): Promise<void> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  /* Só as etiquetas do pedido. O sistema de origem NÃO vira etiqueta (decisão do usuário,
     17/11/2026): etiqueta é da tela, a pessoa tira e põe; quem criou a tarefa fica na marca. */
  const etiquetas = d.etiquetas;
  await pool
    .request()
    .input("id", sql.UniqueIdentifier, id)
    .input("sistema", sql.NVarChar(16), sistema)
    .input("id_externo", sql.NVarChar(36), d.idExterno)
    .input("por", sql.Int, solicitante)
    .input(
      "passos",
      sql.NVarChar(sql.MAX),
      JSON.stringify(d.checklist.map((texto, ordem) => ({ texto, ordem }))),
    )
    .input("etiquetas", sql.NVarChar(sql.MAX), JSON.stringify(etiquetas))
    .query(
      `SET XACT_ABORT ON;
       BEGIN TRAN;

       UPDATE gestor.tarefas SET sistema_origem = @sistema, id_externo = @id_externo WHERE id = @id;

       INSERT INTO gestor.itens_de_checklist (tarefa_id, texto, feito, ordem)
       SELECT @id, j.texto, 0, j.ordem
         FROM OPENJSON(@passos) WITH (texto NVARCHAR(300) '$.texto', ordem INT '$.ordem') j;

       DECLARE @nomes TABLE (nome NVARCHAR(40));
       INSERT INTO @nomes (nome)
       SELECT DISTINCT CAST(value AS NVARCHAR(40)) FROM OPENJSON(@etiquetas);

       /* UPDLOCK + HOLDLOCK: duas criações com a mesma etiqueta nova, ao mesmo tempo, não batem
          as duas no UNIQUE do nome. */
       INSERT INTO gestor.etiquetas (nome, criada_por)
       SELECT n.nome, @por FROM @nomes n
        WHERE NOT EXISTS (SELECT 1 FROM gestor.etiquetas g WITH (UPDLOCK, HOLDLOCK)
                           WHERE g.nome = n.nome);

       INSERT INTO gestor.tarefa_etiquetas (tarefa_id, etiqueta_id)
       SELECT DISTINCT @id, g.id
         FROM @nomes n
         JOIN gestor.etiquetas g ON g.nome = n.nome
        WHERE NOT EXISTS (SELECT 1 FROM gestor.tarefa_etiquetas te
                           WHERE te.tarefa_id = @id AND te.etiqueta_id = g.id);

       COMMIT;`,
    );
}

async function arquivarPelaMetade(id: string): Promise<void> {
  try {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query(`UPDATE gestor.tarefas SET arquivada_em = SYSDATETIMEOFFSET() WHERE id = @id`);
  } catch (e) {
    console.error(`[api] não consegui arquivar a tarefa ${id} pela metade:`, (e as Error)?.message);
  }
}
