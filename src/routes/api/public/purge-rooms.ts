import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/purge-rooms")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const apiKey = process.env.LIVEKIT_API_KEY;
          const apiSecret = process.env.LIVEKIT_API_SECRET;
          const wsUrl = process.env.LIVEKIT_URL;
          if (!apiKey || !apiSecret || !wsUrl) {
            return new Response(JSON.stringify({ error: "LiveKit não configurado" }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
          }
          const httpUrl = wsUrl
            .replace(/^wss:\/\//, "https://")
            .replace(/^ws:\/\//, "http://");
          const { RoomServiceClient } = await import("livekit-server-sdk");
          const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
          const rooms = await svc.listRooms();
          const names = rooms.map((r) => r.name);
          const results: { name: string; ok: boolean; err?: string }[] = [];
          await Promise.all(
            names.map(async (n) => {
              try {
                await svc.deleteRoom(n);
                results.push({ name: n, ok: true });
              } catch (e) {
                results.push({ name: n, ok: false, err: String(e) });
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
          return new Response(JSON.stringify({ deleted: results }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: String(e) }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});