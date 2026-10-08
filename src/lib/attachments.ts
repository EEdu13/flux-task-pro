import type { Attachment } from "./fluxo-types";

export const MAX_ATT_BYTES = 3 * 1024 * 1024; // 3 MB

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function isImage(type: string): boolean {
  return type.startsWith("image/");
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(meta)?.[1] || "application/octet-stream";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * `dataUrl` carrega duas coisas hoje, e é preciso distinguir.
 *
 * Anexo recém-escolhido no seletor de arquivo é `data:<mime>;base64,...`.
 * Anexo que já está no Blob é `/api/anexo/<id>` — o endereço do nosso proxy.
 * Uma tag `<img>` não nota diferença, e é por isso que as telas de exibição não
 * precisaram mudar; quem precisa notar é quem lê os BYTES, aqui embaixo.
 *
 * Sem esta distinção, `dataUrlToBlob("/api/anexo/x")` fazia `atob` numa string
 * que não é base64 e lançava. No navegador o erro escapava; no app de mesa
 * caía no `catch` e o clique simplesmente não fazia nada — que é o que
 * acontecia ao tentar abrir um PDF do chat.
 */
function ehDataUrl(u: string): boolean {
  return u.startsWith("data:");
}

/** Os bytes do anexo, venha ele de onde vier. */
async function blobDoAnexo(dataUrl: string): Promise<Blob> {
  if (ehDataUrl(dataUrl)) return dataUrlToBlob(dataUrl);
  // Caminho relativo resolve contra a origem atual — que no app de mesa é o
  // mesmo site que a janela principal carrega.
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error(await motivoDaFalha(res));
  return res.blob();
}

/**
 * Por que o anexo não abriu, em português — o que a rota `/api/anexo` disse.
 *
 * Antes a falha ia só para o console, e quem clicava não via nada: "não abre"
 * era tudo o que dava para relatar (08/10/2026). As três respostas da rota
 * querem dizer coisas diferentes, e cada uma tem um conserto diferente.
 */
async function motivoDaFalha(res: Response): Promise<string> {
  if (res.status === 401) return "Sua sessão expirou. Entre de novo para abrir o anexo.";
  const texto = (await res.text().catch(() => "")).trim();
  if (texto === "anexo indisponível")
    return "O arquivo não pôde ser lido do armazenamento (Blob). Avise o TI.";
  if (res.status === 404) return "Anexo não encontrado, ou você não tem acesso a esta tarefa.";
  return `O anexo não abriu (${res.status}).`;
}

function avisarFalha(e: unknown) {
  console.error("Falha ao abrir anexo", e);
  void import("sonner").then(({ toast }) =>
    toast.error("Não foi possível abrir o anexo", {
      description: e instanceof Error ? e.message : undefined,
    }),
  );
}

// Abre o anexo. No app desktop (Tauri), grava um arquivo temporário e abre com
// o app padrão do Windows (visualizador de imagem, PDF…). No navegador, o
// window.open não funciona com data: URL grande, então usamos um blob URL.
export function openAttachment(a: { dataUrl: string; name: string }) {
  void (async () => {
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const bytes = new Uint8Array(await (await blobDoAnexo(a.dataUrl)).arrayBuffer());
        await invoke("open_attachment_file", { name: a.name, data: Array.from(bytes) });
        return;
      }
      /* No navegador também passa pelos bytes: abrir o endereço direto numa
         aba nova mostrava a página crua de erro ("anexo indisponível") sem
         dizer o que fazer, e no erro de rede não mostrava nada. Assim a falha
         vira aviso na própria tela. A janela é aberta ANTES da espera, no
         clique — aberta depois do `await`, o bloqueador de pop-up a barra. */
      const janela = window.open("", "_blank");
      try {
        const url = URL.createObjectURL(await blobDoAnexo(a.dataUrl));
        if (janela) janela.location.href = url;
        else window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (e) {
        janela?.close();
        throw e;
      }
    } catch (e) {
      avisarFalha(e);
    }
  })();
}

export function downloadAttachment(a: { dataUrl: string; name: string }) {
  void (async () => {
    try {
      const url = URL.createObjectURL(await blobDoAnexo(a.dataUrl));
      const link = document.createElement("a");
      link.href = url;
      link.download = a.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      avisarFalha(e);
    }
  })();
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export async function filesToAttachments(
  files: FileList | File[],
  userId: string,
): Promise<{ ok: Attachment[]; rejected: string[] }> {
  const arr = Array.from(files);
  const ok: Attachment[] = [];
  const rejected: string[] = [];
  for (const f of arr) {
    if (f.size > MAX_ATT_BYTES) {
      rejected.push(`${f.name} (> ${formatBytes(MAX_ATT_BYTES)})`);
      continue;
    }
    const dataUrl = await readAsDataUrl(f);
    ok.push({
      id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: f.name,
      size: f.size,
      type: f.type || "application/octet-stream",
      dataUrl,
      at: new Date().toISOString(),
      userId,
    });
  }
  return { ok, rejected };
}