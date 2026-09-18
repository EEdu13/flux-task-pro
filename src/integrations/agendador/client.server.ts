// Cliente HTTP do Agendador (agendador.up.railway.app). EXCLUSIVO do servidor —
// carregue dentro dos handlers:
//   const ag = await import("@/integrations/agendador/client.server");
//
// Por que a chamada sai daqui e nunca do navegador — são três motivos
// independentes, e qualquer um deles já bastaria:
//   • O token da IAM vive no cookie httpOnly `fluxo_sessao`. O JavaScript da
//     página não consegue lê-lo para montar o Authorization.
//   • O Agendador serve `Content-Security-Policy: connect-src 'self'` e não tem
//     CORS nenhum configurado.
//   • O cookie dele (`ag_sessao`) é SameSite=Lax, então nem seguiria numa
//     chamada cross-site — a requisição chegaria anônima.
//
// O token é o MESMO que já temos: Agendador e Fluxo usam a mesma IAM Larsil e
// os dois resolvem o JWT no mesmo /api/auth/resolve. Não há segredo novo aqui.

const TIMEOUT_MS = 15_000;

/* ------------------------------- Tipos ------------------------------- */

export interface SalaDeReuniao {
  id: number;
  nome: string;
}

export interface ReservaDeSala {
  id: number;
  sala_id: number;
  sala: string;
  data: string; // AAAA-MM-DD
  inicio: string; // HH:MM
  fim: string; // HH:MM
  motivo: string;
  responsavel: string;
  para_nome: string;
  status: string;
}

export interface NovaReserva {
  data: string;
  inicio: string;
  fim: string;
  salaId: number;
  motivo: string;
  /** Ids da IAM — os mesmos que o Fluxo usa como `pessoa_id`. */
  participantesIam?: number[];
  /**
   * Para quem é a reserva, quando não é para quem está reservando.
   *
   * Mande os DOIS campos. O Agendador prefere o `paraIamId` e pega nome e
   * telefone do cadastro dele (assim o WhatsApp chega); se a pessoa ainda não
   * tiver cadastro lá, ele cai no `paraNome` e pelo menos o nome aparece na
   * agenda. Mandando só o id, um colega sem cadastro some da reserva em
   * silêncio. Escolher a si mesmo é o mesmo que não mandar nada.
   */
  paraIamId?: number | null;
  paraNome?: string;
}

export interface ReservaCriada {
  reserva: ReservaDeSala;
  /** Convidados que ainda não têm cadastro no Agendador e ficaram de fora. */
  participantesIgnorados: number[];
}

export type AgendadorFalha =
  "credenciais" | "sem_acesso" | "conflito" | "invalido" | "indisponivel" | "inesperado";

export interface DetalheConflito {
  inicio: string;
  fim: string;
  responsavel: string;
}

export class AgendadorError extends Error {
  constructor(
    message: string,
    readonly motivo: AgendadorFalha,
    /** O `code` estável que o Agendador devolve. Decida por ele, não pelo texto. */
    readonly codigo = "",
    readonly status = 0,
    readonly conflito?: DetalheConflito,
  ) {
    super(message);
    this.name = "AgendadorError";
  }
}

/* ----------------------------- Chamada crua ----------------------------- */

function baseUrl(): string {
  const url = process.env.AGENDADOR_URL;
  if (!url) {
    throw new AgendadorError("AGENDADOR_URL não configurado no servidor", "inesperado");
  }
  return url.replace(/\/$/, "");
}

interface Resposta {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Nunca lança por erro HTTP — devolve status + corpo, para quem chamou decidir.
 * Só lança quando a rede falha, que não é erro de credencial nem de regra.
 */
async function bruto(
  method: "GET" | "POST",
  caminho: string,
  token: string,
  corpo?: unknown,
): Promise<Resposta> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl()}${caminho}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: ctrl.signal,
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      /* 500 do Flask vem em HTML; o status já diz o que houve */
    }
    return { status: res.status, body };
  } catch {
    throw new AgendadorError(
      "Não foi possível falar com o Agendador. Tente de novo.",
      "indisponivel",
    );
  } finally {
    clearTimeout(timer);
  }
}

function erroDaResposta({ status, body }: Resposta): AgendadorError {
  const codigo = String(body.code ?? "");
  const msg = String(body.error ?? "Não foi possível falar com o Agendador.");

  if (codigo === "conflito") {
    const c = body.conflito as DetalheConflito | undefined;
    return new AgendadorError(msg, "conflito", codigo, status, c);
  }
  if (status === 401) return new AgendadorError(msg, "credenciais", codigo, status);
  if (status === 403) return new AgendadorError(msg, "sem_acesso", codigo, status);
  if (status === 400) return new AgendadorError(msg, "invalido", codigo, status);
  if (status === 503) return new AgendadorError(msg, "indisponivel", codigo, status);
  return new AgendadorError(msg, "inesperado", codigo, status);
}

/* ------------------------------- Vínculo ------------------------------- */

/**
 * O Agendador só reconhece quem tem linha em `USUARIOS_RESERVA_TESTE`, e essa
 * linha só nasce quando a pessoa faz login no PRÓPRIO Agendador. Quem só usa o
 * Fluxo nunca passou por lá e levaria 401 com um token perfeitamente válido.
 *
 * Daí o auto-vínculo: ao tomar 401, mandamos criar o cadastro e repetimos a
 * operação UMA vez. Se o 401 era mesmo token ruim, o /vincular também recusa e
 * o erro original prevalece — ou seja, a própria chamada é o teste, e não
 * precisamos que o Agendador distinga os dois casos para nós.
 *
 * O nome e o telefone saem de `gestor.perfis`, que o login reescreve a partir da
 * IAM. É o número que a empresa tem, não um que alguém digitou aqui — e é dele
 * que depende o WhatsApp de confirmação chegar.
 */
async function dadosDoPerfil(eu: number): Promise<{ nome: string; telefone: string } | null> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("p", sql.Int, eu)
    .query(`SELECT nome, telefone FROM gestor.perfis WHERE pessoa_id=@p`);
  const row = r.recordset[0] as { nome: string | null; telefone: string | null } | undefined;
  if (!row?.nome) return null;
  return { nome: row.nome, telefone: row.telefone ?? "" };
}

async function vincular(token: string, eu: number): Promise<boolean> {
  const perfil = await dadosDoPerfil(eu);
  if (!perfil) return false; // sem nome não dá para criar cadastro nenhum
  const r = await bruto("POST", "/api/integracao/salas/vincular", token, perfil);
  return r.status === 200;
}

/**
 * Executa a operação e, se ela esbarrar em 401, vincula e tenta de novo.
 * Uma única retentativa: se a segunda também falhar, o problema não é cadastro.
 */
async function comVinculo(
  token: string,
  eu: number,
  operacao: () => Promise<Resposta>,
): Promise<Resposta> {
  const r = await operacao();
  if (r.status !== 401) return r;
  if (!(await vincular(token, eu))) return r;
  return operacao();
}

/* ------------------------------ Operações ------------------------------ */

export async function listarSalas(token: string, eu: number): Promise<SalaDeReuniao[]> {
  const r = await comVinculo(token, eu, () => bruto("GET", "/api/integracao/salas", token));
  if (r.status !== 200) throw erroDaResposta(r);
  return (r.body.salas as SalaDeReuniao[] | undefined) ?? [];
}

export async function listarAgenda(
  token: string,
  eu: number,
  filtro: { data: string; dataFim?: string; salaId?: number },
): Promise<ReservaDeSala[]> {
  const q = new URLSearchParams({ data: filtro.data });
  if (filtro.dataFim) q.set("data_fim", filtro.dataFim);
  if (filtro.salaId) q.set("sala_id", String(filtro.salaId));

  const r = await comVinculo(token, eu, () =>
    bruto("GET", `/api/integracao/salas/agenda?${q.toString()}`, token),
  );
  if (r.status !== 200) throw erroDaResposta(r);
  return (r.body.reservas as ReservaDeSala[] | undefined) ?? [];
}

export async function criarReserva(
  token: string,
  eu: number,
  nova: NovaReserva,
): Promise<ReservaCriada> {
  const corpo = {
    data: nova.data,
    inicio: nova.inicio,
    fim: nova.fim,
    sala_id: nova.salaId,
    motivo: nova.motivo,
    participantes_iam: nova.participantesIam ?? [],
    para_iam_id: nova.paraIamId ?? null,
    para_nome: nova.paraNome ?? "",
  };

  const r = await comVinculo(token, eu, () =>
    bruto("POST", "/api/integracao/salas/reservas", token, corpo),
  );
  if (r.status !== 201) throw erroDaResposta(r);

  return {
    reserva: r.body.reserva as ReservaDeSala,
    participantesIgnorados: (r.body.participantes_ignorados as number[] | undefined) ?? [],
  };
}
