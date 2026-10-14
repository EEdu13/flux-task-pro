/*
 * Lado do servidor do Mural — ver `mural.functions.ts` (14/10/2026).
 * Arquivo `.server.ts`: só o servidor importa (banco e memória do processo).
 *
 * O banco é o Azure SQL compartilhado e já bateu no teto de DTU. Por isso:
 *   - quem é quem (nome, ativo, admissão) e os aniversários saem do banco
 *     no máximo uma vez por dia por servidor (ver `validadeAteMeiaNoite`);
 *   - a primeira página do feed é igual para todo mundo e fica guardada por
 *     alguns segundos para todos (ver `CHAVE_FEED`), apagada a cada gravação.
 */

/** Fuso de referência das datas do mural (aniversário é "hoje" no Brasil). */
const FUSO = "America/Sao_Paulo";

export type DiaBR = { ano: number; mes: number; dia: number; iso: string };

/** A data de hoje (ou de `d`) no fuso de Brasília. */
export function diaNoBrasil(d: Date = new Date()): DiaBR {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  const ano = v("year");
  const mes = v("month");
  const dia = v("day");
  return {
    ano,
    mes,
    dia,
    iso: `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
  };
}

/**
 * Validade para o `compartilhado` que vence na virada do dia: o guardado só
 * serve se foi buscado depois da última meia-noite de Brasília (e no máximo
 * `teto` ms). Assim aniversário e "hoje" nunca ficam com a cara de ontem.
 */
export function validadeAteMeiaNoite(teto = 6 * 3600_000): number {
  const agora = new Date();
  const hoje = diaNoBrasil(agora);
  // Meia-noite de Brasília (UTC-3, sem horário de verão desde 2019).
  const meiaNoite = Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia, 3, 0, 0);
  return Math.max(1_000, Math.min(teto, agora.getTime() - meiaNoite));
}

/** Chave da primeira página do feed na memória compartilhada. */
export const CHAVE_FEED = "mural:feed:inicio";
const CHAVE_PESSOAS = "mural:pessoas";
const CHAVE_ANIVERSARIOS = "mural:aniversarios";
/** Os próximos eventos do painel lateral (fase 3, 14/10/2026). */
export const CHAVE_EVENTOS = "mural:eventos";

/**
 * Os filtros do feed (fase 2/3, 14/10/2026). Cada um tem a primeira página
 * guardada à parte, com a chave `CHAVE_FEED:filtro` ("tudo" usa a chave
 * antiga, sem sufixo).
 */
export const FILTROS_DO_FEED = [
  "tudo",
  "comunicado",
  "campo",
  "evento",
  "enquete",
  "conquista",
  "elogio",
] as const;
export type FiltroDoFeed = (typeof FILTROS_DO_FEED)[number];
export const chaveDoFeed = (filtro: FiltroDoFeed) =>
  filtro === "tudo" ? CHAVE_FEED : `${CHAVE_FEED}:${filtro}`;

/** Autor das publicações automáticas (conquistas, tempo de casa, boas-vindas). */
export const AUTOR_SISTEMA = 0;

/** Esquece o que o mural guardou — chamar depois de qualquer gravação. */
export async function esquecerFeed(): Promise<void> {
  const { esquecer } = await import("@/lib/cache-compartilhado.server");
  for (const f of FILTROS_DO_FEED) esquecer(chaveDoFeed(f));
  esquecer(CHAVE_EVENTOS);
}

/**
 * Gerente e RH, guardado 5 min por pessoa: o feed pergunta isto a cada
 * leitura. (Veio de `mural.functions.ts` em 14/10/2026, para as funções novas
 * do mural usarem a mesma resposta.)
 */
export async function quemSouNoMural(eu: number): Promise<{ gerente: boolean; comunica: boolean }> {
  const { compartilhado } = await import("@/lib/cache-compartilhado.server");
  return compartilhado(`mural:papel:${eu}`, 5 * 60_000, async () => {
    const { papelEsetor } = await import("@/lib/perfil.functions");
    const { papel, setor } = await papelEsetor(eu);
    const gerente = papel === "gerente";
    return { gerente, comunica: gerente || setor === "rh" };
  });
}
export async function esquecerAniversarios(): Promise<void> {
  const { esquecer } = await import("@/lib/cache-compartilhado.server");
  esquecer(CHAVE_ANIVERSARIOS);
}

/** Mensagem que a tela reconhece para mostrar "O mural ainda não foi ativado". */
export const MURAL_INATIVO = "O mural ainda não foi ativado.";

/**
 * As tabelas do mural ainda não existem (migração pendente)? O SQL Server
 * responde 208, "Invalid object name 'gestor.mural_…'".
 */
export function ehMuralInativo(e: unknown): boolean {
  const err = e as {
    number?: number;
    message?: string;
    originalError?: { info?: { number?: number } };
  };
  const numero = err?.number ?? err?.originalError?.info?.number;
  const msg = String(err?.message ?? "");
  return numero === 208 && /mural_|aniversarios/i.test(msg);
}

/** Roda `fn` trocando o erro de tabela inexistente pela mensagem amigável. */
export async function noMural<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (ehMuralInativo(e)) throw new Error(MURAL_INATIVO);
    throw e;
  }
}

export type PessoaDoMural = {
  id: number;
  nome: string;
  /** Ativa no organograma (ou fora dele, que conta como ativa). */
  ativa: boolean;
  /** Data de admissão (yyyy-mm-dd), só para efetivo ativo em dbo.COLABORADORES. */
  admissao: string | null;
};

/**
 * Quem está no app, se está ativo e quando foi admitido — uma vez por dia.
 *
 * O casamento com `dbo.COLABORADORES` é por nome, sem acento e sem caixa,
 * como em `listarPessoas` (não há outra chave entre as duas). É a consulta
 * cara do mural (comparação de nomes sem índice possível), e é exatamente por
 * isso que ela roda uma vez por dia e não por tela aberta.
 */
export async function pessoasDoMural(): Promise<PessoaDoMural[]> {
  const { compartilhado } = await import("@/lib/cache-compartilhado.server");
  return compartilhado(CHAVE_PESSOAS, validadeAteMeiaNoite(), async () => {
    const { getPool } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool.request().query(
      `SELECT p.pessoa_id, p.nome, c.adm, c.ativo AS c_ativo, x.ativo AS x_ativo
         FROM gestor.perfis p
        OUTER APPLY (
          SELECT TOP 1 col.DATA_ADMISSAO AS adm,
                 CASE WHEN col.SITUACAO = '1' THEN 1 ELSE 0 END AS ativo
            FROM dbo.COLABORADORES col
           WHERE LTRIM(RTRIM(col.NOME)) COLLATE Latin1_General_CI_AI
                 = LTRIM(RTRIM(p.nome)) COLLATE Latin1_General_CI_AI
           ORDER BY CASE WHEN col.SITUACAO = '1' THEN 0 ELSE 1 END
        ) c
        OUTER APPLY (
          SELECT TOP 1 CASE WHEN ext.ATIVO = 1 THEN 1 ELSE 0 END AS ativo
            FROM dbo.COLABORADORES_EXTERNOS ext
           WHERE LTRIM(RTRIM(ext.NOME)) COLLATE Latin1_General_CI_AI
                 = LTRIM(RTRIM(p.nome)) COLLATE Latin1_General_CI_AI
           ORDER BY ext.ATIVO DESC
        ) x
        WHERE p.nome IS NOT NULL`,
    );
    type Linha = {
      pessoa_id: number;
      nome: string;
      adm: Date | null;
      c_ativo: number | null;
      x_ativo: number | null;
    };
    return (r.recordset as Linha[]).map((l) => {
      // Fora das duas tabelas (sócio, conta de serviço) conta como ativa,
      // como no resto do app; desligado em ambas, some do mural.
      const ativa =
        l.c_ativo === 1 || l.x_ativo === 1 || (l.c_ativo === null && l.x_ativo === null);
      return {
        id: l.pessoa_id,
        nome: l.nome.trim(),
        ativa,
        // `date` volta como Date à meia-noite UTC: o dia certo sai do ISO.
        admissao: l.c_ativo === 1 && l.adm ? l.adm.toISOString().slice(0, 10) : null,
      };
    });
  });
}

/** Ids das pessoas ativas — os destinatários de um comunicado. */
export async function idsAtivos(): Promise<number[]> {
  return (await pessoasDoMural()).filter((p) => p.ativa).map((p) => p.id);
}

export type AniversarioGuardado = { pessoaId: number; dia: number; mes: number };

/**
 * Os aniversários visíveis deste mês e do mês em que cai daqui a 7 dias (a
 * "semana" pode atravessar a virada do mês). Busca no índice (mes, dia), uma
 * vez por dia por servidor; quem salva o próprio aniversário apaga o guardado.
 */
export async function aniversariosProximos(): Promise<AniversarioGuardado[]> {
  const { compartilhado } = await import("@/lib/cache-compartilhado.server");
  return compartilhado(CHAVE_ANIVERSARIOS, validadeAteMeiaNoite(), async () => {
    const hoje = diaNoBrasil();
    const daquiSete = diaNoBrasil(new Date(Date.now() + 7 * 86_400_000));
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("m1", sql.TinyInt, hoje.mes)
      .input("m2", sql.TinyInt, daquiSete.mes)
      .query(
        `SELECT pessoa_id, dia, mes FROM gestor.aniversarios
          WHERE mostrar = 1 AND mes IN (@m1, @m2)`,
      );
    return (r.recordset as { pessoa_id: number; dia: number; mes: number }[]).map((l) => ({
      pessoaId: l.pessoa_id,
      dia: l.dia,
      mes: l.mes,
    }));
  });
}

/** O post existe e não foi excluído — para ver/listar as fotos dele. */
export async function postVisivel(postId: string): Promise<boolean> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  try {
    const r = await pool
      .request()
      .input("id", sql.UniqueIdentifier, postId)
      .query(`SELECT 1 AS ok FROM gestor.mural_posts WHERE id = @id AND excluido_em IS NULL`);
    return r.recordset.length > 0;
  } catch (e) {
    if (ehMuralInativo(e)) return false;
    throw e;
  }
}

/** Limite de fotos por post. */
export const MAX_FOTOS = 4;

/**
 * Só o autor anexa foto no próprio post, e no máximo quatro. Chamado por
 * `enviarAnexo` quando o dono é 'mural'.
 */
export async function podeAnexarNoPost(eu: number, postId: string): Promise<boolean> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await noMural(() =>
    pool
      .request()
      .input("id", sql.UniqueIdentifier, postId)
      .input("eu", sql.Int, eu)
      .query(
        `SELECT CASE WHEN mp.autor_id = @eu
                      AND (SELECT COUNT(*) FROM gestor.anexos a
                            WHERE a.dono_tipo = N'mural' AND a.dono_id = mp.id) < ${MAX_FOTOS}
                     THEN 1 ELSE 0 END AS pode
           FROM gestor.mural_posts mp
          WHERE mp.id = @id AND mp.excluido_em IS NULL`,
      ),
  );
  return !!(r.recordset[0] as { pode: number } | undefined)?.pode;
}
