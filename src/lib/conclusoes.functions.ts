import { createServerFn } from "@tanstack/react-start";
import { comSessaoSemEntrada } from "@/integrations/iam/funcao-com-sessao";

/* A pontuação — bloco E.
 *
 * Uma conclusão é o registro de que alguém terminou uma tarefa, e vale por si:
 * é dela que saem o ranking do time, o gráfico dos últimos 7 dias e a nota do
 * mês. Hoje as três coisas aparecem zeradas, porque a lista morava no
 * navegador — e foi zerada junto com os dados de teste.
 *
 * Não há função de gravar aqui, e a ausência é o ponto. A conclusão nasce
 * dentro de `salvarTarefa`, no mesmo comando que muda a situação da tarefa.
 * Fosse uma chamada à parte, o navegador escolheria os próprios pontos — e a
 * lição do item 1 é exatamente essa. Também não daria para garantir que as
 * duas coisas acontecem juntas: uma tarefa concluída sem pontuação, ou uma
 * pontuação sem tarefa, seriam estados possíveis. Do jeito que está, não são.
 */

export type ConclusaoDoBanco = {
  id: string;
  taskId: string;
  userId: string;
  points: number;
  priority: "baixa" | "media" | "alta";
  onTime: boolean;
  at: string;
};

const PRIORIDADES = ["baixa", "media", "alta"] as const;

type LinhaConclusao = {
  id: string;
  tarefa_id: string;
  pessoa_id: number;
  pontos: number;
  prioridade: string;
  no_prazo: boolean;
  em: Date;
};

/**
 * As conclusões que esta pessoa pode ver.
 *
 * Mesma regra de `listarTarefas`, e de propósito: o placar precisa cobrir
 * exatamente as tarefas que a pessoa enxerga. Um supervisor que vê as tarefas
 * do setor mas só a própria pontuação teria um ranking em que a equipe aparece
 * com zero — pior que não ter ranking, porque parece um fato.
 *
 * O setor não está em `conclusoes`: ele é da tarefa. Daí a junção.
 */
export const listarConclusoes = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ conclusoes: ConclusaoDoBanco[] }> => {
    const { papelEsetor } = await import("@/lib/perfil.functions");
    const { papel, setor } = await papelEsetor(eu);

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();

    /* Os mesmos parênteses de `listarTarefas`, pelo mesmo motivo: abaixo vem um
       `AND` de data, e sem eles ele se ligaria só ao último `OR`. */
    const filtro =
      papel === "gerente"
        ? "1=1"
        : papel === "supervisor" && setor
          ? "(t.setor=@setor OR c.pessoa_id=@eu OR t.criado_por=@eu)"
          : "(c.pessoa_id=@eu OR t.criado_por=@eu)";

    const req = pool.request().input("eu", sql.Int, eu);
    if (filtro.includes("@setor")) req.input("setor", sql.NVarChar, setor);

    /* Repare no que NÃO está aqui: `arquivada_em IS NULL`.
       Arquivar tira a tarefa do quadro, não do passado. Filtrar por isso faria
       a pontuação de meses fechados mudar porque alguém limpou a tela hoje — é
       o mesmo motivo pelo qual apagar deixou de existir.

       Os 90 dias são o teto. As telas que usam esta lista olham no máximo o mês
       corrente e os últimos 14 dias; sem um limite, a consulta cresceria para
       sempre e a tela inicial ficaria mais lenta a cada ano de uso. */
    const r = await req.query(
      `SELECT c.id, c.tarefa_id, c.pessoa_id, c.pontos, c.prioridade, c.no_prazo, c.em
         FROM gestor.conclusoes c
         JOIN gestor.tarefas t ON t.id = c.tarefa_id
        WHERE ${filtro} AND c.em >= DATEADD(DAY, -90, SYSDATETIMEOFFSET())
        ORDER BY c.em DESC`,
    );

    return {
      conclusoes: (r.recordset as LinhaConclusao[]).map((c) => ({
        id: c.id,
        taskId: c.tarefa_id,
        // `User.id` é string na interface inteira — comparar 467 com "467"
        // daria falso e a pessoa sumiria do próprio ranking.
        userId: String(c.pessoa_id),
        points: c.pontos,
        priority: (PRIORIDADES as readonly string[]).includes(c.prioridade)
          ? (c.prioridade as ConclusaoDoBanco["priority"])
          : "media",
        onTime: !!c.no_prazo,
        at: c.em.toISOString(),
      })),
    };
  }),
);
