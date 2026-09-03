import { createServerFn } from "@tanstack/react-start";
import { comSessao, comSessaoSemEntrada, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* Bloco de notas: as abas passam a acompanhar a pessoa.
 *
 * Segunda das três sem dependência nenhuma. Diferente das metas, esta é
 * PRIVADA: cada pessoa lê e escreve só as suas, e o `pessoa_id` da sessão é o
 * que garante isso — não há como pedir as notas de outra pessoa porque não há
 * onde dizer de quem elas são.
 *
 * O que NÃO vem para cá: onde a janela está na tela, o tamanho dela, se está
 * aberta e qual aba está ativa. Isso continua no `localStorage`, junto com o
 * menu recolhido e a lista de salas — é preferência de tela, por máquina. Quem
 * usa um monitor grande no escritório não quer a janelinha no mesmo canto do
 * notebook.
 */

export type NotaDoBanco = {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
};

export const listarNotas = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ notas: NotaDoBanco[] }> => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("pessoa", sql.Int, eu)
      .query(
        `SELECT id, titulo, conteudo, atualizada_em
           FROM gestor.blocos_de_notas
          WHERE pessoa_id=@pessoa
          ORDER BY ordem, atualizada_em`,
      );
    return {
      notas: (
        r.recordset as {
          id: string;
          titulo: string;
          conteudo: string | null;
          atualizada_em: Date;
        }[]
      ).map((n) => ({
        id: n.id,
        title: n.titulo,
        content: n.conteudo ?? "",
        // A interface trabalha com milissegundos; o banco com data com fuso.
        updatedAt: n.atualizada_em.getTime(),
      })),
    };
  }),
);

/**
 * Grava uma aba.
 *
 * Uma por vez, e não a lista inteira: o bloco de notas salva a cada pausa de
 * digitação, e mandar todas as abas a cada tecla desperdiçaria banda e ainda
 * criaria a chance de uma gravação lenta sobrescrever outra mais nova.
 *
 * O `id` vem do cliente porque a aba já existe na tela antes de existir no
 * banco — quem digita não pode esperar a rede para ver a letra aparecer.
 */
export const salvarNota = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { id: string; title: string; content: string; ordem?: number }) => {
      const id = typeof e?.id === "string" ? e.id.trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Nota inválida");
      return {
        id,
        title:
          typeof e?.title === "string" && e.title.trim()
            ? e.title.trim().slice(0, 120)
            : "Sem título",
        content: typeof e?.content === "string" ? e.content.slice(0, 200_000) : "",
        ordem: Number.isFinite(Number(e?.ordem)) ? Math.max(0, Math.trunc(Number(e.ordem))) : 0,
      };
    }),
  )
  .handler(
    comSessao(
      async (eu, d: { id: string; title: string; content: string; ordem: number }) => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        /* O `pessoa_id=@pessoa` no WHERE do UPDATE não é redundante com o id.
           Sem ele, quem descobrisse o id da nota de outra pessoa poderia
           reescrever o conteúdo dela — o id sozinho não prova posse. */
        await pool
          .request()
          .input("id", sql.UniqueIdentifier, d.id)
          .input("pessoa", sql.Int, eu)
          .input("titulo", sql.NVarChar, d.title)
          .input("conteudo", sql.NVarChar(sql.MAX), d.content)
          .input("ordem", sql.Int, d.ordem)
          .query(
            `IF EXISTS (SELECT 1 FROM gestor.blocos_de_notas WHERE id=@id AND pessoa_id=@pessoa)
               UPDATE gestor.blocos_de_notas
                  SET titulo=@titulo, conteudo=@conteudo, ordem=@ordem,
                      atualizada_em=SYSDATETIMEOFFSET()
                WHERE id=@id AND pessoa_id=@pessoa;
             ELSE
               INSERT INTO gestor.blocos_de_notas (id, pessoa_id, titulo, conteudo, ordem)
               VALUES (@id, @pessoa, @titulo, @conteudo, @ordem);`,
          );
        return { ok: true };
      },
    ),
  );

export const apagarNota = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { id: string }) => {
      const id = typeof e?.id === "string" ? e.id.trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Nota inválida");
      return { id };
    }),
  )
  .handler(
    comSessao(async (eu, d: { id: string }) => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      await pool
        .request()
        .input("id", sql.UniqueIdentifier, d.id)
        .input("pessoa", sql.Int, eu)
        // Mesmo motivo do UPDATE: o id sozinho não prova de quem é a nota.
        .query(`DELETE FROM gestor.blocos_de_notas WHERE id=@id AND pessoa_id=@pessoa`);
      return { ok: true };
    }),
  );
