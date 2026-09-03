import { createServerFn } from "@tanstack/react-start";
import { comSessao, comSessaoSemEntrada, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* Projetos — bloco B.
 *
 * Vem antes da tarefa por uma razão medida, não por gosto: `gestor.tarefas`
 * tem chave estrangeira para `gestor.projetos`. Sem projeto no banco, a tarefa
 * não entra.
 *
 * E é aqui que o anexo de projeto se destrava. Ele já estava pronto do lado do
 * servidor; faltava o projeto ter id de banco para o anexo poder apontar.
 */

export type ProjetoDoBanco = {
  id: string;
  idLegado: string | null;
  name: string;
  description?: string;
  status: "ativo" | "pausado" | "concluido";
  ownerId: string;
  memberIds: string[];
  sector?: string;
  dueDate?: string;
  createdAt: string;
  createdBy: string;
  color?: string;
};

const SITUACOES = ["ativo", "pausado", "concluido"] as const;

const pessoa = (v: unknown): number => {
  const n = Number(typeof v === "string" || typeof v === "number" ? v : NaN);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Pessoa inválida");
  return n;
};

const texto = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/**
 * Todos os projetos, com os membros de cada um.
 *
 * Duas consultas e uma junção em memória, em vez de uma junção no SQL: com
 * `JOIN`, um projeto de dez membros volta dez vezes, e o cliente teria que
 * desduplicar. São poucas linhas nos dois casos — a empresa não tem milhares
 * de projetos — e assim a resposta já sai na forma que a interface espera.
 */
export const listarProjetos = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (): Promise<{ projetos: ProjetoDoBanco[] }> => {
    const { getPool } = await import("@/integrations/db.server");
    const pool = await getPool();

    const [p, m] = await Promise.all([
      pool.request().query(
        `SELECT id, id_legado, nome, descricao, situacao, dono_id, setor,
                prazo, cor, criado_por, criado_em
           FROM gestor.projetos ORDER BY criado_em DESC`,
      ),
      pool
        .request()
        .query(`SELECT projeto_id, pessoa_id FROM gestor.projeto_membros`),
    ]);

    const membros = new Map<string, string[]>();
    for (const l of m.recordset as { projeto_id: string; pessoa_id: number }[]) {
      const atual = membros.get(l.projeto_id) ?? [];
      atual.push(String(l.pessoa_id));
      membros.set(l.projeto_id, atual);
    }

    return {
      projetos: (
        p.recordset as {
          id: string;
          id_legado: string | null;
          nome: string;
          descricao: string | null;
          situacao: string;
          dono_id: number;
          setor: string | null;
          prazo: Date | null;
          cor: string | null;
          criado_por: number;
          criado_em: Date;
        }[]
      ).map((x) => ({
        id: x.id,
        idLegado: x.id_legado,
        name: x.nome,
        description: x.descricao ?? undefined,
        status: (SITUACOES as readonly string[]).includes(x.situacao)
          ? (x.situacao as ProjetoDoBanco["status"])
          : "ativo",
        // `User.id` é string no app inteiro.
        ownerId: String(x.dono_id),
        memberIds: membros.get(x.id) ?? [],
        sector: x.setor ?? undefined,
        dueDate: x.prazo ? x.prazo.toISOString() : undefined,
        createdAt: x.criado_em.toISOString(),
        createdBy: String(x.criado_por),
        color: x.cor ?? undefined,
      })),
    };
  }),
);

/**
 * Cria ou atualiza o projeto, com os membros.
 *
 * O `idLegado` guarda o id antigo do navegador (`p-mf3k2a-x9d1`) durante a
 * travessia. É a premissa 4 do schema em uso: ele permite conferir depois que
 * nada se perdeu, e permite ao cliente reconhecer que o projeto que ele tinha
 * localmente é este que voltou do banco — sem isso, a primeira sincronização
 * duplicaria tudo.
 */
export const salvarProjeto = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade(
      (e: {
        id?: string;
        idLegado?: string;
        name: string;
        description?: string;
        status?: string;
        ownerId?: string;
        memberIds?: string[];
        sector?: string;
        dueDate?: string;
        color?: string;
      }) => {
        const nome = texto(e?.name, 120);
        if (!nome) throw new Error("O projeto precisa de um nome");

        const id = typeof e?.id === "string" && /^[0-9a-f-]{36}$/i.test(e.id) ? e.id : null;
        const status = (SITUACOES as readonly string[]).includes(e?.status ?? "")
          ? (e!.status as ProjetoDoBanco["status"])
          : "ativo";

        const prazo =
          typeof e?.dueDate === "string" && !Number.isNaN(Date.parse(e.dueDate))
            ? new Date(e.dueDate)
            : null;

        return {
          id,
          idLegado: texto(e?.idLegado, 60) || null,
          nome,
          descricao: texto(e?.description, 100_000) || null,
          status,
          // Sem dono informado, o dono é quem está salvando — resolvido no corpo.
          donoId: e?.ownerId ? pessoa(e.ownerId) : null,
          membros: Array.isArray(e?.memberIds) ? e.memberIds.map(pessoa) : [],
          setor: texto(e?.sector, 40) || null,
          prazo,
          cor: texto(e?.color, 40) || null,
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
          idLegado: string | null;
          nome: string;
          descricao: string | null;
          status: string;
          donoId: number | null;
          membros: number[];
          setor: string | null;
          prazo: Date | null;
          cor: string | null;
        },
      ): Promise<{ id: string }> => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const dono = d.donoId ?? eu;

        const req = pool
          .request()
          .input("id", sql.UniqueIdentifier, d.id)
          .input("id_legado", sql.NVarChar, d.idLegado)
          .input("nome", sql.NVarChar, d.nome)
          .input("descricao", sql.NVarChar(sql.MAX), d.descricao)
          .input("situacao", sql.NVarChar, d.status)
          .input("dono", sql.Int, dono)
          .input("setor", sql.NVarChar, d.setor)
          .input("prazo", sql.DateTimeOffset, d.prazo)
          .input("cor", sql.NVarChar, d.cor)
          .input("por", sql.Int, eu);

        /* `OUTPUT INSERTED.id` no INSERT devolve o GUID que o banco gerou —
           é ele que o cliente passa a usar, e é o que permite ao anexo do
           projeto existir. Sem isso o cliente ficaria sem saber o id novo. */
        const r = await req.query(
          `IF @id IS NOT NULL AND EXISTS (SELECT 1 FROM gestor.projetos WHERE id=@id)
             BEGIN
               UPDATE gestor.projetos
                  SET nome=@nome, descricao=@descricao, situacao=@situacao,
                      dono_id=@dono, setor=@setor, prazo=@prazo, cor=@cor
                WHERE id=@id;
               SELECT @id AS id;
             END
           ELSE
             INSERT INTO gestor.projetos
               (id_legado, nome, descricao, situacao, dono_id, setor, prazo, cor, criado_por)
             OUTPUT INSERTED.id
             VALUES (@id_legado, @nome, @descricao, @situacao, @dono, @setor, @prazo, @cor, @por);`,
        );
        const id = (r.recordset[0] as { id: string }).id;

        /* Membros: apaga e regrava.
           A lista é pequena (pessoas de um projeto) e vem inteira do cliente.
           Comparar o que entrou e o que saiu daria três consultas e um bug a
           mais para manter — trocar o conjunto de uma vez é o mesmo resultado
           com metade do código. O dono entra sempre, mesmo que a interface
           esqueça de incluí-lo. */
        const membros = [...new Set([dono, ...d.membros])];
        await pool
          .request()
          .input("pid", sql.UniqueIdentifier, id)
          .query(`DELETE FROM gestor.projeto_membros WHERE projeto_id=@pid`);
        for (const p of membros) {
          await pool
            .request()
            .input("pid", sql.UniqueIdentifier, id)
            .input("pessoa", sql.Int, p)
            .query(
              `INSERT INTO gestor.projeto_membros (projeto_id, pessoa_id) VALUES (@pid, @pessoa)`,
            );
        }

        return { id };
      },
    ),
  );

export const apagarProjeto = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { id: string }) => {
      const id = typeof e?.id === "string" ? e.id.trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Projeto inválido");
      return { id };
    }),
  )
  .handler(
    comSessao(async (_eu, d: { id: string }) => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      // Os membros saem por cascata (a chave estrangeira cuida). As tarefas do
      // projeto NÃO são apagadas — elas continuam existindo sem projeto, que é
      // o comportamento de hoje na tela.
      await pool
        .request()
        .input("id", sql.UniqueIdentifier, d.id)
        .query(`DELETE FROM gestor.projetos WHERE id=@id`);
      return { ok: true };
    }),
  );
