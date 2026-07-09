import { createServerFn } from "@tanstack/react-start";

type RoomCallStatus = "ringing" | "accepted" | "declined" | "missed";

const sanitizeUserId = (value: unknown) => {
  if (typeof value !== "string") throw new Error("Usuário inválido");
  const id = value.trim().slice(0, 80);
  if (!id || !/^[a-zA-Z0-9_\-]+$/.test(id)) throw new Error("Usuário inválido");
  return id;
};

const sanitizeRoomName = (value: unknown) => {
  if (typeof value !== "string") throw new Error("Sala inválida");
  const roomName = value.trim().slice(0, 64);
  if (!roomName || !/^[a-zA-Z0-9_\-]+$/.test(roomName)) throw new Error("Nome de sala inválido");
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
    if (!/^[a-zA-Z0-9_\-]+$/.test(roomName)) throw new Error("Nome de sala inválido");
    return { roomName, identity, name };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) {
      throw new Error("LiveKit não configurado no servidor");
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
      .filter((r) => typeof r === "string" && /^[a-zA-Z0-9_\-]+$/.test(r))
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

export const createRoomCall = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { callerUserId: string; targetUserId: string; roomName: string; roomLabel: string }) => {
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
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(callId)) {
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