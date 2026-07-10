import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";

export interface NoteTaskSuggestion {
  title: string;
  priority: "alta" | "media" | "baixa";
  dueInDays: number;
  reason?: string;
}

export const suggestTasksFromNote = createServerFn({ method: "POST" })
  .inputValidator((input: { title: string; content: string }) => {
    if (!input || typeof input.content !== "string") throw new Error("input inválido");
    return {
      title: (input.title ?? "Nota").toString().slice(0, 120),
      content: input.content.slice(0, 8000),
    };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY não configurado");
    const { createLovableGateway } = await import("./ai-gateway.server");
    const gateway = createLovableGateway(apiKey);

    const prompt = `Você é o assistente do Fluxo. Leia a nota abaixo (título: "${data.title}") e extraia **tarefas acionáveis**. Retorne SOMENTE JSON válido no formato:
{"suggestions":[{"title":"...","priority":"alta|media|baixa","dueInDays":0,"reason":"por que"}, ...]}

Regras:
- Máximo 8 sugestões, foque nas mais importantes.
- "title" no imperativo, curto (até 80 chars), em português.
- "priority": "alta" para urgências/prazos apertados, "baixa" para ideias.
- "dueInDays": 0=hoje, 1=amanhã, 7=uma semana. Estime pelo contexto.
- Se não houver nada acionável, retorne {"suggestions":[]}.
- Não invente informação fora da nota.

Nota:
---
${data.content}
---

Responda somente com o JSON, sem crases, sem prefácio.`;

    try {
      const { text } = await generateText({
        model: gateway("openai/gpt-5.5"),
        prompt,
      });
      const cleaned = text
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim();
      let parsed: { suggestions?: NoteTaskSuggestion[] } = {};
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      }
      const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
      const safe: NoteTaskSuggestion[] = suggestions
        .filter((s) => s && typeof s.title === "string")
        .slice(0, 8)
        .map((s) => ({
          title: s.title.slice(0, 120),
          priority:
            s.priority === "alta" || s.priority === "baixa" ? s.priority : "media",
          dueInDays: Math.max(0, Math.min(60, Number(s.dueInDays) || 1)),
          reason: typeof s.reason === "string" ? s.reason.slice(0, 200) : undefined,
        }));
      return { suggestions: safe };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao analisar nota";
      throw new Error(msg);
    }
  });