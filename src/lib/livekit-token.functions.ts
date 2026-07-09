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
    // Enforce privacy: if room is marked private, only allow members in.
    if (data.userId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: state } = await supabaseAdmin
        .from("room_state")
        .select("is_private")
        .eq("room_name", data.roomName)
        .maybeSingle();
      if (state?.is_private) {
        const { data: member } = await supabaseAdmin
          .from("room_members")
          .select("id")
          .eq("room_name", data.roomName)
          .eq("user_id", data.userId)
          .maybeSingle();
        if (!member) {
          throw new Error("Sala privada: peça para entrar antes.");
        }
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
    // For each sector, collect rooms named `${sector}` or `${sector}-<n>` with n>=2.
    const bySector: Record<
      string,
      { name: string; participants: { identity: string; name: string }[] }[]
    > = {};
    await Promise.all(
      data.sectors.map(async (sector) => {
        const matches = new Set<string>([sector]);
        const re = new RegExp(`^${sector}(?:-([2-9]|[1-9][0-9]))?$`);
        for (const r of liveRooms) if (re.test(r)) matches.add(r);
        const names = Array.from(matches).sort((a, b) =>
          a.localeCompare(b, "pt-BR", { numeric: true }),
        );
        const withParts = await Promise.all(
          names.map(async (name) => {
            try {
              const parts = await svc.listParticipants(name);
              return {
                name,
                participants: parts.map((p) => ({
                  identity: p.identity,
                  name: p.name || p.identity,
                })),
              };
            } catch {
              return { name, participants: [] };
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const expiresAt = new Date(Date.now() - 45_000).toISOString();
    await supabaseAdmin
      .from("room_call_events")
      .update({ status: "missed", handled_at: new Date().toISOString() })
      .eq("status", "ringing")
      .lt("created_at", expiresAt);

    const { data: call, error } = await supabaseAdmin
      .from("room_call_events")
      .insert({
        caller_user_id: data.callerUserId,
        target_user_id: data.targetUserId,
        room_name: data.roomName,
        room_label: data.roomLabel,
      })
      .select("id, caller_user_id, target_user_id, room_name, room_label, status, created_at")
      .single();

    if (error) throw new Error("Não foi possível chamar essa pessoa agora");
    return { call };
  });

export const listIncomingRoomCalls = createServerFn({ method: "POST" })
  .inputValidator((input: { userId: string }) => ({ userId: sanitizeUserId(input?.userId) }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const expiresAt = new Date(Date.now() - 45_000).toISOString();
    await supabaseAdmin
      .from("room_call_events")
      .update({ status: "missed", handled_at: new Date().toISOString() })
      .eq("status", "ringing")
      .lt("created_at", expiresAt);

    const { data: calls, error } = await supabaseAdmin
      .from("room_call_events")
      .select("id, caller_user_id, target_user_id, room_name, room_label, status, created_at")
      .eq("target_user_id", data.userId)
      .eq("status", "ringing")
      .gte("created_at", expiresAt)
      .order("created_at", { ascending: false })
      .limit(3);

    if (error) throw new Error("Não foi possível buscar chamadas");
    return { calls: calls ?? [] };
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("room_call_events")
      .update({ status: data.status, handled_at: new Date().toISOString() })
      .eq("id", data.callId)
      .eq("target_user_id", data.userId)
      .eq("status", "ringing");

    if (error) throw new Error("Não foi possível atualizar a chamada");
    return { ok: true };
  });

// ================= Room privacy / membership / knocks =================

export const getRoomAccess = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; userId: string }) => ({
    roomName: sanitizeRoomName(input?.roomName),
    userId: sanitizeUserId(input?.userId),
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: state }, { data: member }] = await Promise.all([
      supabaseAdmin
        .from("room_state")
        .select("is_private")
        .eq("room_name", data.roomName)
        .maybeSingle(),
      supabaseAdmin
        .from("room_members")
        .select("id")
        .eq("room_name", data.roomName)
        .eq("user_id", data.userId)
        .maybeSingle(),
    ]);
    const isPrivate = !!state?.is_private;
    return { isPrivate, isMember: !!member, canJoin: !isPrivate || !!member };
  });

export const setRoomPrivacy = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; isPrivate: boolean; userId: string }) => ({
    roomName: sanitizeRoomName(input?.roomName),
    isPrivate: !!input?.isPrivate,
    userId: sanitizeUserId(input?.userId),
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("room_state").upsert(
      {
        room_name: data.roomName,
        is_private: data.isPrivate,
        updated_by: data.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "room_name" },
    );
    if (data.isPrivate) {
      // caller becomes a member automatically
      await supabaseAdmin
        .from("room_members")
        .upsert(
          { room_name: data.roomName, user_id: data.userId, added_by: data.userId },
          { onConflict: "room_name,user_id" },
        );
    } else {
      // room reopened: wipe pending knocks and member list
      await supabaseAdmin.from("room_knocks").delete().eq("room_name", data.roomName);
      await supabaseAdmin.from("room_members").delete().eq("room_name", data.roomName);
    }
    return { ok: true };
  });

export const inviteToRoom = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; targetUserId: string; inviterUserId: string }) => ({
    roomName: sanitizeRoomName(input?.roomName),
    targetUserId: sanitizeUserId(input?.targetUserId),
    inviterUserId: sanitizeUserId(input?.inviterUserId),
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // inviter must already be a member (or room open)
    await supabaseAdmin
      .from("room_members")
      .upsert(
        { room_name: data.roomName, user_id: data.inviterUserId, added_by: data.inviterUserId },
        { onConflict: "room_name,user_id" },
      );
    await supabaseAdmin
      .from("room_members")
      .upsert(
        { room_name: data.roomName, user_id: data.targetUserId, added_by: data.inviterUserId },
        { onConflict: "room_name,user_id" },
      );
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // if already member, nothing to do
    const { data: member } = await supabaseAdmin
      .from("room_members")
      .select("id")
      .eq("room_name", data.roomName)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (member) return { status: "approved" as const, knockId: null };

    // reuse latest still-pending knock, else insert
    const { data: existing } = await supabaseAdmin
      .from("room_knocks")
      .select("id, status")
      .eq("room_name", data.roomName)
      .eq("requester_user_id", data.userId)
      .in("status", ["pending", "approved"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing)
      return { status: existing.status as "pending" | "approved", knockId: existing.id };

    const { data: inserted, error } = await supabaseAdmin
      .from("room_knocks")
      .insert({
        room_name: data.roomName,
        requester_user_id: data.userId,
        requester_name: data.userName,
      })
      .select("id")
      .single();
    if (error) throw new Error("Não foi possível pedir para entrar");
    return { status: "pending" as const, knockId: inserted.id };
  });

export const getKnockStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { knockId: string }) => {
    const id = typeof input?.knockId === "string" ? input.knockId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Pedido inválido");
    return { knockId: id };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: k } = await supabaseAdmin
      .from("room_knocks")
      .select("status")
      .eq("id", data.knockId)
      .maybeSingle();
    return { status: (k?.status ?? "unknown") as "pending" | "approved" | "denied" | "unknown" };
  });

export const listRoomKnocks = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string }) => ({
    roomName: sanitizeRoomName(input?.roomName),
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: knocks } = await supabaseAdmin
      .from("room_knocks")
      .select("id, requester_user_id, requester_name, status, created_at")
      .eq("room_name", data.roomName)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    return { knocks: knocks ?? [] };
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: knock } = await supabaseAdmin
      .from("room_knocks")
      .select("id, room_name, requester_user_id, status")
      .eq("id", data.knockId)
      .maybeSingle();
    if (!knock || knock.status !== "pending") return { ok: false };
    await supabaseAdmin
      .from("room_knocks")
      .update({
        status: data.approve ? "approved" : "denied",
        handled_by: data.resolverUserId,
        handled_at: new Date().toISOString(),
      })
      .eq("id", knock.id);
    if (data.approve) {
      await supabaseAdmin.from("room_members").upsert(
        {
          room_name: knock.room_name,
          user_id: knock.requester_user_id,
          added_by: data.resolverUserId,
        },
        { onConflict: "room_name,user_id" },
      );
    }
    return { ok: true };
  });
