import { createServerFn } from "@tanstack/react-start";

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