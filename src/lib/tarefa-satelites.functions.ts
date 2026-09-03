import { createServerFn } from "@tanstack/react-start";
import { comSessao, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* Bloco D — o que pende da tarefa.
 *
 * Checklist, comentários, histórico, menções, etiquetas e recorrência semanal.
 * Sete tabelas que só existem em função de uma linha em `gestor.tarefas`, e por
 * isso todas com `ON DELETE CASCADE`: some a tarefa, some o que era dela.
 *
 * Tudo aqui é gravado em bloco, por tarefa. A alternativa — uma função por
 * item de checklist, outra por comentário — daria uma requisição por tecla
 * digitada e sete caminhos de erro para manter. Como a tarefa inteira já é
 * regravada a cada mudança em `salvarTarefa`, os satélites acompanham no mesmo
 * ritmo.
 *
 * A exceção é o comentário, que tem função própria: ele é a única coisa aqui
 * que uma OUTRA pessoa acrescenta à sua tarefa, e o autor precisa ser a sessão
 * de quem escreveu, não de quem salvou a tarefa por último.
 */

const guid = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;

const texto = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const TIPOS_HISTORICO = [
  "criada",
  "status",
  "atribuicao",
  "comentario",
  "checklist",
  "editada",
  "concluida",
  "mencao",
] as const;

export type SatelitesDaTarefa = {
  checklist: { id: string; text: string; done: boolean }[];
  mentions: string[];
  tags: string[];
  recurringWeekdays: number[];
  comments: { id: string; userId: string; text: string; at: string }[];
  activity: { id: string; userId: string; kind: string; text: string; at: string }[];
};

/** Tudo que pende de uma tarefa, numa consulta por tabela. */
export const carregarSatelites = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { tarefaId: string }) => {
      const id = guid(e?.tarefaId);
      if (!id) throw new Error("Tarefa inválida");
      return { tarefaId: id };
    }),
  )
  .handler(
    comSessao(async (_eu, d: { tarefaId: string }): Promise<SatelitesDaTarefa> => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const req = () => pool.request().input("t", sql.UniqueIdentifier, d.tarefaId);

      const [ck, mc, tg, dr, cm, hs] = await Promise.all([
        req().query(
          `SELECT id, texto, feito FROM gestor.itens_de_checklist
            WHERE tarefa_id=@t ORDER BY ordem`,
        ),
        req().query(`SELECT pessoa_id FROM gestor.mencoes WHERE tarefa_id=@t`),
        req().query(
          `SELECT e.nome FROM gestor.tarefa_etiquetas te
             JOIN gestor.etiquetas e ON e.id = te.etiqueta_id
            WHERE te.tarefa_id=@t`,
        ),
        req().query(
          `SELECT dia_da_semana FROM gestor.dias_de_recorrencia WHERE tarefa_id=@t
            ORDER BY dia_da_semana`,
        ),
        req().query(
          `SELECT id, autor_id, texto, criado_em FROM gestor.comentarios
            WHERE tarefa_id=@t ORDER BY criado_em`,
        ),
        req().query(
          `SELECT id, autor_id, tipo, texto, em FROM gestor.historico_da_tarefa
            WHERE tarefa_id=@t ORDER BY em`,
        ),
      ]);

      return {
        checklist: (ck.recordset as { id: string; texto: string; feito: boolean }[]).map((i) => ({
          id: i.id,
          text: i.texto,
          done: !!i.feito,
        })),
        // `User.id` é string na interface inteira.
        mentions: (mc.recordset as { pessoa_id: number }[]).map((m) => String(m.pessoa_id)),
        tags: (tg.recordset as { nome: string }[]).map((t) => t.nome),
        recurringWeekdays: (dr.recordset as { dia_da_semana: number }[]).map((x) => x.dia_da_semana),
        comments: (
          cm.recordset as { id: string; autor_id: number; texto: string; criado_em: Date }[]
        ).map((c) => ({
          id: c.id,
          userId: String(c.autor_id),
          text: c.texto,
          at: c.criado_em.toISOString(),
        })),
        activity: (
          hs.recordset as {
            id: string;
            autor_id: number;
            tipo: string;
            texto: string;
            em: Date;
          }[]
        ).map((a) => ({
          id: a.id,
          userId: String(a.autor_id),
          kind: a.tipo,
          text: a.texto,
          at: a.em.toISOString(),
        })),
      };
    }),
  );

/**
 * Regrava checklist, menções, etiquetas e recorrência de uma tarefa.
 *
 * Apaga e reinsere, como os membros do projeto. São listas curtas que chegam
 * inteiras do cliente; comparar item a item daria três consultas por lista e um
 * bug a mais para manter, com o mesmo resultado.
 *
 * Comentários e histórico NÃO entram aqui: eles só crescem, nunca são
 * reescritos em bloco. Regravá-los apagaria o comentário que outra pessoa
 * escreveu enquanto esta tinha a tarefa aberta.
 */
export const salvarSatelites = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade(
      (e: {
        tarefaId: string;
        checklist?: { id?: string; text: string; done?: boolean }[];
        mentions?: string[];
        tags?: string[];
        recurringWeekdays?: number[];
      }) => {
        const tarefaId = guid(e?.tarefaId);
        if (!tarefaId) throw new Error("Tarefa inválida");

        return {
          tarefaId,
          checklist: (Array.isArray(e?.checklist) ? e.checklist : [])
            .map((i) => ({ text: texto(i?.text, 300), done: i?.done === true }))
            .filter((i) => i.text),
          mentions: [
            ...new Set(
              (Array.isArray(e?.mentions) ? e.mentions : [])
                .map((m) => Number(m))
                .filter((n) => Number.isInteger(n) && n > 0),
            ),
          ],
          tags: [
            ...new Set(
              (Array.isArray(e?.tags) ? e.tags : [])
                .map((t) => texto(t, 40))
                .filter(Boolean),
            ),
          ],
          // 0 = domingo … 6 = sábado. É o que o CHECK da tabela aceita.
          recurringWeekdays: [
            ...new Set(
              (Array.isArray(e?.recurringWeekdays) ? e.recurringWeekdays : [])
                .map((d) => Number(d))
                .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
            ),
          ],
        };
      },
    ),
  )
  .handler(
    comSessao(
      async (
        eu,
        d: {
          tarefaId: string;
          checklist: { text: string; done: boolean }[];
          mentions: number[];
          tags: string[];
          recurringWeekdays: number[];
        },
      ) => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const comTarefa = () => pool.request().input("t", sql.UniqueIdentifier, d.tarefaId);

        // --- Checklist ---
        await comTarefa().query(`DELETE FROM gestor.itens_de_checklist WHERE tarefa_id=@t`);
        for (const [ordem, item] of d.checklist.entries()) {
          await comTarefa()
            .input("texto", sql.NVarChar, item.text)
            .input("feito", sql.Bit, item.done)
            .input("ordem", sql.Int, ordem)
            .query(
              `INSERT INTO gestor.itens_de_checklist (tarefa_id, texto, feito, ordem)
               VALUES (@t, @texto, @feito, @ordem)`,
            );
        }

        /* --- Menções ---
           Quem já estava mencionado, lido ANTES do apaga-e-regrava. É a
           diferença entre os dois conjuntos que vira aviso: sem essa leitura,
           toda gravação da tarefa avisaria de novo as mesmas pessoas, e
           mencionar alguém uma vez renderia uma notificação por clique em
           salvar — que é mais ou menos a definição de sineta ignorada. */
        const antes = await comTarefa().query(
          `SELECT pessoa_id FROM gestor.mencoes WHERE tarefa_id=@t`,
        );
        const jaMencionados = new Set(
          (antes.recordset as { pessoa_id: number }[]).map((m) => m.pessoa_id),
        );

        await comTarefa().query(`DELETE FROM gestor.mencoes WHERE tarefa_id=@t`);
        for (const p of d.mentions) {
          await comTarefa()
            .input("p", sql.Int, p)
            .query(`INSERT INTO gestor.mencoes (tarefa_id, pessoa_id) VALUES (@t, @p)`);
        }

        /* O aviso da menção nasce aqui porque é aqui que a menção existe —
           `salvarTarefa` grava a tarefa e não enxerga esta lista. Quem se
           menciona não recebe nada, e o texto do aviso vem do título gravado na
           tabela, não de um campo que o navegador mandaria junto.

           O `responsavel_id <> @p` evita o aviso em dobro. Criar uma tarefa para
           o João e mencionar o João são a mesma intenção, e sem esta linha ele
           receberia "Nova tarefa" e "Você foi mencionado" pela mesma coisa. É
           também o que segura o pack: cada tarefa dele menciona o destinatário,
           então dez tarefas virariam dez menções e a supressão por `no_pack` do
           lado de `salvarTarefa` não teria servido para nada.

           O preço é estreito e conhecido: mencionar alguém numa tarefa que já é
           dela deixa de avisar. Quem é dono da tarefa já a vê no quadro. */
        for (const p of d.mentions.filter((x) => x !== eu && !jaMencionados.has(x))) {
          await comTarefa()
            .input("p", sql.Int, p)
            .input("de", sql.Int, eu)
            .query(
              `INSERT INTO gestor.notificacoes
                 (destinatario_id, de_pessoa_id, tipo, titulo, descricao, tarefa_id)
               SELECT @p, @de, 'mencao', N'Você foi mencionado', t.titulo, t.id
                 FROM gestor.tarefas t
                WHERE t.id=@t AND t.responsavel_id <> @p`,
            );
        }

        // --- Dias de recorrência ---
        await comTarefa().query(`DELETE FROM gestor.dias_de_recorrencia WHERE tarefa_id=@t`);
        for (const dia of d.recurringWeekdays) {
          await comTarefa()
            .input("d", sql.TinyInt, dia)
            .query(
              `INSERT INTO gestor.dias_de_recorrencia (tarefa_id, dia_da_semana) VALUES (@t, @d)`,
            );
        }

        /* --- Etiquetas ---
           A etiqueta é COMPARTILHADA: "Urgente" é a mesma para todo mundo, e a
           tabela guarda uma linha por nome, não uma por tarefa. Por isso o
           padrão aqui é diferente — cria se não existir, e só então liga.
           Sem isso, cada tarefa criaria a sua "Urgente" e a lista de etiquetas
           viraria uma lista de repetições. */
        await comTarefa().query(`DELETE FROM gestor.tarefa_etiquetas WHERE tarefa_id=@t`);
        for (const nome of d.tags) {
          const r = await pool
            .request()
            .input("nome", sql.NVarChar, nome)
            .input("por", sql.Int, eu)
            .query(
              `INSERT INTO gestor.etiquetas (nome, criada_por)
               SELECT @nome, @por
                WHERE NOT EXISTS (SELECT 1 FROM gestor.etiquetas WHERE nome=@nome);

               SELECT id FROM gestor.etiquetas WHERE nome=@nome;`,
            );
          const etiquetaId = (r.recordset[0] as { id: string } | undefined)?.id;
          if (!etiquetaId) continue;

          await comTarefa()
            .input("e", sql.UniqueIdentifier, etiquetaId)
            .query(
              `INSERT INTO gestor.tarefa_etiquetas (tarefa_id, etiqueta_id) VALUES (@t, @e)`,
            );
        }

        return { ok: true };
      },
    ),
  );

/**
 * Acrescenta um comentário.
 *
 * Função separada porque o autor precisa ser a sessão de quem ESCREVEU. Se o
 * comentário viajasse junto com o resto da tarefa, o autor seria quem salvou a
 * tarefa por último — e um comentário assinado pela pessoa errada é pior que
 * comentário nenhum.
 */
export const comentarNaTarefa = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { tarefaId: string; texto: string }) => {
      const tarefaId = guid(e?.tarefaId);
      if (!tarefaId) throw new Error("Tarefa inválida");
      const t = texto(e?.texto, 100_000);
      if (!t) throw new Error("Comentário vazio");
      return { tarefaId, texto: t };
    }),
  )
  .handler(
    comSessao(async (eu, d: { tarefaId: string; texto: string }) => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await pool
        .request()
        .input("t", sql.UniqueIdentifier, d.tarefaId)
        .input("autor", sql.Int, eu)
        .input("texto", sql.NVarChar(sql.MAX), d.texto)
        .query(
          `INSERT INTO gestor.comentarios (tarefa_id, autor_id, texto)
           OUTPUT INSERTED.id, INSERTED.criado_em
           VALUES (@t, @autor, @texto)`,
        );
      const c = r.recordset[0] as { id: string; criado_em: Date };

      /* Quem precisa saber: o responsável, quem pediu a tarefa e quem estava
         mencionado nela. O `UNION` já elimina a repetição de quem é duas
         coisas ao mesmo tempo — e quem escreveu não se avisa.

         O título do aviso não traz o nome de quem comentou de propósito. O nome
         mora na IAM, não aqui, e congelá-lo dentro da notificação faria a sineta
         mostrar para sempre o nome que a pessoa tinha no dia. `de_pessoa_id` é
         o suficiente: a tela resolve o nome atual na hora de desenhar. */
      await pool
        .request()
        .input("t", sql.UniqueIdentifier, d.tarefaId)
        .input("autor", sql.Int, eu)
        .input("resumo", sql.NVarChar, d.texto.slice(0, 200))
        .query(
          `INSERT INTO gestor.notificacoes
             (destinatario_id, de_pessoa_id, tipo, titulo, descricao, tarefa_id)
           SELECT DISTINCT d.pessoa_id, @autor, 'mencao', N'Novo comentário',
                  LEFT(t.titulo + N': ' + @resumo, 400), t.id
             FROM gestor.tarefas t
             JOIN (SELECT responsavel_id AS pessoa_id FROM gestor.tarefas WHERE id=@t
                   UNION
                   SELECT criado_por FROM gestor.tarefas WHERE id=@t
                   UNION
                   SELECT pessoa_id FROM gestor.mencoes WHERE tarefa_id=@t) d ON 1=1
            WHERE t.id=@t AND d.pessoa_id <> @autor`,
        );

      return { id: c.id, at: c.criado_em.toISOString() };
    }),
  );

/** Registra uma linha no histórico. Só cresce; nada aqui é reescrito. */
export const registrarHistorico = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { tarefaId: string; tipo: string; texto: string }) => {
      const tarefaId = guid(e?.tarefaId);
      if (!tarefaId) throw new Error("Tarefa inválida");
      const tipo = (TIPOS_HISTORICO as readonly string[]).includes(e?.tipo) ? e.tipo : "editada";
      return { tarefaId, tipo, texto: texto(e?.texto, 500) || tipo };
    }),
  )
  .handler(
    comSessao(async (eu, d: { tarefaId: string; tipo: string; texto: string }) => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      await pool
        .request()
        .input("t", sql.UniqueIdentifier, d.tarefaId)
        .input("autor", sql.Int, eu)
        .input("tipo", sql.NVarChar, d.tipo)
        .input("texto", sql.NVarChar, d.texto)
        .query(
          `INSERT INTO gestor.historico_da_tarefa (tarefa_id, autor_id, tipo, texto)
           VALUES (@t, @autor, @tipo, @texto)`,
        );
      return { ok: true };
    }),
  );
