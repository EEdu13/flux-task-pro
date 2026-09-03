import { createServerFn } from "@tanstack/react-start";
import { comSessao, comSessaoSemEntrada, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* Modelos de pack — bloco B.
 *
 * Um modelo é uma lista de compromissos diários que se aplica a um cargo ou a
 * uma pessoa. Hoje ele vive no navegador de quem o criou, o que torna a ideia
 * inteira inútil: um modelo para "Supervisor de Operações" só serve se outros
 * supervisores puderem recebê-lo.
 *
 * Duas tabelas porque a lista de itens é variável. O CHECK do banco impõe a
 * regra que a tela também impõe: modelo de cargo tem cargo e não tem pessoa;
 * modelo de pessoa tem pessoa e não tem cargo. Nunca os dois, nunca nenhum.
 */

export type ItemDePack = { id: string; title: string; estimatedMinutes?: number };

export type PackDoBanco = {
  id: string;
  name: string;
  description?: string;
  scope: "cargo" | "pessoa";
  targetJobTitle?: string;
  targetUserId?: string;
  items: ItemDePack[];
  createdBy: string;
  createdAt: string;
};

const texto = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export const listarPacks = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (): Promise<{ packs: PackDoBanco[] }> => {
    const { getPool } = await import("@/integrations/db.server");
    const pool = await getPool();

    const [m, i] = await Promise.all([
      pool.request().query(
        `SELECT id, nome, descricao, alvo_tipo, alvo_cargo, alvo_pessoa_id,
                criado_por, criado_em
           FROM gestor.modelos_de_pack ORDER BY criado_em DESC`,
      ),
      pool.request().query(
        `SELECT id, modelo_id, titulo, minutos_estimados
           FROM gestor.itens_do_modelo_de_pack ORDER BY ordem`,
      ),
    ]);

    const porModelo = new Map<string, ItemDePack[]>();
    for (const l of i.recordset as {
      id: string;
      modelo_id: string;
      titulo: string;
      minutos_estimados: number | null;
    }[]) {
      const atual = porModelo.get(l.modelo_id) ?? [];
      atual.push({
        id: l.id,
        title: l.titulo,
        estimatedMinutes: l.minutos_estimados ?? undefined,
      });
      porModelo.set(l.modelo_id, atual);
    }

    return {
      packs: (
        m.recordset as {
          id: string;
          nome: string;
          descricao: string | null;
          alvo_tipo: string;
          alvo_cargo: string | null;
          alvo_pessoa_id: number | null;
          criado_por: number;
          criado_em: Date;
        }[]
      ).map((x) => ({
        id: x.id,
        name: x.nome,
        description: x.descricao ?? undefined,
        scope: x.alvo_tipo === "pessoa" ? "pessoa" : "cargo",
        targetJobTitle: x.alvo_cargo ?? undefined,
        targetUserId: x.alvo_pessoa_id === null ? undefined : String(x.alvo_pessoa_id),
        items: porModelo.get(x.id) ?? [],
        createdBy: String(x.criado_por),
        createdAt: x.criado_em.toISOString(),
      })),
    };
  }),
);

export const salvarPack = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade(
      (e: {
        id?: string;
        name: string;
        description?: string;
        scope: string;
        targetJobTitle?: string;
        targetUserId?: string;
        items?: { title: string; estimatedMinutes?: number }[];
      }) => {
        const nome = texto(e?.name, 120);
        if (!nome) throw new Error("O modelo precisa de um nome");

        /* A mesma regra do CHECK do banco, conferida aqui para a mensagem de
           erro ser legível. Sem isto o banco recusaria com "violação de
           restrição CK_...", que não diz nada a quem está usando a tela. */
        const scope = e?.scope === "pessoa" ? "pessoa" : "cargo";
        const cargo = texto(e?.targetJobTitle, 120) || null;
        const pessoaId = e?.targetUserId ? Number(e.targetUserId) : null;

        if (scope === "cargo" && !cargo) throw new Error("Escolha o cargo do modelo");
        if (scope === "pessoa" && (!pessoaId || !Number.isInteger(pessoaId))) {
          throw new Error("Escolha a pessoa do modelo");
        }

        const items = (Array.isArray(e?.items) ? e.items : [])
          .map((it) => ({
            title: texto(it?.title, 200),
            estimatedMinutes:
              Number.isFinite(Number(it?.estimatedMinutes)) && Number(it.estimatedMinutes) > 0
                ? Math.min(24 * 60, Math.trunc(Number(it.estimatedMinutes)))
                : null,
          }))
          .filter((it) => it.title);

        if (!items.length) throw new Error("O modelo precisa de pelo menos um item");

        return {
          id: typeof e?.id === "string" && /^[0-9a-f-]{36}$/i.test(e.id) ? e.id : null,
          nome,
          descricao: texto(e?.description, 500) || null,
          // As duas colunas do alvo são exclusivas: a que não vale vai NULL.
          alvoTipo: scope,
          alvoCargo: scope === "cargo" ? cargo : null,
          alvoPessoa: scope === "pessoa" ? pessoaId : null,
          items,
        };
      },
    ),
  )
  .handler(
    comSessao(
      async (
        eu,
        d: {
          id: string | null;
          nome: string;
          descricao: string | null;
          alvoTipo: string;
          alvoCargo: string | null;
          alvoPessoa: number | null;
          items: { title: string; estimatedMinutes: number | null }[];
        },
      ): Promise<{ id: string }> => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();

        const r = await pool
          .request()
          .input("id", sql.UniqueIdentifier, d.id)
          .input("nome", sql.NVarChar, d.nome)
          .input("descricao", sql.NVarChar, d.descricao)
          .input("tipo", sql.NVarChar, d.alvoTipo)
          .input("cargo", sql.NVarChar, d.alvoCargo)
          .input("pessoa", sql.Int, d.alvoPessoa)
          .input("por", sql.Int, eu)
          .query(
            `IF @id IS NOT NULL AND EXISTS (SELECT 1 FROM gestor.modelos_de_pack WHERE id=@id)
               BEGIN
                 UPDATE gestor.modelos_de_pack
                    SET nome=@nome, descricao=@descricao, alvo_tipo=@tipo,
                        alvo_cargo=@cargo, alvo_pessoa_id=@pessoa
                  WHERE id=@id;
                 SELECT @id AS id;
               END
             ELSE
               INSERT INTO gestor.modelos_de_pack
                 (nome, descricao, alvo_tipo, alvo_cargo, alvo_pessoa_id, criado_por)
               OUTPUT INSERTED.id
               VALUES (@nome, @descricao, @tipo, @cargo, @pessoa, @por);`,
          );
        const id = (r.recordset[0] as { id: string }).id;

        /* Itens: apaga e regrava, como os membros do projeto.
           A ordem importa aqui (o pack é uma sequência de compromissos), e a
           posição no array é a ordem — reaproveitar linhas antigas exigiria
           casar item por item e ainda assim regravar a ordem de todos. */
        await pool
          .request()
          .input("mid", sql.UniqueIdentifier, id)
          .query(`DELETE FROM gestor.itens_do_modelo_de_pack WHERE modelo_id=@mid`);

        for (const [ordem, it] of d.items.entries()) {
          await pool
            .request()
            .input("mid", sql.UniqueIdentifier, id)
            .input("titulo", sql.NVarChar, it.title)
            .input("minutos", sql.Int, it.estimatedMinutes)
            .input("ordem", sql.Int, ordem)
            .query(
              `INSERT INTO gestor.itens_do_modelo_de_pack
                 (modelo_id, titulo, minutos_estimados, ordem)
               VALUES (@mid, @titulo, @minutos, @ordem)`,
            );
        }

        return { id };
      },
    ),
  );

export const apagarPack = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { id: string }) => {
      const id = typeof e?.id === "string" ? e.id.trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Modelo inválido");
      return { id };
    }),
  )
  .handler(
    comSessao(async (_eu, d: { id: string }) => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      // Os itens saem por cascata, pela chave estrangeira.
      await pool
        .request()
        .input("id", sql.UniqueIdentifier, d.id)
        .query(`DELETE FROM gestor.modelos_de_pack WHERE id=@id`);
      return { ok: true };
    }),
  );
