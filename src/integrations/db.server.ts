// Cliente Azure SQL (mssql) para uso EXCLUSIVO no servidor (server functions / rotas).
// Substitui o supabaseAdmin nas operações de sala e chamada — banco 100% próprio.
// Carregue dentro dos handlers: const db = await import("@/integrations/db.server");
import sql from "mssql";

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function getPool(): Promise<sql.ConnectionPool> {
  if (poolPromise) return poolPromise;

  const server = process.env.DB_SERVER;
  const database = process.env.DB_DATABASE;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  if (!server || !database || !user || !password) {
    throw new Error("Azure SQL não configurado no servidor");
  }
  const config: sql.config = {
    server,
    database,
    user,
    password,
    port: Number(process.env.DB_PORT ?? 1433),
    options: { encrypt: true, trustServerCertificate: false },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30_000 },
  };
  const p = new sql.ConnectionPool(config)
    .connect()
    .catch((e: unknown) => {
      poolPromise = null; // permite nova tentativa na próxima chamada
      throw e;
    });
  poolPromise = p;
  return p;
}

export { sql };

/* -------------------- Helpers compartilhados --------------------

   Estes falam com o schema `gestor`. As tabelas `dbo.room_*` continuam de pé
   com o mesmo conteúdo, intocadas — elas são a rede de segurança da virada, e
   deixam de ser lidas a partir daqui.

   Três coisas mudaram de forma junto com o schema:

   1. Pessoa é `INT`, não texto. O texto existia porque os ids do dado falso
      (`u1`, `u2`) não eram números; agora o banco recusa qualquer coisa que
      não seja o id numérico da IAM.
   2. Tempo é `DATETIMEOFFSET`, não `datetime2`. Por isso `SYSDATETIMEOFFSET()`
      no lugar de `SYSUTCDATETIME()`: o valor passa a carregar o fuso em vez de
      depender de quem lê saber que era UTC.
   3. As situações estão em português, como no resto do schema. A tradução
      para os termos que o app usa acontece em `livekit-token.functions.ts`,
      num lugar só. */

/** Expira chamadas que ficaram tocando mais de 45s, marcando como perdidas. */
export async function expireStaleCalls(pool: sql.ConnectionPool): Promise<void> {
  await pool
    .request()
    .query(
      `UPDATE gestor.chamadas
         SET situacao='perdida', respondida_em=SYSDATETIMEOFFSET()
       WHERE situacao='tocando'
         AND em < DATEADD(second, -45, SYSDATETIMEOFFSET())`,
    );
}

/**
 * Insere o participante se ainda não existir.
 *
 * A tabela nova tem chave primária `(sala, pessoa_id)`, o que a antiga não
 * tinha — ela usava um GUID e nada impedia a mesma pessoa de entrar duas vezes.
 * O `NOT EXISTS` evita o erro no caminho normal; se duas requisições chegarem
 * no mesmo instante, a chave recusa a segunda em vez de duplicar.
 */
export async function upsertMember(
  pool: sql.ConnectionPool,
  roomName: string,
  pessoaId: number,
  adicionadoPor: number,
): Promise<void> {
  await pool
    .request()
    .input("sala", sql.NVarChar, roomName)
    .input("pessoa", sql.Int, pessoaId)
    .input("por", sql.Int, adicionadoPor)
    .query(
      `INSERT INTO gestor.sala_participantes (sala, pessoa_id, adicionado_por)
       SELECT @sala, @pessoa, @por
        WHERE NOT EXISTS (
          SELECT 1 FROM gestor.sala_participantes WHERE sala=@sala AND pessoa_id=@pessoa
        )`,
    );
}

/** Define a privacidade da sala (cria a linha se ainda não existir). */
export async function setRoomStatePrivacy(
  pool: sql.ConnectionPool,
  roomName: string,
  isPrivate: boolean,
  atualizadaPor: number,
): Promise<void> {
  await pool
    .request()
    .input("sala", sql.NVarChar, roomName)
    .input("priv", sql.Bit, isPrivate)
    .input("por", sql.Int, atualizadaPor)
    .query(
      // A coluna `pin` sumiu no schema novo, e com razão: ela só era gravada
      // como NULL e devolvida como `false`. Nunca guardou senha nenhuma.
      `IF EXISTS (SELECT 1 FROM gestor.salas WHERE sala=@sala)
         UPDATE gestor.salas
            SET privada=@priv, atualizada_por=@por, atualizada_em=SYSDATETIMEOFFSET()
          WHERE sala=@sala;
       ELSE
         INSERT INTO gestor.salas (sala, privada, atualizada_por) VALUES (@sala, @priv, @por);`,
    );
}

/** true/false/undefined — se a sala é privada. `undefined` = sala sem linha. */
export async function getRoomIsPrivate(
  pool: sql.ConnectionPool,
  roomName: string,
): Promise<boolean | undefined> {
  const r = await pool
    .request()
    .input("sala", sql.NVarChar, roomName)
    .query(`SELECT privada FROM gestor.salas WHERE sala=@sala`);
  const row = r.recordset[0] as { privada: boolean } | undefined;
  return row?.privada;
}

/** É participante da sala? */
export async function isRoomMember(
  pool: sql.ConnectionPool,
  roomName: string,
  pessoaId: number,
): Promise<boolean> {
  const r = await pool
    .request()
    .input("sala", sql.NVarChar, roomName)
    .input("pessoa", sql.Int, pessoaId)
    .query(
      `SELECT TOP 1 1 AS achou FROM gestor.sala_participantes
        WHERE sala=@sala AND pessoa_id=@pessoa`,
    );
  return r.recordset.length > 0;
}
