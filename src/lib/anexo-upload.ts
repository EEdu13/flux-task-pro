import { toast } from "sonner";
import type { Attachment } from "./fluxo-types";

/**
 * Sobe anexo para o Blob — a ponte que faltava entre a tela e `enviarAnexo`.
 *
 * A infraestrutura existia inteira e só o chat a usava. Tarefa, comentário e
 * projeto guardavam o arquivo como base64 dentro do estado do React, que vai
 * para o `localStorage` — ou seja, o anexo existia só naquela máquina, ninguém
 * mais via, e sumia ao trocar de computador. O banco confirmava: dos anexos
 * gravados, todos eram de mensagem de chat e nenhum de tarefa, comentário ou
 * projeto.
 *
 * O campo continua se chamando `dataUrl` de propósito, e agora carrega
 * `/api/anexo/<id>` em vez de `data:...`. É o mesmo truque que o chat já usava:
 * uma tag `<img>` não distingue os dois, então as telas que exibem anexo não
 * mudaram uma linha. Quem precisa distinguir é `openAttachment` e
 * `downloadAttachment` — e lá está tratado.
 */

export type DonoDeAnexo = "tarefa" | "comentario" | "projeto";

/**
 * @param donoId  id de BANCO do dono (uniqueidentifier). Comentário usa o id
 *                que `comentarNaTarefa` devolve, não o gerado no navegador.
 * @returns só os que subiram. Falha de um arquivo não derruba os outros — quem
 *          mandou cinco e perdeu um prefere quatro salvos a nenhum.
 */
export async function subirAnexos(
  donoTipo: DonoDeAnexo,
  donoId: string,
  arquivos: Attachment[],
): Promise<Attachment[]> {
  if (arquivos.length === 0) return [];

  const { enviarAnexo } = await import("@/lib/anexo.functions");
  const enviados: Attachment[] = [];
  const falhas: string[] = [];

  for (const a of arquivos) {
    try {
      const g = await enviarAnexo({
        data: {
          donoTipo,
          donoId,
          nome: a.name,
          tipoMime: a.type,
          conteudo: a.dataUrl,
        },
      });
      enviados.push({
        id: g.id,
        name: g.nome,
        size: g.tamanho,
        type: g.tipoMime,
        // Endereço do nosso proxy. O base64 morre aqui e NÃO volta para o
        // estado — era ele que estourava a cota do localStorage.
        dataUrl: g.url,
        at: a.at,
        userId: a.userId,
      });
    } catch (e) {
      falhas.push(a.name);
      console.warn("[fluxo] anexo não subiu:", a.name, (e as Error)?.message);
    }
  }

  if (falhas.length) {
    /* Falha de anexo precisa aparecer. Ela era engolida num `console.warn`, e o
       arquivo continuava na tela como se estivesse salvo — a pior combinação
       possível, porque a pessoa só descobre no dia em que outra pessoa diz que
       não achou o comprovante. */
    toast.error(
      falhas.length === 1
        ? `"${falhas[0]}" não foi enviado.`
        : `${falhas.length} arquivos não foram enviados.`,
      {
        description:
          falhas.length === 1
            ? "Tente anexar de novo."
            : `Não enviados: ${falhas.join(", ")}. Tente de novo.`,
        duration: 12_000,
      },
    );
  }

  return enviados;
}
