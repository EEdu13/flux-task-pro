import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/whatsapp-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Always ACK fast; process in background so Evolution doesn't retry.
        const bodyText = await request.text();
        processWebhook(bodyText).catch((e) =>
          console.error("[whatsapp-webhook] processing error:", e),
        );
        return new Response("ok", { status: 200 });
      },
      GET: async () =>
        new Response("whatsapp-webhook up", { status: 200 }),
    },
  },
});

async function processWebhook(rawBody: string) {
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn("[whatsapp-webhook] invalid JSON");
    return;
  }

  const data = payload?.data;
  if (!data) return;

  // Ignore messages sent by us.
  if (data?.key?.fromMe === true) return;

  const text: string | undefined =
    data?.message?.conversation ??
    data?.message?.extendedTextMessage?.text ??
    undefined;
  if (!text || !text.trim()) return;

  const remoteJid: string = data?.key?.remoteJid ?? "";
  const telefone = remoteJid.replace(/@s\.whatsapp\.net$/, "").replace(/@c\.us$/, "");

  const titulo = text.trim();

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("tarefas")
    .insert({ titulo, telefone });

  if (error) {
    console.error("[whatsapp-webhook] insert error:", error);
    return;
  }

  // Confirmation reply via Evolution API.
  const evoUrl = process.env.EVOLUTION_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  const evoInstance = process.env.EVOLUTION_INSTANCE;

  if (!evoUrl || !evoKey || !evoInstance || !telefone) return;

  const url = `${evoUrl.replace(/\/$/, "")}/message/sendText/${evoInstance}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: evoKey,
      },
      body: JSON.stringify({
        number: telefone,
        text: `✅ Tarefa criada: ${titulo}`,
      }),
    });
    if (!res.ok) {
      console.error(
        "[whatsapp-webhook] evolution reply failed:",
        res.status,
        await res.text().catch(() => ""),
      );
    }
  } catch (e) {
    console.error("[whatsapp-webhook] evolution reply error:", e);
  }
}