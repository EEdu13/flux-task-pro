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