import { createServerFn } from "@tanstack/react-start";

const uid = (v: unknown) => {
  if (typeof v !== "string") throw new Error("Usuário inválido");
  const id = v.trim().slice(0, 80);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Usuário inválido");
  return id;
};

const MAX_ATT = 5 * 1024 * 1024; // ~5MB de dataURL

/* -------------------- Mensagens -------------------- */

export const chatSend = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      fromUserId: string;
      toUserId: string;
      body?: string;
      attName?: string;
      attType?: string;
      attData?: string;
    }) => {
      const fromUserId = uid(input?.fromUserId);
      const toUserId = uid(input?.toUserId);
      if (fromUserId === toUserId) throw new Error("Não dá para conversar consigo mesmo");
      const body = typeof input?.body === "string" ? input.body.slice(0, 4000) : "";
      const attData = typeof input?.attData === "string" ? input.attData : "";
      if (attData && attData.length > MAX_ATT) throw new Error("Anexo muito grande");
      if (!body.trim() && !attData) throw new Error("Mensagem vazia");
      return {
        fromUserId,
        toUserId,
        body: body.trim(),
        attName: typeof input?.attName === "string" ? input.attName.slice(0, 300) : "",
        attType: typeof input?.attType === "string" ? input.attType.slice(0, 120) : "",
        attData,
      };
    },
  )
  .handler(async ({ data }) => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const res = await pool
      .request()
      .input("from", sql.NVarChar, data.fromUserId)
      .input("to", sql.NVarChar, data.toUserId)
      .input("body", sql.NVarChar(sql.MAX), data.body || null)
      .input("an", sql.NVarChar, data.attName || null)
      .input("at", sql.NVarChar, data.attType || null)
      .input("ad", sql.NVarChar(sql.MAX), data.attData || null)
      .query(
        `INSERT INTO dbo.chat_messages (from_user_id, to_user_id, body, att_name, att_type, att_data)
         OUTPUT INSERTED.id, INSERTED.created_at
         VALUES (@from, @to, @body, @an, @at, @ad)`,
      );
    return { message: res.recordset[0] };
  });

export const chatConversation = createServerFn({ method: "POST" })
  .inputValidator((input: { userId: string; peerId: string }) => ({
    userId: uid(input?.userId),
    peerId: uid(input?.peerId),
  }))
  .handler(async ({ data }) => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const res = await pool
      .request()
      .input("me", sql.NVarChar, data.userId)
      .input("peer", sql.NVarChar, data.peerId)
      .query(
        `SELECT TOP 200 id, from_user_id, to_user_id, body, att_name, att_type, att_data, created_at, read_at
           FROM dbo.chat_messages
          WHERE (from_user_id=@me AND to_user_id=@peer)
             OR (from_user_id=@peer AND to_user_id=@me)
          ORDER BY created_at DESC`,
      );
    // devolve em ordem cronológica
    return { messages: (res.recordset ?? []).reverse() };
  });

/** Última mensagem por contato + não lidas — para a lista estilo WhatsApp. */
export const chatThreads = createServerFn({ method: "POST" })
  .inputValidator((input: { userId: string }) => ({ userId: uid(input?.userId) }))
  .handler(async ({ data }) => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const res = await pool
      .request()
      .input("me", sql.NVarChar, data.userId)
      .query(
        `WITH conv AS (
           SELECT
             CASE WHEN from_user_id=@me THEN to_user_id ELSE from_user_id END AS peer,
             id, body, att_type, created_at, from_user_id
           FROM dbo.chat_messages
           WHERE from_user_id=@me OR to_user_id=@me
         ),
         ranked AS (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY peer ORDER BY created_at DESC) rn FROM conv
         )
         SELECT r.peer, r.body, r.att_type, r.created_at, r.from_user_id,
           (SELECT COUNT(*) FROM dbo.chat_messages m
              WHERE m.to_user_id=@me AND m.from_user_id=r.peer AND m.read_at IS NULL) AS unread
         FROM ranked r WHERE r.rn=1
         ORDER BY r.created_at DESC`,
      );
    return { threads: res.recordset ?? [] };
  });

export const chatMarkRead = createServerFn({ method: "POST" })
  .inputValidator((input: { userId: string; peerId: string }) => ({
    userId: uid(input?.userId),
    peerId: uid(input?.peerId),
  }))
  .handler(async ({ data }) => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    await pool
      .request()
      .input("me", sql.NVarChar, data.userId)
      .input("peer", sql.NVarChar, data.peerId)
      .query(
        `UPDATE dbo.chat_messages SET read_at=SYSUTCDATETIME()
          WHERE to_user_id=@me AND from_user_id=@peer AND read_at IS NULL`,
      );
    return { ok: true };
  });

/* -------------------- Presença (online/offline) -------------------- */

export const presenceHeartbeat = createServerFn({ method: "POST" })
  .inputValidator((input: { userId: string }) => ({ userId: uid(input?.userId) }))
  .handler(async ({ data }) => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    await pool
      .request()
      .input("uid", sql.NVarChar, data.userId)
      .query(
        `IF EXISTS (SELECT 1 FROM dbo.user_presence WHERE user_id=@uid)
           UPDATE dbo.user_presence SET last_seen=SYSUTCDATETIME() WHERE user_id=@uid;
         ELSE
           INSERT INTO dbo.user_presence (user_id, last_seen) VALUES (@uid, SYSUTCDATETIME());`,
      );
    return { ok: true };
  });

export const presenceList = createServerFn({ method: "POST" })
  .handler(async () => {
    const { getPool } = await import("@/integrations/db.server");
    const pool = await getPool();
    const res = await pool
      .request()
      .query(`SELECT user_id, last_seen FROM dbo.user_presence`);
    return { presence: res.recordset ?? [] };
  });
