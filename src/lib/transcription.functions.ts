import { createServerFn } from "@tanstack/react-start";

/**
 * Speech-to-text via Lovable AI Gateway (openai/gpt-4o-transcribe).
 * Client sends a base64-encoded audio blob (webm/opus produced by MediaRecorder).
 */
export const transcribeSegment = createServerFn({ method: "POST" })
  .inputValidator((input: { audioBase64: string; mime: string; language?: string }) => {
    if (!input || typeof input.audioBase64 !== "string") throw new Error("input inválido");
    const audioBase64 = input.audioBase64;
    // ~2.5MB base64 cap (arbitrary safety)
    if (audioBase64.length > 3_500_000) throw new Error("Áudio muito grande");
    const mime = typeof input.mime === "string" ? input.mime : "audio/webm";
    const language =
      typeof input.language === "string" && input.language.length <= 5
        ? input.language
        : undefined;
    return { audioBase64, mime, language };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY não configurado");
    const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
    if (bytes.byteLength < 800) {
      // essentially silence / header only
      return { text: "" };
    }
    // Derive an extension from the mime so upstream infers format correctly.
    const mimeBase = data.mime.split(";")[0];
    const ext =
      mimeBase === "audio/mp4"
        ? "mp4"
        : mimeBase === "audio/mpeg"
          ? "mp3"
          : mimeBase === "audio/wav"
            ? "wav"
            : mimeBase === "audio/ogg"
              ? "ogg"
              : "webm";
    const form = new FormData();
    form.append("model", "openai/gpt-4o-transcribe");
    form.append("file", new Blob([bytes], { type: mimeBase }), `segment.${ext}`);
    if (data.language) form.append("language", data.language);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      if (res.status === 402) throw new Error("Créditos de IA esgotados");
      if (res.status === 429) throw new Error("IA ocupada — tenta de novo");
      throw new Error(`Falha na transcrição (${res.status}) ${t.slice(0, 200)}`);
    }
    const json = (await res.json().catch(() => ({}))) as { text?: string };
    return { text: typeof json.text === "string" ? json.text.trim() : "" };
  });