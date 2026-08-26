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

/* -------------------- Helpers compartilhados -------------------- */

/** Expira chamadas "ringing" com mais de 45s, marcando como "missed". */
export async function expireStaleCalls(pool: sql.ConnectionPool): Promise<void> {
  await pool
    .request()
    .query(
      `UPDATE dbo.room_call_events
         SET status='missed', handled_at=SYSUTCDATETIME()
       WHERE status='ringing'
         AND created_at < DATEADD(second, -45, SYSUTCDATETIME())`,
    );
}

/** Insere o membro se ainda não existir (equivalente ao upsert por (room,user)). */
export async function upsertMember(
  pool: sql.ConnectionPool,
  roomName: string,
  userId: string,
  addedBy: string,
): Promise<void> {
  await pool
    .request()
    .input("room", sql.NVarChar, roomName)
    .input("uid", sql.NVarChar, userId)
    .input("by", sql.NVarChar, addedBy)
    .query(
      `IF NOT EXISTS (SELECT 1 FROM dbo.room_members WHERE room_name=@room AND user_id=@uid)
         INSERT INTO dbo.room_members (room_name, user_id, added_by) VALUES (@room, @uid, @by)`,
    );
}

/** Define a privacidade da sala (cria a linha em room_state se não existir). */
export async function setRoomStatePrivacy(
  pool: sql.ConnectionPool,
  roomName: string,
  isPrivate: boolean,
  updatedBy: string,
): Promise<void> {
  await pool
    .request()
    .input("room", sql.NVarChar, roomName)
    .input("priv", sql.Bit, isPrivate)
    .input("by", sql.NVarChar, updatedBy)
    .query(
      `IF EXISTS (SELECT 1 FROM dbo.room_state WHERE room_name=@room)
         UPDATE dbo.room_state SET is_private=@priv, pin=NULL, updated_by=@by, updated_at=SYSUTCDATETIME() WHERE room_name=@room;
       ELSE
         INSERT INTO dbo.room_state (room_name, is_private, pin, updated_by) VALUES (@room, @priv, NULL, @by);`,
    );
}

/** true/false/undefined — se a sala é privada segundo o room_state. */
export async function getRoomIsPrivate(
  pool: sql.ConnectionPool,
  roomName: string,
): Promise<boolean | undefined> {
  const r = await pool
    .request()
    .input("room", sql.NVarChar, roomName)
    .query(`SELECT is_private FROM dbo.room_state WHERE room_name=@room`);
  const row = r.recordset[0] as { is_private: boolean } | undefined;
  return row?.is_private;
}

/** É membro da sala? */
export async function isRoomMember(
  pool: sql.ConnectionPool,
  roomName: string,
  userId: string,
): Promise<boolean> {
  const r = await pool
    .request()
    .input("room", sql.NVarChar, roomName)
    .input("uid", sql.NVarChar, userId)
    .query(`SELECT TOP 1 id FROM dbo.room_members WHERE room_name=@room AND user_id=@uid`);
  return r.recordset.length > 0;
}
