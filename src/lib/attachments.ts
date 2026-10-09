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

export function isTauri(): boolean {
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
export async function blobDoAnexo(dataUrl: string): Promise<Blob> {
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

/** Evento que a `PreviaDoAnexoHost` (montada na raiz) escuta. */
export const EVENTO_PREVIA = "fluxo:previa-anexo";
export type AnexoParaPrevia = { dataUrl: string; name: string; type?: string; size?: number };

/**
 * Abre o anexo numa PRÉVIA dentro do app (imagem, PDF e texto aparecem ali;
 * o resto mostra o cartão do arquivo), com "Baixar" e, no app de mesa,
 * "Abrir no programa". Pedido do usuário, 09/10/2026: abrir direto no
 * programa do Windows piscava janelas de terminal e jogava a pessoa para fora.
 */
export function openAttachment(a: AnexoParaPrevia) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AnexoParaPrevia>(EVENTO_PREVIA, { detail: a }));
}

/** App de mesa: grava num temporário e abre no programa padrão do Windows. */
export function abrirNoPrograma(a: { dataUrl: string; name: string }) {
  void (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const bytes = new Uint8Array(await (await blobDoAnexo(a.dataUrl)).arrayBuffer());
      const data = Array.from(bytes);
      try {
        await invoke("open_attachment_file", { name: a.name, data });
      } catch (e) {
        /* "os error 32": a cópia anterior ainda está aberta no Excel/leitor
           e o Windows trava o arquivo. Grava com outro nome e abre esse. */
        if (!/os error 32|being used|sendo usado/i.test(String(e))) throw e;
        await invoke("open_attachment_file", { name: comSufixo(a.name), data });
      }
    } catch (e) {
      avisarFalha(e);
    }
  })();
}

function comSufixo(nome: string): string {
  const ponto = nome.lastIndexOf(".");
  const n = Date.now() % 100000;
  return ponto > 0 ? `${nome.slice(0, ponto)} (${n})${nome.slice(ponto)}` : `${nome} (${n})`;
}

/**
 * Baixa o anexo e AVISA onde ele foi parar (pedido do usuário, 09/10/2026).
 *
 * No app de mesa a 0.2.2 grava direto em Downloads pelo comando
 * `save_attachment_file` e devolve o caminho — o aviso mostra o caminho e
 * oferece "Mostrar na pasta". O app instalado antes da 0.2.2 não tem o
 * comando: aí cai no "abrir no programa", de onde a pessoa salva.
 *
 * No navegador o download é do próprio navegador, que não conta o caminho;
 * o aviso diz o nome e a pasta de costume.
 */
/** Download comum (attachment) pelo endereço do servidor — ver `?baixar` em `api/anexo.$id`. */
function baixarPeloServidor(endereco: string) {
  const link = document.createElement("a");
  link.href = `${endereco}${endereco.includes("?") ? "&" : "?"}baixar=1`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function downloadAttachment(a: { dataUrl: string; name: string }) {
  void (async () => {
    const { toast } = await import("sonner");
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const data = Array.from(new Uint8Array(await (await blobDoAnexo(a.dataUrl)).arrayBuffer()));
        let caminho: string;
        try {
          caminho = await invoke<string>("save_attachment_file", { name: a.name, data });
        } catch (e) {
          if (/not allowed|not found|unknown|denied|permiss/i.test(String(e))) {
            /* App instalado antes da 0.2.2 (sem o comando). O download comum
               do servidor ele entende: o WebView2 grava em Downloads e mostra
               o próprio balão. Só o anexo recém-escolhido, que ainda não subiu
               (data:), não tem endereço — esse abre no programa. */
            if (!ehDataUrl(a.dataUrl)) {
              baixarPeloServidor(a.dataUrl);
              toast.success(`Baixando: ${a.name}`, {
                description: "O arquivo vai para a pasta Downloads do computador.",
                duration: 6000,
              });
            } else {
              abrirNoPrograma(a);
            }
            return;
          }
          throw e;
        }
        const pasta = caminho.slice(
          0,
          Math.max(caminho.lastIndexOf("\\"), caminho.lastIndexOf("/")),
        );
        toast.success(`Baixado: ${caminho.slice(pasta.length + 1)}`, {
          description: `Salvo na pasta ${pasta}`,
          duration: 8000,
          action: {
            label: "Mostrar na pasta",
            onClick: () => void invoke("show_in_folder", { path: caminho }).catch(avisarFalha),
          },
        });
        return;
      }
      const url = URL.createObjectURL(await blobDoAnexo(a.dataUrl));
      const link = document.createElement("a");
      link.href = url;
      link.download = a.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success(`Baixado: ${a.name}`, {
        description: "Está na pasta de downloads do navegador (normalmente “Downloads”).",
        duration: 6000,
      });
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
