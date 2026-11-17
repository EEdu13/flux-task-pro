import type { EstadoDoEditor } from "./modelo";

/*
 * O rascunho do Editor de PDF (12/11/2026): o que a pessoa fez, guardado no NAVEGADOR
 * (IndexedDB) enquanto ela edita, e ligado ao PDF pelo conteúdo dele. Um F5, a aba fechada ou o
 * app que caiu não perdem mais o trabalho: abrir o mesmo PDF de novo oferece "Continuar de onde
 * parou". Nada sai do computador.
 *
 * - O estado (pequeno) é regravado a cada mudança, com uma espera curta. As imagens e os PDFs
 *   trazidos para dentro (grandes, e que não mudam) vão uma vez cada, numa loja à parte.
 * - O rascunho some ao salvar, ao sair sem salvar e depois de 7 dias.
 * - Sem IndexedDB (janela anônima de alguns navegadores), nada quebra: só não há rascunho.
 */

const BANCO = "conecta-editor-pdf";
const RASCUNHOS = "rascunhos";
const ANEXOS = "anexos";
const VALIDADE_MS = 7 * 24 * 3600 * 1000;

export type Rascunho = {
  chave: string;
  nome: string;
  quando: number;
  estado: EstadoDoEditor;
  /** As imagens que o estado usa (os bytes ficam nos anexos). */
  imagens: string[];
  /** Os nomes dos PDFs trazidos de fora, na ordem de `documentos` depois do 0, que é o próprio. */
  extras: string[];
};

export type ImagemDoRascunho = {
  bytes: Uint8Array;
  tipo: "png" | "jpg";
  largura: number;
  altura: number;
};

export type RascunhoAchado = {
  rascunho: Rascunho;
  imagens: Map<string, ImagemDoRascunho>;
  extras: { nome: string; bytes: Uint8Array }[];
};

type Anexo =
  | ({ chave: string; tipo: "imagem" } & Omit<ImagemDoRascunho, "tipo"> & {
        formato: "png" | "jpg";
      })
  | { chave: string; tipo: "pdf"; nome: string; bytes: Uint8Array };

let banco: Promise<IDBDatabase> | null = null;

function abrirBanco(): Promise<IDBDatabase> {
  banco ??= new Promise((ok, falha) => {
    const pedido = indexedDB.open(BANCO, 1);
    pedido.onupgradeneeded = () => {
      pedido.result.createObjectStore(RASCUNHOS, { keyPath: "chave" });
      pedido.result.createObjectStore(ANEXOS, { keyPath: "chave" });
    };
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => falha(pedido.error);
  });
  banco.catch(() => {
    banco = null; // na próxima, tenta de novo
  });
  return banco;
}

function terminar(t: IDBTransaction): Promise<void> {
  return new Promise((ok, falha) => {
    t.oncomplete = () => ok();
    t.onerror = () => falha(t.error);
    t.onabort = () => falha(t.error);
  });
}

function resultado<T>(p: IDBRequest<T>): Promise<T> {
  return new Promise((ok, falha) => {
    p.onsuccess = () => ok(p.result);
    p.onerror = () => falha(p.error);
  });
}

const chaveDaImagem = (chave: string, id: string) => `${chave}|img|${id}`;
const chaveDoPdf = (chave: string, indice: number) => `${chave}|pdf|${indice}`;
const todosOsAnexos = (chave: string) => IDBKeyRange.bound(`${chave}|`, `${chave}|\uffff`);

/**
 * A chave do PDF: o resumo SHA-256 do conteúdo, para o mesmo arquivo achar o rascunho mesmo
 * com outro nome. No endereço sem https (o dev pela rede) não há `crypto.subtle`: aí vai uma
 * conta mais simples, de amostras do arquivo.
 */
export async function chaveDoArquivo(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const resumo = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 0x811c9dc5;
  const passo = Math.max(1, Math.floor(bytes.length / 65536));
  for (let i = 0; i < bytes.length; i += passo) h = Math.imul(h ^ bytes[i]!, 16777619) >>> 0;
  return `simples-${bytes.length}-${h.toString(16)}`;
}

/** O rascunho deste PDF, se houver um com menos de 7 dias. */
export async function lerRascunho(chave: string): Promise<RascunhoAchado | null> {
  const db = await abrirBanco();
  const t = db.transaction([RASCUNHOS, ANEXOS], "readonly");
  const rascunho = (await resultado(t.objectStore(RASCUNHOS).get(chave))) as Rascunho | undefined;
  if (!rascunho || Date.now() - rascunho.quando > VALIDADE_MS) return null;
  const anexos = (await resultado(t.objectStore(ANEXOS).getAll(todosOsAnexos(chave)))) as Anexo[];
  const imagens = new Map<string, ImagemDoRascunho>();
  const extras: { nome: string; bytes: Uint8Array }[] = [];
  for (const id of rascunho.imagens) {
    const a = anexos.find((x) => x.chave === chaveDaImagem(chave, id));
    if (a?.tipo === "imagem") {
      imagens.set(id, { bytes: a.bytes, tipo: a.formato, largura: a.largura, altura: a.altura });
    }
  }
  for (let i = 0; i < rascunho.extras.length; i++) {
    const a = anexos.find((x) => x.chave === chaveDoPdf(chave, i + 1));
    // Um PDF de fora que não está mais lá: o rascunho não serve (as páginas dele sumiriam).
    if (a?.tipo !== "pdf") return null;
    extras.push({ nome: a.nome, bytes: a.bytes });
  }
  return { rascunho, imagens, extras };
}

/**
 * Grava o rascunho. `imagensNovas` e `extrasNovos` são só os que ainda não foram gravados (pelo
 * índice em `documentos`).
 */
export async function guardarRascunho(
  rascunho: Rascunho,
  imagensNovas: readonly [string, ImagemDoRascunho][],
  extrasNovos: readonly [number, { nome: string; bytes: Uint8Array }][],
): Promise<void> {
  const db = await abrirBanco();
  const t = db.transaction([RASCUNHOS, ANEXOS], "readwrite");
  const anexos = t.objectStore(ANEXOS);
  for (const [id, im] of imagensNovas) {
    const a: Anexo = {
      chave: chaveDaImagem(rascunho.chave, id),
      tipo: "imagem",
      bytes: im.bytes,
      formato: im.tipo,
      largura: im.largura,
      altura: im.altura,
    };
    anexos.put(a);
  }
  for (const [indice, d] of extrasNovos) {
    const a: Anexo = { chave: chaveDoPdf(rascunho.chave, indice), tipo: "pdf", ...d };
    anexos.put(a);
  }
  t.objectStore(RASCUNHOS).put(rascunho);
  await terminar(t);
}

/** Tira o rascunho deste PDF e tudo o que é dele. */
export async function apagarRascunho(chave: string): Promise<void> {
  const db = await abrirBanco();
  const t = db.transaction([RASCUNHOS, ANEXOS], "readwrite");
  t.objectStore(RASCUNHOS).delete(chave);
  t.objectStore(ANEXOS).delete(todosOsAnexos(chave));
  await terminar(t);
}

/** Tira os rascunhos com mais de 7 dias (de qualquer PDF). */
export async function limparVencidos(): Promise<void> {
  const db = await abrirBanco();
  const t = db.transaction([RASCUNHOS], "readonly");
  const todos = (await resultado(t.objectStore(RASCUNHOS).getAll())) as Rascunho[];
  for (const r of todos) {
    if (Date.now() - r.quando > VALIDADE_MS) await apagarRascunho(r.chave);
  }
}
