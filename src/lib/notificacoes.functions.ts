import { createServerFn } from "@tanstack/react-start";
import { comSessao, comSessaoSemEntrada, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* A sineta — bloco E.
 *
 * Aqui mora o defeito mais antigo do sistema, e o mais silencioso: uma
 * notificação sempre foi escrita PARA OUTRA PESSOA, mas ficava guardada no
 * navegador de quem a provocou. A sineta filtra por `n.userId === currentUser.id`,
 * então o autor nunca via a própria notificação e o destinatário nunca recebeu
 * nada. O aviso existia, era montado corretamente, e morria a dois passos de
 * chegar.
 *
 * A correção não é só mudar de lugar. Quem escreve cada aviso mudou:
 *
 *   derivado no servidor  →  atribuição, conclusão, menção, comentário, prazo
 *   pedido pelo cliente   →  chamada, chamada perdida, pack
 *
 * Os cinco primeiros nascem de um fato que o servidor já conhece (a tarefa
 * mudou de dono, a tarefa foi concluída), então ele os escreve sozinho, na
 * mesma transação do fato. Não há como um existir sem o outro, e não há texto
 * vindo de fora.
 *
 * Os três últimos passam por `avisar`, abaixo, que é a porta estreita.
 */

export type NotificacaoDoBanco = {
  id: string;
  userId: string;
  type: "mencao" | "atribuida" | "prazo" | "concluida" | "chamada_perdida";
  title: string;
  desc: string;
  at: string;
  read: boolean;
  taskId?: string;
  roomName?: string;
  roomLabel?: string;
  fromUserId?: string;
};

const TIPOS = ["mencao", "atribuida", "prazo", "concluida", "chamada_perdida"] as const;

/**
 * Os tipos que o navegador pode pedir.
 *
 * `prazo` e `concluida` ficam de fora de propósito: os dois são derivados de um
 * fato que o servidor mede sozinho — a data do prazo, a mudança de situação.
 * Aceitá-los daqui abriria a porta para uma notificação de conclusão sem
 * conclusão nenhuma, e a sineta passaria a contar uma história que o banco não
 * confirma.
 */
const TIPOS_PEDIDOS = ["mencao", "atribuida", "chamada_perdida"] as const;

const texto = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const guid = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
const pessoa = (v: unknown): number => {
  const n = Number(typeof v === "string" || typeof v === "number" ? v : NaN);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Pessoa inválida");
  return n;
};

type LinhaNotificacao = {
  id: string;
  destinatario_id: number;
  de_pessoa_id: number | null;
  tipo: string;
  titulo: string;
  descricao: string | null;
  tarefa_id: string | null;
  sala: string | null;
  titulo_da_sala: string | null;
  lida: boolean;
  em: Date;
};

function paraApp(n: LinhaNotificacao): NotificacaoDoBanco {
  return {
    id: n.id,
    userId: String(n.destinatario_id),
    type: (TIPOS as readonly string[]).includes(n.tipo)
      ? (n.tipo as NotificacaoDoBanco["type"])
      : "mencao",
    title: n.titulo,
    desc: n.descricao ?? "",
    at: n.em.toISOString(),
    read: !!n.lida,
    taskId: n.tarefa_id ?? undefined,
    roomName: n.sala ?? undefined,
    roomLabel: n.titulo_da_sala ?? undefined,
    fromUserId: n.de_pessoa_id === null ? undefined : String(n.de_pessoa_id),
  };
}

/**
 * As minhas, e só as minhas.
 *
 * Diferente de `listarTarefas`, aqui não existe regra de papel: um gerente não
 * lê a sineta da equipe. Notificação é correspondência, não relatório — quem
 * quer o panorama do setor abre o quadro.
 *
 * O teto de 200 é o que a sineta mostra. Sem ele, a consulta cresceria para
 * sempre e a tela inicial ficaria mais lenta a cada mês de uso.
 */
export const listarNotificacoes = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ notificacoes: NotificacaoDoBanco[] }> => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("eu", sql.Int, eu)
      .query(
        `SELECT TOP (200) id, destinatario_id, de_pessoa_id, tipo, titulo, descricao,
                tarefa_id, sala, titulo_da_sala, lida, em
           FROM gestor.notificacoes
          WHERE destinatario_id=@eu
          ORDER BY em DESC`,
      );
    return { notificacoes: (r.recordset as LinhaNotificacao[]).map(paraApp) };
  }),
);

/**
 * Avisos de prazo das MINHAS tarefas.
 *
 * Roda no login. O `NOT EXISTS` é o que impede a sineta de encher: sem ele,
 * cada entrada no sistema criaria de novo o aviso de toda tarefa atrasada, e em
 * uma semana a lista teria sete cópias da mesma coisa.
 *
 * Escopo mudou de propósito. A versão anterior varria as tarefas VISÍVEIS e
 * criava avisos endereçados aos responsáveis — um supervisor gerava avisos para
 * a equipe inteira, que ficavam no navegador dele e não chegavam a ninguém.
 * Agora cada pessoa gera os seus, o que é ao mesmo tempo mais simples e a única
 * versão que funciona.
 */
export const gerarAvisosDePrazo = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ criados: number }> => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("eu", sql.Int, eu)
      .query(
        `INSERT INTO gestor.notificacoes (destinatario_id, tipo, titulo, descricao, tarefa_id)
         SELECT @eu, 'prazo',
                CASE WHEN t.prazo < SYSDATETIMEOFFSET()
                     THEN 'Tarefa atrasada' ELSE 'Prazo se aproximando' END,
                t.titulo, t.id
           FROM gestor.tarefas t
          WHERE t.responsavel_id = @eu
            AND t.situacao <> 'concluida'
            AND t.arquivada_em IS NULL
            AND t.prazo < DATEADD(DAY, 1, SYSDATETIMEOFFSET())
            AND NOT EXISTS (
                  SELECT 1 FROM gestor.notificacoes n
                   WHERE n.tarefa_id = t.id
                     AND n.destinatario_id = @eu
                     AND n.tipo = 'prazo')`,
      );
    return { criados: r.rowsAffected[0] ?? 0 };
  }),
);

/**
 * O aviso que o navegador pede.
 *
 * Existe para os três casos que o servidor não tem como derivar: alguém está
 * te chamando numa sala, alguém perdeu a sua chamada, alguém te passou um pack.
 * Nesses, o fato acontece no cliente e não deixa rastro em nenhuma tabela que
 * o servidor pudesse consultar depois.
 *
 * Por isso o destinatário vem de fora — e é a única função do sistema em que
 * isso acontece. O que NÃO vem de fora é `de_pessoa_id`: quem assina é sempre a
 * sessão. Alguém pode escrever um aviso para outra pessoa; ninguém pode
 * escrevê-lo em nome de um terceiro. É essa a diferença entre um incômodo e uma
 * fraude, e é onde a linha foi traçada.
 */
export const avisar = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade(
      (e: {
        paraPessoaId: string | number;
        tipo: string;
        titulo: string;
        descricao?: string;
        tarefaId?: string;
        sala?: string;
        tituloDaSala?: string;
      }) => {
        const titulo = texto(e?.titulo, 160);
        if (!titulo) throw new Error("Aviso sem título");
        if (!(TIPOS_PEDIDOS as readonly string[]).includes(e?.tipo)) {
          throw new Error("Tipo de aviso não permitido");
        }
        return {
          paraPessoaId: pessoa(e?.paraPessoaId),
          tipo: e.tipo,
          titulo,
          descricao: texto(e?.descricao, 400) || null,
          tarefaId: guid(e?.tarefaId),
          sala: texto(e?.sala, 80) || null,
          tituloDaSala: texto(e?.tituloDaSala, 120) || null,
        };
      },
    ),
  )
  .handler(
    comSessao(
      async (
        eu,
        d: {
          paraPessoaId: number;
          tipo: string;
          titulo: string;
          descricao: string | null;
          tarefaId: string | null;
          sala: string | null;
          tituloDaSala: string | null;
        },
      ): Promise<{ ok: boolean }> => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        await pool
          .request()
          .input("para", sql.Int, d.paraPessoaId)
          .input("de", sql.Int, eu)
          .input("tipo", sql.NVarChar, d.tipo)
          .input("titulo", sql.NVarChar, d.titulo)
          .input("descricao", sql.NVarChar, d.descricao)
          .input("tarefa", sql.UniqueIdentifier, d.tarefaId)
          .input("sala", sql.NVarChar, d.sala)
          .input("titulo_sala", sql.NVarChar, d.tituloDaSala)
          .query(
            `INSERT INTO gestor.notificacoes
               (destinatario_id, de_pessoa_id, tipo, titulo, descricao,
                tarefa_id, sala, titulo_da_sala)
             VALUES (@para, @de, @tipo, @titulo, @descricao, @tarefa, @sala, @titulo_sala)`,
          );
        return { ok: true };
      },
    ),
  );

/**
 * "Perdi uma chamada de fulano."
 *
 * Função à parte porque o sentido é o inverso do de `avisar`, e a regra de
 * segurança acompanha. Ali o destinatário é livre e o remetente é a sessão;
 * aqui o destinatário É a sessão — estou escrevendo na minha própria caixa — e
 * por isso o remetente pode vir de fora sem abrir nada: não há como usar isto
 * para colocar um aviso falso na sineta de outra pessoa.
 *
 * A janela de 60 segundos é a mesma que a tela usava, agora do lado que
 * sobrevive a um recarregamento. Uma chamada que toca em duas abas, ou que o
 * LiveKit reporta duas vezes, vira um aviso só.
 */
export const registrarChamadaPerdida = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { deQuemChamou: string | number; sala: string; tituloDaSala?: string }) => ({
      deQuemChamou: pessoa(e?.deQuemChamou),
      sala: texto(e?.sala, 80),
      tituloDaSala: texto(e?.tituloDaSala, 120) || null,
    })),
  )
  .handler(
    comSessao(
      async (
        eu,
        d: { deQuemChamou: number; sala: string; tituloDaSala: string | null },
      ): Promise<{ ok: boolean }> => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const r = await pool
          .request()
          .input("eu", sql.Int, eu)
          .input("de", sql.Int, d.deQuemChamou)
          .input("sala", sql.NVarChar, d.sala)
          .input("titulo_sala", sql.NVarChar, d.tituloDaSala)
          .query(
            `INSERT INTO gestor.notificacoes
               (destinatario_id, de_pessoa_id, tipo, titulo, descricao, sala, titulo_da_sala)
             SELECT @eu, @de, 'chamada_perdida', N'Chamada perdida',
                    N'Toque para retornar a ligação', @sala, @titulo_sala
              WHERE NOT EXISTS (
                    SELECT 1 FROM gestor.notificacoes n
                     WHERE n.destinatario_id = @eu
                       AND n.de_pessoa_id = @de
                       AND n.tipo = 'chamada_perdida'
                       AND n.sala = @sala
                       AND n.em > DATEADD(SECOND, -60, SYSDATETIMEOFFSET()))`,
          );
        return { ok: (r.rowsAffected[0] ?? 0) > 0 };
      },
    ),
  );

/**
 * Marca uma como lida.
 *
 * O `destinatario_id=@eu` é a fechadura. Sem ele, quem descobrisse o id de uma
 * notificação apagaria o aviso de outra pessoa — e ela nunca saberia que houve
 * um.
 */
export const marcarNotificacaoLida = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { id: string }) => {
      const id = guid(e?.id);
      if (!id) throw new Error("Notificação inválida");
      return { id };
    }),
  )
  .handler(
    comSessao(async (eu, d: { id: string }): Promise<{ ok: boolean }> => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await pool
        .request()
        .input("id", sql.UniqueIdentifier, d.id)
        .input("eu", sql.Int, eu)
        .query(
          `UPDATE gestor.notificacoes SET lida=1
            WHERE id=@id AND destinatario_id=@eu`,
        );
      return { ok: (r.rowsAffected[0] ?? 0) > 0 };
    }),
  );

export const marcarTodasLidas = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ lidas: number }> => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("eu", sql.Int, eu)
      .query(
        `UPDATE gestor.notificacoes SET lida=1
          WHERE destinatario_id=@eu AND lida=0`,
      );
    return { lidas: r.rowsAffected[0] ?? 0 };
  }),
);
