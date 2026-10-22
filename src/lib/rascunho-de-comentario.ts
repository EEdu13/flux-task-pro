import type { Attachment } from "@/lib/fluxo-types";

/**
 * O rascunho do comentário de cada tarefa, guardado no navegador (22/10/2026:
 * o notebook da Milena desligou com arquivos já anexados num comentário ainda
 * não enviado, e ela teve de subir tudo de novo).
 *
 * Fica no IndexedDB, não no localStorage: os anexos chegam a 3 MB cada, em
 * base64, e o localStorage estoura com poucos. Gravação de recado de voz e de
 * tela (endereço `blob:`) não entra — ela vira comentário na hora e não fica
 * pendente. Qualquer falha aqui só deixa de guardar: o comentário funciona igual.
 */

type Rascunho = { texto: string; anexos: Attachment[]; em: number };

const BANCO = "fluxo-rascunhos";
const LOJA = "comentarios";
/** Rascunho esquecido há mais de 14 dias não volta. */
const VALIDADE_MS = 14 * 24 * 3600_000;

let abrindo: Promise<IDBDatabase> | null = null;
function abrir(): Promise<IDBDatabase> {
  abrindo ??= new Promise((resolver, rejeitar) => {
    const pedido = indexedDB.open(BANCO, 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(LOJA);
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => {
      abrindo = null;
      rejeitar(pedido.error);
    };
  });
  return abrindo;
}

const chave = (pessoa: string, tarefa: string) => `${pessoa}:${tarefa}`;

export async function lerRascunhoDeComentario(
  pessoa: string,
  tarefa: string,
): Promise<Rascunho | null> {
  try {
    const db = await abrir();
    const r = await new Promise<Rascunho | undefined>((resolver, rejeitar) => {
      const p = db.transaction(LOJA, "readonly").objectStore(LOJA).get(chave(pessoa, tarefa));
      p.onsuccess = () => resolver(p.result as Rascunho | undefined);
      p.onerror = () => rejeitar(p.error);
    });
    if (!r || Date.now() - r.em > VALIDADE_MS) return null;
    return r;
  } catch {
    return null;
  }
}

export async function guardarRascunhoDeComentario(
  pessoa: string,
  tarefa: string,
  texto: string,
  anexos: Attachment[],
): Promise<void> {
  try {
    const db = await abrir();
    const guardaveis = anexos.filter((a) => a.dataUrl.startsWith("data:"));
    const vazio = !texto.trim() && guardaveis.length === 0;
    await new Promise<void>((resolver, rejeitar) => {
      const loja = db.transaction(LOJA, "readwrite").objectStore(LOJA);
      const p = vazio
        ? loja.delete(chave(pessoa, tarefa))
        : loja.put(
            { texto, anexos: guardaveis, em: Date.now() } satisfies Rascunho,
            chave(pessoa, tarefa),
          );
      p.onsuccess = () => resolver();
      p.onerror = () => rejeitar(p.error);
    });
  } catch (e) {
    console.warn("[comentário] rascunho não foi guardado:", (e as Error)?.message);
  }
}
