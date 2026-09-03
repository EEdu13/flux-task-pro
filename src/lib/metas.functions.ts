import { createServerFn } from "@tanstack/react-start";
import { comSessao, comSessaoSemEntrada, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* Metas: o alvo de cada pessoa e de cada setor.
 *
 * Primeira das três tabelas sem dependência nenhuma — ela não aponta para
 * ninguém e ninguém aponta para ela. Por isso vem antes da tarefa, que é o eixo
 * de 13 tabelas: dá para acertar o caminho de leitura e escrita aqui, onde
 * errar custa pouco.
 *
 * A meta é COLETIVA de propósito: todo mundo lê todas. É assim que o gerente
 * define o alvo do setor e a pessoa vê o dela. Quem pode DEFINIR é outra
 * conversa — hoje a tela já limita ao gerente, e a checagem de papel no
 * servidor entra junto com a hierarquia, no bloco da tarefa.
 */

/* Os mesmos valores que o app usa, e os mesmos que o CHECK da tabela aceita.
   Declarados aqui como `const` para servirem de validação na entrada E de
   conferência na saída — a mesma lista nos dois sentidos. */
const ESCOPOS = ["user", "sector"] as const;
const METRICAS = ["tarefas", "pontos"] as const;
const PERIODOS = ["diaria", "semanal", "mensal"] as const;

/** Igual ao tipo `Meta` do app. Não é reaproveitado para não amarrar o módulo
    de servidor ao arquivo de tipos da interface. */
export type MetaDoBanco = {
  id: string;
  scope: (typeof ESCOPOS)[number];
  scopeId: string;
  period: (typeof PERIODOS)[number];
  metric: (typeof METRICAS)[number];
  target: number;
};

/** Lista todas. São poucas — uma por pessoa/setor por período. */
export const listarMetas = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (): Promise<{ metas: MetaDoBanco[] }> => {
    const { getPool } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool.request().query(
      `SELECT id,
              escopo    AS scope,
              escopo_id AS scopeId,
              periodo   AS period,
              metrica   AS metric,
              alvo      AS target
         FROM gestor.metas`,
    );

    /* Confere na saída em vez de afirmar o tipo.
       O CHECK da tabela já impede valor estranho, mas quem lê não deveria
       depender disso: uma linha inserida à mão no portal do Azure, ou um CHECK
       relaxado no futuro, entregaria um `period` que a interface não conhece —
       e ela quebraria longe daqui, na tela de metas, sem pista da origem.
       Descartar a linha inválida é preferível a propagá-la. */
    const valido = (l: Record<string, unknown>): l is MetaDoBanco =>
      (ESCOPOS as readonly unknown[]).includes(l.scope) &&
      (PERIODOS as readonly unknown[]).includes(l.period) &&
      (METRICAS as readonly unknown[]).includes(l.metric);

    const linhas = r.recordset as Record<string, unknown>[];
    const metas = linhas.filter(valido);
    if (metas.length !== linhas.length) {
      console.warn(`[metas] ${linhas.length - metas.length} linha(s) com valor fora do esperado`);
    }
    return { metas };
  }),
);

/**
 * Cria ou atualiza a meta.
 *
 * A identidade natural de uma meta é o conjunto (escopo, quem, período,
 * métrica) — "a meta semanal de tarefas da Ana" é uma só. O `id` existe para a
 * interface ter uma chave estável, não para permitir duas metas iguais.
 *
 * Por isso o upsert casa por esses quatro campos e não pelo id: sem isso, salvar
 * a mesma meta duas vezes criaria duas linhas e o alvo passaria a depender de
 * qual delas a consulta devolvesse primeiro.
 */
export const salvarMeta = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade(
      (e: {
        scope: string;
        scopeId: string;
        period: string;
        metric: string;
        target: number;
      }) => {
        if (!(ESCOPOS as readonly string[]).includes(e?.scope)) throw new Error("Escopo inválido");
        if (!(METRICAS as readonly string[]).includes(e?.metric)) {
          throw new Error("Métrica inválida");
        }
        if (!(PERIODOS as readonly string[]).includes(e?.period)) {
          throw new Error("Período inválido");
        }
        const scopeId = typeof e?.scopeId === "string" ? e.scopeId.trim().slice(0, 40) : "";
        if (!scopeId) throw new Error("Alvo da meta não informado");

        const bruto = Number(e?.target);
        if (!Number.isFinite(bruto) || bruto <= 0) throw new Error("A meta precisa ser maior que zero");
        // Teto para o campo não virar depósito de número absurdo por engano de
        // digitação — 100 mil pontos por dia não é meta, é erro de tecla.
        const target = Math.min(100_000, Math.trunc(bruto));

        return { scope: e.scope, scopeId, period: e.period, metric: e.metric, target };
      },
    ),
  )
  .handler(
    comSessao(
      async (
        _eu,
        d: { scope: string; scopeId: string; period: string; metric: string; target: number },
      ) => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        await pool
          .request()
          .input("escopo", sql.NVarChar, d.scope)
          .input("escopo_id", sql.NVarChar, d.scopeId)
          .input("periodo", sql.NVarChar, d.period)
          .input("metrica", sql.NVarChar, d.metric)
          .input("alvo", sql.Int, d.target)
          .query(
            `IF EXISTS (SELECT 1 FROM gestor.metas
                         WHERE escopo=@escopo AND escopo_id=@escopo_id
                           AND periodo=@periodo AND metrica=@metrica)
               UPDATE gestor.metas SET alvo=@alvo
                WHERE escopo=@escopo AND escopo_id=@escopo_id
                  AND periodo=@periodo AND metrica=@metrica;
             ELSE
               INSERT INTO gestor.metas (escopo, escopo_id, periodo, metrica, alvo)
               VALUES (@escopo, @escopo_id, @periodo, @metrica, @alvo);`,
          );
        return { ok: true };
      },
    ),
  );

export const removerMeta = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { id: string }) => {
      const id = typeof e?.id === "string" ? e.id.trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Meta inválida");
      return { id };
    }),
  )
  .handler(
    comSessao(async (_eu, d: { id: string }) => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      await pool
        .request()
        .input("id", sql.UniqueIdentifier, d.id)
        .query(`DELETE FROM gestor.metas WHERE id=@id`);
      return { ok: true };
    }),
  );
