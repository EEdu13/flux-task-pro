import { createServerFn } from "@tanstack/react-start";
import { comSessao, comSessaoSemEntrada, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* O modo foco (pomodoro).
 *
 * Mesmo defeito do cronômetro, versão menor: o contador "hoje" em Minhas
 * Tarefas lia uma chave do `localStorage` datada do dia — o que soma dois
 * problemas, não um. Trocar de computador no meio do dia zera o contador, e
 * nenhum gerente nunca teve como ver quantos pomodoros a equipe fez.
 *
 * `minutos` é o que o cliente mede (o cronômetro do pomodoro roda na tela, não
 * há como o servidor recalcular sem reconstruir o timer inteiro) — mas o teto
 * de 180 no validador é a rede de segurança: mesmo que alguém chame esta
 * função direto, um "pomodoro" de uma semana não entra.
 */

export type SessaoDeFoco = {
  taskId: string | null;
  minutes: number;
  endedAt: number;
};

const guid = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;

export const registrarSessaoDeFoco = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { tarefaId?: string | null; minutos: number }) => {
      const minutos = Math.round(Number(e?.minutos));
      if (!Number.isFinite(minutos) || minutos < 1 || minutos > 180) {
        throw new Error("Duração de foco inválida");
      }
      return { tarefaId: guid(e?.tarefaId), minutos };
    }),
  )
  .handler(
    comSessao(async (eu, d: { tarefaId: string | null; minutos: number }) => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      await pool
        .request()
        .input("pessoa", sql.Int, eu)
        .input("tarefa", sql.UniqueIdentifier, d.tarefaId)
        .input("minutos", sql.Int, d.minutos)
        .query(
          `INSERT INTO gestor.sessoes_de_foco (pessoa_id, tarefa_id, minutos)
           VALUES (@pessoa, @tarefa, @minutos)`,
        );
      return { ok: true };
    }),
  );

/**
 * O resumo do dia: quantos pomodoros, quantos minutos.
 *
 * "Hoje" é medido no fuso do Brasil, com um deslocamento fixo — o país não
 * observa horário de verão desde 2019, então `-03:00` vale o ano inteiro sem
 * precisar de fuso de calendário. Calcular em JavaScript e mandar os dois
 * limites como parâmetro evita depender de como o SQL Server está configurado
 * no servidor, que roda em UTC por padrão no Azure.
 */
export const focoDeHoje = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ pomos: number; minutes: number }> => {
    const agora = new Date();
    const hojeBrasil = new Date(agora.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
    const inicio = new Date(`${hojeBrasil}T03:00:00.000Z`); // 00:00 no Brasil
    const fim = new Date(inicio.getTime() + 24 * 3600e3);

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("eu", sql.Int, eu)
      .input("inicio", sql.DateTimeOffset, inicio)
      .input("fim", sql.DateTimeOffset, fim)
      .query(
        `SELECT COUNT(*) AS pomos, ISNULL(SUM(minutos), 0) AS minutos
           FROM gestor.sessoes_de_foco
          WHERE pessoa_id = @eu AND encerrou_em >= @inicio AND encerrou_em < @fim`,
      );
    const linha = r.recordset[0] as { pomos: number; minutos: number };
    return { pomos: linha.pomos, minutes: linha.minutos };
  }),
);
