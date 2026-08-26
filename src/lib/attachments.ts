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

// Abre o anexo. No app desktop (Tauri), grava um arquivo temporário e abre com
// o app padrão do Windows (visualizador de imagem, PDF…). No navegador, o
// window.open não funciona com data: URL grande, então usamos um blob URL.
export function openAttachment(a: { dataUrl: string; name: string }) {
  if (isTauri()) {
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const bytes = new Uint8Array(await dataUrlToBlob(a.dataUrl).arrayBuffer());
        await invoke("open_attachment_file", { name: a.name, data: Array.from(bytes) });
      } catch (e) {
        console.error("Falha ao abrir anexo no app nativo", e);
      }
    })();
    return;
  }
  const url = URL.createObjectURL(dataUrlToBlob(a.dataUrl));
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadAttachment(a: { dataUrl: string; name: string }) {
  const url = URL.createObjectURL(dataUrlToBlob(a.dataUrl));
  const link = document.createElement("a");
  link.href = url;
  link.download = a.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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