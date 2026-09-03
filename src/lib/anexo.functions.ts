import { createServerFn } from "@tanstack/react-start";
import { comSessao, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* Anexo: o arquivo vai para o Blob, a linha vai para `gestor.anexos`.
 *
 * É a premissa 2 do schema saindo do papel. Antes, cada anexo era uma string
 * base64 de até 3 MB guardada dentro do JSON do navegador — e, no chat, dentro
 * de uma coluna. Gravar arquivo em coluna incha a tabela, alonga o backup e faz
 * qualquer `SELECT *` descuidado arrastar megabytes pela rede.
 *
 * Agora a tabela guarda a URL. O conteúdo mora no contêiner `gestor` do Azure
 * Storage, e quem lê passa pelo nosso servidor — a credencial do contêiner
 * nunca chega ao navegador. Ver o comentário do topo de `blob.server.ts`.
 */

/** Teto por arquivo. O mesmo que o chat já usava, agora dito em um lugar só. */
const MAX_BYTES = 5 * 1024 * 1024;

/** O que a interface precisa saber depois de enviar. */
export type AnexoGravado = {
  id: string;
  nome: string;
  tamanho: number;
  tipoMime: string;
  /** Endereço para exibir. Passa pelo nosso servidor, não pelo Azure direto. */
  url: string;
};

const DONOS = ["tarefa", "comentario", "projeto", "mensagem"] as const;
type Dono = (typeof DONOS)[number];

/**
 * Recebe o arquivo em base64 e devolve o anexo gravado.
 *
 * Base64 e não upload binário porque é o formato que a interface já produz — o
 * seletor de arquivo lê como data URL. Custa 33% a mais de tráfego na subida, e
 * é o preço de não reescrever as cinco telas que anexam arquivo hoje. Se um dia
 * incomodar, o caminho é uma rota que recebe `multipart/form-data`; a tabela e
 * o Blob não mudam.
 */
export const enviarAnexo = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade(
      (entrada: {
        donoTipo: string;
        donoId: string;
        nome: string;
        tipoMime: string;
        /** `data:<mime>;base64,<...>` ou só o base64. */
        conteudo: string;
      }) => {
        const donoTipo = entrada?.donoTipo;
        if (!(DONOS as readonly string[]).includes(donoTipo)) {
          throw new Error("Tipo de dono inválido");
        }
        const donoId = typeof entrada?.donoId === "string" ? entrada.donoId.trim() : "";
        if (!/^[0-9a-f-]{36}$/i.test(donoId)) throw new Error("Dono inválido");

        const nome =
          typeof entrada?.nome === "string" && entrada.nome.trim()
            ? entrada.nome.trim().slice(0, 260)
            : "arquivo";

        const conteudo = typeof entrada?.conteudo === "string" ? entrada.conteudo : "";
        if (!conteudo) throw new Error("Arquivo vazio");

        return {
          donoTipo: donoTipo as Dono,
          donoId,
          nome,
          tipoMime:
            typeof entrada?.tipoMime === "string" && entrada.tipoMime.trim()
              ? entrada.tipoMime.trim().slice(0, 120)
              : "application/octet-stream",
          conteudo,
        };
      },
    ),
  )
  .handler(
    comSessao(
      async (
        eu,
        dados: {
          donoTipo: Dono;
          donoId: string;
          nome: string;
          tipoMime: string;
          conteudo: string;
        },
      ): Promise<AnexoGravado> => {
        // A vírgula separa o cabeçalho do data URL do conteúdo. Sem data URL,
        // a string inteira já é o base64.
        const virgula = dados.conteudo.indexOf(",");
        const base64 = dados.conteudo.startsWith("data:")
          ? dados.conteudo.slice(virgula + 1)
          : dados.conteudo;

        let bytes: Buffer;
        try {
          bytes = Buffer.from(base64, "base64");
        } catch {
          throw new Error("Arquivo em formato inesperado");
        }
        // Conferido depois de decodificar, e não no tamanho da string: base64
        // engorda o texto em 33%, então medir a string recusaria arquivo de
        // 3.8 MB dizendo que passou de 5.
        if (!bytes.byteLength) throw new Error("Arquivo vazio");
        if (bytes.byteLength > MAX_BYTES) {
          throw new Error("Arquivo muito grande. O limite é 5 MB.");
        }

        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();

        /* O id sai do banco antes do arquivo subir, e é ele que nomeia o blob.
           A ordem importa: nome de arquivo é dado de fora, e dois "orçamento.pdf"
           não podem disputar o mesmo lugar no contêiner. */
        const novo = await pool.request().query(`SELECT NEWID() AS id`);
        const id = (novo.recordset[0] as { id: string }).id;

        /* Cópia para um `ArrayBuffer` próprio.
           O `Buffer` do Node é uma visão sobre um buffer compartilhado e
           reaproveitado — mandá-lo direto arriscaria enviar bytes de outra
           coisa se ele fosse reciclado no meio do envio. A cópia custa uma
           passada em até 5 MB e tira a dúvida. */
        const corpo = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(corpo).set(bytes);

        const { caminhoDoAnexo, enviarParaOBlob } = await import("@/integrations/blob.server");
        const url = await enviarParaOBlob(
          caminhoDoAnexo(dados.donoTipo, id),
          corpo,
          dados.tipoMime,
        );

        /* A linha só entra depois do arquivo estar gravado.
           Na ordem inversa, uma falha no envio deixaria a tabela apontando para
           um arquivo que não existe — e isso não dá erro na hora, dá erro meses
           depois, quando alguém clica. */
        await pool
          .request()
          .input("id", sql.UniqueIdentifier, id)
          .input("dono_tipo", sql.NVarChar, dados.donoTipo)
          .input("dono_id", sql.UniqueIdentifier, dados.donoId)
          .input("nome", sql.NVarChar, dados.nome)
          .input("tamanho", sql.BigInt, bytes.byteLength)
          .input("mime", sql.NVarChar, dados.tipoMime)
          .input("url", sql.NVarChar, url)
          .input("por", sql.Int, eu)
          .query(
            `INSERT INTO gestor.anexos
               (id, dono_tipo, dono_id, nome, tamanho, tipo_mime, url, enviado_por)
             VALUES (@id, @dono_tipo, @dono_id, @nome, @tamanho, @mime, @url, @por)`,
          );

        return {
          id,
          nome: dados.nome,
          tamanho: bytes.byteLength,
          tipoMime: dados.tipoMime,
          // Endereço do nosso proxy, não do Azure: a credencial do contêiner
          // não pode atravessar para o navegador.
          url: `/api/anexo/${id}`,
        };
      },
    ),
  );

/** Anexos de uma tarefa, comentário, projeto ou mensagem. */
export const listarAnexos = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((entrada: { donoTipo: string; donoId: string }) => {
      if (!(DONOS as readonly string[]).includes(entrada?.donoTipo)) {
        throw new Error("Tipo de dono inválido");
      }
      const donoId = typeof entrada?.donoId === "string" ? entrada.donoId.trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(donoId)) throw new Error("Dono inválido");
      return { donoTipo: entrada.donoTipo as Dono, donoId };
    }),
  )
  .handler(
    comSessao(async (_eu, dados: { donoTipo: Dono; donoId: string }) => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await pool
        .request()
        .input("dono_tipo", sql.NVarChar, dados.donoTipo)
        .input("dono_id", sql.UniqueIdentifier, dados.donoId)
        .query(
          `SELECT id, nome, tamanho, tipo_mime, enviado_por, enviado_em
             FROM gestor.anexos
            WHERE dono_tipo=@dono_tipo AND dono_id=@dono_id
            ORDER BY enviado_em`,
        );
      return {
        anexos: (
          r.recordset as {
            id: string;
            nome: string;
            tamanho: number;
            tipo_mime: string;
            enviado_por: number;
            enviado_em: Date;
          }[]
        ).map((a) => ({
          id: a.id,
          nome: a.nome,
          tamanho: a.tamanho,
          tipoMime: a.tipo_mime,
          enviadoPor: String(a.enviado_por),
          enviadoEm: a.enviado_em.toISOString(),
          url: `/api/anexo/${a.id}`,
        })),
      };
    }),
  );
