/*
 * As dependências do Gantt no servidor (Módulo 5, 18/11/2026).
 *
 * Uma dependência diz que a tarefa `tarefa_id` só começa quando `depende_de_id` terminar
 * (fim → início, "FS"); a tabela é `gestor.tarefa_dependencias` (script de 17/11/2026).
 *
 * Quem liga e desliga: quem pode replanejar a tarefa que ESPERA, a mesma trava do prazo
 * (`tarefasQuePodeReplanejar`): o responsável, quem criou, a chefia e a gerência. A outra
 * ponta só precisa estar à vista da pessoa. Decisão do usuário, 17/11/2026.
 *
 * Arquivo `.server.ts`: só o servidor importa. O SQL é montado com trechos fixos de
 * `permissoes.server.ts`; os ids entram sempre como parâmetro.
 */
import {
  SQL_CONTEUDO_DA_TAREFA,
  SQL_PREPARA_SUBORDINADOS,
  SQL_QUEM_SOU,
  SQL_VE_A_TAREFA,
} from "@/lib/permissoes.server";

/** Uma dependência, com os ids em minúsculas. */
export interface DependenciaDoGantt {
  /** A tarefa que espera. */
  tarefaId: string;
  /** A tarefa que precisa terminar antes. */
  dependeDeId: string;
}

const bit = (condicao: string) => `CASE WHEN ${condicao} THEN 1 ELSE 0 END`;

/** As dependências em que a pessoa vê as duas tarefas, nenhuma arquivada. */
export async function dependenciasVisiveis(eu: number): Promise<DependenciaDoGantt[]> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool.request().input("eu", sql.Int, eu).query(`${SQL_QUEM_SOU}
    ${SQL_PREPARA_SUBORDINADOS}
    SELECT d.tarefa_id, d.depende_de_id
      FROM gestor.tarefa_dependencias d
     WHERE EXISTS (SELECT 1 FROM gestor.tarefas t
                    WHERE t.id = d.tarefa_id AND t.arquivada_em IS NULL AND ${SQL_VE_A_TAREFA})
       AND EXISTS (SELECT 1 FROM gestor.tarefas t
                    WHERE t.id = d.depende_de_id AND t.arquivada_em IS NULL AND ${SQL_VE_A_TAREFA});`);
  return (r.recordset as { tarefa_id: string; depende_de_id: string }[]).map((l) => ({
    tarefaId: String(l.tarefa_id).toLowerCase(),
    dependeDeId: String(l.depende_de_id).toLowerCase(),
  }));
}

/**
 * O que a pessoa pode fazer com o par: vê as duas? pode replanejar a que espera? a ligação
 * já existe? criaria um ciclo (a outra já espera, direto ou por outras, por esta)? E o
 * título da que precisa terminar antes, para o histórico. Só leitura.
 *
 * O ciclo sobe pelas dependências a partir de `@d`; o `nivel` e o MAXRECURSION seguram a
 * busca se um dia houver um ciclo gravado por fora.
 */
const SQL_SITUACAO_DO_PAR = `
    DECLARE @ve_t BIT = 0, @ve_d BIT = 0, @pode BIT = 0, @existe BIT = 0, @ciclo BIT = 0,
            @titulo_d NVARCHAR(400) = NULL;
    SELECT @ve_t = ${bit(SQL_VE_A_TAREFA)},
           @pode = ${bit(`(${SQL_CONTEUDO_DA_TAREFA} OR t.responsavel_id = @eu)`)}
      FROM gestor.tarefas t WHERE t.id = @t AND t.arquivada_em IS NULL;
    SELECT @ve_d = ${bit(SQL_VE_A_TAREFA)}, @titulo_d = t.titulo
      FROM gestor.tarefas t WHERE t.id = @d AND t.arquivada_em IS NULL;
    IF EXISTS (SELECT 1 FROM gestor.tarefa_dependencias WHERE tarefa_id = @t AND depende_de_id = @d)
      SET @existe = 1;
    WITH espera (id, nivel) AS (
      SELECT depende_de_id, 1 FROM gestor.tarefa_dependencias WHERE tarefa_id = @d
      UNION ALL
      SELECT x.depende_de_id, e.nivel + 1
        FROM gestor.tarefa_dependencias x JOIN espera e ON x.tarefa_id = e.id
       WHERE e.nivel < 150)
    SELECT @ciclo = CASE WHEN EXISTS (SELECT 1 FROM espera WHERE id = @t) THEN 1 ELSE 0 END
    OPTION (MAXRECURSION 200);`;

interface SituacaoDoPar {
  ve_t: boolean;
  ve_d: boolean;
  pode: boolean;
  existe: boolean;
  ciclo: boolean;
  titulo_d: string | null;
}

const MENSAGEM_SEM_PERMISSAO =
  "Só o responsável, quem criou, a chefia ou a gerência ligam ou desligam dependências desta tarefa.";

async function situacaoDoPar(
  eu: number,
  tarefaId: string,
  dependeDeId: string,
  depois: string,
): Promise<SituacaoDoPar & { afetadas: number }> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("eu", sql.Int, eu)
    .input("t", sql.UniqueIdentifier, tarefaId)
    .input("d", sql.UniqueIdentifier, dependeDeId).query(`${SQL_QUEM_SOU}
      ${SQL_PREPARA_SUBORDINADOS}
      ${SQL_SITUACAO_DO_PAR}
      DECLARE @afetadas INT = 0;
      ${depois}
      SELECT @ve_t AS ve_t, @ve_d AS ve_d, @pode AS pode, @existe AS existe, @ciclo AS ciclo,
             @titulo_d AS titulo_d, @afetadas AS afetadas;`);
  const l = r.recordset[r.recordset.length - 1] as Record<string, unknown>;
  return {
    ve_t: !!l.ve_t,
    ve_d: !!l.ve_d,
    pode: !!l.pode,
    existe: !!l.existe,
    ciclo: !!l.ciclo,
    titulo_d: (l.titulo_d as string | null) ?? null,
    afetadas: Number(l.afetadas ?? 0),
  };
}

/**
 * Liga: `tarefaId` passa a esperar `dependeDeId`. Confere tudo e grava no MESMO comando
 * (sem janela entre conferir e gravar). Se a ligação já existia, não faz nada e diz que
 * deu certo. Registra no histórico da tarefa que espera.
 */
export async function ligarDependencia(
  eu: number,
  tarefaId: string,
  dependeDeId: string,
): Promise<"ligada" | "ja_existia"> {
  if (tarefaId.toLowerCase() === dependeDeId.toLowerCase()) {
    throw new Error("Uma tarefa não pode depender dela mesma.");
  }
  let s: SituacaoDoPar & { afetadas: number };
  try {
    s = await situacaoDoPar(
      eu,
      tarefaId,
      dependeDeId,
      `IF @ve_t = 1 AND @ve_d = 1 AND @pode = 1 AND @existe = 0 AND @ciclo = 0
       BEGIN
         INSERT INTO gestor.tarefa_dependencias (tarefa_id, depende_de_id, tipo, criado_por)
         VALUES (@t, @d, N'FS', @eu);
         SET @afetadas = @@ROWCOUNT;
       END`,
    );
  } catch (e) {
    /* Duas pessoas ligando o mesmo par ao mesmo tempo: a chave da tabela barra a segunda. */
    if ((e as { number?: number })?.number === 2627) return "ja_existia";
    throw e;
  }
  if (!s.ve_t || !s.ve_d) throw new Error("Tarefa não encontrada.");
  if (!s.pode) throw new Error(MENSAGEM_SEM_PERMISSAO);
  if (s.existe) return "ja_existia";
  if (s.ciclo) {
    throw new Error(
      `Isso criaria um ciclo: "${s.titulo_d ?? "a outra tarefa"}" já espera, direto ou por outras, por esta.`,
    );
  }
  if (s.afetadas > 0) {
    const { registrarNoHistorico } = await import("@/lib/historico.server");
    await registrarNoHistorico(tarefaId, eu, [
      { tipo: "editada", texto: `passou a depender de "${s.titulo_d ?? "outra tarefa"}"` },
    ]);
  }
  return "ligada";
}

/** Desliga: `tarefaId` deixa de esperar `dependeDeId`. Mesma regra de quem pode. */
export async function desligarDependencia(
  eu: number,
  tarefaId: string,
  dependeDeId: string,
): Promise<"desligada" | "nao_existia"> {
  const s = await situacaoDoPar(
    eu,
    tarefaId,
    dependeDeId,
    `IF @ve_t = 1 AND @pode = 1
     BEGIN
       DELETE FROM gestor.tarefa_dependencias WHERE tarefa_id = @t AND depende_de_id = @d;
       SET @afetadas = @@ROWCOUNT;
     END`,
  );
  if (!s.ve_t) throw new Error("Tarefa não encontrada.");
  if (!s.pode) throw new Error(MENSAGEM_SEM_PERMISSAO);
  if (s.afetadas === 0) return "nao_existia";
  const { registrarNoHistorico } = await import("@/lib/historico.server");
  await registrarNoHistorico(tarefaId, eu, [
    { tipo: "editada", texto: `deixou de depender de "${s.titulo_d ?? "outra tarefa"}"` },
  ]);
  return "desligada";
}
