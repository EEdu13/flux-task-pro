import { createServerFn } from "@tanstack/react-start";
import { comSessao, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* Reações às tarefas — o "visto" com cara de WhatsApp (pedido do usuário,
 * 08/10/2026). Quem recebe uma tarefa reage com um emoji, e quem a criou é
 * avisado: "Sophia reagiu ❤️ à sua tarefa".
 *
 * Uma reação por pessoa por tarefa, como no WhatsApp: reagir de novo troca o
 * emoji, reagir com o mesmo tira. A chave primária de `gestor.reacoes_tarefa`
 * (tarefa, pessoa) é a garantia disso no banco.
 *
 * Reage quem enxerga a tarefa — a mesma fechadura de comentar. As reações
 * chegam à tela junto com as tarefas, em `listarTarefas`. */

const guid = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;

/** Um emoji, e só: até 16 caracteres, sem letra nem número soltos. */
function emojiValido(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim();
  if (!e || e.length > 16) return null;
  if (!/\p{Extended_Pictographic}/u.test(e)) return null;
  if (/[\p{L}\p{N}]/u.test(e.replace(/[\u{1F1E6}-\u{1F1FF}#*0-9]|\u20E3|\uFE0F/gu, ""))) return null;
  return e;
}

export const reagirNaTarefa = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { tarefaId: string; emoji: string | null }) => {
      const tarefaId = guid(e?.tarefaId);
      if (!tarefaId) throw new Error("Tarefa inválida");
      const emoji = e?.emoji === null ? null : emojiValido(e?.emoji);
      if (e?.emoji !== null && !emoji) throw new Error("Reação inválida");
      return { tarefaId, emoji };
    }),
  )
  .handler(
    comSessao(async (eu, d: { tarefaId: string; emoji: string | null }) => {
      const { permissaoNaTarefa } = await import("@/lib/permissoes.server");
      if (!(await permissaoNaTarefa(eu, d.tarefaId)).ver) throw new Error("Tarefa não encontrada");

      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const req = pool
        .request()
        .input("t", sql.UniqueIdentifier, d.tarefaId)
        .input("eu", sql.Int, eu)
        .input("emoji", sql.NVarChar(16), d.emoji);

      if (!d.emoji) {
        await req.query(`DELETE FROM gestor.reacoes_tarefa WHERE tarefa_id=@t AND pessoa_id=@eu`);
        return { ok: true };
      }

      /* Grava e avisa quem criou a tarefa, num comando só. Não avisa a si
         mesmo, e não repete o aviso quando a pessoa só troca de emoji em
         menos de um minuto — escolher entre 👍 e ❤️ não vira duas sinetas. */
      await req.query(
        `DECLARE @antes NVARCHAR(16), @quando DATETIMEOFFSET(3);
         SELECT @antes = emoji, @quando = em FROM gestor.reacoes_tarefa
          WHERE tarefa_id=@t AND pessoa_id=@eu;

         IF @antes IS NULL
           INSERT INTO gestor.reacoes_tarefa (tarefa_id, pessoa_id, emoji) VALUES (@t, @eu, @emoji);
         ELSE
           UPDATE gestor.reacoes_tarefa SET emoji=@emoji, em=SYSDATETIMEOFFSET()
            WHERE tarefa_id=@t AND pessoa_id=@eu;

         IF @antes IS NULL OR @quando < DATEADD(MINUTE, -1, SYSDATETIMEOFFSET())
           INSERT INTO gestor.notificacoes (destinatario_id, de_pessoa_id, tipo, titulo, descricao, tarefa_id)
           SELECT t.criado_por, @eu, 'mencao',
                  LEFT(ISNULL(LEFT(LTRIM(p.nome), CHARINDEX(' ', LTRIM(p.nome) + ' ') - 1), N'Alguém') + N' reagiu ' + @emoji + N' à sua tarefa', 160),
                  LEFT(t.titulo, 400), t.id
             FROM gestor.tarefas t
             LEFT JOIN gestor.perfis p ON p.pessoa_id = @eu
            WHERE t.id=@t AND t.criado_por <> @eu;`,
      );
      return { ok: true };
    }),
  );
