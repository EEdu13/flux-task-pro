import { createServerFn } from "@tanstack/react-start";
import { comSessao, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/*
 * O "Wrapped do mês" (pedido do usuário, 19/10/2026): o resumo do mês de cada
 * pessoa, como o Spotify Wrapped — tarefas concluídas, prazo, dia da semana
 * mais produtivo, horas cronometradas, pack fechado e agradecimentos do mural.
 *
 * Uma ida ao banco com quatro leituras, todas presas a `responsavel_id = eu`
 * (ou `pessoa_id`/`autor_id`): o banco é o Azure S2 compartilhado com os
 * outros sistemas, e o Wrapped abre para todo mundo na mesma manhã do dia 1º.
 * Nada é gravado aqui — o "já vi" mora em `gestor.preferencias`
 * (`wrapped_visto`), pela `salvarPreferencia` que já existe.
 *
 * O mês é o de Brasília: a meia-noite do dia 1º às −03:00 até a do mês
 * seguinte, e os dias de conclusão/prazo são convertidos com AT TIME ZONE,
 * como no lote do mural (`mural-lote.server.ts`).
 */

const FUSO_SQL = "N'E. South America Standard Time'";
/** Brasília é UTC−3 o ano inteiro (sem horário de verão desde 2019). */
const BRASILIA_MS = 3 * 3600_000;
const MES_VALIDO = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type DiaDoWrapped = {
  /** yyyy-mm-dd (dia de Brasília). */
  dia: string;
  concluidas: number;
};

export type MeuWrapped = {
  mes: string;
  /** Tarefas concluídas no mês (pela data real de conclusão). */
  concluidas: number;
  /** Das concluídas que tinham prazo: quantas e quantas até o dia do prazo. */
  comPrazo: number;
  noPrazo: number;
  /** Conclusões por dia — o cliente tira daqui o dia da semana e o melhor dia. */
  dias: DiaDoWrapped[];
  /** Segundos cronometrados no mês e em quantos dias diferentes. */
  segundos: number;
  diasCronometrados: number;
  /** Pack: dias com pack no mês, quantos fechados (tudo concluído até o dia) e a maior sequência. */
  diasDePack: number;
  packsFechados: number;
  maiorSequenciaDePack: number;
  /** Agradecimentos do mural; `null` quando o mural ainda não existe no banco. */
  agradecimentosRecebidos: number | null;
  agradecimentosDados: number | null;
};

const isoDia = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

export const meuWrapped = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((entrada: { mes: string }) => {
      const m = MES_VALIDO.exec(typeof entrada?.mes === "string" ? entrada.mes.trim() : "");
      if (!m) throw new Error("Mês inválido (use AAAA-MM).");
      const ano = Number(m[1]);
      if (ano < 2020 || ano > 2100) throw new Error("Mês fora do intervalo.");
      return { mes: m[0] };
    }),
  )
  .handler(
    comSessao(async (eu, dados: { mes: string }): Promise<MeuWrapped> => {
      const [ano, mes] = dados.mes.split("-").map(Number);
      // Meia-noite de Brasília do dia 1º deste mês e do seguinte.
      const ini = new Date(Date.UTC(ano, mes - 1, 1) + BRASILIA_MS);
      const fim = new Date(Date.UTC(ano, mes, 1) + BRASILIA_MS);

      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await pool
        .request()
        .input("eu", sql.Int, eu)
        .input("ini", sql.DateTimeOffset(3), ini)
        .input("fim", sql.DateTimeOffset(3), fim)
        .input("dia_ini", sql.Date, ini.toISOString().slice(0, 10))
        .input("dia_fim", sql.Date, fim.toISOString().slice(0, 10))
        .query(
          `SET NOCOUNT ON;
           -- 1) Conclusões por dia. O dia é a data REAL de conclusão (quem
           --    conclui atrasado no sistema informa o dia de verdade); como ela
           --    nunca é depois do clique, "concluida_em >= @ini" corta pelo
           --    índice sem perder nenhuma. No prazo = até o DIA do prazo — o
           --    horário é só o plano (mesma regra do resto do app).
           SELECT c.dia, COUNT(*) AS n,
                  SUM(CASE WHEN t.prazo IS NOT NULL THEN 1 ELSE 0 END) AS com_prazo,
                  SUM(CASE WHEN t.prazo IS NOT NULL
                            AND c.dia <= CAST(t.prazo AT TIME ZONE ${FUSO_SQL} AS DATE)
                           THEN 1 ELSE 0 END) AS no_prazo
             FROM gestor.tarefas t
            CROSS APPLY (SELECT COALESCE(t.data_real_de_conclusao,
                                 CAST(t.concluida_em AT TIME ZONE ${FUSO_SQL} AS DATE)) AS dia) c
            WHERE t.responsavel_id = @eu AND t.situacao = 'concluida'
              AND t.concluida_em >= @ini
              AND c.dia >= @dia_ini AND c.dia < @dia_fim
            GROUP BY c.dia;

           -- 2) Tempo cronometrado no mês.
           SELECT COALESCE(SUM(CAST(s.segundos AS BIGINT)), 0) AS segundos,
                  COUNT(DISTINCT CAST(s.iniciou_em AT TIME ZONE ${FUSO_SQL} AS DATE)) AS dias
             FROM gestor.sessoes_de_tempo s
            WHERE s.pessoa_id = @eu AND s.iniciou_em >= @ini AND s.iniciou_em < @fim;

           -- 3) O pack de cada dia do mês (a consulta 2 do lote do mural, só
           --    minha): fechado = todas as do dia concluídas até o dia do prazo.
           --    Dia que ainda não acabou não entra; tirada do quadro sem
           --    concluir (arquivada) não conta.
           SELECT d.dia, COUNT(*) AS total,
                  SUM(CASE WHEN t.situacao = 'concluida'
                            AND COALESCE(t.data_real_de_conclusao,
                                         CAST(t.concluida_em AT TIME ZONE ${FUSO_SQL} AS DATE)) <= d.dia
                           THEN 1 ELSE 0 END) AS feitas
             FROM gestor.tarefas t
            CROSS APPLY (SELECT CAST(t.prazo AT TIME ZONE ${FUSO_SQL} AS DATE) AS dia) d
            WHERE t.responsavel_id = @eu AND t.no_pack = 1
              AND t.prazo >= @ini AND t.prazo < @fim
              AND d.dia < CAST(SYSDATETIMEOFFSET() AT TIME ZONE ${FUSO_SQL} AS DATE)
              AND NOT (t.arquivada_em IS NOT NULL AND t.situacao <> 'concluida')
            GROUP BY d.dia;

           -- 4) Agradecimentos do mural. Sem as tabelas (mural não migrado),
           --    o Wrapped segue sem esta tela — o IF evita o erro 208.
           IF OBJECT_ID(N'gestor.mural_posts') IS NOT NULL
              AND OBJECT_ID(N'gestor.mural_homenageados') IS NOT NULL
             SELECT (SELECT COUNT(DISTINCT p.id)
                       FROM gestor.mural_posts p
                       JOIN gestor.mural_homenageados h ON h.post_id = p.id
                      WHERE h.pessoa_id = @eu AND p.tipo = N'elogio' AND p.excluido_em IS NULL
                        AND p.criado_em >= @ini AND p.criado_em < @fim) AS recebidos,
                    (SELECT COUNT(*)
                       FROM gestor.mural_posts p
                      WHERE p.autor_id = @eu AND p.tipo = N'elogio' AND p.excluido_em IS NULL
                        AND p.criado_em >= @ini AND p.criado_em < @fim) AS dados;
           ELSE
             SELECT CAST(NULL AS INT) AS recebidos, CAST(NULL AS INT) AS dados;`,
        );

      const sets = r.recordsets as unknown as Record<string, unknown>[][];
      const conclusoes = (sets[0] ?? []) as {
        dia: unknown;
        n: number;
        com_prazo: number;
        no_prazo: number;
      }[];
      const tempo = ((sets[1] ?? [])[0] ?? {}) as { segundos?: unknown; dias?: unknown };
      const pack = ((sets[2] ?? []) as { dia: unknown; total: number; feitas: number }[])
        .map((l) => ({ dia: isoDia(l.dia), fechado: l.total > 0 && l.feitas >= l.total }))
        .sort((a, b) => a.dia.localeCompare(b.dia));
      const mural = ((sets[3] ?? [])[0] ?? {}) as { recebidos?: unknown; dados?: unknown };

      /* A maior sequência conta dias DE PACK seguidos fechados — fim de semana
         sem pack não quebra a sequência (é o mesmo critério do mural). */
      let seq = 0;
      let maior = 0;
      for (const d of pack) {
        seq = d.fechado ? seq + 1 : 0;
        if (seq > maior) maior = seq;
      }

      const numOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return {
        mes: dados.mes,
        concluidas: conclusoes.reduce((s, l) => s + Number(l.n), 0),
        comPrazo: conclusoes.reduce((s, l) => s + Number(l.com_prazo), 0),
        noPrazo: conclusoes.reduce((s, l) => s + Number(l.no_prazo), 0),
        dias: conclusoes
          .map((l) => ({ dia: isoDia(l.dia), concluidas: Number(l.n) }))
          .sort((a, b) => a.dia.localeCompare(b.dia)),
        // SUM de BIGINT volta como texto no mssql.
        segundos: Number(tempo.segundos ?? 0) || 0,
        diasCronometrados: Number(tempo.dias ?? 0) || 0,
        diasDePack: pack.length,
        packsFechados: pack.filter((d) => d.fechado).length,
        maiorSequenciaDePack: maior,
        agradecimentosRecebidos: numOuNulo(mural.recebidos),
        agradecimentosDados: numOuNulo(mural.dados),
      };
    }),
  );
