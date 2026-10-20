import { createServerFn } from "@tanstack/react-start";
import { comSessaoSemEntrada } from "@/integrations/iam/funcao-com-sessao";

/**
 * O pack de cada dia da pessoa nos últimos 70 dias, até ONTEM (19/10/2026,
 * a ofensiva do Início, como a do Duolingo). O dia de hoje vem da própria
 * tela — ele muda a cada tarefa concluída e não vale ir ao banco por isso.
 *
 * A mesma conta do lote diário do mural (`mural-lote.server.ts`, consulta 2):
 * total de tarefas do pack com prazo naquele dia (Brasília) e quantas foram
 * concluídas até o dia do prazo; arquivada sem concluir não conta. Só as
 * minhas (`responsavel_id = eu`), pelo índice IX_tarefas_pack_prazo. A tela
 * pede uma vez por dia (e guarda), então é uma consulta pequena por pessoa
 * por dia.
 */
export const meuPackPorDia = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(
    async (eu): Promise<{ dias: { dia: string; total: number; feitas: number }[] }> => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const FUSO = "N'E. South America Standard Time'";
      const r = await pool
        .request()
        .input("eu", sql.Int, eu)
        .query(
          `DECLARE @hoje DATE = CAST(SYSDATETIMEOFFSET() AT TIME ZONE ${FUSO} AS DATE);
           SELECT CONVERT(CHAR(10), d.dia, 23) AS dia, COUNT(*) AS total,
                  SUM(CASE WHEN t.situacao = 'concluida'
                            AND COALESCE(t.data_real_de_conclusao,
                                         CAST(t.concluida_em AT TIME ZONE ${FUSO} AS DATE)) <= d.dia
                           THEN 1 ELSE 0 END) AS feitas
             FROM gestor.tarefas t
            CROSS APPLY (SELECT CAST(t.prazo AT TIME ZONE ${FUSO} AS DATE) AS dia) d
            WHERE t.no_pack = 1 AND t.responsavel_id = @eu
              AND t.prazo >= DATEADD(DAY, -70, SYSDATETIMEOFFSET())
              AND d.dia < @hoje
              AND NOT (t.arquivada_em IS NOT NULL AND t.situacao <> 'concluida')
            GROUP BY d.dia`,
        );
      return {
        dias: (r.recordset as { dia: string; total: number; feitas: number }[]).map((l) => ({
          dia: l.dia,
          total: l.total,
          feitas: l.feitas,
        })),
      };
    },
  ),
);
