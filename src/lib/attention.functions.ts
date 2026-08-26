import { createServerFn } from "@tanstack/react-start";

const sanitizeUserId = (value: unknown) => {
  if (typeof value !== "string") throw new Error("Usuário inválido");
  const id = value.trim().slice(0, 80);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Usuário inválido");
  return id;
};

/**
 * Envia um "chamar atenção" gravando no Azure SQL.
 * O destinatário recebe por polling (mesma mecânica das chamadas, que é
 * a que funciona de forma confiável entre máquinas).
 */
export const sendNudgeFn = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      fromUserId: string;
      fromName: string;
      fromAvatar?: string;
      targetUserId: string;
    }) => {
      const fromUserId = sanitizeUserId(input?.fromUserId);
      const targetUserId = sanitizeUserId(input?.targetUserId);
      if (fromUserId === targetUserId) throw new Error("Você não pode se cutucar");
      const fromName =
        typeof input?.fromName === "string" && input.fromName.trim()
          ? input.fromName.trim().slice(0, 120)
          : fromUserId;
      const fromAvatar =
        typeof input?.fromAvatar === "string" ? input.fromAvatar.trim().slice(0, 20) : "";
      return { fromUserId, fromName, fromAvatar, targetUserId };
    },
  )
  .handler(async ({ data }) => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    await pool
      .request()
      .input("from", sql.NVarChar, data.fromUserId)
      .input("name", sql.NVarChar, data.fromName)
      .input("avatar", sql.NVarChar, data.fromAvatar || null)
      .input("target", sql.NVarChar, data.targetUserId)
      .query(
        `INSERT INTO dbo.nudges (from_user_id, from_name, from_avatar, target_user_id)
         VALUES (@from, @name, @avatar, @target)`,
      );
    return { ok: true };
  });

/** Busca cutucadas recebidas desde `sinceIso` (janela curta, evita repetir antigas). */
export const listNudgesFn = createServerFn({ method: "POST" })
  .inputValidator((input: { userId: string; sinceIso?: string }) => {
    const userId = sanitizeUserId(input?.userId);
    const sinceIso =
      typeof input?.sinceIso === "string" && !Number.isNaN(Date.parse(input.sinceIso))
        ? input.sinceIso
        : new Date(Date.now() - 20_000).toISOString();
    return { userId, sinceIso };
  })
  .handler(async ({ data }) => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const res = await pool
      .request()
      .input("uid", sql.NVarChar, data.userId)
      .input("since", sql.DateTime2, new Date(data.sinceIso))
      .query(
        `SELECT TOP 5 id, from_user_id, from_name, from_avatar, created_at
           FROM dbo.nudges
          WHERE target_user_id=@uid AND created_at > @since
          ORDER BY created_at DESC`,
      );
    return { nudges: res.recordset ?? [] };
  });
