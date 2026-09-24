import { createServerFn } from "@tanstack/react-start";
import { comSessao, comSessaoSemEntrada, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* A tarefa — bloco C, o eixo.
 *
 * Treze tabelas dependem desta. E é ela que conserta o defeito central: hoje
 * `createTask` é um `setState`, então a tarefa nasce no navegador de quem a
 * criou e não sai de lá. Delegar era escrever um bilhete e guardar na própria
 * gaveta — quem recebeu nunca soube, e quem mandou continuava vendo a tarefa
 * como se estivesse encaminhada.
 *
 * Esta passagem cuida SÓ de `gestor.tarefas`. Checklist, comentários,
 * histórico, menções, etiquetas e recorrência semanal são o bloco D. Separar
 * as duas tem uma razão prática: se esta der problema em produção, o estrago
 * fica numa tabela só e o resto continua no navegador, funcionando como hoje.
 */

export type TarefaDoBanco = {
  id: string;
  title: string;
  description?: string;
  sector: string;
  createdBy: string;
  assigneeId: string;
  frequency: "diaria" | "semanal" | "mensal" | "anual";
  status: "pendente" | "andamento" | "concluida";
  priority: "baixa" | "media" | "alta";
  score: number;
  dueDate: string;
  recurring: boolean;
  recurringUntil?: string | null;
  recurringMonthDay?: number | null;
  estimatedMinutes?: number;
  requireProof?: boolean;
  inPack?: boolean;
  order: number;
  createdAt: string;
  projectId?: string;
  /** Quando foi marcada como concluída — o clique, pelo relógio do banco. */
  completedAt?: string | null;
  /** O dia em que de fato terminou, quando a pessoa informou ("yyyy-MM-dd"). */
  actualCompletionDate?: string | null;
};

const FREQUENCIAS = ["diaria", "semanal", "mensal", "anual"] as const;
const SITUACOES = ["pendente", "andamento", "concluida"] as const;
const PRIORIDADES = ["baixa", "media", "alta"] as const;

const pessoa = (v: unknown): number => {
  const n = Number(typeof v === "string" || typeof v === "number" ? v : NaN);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Pessoa inválida");
  return n;
};
const texto = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const guid = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;

/**
 * As tarefas que esta pessoa pode ver.
 *
 * A regra é decidida INTEIRAMENTE no servidor, a partir do papel e do setor
 * gravados em `gestor.perfis` no login — que por sua vez vêm de
 * `dbo.COLABORADORES` e `dbo.COLABORADORES_EXTERNOS`, não do navegador:
 *
 *   gerente     → todas
 *   supervisor  → as do próprio setor, mais as suas
 *   adm         → só as suas (responsável ou criador)
 *
 * Quem não tem papel registrado cai em `adm`, que é a regra mais restrita.
 * Errar para o lado de mostrar menos é recuperável; errar para o outro lado
 * vaza a tarefa de todo mundo.
 */
export const listarTarefas = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ tarefas: TarefaDoBanco[] }> => {
    const { papelEsetor } = await import("@/lib/perfil.functions");
    const { papel, setor } = await papelEsetor(eu);

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();

    /* O filtro é montado aqui, e não passado como parâmetro, porque `papel` e
       `setor` vieram do banco — não há valor de fora entrando na consulta. Os
       ids continuam parametrizados. */
    /* O setor é de todos que estão nele, não só do supervisor.
       Antes, colaborador recebia apenas o que era dele — e as telas que dizem
       "do time" (ranking, últimos 7 dias, packs do time) mostravam a pessoa
       sozinha com o rótulo de time. Duas pessoas da TI viam números diferentes
       para a mesma coisa, e "Packs do time" dizia "ninguém montou o pack" para
       sempre, porque as tarefas dos outros nunca chegavam.

       O que isso abre, dito com todas as letras: quem é da TI passa a ver
       título, responsável e conclusão das tarefas da TI. Decisão tomada com o
       usuário — é o comportamento que a tela sempre prometeu.

       A gerência continua vendo tudo, sem hierarquia, como era. */
    const filtro =
      papel === "gerente"
        ? "1=1"
        : setor
          ? "(setor=@setor OR responsavel_id=@eu OR criado_por=@eu)"
          : "(responsavel_id=@eu OR criado_por=@eu)";

    const req = pool.request().input("eu", sql.Int, eu);
    if (filtro.includes("@setor")) req.input("setor", sql.NVarChar, setor);

    /* Os parênteses no filtro acima não são enfeite: sem eles, o `OR` interno
       se misturaria com o `AND arquivada_em IS NULL` abaixo, e uma tarefa
       arquivada de outra pessoa voltaria a aparecer. É o tipo de erro que
       nenhum teste de tela pega.

       `criada_em` no futuro é a próxima ocorrência de uma recorrente que ainda
       não chegou ao dia dela — ver `nasceEm` em `salvarTarefa`. Ela existe no
       banco, mas só aparece quando nasce. */
    const r = await req.query(
      `SELECT ${COLUNAS_TAREFA} FROM gestor.tarefas
        WHERE ${filtro} AND arquivada_em IS NULL AND criada_em <= SYSDATETIMEOFFSET()
        ORDER BY ordem, criada_em DESC`,
    );

    return { tarefas: (r.recordset as LinhaTarefa[]).map(paraApp) };
  }),
);

/** As colunas de `gestor.tarefas` que `paraApp` sabe converter. */
export const COLUNAS_TAREFA = `id, titulo, descricao, setor, criado_por, responsavel_id, projeto_id,
                               frequencia, situacao, prioridade, pontos, prazo, recorrente,
                               recorre_ate, dia_do_mes, minutos_estimados, exige_comprovante,
                               no_pack, ordem, criada_em, concluida_em, data_real_de_conclusao`;

export type LinhaTarefa = {
  id: string;
  titulo: string;
  descricao: string | null;
  setor: string;
  criado_por: number;
  responsavel_id: number;
  projeto_id: string | null;
  frequencia: string;
  situacao: string;
  prioridade: string;
  pontos: number;
  prazo: Date;
  recorrente: boolean;
  recorre_ate: Date | null;
  dia_do_mes: number | null;
  minutos_estimados: number | null;
  exige_comprovante: boolean;
  no_pack: boolean;
  ordem: number;
  criada_em: Date;
  concluida_em: Date | null;
  /** DATE: o driver entrega meia-noite UTC do dia (useUTC, o padrão do mssql). */
  data_real_de_conclusao: Date | null;
};

/** Do formato do banco para o que a interface já espera. */
export function paraApp(t: LinhaTarefa): TarefaDoBanco {
  const emLista = <T extends readonly string[]>(lista: T, v: string, padrao: T[number]) =>
    (lista as readonly string[]).includes(v) ? (v as T[number]) : padrao;

  return {
    id: t.id,
    title: t.titulo,
    description: t.descricao ?? undefined,
    sector: t.setor,
    // `User.id` é string em toda a interface — comparar 467 com "467" daria
    // falso, e a tarefa não apareceria para o dono.
    createdBy: String(t.criado_por),
    assigneeId: String(t.responsavel_id),
    frequency: emLista(FREQUENCIAS, t.frequencia, "diaria"),
    status: emLista(SITUACOES, t.situacao, "pendente"),
    priority: emLista(PRIORIDADES, t.prioridade, "media"),
    score: t.pontos,
    dueDate: t.prazo.toISOString(),
    recurring: !!t.recorrente,
    recurringUntil: t.recorre_ate ? t.recorre_ate.toISOString() : null,
    recurringMonthDay: t.dia_do_mes,
    estimatedMinutes: t.minutos_estimados ?? undefined,
    requireProof: !!t.exige_comprovante,
    inPack: !!t.no_pack,
    order: t.ordem,
    createdAt: t.criada_em.toISOString(),
    projectId: t.projeto_id ?? undefined,
    completedAt: t.concluida_em ? t.concluida_em.toISOString() : null,
    actualCompletionDate: t.data_real_de_conclusao
      ? t.data_real_de_conclusao.toISOString().slice(0, 10)
      : null,
  };
}

/** O que a gravação aceita. Sem campo de identidade — o `semIdentidade` recusa. */
type EntradaTarefa = {
  id: string | null;
  titulo: string;
  descricao: string | null;
  setor: string;
  responsavelId: number;
  projetoId: string | null;
  frequencia: string;
  situacao: string;
  prioridade: string;
  pontos: number;
  prazo: Date;
  recorrente: boolean;
  recorreAte: Date | null;
  diaDoMes: number | null;
  minutosEstimados: number | null;
  exigeComprovante: boolean;
  noPack: boolean;
  ordem: number;
  /** Texto da linha "criou" no histórico. Só vale quando a tarefa é nova. */
  origem: string | null;
  /** "yyyy-MM-dd" do dia em que a tarefa de fato terminou, quando informado. */
  dataReal: string | null;
  /** Quando a próxima ocorrência de uma recorrente passa a existir na tela. */
  nasceEm: Date | null;
};

type GravacaoDaTarefa = {
  id: string;
  nova: boolean;
  /**
   * Próxima ocorrência que já existia (mesmo título, responsável e prazo) e por
   * isso não foi criada de novo. Quem chamou não tem o que completar nela.
   */
  ignorada?: boolean;
};

export const salvarTarefa = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade(
      (e: {
        id?: string;
        title: string;
        description?: string;
        sector: string;
        assigneeId: string;
        projectId?: string;
        frequency?: string;
        status?: string;
        priority?: string;
        score?: number;
        dueDate: string;
        recurring?: boolean;
        recurringUntil?: string | null;
        recurringMonthDay?: number | null;
        estimatedMinutes?: number;
        requireProof?: boolean;
        inPack?: boolean;
        order?: number;
        /** De onde a tarefa veio: "criou pelo modelo de pack …", "… a partir da ata …". */
        origin?: string;
        /** "yyyy-MM-dd": o dia em que de fato terminou, se não foi o do clique. */
        actualCompletionDate?: string | null;
        /** ISO. Só na próxima ocorrência de uma recorrente: quando ela nasce. */
        availableFrom?: string | null;
      }): EntradaTarefa => {
        const titulo = texto(e?.title, 200);
        if (!titulo) throw new Error("A tarefa precisa de um título");

        const prazo = typeof e?.dueDate === "string" ? new Date(e.dueDate) : new Date(NaN);
        if (Number.isNaN(prazo.getTime())) throw new Error("Prazo inválido");

        const numero = (v: unknown, teto: number): number | null => {
          const n = Number(v);
          return Number.isFinite(n) && n > 0 ? Math.min(teto, Math.trunc(n)) : null;
        };

        /* -1 é "último dia do mês" e -2 "último dia útil" — os valores que o
           CHECK da tabela aceita além de 1..31, e os que `proximaOcorrencia` entende. */
        const dia = Number(e?.recurringMonthDay);
        const diaDoMes =
          e?.recurringMonthDay === null || e?.recurringMonthDay === undefined
            ? null
            : dia === -1 || dia === -2 || (Number.isInteger(dia) && dia >= 1 && dia <= 31)
              ? dia
              : null;

        return {
          id: guid(e?.id),
          titulo,
          descricao: texto(e?.description, 100_000) || null,
          setor: texto(e?.sector, 40) || "sem-setor",
          responsavelId: pessoa(e?.assigneeId),
          projetoId: guid(e?.projectId),
          frequencia: (FREQUENCIAS as readonly string[]).includes(e?.frequency ?? "")
            ? e!.frequency!
            : "diaria",
          situacao: (SITUACOES as readonly string[]).includes(e?.status ?? "")
            ? e!.status!
            : "pendente",
          prioridade: (PRIORIDADES as readonly string[]).includes(e?.priority ?? "")
            ? e!.priority!
            : "media",
          pontos: Math.max(0, Math.min(10_000, Math.trunc(Number(e?.score) || 0))),
          prazo,
          recorrente: e?.recurring === true,
          recorreAte:
            typeof e?.recurringUntil === "string" && !Number.isNaN(Date.parse(e.recurringUntil))
              ? new Date(e.recurringUntil)
              : null,
          diaDoMes,
          minutosEstimados: numero(e?.estimatedMinutes, 24 * 60),
          exigeComprovante: e?.requireProof === true,
          noPack: e?.inPack === true,
          ordem: Math.max(0, Math.trunc(Number(e?.order) || 0)),
          origem: texto(e?.origin, 500) || null,
          /* Só o formato aqui; o "não pode ser no futuro" é conferido no SQL,
             contra o dia de hoje em Brasília e não o relógio de quem mandou. */
          dataReal:
            typeof e?.actualCompletionDate === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(e.actualCompletionDate) &&
            !Number.isNaN(Date.parse(`${e.actualCompletionDate}T00:00:00Z`))
              ? e.actualCompletionDate
              : null,
          /* No futuro e perto: é "amanhã, à meia-noite". Passado ou agora não
             muda nada (nasce já), e o teto de 48h impede que um valor torto
             esconda uma tarefa por semanas. */
          nasceEm: (() => {
            const quando =
              typeof e?.availableFrom === "string" ? new Date(e.availableFrom) : new Date(NaN);
            const falta = quando.getTime() - Date.now();
            return falta > 0 && falta <= 48 * 3600e3 ? quando : null;
          })(),
        };
      },
    ),
  )
  .handler(
    comSessao(async (eu, d: EntradaTarefa): Promise<GravacaoDaTarefa> => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();

      const req = pool
        .request()
        .input("id", sql.UniqueIdentifier, d.id)
        .input("titulo", sql.NVarChar, d.titulo)
        .input("descricao", sql.NVarChar(sql.MAX), d.descricao)
        .input("setor", sql.NVarChar, d.setor)
        .input("responsavel", sql.Int, d.responsavelId)
        .input("projeto", sql.UniqueIdentifier, d.projetoId)
        .input("frequencia", sql.NVarChar, d.frequencia)
        .input("situacao", sql.NVarChar, d.situacao)
        .input("prioridade", sql.NVarChar, d.prioridade)
        .input("pontos", sql.Int, d.pontos)
        .input("prazo", sql.DateTimeOffset, d.prazo)
        .input("recorrente", sql.Bit, d.recorrente)
        .input("recorre_ate", sql.DateTimeOffset, d.recorreAte)
        .input("dia_do_mes", sql.SmallInt, d.diaDoMes)
        .input("minutos", sql.Int, d.minutosEstimados)
        .input("comprovante", sql.Bit, d.exigeComprovante)
        .input("no_pack", sql.Bit, d.noPack)
        .input("ordem", sql.Int, d.ordem)
        .input("origem", sql.NVarChar(500), d.origem)
        // Texto, convertido no SQL: um DATE vindo de Date do JS passaria pelo fuso.
        .input("data_real", sql.NVarChar(10), d.dataReal)
        .input("nasce_em", sql.DateTimeOffset, d.nasceEm)
        .input("por", sql.Int, eu);

      /* `concluida_em` é derivado da situação, não recebido.
         Se viesse do cliente, uma tarefa poderia ser marcada como concluída
         ontem por quem a concluiu agora — e o placar do mês passaria a depender
         de um valor que o navegador escolhe.

         O `OUTPUT ... INTO @efeito` é o que torna o resto possível. Ele guarda,
         numa tabela em memória, o antes e o depois da linha que acabou de
         mudar. Sem ele não dá para saber que ESTA gravação foi a que concluiu a
         tarefa — só que ela está concluída agora, o que é diferente: salvar uma
         tarefa já concluída pontuaria de novo, a cada clique.

         O bloco de baixo então usa esse antes-e-depois para escrever a conclusão
         e os avisos. Tudo num comando só: ou a tarefa muda e a pontuação existe,
         ou nada aconteceu.

         A data de finalização informada (`data_real_de_conclusao`) é outra
         coisa e mora em outra coluna: o dia em que o trabalho de fato acabou,
         para quem esqueceu de marcar na hora. A Timeline mostra essa data, mas
         conclusão, prazo e pontos continuam pelo clique — decisão do usuário
         em 24/09/2026, enquanto o placar é revisto. */
      const gravacao = req.query(
        `/* Só com a tarefa concluída, e nunca no futuro — o "hoje" é o de
            Brasília, não o do relógio de quem mandou. */
         DECLARE @dia_real DATE = CASE
           WHEN @situacao = 'concluida'
            AND TRY_CONVERT(DATE, @data_real, 23)
                <= CAST(SYSDATETIMEOFFSET() AT TIME ZONE N'E. South America Standard Time' AS DATE)
           THEN TRY_CONVERT(DATE, @data_real, 23) END;

         DECLARE @efeito TABLE (
           tarefa             UNIQUEIDENTIFIER,
           criador            INT,
           nova               BIT,
           responsavel_antes  INT,
           responsavel_depois INT,
           situacao_antes     NVARCHAR(12),
           situacao_depois    NVARCHAR(12),
           concluida_antes    DATETIMEOFFSET(3),
           concluida_depois   DATETIMEOFFSET(3),
           titulo             NVARCHAR(200),
           pontos             INT,
           prioridade         NVARCHAR(10),
           prazo_antes        DATETIMEOFFSET(3),
           prazo              DATETIMEOFFSET(3),
           no_pack            BIT,
           dia_real_antes     DATE,
           dia_real_depois    DATE
         );

         IF @id IS NOT NULL AND EXISTS (SELECT 1 FROM gestor.tarefas WHERE id=@id)
         BEGIN
           UPDATE gestor.tarefas
              SET titulo=@titulo, descricao=@descricao, setor=@setor,
                  responsavel_id=@responsavel, projeto_id=@projeto,
                  frequencia=@frequencia, situacao=@situacao, prioridade=@prioridade,
                  pontos=@pontos, prazo=@prazo, recorrente=@recorrente,
                  recorre_ate=@recorre_ate, dia_do_mes=@dia_do_mes,
                  minutos_estimados=@minutos, exige_comprovante=@comprovante,
                  no_pack=@no_pack, ordem=@ordem,
                  data_real_de_conclusao=@dia_real,
                  concluida_em = CASE
                    WHEN @situacao = 'concluida' AND concluida_em IS NULL
                      THEN SYSDATETIMEOFFSET()
                    WHEN @situacao <> 'concluida' THEN NULL
                    ELSE concluida_em END
           OUTPUT inserted.id, inserted.criado_por, CAST(0 AS BIT),
                  deleted.responsavel_id, inserted.responsavel_id,
                  deleted.situacao, inserted.situacao,
                  deleted.concluida_em, inserted.concluida_em,
                  inserted.titulo, inserted.pontos, inserted.prioridade,
                  deleted.prazo, inserted.prazo,
                  inserted.no_pack,
                  deleted.data_real_de_conclusao, inserted.data_real_de_conclusao
             INTO @efeito (tarefa, criador, nova,
                           responsavel_antes, responsavel_depois,
                           situacao_antes, situacao_depois,
                           concluida_antes, concluida_depois,
                           titulo, pontos, prioridade,
                           prazo_antes, prazo,
                           no_pack,
                           dia_real_antes, dia_real_depois)
            WHERE id=@id;
         END
         ELSE
         BEGIN
           /* A próxima ocorrência de uma recorrente nasce no dia dela (@nasce_em,
              "amanhã à meia-noite"): é gravada agora, junto com a conclusão, mas
              com criada_em no futuro — e toda leitura filtra criada_em <= agora.
              Antes ela aparecia em "A fazer" no mesmo instante, com o prazo de
              amanhã, e concluir essa gerava a de depois de amanhã: em minutos a
              pessoa tinha concluído a semana inteira.

              E não entra duas vezes. Mesmo título, responsável e prazo, ainda
              ativa, é a mesma ocorrência — a do clique duplo, ou a de quem
              concluiu, reabriu noutra aba e concluiu de novo. O UPDLOCK e o
              HOLDLOCK fazem a conferência e a inserção valerem juntas: duas
              gravações simultâneas não passam as duas pelo "ainda não existe". */
           INSERT INTO gestor.tarefas
             (id, titulo, descricao, setor, criado_por, responsavel_id, projeto_id,
              frequencia, situacao, prioridade, pontos, prazo, recorrente,
              recorre_ate, dia_do_mes, minutos_estimados, exige_comprovante,
              no_pack, ordem, concluida_em, data_real_de_conclusao, criada_em)
           OUTPUT inserted.id, inserted.criado_por, CAST(1 AS BIT),
                  CAST(NULL AS INT), inserted.responsavel_id,
                  CAST(NULL AS NVARCHAR(12)), inserted.situacao,
                  CAST(NULL AS DATETIMEOFFSET(3)), inserted.concluida_em,
                  inserted.titulo, inserted.pontos, inserted.prioridade,
                  CAST(NULL AS DATETIMEOFFSET(3)), inserted.prazo,
                  inserted.no_pack,
                  CAST(NULL AS DATE), inserted.data_real_de_conclusao
             INTO @efeito (tarefa, criador, nova,
                           responsavel_antes, responsavel_depois,
                           situacao_antes, situacao_depois,
                           concluida_antes, concluida_depois,
                           titulo, pontos, prioridade,
                           prazo_antes, prazo,
                           no_pack,
                           dia_real_antes, dia_real_depois)
           SELECT COALESCE(@id, NEWID()), @titulo, @descricao, @setor, @por, @responsavel, @projeto,
                  @frequencia, @situacao, @prioridade, @pontos, @prazo, @recorrente,
                  @recorre_ate, @dia_do_mes, @minutos, @comprovante,
                  @no_pack, @ordem,
                  CASE WHEN @situacao = 'concluida' THEN SYSDATETIMEOFFSET() ELSE NULL END,
                  @dia_real,
                  COALESCE(@nasce_em, SYSDATETIMEOFFSET())
            WHERE NOT EXISTS (
                    SELECT 1 FROM gestor.tarefas x WITH (UPDLOCK, HOLDLOCK)
                     WHERE @nasce_em IS NOT NULL
                       AND x.recorrente = 1
                       AND x.titulo = @titulo AND x.responsavel_id = @responsavel
                       AND x.prazo = @prazo AND x.arquivada_em IS NULL);
         END

         /* Reabriu: a próxima ocorrência que ainda não nasceu sai junto.
            Ela foi gravada pela conclusão que acabou de ser desfeita; se ficasse,
            apareceria amanhã ao lado da que a nova conclusão vai gerar. */
         UPDATE f
            SET arquivada_em = SYSDATETIMEOFFSET()
           FROM gestor.tarefas f
           JOIN @efeito e
             ON f.titulo = e.titulo
            AND f.responsavel_id IN (e.responsavel_antes, e.responsavel_depois)
          WHERE e.concluida_antes IS NOT NULL AND e.concluida_depois IS NULL
            AND f.id <> e.tarefa
            AND f.recorrente = 1
            AND f.arquivada_em IS NULL
            AND f.criada_em > SYSDATETIMEOFFSET();

         /* A conclusão, quando a tarefa ACABOU de ser concluída.
            A fórmula é a mesma que a tela usava (computeScore): os pontos da
            tarefa, 10% a mais no prazo, 20% a menos com atraso. Ela mudou de
            lado porque estava do lado errado — quem ganha ponto não pode ser
            quem conta o ponto. */
         INSERT INTO gestor.conclusoes
           (tarefa_id, pessoa_id, pontos, prioridade, no_prazo, em)
         SELECT e.tarefa, e.responsavel_depois,
                CAST(ROUND(e.pontos * CASE WHEN e.prazo >= e.concluida_depois
                                           THEN 1.1 ELSE 0.8 END, 0) AS INT),
                e.prioridade,
                CASE WHEN e.prazo >= e.concluida_depois THEN 1 ELSE 0 END,
                e.concluida_depois
           FROM @efeito e
          WHERE e.concluida_depois IS NOT NULL AND e.concluida_antes IS NULL;

         /* E some quando a tarefa volta atrás — o desfazer, ou o card arrastado
            de volta para "andamento". A pontuação acompanha concluida_em: as
            duas viram nulas juntas, e nunca sobra um ponto de uma conclusão que
            deixou de existir. */
         DELETE c
           FROM gestor.conclusoes c
           JOIN @efeito e ON e.tarefa = c.tarefa_id
          WHERE e.concluida_depois IS NULL AND e.concluida_antes IS NOT NULL;

         /* Avisos derivados: nascem do fato, não de um pedido do navegador.
            Este é o que faz a delegação chegar em quem recebeu.

            O no_pack = 0 é o que evita a avalanche. Um pack são oito, dez
            tarefas atribuídas de uma vez; sem esta linha, quem recebe o pack de
            segunda-feira encontraria dez linhas iguais na sineta. O pack avisa
            uma vez, por fora, com o resumo.

            A ocorrência que ainda não nasceu também não avisa: seria um aviso de
            uma tarefa que a pessoa não consegue abrir até amanhã. */
         INSERT INTO gestor.notificacoes
           (destinatario_id, de_pessoa_id, tipo, titulo, descricao, tarefa_id)
         SELECT e.responsavel_depois, @por, 'atribuida',
                CASE WHEN e.responsavel_antes IS NULL
                     THEN N'Nova tarefa' ELSE N'Tarefa atribuída a você' END,
                e.titulo, e.tarefa
           FROM @efeito e
          WHERE e.responsavel_depois <> @por
            AND e.no_pack = 0
            AND @nasce_em IS NULL
            AND (e.responsavel_antes IS NULL
                 OR e.responsavel_antes <> e.responsavel_depois);

         /* E quem pediu a tarefa fica sabendo que ela saiu. */
         INSERT INTO gestor.notificacoes
           (destinatario_id, de_pessoa_id, tipo, titulo, descricao, tarefa_id)
         SELECT e.criador, @por, 'concluida', N'Tarefa concluída', e.titulo, e.tarefa
           FROM @efeito e
          WHERE e.concluida_depois IS NOT NULL AND e.concluida_antes IS NULL
            AND e.criador <> @por;

         /* O histórico, a partir do mesmo antes-e-depois.
            Mora aqui porque todo caminho que muda a tarefa passa por aqui:
            arrastar o cartão, concluir pelo círculo, adiar pelo menu, desfazer,
            transferir o pack, salvar o painel. Quando era o navegador que
            anotava, cada caminho precisava lembrar de anotar — e mais da metade
            esquecia. Aqui só vira linha o que de fato mudou nesta gravação:
            arrastar grava a coluna inteira, mas só o cartão arrastado mudou de
            situação.

            O prazo é escrito no horário de Brasília. O navegador usava a data
            em UTC, e prazo às 23:59 aparecia como o dia seguinte. Quando só a
            hora muda, o texto diz a hora — antes, "Adiar +1 hora" virava "mudou
            o prazo de 22/09 para 22/09".

            Cada linha sai 1ms depois da anterior. Todas nasceriam no mesmo
            instante, e a Timeline, que ordena pelo horário, poderia mostrar
            "concluiu" antes de "criou".

            TRY/CATCH: é registro de apoio. Uma falha aqui não pode virar "não
            foi possível salvar" numa tarefa que já foi salva. */
         BEGIN TRY
           DECLARE @fuso SYSNAME = N'E. South America Standard Time';

           INSERT INTO gestor.historico_da_tarefa (tarefa_id, autor_id, tipo, texto, em)
           SELECT e.tarefa, @por, h.tipo, LEFT(h.texto, 500),
                  DATEADD(MILLISECOND, h.ordem, SYSDATETIMEOFFSET())
             FROM @efeito e
            CROSS APPLY (SELECT e.prazo_antes AT TIME ZONE @fuso AS antes,
                                e.prazo AT TIME ZONE @fuso AS depois) p
            CROSS APPLY (SELECT CONVERT(NVARCHAR(5), p.antes, 103) AS dia_antes,
                                CONVERT(NVARCHAR(5), CAST(p.antes AS TIME), 108) AS hora_antes,
                                CONVERT(NVARCHAR(5), p.depois, 103) AS dia_depois,
                                CONVERT(NVARCHAR(5), CAST(p.depois AS TIME), 108) AS hora_depois) f
            CROSS APPLY (
              SELECT 0 AS ordem, N'criada' AS tipo,
                     ISNULL(@origem, N'criou esta tarefa') AS texto
               WHERE e.nova = 1
              UNION ALL
              /* Na criação também, quando é para outra pessoa: é o que mostra
                 que a tarefa foi delegada. Tarefa de pack que muda de dono
                 depois de criada é o pack sendo transferido. */
              SELECT 1, N'atribuicao',
                     CASE WHEN e.nova = 0 AND e.no_pack = 1
                          THEN N'transferiu para o pack de '
                          ELSE N'atribuiu para ' END
                     + N'{pessoa:' + CAST(e.responsavel_depois AS NVARCHAR(12)) + N'}'
               WHERE (e.nova = 0 AND e.responsavel_antes <> e.responsavel_depois)
                  OR (e.nova = 1 AND e.responsavel_depois <> @por)
              UNION ALL
              SELECT 2, N'editada',
                     CASE
                       WHEN CAST(p.antes AS DATE) = CAST(p.depois AS DATE)
                         THEN N'mudou o horário do prazo de ' + f.hora_antes
                              + N' para ' + f.hora_depois
                       WHEN f.hora_antes = f.hora_depois
                         THEN N'mudou o prazo de ' + f.dia_antes + N' para ' + f.dia_depois
                       ELSE N'mudou o prazo de ' + f.dia_antes + N' ' + f.hora_antes
                            + N' para ' + f.dia_depois + N' ' + f.hora_depois
                     END
               WHERE e.nova = 0 AND e.prazo_antes <> e.prazo
                 AND (CAST(p.antes AS DATE) <> CAST(p.depois AS DATE)
                      OR f.hora_antes <> f.hora_depois)
              UNION ALL
              /* A conclusão tem linha própria, e é a única: "mudou o status
                 para Concluída" e "concluiu" diziam a mesma coisa duas vezes. */
              SELECT 3, N'status',
                     CASE WHEN e.situacao_antes = N'concluida'
                          THEN N'reabriu a tarefa, que voltou para '
                          ELSE N'mudou o status para ' END
                     + CASE e.situacao_depois WHEN N'pendente' THEN N'A fazer'
                                              WHEN N'andamento' THEN N'Em andamento'
                                              ELSE e.situacao_depois END
               WHERE e.nova = 0 AND e.situacao_antes <> e.situacao_depois
                 AND e.situacao_depois <> N'concluida'
              UNION ALL
              SELECT 4, N'concluida',
                     CASE WHEN e.prazo >= e.concluida_depois
                          THEN N'concluiu a tarefa no prazo'
                          ELSE N'concluiu a tarefa com atraso' END
                     /* Marcada hoje, terminada antes: a data que importa vai
                        junto, e a Timeline deixa de dizer só o dia do clique. */
                     + CASE WHEN e.dia_real_depois IS NOT NULL
                             AND e.dia_real_depois <> CAST(e.concluida_depois AT TIME ZONE @fuso AS DATE)
                            THEN N' · finalizada de fato em '
                                 + CONVERT(NVARCHAR(10), e.dia_real_depois, 103)
                            ELSE N'' END
               WHERE e.concluida_depois IS NOT NULL AND e.concluida_antes IS NULL
              UNION ALL
              /* A data de finalização informada ou corrigida depois, com a
                 tarefa já concluída. Linha própria porque não é conclusão
                 nova: nada muda no placar, só o registro de quando acabou. */
              SELECT 5, N'editada',
                     CASE WHEN e.dia_real_depois IS NULL
                          THEN N'removeu a data de finalização informada'
                          ELSE N'informou que a tarefa foi finalizada em '
                               + CONVERT(NVARCHAR(10), e.dia_real_depois, 103) END
               WHERE e.concluida_antes IS NOT NULL AND e.concluida_depois IS NOT NULL
                 AND (e.dia_real_antes <> e.dia_real_depois
                      OR (e.dia_real_antes IS NULL AND e.dia_real_depois IS NOT NULL)
                      OR (e.dia_real_antes IS NOT NULL AND e.dia_real_depois IS NULL))
            ) h;
         END TRY
         BEGIN CATCH
           DECLARE @falha_no_historico NVARCHAR(4000) = ERROR_MESSAGE();
         END CATCH

         /* As etiquetas do projeto: toda subtarefa carrega "projeto" e o nome
            dele, cortado no tamanho da coluna. Mesma regra de
            etiquetasDoProjeto, do lado que não depende de a tela lembrar.

            Aqui porque toda gravação passa por aqui — inclusive a que não
            manda satélites (tarefa ainda não aberta), que é a que conserta as
            subtarefas antigas que ficaram sem uma das duas. Só acrescenta o que
            falta; nunca tira nada.

            TRY/CATCH pelo mesmo motivo do histórico. Se duas gravações criarem
            a mesma etiqueta nova no mesmo instante, a segunda bate no UNIQUE do
            nome — e isso não pode virar "não foi possível salvar". A próxima
            gravação, ou salvarSatelites logo em seguida, completa. */
         BEGIN TRY
           IF @projeto IS NOT NULL
           BEGIN
             DECLARE @etiquetas_do_projeto TABLE (nome NVARCHAR(40));
             INSERT INTO @etiquetas_do_projeto (nome)
             SELECT DISTINCT v.nome
               FROM gestor.projetos p
              CROSS APPLY (VALUES (CAST(N'projeto' AS NVARCHAR(40))),
                                  (RTRIM(LEFT(LTRIM(RTRIM(p.nome)), 40)))) v(nome)
              WHERE p.id = @projeto AND v.nome <> N'';

             INSERT INTO gestor.etiquetas (nome, criada_por)
             SELECT x.nome, @por FROM @etiquetas_do_projeto x
              WHERE NOT EXISTS (SELECT 1 FROM gestor.etiquetas g WHERE g.nome = x.nome);

             INSERT INTO gestor.tarefa_etiquetas (tarefa_id, etiqueta_id)
             SELECT DISTINCT e.tarefa, g.id
               FROM @efeito e
              CROSS JOIN @etiquetas_do_projeto x
               JOIN gestor.etiquetas g ON g.nome = x.nome
              WHERE NOT EXISTS (SELECT 1 FROM gestor.tarefa_etiquetas te
                                 WHERE te.tarefa_id = e.tarefa AND te.etiqueta_id = g.id);
           END
         END TRY
         BEGIN CATCH
           DECLARE @falha_nas_etiquetas NVARCHAR(4000) = ERROR_MESSAGE();
         END CATCH

         SELECT tarefa AS id, nova FROM @efeito;`,
      );
      /* No log do servidor, com a tarefa e quem gravava. O motivo também chega
         ao aviso na tela, mas lá fica no computador de quem clicou. */
      const r = await gravacao.catch((e: unknown) => {
        console.error("[tarefas] gravação falhou:", {
          tarefa: d.id,
          por: eu,
          erro: (e as Error)?.message,
        });
        throw e;
      });

      const linha = r.recordset[0] as { id: string; nova: boolean } | undefined;
      // Nada gravado: era a próxima ocorrência, e ela já existia. Ver o INSERT.
      if (!linha) return { id: d.id ?? "", nova: false, ignorada: true };
      /* `nova` diz a quem chamou se esta gravação CRIOU a tarefa. Quem grava o
         checklist em seguida precisa saber: os itens com que a tarefa nasceu
         fazem parte da criação, não são "adicionou" um por um. */
      return { id: linha.id, nova: !!linha.nova };
    }),
  );

/**
 * Arquiva ou desarquiva. Não existe apagar.
 *
 * A decisão saiu de uma armadilha e virou uma simplificação. A armadilha:
 * `conclusoes` aponta para `tarefas` com NO_ACTION, então o banco recusaria
 * apagar uma tarefa concluída — e o erro só apareceria nessas, fazendo o
 * defeito parecer aleatório ("às vezes não deixa apagar").
 *
 * A simplificação: arquivar resolve o mesmo problema da pessoa — tirar do
 * quadro o que não interessa mais — sem nenhuma das consequências. O placar
 * fica intacto, porque apagar uma tarefa concluída REESCREVERIA O PASSADO: a
 * pontuação de meses atrás mudaria porque alguém limpou o quadro hoje.
 *
 * E há o ganho que não é técnico: arquivar por engano tem volta.
 */
export const arquivarTarefa = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { id: string; arquivar?: boolean }) => {
      const id = guid(e?.id);
      if (!id) throw new Error("Tarefa inválida");
      // `false` explícito desarquiva; ausente arquiva, que é o caso comum.
      return { id, arquivar: e?.arquivar !== false };
    }),
  )
  .handler(
    comSessao(async (eu, d: { id: string; arquivar: boolean }) => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();

      /* O `responsavel_id=@eu OR criado_por=@eu` é a fechadura.
         A tela já limita quem vê o botão, mas a tela não é a fechadura: sem
         esta linha, quem descobrisse o id de uma tarefa qualquer poderia
         tirá-la do quadro de outra pessoa. */
      const r = await pool
        .request()
        .input("id", sql.UniqueIdentifier, d.id)
        .input("eu", sql.Int, eu)
        .input("quando", sql.DateTimeOffset, d.arquivar ? new Date() : null)
        .query(
          `UPDATE gestor.tarefas
              SET arquivada_em=@quando
            WHERE id=@id AND (responsavel_id=@eu OR criado_por=@eu)`,
        );

      return { ok: r.rowsAffected[0] > 0 };
    }),
  );
