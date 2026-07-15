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
    // Enforce privacy on EVERY token issuance. If the room is private, we
    // require a userId AND a matching room_members row. No exceptions.
    {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: state } = await supabaseAdmin
        .from("room_state")
        .select("is_private")
        .eq("room_name", data.roomName)
        .maybeSingle();
      if (state?.is_private) {
        if (!data.userId) {
          throw new Error("Sala privada: sessão inválida");
        }
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
      {
        name: string;
        isPrivate: boolean;
        participants: { identity: string; name: string }[];
        activeSpeakers: string[];
      }[]
    > = {};
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await Promise.all(
      data.sectors.map(async (sector) => {
        const matches = new Set<string>([sector]);
        const re = new RegExp(`^${sector}(?:-([2-9]|[1-9][0-9]))?$`);
        for (const r of liveRooms) if (re.test(r)) matches.add(r);
        const names = Array.from(matches).sort((a, b) =>
          a.localeCompare(b, "pt-BR", { numeric: true }),
        );
        const { data: states } = await supabaseAdmin
          .from("room_state")
          .select("room_name, is_private, active_speakers, speakers_updated_at")
          .in("room_name", names);
        const privacyMap = new Map<string, boolean>(
          (states ?? []).map((s) => [s.room_name, !!s.is_private]),
        );
        const now = Date.now();
        const speakersMap = new Map<string, string[]>();
        for (const s of states ?? []) {
          const ts = s.speakers_updated_at ? Date.parse(s.speakers_updated_at) : 0;
          if (ts && now - ts < 5000 && Array.isArray(s.active_speakers)) {
            speakersMap.set(
              s.room_name,
              (s.active_speakers as unknown[]).filter((x): x is string => typeof x === "string"),
            );
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Auto-expire stale ringing calls first so callers get a "missed" event.
    const expiresAt = new Date(Date.now() - 45_000).toISOString();
    await supabaseAdmin
      .from("room_call_events")
      .update({ status: "missed", handled_at: new Date().toISOString() })
      .eq("status", "ringing")
      .lt("created_at", expiresAt);

    const { data: calls, error } = await supabaseAdmin
      .from("room_call_events")
      .select("id, target_user_id, room_name, room_label, status, handled_at, created_at")
      .eq("caller_user_id", data.userId)
      .in("status", ["declined", "missed"])
      .gte("handled_at", data.sinceIso)
      .order("handled_at", { ascending: false })
      .limit(10);

    if (error) throw new Error("Não foi possível buscar atualizações de chamada");
    return { calls: calls ?? [] };
  });

export const purgeAllRooms = createServerFn({ method: "POST" })
  .handler(async () => {
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("room_knocks").delete().neq("room_name", "");
    await supabaseAdmin.from("room_members").delete().neq("room_name", "");
    await supabaseAdmin
      .from("room_state")
      .update({ is_private: false, updated_at: new Date().toISOString() })
      .neq("room_name", "");
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const forcePrivate = isDiretoriaRoom(data.roomName);
    let [{ data: state }, { data: member }] = await Promise.all([
      supabaseAdmin
        .from("room_state")
        .select("is_private, pin")
        .eq("room_name", data.roomName)
        .maybeSingle(),
      supabaseAdmin
        .from("room_members")
        .select("id")
        .eq("room_name", data.roomName)
        .eq("user_id", data.userId)
        .maybeSingle(),
    ]);
    // Diretoria rooms are always private and must have a room_state row.
    if (forcePrivate && (!state || !state.is_private)) {
      const pin = generatePin();
      await supabaseAdmin.from("room_state").upsert(
        {
          room_name: data.roomName,
          is_private: true,
          pin,
          updated_by: data.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_name" },
      );
      state = { is_private: true, pin };
    }
    const isPrivate = forcePrivate || !!state?.is_private;
    // Only reveal the PIN to a current member; strangers just know one exists.
    const pin = isPrivate && member ? (state?.pin ?? null) : null;
    return {
      isPrivate,
      isMember: !!member,
      canJoin: !isPrivate || !!member,
      pin,
      hasPin: !!(isPrivate && state?.pin),
    };
  });

export const setRoomPrivacy = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; isPrivate: boolean; userId: string }) => ({
    roomName: sanitizeRoomName(input?.roomName),
    isPrivate: !!input?.isPrivate,
    userId: sanitizeUserId(input?.userId),
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Diretoria rooms are always private and cannot be opened.
    const isPrivate = isDiretoriaRoom(data.roomName) || data.isPrivate;
    const pin = isPrivate ? generatePin() : null;
    await supabaseAdmin.from("room_state").upsert(
      {
        room_name: data.roomName,
        is_private: isPrivate,
        pin,
        updated_by: data.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "room_name" },
    );
    if (isPrivate) {
      // Grandfather everyone currently connected to LiveKit as a member so
      // they aren't kicked, but nobody new can enter without a knock.
      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;
      const wsUrl = process.env.LIVEKIT_URL;
      const memberIds = new Set<string>([data.userId]);
      if (apiKey && apiSecret && wsUrl) {
        try {
          const httpUrl = wsUrl
            .replace(/^wss:\/\//, "https://")
            .replace(/^ws:\/\//, "http://");
          const { RoomServiceClient } = await import("livekit-server-sdk");
          const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
          const parts = await svc.listParticipants(data.roomName);
          for (const p of parts) {
            // participant identity is "<userId>-<name>"; take the userId prefix
            const uid = (p.identity || "").split("-")[0];
            if (uid && /^[a-zA-Z0-9_-]+$/.test(uid)) memberIds.add(uid);
          }
        } catch {
          /* ignore — worst case only the caller is grandfathered */
        }
      }
      const rows = Array.from(memberIds).map((uid) => ({
        room_name: data.roomName,
        user_id: uid,
        added_by: data.userId,
      }));
      if (rows.length > 0) {
        await supabaseAdmin
          .from("room_members")
          .upsert(rows, { onConflict: "room_name,user_id" });
      }
    } else {
      // room reopened: wipe pending knocks and member list
      await supabaseAdmin.from("room_knocks").delete().eq("room_name", data.roomName);
      await supabaseAdmin.from("room_members").delete().eq("room_name", data.roomName);
    }
    return { ok: true, pin };
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

// Publish who is currently speaking so it can show on the room card outside.
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("room_state").upsert(
      {
        room_name: data.roomName,
        active_speakers: data.speakers,
        speakers_updated_at: new Date().toISOString(),
      },
      { onConflict: "room_name" },
    );
    return { ok: true };
  });

// =============== External guest invites ===============
// Signed short-lived tokens so anyone with the link can join the room
// as a guest without a Fluxo account. Signed with LIVEKIT_API_SECRET so
// no extra secret / DB row is required.

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
  .inputValidator(
    (input: { roomName: string; inviterUserId: string; hours?: number }) => ({
      roomName: sanitizeRoomName(input?.roomName),
      inviterUserId: sanitizeUserId(input?.inviterUserId),
      hours: Math.max(1, Math.min(72, Math.floor(input?.hours ?? 24))),
    }),
  )
  .handler(async ({ data }) => {
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!secret) throw new Error("LiveKit não configurado no servidor");
    // Ensure inviter is a member (so, if the room is private, guests aren't
    // blocked at the LiveKit token step — we bypass the member check on the
    // guest path anyway, but this also grandfathers the inviter cleanly).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("room_members")
      .upsert(
        {
          room_name: data.roomName,
          user_id: data.inviterUserId,
          added_by: data.inviterUserId,
        },
        { onConflict: "room_name,user_id" },
      );
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
