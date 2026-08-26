import { createServerFn } from "@tanstack/react-start";

type RoomCallStatus = "ringing" | "accepted" | "declined" | "missed";

const sanitizeUserId = (value: unknown) => {
  if (typeof value !== "string") throw new Error("Usuário inválido");
  const id = value.trim().slice(0, 80);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Usuário inválido");
  return id;
};

const sanitizeRoomName = (value: unknown) => {
  if (typeof value !== "string") throw new Error("Sala inválida");
  const roomName = value.trim().slice(0, 64);
  if (!roomName || !/^[a-zA-Z0-9_-]+$/.test(roomName)) throw new Error("Nome de sala inválido");
  return roomName;
};

const sanitizeRoomLabel = (value: unknown, fallback: string) => {
  const label = typeof value === "string" ? value.trim().slice(0, 80) : "";
  return label || fallback;
};

export const getLiveKitToken = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; identity: string; name: string }) => {
    if (!input || typeof input.roomName !== "string" || typeof input.identity !== "string") {
      throw new Error("Parâmetros inválidos");
    }
    const roomName = input.roomName.trim().slice(0, 64);
    const identity = input.identity.trim().slice(0, 64);
    const name = (input.name ?? identity).trim().slice(0, 64);
    if (!roomName || !identity) throw new Error("Sala e identidade são obrigatórios");
    if (!/^[a-zA-Z0-9_-]+$/.test(roomName)) throw new Error("Nome de sala inválido");
    const userId =
      typeof (input as { userId?: string }).userId === "string"
        ? (input as { userId?: string }).userId!.trim().slice(0, 80)
        : "";
    return { roomName, identity, name, userId };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) {
      throw new Error("LiveKit não configurado no servidor");
    }
    // Impõe privacidade em CADA emissão de token. Sala privada exige userId + membro.
    {
      const { getPool, isRoomMember, getRoomIsPrivate } = await import("@/integrations/db.server");
      const pool = await getPool();
      const isPrivate = await getRoomIsPrivate(pool, data.roomName);
      if (isPrivate) {
        if (!data.userId) throw new Error("Sala privada: sessão inválida");
        const member = await isRoomMember(pool, data.roomName, data.userId);
        if (!member) throw new Error("Sala privada: peça para entrar antes.");
      }
    }
    const { AccessToken } = await import("livekit-server-sdk");
    const at = new AccessToken(apiKey, apiSecret, {
      identity: data.identity,
      name: data.name,
      ttl: 60 * 60 * 4, // 4 horas
    });
    at.addGrant({
      room: data.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();
    return { token, url, roomName: data.roomName };
  });

export const listRoomsPresence = createServerFn({ method: "POST" })
  .inputValidator((input: { rooms: string[] }) => {
    if (!input || !Array.isArray(input.rooms)) throw new Error("rooms inválido");
    const rooms = input.rooms
      .filter((r) => typeof r === "string" && /^[a-zA-Z0-9_-]+$/.test(r))
      .slice(0, 30);
    return { rooms };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !wsUrl) {
      throw new Error("LiveKit não configurado no servidor");
    }
    const httpUrl = wsUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
    const { RoomServiceClient } = await import("livekit-server-sdk");
    const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
    const presence: Record<string, { identity: string; name: string }[]> = {};
    await Promise.all(
      data.rooms.map(async (room) => {
        try {
          const parts = await svc.listParticipants(room);
          presence[room] = parts.map((p) => ({
            identity: p.identity,
            name: p.name || p.identity,
          }));
        } catch {
          presence[room] = [];
        }
      }),
    );
    return { presence };
  });

export const listSectorRooms = createServerFn({ method: "POST" })
  .inputValidator((input: { sectors: string[] }) => {
    if (!input || !Array.isArray(input.sectors)) throw new Error("sectors inválido");
    const sectors = input.sectors
      .filter((s) => typeof s === "string" && /^[a-zA-Z0-9_-]+$/.test(s))
      .slice(0, 30);
    return { sectors };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !wsUrl) {
      throw new Error("LiveKit não configurado no servidor");
    }
    const httpUrl = wsUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
    const { RoomServiceClient } = await import("livekit-server-sdk");
    const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
    let liveRooms: string[] = [];
    try {
      const rooms = await svc.listRooms();
      liveRooms = rooms.map((r) => r.name);
    } catch {
      liveRooms = [];
    }

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();

    const bySector: Record<
      string,
      {
        name: string;
        isPrivate: boolean;
        participants: { identity: string; name: string }[];
        activeSpeakers: string[];
      }[]
    > = {};

    await Promise.all(
      data.sectors.map(async (sector) => {
        const matches = new Set<string>([sector]);
        const re = new RegExp(`^${sector}(?:-([2-9]|[1-9][0-9]))?$`);
        for (const r of liveRooms) if (re.test(r)) matches.add(r);
        const names = Array.from(matches).sort((a, b) =>
          a.localeCompare(b, "pt-BR", { numeric: true }),
        );

        // Busca room_state das salas do setor (IN dinâmico e parametrizado).
        const req = pool.request();
        const placeholders = names.map((n, i) => {
          req.input(`n${i}`, sql.NVarChar, n);
          return `@n${i}`;
        });
        const states =
          placeholders.length > 0
            ? (
                await req.query(
                  `SELECT room_name, is_private, active_speakers, speakers_updated_at
                     FROM dbo.room_state WHERE room_name IN (${placeholders.join(",")})`,
                )
              ).recordset
            : [];

        const privacyMap = new Map<string, boolean>(
          states.map((s: { room_name: string; is_private: boolean }) => [s.room_name, !!s.is_private]),
        );
        const now = Date.now();
        const speakersMap = new Map<string, string[]>();
        for (const s of states as {
          room_name: string;
          active_speakers: string | null;
          speakers_updated_at: Date | null;
        }[]) {
          const ts = s.speakers_updated_at ? new Date(s.speakers_updated_at).getTime() : 0;
          if (ts && now - ts < 5000 && s.active_speakers) {
            try {
              const arr = JSON.parse(s.active_speakers);
              if (Array.isArray(arr)) {
                speakersMap.set(
                  s.room_name,
                  arr.filter((x): x is string => typeof x === "string"),
                );
              }
            } catch {
              /* ignore json inválido */
            }
          }
        }

        const withParts = await Promise.all(
          names.map(async (name) => {
            try {
              const parts = await svc.listParticipants(name);
              return {
                name,
                isPrivate: privacyMap.get(name) ?? false,
                participants: parts.map((p) => ({
                  identity: p.identity,
                  name: p.name || p.identity,
                })),
                activeSpeakers: speakersMap.get(name) ?? [],
              };
            } catch {
              return {
                name,
                isPrivate: privacyMap.get(name) ?? false,
                participants: [],
                activeSpeakers: speakersMap.get(name) ?? [],
              };
            }
          }),
        );
        bySector[sector] = withParts;
      }),
    );
    return { bySector };
  });

export const createRoomCall = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      callerUserId: string;
      targetUserId: string;
      roomName: string;
      roomLabel: string;
    }) => {
      const callerUserId = sanitizeUserId(input?.callerUserId);
      const targetUserId = sanitizeUserId(input?.targetUserId);
      const roomName = sanitizeRoomName(input?.roomName);
      const roomLabel = sanitizeRoomLabel(input?.roomLabel, roomName);
      if (callerUserId === targetUserId) throw new Error("Você não pode chamar você mesmo");
      return { callerUserId, targetUserId, roomName, roomLabel };
    },
  )
  .handler(async ({ data }) => {
    const { getPool, sql, expireStaleCalls } = await import("@/integrations/db.server");
    const pool = await getPool();
    await expireStaleCalls(pool);

    const res = await pool
      .request()
      .input("caller", sql.NVarChar, data.callerUserId)
      .input("target", sql.NVarChar, data.targetUserId)
      .input("room", sql.NVarChar, data.roomName)
      .input("label", sql.NVarChar, data.roomLabel)
      .query(
        `INSERT INTO dbo.room_call_events (caller_user_id, target_user_id, room_name, room_label)
         OUTPUT INSERTED.id, INSERTED.caller_user_id, INSERTED.target_user_id,
                INSERTED.room_name, INSERTED.room_label, INSERTED.status, INSERTED.created_at
         VALUES (@caller, @target, @room, @label)`,
      );
    const call = res.recordset[0];
    if (!call) throw new Error("Não foi possível chamar essa pessoa agora");
    return { call };
  });

export const listIncomingRoomCalls = createServerFn({ method: "POST" })
  .inputValidator((input: { userId: string }) => ({ userId: sanitizeUserId(input?.userId) }))
  .handler(async ({ data }) => {
    const { getPool, sql, expireStaleCalls } = await import("@/integrations/db.server");
    const pool = await getPool();
    await expireStaleCalls(pool);

    const res = await pool
      .request()
      .input("uid", sql.NVarChar, data.userId)
      .query(
        `SELECT TOP 3 id, caller_user_id, target_user_id, room_name, room_label, status, created_at
           FROM dbo.room_call_events
          WHERE target_user_id=@uid AND status='ringing'
            AND created_at >= DATEADD(second, -45, SYSUTCDATETIME())
          ORDER BY created_at DESC`,
      );
    return { calls: res.recordset ?? [] };
  });

export const updateRoomCallStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { callId: string; status: RoomCallStatus; userId: string }) => {
    if (!input || typeof input.callId !== "string") throw new Error("Chamada inválida");
    const callId = input.callId.trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(callId)
    ) {
      throw new Error("Chamada inválida");
    }
    const allowed: RoomCallStatus[] = ["accepted", "declined", "missed"];
    if (!allowed.includes(input.status)) throw new Error("Status inválido");
    return { callId, status: input.status, userId: sanitizeUserId(input.userId) };
  })
  .handler(async ({ data }) => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, data.callId)
      .input("uid", sql.NVarChar, data.userId)
      .input("status", sql.NVarChar, data.status)
      .query(
        `UPDATE dbo.room_call_events
           SET status=@status, handled_at=SYSUTCDATETIME()
         WHERE id=@id AND target_user_id=@uid AND status='ringing'`,
      );
    return { ok: true };
  });

export const listOutgoingRoomCallUpdates = createServerFn({ method: "POST" })
  .inputValidator((input: { userId: string; sinceIso?: string }) => {
    const userId = sanitizeUserId(input?.userId);
    const sinceIso =
      typeof input?.sinceIso === "string" && !Number.isNaN(Date.parse(input.sinceIso))
        ? input.sinceIso
        : new Date(Date.now() - 120_000).toISOString();
    return { userId, sinceIso };
  })
  .handler(async ({ data }) => {
    const { getPool, sql, expireStaleCalls } = await import("@/integrations/db.server");
    const pool = await getPool();
    await expireStaleCalls(pool);

    const res = await pool
      .request()
      .input("uid", sql.NVarChar, data.userId)
      .input("since", sql.DateTime2, new Date(data.sinceIso))
      .query(
        `SELECT TOP 10 id, target_user_id, room_name, room_label, status, handled_at, created_at
           FROM dbo.room_call_events
          WHERE caller_user_id=@uid AND status IN ('declined','missed')
            AND handled_at >= @since
          ORDER BY handled_at DESC`,
      );
    return { calls: res.recordset ?? [] };
  });

export const purgeAllRooms = createServerFn({ method: "POST" }).handler(async () => {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !wsUrl) throw new Error("LiveKit não configurado");
  const httpUrl = wsUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
  const { RoomServiceClient } = await import("livekit-server-sdk");
  const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
  const rooms = await svc.listRooms();
  const names = rooms.map((r) => r.name);
  await Promise.all(
    names.map(async (n) => {
      try {
        await svc.deleteRoom(n);
      } catch {
        /* ignore */
      }
    }),
  );
  const { getPool } = await import("@/integrations/db.server");
  const pool = await getPool();
  await pool.request().query(`DELETE FROM dbo.room_knocks`);
  await pool.request().query(`DELETE FROM dbo.room_members`);
  await pool.request().query(`UPDATE dbo.room_state SET is_private=0, updated_at=SYSUTCDATETIME()`);
  return { deleted: names };
});

// ================= Room privacy / membership / knocks =================

function isDiretoriaRoom(roomName: string): boolean {
  return roomName === "diretoria" || roomName.startsWith("diretoria-");
}

export const getRoomAccess = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; userId: string }) => ({
    roomName: sanitizeRoomName(input?.roomName),
    userId: sanitizeUserId(input?.userId),
  }))
  .handler(async ({ data }) => {
    const { getPool, isRoomMember, getRoomIsPrivate, setRoomStatePrivacy, upsertMember } =
      await import("@/integrations/db.server");
    const pool = await getPool();
    const forcePrivate = isDiretoriaRoom(data.roomName);
    let isPrivateState = await getRoomIsPrivate(pool, data.roomName);
    const member = await isRoomMember(pool, data.roomName, data.userId);

    // Salas de diretoria são sempre privadas e precisam de linha em room_state.
    if (forcePrivate && !isPrivateState) {
      await setRoomStatePrivacy(pool, data.roomName, true, data.userId);
      isPrivateState = true;
    }
    const isPrivate = forcePrivate || !!isPrivateState;

    // Sala privada e vazia: admite o primeiro a chegar como membro.
    if (isPrivate && !member) {
      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;
      const wsUrl = process.env.LIVEKIT_URL;
      let empty = true;
      if (apiKey && apiSecret && wsUrl) {
        try {
          const httpUrl = wsUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
          const { RoomServiceClient } = await import("livekit-server-sdk");
          const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
          try {
            const parts = await svc.listParticipants(data.roomName);
            empty = !parts || parts.length === 0;
          } catch {
            empty = true;
          }
        } catch {
          empty = true;
        }
      }
      if (empty) {
        await upsertMember(pool, data.roomName, data.userId, data.userId);
        return { isPrivate, isMember: true, canJoin: true, pin: null, hasPin: false };
      }
    }
    return {
      isPrivate,
      isMember: member,
      canJoin: !isPrivate || member,
      pin: null,
      hasPin: false,
    };
  });

export const setRoomPrivacy = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; isPrivate: boolean; userId: string }) => ({
    roomName: sanitizeRoomName(input?.roomName),
    isPrivate: !!input?.isPrivate,
    userId: sanitizeUserId(input?.userId),
  }))
  .handler(async ({ data }) => {
    const { getPool, setRoomStatePrivacy, upsertMember } = await import("@/integrations/db.server");
    const pool = await getPool();
    const isPrivate = isDiretoriaRoom(data.roomName) || data.isPrivate;
    await setRoomStatePrivacy(pool, data.roomName, isPrivate, data.userId);
    if (isPrivate) {
      // Mantém quem já está conectado como membro (não expulsa ninguém).
      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;
      const wsUrl = process.env.LIVEKIT_URL;
      const memberIds = new Set<string>([data.userId]);
      if (apiKey && apiSecret && wsUrl) {
        try {
          const httpUrl = wsUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
          const { RoomServiceClient } = await import("livekit-server-sdk");
          const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
          const parts = await svc.listParticipants(data.roomName);
          for (const p of parts) {
            const uid = (p.identity || "").split("-")[0];
            if (uid && /^[a-zA-Z0-9_-]+$/.test(uid)) memberIds.add(uid);
          }
        } catch {
          /* ignore */
        }
      }
      for (const uid of memberIds) {
        await upsertMember(pool, data.roomName, uid, data.userId);
      }
    } else {
      // Sala reaberta: limpa pedidos e lista de membros.
      const { sql } = await import("@/integrations/db.server");
      await pool
        .request()
        .input("room", sql.NVarChar, data.roomName)
        .query(`DELETE FROM dbo.room_knocks WHERE room_name=@room`);
      await pool
        .request()
        .input("room", sql.NVarChar, data.roomName)
        .query(`DELETE FROM dbo.room_members WHERE room_name=@room`);
    }
    return { ok: true, pin: null };
  });

export const inviteToRoom = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; targetUserId: string; inviterUserId: string }) => ({
    roomName: sanitizeRoomName(input?.roomName),
    targetUserId: sanitizeUserId(input?.targetUserId),
    inviterUserId: sanitizeUserId(input?.inviterUserId),
  }))
  .handler(async ({ data }) => {
    const { getPool, upsertMember } = await import("@/integrations/db.server");
    const pool = await getPool();
    await upsertMember(pool, data.roomName, data.inviterUserId, data.inviterUserId);
    await upsertMember(pool, data.roomName, data.targetUserId, data.inviterUserId);
    return { ok: true };
  });

export const knockRoom = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; userId: string; userName: string }) => ({
    roomName: sanitizeRoomName(input?.roomName),
    userId: sanitizeUserId(input?.userId),
    userName:
      typeof input?.userName === "string" && input.userName.trim()
        ? input.userName.trim().slice(0, 80)
        : sanitizeUserId(input?.userId),
  }))
  .handler(async ({ data }) => {
    const { getPool, sql, isRoomMember } = await import("@/integrations/db.server");
    const pool = await getPool();
    if (await isRoomMember(pool, data.roomName, data.userId)) {
      return { status: "approved" as const, knockId: null };
    }
    // Reaproveita pedido pendente/aprovado se existir.
    const existing = await pool
      .request()
      .input("room", sql.NVarChar, data.roomName)
      .input("uid", sql.NVarChar, data.userId)
      .query(
        `SELECT TOP 1 id, status FROM dbo.room_knocks
          WHERE room_name=@room AND requester_user_id=@uid AND status IN ('pending','approved')
          ORDER BY created_at DESC`,
      );
    const ex = existing.recordset[0] as { id: string; status: "pending" | "approved" } | undefined;
    if (ex) return { status: ex.status, knockId: ex.id };

    const inserted = await pool
      .request()
      .input("room", sql.NVarChar, data.roomName)
      .input("uid", sql.NVarChar, data.userId)
      .input("name", sql.NVarChar, data.userName)
      .query(
        `INSERT INTO dbo.room_knocks (room_name, requester_user_id, requester_name)
         OUTPUT INSERTED.id VALUES (@room, @uid, @name)`,
      );
    return { status: "pending" as const, knockId: inserted.recordset[0].id as string };
  });

export const getKnockStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { knockId: string }) => {
    const id = typeof input?.knockId === "string" ? input.knockId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Pedido inválido");
    return { knockId: id };
  })
  .handler(async ({ data }) => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("id", sql.UniqueIdentifier, data.knockId)
      .query(`SELECT status FROM dbo.room_knocks WHERE id=@id`);
    const status = (r.recordset[0]?.status ?? "unknown") as
      | "pending"
      | "approved"
      | "denied"
      | "unknown";
    return { status };
  });

export const listRoomKnocks = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string }) => ({
    roomName: sanitizeRoomName(input?.roomName),
  }))
  .handler(async ({ data }) => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("room", sql.NVarChar, data.roomName)
      .query(
        `SELECT id, requester_user_id, requester_name, status, created_at
           FROM dbo.room_knocks
          WHERE room_name=@room AND status='pending'
          ORDER BY created_at ASC`,
      );
    return { knocks: r.recordset ?? [] };
  });

export const resolveKnock = createServerFn({ method: "POST" })
  .inputValidator((input: { knockId: string; approve: boolean; resolverUserId: string }) => {
    const id = typeof input?.knockId === "string" ? input.knockId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Pedido inválido");
    return {
      knockId: id,
      approve: !!input?.approve,
      resolverUserId: sanitizeUserId(input?.resolverUserId),
    };
  })
  .handler(async ({ data }) => {
    const { getPool, sql, upsertMember } = await import("@/integrations/db.server");
    const pool = await getPool();
    const kr = await pool
      .request()
      .input("id", sql.UniqueIdentifier, data.knockId)
      .query(
        `SELECT id, room_name, requester_user_id, status FROM dbo.room_knocks WHERE id=@id`,
      );
    const knock = kr.recordset[0] as
      | { id: string; room_name: string; requester_user_id: string; status: string }
      | undefined;
    if (!knock || knock.status !== "pending") return { ok: false };

    await pool
      .request()
      .input("id", sql.UniqueIdentifier, knock.id)
      .input("status", sql.NVarChar, data.approve ? "approved" : "denied")
      .input("by", sql.NVarChar, data.resolverUserId)
      .query(
        `UPDATE dbo.room_knocks
           SET status=@status, handled_by=@by, handled_at=SYSUTCDATETIME()
         WHERE id=@id`,
      );
    if (data.approve) {
      await upsertMember(pool, knock.room_name, knock.requester_user_id, data.resolverUserId);
    }
    return { ok: true };
  });

// Publica quem está falando para aparecer no card da sala.
export const updateActiveSpeakers = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; speakers: string[] }) => {
    const roomName = sanitizeRoomName(input?.roomName);
    const speakers = Array.isArray(input?.speakers)
      ? input.speakers
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim().slice(0, 80))
          .filter(Boolean)
          .slice(0, 20)
      : [];
    return { roomName, speakers };
  })
  .handler(async ({ data }) => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    await pool
      .request()
      .input("room", sql.NVarChar, data.roomName)
      .input("spk", sql.NVarChar(sql.MAX), JSON.stringify(data.speakers))
      .query(
        `IF EXISTS (SELECT 1 FROM dbo.room_state WHERE room_name=@room)
           UPDATE dbo.room_state SET active_speakers=@spk, speakers_updated_at=SYSUTCDATETIME() WHERE room_name=@room;
         ELSE
           INSERT INTO dbo.room_state (room_name, active_speakers, speakers_updated_at) VALUES (@room, @spk, SYSUTCDATETIME());`,
      );
    return { ok: true };
  });

// =============== External guest invites ===============
// Tokens curtos assinados com LIVEKIT_API_SECRET — sem linha no banco.

function base64UrlEncode(buf: ArrayBuffer | Uint8Array) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const s = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signGuestToken(payload: { r: string; e: number }, secret: string) {
  const enc = new TextEncoder();
  const body = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body) as BufferSource);
  return `${body}.${base64UrlEncode(sig)}`;
}

async function verifyGuestToken(token: string, secret: string): Promise<{ r: string; e: number } | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(sig) as BufferSource,
    enc.encode(body) as BufferSource,
  );
  if (!ok) return null;
  try {
    const dec = new TextDecoder().decode(base64UrlDecode(body));
    const parsed = JSON.parse(dec) as { r: string; e: number };
    if (typeof parsed?.r !== "string" || typeof parsed?.e !== "number") return null;
    if (parsed.e < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const createGuestInvite = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; inviterUserId: string; hours?: number }) => ({
    roomName: sanitizeRoomName(input?.roomName),
    inviterUserId: sanitizeUserId(input?.inviterUserId),
    hours: Math.max(1, Math.min(72, Math.floor(input?.hours ?? 24))),
  }))
  .handler(async ({ data }) => {
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!secret) throw new Error("LiveKit não configurado no servidor");
    const { getPool, upsertMember } = await import("@/integrations/db.server");
    const pool = await getPool();
    await upsertMember(pool, data.roomName, data.inviterUserId, data.inviterUserId);
    const exp = Math.floor(Date.now() / 1000) + data.hours * 3600;
    const token = await signGuestToken({ r: data.roomName, e: exp }, secret);
    return { token, expiresAt: exp };
  });

export const getGuestLiveKitToken = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; guestToken: string; name: string }) => {
    const roomName = sanitizeRoomName(input?.roomName);
    const guestToken =
      typeof input?.guestToken === "string" ? input.guestToken.trim().slice(0, 512) : "";
    if (!guestToken || !/^[A-Za-z0-9_\-.]+$/.test(guestToken)) {
      throw new Error("Convite inválido");
    }
    const name = (typeof input?.name === "string" ? input.name : "").trim().slice(0, 60);
    if (name.length < 2) throw new Error("Digite seu nome");
    return { roomName, guestToken, name };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) throw new Error("LiveKit não configurado no servidor");
    const verified = await verifyGuestToken(data.guestToken, apiSecret);
    if (!verified || verified.r !== data.roomName) {
      throw new Error("Convite expirado ou inválido");
    }
    const { AccessToken } = await import("livekit-server-sdk");
    const identity = `guest-${Math.random().toString(36).slice(2, 10)}`;
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: `${data.name} (convidado)`,
      ttl: 60 * 60 * 4,
    });
    at.addGrant({
      room: data.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();
    return { token, url, identity };
  });
