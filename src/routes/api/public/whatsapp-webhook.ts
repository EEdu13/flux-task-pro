import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/whatsapp-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const bodyText = await request.text();
        try {
          await processWebhook(bodyText);
        } catch (e) {
          console.error("[whatsapp-webhook] processing error:", e);
        }
        return new Response("ok", { status: 200 });
      },
      GET: async () =>
        new Response("whatsapp-webhook up", { status: 200 }),
    },
  },
});

async function processWebhook(rawBody: string) {
  console.log("[whatsapp-webhook] body received:", rawBody.slice(0, 500));
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn("[whatsapp-webhook] invalid JSON");
    return;
  }

  const data = payload?.data;
  if (!data) {
    console.log("[whatsapp-webhook] no data field");
    return;
  }

  // Ignore messages sent by us.
  if (data?.key?.fromMe === true) {
    console.log("[whatsapp-webhook] skipping fromMe");
    return;
  }

  const text: string | undefined =
    data?.message?.conversation ??
    data?.message?.extendedTextMessage?.text ??
    undefined;
  if (!text || !text.trim()) {
    console.log("[whatsapp-webhook] no text in message");
    return;
  }

  const remoteJid: string = data?.key?.remoteJid ?? "";
  const telefone = remoteJid.replace(/@s\.whatsapp\.net$/, "").replace(/@c\.us$/, "");

  const raw = text.trim();

  const { resolveWhatsAppContact, resolveUserByName, knownUsersForPrompt } =
    await import("@/lib/whatsapp-contacts");
  const { seedUsers } = await import("@/lib/fluxo-seed");

  const caller = resolveWhatsAppContact(telefone);
  const parsed = await extractTaskWithAI(raw, caller?.name ?? null, knownUsersForPrompt());

  if (!parsed?.title) {
    console.warn("[whatsapp-webhook] AI could not extract title, using raw text");
  }
  const titulo = (parsed?.title ?? raw).trim().slice(0, 200);

  // Resolve destinatário: hint da IA → usuário; senão o próprio caller.
  const assigneeUser = parsed?.assignee_hint
    ? resolveUserByName(parsed.assignee_hint, seedUsers)
    : null;
  const assigneeId = assigneeUser?.id ?? caller?.userId ?? null;
  const creatorId = caller?.userId ?? null;
  const assigneeName = assigneeUser?.name ?? caller?.name ?? null;

  console.log("[whatsapp-webhook] inserting", {
    titulo,
    telefone,
    creatorId,
    assigneeId,
    ai: parsed,
  });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: inserted, error } = await supabaseAdmin
    .from("tarefas")
    .insert({
      titulo,
      telefone,
      description: parsed?.description ?? null,
      assignee_user_id: assigneeId,
      creator_user_id: creatorId,
      due_date: parsed?.due_date_iso ?? null,
      recurring: parsed?.recurring ?? false,
      recurring_until: parsed?.recurring_until_iso ?? null,
      require_proof: parsed?.require_proof ?? false,
      priority: parsed?.priority ?? "media",
    })
    .select()
    .single();

  if (error) {
    console.error("[whatsapp-webhook] insert error:", error);
    return;
  }
  console.log("[whatsapp-webhook] inserted row id:", inserted?.id);

  // Confirmation reply via Evolution API.
  const evoUrl = process.env.EVOLUTION_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  const evoInstance = process.env.EVOLUTION_INSTANCE;

  if (!evoUrl || !evoKey || !evoInstance || !telefone) return;

  const parts: string[] = [];
  parts.push(assigneeName ? `Tarefa criada para ${assigneeName}` : "Tarefa criada");
  parts.push(`: ${titulo}`);
  if (parsed?.due_date_iso) {
    const d = new Date(parsed.due_date_iso);
    parts.push(`\n📅 ${d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`);
  }
  if (parsed?.recurring) parts.push("\n🔁 Recorrente");
  if (parsed?.require_proof) parts.push("\n📎 Exige comprovante");
  if (parsed?.priority && parsed.priority !== "media") {
    parts.push(`\nPrioridade ${parsed.priority}`);
  }

  const url = `${evoUrl.replace(/\/$/, "")}/message/sendText/${evoInstance}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: evoKey,
      },
      body: JSON.stringify({ number: telefone, text: parts.join("") }),
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

type ParsedTask = {
  title: string;
  description: string | null;
  assignee_hint: string | null;
  due_date_iso: string | null;
  recurring: boolean;
  recurring_until_iso: string | null;
  require_proof: boolean;
  priority: "alta" | "media" | "baixa";
};

async function extractTaskWithAI(
  message: string,
  callerName: string | null,
  usersList: string,
): Promise<ParsedTask | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    console.warn("[whatsapp-webhook] LOVABLE_API_KEY missing, skipping AI");
    return fallbackParse(message);
  }

  const today = new Date().toISOString();
  const system = `Você extrai UMA tarefa de uma mensagem curta em português (Brasil) vinda pelo WhatsApp.
Retorne SOMENTE JSON válido com este schema exato:
{
  "title": string (imperativo curto, sem "criar tarefa"),
  "description": string | null,
  "assignee_hint": string | null (nome/apelido do destinatário mencionado; null se for pra si mesmo — "pra mim", "eu", ou não mencionado),
  "due_date_iso": string | null (ISO 8601; null se não houver prazo. Interprete "amanhã", "sexta", "em 7 dias", "próxima semana", horários),
  "recurring": boolean (true se "recorrente", "toda semana", "diariamente", etc.),
  "recurring_until_iso": string | null,
  "require_proof": boolean (true se pedir comprovante, recibo, print, anexo),
  "priority": "alta" | "media" | "baixa"
}

Hoje é ${today}. Fuso America/Sao_Paulo.
Quem enviou: ${callerName ?? "desconhecido"}.
Usuários conhecidos (para resolver o destinatário quando mencionado):
${usersList}

Regras:
- Se a mensagem NÃO é criação de tarefa, retorne igualmente com title = mensagem original truncada.
- Nunca invente destinatário. Só preencha assignee_hint se estiver escrito.`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: message },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      console.error("[whatsapp-webhook] AI HTTP", res.status, await res.text().catch(() => ""));
      return fallbackParse(message);
    }
    const json = (await res.json()) as any;
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return fallbackParse(message);
    const parsed = JSON.parse(content) as Partial<ParsedTask>;
    return {
      title: (parsed.title ?? message).toString().trim(),
      description: parsed.description ?? null,
      assignee_hint: parsed.assignee_hint ?? null,
      due_date_iso: parsed.due_date_iso ?? null,
      recurring: Boolean(parsed.recurring),
      recurring_until_iso: parsed.recurring_until_iso ?? null,
      require_proof: Boolean(parsed.require_proof),
      priority:
        parsed.priority === "alta" || parsed.priority === "baixa"
          ? parsed.priority
          : "media",
    };
  } catch (e) {
    console.error("[whatsapp-webhook] AI error", e);
    return fallbackParse(message);
  }
}

function fallbackParse(message: string): ParsedTask {
  const raw = message.trim();
  const m =
    raw.match(
      /^\s*(?:crie|criar|cria|nova|novo|adicione|adicionar|add)\s+(?:a\s+|uma\s+|o\s+|um\s+)?tarefa[:\-\s]+(.+)$/i,
    ) ?? raw.match(/^\s*tarefa[:\-\s]+(.+)$/i);
  return {
    title: (m?.[1] ?? raw).trim(),
    description: null,
    assignee_hint: null,
    due_date_iso: null,
    recurring: false,
    recurring_until_iso: null,
    require_proof: false,
    priority: "media",
  };
}