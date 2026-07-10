import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";

type Line = { at: number; from: string; text: string };

export const summarizeMeeting = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      roomLabel: string;
      participants: string[];
      transcript: Line[];
      chat: Line[];
    }) => {
      if (!input || typeof input.roomLabel !== "string") throw new Error("input inválido");
      const roomLabel = input.roomLabel.slice(0, 120);
      const participants = Array.isArray(input.participants)
        ? input.participants.filter((p) => typeof p === "string").slice(0, 40)
        : [];
      const clean = (arr: unknown): Line[] =>
        Array.isArray(arr)
          ? arr
              .filter(
                (x): x is Line =>
                  !!x &&
                  typeof (x as Line).text === "string" &&
                  typeof (x as Line).from === "string" &&
                  typeof (x as Line).at === "number",
              )
              .slice(-400)
              .map((x) => ({
                at: x.at,
                from: x.from.slice(0, 80),
                text: x.text.slice(0, 800),
              }))
          : [];
      return {
        roomLabel,
        participants,
        transcript: clean(input.transcript),
        chat: clean(input.chat),
      };
    },
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY não configurado");
    const { createLovableGateway } = await import("./ai-gateway.server");
    const gateway = createLovableGateway(apiKey);

    const fmt = (l: Line) =>
      `[${new Date(l.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}] ${l.from}: ${l.text}`;
    const transcriptTxt = data.transcript.map(fmt).join("\n") || "(sem transcrição)";
    const chatTxt = data.chat.map(fmt).join("\n") || "(sem mensagens de chat)";

    const prompt = `Você é o assistente do Fluxo. Gere uma **ata objetiva em português (Brasil)** da reunião abaixo, em Markdown, com estas seções e nada mais:

## Ata — ${data.roomLabel}
**Participantes:** ${data.participants.join(", ") || "não identificados"}

### Resumo executivo
Um parágrafo curto (até 4 linhas) com o que foi discutido.

### Decisões tomadas
Lista com bullets. Se não houver decisões claras, escreva "Nenhuma decisão registrada.".

### Próximos passos / pendências
Lista com bullets no formato "- [ ] Ação — responsável (se citado)". Se não houver, escreva "Nenhuma pendência registrada.".

### Pontos de atenção
Lista curta com bullets — riscos, prazos, dependências.

Regras:
- Não invente informação que não esteja no material.
- Não repita a transcrição bruta.
- Se o material for insuficiente, diga isso e finalize.

### Transcrição (fala local dos participantes)
${transcriptTxt}

### Chat da sala
${chatTxt}`;

    try {
      const { text } = await generateText({
        model: gateway("openai/gpt-5.5"),
        prompt,
      });
      return { markdown: text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao gerar ata";
      throw new Error(msg);
    }
  });