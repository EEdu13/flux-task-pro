import type { Attachment } from "./fluxo-types";

/**
 * Peças comuns do recado de voz e da gravação de tela (19/10/2026).
 *
 * O arquivo gravado NÃO vira base64 no estado do React: ele fica na memória do
 * navegador como `Blob`, e o anexo carrega o endereço local dele (`blob:...`)
 * no campo `dataUrl`. É o mesmo truque do `/api/anexo/<id>` — uma tag
 * `<audio>`/`<video>` toca os dois igual — e quem sobe o arquivo reconhece o
 * `blob:` e manda em pedaços (`subirArquivoEmPedacos`). Base64 de um vídeo de
 * 12 MB no estado seria 16 MB de texto indo parar no `localStorage`.
 */

export type GravacaoPronta = {
  arquivo: Blob;
  /** Tipo sem os codecs (`audio/webm`), que é o que o servidor guarda. */
  tipoMime: string;
  nome: string;
  segundos: number;
};

/** O primeiro formato da lista que este navegador sabe gravar. */
export function formatoSuportado(candidatos: string[]): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const c of candidatos) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* navegador antigo sem isTypeSupported: segue para o próximo */
    }
  }
  return null;
}

/** `video/webm;codecs=vp9,opus` → `video/webm`. */
export function semCodecs(mime: string): string {
  return mime.split(";")[0]!.trim().toLowerCase();
}

/** `recado-de-voz-2026-10-19-1432.webm` — data e hora LOCAIS, que é o que a pessoa reconhece. */
export function nomeComDataHora(prefixo: string, tipoMime: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ext = tipoMime.endsWith("/mp4")
    ? tipoMime.startsWith("audio/")
      ? "m4a"
      : "mp4"
    : tipoMime.endsWith("/ogg")
      ? "ogg"
      : "webm";
  return `${prefixo}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

/** `0:42`, `2:05`. */
export function formatarDuracao(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return "0:00";
  const s = Math.floor(segundos);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Vira um anexo pendente, apontando para o arquivo na memória do navegador. */
export function gravacaoComoAnexo(g: GravacaoPronta, userId: string): Attachment {
  return {
    id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: g.nome,
    size: g.arquivo.size,
    type: g.tipoMime,
    dataUrl: URL.createObjectURL(g.arquivo),
    at: new Date().toISOString(),
    userId,
  };
}

/**
 * Mensagem clara para quando o navegador recusa microfone, câmera ou tela.
 * O erro do navegador vem em inglês e não diz o que fazer.
 */
export function motivoDaRecusa(
  e: unknown,
  aparelho: "microfone" | "câmera" | "tela",
): {
  titulo: string;
  descricao: string;
} {
  const nome = (e as { name?: string })?.name ?? "";
  if (nome === "NotAllowedError" || nome === "SecurityError") {
    if (aparelho === "tela") {
      return {
        titulo: "Gravação de tela não iniciada",
        descricao:
          "A escolha da tela foi cancelada ou o navegador bloqueou. Clique em “Gravar tela” de novo e escolha a tela, janela ou aba.",
      };
    }
    return {
      titulo: `O ${aparelho} está bloqueado para este site`,
      descricao: `Clique no cadeado ao lado do endereço, libere o ${aparelho} e tente de novo.`,
    };
  }
  if (nome === "NotFoundError" || nome === "OverconstrainedError") {
    return {
      titulo: `Nenhum ${aparelho} encontrado`,
      descricao: `Confira se o ${aparelho} está ligado e conectado ao computador.`,
    };
  }
  if (nome === "NotReadableError" || nome === "AbortError") {
    return {
      titulo: `O ${aparelho} está ocupado`,
      descricao:
        "Outro programa (Teams, Zoom, uma reunião aberta) pode estar usando. Feche e tente de novo.",
    };
  }
  return {
    titulo: `Não foi possível usar o ${aparelho}`,
    descricao: e instanceof Error ? e.message : "Tente de novo.",
  };
}

/**
 * Relógio que não para em segundo plano.
 *
 * Quem grava a tela quase sempre está em OUTRA aba ou janela, e o navegador
 * reduz o `setInterval` da aba escondida a uma vez por segundo — o vídeo
 * composto sairia a 1 quadro por segundo. O relógio de um Worker não sofre
 * essa redução. Sem Worker (bloqueado), cai no `setInterval` comum.
 */
export function relogioDeFundo(intervaloMs: number, tique: () => void): () => void {
  try {
    const codigo = `setInterval(function(){postMessage(0)},${Math.max(10, Math.round(intervaloMs))});`;
    const url = URL.createObjectURL(new Blob([codigo], { type: "text/javascript" }));
    const w = new Worker(url);
    w.onmessage = tique;
    // O endereço só sai quando o Worker morre: soltar antes de ele carregar
    // faz alguns navegadores não acharem o código.
    return () => {
      w.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = window.setInterval(tique, intervaloMs);
    return () => window.clearInterval(id);
  }
}
