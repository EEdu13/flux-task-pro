import { toast } from "sonner";
import type { Attachment } from "./fluxo-types";
import { avisarHistoricoMudou } from "./historico-eventos";

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

/* "mural" (14/10/2026): as fotos de um post do Mural. */
export type DonoDeAnexo = "tarefa" | "comentario" | "projeto" | "mural";

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
      /* Recado de voz e gravação de tela (19/10/2026) chegam como `blob:` — o
         arquivo está na memória do navegador, não em base64 — e sobem em
         pedaços. Ver `subirArquivoEmPedacos` abaixo. */
      const local = a.dataUrl.startsWith("blob:");
      // Projeto e mural não têm gravação; um `blob:` ali seria defeito, e
      // mandá-lo pelo envio de base64 gravaria lixo no lugar do arquivo.
      if (local && donoTipo !== "tarefa" && donoTipo !== "comentario") {
        throw new Error("Gravação não pode ser anexada aqui");
      }
      const g =
        local && (donoTipo === "tarefa" || donoTipo === "comentario")
          ? await subirArquivoEmPedacos(
              donoTipo,
              donoId,
              await (await fetch(a.dataUrl)).blob(),
              a.name,
              a.type,
            )
          : await enviarAnexo({
              data: {
                donoTipo,
                donoId,
                nome: a.name,
                tipoMime: a.type,
                conteudo: a.dataUrl,
              },
            });
      if (local) soltarEnderecoLocal(a.dataUrl);
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

  // O servidor registrou "anexou" na Timeline da tarefa; a tela vai buscar.
  if (donoTipo === "tarefa" && enviados.length) avisarHistoricoMudou(donoId);

  return enviados;
}

/**
 * Solta o endereço `blob:` da gravação depois que ela já está no servidor.
 * Com folga: a cópia em tela pode estar tocando o áudio por ele agora mesmo, e
 * a troca pelo endereço do servidor acontece no próximo render.
 */
function soltarEnderecoLocal(url: string) {
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/** Os bytes de um pedaço em base64, sem o cabeçalho `data:...;base64,`. */
function pedacoEmBase64(pedaco: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error ?? new Error("Não foi possível ler a gravação"));
    r.readAsDataURL(pedaco);
  });
}

/**
 * Sobe um arquivo GRANDE (vídeo de tela, recado de voz) em pedaços de 2 MB.
 *
 * O envio de sempre manda o arquivo inteiro numa chamada, e serve até 5 MB. O
 * vídeo de tela vai até 25 MB: aqui ele sai em pedaços, um depois do outro, e
 * o servidor repassa cada um ao Azure Blob como um bloco, fechando o arquivo
 * no fim (ver `envio-em-pedacos.server.ts`). A credencial do Blob continua só
 * no servidor, e o banco recebe só a linha com a URL — igual a qualquer anexo.
 *
 * Pedaço que falha é tentado de novo duas vezes antes de desistir: numa rede
 * de escritório, um soluço no meio de 12 MB é mais provável do que parece.
 */
export async function subirArquivoEmPedacos(
  donoTipo: "tarefa" | "comentario" | "mensagem",
  donoId: string,
  arquivo: Blob,
  nome: string,
  tipoMime: string,
  aoProgredir?: (fracao: number) => void,
): Promise<{ id: string; nome: string; tamanho: number; tipoMime: string; url: string }> {
  const api = await import("@/lib/anexo-em-pedacos.functions");
  const { envioId, tamanhoDoPedaco } = await api.comecarEnvioEmPedacos({
    data: { donoTipo, donoId, nome, tipoMime, tamanho: arquivo.size },
  });

  try {
    let indice = 0;
    for (let inicio = 0; inicio < arquivo.size; inicio += tamanhoDoPedaco) {
      const conteudo = await pedacoEmBase64(arquivo.slice(inicio, inicio + tamanhoDoPedaco));
      for (let tentativa = 1; ; tentativa++) {
        try {
          await api.enviarPedacoDoAnexo({ data: { envioId, indice, conteudo } });
          break;
        } catch (e) {
          /* Só repete o que pode ter sido rede. "Fora de ordem" depois de uma
             falha quer dizer que o pedaço CHEGOU e a resposta é que se perdeu:
             aí está certo seguir em frente. */
          if (/fora de ordem/i.test((e as Error)?.message ?? "") && tentativa > 1) break;
          if (tentativa >= 3) throw e;
          await new Promise((r) => window.setTimeout(r, 800 * tentativa));
        }
      }
      indice++;
      aoProgredir?.(Math.min(1, (inicio + tamanhoDoPedaco) / arquivo.size));
    }
    return await api.concluirEnvioEmPedacos({ data: { envioId } });
  } catch (e) {
    void api.cancelarEnvioEmPedacos({ data: { envioId } }).catch(() => {});
    throw e;
  }
}
