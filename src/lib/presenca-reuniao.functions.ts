import { createServerFn } from "@tanstack/react-start";
import { comSessao, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* Presença nas reuniões (pedido do usuário, 10/10/2026): "emitir relatório de
 * presenças de quem participou... fica salvo pra quem criou a reunião sempre".
 *
 * Como uma reunião vira registro:
 *   - quem está numa chamada manda um SINAL (ao entrar, quando alguém entra ou
 *     sai, e a cada minuto) — ver `usePresencaNaReuniao`;
 *   - o servidor NÃO confia na lista do navegador: pergunta ao próprio LiveKit
 *     quem está na sala. Assim ninguém forja presença, e o convidado por link
 *     (que não tem login para mandar sinal) entra no relatório do mesmo jeito;
 *   - a sala sem sinal há mais de 3 min encerrou a reunião; o próximo a entrar
 *     abre uma reunião nova, e é ele o "criador" — o dono do relatório.
 *
 * Tabelas: gestor.reunioes e gestor.reuniao_presencas
 * (db/migracoes/2026-10-10-presencas-de-reuniao.sql).
 */

/** Sem sinal por mais que isto, a pessoa saiu (ou a reunião acabou). */
const JANELA_MIN = 3;

/* Vários participantes mandam o mesmo sinal ao mesmo tempo. Se a lista não
   mudou desde a última gravação desta sala (há menos de 25 s), não volta ao
   banco: o banco é compartilhado e já sofreu com CPU alta. */
const ultimaGravacao = new Map<
  string,
  { assinatura: string; em: number; id: string; criador: number }
>();

export type SinalDaReuniao =
  { reuniaoId: string; souCriador: boolean } | { reuniaoId: null; souCriador: false };

export const sinalDaReuniao = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((entrada: { sala: string; titulo?: string }) => {
      const sala = typeof entrada?.sala === "string" ? entrada.sala.trim() : "";
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(sala)) throw new Error("Sala inválida");
      const titulo = typeof entrada?.titulo === "string" ? entrada.titulo.trim().slice(0, 120) : "";
      return { sala, titulo };
    }),
  )
  .handler(
    comSessao(async (eu, dados: { sala: string; titulo: string }): Promise<SinalDaReuniao> => {
      const { compartilhado } = await import("@/lib/cache-compartilhado.server");
      const { participantesNoLiveKit } = await import("@/lib/presenca-reuniao.server");
      const presentes = await compartilhado(`presenca:${dados.sala}`, 10_000, () =>
        participantesNoLiveKit(dados.sala),
      );
      // Só quem está DENTRO da sala manda sinal por ela.
      if (!presentes.some((p) => p.pessoa_id === eu)) return { reuniaoId: null, souCriador: false };

      const assinatura = presentes
        .map((p) => p.identidade)
        .sort()
        .join("|");
      const antes = ultimaGravacao.get(dados.sala);
      if (antes && antes.assinatura === assinatura && Date.now() - antes.em < 25_000) {
        return { reuniaoId: antes.id, souCriador: antes.criador === eu };
      }

      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await pool
        .request()
        .input("sala", sql.NVarChar(80), dados.sala)
        .input("titulo", sql.NVarChar(120), dados.titulo || null)
        .input("eu", sql.Int, eu)
        .input("lista", sql.NVarChar(sql.MAX), JSON.stringify(presentes))
        .query(
          `SET XACT_ABORT ON;
           BEGIN TRAN;
           DECLARE @r UNIQUEIDENTIFIER, @criador INT,
                   @limite DATETIMEOFFSET(3) = DATEADD(minute, -${JANELA_MIN}, SYSDATETIMEOFFSET());
           -- UPDLOCK/HOLDLOCK: dois sinais simultâneos não abrem duas reuniões.
           SELECT TOP 1 @r = id, @criador = criada_por
             FROM gestor.reunioes WITH (UPDLOCK, HOLDLOCK)
            WHERE sala = @sala AND ultimo_sinal >= @limite
            ORDER BY ultimo_sinal DESC;
           IF @r IS NULL
           BEGIN
             SET @r = NEWID(); SET @criador = @eu;
             INSERT INTO gestor.reunioes (id, sala, titulo_da_sala, criada_por)
             VALUES (@r, @sala, @titulo, @eu);
           END
           ELSE
             UPDATE gestor.reunioes
                SET ultimo_sinal = SYSDATETIMEOFFSET(), titulo_da_sala = COALESCE(titulo_da_sala, @titulo)
              WHERE id = @r;

           DECLARE @p TABLE (identidade NVARCHAR(120), pessoa_id INT NULL, nome NVARCHAR(160), convidado BIT);
           INSERT INTO @p
           SELECT identidade, pessoa_id, nome, convidado
             FROM OPENJSON(@lista)
             WITH (identidade NVARCHAR(120), pessoa_id INT, nome NVARCHAR(160), convidado BIT);

           -- Quem continua na sala: estende o trecho aberto.
           UPDATE rp SET ultimo_sinal = SYSDATETIMEOFFSET()
             FROM gestor.reuniao_presencas rp
             JOIN @p p ON p.identidade = rp.identidade
            WHERE rp.reuniao_id = @r AND rp.ultimo_sinal >= @limite;
           -- Quem chegou (ou voltou depois de sair): abre um trecho novo.
           INSERT INTO gestor.reuniao_presencas (reuniao_id, identidade, pessoa_id, nome, convidado)
           SELECT @r, p.identidade, p.pessoa_id, p.nome, p.convidado
             FROM @p p
            WHERE NOT EXISTS (SELECT 1 FROM gestor.reuniao_presencas rp
                               WHERE rp.reuniao_id = @r AND rp.identidade = p.identidade
                                 AND rp.ultimo_sinal >= @limite);
           COMMIT;
           SELECT @r AS id, @criador AS criador;`,
        );
      const linha = r.recordset[0] as { id: string; criador: number };
      ultimaGravacao.set(dados.sala, {
        assinatura,
        em: Date.now(),
        id: linha.id,
        criador: linha.criador,
      });
      if (ultimaGravacao.size > 200) ultimaGravacao.clear();
      return { reuniaoId: linha.id, souCriador: linha.criador === eu };
    }),
  );

export type ReuniaoResumo = {
  id: string;
  sala: string;
  titulo: string;
  inicio: string;
  fim: string;
  aberta: boolean;
  participantes: number;
  criador: string;
};

/** As reuniões de quem pergunta (as que ele abriu); a gerência pode pedir todas. */
export const minhasReunioes = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((entrada: { todas?: boolean } | undefined) => ({ todas: !!entrada?.todas })),
  )
  .handler(
    comSessao(
      async (
        eu,
        dados: { todas: boolean },
      ): Promise<{ reunioes: ReuniaoResumo[]; gerente: boolean }> => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const r = await pool
          .request()
          .input("eu", sql.Int, eu)
          .input("todas", sql.Bit, dados.todas ? 1 : 0)
          .query(
            `DECLARE @gerente BIT = CASE WHEN EXISTS (SELECT 1 FROM gestor.perfis WHERE pessoa_id=@eu AND papel=N'gerente') THEN 1 ELSE 0 END;
           SELECT TOP 300 r.id, r.sala, r.titulo_da_sala, r.inicio, r.ultimo_sinal,
                  CASE WHEN r.ultimo_sinal >= DATEADD(minute, -${JANELA_MIN}, SYSDATETIMEOFFSET()) THEN 1 ELSE 0 END AS aberta,
                  (SELECT COUNT(DISTINCT rp.identidade) FROM gestor.reuniao_presencas rp WHERE rp.reuniao_id = r.id) AS participantes,
                  (SELECT nome FROM gestor.perfis WHERE pessoa_id = r.criada_por) AS criador,
                  @gerente AS gerente
             FROM gestor.reunioes r
            WHERE r.criada_por = @eu OR (@todas = 1 AND @gerente = 1)
            ORDER BY r.inicio DESC;
           SELECT @gerente AS gerente;`,
          );
        const linhas = (r.recordsets as unknown as Record<string, unknown>[][])[0] ?? [];
        const gerente = !!(r.recordsets as unknown as { gerente: boolean }[][])[1]?.[0]?.gerente;
        return {
          gerente,
          reunioes: linhas.map((l) => ({
            id: String(l.id),
            sala: String(l.sala),
            titulo: String(l.titulo_da_sala ?? l.sala),
            inicio: (l.inicio as Date).toISOString(),
            fim: (l.ultimo_sinal as Date).toISOString(),
            aberta: !!l.aberta,
            participantes: Number(l.participantes ?? 0),
            criador: String(l.criador ?? ""),
          })),
        };
      },
    ),
  );

export type LinhaDePresenca = {
  identidade: string;
  nome: string;
  convidado: boolean;
  primeiraEntrada: string;
  ultimaSaida: string;
  /** Segundos somando os trechos (sair e voltar não conta o tempo fora). */
  segundos: number;
  entradas: number;
  presenteAgora: boolean;
};
export type RelatorioDePresenca = {
  reuniao: ReuniaoResumo;
  linhas: LinhaDePresenca[];
};

export const relatorioDaReuniao = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((entrada: { id: string }) => {
      const id = typeof entrada?.id === "string" ? entrada.id.trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Reunião inválida");
      return { id };
    }),
  )
  .handler(
    comSessao(async (eu, dados: { id: string }) => {
      const { montarRelatorio } = await import("@/lib/presenca-reuniao.server");
      const rel = await montarRelatorio(eu, dados.id);
      if (!rel) throw new Error("Relatório não encontrado (ou é de outra pessoa).");
      return rel;
    }),
  );
