import { createServerFn } from "@tanstack/react-start";
import { comSessao, comSessaoSemEntrada, semIdentidade } from "@/integrations/iam/funcao-com-sessao";
import { COLUNAS_TAREFA, paraApp } from "@/lib/tarefas.functions";
import type { LinhaTarefa, TarefaDoBanco } from "@/lib/tarefas.functions";

/* A ponte do WhatsApp — bloco G, o último.
 *
 * Era a única coisa que ainda falava com o Supabase, e o desenho dela era o
 * mais torto do sistema. O bot gravava numa tabela lá; cada navegador abria um
 * canal em tempo real, escutava as linhas novas, e as que fossem para o dono
 * daquele navegador viravam uma tarefa local com id `wa-<algo>`. O controle do
 * que já tinha sido consumido morava numa chave do `localStorage`.
 *
 * Três consequências, todas ruins: a tarefa do WhatsApp não era uma tarefa —
 * não entrava no quadro de mais ninguém, não pontuava, não podia ser delegada.
 * Trocar de computador a fazia aparecer de novo, porque o controle de "já
 * consumi" era por máquina. E quem nunca abrisse o Fluxo simplesmente não
 * recebia.
 *
 * Agora o caminho é direto: o bot grava a mensagem em `gestor.entrada_whatsapp`
 * e, quando reconhece de quem é, JÁ CRIA A TAREFA de verdade. Ela nasce em
 * `gestor.tarefas` como qualquer outra e chega pelo mesmo caminho das demais.
 * A linha em `entrada_whatsapp` fica como registro do que entrou e por onde.
 *
 * Quando o bot NÃO reconhece o telefone — que é o caso comum hoje, porque o
 * mapa telefone→pessoa está vazio à espera da IAM — a linha fica pendente, com
 * `processada_em` nulo, e aparece na tela de entrada para alguém encaminhar.
 * É melhor do que o que acontecia antes, que era a tarefa nascer sem dono e
 * ficar invisível para todo mundo.
 */

export type EntradaWhatsapp = {
  id: string;
  titulo: string;
  descricao: string | null;
  telefone: string | null;
  prioridade: string;
  criadoEm: string;
  processadaEm: string | null;
  tarefaId: string | null;
  responsavelId: string | null;
};

type LinhaEntrada = {
  id: string;
  titulo: string;
  descricao: string | null;
  telefone: string | null;
  prioridade: string;
  criado_em: Date;
  processada_em: Date | null;
  tarefa_id: string | null;
  responsavel_id: number | null;
};

const paraEntrada = (e: LinhaEntrada): EntradaWhatsapp => ({
  id: e.id,
  titulo: e.titulo,
  descricao: e.descricao,
  telefone: e.telefone,
  prioridade: e.prioridade,
  criadoEm: e.criado_em.toISOString(),
  processadaEm: e.processada_em ? e.processada_em.toISOString() : null,
  tarefaId: e.tarefa_id,
  responsavelId: e.responsavel_id === null ? null : String(e.responsavel_id),
});

const guid = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
const pessoa = (v: unknown): number => {
  const n = Number(typeof v === "string" || typeof v === "number" ? v : NaN);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Pessoa inválida");
  return n;
};

/* ------------------------------------------------------------------ *
 * O que o webhook usa. NÃO é rota — de propósito.
 * ------------------------------------------------------------------ */

/** Dados extraídos da mensagem, já normalizados pelo webhook. */
export type MensagemDoWhatsapp = {
  titulo: string;
  descricao: string | null;
  telefone: string | null;
  responsavelId: number | null;
  criadorId: number | null;
  prazo: Date | null;
  recorrente: boolean;
  recorreAte: Date | null;
  exigeComprovante: boolean;
  prioridade: "alta" | "media" | "baixa";
};

/**
 * Grava o que chegou pelo WhatsApp e, se der para saber de quem é, cria a
 * tarefa na mesma ida ao banco.
 *
 * Não é uma server function, e a ausência é deliberada: o webhook é uma rota
 * pública — quem chama é a Evolution API, não uma pessoa logada — então não há
 * sessão para `comSessao` resolver. Deixá-la como rota criaria o oposto do que
 * o bloco 1 fechou: um endereço em que qualquer um declara para quem a tarefa
 * vai. Como função comum, o navegador não alcança.
 */
export async function registrarEntradaWhatsapp(
  m: MensagemDoWhatsapp,
): Promise<{ id: string; tarefaId: string | null }> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();

  const entrada = await pool
    .request()
    .input("titulo", sql.NVarChar, m.titulo.slice(0, 200))
    .input("descricao", sql.NVarChar(sql.MAX), m.descricao)
    .input("telefone", sql.NVarChar, m.telefone?.slice(0, 20) ?? null)
    .input("responsavel", sql.Int, m.responsavelId)
    .input("criador", sql.Int, m.criadorId)
    .input("prazo", sql.DateTimeOffset, m.prazo)
    .input("recorrente", sql.Bit, m.recorrente)
    .input("recorre_ate", sql.DateTimeOffset, m.recorreAte)
    .input("comprovante", sql.Bit, m.exigeComprovante)
    .input("prioridade", sql.NVarChar, m.prioridade)
    .query(
      `INSERT INTO gestor.entrada_whatsapp
         (titulo, descricao, telefone, responsavel_id, criador_id, prazo,
          recorrente, recorre_ate, exige_comprovante, prioridade)
       OUTPUT INSERTED.id
       VALUES (@titulo, @descricao, @telefone, @responsavel, @criador, @prazo,
               @recorrente, @recorre_ate, @comprovante, @prioridade)`,
    );
  const id = (entrada.recordset[0] as { id: string }).id;

  // Sem dono conhecido a linha fica pendente. `gestor.tarefas.responsavel_id`
  // é NOT NULL, e inventar um dono é pior do que deixar na caixa de entrada.
  if (m.responsavelId === null) return { id, tarefaId: null };

  const tarefaId = await criarTarefaDaEntrada(pool, sql, {
    entradaId: id,
    responsavelId: m.responsavelId,
    // Sem remetente conhecido, a pessoa é a autora da própria tarefa — é o que
    // já acontecia antes, e evita um criador nulo numa coluna que não aceita.
    criadorId: m.criadorId ?? m.responsavelId,
  });
  return { id, tarefaId };
}

/**
 * Transforma uma linha da entrada numa tarefa de verdade.
 *
 * Os campos vêm da própria linha gravada, e não de parâmetros: assim a tarefa
 * criada agora e a criada daqui a uma semana, quando alguém encaminhar a
 * pendente, saem exatamente iguais. O `processada_em IS NULL` no fim é a trava
 * contra criar duas tarefas da mesma mensagem.
 */
async function criarTarefaDaEntrada(
  pool: import("mssql").ConnectionPool,
  sql: typeof import("mssql"),
  d: { entradaId: string; responsavelId: number; criadorId: number },
): Promise<string | null> {
  const r = await pool
    .request()
    .input("entrada", sql.UniqueIdentifier, d.entradaId)
    .input("responsavel", sql.Int, d.responsavelId)
    .input("criador", sql.Int, d.criadorId)
    .query(
      `DECLARE @nova TABLE (id UNIQUEIDENTIFIER, titulo NVARCHAR(200));

       INSERT INTO gestor.tarefas
         (titulo, descricao, setor, criado_por, responsavel_id, frequencia,
          situacao, prioridade, pontos, prazo, recorrente, recorre_ate,
          exige_comprovante, ordem)
       OUTPUT INSERTED.id, INSERTED.titulo INTO @nova
       SELECT w.titulo, w.descricao,
              /* O setor sai do perfil de quem recebeu, não da mensagem: quem
                 manda um WhatsApp não sabe nem precisa saber em que setor a
                 tarefa cai. Sem perfil registrado, 'sem-setor'. */
              ISNULL((SELECT p.setor FROM gestor.perfis p WHERE p.pessoa_id = @responsavel),
                     'sem-setor'),
              @criador, @responsavel, 'diaria', 'pendente', w.prioridade, 15,
              -- Sem prazo dito na mensagem, 24 horas. Era o mesmo padrão da
              -- ponte antiga, e uma tarefa sem prazo nenhum não entra no placar.
              ISNULL(w.prazo, DATEADD(HOUR, 24, SYSDATETIMEOFFSET())),
              w.recorrente, w.recorre_ate, w.exige_comprovante, 0
         FROM gestor.entrada_whatsapp w
        WHERE w.id = @entrada AND w.processada_em IS NULL;

       UPDATE gestor.entrada_whatsapp
          SET processada_em = SYSDATETIMEOFFSET(),
              tarefa_id = (SELECT TOP 1 id FROM @nova),
              responsavel_id = @responsavel
        WHERE id = @entrada AND EXISTS (SELECT 1 FROM @nova);

       /* A etiqueta é o que faz a tarefa se identificar no quadro como vinda
          do WhatsApp — é o mesmo papel que a tag "whatsapp" tinha antes. */
       INSERT INTO gestor.etiquetas (nome, criada_por)
       SELECT N'whatsapp', @criador
        WHERE NOT EXISTS (SELECT 1 FROM gestor.etiquetas WHERE nome = N'whatsapp');

       INSERT INTO gestor.tarefa_etiquetas (tarefa_id, etiqueta_id)
       SELECT n.id, e.id FROM @nova n
        CROSS JOIN (SELECT TOP 1 id FROM gestor.etiquetas WHERE nome = N'whatsapp') e;

       INSERT INTO gestor.historico_da_tarefa (tarefa_id, autor_id, tipo, texto)
       SELECT n.id, @criador, 'criada', N'criou esta tarefa pelo WhatsApp'
         FROM @nova n;

       /* O aviso na sineta. A ponte antiga montava um igual, no navegador de
          quem recebia — e só chegava se a pessoa estivesse com o Fluxo aberto
          naquele instante. */
       INSERT INTO gestor.notificacoes
         (destinatario_id, de_pessoa_id, tipo, titulo, descricao, tarefa_id)
       SELECT @responsavel, NULLIF(@criador, @responsavel), 'atribuida',
              N'Nova tarefa pelo WhatsApp', n.titulo, n.id
         FROM @nova n;

       SELECT id FROM @nova;`,
    );
  return (r.recordset[0] as { id: string } | undefined)?.id ?? null;
}

/* ------------------------------------------------------------------ *
 * O que a interface usa.
 * ------------------------------------------------------------------ */

/**
 * As tarefas que chegaram pelo WhatsApp para mim, dos últimos 7 dias.
 *
 * É o que substitui o canal em tempo real do Supabase. A tela consulta de vez
 * em quando e junta o que ainda não tem — e o id da tarefa é o próprio controle
 * de duplicata, o que dispensa a lista de "já consumidos" que vivia no
 * `localStorage` e que voltava do zero em cada computador.
 */
export const tarefasDoWhatsapp = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ tarefas: TarefaDoBanco[] }> => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("eu", sql.Int, eu)
      .query(
        `SELECT ${COLUNAS_TAREFA} FROM gestor.tarefas t
          WHERE t.responsavel_id = @eu
            AND t.arquivada_em IS NULL
            AND t.criada_em >= DATEADD(DAY, -7, SYSDATETIMEOFFSET())
            AND EXISTS (SELECT 1 FROM gestor.entrada_whatsapp w WHERE w.tarefa_id = t.id)
          ORDER BY t.criada_em DESC`,
      );
    return { tarefas: (r.recordset as LinhaTarefa[]).map(paraApp) };
  }),
);

/**
 * A caixa de entrada do WhatsApp.
 *
 * Quem vê o quê segue a mesma lógica do resto do sistema: as suas sempre; as
 * pendentes, que ainda não têm dono, só quem tem como encaminhá-las. Uma
 * mensagem de WhatsApp traz o telefone de quem mandou e o texto inteiro — não é
 * coisa para ficar aberta a todo mundo só porque o bot não reconheceu o número.
 */
export const entradasDoWhatsapp = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(
    async (eu): Promise<{ entradas: EntradaWhatsapp[]; podeEncaminhar: boolean }> => {
      const { papelEsetor } = await import("@/lib/perfil.functions");
      const { papel } = await papelEsetor(eu);
      const podeEncaminhar = papel === "gerente" || papel === "supervisor";

      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();

      const filtro = podeEncaminhar
        ? "(responsavel_id = @eu OR criador_id = @eu OR processada_em IS NULL)"
        : "(responsavel_id = @eu OR criador_id = @eu)";

      const r = await pool
        .request()
        .input("eu", sql.Int, eu)
        .query(
          `SELECT TOP (200) id, titulo, descricao, telefone, prioridade,
                  criado_em, processada_em, tarefa_id, responsavel_id
             FROM gestor.entrada_whatsapp
            WHERE ${filtro}
            ORDER BY criado_em DESC`,
        );

      return {
        entradas: (r.recordset as LinhaEntrada[]).map(paraEntrada),
        podeEncaminhar,
      };
    },
  ),
);

/**
 * Encaminha uma mensagem pendente: vira tarefa de alguém.
 *
 * A regra: você sempre pode pegar uma pendente para si. Passar para outra
 * pessoa é de quem chefia — é uma delegação como qualquer outra, e não faria
 * sentido ser mais frouxa por a tarefa ter entrado pelo WhatsApp.
 */
export const encaminharEntrada = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { id: string; paraPessoaId: string | number }) => {
      const id = guid(e?.id);
      if (!id) throw new Error("Entrada inválida");
      return { id, paraPessoaId: pessoa(e?.paraPessoaId) };
    }),
  )
  .handler(
    comSessao(
      async (
        eu,
        d: { id: string; paraPessoaId: number },
      ): Promise<{ ok: boolean; tarefaId: string | null }> => {
        if (d.paraPessoaId !== eu) {
          const { papelEsetor } = await import("@/lib/perfil.functions");
          const { papel } = await papelEsetor(eu);
          if (papel !== "gerente" && papel !== "supervisor") {
            throw new Error("Só quem chefia encaminha para outra pessoa");
          }
        }

        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const tarefaId = await criarTarefaDaEntrada(pool, sql, {
          entradaId: d.id,
          responsavelId: d.paraPessoaId,
          criadorId: eu,
        });
        return { ok: tarefaId !== null, tarefaId };
      },
    ),
  );
