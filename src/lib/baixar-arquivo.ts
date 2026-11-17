import { toast } from "sonner";
import { isTauri } from "@/lib/attachments";
import { gerarXlsx, TIPO_XLSX, type Aba } from "@/lib/planilha-xlsx";

/*
 * Baixar um arquivo GERADO NA TELA: planilha, PDF, ata em .md (05/11/2026).
 *
 * NAVEGADOR — o link de download com o arquivo em memória, como sempre foi.
 *
 * APP DE MESA — o WebView2 IGNORA esse link (relato de 09/10/2026; ver o
 * `?baixar` em `api/anexo.$id.tsx`): a tela dizia "baixada" e nada aparecia em
 * Downloads (caso da Priscila, 05/11/2026). Quem grava é o próprio app, que põe
 * em Downloads e devolve o caminho; o aviso mostra a pasta e oferece "Mostrar
 * na pasta". Tudo passa por `gravarNoApp`, que também serve aos anexos, ao
 * conversor e à gravação de reunião:
 * - app 0.2.3 em diante: o comando `salvar_arquivo` (`src-tauri/src/salvar.rs`),
 *   com o arquivo em pedaços de bytes, até 200 MB, e até 4 GB para áudio e vídeo
 *   (12/11/2026);
 * - app anterior: o `save_attachment_file`, com o arquivo como lista de números e
 *   o teto de 12 MB. O app se atualiza sozinho; até lá, o site fala com cada
 *   versão pelo comando que ela tem;
 * - app anterior à 0.2.2: não tem comando nenhum, e resta o link.
 *
 * Nunca lança: o que der errado vira aviso na tela, e a resposta diz se o
 * arquivo foi entregue.
 */

/** O que o app anterior à 0.2.3 grava: `ALLOWED_EXTS` daquela versão. */
export const EXTENSOES_DO_APP_ANTIGO: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "pdf",
  "txt",
  "csv",
  "md",
  "rtf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
]);

/** Áudio e vídeo, desde a 0.2.3: a gravação de reunião, o recado de voz, os vídeos anexados. */
const MIDIA: readonly string[] = ["webm", "mp4", "mov", "m4a", "mp3", "ogg", "wav"];

/** O que o app grava: `ALLOWED_EXTS` em `src-tauri/src/lib.rs`. */
export const EXTENSOES_DO_APP: ReadonlySet<string> = new Set([
  ...EXTENSOES_DO_APP_ANTIGO,
  ...MIDIA,
]);

/** Os tetos de `src-tauri/src/salvar.rs` e, no app anterior à 0.2.3, de `MAX_ATTACHMENT_BYTES`. */
export const LIMITE_DO_APP_BYTES = 200 * 1024 * 1024;
export const LIMITE_DE_MIDIA_NO_APP_BYTES = 4 * 1024 * 1024 * 1024;
export const LIMITE_DO_APP_ANTIGO_BYTES = 12 * 1024 * 1024;

/** Cada chamada ao `salvar_arquivo` leva um pedaço deste tamanho (o app recusa acima de 16 MB). */
const PEDACO_BYTES = 8 * 1024 * 1024;

/** "Ata Final.PDF" → "pdf". Sem ponto → "". */
function extensaoDoNome(nome: string): string {
  const ponto = nome.lastIndexOf(".");
  return ponto > 0 ? nome.slice(ponto + 1).toLowerCase() : "";
}

/** O maior arquivo com este nome que o app (0.2.3 em diante) grava. */
export function limiteNoApp(nome: string): number {
  return MIDIA.includes(extensaoDoNome(nome)) ? LIMITE_DE_MIDIA_NO_APP_BYTES : LIMITE_DO_APP_BYTES;
}

function emPalavras(bytes: number): string {
  const gb = 1024 * 1024 * 1024;
  return bytes >= gb ? `${Math.round(bytes / gb)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`;
}

/**
 * A frase de "grande demais para o app", conforme o app que a pessoa tem. `oQueFazer` fecha a
 * frase, em minúscula ("baixe pelo CONECTA no navegador.").
 */
export function fraseDeGrandeDemais(limite: number, oQueFazer: string): string {
  if (limite <= LIMITE_DO_APP_ANTIGO_BYTES) {
    return `Esta versão do app de mesa salva até 12 MB; a nova, que chega sozinha, salva até 200 MB. Por enquanto, ${oQueFazer}`;
  }
  return `O app de mesa salva até ${emPalavras(limite)}. ${oQueFazer.charAt(0).toUpperCase()}${oQueFazer.slice(1)}`;
}

/** "C:\Users\x\Downloads\planilha.xlsx" → "C:\Users\x\Downloads". */
export function pastaDe(caminho: string): string {
  return caminho.slice(0, Math.max(caminho.lastIndexOf("\\"), caminho.lastIndexOf("/")));
}

/** Abre o Explorer com o arquivo salvo selecionado (comando `show_in_folder` do app). */
export function mostrarNaPasta(caminho: string): void {
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("show_in_folder", { path: caminho }))
    .catch((e: unknown) => console.warn("[baixar] não abriu a pasta", e));
}

/**
 * O `invoke` rejeita com texto. "Comando não existe" ou "não liberado" = o app não tem
 * `comando` (é de antes dele), e a mensagem do Tauri traz o nome do comando. Um erro de outra
 * origem (a pasta Downloads que não abriu, "Access is denied" do Windows) não conta: cair no
 * link, que o WebView2 ignora, mostraria "baixado" sem ter salvo nada.
 */
export function semOComando(e: unknown, comando: string): boolean {
  const texto = String(e);
  return texto.includes(comando) && /not allowed|not found|denied|unknown/i.test(texto);
}

/** O app é anterior à 0.2.2: nem o comando antigo de salvar ele tem. */
export function semOComandoDeSalvar(e: unknown): boolean {
  return semOComando(e, "save_attachment_file");
}

/**
 * O resultado de `gravarNoApp`. Sem sucesso, o motivo:
 * - "tipo": o app não grava esta extensão;
 * - "grande": passa do teto do app que a pessoa tem (`limite`);
 * - "sem-comando": app anterior à 0.2.2, sem comando de salvar;
 * - "erro": o Windows ou o app recusou (`erro` traz o porquê).
 */
export type GravadoNoApp =
  | { ok: true; caminho: string }
  | { ok: false; motivo: "tipo" }
  | { ok: false; motivo: "sem-comando" }
  | { ok: false; motivo: "grande"; limite: number }
  | { ok: false; motivo: "erro"; erro: unknown };

/** Já se sabe que este app não tem o `salvar_arquivo` (é anterior à 0.2.3). */
let semSalvarArquivo = false;

/**
 * Grava `blob` em Downloads pelo app de mesa, sem nunca lançar. `progresso` (de 0 a 1) anda a
 * cada pedaço: a gravação de uma reunião pode passar de 1 GB.
 */
export async function gravarNoApp(
  nome: string,
  blob: Blob,
  progresso?: (fracao: number) => void,
): Promise<GravadoNoApp> {
  const { invoke } = await import("@tauri-apps/api/core");
  const extensao = extensaoDoNome(nome);
  if (!semSalvarArquivo) {
    if (!EXTENSOES_DO_APP.has(extensao)) return { ok: false, motivo: "tipo" };
    const limite = limiteNoApp(nome);
    if (blob.size > limite) return { ok: false, motivo: "grande", limite };
    try {
      return { ok: true, caminho: await gravarEmPedacos(invoke, nome, blob, progresso) };
    } catch (e) {
      if (!semOComando(e, "salvar_arquivo")) return { ok: false, motivo: "erro", erro: e };
      semSalvarArquivo = true;
    }
  }
  // App anterior à 0.2.3: o comando antigo, com o arquivo como lista de números.
  if (!EXTENSOES_DO_APP_ANTIGO.has(extensao)) return { ok: false, motivo: "tipo" };
  if (blob.size > LIMITE_DO_APP_ANTIGO_BYTES) {
    return { ok: false, motivo: "grande", limite: LIMITE_DO_APP_ANTIGO_BYTES };
  }
  try {
    const data = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const caminho = await invoke<string>("save_attachment_file", { name: nome, data });
    progresso?.(1);
    return { ok: true, caminho };
  } catch (e) {
    if (semOComandoDeSalvar(e)) return { ok: false, motivo: "sem-comando" };
    return { ok: false, motivo: "erro", erro: e };
  }
}

type Invoke = (typeof import("@tauri-apps/api/core"))["invoke"];

/** Manda o arquivo ao `salvar_arquivo`, um pedaço por chamada, e devolve o caminho em Downloads. */
async function gravarEmPedacos(
  invoke: Invoke,
  nome: string,
  blob: Blob,
  progresso?: (fracao: number) => void,
): Promise<string> {
  // Sem `crypto.randomUUID`: ele não existe no endereço de rede da empresa (http), que o dev usa.
  const envio = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const partes = Math.max(1, Math.ceil(blob.size / PEDACO_BYTES));
  try {
    let caminho = "";
    for (let i = 0; i < partes; i++) {
      const pedaco = await blob.slice(i * PEDACO_BYTES, (i + 1) * PEDACO_BYTES).arrayBuffer();
      const headers: Record<string, string> = {
        "x-envio": envio,
        "x-parte": String(i),
        "x-fim": i === partes - 1 ? "1" : "0",
      };
      if (i === 0) {
        headers["x-nome"] = encodeURIComponent(nome);
        headers["x-total"] = String(blob.size);
      }
      caminho = await invoke<string>("salvar_arquivo", pedaco, { headers });
      progresso?.((i + 1) / partes);
    }
    return caminho;
  } catch (e) {
    // O que já tinha chegado não serve mais: o app apaga.
    void invoke("salvar_arquivo", new Uint8Array(0), {
      headers: { "x-envio": envio, "x-cancelar": "1" },
    }).catch(() => {});
    throw e;
  }
}

function baixarComLink(nome: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Folga para o navegador começar a ler o arquivo antes de o endereço deixar de valer.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** O aviso de sucesso. Sem `titulo`, o navegador baixa calado, como antes; o app sempre avisa onde salvou. */
export type AvisoDoDownload = { titulo?: string };

/**
 * Entrega `blob` como o arquivo `nome` (com a extensão). Devolve `true` se foi entregue:
 * no navegador, o download pedido; no app de mesa, o arquivo gravado em Downloads.
 */
export async function baixarArquivo(
  nome: string,
  blob: Blob,
  aviso: AvisoDoDownload = {},
): Promise<boolean> {
  if (!isTauri()) {
    baixarComLink(nome, blob);
    if (aviso.titulo) toast.success(aviso.titulo);
    return true;
  }
  return salvarNoApp(nome, blob, aviso);
}

/** Gera a planilha (`planilha-xlsx.ts`) e baixa. `nome` sem extensão ou com ".xlsx". */
export function baixarXlsx(nome: string, abas: Aba[], aviso?: AvisoDoDownload): Promise<boolean> {
  const blob = new Blob([gerarXlsx(abas) as BlobPart], { type: TIPO_XLSX });
  return baixarArquivo(nome.toLowerCase().endsWith(".xlsx") ? nome : `${nome}.xlsx`, blob, aviso);
}

async function salvarNoApp(nome: string, blob: Blob, aviso: AvisoDoDownload): Promise<boolean> {
  const r = await gravarNoApp(nome, blob);
  if (r.ok) {
    const pasta = pastaDe(r.caminho);
    toast.success(aviso.titulo ?? `Baixado: ${r.caminho.slice(pasta.length + 1)}`, {
      duration: 10_000,
      description: `Salvo na pasta ${pasta}`,
      action: { label: "Mostrar na pasta", onClick: () => mostrarNaPasta(r.caminho) },
    });
    return true;
  }
  if (r.motivo === "tipo" || r.motivo === "sem-comando") {
    /* Tipo que o app não grava (nenhuma exportação de hoje cai aqui), ou app anterior à
       0.2.2, sem comando nenhum: resta o link, que o WebView2 pode ignorar — e o aviso diz
       isso, para a pessoa não procurar um arquivo que não veio. */
    baixarComLink(nome, blob);
    toast.success(aviso.titulo ?? `Baixando: ${nome}`, {
      duration: 15_000,
      description:
        r.motivo === "tipo"
          ? "Se nada aparecer em Downloads, baixe pelo CONECTA no navegador."
          : "Se nada aparecer em Downloads, atualize o app de mesa ou use o CONECTA no navegador.",
    });
    return true;
  }
  if (r.motivo === "grande") {
    toast.error(`${nome} ficou grande demais para o app`, {
      duration: 15_000,
      description: fraseDeGrandeDemais(r.limite, "baixe pelo CONECTA no navegador."),
    });
    return false;
  }
  console.warn("[baixar] o app não salvou", nome, r.erro);
  toast.error("O app não conseguiu salvar o arquivo", {
    duration: 15_000,
    description: `${nome}. Tente de novo, ou use o CONECTA pelo navegador.`,
  });
  return false;
}
