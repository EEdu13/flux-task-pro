import { createServerFn } from "@tanstack/react-start";
import { comSessao, comSessaoSemEntrada, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* Quantas vezes cada pessoa chamou cada outra, por sala.
 *
 * Terceira e última das sem dependência. É o que ordena "quem você mais chama"
 * no card da sala e a lista de contatos recentes — atalhos que hoje se perdem
 * inteiros ao trocar de computador, porque a contagem mora no navegador.
 *
 * A tabela é um CONTADOR, não um histórico: a chave primária é
 * (de_pessoa_id, sala, para_pessoa_id) e a coluna `vezes` acumula. Quem guarda
 * o histórico de cada chamada é `gestor.chamadas`, que é outra coisa. Confundir
 * as duas foi o erro que quase cometi na migração das salas: o nome
 * `contagem_de_chamadas` parecia substituir `room_call_events`, e não
 * substituía.
 */

export type ContagemDoBanco = {
  /** Sempre o id de quem está logado — a tabela é lida do próprio ponto de vista. */
  sala: string;
  paraPessoaId: string;
  vezes: number;
  ultimaEm: string;
};

const sala = (v: unknown): string => {
  if (typeof v !== "string") throw new Error("Sala inválida");
  const s = v.trim().slice(0, 80);
  if (!s || !/^[a-zA-Z0-9_-]+$/.test(s)) throw new Error("Sala inválida");
  return s;
};

const pessoaAlvo = (v: unknown): number => {
  const n = Number(typeof v === "string" || typeof v === "number" ? v : NaN);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Usuário inválido");
  return n;
};

/** As minhas contagens. Nunca as de outra pessoa — o `de_pessoa_id` é a sessão. */
export const minhasContagens = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ contagens: ContagemDoBanco[] }> => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("eu", sql.Int, eu)
      .query(
        `SELECT sala, para_pessoa_id, vezes, ultima_em
           FROM gestor.contagem_de_chamadas
          WHERE de_pessoa_id=@eu
          ORDER BY ultima_em DESC`,
      );
    return {
      contagens: (
        r.recordset as {
          sala: string;
          para_pessoa_id: number;
          vezes: number;
          ultima_em: Date;
        }[]
      ).map((c) => ({
        sala: c.sala,
        // `User.id` é string no app inteiro.
        paraPessoaId: String(c.para_pessoa_id),
        vezes: c.vezes,
        ultimaEm: c.ultima_em.toISOString(),
      })),
    };
  }),
);

/**
 * Soma uma chamada.
 *
 * Chamado junto com `createRoomCall`, e de propósito não dentro dele: chamar
 * alguém e contar que você chamou são coisas diferentes. Se a contagem falhar,
 * a chamada continua tocando — perder um atalho de conveniência não pode
 * derrubar uma ligação.
 */
export const somarChamada = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { sala: string; paraPessoaId: string }) => ({
      sala: sala(e?.sala),
      paraPessoaId: pessoaAlvo(e?.paraPessoaId),
    })),
  )
  .handler(
    comSessao(async (eu, d: { sala: string; paraPessoaId: number }) => {
      if (eu === d.paraPessoaId) return { ok: true };

      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      /* Soma se já existe, cria com 1 se não. O `vezes = vezes + 1` acontece
         dentro do banco, e não lendo-somando-gravando aqui: duas chamadas
         seguidas para a mesma pessoa perderiam uma contagem se o cálculo
         fosse feito fora. */
      await pool
        .request()
        .input("de", sql.Int, eu)
        .input("sala", sql.NVarChar, d.sala)
        .input("para", sql.Int, d.paraPessoaId)
        .query(
          `IF EXISTS (SELECT 1 FROM gestor.contagem_de_chamadas
                       WHERE de_pessoa_id=@de AND sala=@sala AND para_pessoa_id=@para)
             UPDATE gestor.contagem_de_chamadas
                SET vezes = vezes + 1, ultima_em = SYSDATETIMEOFFSET()
              WHERE de_pessoa_id=@de AND sala=@sala AND para_pessoa_id=@para;
           ELSE
             INSERT INTO gestor.contagem_de_chamadas (de_pessoa_id, sala, para_pessoa_id, vezes)
             VALUES (@de, @sala, @para, 1);`,
        );
      return { ok: true };
    }),
  );
