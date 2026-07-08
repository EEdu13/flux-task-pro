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