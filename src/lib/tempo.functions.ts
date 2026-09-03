import { createServerFn } from "@tanstack/react-start";
import { comSessao, comSessaoSemEntrada, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* O cronômetro de tarefa.
 *
 * `task-timer.tsx` já contava o tempo certinho — o problema nunca foi a
 * contagem, foi onde ela ficava. Cada sessão vivia numa chave do
 * `localStorage` por pessoa, então "quanto tempo o Fulano gastou nessa
 * tarefa" só respondia quem perguntasse no MESMO computador que o Fulano usa.
 * `relatorios.tsx` chegava a varrer o `localStorage` inteiro atrás de chaves de
 * outras pessoas — comentado como "cenário demo/on-prem" — e funcionava
 * exatamente quando duas pessoas compartilhavam a mesma máquina, que é o
 * contrário do que a Larsil tem.
 *
 * A gravação aqui é read-through simples, sem armadilha de dupla contagem:
 * `iniciou_em`/`encerrou_em` vêm do cliente, mas `segundos` é recomputado no
 * servidor a partir dos dois — o mesmo motivo de `concluida_em` não vir do
 * cliente em `salvarTarefa`. Um relógio de navegador adiantado não pode
 * inflar a produtividade de ninguém.
 */

export type SessaoDeTempo = {
  id: string;
  taskId: string;
  pessoaId: string;
  startedAt: number;
  endedAt: number;
  seconds: number;
};

const guid = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;

/**
 * Grava uma sessão de trabalho numa tarefa.
 *
 * Sessões curtas demais nem chegam aqui — `task-timer.tsx` já descarta o que
 * dá menos de um segundo antes de chamar. O `CHECK (segundos > 0)` da tabela é
 * a segunda trava, para quem chamar esta função por fora da tela.
 */
export const registrarSessaoDeTempo = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { tarefaId: string; iniciouEm: string; encerrouEm: string }) => {
      const tarefaId = guid(e?.tarefaId);
      if (!tarefaId) throw new Error("Tarefa inválida");
      const iniciou = new Date(e?.iniciouEm);
      const encerrou = new Date(e?.encerrouEm);
      if (Number.isNaN(iniciou.getTime()) || Number.isNaN(encerrou.getTime())) {
        throw new Error("Horário inválido");
      }
      const segundos = Math.round((encerrou.getTime() - iniciou.getTime()) / 1000);
      if (segundos < 1) throw new Error("Sessão curta demais para registrar");
      return { tarefaId, iniciou, encerrou, segundos };
    }),
  )
  .handler(
    comSessao(
      async (eu, d: { tarefaId: string; iniciou: Date; encerrou: Date; segundos: number }) => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        await pool
          .request()
          .input("pessoa", sql.Int, eu)
          .input("tarefa", sql.UniqueIdentifier, d.tarefaId)
          .input("iniciou", sql.DateTimeOffset, d.iniciou)
          .input("encerrou", sql.DateTimeOffset, d.encerrou)
          .input("segundos", sql.Int, d.segundos)
          .query(
            `INSERT INTO gestor.sessoes_de_tempo (pessoa_id, tarefa_id, iniciou_em, encerrou_em, segundos)
             VALUES (@pessoa, @tarefa, @iniciou, @encerrou, @segundos)`,
          );
        return { ok: true };
      },
    ),
  );

type LinhaSessao = {
  id: string;
  tarefa_id: string;
  pessoa_id: number;
  iniciou_em: Date;
  encerrou_em: Date;
  segundos: number;
};

/**
 * As sessões que esta pessoa pode ver — mesma regra de `listarConclusoes`.
 *
 * É o que substitui a varredura de `localStorage`: um supervisor abre
 * Relatórios e vê o tempo real da equipe, não só do que sobrou gravado na
 * própria máquina. Os 90 dias e o teto de 2000 linhas existem pelo mesmo
 * motivo de sempre — a tela olha no máximo o mês corrente, e uma consulta sem
 * limite fica mais lenta a cada mês de uso acumulado.
 */
export const listarSessoesDeTempo = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ sessoes: SessaoDeTempo[] }> => {
    const { papelEsetor } = await import("@/lib/perfil.functions");
    const { papel, setor } = await papelEsetor(eu);

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();

    const filtro =
      papel === "gerente"
        ? "1=1"
        : papel === "supervisor" && setor
          ? "(t.setor=@setor OR s.pessoa_id=@eu)"
          : "s.pessoa_id=@eu";

    const req = pool.request().input("eu", sql.Int, eu);
    if (filtro.includes("@setor")) req.input("setor", sql.NVarChar, setor);

    const r = await req.query(
      `SELECT TOP (2000) s.id, s.tarefa_id, s.pessoa_id, s.iniciou_em, s.encerrou_em, s.segundos
         FROM gestor.sessoes_de_tempo s
         JOIN gestor.tarefas t ON t.id = s.tarefa_id
        WHERE ${filtro} AND s.iniciou_em >= DATEADD(DAY, -90, SYSDATETIMEOFFSET())
        ORDER BY s.iniciou_em DESC`,
    );

    return {
      sessoes: (r.recordset as LinhaSessao[]).map((s) => ({
        id: s.id,
        taskId: s.tarefa_id,
        pessoaId: String(s.pessoa_id),
        startedAt: s.iniciou_em.getTime(),
        endedAt: s.encerrou_em.getTime(),
        seconds: s.segundos,
      })),
    };
  }),
);
