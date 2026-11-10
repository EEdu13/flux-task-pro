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
    const { papel } = await papelEsetor(eu);

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();

    /* Mesmo alcance de `listarTarefas` — as tarefas que a pessoa enxerga —,
       mais as conclusões dela e de quem responde a ela. Sem isto, o gráfico de
       "últimos 7 dias · time" contaria só quem está olhando. Os parênteses
       existem porque abaixo vem um `AND` de data. */
    const { SQL_PREPARA_SUBORDINADOS } = await import("@/lib/permissoes.server");

    /* 10/11/2026: o alcance acima, escrito como UNIÃO em vez de um OR só.
       O OR (o de `sqlListaDeTarefas` mais as conclusões minhas e dos meus)
       fazia o banco sondar menções e @subs uma vez por conclusão dos 90
       dias — ~12 mil leituras por chamada, a consulta mais cara do Fluxo
       depois da do WhatsApp. A conta é a mesma, montada por partes:
         - `p`   = eu + quem responde a mim (@subs);
         - `vis` = tarefas com responsável ou criador em `p`, mais as em que
                   fui mencionado — exatamente `sqlListaDeTarefas`;
         - a conclusão entra se a tarefa está em `vis` OU se quem concluiu
           está em `p`.
       Conferido no banco (327, 280, 303): mesmas linhas e mesmos pontos,
       ~900 leituras em vez de ~8.400. Se a regra de `sqlListaDeTarefas`
       mudar, esta aqui muda junto. */
    const filtro =
      papel === "gerente"
        ? "1=1"
        : `c.id IN (SELECT c1.id FROM gestor.conclusoes c1 JOIN vis ON vis.id = c1.tarefa_id
                    UNION
                    SELECT c2.id FROM gestor.conclusoes c2 JOIN p ON p.id = c2.pessoa_id)`;
    const comAlcance =
      papel === "gerente"
        ? ""
        : `WITH p AS (SELECT @eu AS id UNION SELECT id FROM @subs),
           vis AS (SELECT t.id FROM gestor.tarefas t JOIN p ON t.responsavel_id = p.id
                   UNION SELECT t.id FROM gestor.tarefas t JOIN p ON t.criado_por = p.id
                   UNION SELECT m.tarefa_id FROM gestor.mencoes m WHERE m.pessoa_id = @eu)`;

    const req = pool.request().input("eu", sql.Int, eu);

    /* Repare no que NÃO está aqui: `arquivada_em IS NULL`.
       Arquivar tira a tarefa do quadro, não do passado. Filtrar por isso faria
       a pontuação de meses fechados mudar porque alguém limpou a tela hoje — é
       o mesmo motivo pelo qual apagar deixou de existir.

       Os 90 dias são o teto. As telas que usam esta lista olham no máximo o mês
       corrente e os últimos 14 dias; sem um limite, a consulta cresceria para
       sempre e a tela inicial ficaria mais lenta a cada ano de uso. */
    const r = await req.query(
      `${SQL_PREPARA_SUBORDINADOS}
       ${comAlcance}
       SELECT c.id, c.tarefa_id, c.pessoa_id, c.pontos, c.prioridade, c.no_prazo, c.em
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
