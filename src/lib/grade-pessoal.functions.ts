import { createServerFn } from "@tanstack/react-start";
import { comSessao, comSessaoSemEntrada, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* A grade pessoal ("Minha visão") — colunas e células que só o dono vê.
 *
 * Duas colunas do navegador NÃO têm equivalente aqui, e é por desenho: `width`
 * (arraste de redimensionar) e `options` (a lista de uma coluna do tipo
 * "Lista") não existem em `gestor.grade_pessoal_colunas`. É o mesmo raciocínio
 * do tema e da paleta no bloco 1 — "recolhido ou não" é preferência de tela,
 * por máquina; a largura de uma coluna é a mesma coisa. `options`, por sua vez,
 * cabe folgado num JSON local e não muda a ponto de precisar sobreviver à
 * troca de computador no meio do dia. O que atravessa é o que a pessoa perderia
 * de verdade: os nomes das colunas que criou e o que escreveu em cada célula.
 */

const TIPOS = ["text", "number", "select", "date", "time", "datetime"] as const;

const guid = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
const texto = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export type ColunaDaGrade = { id: string; nome: string; tipo: (typeof TIPOS)[number]; ordem: number };
export type CelulaDaGrade = { tarefaId: string; colunaId: string; valor: string };

export const minhaGrade = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(
    async (eu): Promise<{ colunas: ColunaDaGrade[]; celulas: CelulaDaGrade[] }> => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();

      const [cols, cels] = await Promise.all([
        pool
          .request()
          .input("eu", sql.Int, eu)
          .query(
            `SELECT id, nome, tipo, ordem FROM gestor.grade_pessoal_colunas
              WHERE pessoa_id=@eu ORDER BY ordem`,
          ),
        pool
          .request()
          .input("eu", sql.Int, eu)
          .query(
            `SELECT tarefa_id, coluna_id, valor FROM gestor.grade_pessoal_celulas
              WHERE pessoa_id=@eu`,
          ),
      ]);

      return {
        colunas: (
          cols.recordset as { id: string; nome: string; tipo: string; ordem: number }[]
        ).map((c) => ({
          id: c.id,
          nome: c.nome,
          tipo: (TIPOS as readonly string[]).includes(c.tipo)
            ? (c.tipo as ColunaDaGrade["tipo"])
            : "text",
          ordem: c.ordem,
        })),
        celulas: (
          cels.recordset as { tarefa_id: string; coluna_id: string; valor: string | null }[]
        ).map((c) => ({ tarefaId: c.tarefa_id, colunaId: c.coluna_id, valor: c.valor ?? "" })),
      };
    },
  ),
);

/**
 * Cria ou atualiza colunas — nunca apaga.
 *
 * É um upsert por id, não um "regrava tudo". A diferença importa porque a
 * coluna é dona de célula por chave estrangeira com CASCADE: se esta função
 * apagasse e recriasse a lista a cada edição de nome, cada tecla digitada
 * varreria as células daquela coluna para debaixo do tapete. Apagar de verdade
 * é só `apagarColunaDaGrade`, e só quando a pessoa pede.
 */
export const salvarColunasDaGrade = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade(
      (e: { colunas?: { id: string; nome: string; tipo: string; ordem: number }[] }) => ({
        colunas: (Array.isArray(e?.colunas) ? e.colunas : [])
          .slice(0, 40) // teto generoso; ninguém precisa de mais colunas do que isso numa grade pessoal
          .map((c) => ({
            id: guid(c?.id),
            nome: texto(c?.nome, 80),
            tipo: (TIPOS as readonly string[]).includes(c?.tipo) ? c.tipo : "text",
            ordem: Math.max(0, Math.min(999, Math.trunc(Number(c?.ordem) || 0))),
          }))
          .filter((c): c is { id: string; nome: string; tipo: string; ordem: number } =>
            Boolean(c.id && c.nome),
          ),
      }),
    ),
  )
  .handler(
    comSessao(
      async (eu, d: { colunas: { id: string; nome: string; tipo: string; ordem: number }[] }) => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        for (const c of d.colunas) {
          await pool
            .request()
            .input("id", sql.UniqueIdentifier, c.id)
            .input("pessoa", sql.Int, eu)
            .input("nome", sql.NVarChar, c.nome)
            .input("tipo", sql.NVarChar, c.tipo)
            .input("ordem", sql.Int, c.ordem)
            .query(
              `IF EXISTS (SELECT 1 FROM gestor.grade_pessoal_colunas WHERE id=@id AND pessoa_id=@pessoa)
                 UPDATE gestor.grade_pessoal_colunas
                    SET nome=@nome, tipo=@tipo, ordem=@ordem
                  WHERE id=@id AND pessoa_id=@pessoa
               ELSE
                 INSERT INTO gestor.grade_pessoal_colunas (id, pessoa_id, nome, tipo, ordem)
                 VALUES (@id, @pessoa, @nome, @tipo, @ordem)`,
            );
        }
        return { ok: true };
      },
    ),
  );

export const apagarColunaDaGrade = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { id: string }) => {
      const id = guid(e?.id);
      if (!id) throw new Error("Coluna inválida");
      return { id };
    }),
  )
  .handler(
    comSessao(async (eu, d: { id: string }) => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      // As células saem por cascata — conferido em sys.foreign_keys.
      await pool
        .request()
        .input("id", sql.UniqueIdentifier, d.id)
        .input("pessoa", sql.Int, eu)
        .query(`DELETE FROM gestor.grade_pessoal_colunas WHERE id=@id AND pessoa_id=@pessoa`);
      return { ok: true };
    }),
  );

/**
 * Grava um lote de células. Valor vazio apaga a célula, não grava vazio —
 * a tabela não distingue "nunca preenchido" de "preenchido e limpo depois", e
 * não precisa: das duas, só a primeira importa para alguém que abre a grade.
 */
export const salvarCelulasDaGrade = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { celulas?: { tarefaId: string; colunaId: string; valor: string }[] }) => ({
      celulas: (Array.isArray(e?.celulas) ? e.celulas : [])
        .slice(0, 200)
        .map((c) => ({
          tarefaId: guid(c?.tarefaId),
          colunaId: guid(c?.colunaId),
          valor: texto(c?.valor, 400),
        }))
        .filter(
          (c): c is { tarefaId: string; colunaId: string; valor: string } =>
            Boolean(c.tarefaId && c.colunaId),
        ),
    })),
  )
  .handler(
    comSessao(
      async (eu, d: { celulas: { tarefaId: string; colunaId: string; valor: string }[] }) => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        for (const c of d.celulas) {
          const req = pool
            .request()
            .input("pessoa", sql.Int, eu)
            .input("tarefa", sql.UniqueIdentifier, c.tarefaId)
            .input("coluna", sql.UniqueIdentifier, c.colunaId);
          if (!c.valor) {
            await req.query(
              `DELETE FROM gestor.grade_pessoal_celulas
                WHERE pessoa_id=@pessoa AND tarefa_id=@tarefa AND coluna_id=@coluna`,
            );
            continue;
          }
          await req.input("valor", sql.NVarChar, c.valor).query(
            `IF EXISTS (SELECT 1 FROM gestor.grade_pessoal_celulas
                         WHERE pessoa_id=@pessoa AND tarefa_id=@tarefa AND coluna_id=@coluna)
               UPDATE gestor.grade_pessoal_celulas SET valor=@valor
                WHERE pessoa_id=@pessoa AND tarefa_id=@tarefa AND coluna_id=@coluna
             ELSE
               INSERT INTO gestor.grade_pessoal_celulas (pessoa_id, tarefa_id, coluna_id, valor)
               VALUES (@pessoa, @tarefa, @coluna, @valor)`,
          );
        }
        return { ok: true };
      },
    ),
  );
