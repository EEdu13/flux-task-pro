import { createServerFn } from "@tanstack/react-start";
import { comSessao, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/**
 * O recado de voz e a gravação de tela mais recentes de cada tarefa, para os
 * cartões (19/10/2026: "deixa o player de áudio aqui nos cards, e um thumb
 * tipo prévia do vídeo").
 *
 * A listagem de tarefas não traz anexos (ver `satellitesLoaded`), e carregar
 * os satélites de cada cartão seria uma consulta por tarefa. Aqui é UMA
 * consulta para a tela inteira, só com o que é áudio ou vídeo — da tarefa e
 * dos comentários dela —, filtrada pela mesma regra de quem vê a tarefa.
 * O arquivo em si continua passando pela rota `/api/anexo/<id>`, que confere
 * a permissão de novo.
 */

export type MidiaDaTarefa = { id: string; nome: string; tipo: string };
export type MidiasDaTarefa = { audio?: MidiaDaTarefa; video?: MidiaDaTarefa };

const MAX_TAREFAS = 400;

export const midiasDasTarefas = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { ids: string[] }) => {
      const ids = (Array.isArray(e?.ids) ? e.ids : [])
        .filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))
        .slice(0, MAX_TAREFAS);
      return { ids: [...new Set(ids.map((i) => i.toUpperCase()))] };
    }),
  )
  .handler(
    comSessao(
      async (eu, d: { ids: string[] }): Promise<{ midias: Record<string, MidiasDaTarefa> }> => {
        if (!d.ids.length) return { midias: {} };
        const { getPool, sql } = await import("@/integrations/db.server");
        const { SQL_QUEM_SOU, SQL_PREPARA_SUBORDINADOS, SQL_VE_A_TAREFA } =
          await import("@/lib/permissoes.server");
        const pool = await getPool();
        const r = await pool
          .request()
          .input("eu", sql.Int, eu)
          .input("ids", sql.NVarChar(sql.MAX), JSON.stringify(d.ids))
          .query(
            `${SQL_QUEM_SOU}
           ${SQL_PREPARA_SUBORDINADOS}
           DECLARE @alvo TABLE (id UNIQUEIDENTIFIER PRIMARY KEY);
           INSERT INTO @alvo (id) SELECT DISTINCT TRY_CAST(value AS UNIQUEIDENTIFIER)
             FROM OPENJSON(@ids) WHERE TRY_CAST(value AS UNIQUEIDENTIFIER) IS NOT NULL;
           SELECT x.tarefa_id, a.id, a.nome, a.tipo_mime, a.enviado_em
             FROM (SELECT a.id, a.dono_id AS tarefa_id
                     FROM @alvo al
                     JOIN gestor.anexos a ON a.dono_tipo = N'tarefa' AND a.dono_id = al.id
                   UNION ALL
                   SELECT a.id, c.tarefa_id
                     FROM @alvo al
                     JOIN gestor.comentarios c ON c.tarefa_id = al.id
                     JOIN gestor.anexos a ON a.dono_tipo = N'comentario' AND a.dono_id = c.id) x
             JOIN gestor.anexos a ON a.id = x.id
             JOIN gestor.tarefas t ON t.id = x.tarefa_id
            WHERE (a.tipo_mime LIKE N'audio/%' OR a.tipo_mime LIKE N'video/%')
              AND ${SQL_VE_A_TAREFA}
            ORDER BY a.enviado_em DESC;`,
          );

        const midias: Record<string, MidiasDaTarefa> = {};
        for (const l of r.recordset as {
          tarefa_id: string;
          id: string;
          nome: string;
          tipo_mime: string;
        }[]) {
          const chave = l.tarefa_id.toUpperCase();
          const m = (midias[chave] ??= {});
          const midia = { id: l.id, nome: l.nome, tipo: l.tipo_mime };
          // Já vem do mais novo para o mais velho: fica o primeiro de cada tipo.
          if (l.tipo_mime.startsWith("audio/")) m.audio ??= midia;
          else m.video ??= midia;
        }
        return { midias };
      },
    ),
  );
