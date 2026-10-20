import { createServerFn } from "@tanstack/react-start";
import { comSessao, semIdentidade } from "@/integrations/iam/funcao-com-sessao";
import type { Compromisso, ConflitoDeAgenda } from "@/lib/compromisso";

/* Agenda travada — as operações (14/10/2026).
 *
 * Pedido do usuário: "botão direito no calendário → 'Travar agenda'; abre as
 * pessoas e você trava a agenda dela naquele horário, tipo como o Outlook faz".
 *
 * Quem pode ter a agenda travada por mim: QUALQUER pessoa ativa do CONECTA
 * (pedido do usuário, 14/10/2026: "preciso também que possa travar a agenda
 * de qualquer pessoa"). A régua do "Delegar" valeu só na primeira versão do
 * mesmo dia e saiu.
 *
 * Quem VÊ um compromisso continua restrito, para a regra ficar simples:
 *   - quem criou e quem está nele veem sempre (Só minhas);
 *   - no modo Equipe, também a chefia no organograma (`SQL_PREPARA_SUBORDINADOS`)
 *     — a gerência vê todos —, do mesmo jeito que enxerga as tarefas da equipe.
 * No aviso de conflito, o choque de quem eu não enxergo aparece só como
 * "um compromisso", sem o assunto.
 *
 * Enquanto a migração (db/migracoes/2026-10-14-agenda-travada.sql) não roda,
 * a leitura responde `ativa: false` e lista vazia, e a gravação recusa com
 * `AGENDA_TRAVADA_INATIVA` — o calendário segue funcionando como antes.
 */

const FUSO = `N'E. South America Standard Time'`;
const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;
/** O `name` de uma sala do CONECTA (`rooms.ts`): "financeiro" ou "financeiro-2". */
const NOME_DE_SALA = /^[a-z0-9]{1,40}(-\d{1,3})?$/;
/** Um compromisso não passa de 24h — é o que deixa a busca por período usar o índice. */
const DURACAO_MAX_MS = 24 * 3_600_000;
const PARTICIPANTES_MAX = 60;
const DIAS_MAX = 62;

const data = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!ISO_DATA.test(s)) throw new Error("Data inválida (use AAAA-MM-DD)");
  return s;
};
const guid = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw new Error("Compromisso inválido");
  return s;
};
const instante = (v: unknown, rotulo: string): string => {
  const d = new Date(typeof v === "string" ? v : NaN);
  if (Number.isNaN(d.getTime())) throw new Error(`${rotulo} inválido`);
  return d.toISOString();
};
const texto = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
/** Ids de pessoa, sem repetidos. */
const ids = (v: unknown): number[] => {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const item of v) {
    const n = Number(item);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
};

type LinhaCompromisso = {
  id: string;
  criado_por: number;
  assunto: string;
  descricao: string | null;
  local: string | null;
  sala: string | null;
  inicio: Date;
  fim: Date;
};

function montar(
  linhas: LinhaCompromisso[],
  participantes: { compromisso_id: string; pessoa_id: number }[],
): Compromisso[] {
  const porId = new Map<string, string[]>();
  for (const p of participantes) {
    const chave = p.compromisso_id.toLowerCase();
    const lista = porId.get(chave);
    if (lista) lista.push(String(p.pessoa_id));
    else porId.set(chave, [String(p.pessoa_id)]);
  }
  return linhas.map((c) => ({
    id: c.id,
    criadoPor: String(c.criado_por),
    assunto: c.assunto,
    descricao: c.descricao,
    local: c.local,
    sala: c.sala,
    inicio: c.inicio.toISOString(),
    fim: c.fim.toISOString(),
    participantes: porId.get(c.id.toLowerCase()) ?? [],
  }));
}

/** Troca o 208 da migração pendente pela mensagem que a tela reconhece. */
async function naAgenda<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const { ehAgendaTravadaInativa, AGENDA_TRAVADA_INATIVA } =
      await import("@/lib/compromissos.server");
    if (ehAgendaTravadaInativa(e)) throw new Error(AGENDA_TRAVADA_INATIVA);
    throw e;
  }
}

/**
 * Os compromissos de um período: os meus (criei ou estou neles) e, com
 * `equipe`, também os de quem responde a mim — a gerência vê todos.
 *
 * O período é o dia de BRASÍLIA, como na agenda pessoal. A busca usa o índice
 * por `inicio` e começa um dia antes do período: um compromisso não passa de
 * 24h, então nada que o atravesse fica de fora.
 */
export const listarCompromissos = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { de: string; ate: string; equipe?: boolean }) => {
      const de = data(e?.de);
      const ate = data(e?.ate);
      if (ate < de) throw new Error("Período invertido");
      if ((Date.parse(ate) - Date.parse(de)) / 86_400_000 > DIAS_MAX)
        throw new Error(`Período máximo de ${DIAS_MAX} dias`);
      return { de, ate, equipe: e?.equipe === true };
    }),
  )
  .handler(
    comSessao(
      async (
        eu,
        d: { de: string; ate: string; equipe: boolean },
      ): Promise<{ ativa: boolean; compromissos: Compromisso[] }> => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const { SQL_QUEM_SOU, SQL_PREPARA_SUBORDINADOS } = await import("@/lib/permissoes.server");
        /* O organograma só entra no modo Equipe: no "Só minhas" basta @eu, e a
           comparação de nomes (ver `SQL_PREPARA_SUBORDINADOS`) fica de fora. */
        const daEquipe = d.equipe
          ? `OR @gerente = 1
             OR c.criado_por IN (SELECT id FROM @subs)
             OR EXISTS (SELECT 1 FROM gestor.compromisso_participantes p
                         WHERE p.compromisso_id = c.id AND p.pessoa_id IN (SELECT id FROM @subs))`
          : "";
        try {
          const r = await pool
            .request()
            .input("eu", sql.Int, eu)
            .input("de", sql.Date, d.de)
            .input("ate", sql.Date, d.ate)
            .query(
              `${d.equipe ? `${SQL_QUEM_SOU}\n${SQL_PREPARA_SUBORDINADOS}` : ""}
               DECLARE @ini DATETIMEOFFSET(3) = CAST(@de AS DATETIME2) AT TIME ZONE ${FUSO};
               DECLARE @fim DATETIMEOFFSET(3) = CAST(DATEADD(DAY, 1, @ate) AS DATETIME2) AT TIME ZONE ${FUSO};
               DECLARE @achados TABLE (id UNIQUEIDENTIFIER PRIMARY KEY);
               INSERT INTO @achados (id)
               SELECT c.id
                 FROM gestor.compromissos c
                WHERE c.cancelado_em IS NULL
                  AND c.inicio >= DATEADD(DAY, -1, @ini) AND c.inicio < @fim AND c.fim > @ini
                  AND (c.criado_por = @eu
                       OR EXISTS (SELECT 1 FROM gestor.compromisso_participantes p
                                   WHERE p.compromisso_id = c.id AND p.pessoa_id = @eu)
                       ${daEquipe});
               SELECT c.id, c.criado_por, c.assunto, c.descricao, c.local, c.sala, c.inicio, c.fim
                 FROM gestor.compromissos c JOIN @achados a ON a.id = c.id
                ORDER BY c.inicio;
               SELECT p.compromisso_id, p.pessoa_id
                 FROM gestor.compromisso_participantes p JOIN @achados a ON a.id = p.compromisso_id;`,
            );
          const [linhas, parts] = r.recordsets as unknown as [
            LinhaCompromisso[],
            { compromisso_id: string; pessoa_id: number }[],
          ];
          return { ativa: true, compromissos: montar(linhas, parts) };
        } catch (e) {
          const { ehAgendaTravadaInativa } = await import("@/lib/compromissos.server");
          if (ehAgendaTravadaInativa(e)) return { ativa: false, compromissos: [] };
          throw e;
        }
      },
    ),
  );

/** Um compromisso, para o cartão do aviso e o "abrir no calendário". Só quem o vê. */
export const detalharCompromisso = createServerFn({ method: "POST" })
  .validator(semIdentidade((e: { id: string }) => ({ id: guid(e?.id) })))
  .handler(
    comSessao(async (eu, d: { id: string }): Promise<{ compromisso: Compromisso | null }> =>
      naAgenda(async () => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const { SQL_QUEM_SOU, SQL_PREPARA_SUBORDINADOS } = await import("@/lib/permissoes.server");
        const r = await pool
          .request()
          .input("eu", sql.Int, eu)
          .input("id", sql.UniqueIdentifier, d.id)
          .query(
            `${SQL_QUEM_SOU}
             ${SQL_PREPARA_SUBORDINADOS}
             SELECT c.id, c.criado_por, c.assunto, c.descricao, c.local, c.sala, c.inicio, c.fim
               FROM gestor.compromissos c
              WHERE c.id = @id AND c.cancelado_em IS NULL
                AND (@gerente = 1 OR c.criado_por = @eu OR c.criado_por IN (SELECT id FROM @subs)
                     OR EXISTS (SELECT 1 FROM gestor.compromisso_participantes p
                                 WHERE p.compromisso_id = c.id
                                   AND (p.pessoa_id = @eu OR p.pessoa_id IN (SELECT id FROM @subs))));
             SELECT p.compromisso_id, p.pessoa_id
               FROM gestor.compromisso_participantes p WHERE p.compromisso_id = @id;`,
          );
        const [linhas, parts] = r.recordsets as unknown as [
          LinhaCompromisso[],
          { compromisso_id: string; pessoa_id: number }[],
        ];
        return { compromisso: montar(linhas, parts)[0] ?? null };
      }),
    ),
  );

/**
 * Quem destas pessoas já tem compromisso que se cruza com o horário.
 *
 * Só avisa — a gravação aceita mesmo com choque, como no Outlook. `ignorar` é o
 * próprio compromisso, na edição. Lê só compromissos de quem foi pedido, pelo
 * índice da pessoa. Desde que qualquer um trava a agenda de qualquer um
 * (14/10/2026), o choque vale para todos, mas o ASSUNTO só vem quando eu
 * enxergaria o compromisso (criei, estou nele, chefia ou gerência); fora
 * disso vem `null` e a tela diz "um compromisso".
 */
export const verificarConflitosDeAgenda = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { inicio: string; fim: string; pessoas: unknown; ignorar?: string }) => {
      const inicio = instante(e?.inicio, "Início");
      const fim = instante(e?.fim, "Fim");
      const pessoas = ids(e?.pessoas).slice(0, PARTICIPANTES_MAX);
      return { inicio, fim, pessoas, ignorar: e?.ignorar ? guid(e.ignorar) : null };
    }),
  )
  .handler(
    comSessao(
      async (
        eu,
        d: { inicio: string; fim: string; pessoas: number[]; ignorar: string | null },
      ): Promise<{ ativa: boolean; conflitos: ConflitoDeAgenda[] }> => {
        if (d.pessoas.length === 0 || d.fim <= d.inicio) return { ativa: true, conflitos: [] };
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const { SQL_QUEM_SOU, SQL_PREPARA_SUBORDINADOS } = await import("@/lib/permissoes.server");
        try {
          const r = await pool
            .request()
            .input("eu", sql.Int, eu)
            .input("pessoas", sql.NVarChar(sql.MAX), JSON.stringify(d.pessoas))
            .input("inicio", sql.DateTimeOffset, new Date(d.inicio))
            .input("fim", sql.DateTimeOffset, new Date(d.fim))
            .input("ignorar", sql.UniqueIdentifier, d.ignorar)
            .query(
              `${SQL_QUEM_SOU}
               ${SQL_PREPARA_SUBORDINADOS}
               SELECT p.pessoa_id, c.id, c.inicio, c.fim,
                      CASE WHEN @gerente = 1 OR c.criado_por = @eu
                                OR p.pessoa_id = @eu OR p.pessoa_id IN (SELECT id FROM @subs)
                                OR c.criado_por IN (SELECT id FROM @subs)
                                OR EXISTS (SELECT 1 FROM gestor.compromisso_participantes eu_nele
                                            WHERE eu_nele.compromisso_id = c.id AND eu_nele.pessoa_id = @eu)
                           THEN c.assunto END AS assunto
                 FROM OPENJSON(@pessoas) j
                 JOIN gestor.compromisso_participantes p ON p.pessoa_id = CAST(j.value AS INT)
                 JOIN gestor.compromissos c ON c.id = p.compromisso_id
                WHERE c.cancelado_em IS NULL
                  AND c.inicio < @fim AND c.fim > @inicio
                  AND (@ignorar IS NULL OR c.id <> @ignorar)
                ORDER BY c.inicio;`,
            );
          return {
            ativa: true,
            conflitos: (
              r.recordset as {
                pessoa_id: number;
                id: string;
                assunto: string | null;
                inicio: Date;
                fim: Date;
              }[]
            ).map((l) => ({
              pessoaId: String(l.pessoa_id),
              compromissoId: l.id,
              assunto: l.assunto,
              inicio: l.inicio.toISOString(),
              fim: l.fim.toISOString(),
            })),
          };
        } catch (e) {
          const { ehAgendaTravadaInativa } = await import("@/lib/compromissos.server");
          if (ehAgendaTravadaInativa(e)) return { ativa: false, conflitos: [] };
          throw e;
        }
      },
    ),
  );

type DadosDoCompromisso = {
  id: string | null;
  assunto: string;
  descricao: string | null;
  local: string | null;
  sala: string | null;
  inicio: string;
  fim: string;
  participantes: number[];
};

/**
 * Trava (ou, com `id`, muda) a agenda.
 *
 * Só quem criou muda. Qualquer pessoa pode ser incluída (14/10/2026); o
 * servidor só confere se ela existe no CONECTA e não está desligada no
 * organograma — quem não passa derruba a gravação, com o nome na mensagem.
 *
 * Avisos na mesma transação, a quem não é quem criou: "travou sua agenda" para
 * quem entrou, "mudou o horário da sua agenda" para quem já estava quando o
 * horário muda. Mudar o horário também zera as marcas de 30/10 minutos, para o
 * aviso sair de novo no horário novo.
 */
export const salvarCompromisso = createServerFn({ method: "POST" })
  .validator(
    semIdentidade(
      (e: {
        id?: string | null;
        assunto: string;
        descricao?: string | null;
        local?: string | null;
        sala?: string | null;
        inicio: string;
        fim: string;
        participantes: unknown;
      }): DadosDoCompromisso => {
        const assunto = texto(e?.assunto, 160);
        if (!assunto) throw new Error("Escreva o assunto");
        const inicio = instante(e?.inicio, "Início");
        const fim = instante(e?.fim, "Fim");
        const duracao = Date.parse(fim) - Date.parse(inicio);
        if (duracao <= 0) throw new Error("O fim precisa ser depois do início");
        if (duracao > DURACAO_MAX_MS) throw new Error("Uma agenda travada vai até 24 horas");
        const sala = texto(e?.sala, 80) || null;
        if (sala && !NOME_DE_SALA.test(sala)) throw new Error("Sala inválida");
        const participantes = ids(e?.participantes);
        if (participantes.length === 0) throw new Error("Escolha pelo menos uma pessoa");
        if (participantes.length > PARTICIPANTES_MAX)
          throw new Error(`No máximo ${PARTICIPANTES_MAX} pessoas`);
        return {
          id: e?.id ? guid(e.id) : null,
          assunto,
          descricao: texto(e?.descricao, 1000) || null,
          local: texto(e?.local, 120) || null,
          sala,
          inicio,
          fim,
          participantes,
        };
      },
    ),
  )
  .handler(
    comSessao(async (eu, d: DadosDoCompromisso): Promise<{ id: string }> =>
      naAgenda(async () => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        /* Existe e está ativa. "Ativa" = tem perfil no CONECTA e, se aparece
           no organograma (efetivo ou externo), ao menos uma linha ativa — a
           mesma leitura de `listarPessoas`. Quem não está no organograma conta
           como ativo. Só roda ao gravar, para no máximo 60 pessoas. Volta
           quem NÃO passa.

           (19/10/2026) A Mayara Talita não conseguia travar a PRÓPRIA agenda:
           no RH ela está com SITUACAO '9' (não '1'), mas trabalha e usa o
           CONECTA todo dia. Agora quem trava nunca é barrado, e quem entrou no
           CONECTA nos últimos 30 dias conta como ativo, seja qual for a
           situação no RH. A barreira continua para quem saiu e não usa mais. */
        const conferencia = await pool
          .request()
          .input("pessoas", sql.NVarChar(sql.MAX), JSON.stringify(d.participantes))
          .input("autor", sql.Int, eu)
          .query(
            `SELECT CAST(j.value AS INT) AS pessoa_id, pf.nome
               FROM OPENJSON(@pessoas) j
               LEFT JOIN gestor.perfis pf ON pf.pessoa_id = CAST(j.value AS INT)
              WHERE CAST(j.value AS INT) <> @autor
                AND (pf.pessoa_id IS NULL OR pf.nome IS NULL
                 OR ((EXISTS (SELECT 1 FROM dbo.COLABORADORES col
                               WHERE LTRIM(RTRIM(col.NOME)) COLLATE Latin1_General_CI_AI
                                     = LTRIM(RTRIM(pf.nome)) COLLATE Latin1_General_CI_AI)
                      OR EXISTS (SELECT 1 FROM dbo.COLABORADORES_EXTERNOS ext
                                  WHERE LTRIM(RTRIM(ext.NOME)) COLLATE Latin1_General_CI_AI
                                        = LTRIM(RTRIM(pf.nome)) COLLATE Latin1_General_CI_AI))
                     AND NOT EXISTS (SELECT 1 FROM dbo.COLABORADORES col
                                      WHERE col.SITUACAO = '1'
                                        AND LTRIM(RTRIM(col.NOME)) COLLATE Latin1_General_CI_AI
                                            = LTRIM(RTRIM(pf.nome)) COLLATE Latin1_General_CI_AI)
                     AND NOT EXISTS (SELECT 1 FROM dbo.COLABORADORES_EXTERNOS ext
                                      WHERE ext.ATIVO = 1
                                        AND LTRIM(RTRIM(ext.NOME)) COLLATE Latin1_General_CI_AI
                                            = LTRIM(RTRIM(pf.nome)) COLLATE Latin1_General_CI_AI)
                     -- usa o CONECTA: entrou nos últimos 30 dias
                     AND NOT EXISTS (SELECT 1 FROM gestor.presenca pr
                                      WHERE pr.pessoa_id = pf.pessoa_id
                                        AND pr.visto_em >= DATEADD(DAY, -30, SYSDATETIMEOFFSET()))));`,
          );
        const barrados = conferencia.recordset as { pessoa_id: number; nome: string | null }[];
        if (barrados.length > 0) {
          const nomes = barrados.map((b) => b.nome ?? `#${b.pessoa_id}`).join(", ");
          throw new Error(`Não dá para travar a agenda de quem não está ativo: ${nomes}`);
        }

        const r = await pool
          .request()
          .input("eu", sql.Int, eu)
          .input("id", sql.UniqueIdentifier, d.id)
          .input("assunto", sql.NVarChar(160), d.assunto)
          .input("descricao", sql.NVarChar(1000), d.descricao)
          .input("local", sql.NVarChar(120), d.local)
          .input("sala", sql.NVarChar(80), d.sala)
          .input("inicio", sql.DateTimeOffset, new Date(d.inicio))
          .input("fim", sql.DateTimeOffset, new Date(d.fim))
          .input("pessoas", sql.NVarChar(sql.MAX), JSON.stringify(d.participantes))
          .query(
            `SET XACT_ABORT ON;
               DECLARE @quem TABLE (pessoa_id INT PRIMARY KEY);
               INSERT INTO @quem (pessoa_id) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@pessoas);
               DECLARE @quando NVARCHAR(60) =
                 CONVERT(VARCHAR(5), @inicio AT TIME ZONE ${FUSO}, 103) + N' · ' +
                 CONVERT(VARCHAR(5), @inicio AT TIME ZONE ${FUSO}, 108) + N'–' +
                 CONVERT(VARCHAR(5), @fim AT TIME ZONE ${FUSO}, 108);
               DECLARE @desc NVARCHAR(400) = LEFT(@assunto + N' · ' + @quando, 400);
               BEGIN TRAN;
               IF @id IS NULL
               BEGIN
                 DECLARE @novo TABLE (id UNIQUEIDENTIFIER);
                 INSERT INTO gestor.compromissos (criado_por, assunto, descricao, local, sala, inicio, fim)
                 OUTPUT inserted.id INTO @novo
                 VALUES (@eu, @assunto, @descricao, @local, @sala, @inicio, @fim);
                 SELECT @id = id FROM @novo;
                 INSERT INTO gestor.compromisso_participantes (compromisso_id, pessoa_id)
                 SELECT @id, pessoa_id FROM @quem;
                 INSERT INTO gestor.notificacoes
                   (destinatario_id, de_pessoa_id, tipo, titulo, descricao, sala, projeto_id)
                 SELECT pessoa_id, @eu, 'compromisso', N'travou sua agenda', @desc, @sala, @id
                   FROM @quem WHERE pessoa_id <> @eu;
               END
               ELSE
               BEGIN
                 DECLARE @antes_inicio DATETIMEOFFSET(3), @antes_fim DATETIMEOFFSET(3);
                 SELECT @antes_inicio = inicio, @antes_fim = fim
                   FROM gestor.compromissos WITH (UPDLOCK)
                  WHERE id = @id AND criado_por = @eu AND cancelado_em IS NULL;
                 IF @antes_inicio IS NULL
                 BEGIN
                   ROLLBACK;
                   SELECT CAST(NULL AS UNIQUEIDENTIFIER) AS id;
                   RETURN;
                 END
                 DECLARE @mudou_horario BIT =
                   CASE WHEN @antes_inicio <> @inicio OR @antes_fim <> @fim THEN 1 ELSE 0 END;
                 UPDATE gestor.compromissos
                    SET assunto = @assunto, descricao = @descricao, local = @local, sala = @sala,
                        inicio = @inicio, fim = @fim, atualizado_em = SYSDATETIMEOFFSET(),
                        criador_alertado_30_em = CASE WHEN @mudou_horario = 1 THEN NULL ELSE criador_alertado_30_em END,
                        criador_alertado_10_em = CASE WHEN @mudou_horario = 1 THEN NULL ELSE criador_alertado_10_em END
                  WHERE id = @id;
                 -- Quem saiu, sai; quem entrou, entra; quem ficou, fica (com as marcas).
                 DELETE FROM gestor.compromisso_participantes
                  WHERE compromisso_id = @id AND pessoa_id NOT IN (SELECT pessoa_id FROM @quem);
                 IF @mudou_horario = 1
                 BEGIN
                   UPDATE gestor.compromisso_participantes
                      SET alertado_30_em = NULL, alertado_10_em = NULL
                    WHERE compromisso_id = @id;
                   INSERT INTO gestor.notificacoes
                     (destinatario_id, de_pessoa_id, tipo, titulo, descricao, sala, projeto_id)
                   SELECT p.pessoa_id, @eu, 'compromisso', N'mudou o horário da sua agenda', @desc, @sala, @id
                     FROM gestor.compromisso_participantes p
                    WHERE p.compromisso_id = @id AND p.pessoa_id <> @eu;
                 END
                 INSERT INTO gestor.notificacoes
                   (destinatario_id, de_pessoa_id, tipo, titulo, descricao, sala, projeto_id)
                 SELECT q.pessoa_id, @eu, 'compromisso', N'travou sua agenda', @desc, @sala, @id
                   FROM @quem q
                  WHERE q.pessoa_id <> @eu
                    AND NOT EXISTS (SELECT 1 FROM gestor.compromisso_participantes p
                                     WHERE p.compromisso_id = @id AND p.pessoa_id = q.pessoa_id);
                 INSERT INTO gestor.compromisso_participantes (compromisso_id, pessoa_id)
                 SELECT @id, q.pessoa_id FROM @quem q
                  WHERE NOT EXISTS (SELECT 1 FROM gestor.compromisso_participantes p
                                     WHERE p.compromisso_id = @id AND p.pessoa_id = q.pessoa_id);
               END
               COMMIT;
               SELECT @id AS id;`,
          );
        const id = (r.recordset?.[0] as { id: string | null } | undefined)?.id;
        if (!id) throw new Error("Só quem travou a agenda pode mudá-la");
        return { id };
      }),
    ),
  );

/**
 * Cancela — marca `cancelado_em`, não apaga. Só quem criou. Avisa os
 * participantes (menos quem criou) na mesma transação.
 */
export const cancelarCompromisso = createServerFn({ method: "POST" })
  .validator(semIdentidade((e: { id: string }) => ({ id: guid(e?.id) })))
  .handler(
    comSessao(async (eu, d: { id: string }): Promise<{ ok: boolean }> =>
      naAgenda(async () => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const r = await pool
          .request()
          .input("eu", sql.Int, eu)
          .input("id", sql.UniqueIdentifier, d.id)
          .query(
            `SET XACT_ABORT ON;
             BEGIN TRAN;
             DECLARE @c TABLE (assunto NVARCHAR(160), inicio DATETIMEOFFSET(3), fim DATETIMEOFFSET(3), sala NVARCHAR(80));
             UPDATE gestor.compromissos
                SET cancelado_em = SYSDATETIMEOFFSET(), cancelado_por = @eu
             OUTPUT inserted.assunto, inserted.inicio, inserted.fim, inserted.sala INTO @c
              WHERE id = @id AND criado_por = @eu AND cancelado_em IS NULL;
             INSERT INTO gestor.notificacoes
               (destinatario_id, de_pessoa_id, tipo, titulo, descricao, projeto_id)
             SELECT p.pessoa_id, @eu, 'compromisso', N'cancelou a agenda',
                    LEFT(c.assunto + N' · ' +
                         CONVERT(VARCHAR(5), c.inicio AT TIME ZONE ${FUSO}, 103) + N' · ' +
                         CONVERT(VARCHAR(5), c.inicio AT TIME ZONE ${FUSO}, 108) + N'–' +
                         CONVERT(VARCHAR(5), c.fim AT TIME ZONE ${FUSO}, 108), 400),
                    @id
               FROM gestor.compromisso_participantes p CROSS JOIN @c c
              WHERE p.compromisso_id = @id AND p.pessoa_id <> @eu;
             COMMIT;
             SELECT COUNT(*) AS n FROM @c;`,
          );
        const n = (r.recordset?.[0] as { n: number } | undefined)?.n ?? 0;
        if (n === 0) throw new Error("Só quem travou a agenda pode cancelá-la");
        return { ok: true };
      }),
    ),
  );
