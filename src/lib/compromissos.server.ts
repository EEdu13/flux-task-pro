/* Agenda travada — a parte que só o servidor importa (14/10/2026).
 *
 * Duas coisas moram aqui: o reconhecimento de "a migração ainda não rodou"
 * (erro 208) e a entrega dos avisos de 30 e 10 minutos, que a leitura da
 * sineta (`listarNotificacoes`) chama a cada minuto — o mesmo caminho dos
 * lembretes da agenda pessoal. Nenhum relógio novo.
 */

/** Mensagem que a tela reconhece para dizer que a função não está ligada. */
export const AGENDA_TRAVADA_INATIVA = "A agenda travada ainda não foi ativada.";

/**
 * As tabelas da agenda travada ainda não existem (migração pendente)? O SQL
 * Server responde 208, "Invalid object name 'gestor.compromisso…'".
 */
export function ehAgendaTravadaInativa(e: unknown): boolean {
  const err = e as {
    number?: number;
    message?: string;
    originalError?: { info?: { number?: number } };
  };
  const numero = err?.number ?? err?.originalError?.info?.number;
  return numero === 208 && /compromisso/i.test(String(err?.message ?? ""));
}

/**
 * Enquanto a migração não roda, a varredura nem tenta por 10 minutos depois de
 * um 208: sem isto, cada leitura da sineta de cada pessoa mandaria ao banco um
 * comando que ele já respondeu que não sabe executar.
 */
let inativaAte = 0;
const ESPERA_SE_INATIVA_MS = 10 * 60_000;

/**
 * Entrega os avisos de "começa em X min" de quem está na sessão.
 *
 * Duas etapas por pessoa, cada uma uma vez só:
 *   - faltando 30 minutos ou menos → aviso de 30 (marca `alertado_30_em`);
 *   - faltando 10 minutos ou menos → aviso de 10 (marca as duas: quem abriu o
 *     app aos 8 minutos recebe só o de 10, não os dois de uma vez).
 * Compromisso que já começou não avisa mais.
 *
 * Quem criou e não está entre os participantes também é avisado ("inclusive
 * avisa quem criou"), pelas colunas `criador_alertado_*` do próprio
 * compromisso. Quem criou e se incluiu recebe pela linha de participante.
 *
 * A trava contra tocar duas vezes é a mesma dos lembretes: `UPDATE ... OUTPUT`
 * dentro da transação. Duas leituras cruzadas (o foco da janela e o relógio de
 * um minuto) — a segunda espera a trava da primeira e, ao reler, já encontra a
 * marca preenchida.
 *
 * O `IF EXISTS` na frente é o que deixa isto barato: quase sempre não há nada
 * a avisar, e ele responde pelos índices filtrados (IX_comp_part_pendentes e
 * IX_compromissos_criador) sem abrir transação.
 *
 * O id do compromisso viaja na coluna `projeto_id` da notificação, que não tem
 * chave estrangeira: assim a sineta não ganha coluna nova (o que quebraria
 * `listarNotificacoes` antes da migração). Ver `paraApp`.
 *
 * Nunca lança: falha aqui não pode esvaziar a sineta.
 */
export async function entregarAlertasDeCompromisso(eu: number): Promise<void> {
  if (Date.now() < inativaAte) return;
  try {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    await pool
      .request()
      .input("eu", sql.Int, eu)
      .query(
        `DECLARE @agora DATETIMEOFFSET(3) = SYSDATETIMEOFFSET();
         DECLARE @em30 DATETIMEOFFSET(3) = DATEADD(MINUTE, 30, @agora);
         DECLARE @em10 DATETIMEOFFSET(3) = DATEADD(MINUTE, 10, @agora);
         IF EXISTS (SELECT 1
                      FROM gestor.compromisso_participantes p
                      JOIN gestor.compromissos c ON c.id = p.compromisso_id
                     WHERE p.pessoa_id = @eu AND p.alertado_10_em IS NULL
                       AND c.cancelado_em IS NULL AND c.inicio > @agora AND c.inicio <= @em30
                       AND (p.alertado_30_em IS NULL OR c.inicio <= @em10))
            OR EXISTS (SELECT 1
                         FROM gestor.compromissos c
                        WHERE c.criado_por = @eu AND c.cancelado_em IS NULL
                          AND c.inicio > @agora AND c.inicio <= @em30
                          AND c.criador_alertado_10_em IS NULL
                          AND (c.criador_alertado_30_em IS NULL OR c.inicio <= @em10)
                          AND NOT EXISTS (SELECT 1 FROM gestor.compromisso_participantes p
                                           WHERE p.compromisso_id = c.id AND p.pessoa_id = @eu))
         BEGIN
           SET XACT_ABORT ON;
           BEGIN TRAN;
             DECLARE @avisar TABLE (compromisso_id UNIQUEIDENTIFIER, do_criador BIT);

             UPDATE p
                SET alertado_30_em = COALESCE(p.alertado_30_em, @agora),
                    alertado_10_em = CASE WHEN c.inicio <= @em10 THEN @agora ELSE NULL END
             OUTPUT inserted.compromisso_id, 0 INTO @avisar
               FROM gestor.compromisso_participantes p
               JOIN gestor.compromissos c ON c.id = p.compromisso_id
              WHERE p.pessoa_id = @eu AND p.alertado_10_em IS NULL
                AND c.cancelado_em IS NULL AND c.inicio > @agora AND c.inicio <= @em30
                AND (p.alertado_30_em IS NULL OR c.inicio <= @em10);

             UPDATE c
                SET criador_alertado_30_em = COALESCE(c.criador_alertado_30_em, @agora),
                    criador_alertado_10_em = CASE WHEN c.inicio <= @em10 THEN @agora ELSE NULL END
             OUTPUT inserted.id, 1 INTO @avisar
               FROM gestor.compromissos c
              WHERE c.criado_por = @eu AND c.cancelado_em IS NULL
                AND c.inicio > @agora AND c.inicio <= @em30
                AND c.criador_alertado_10_em IS NULL
                AND (c.criador_alertado_30_em IS NULL OR c.inicio <= @em10)
                AND NOT EXISTS (SELECT 1 FROM gestor.compromisso_participantes p
                                 WHERE p.compromisso_id = c.id AND p.pessoa_id = @eu);

             -- "Agenda em 10 min · 14:00" — o prefixo é PREFIXO_ALERTA_DE_COMPROMISSO.
             -- Arredonda para cima: aos 9min30s ainda é "em 10 min".
             INSERT INTO gestor.notificacoes
               (destinatario_id, de_pessoa_id, tipo, titulo, descricao, sala, titulo_da_sala, projeto_id)
             SELECT @eu,
                    CASE WHEN c.criado_por = @eu THEN NULL ELSE c.criado_por END,
                    'compromisso',
                    N'Agenda em ' +
                      CAST((DATEDIFF(SECOND, @agora, c.inicio) + 59) / 60 AS NVARCHAR(4)) +
                      N' min · ' +
                      CONVERT(VARCHAR(5), c.inicio AT TIME ZONE N'E. South America Standard Time', 108),
                    LEFT(c.assunto + ISNULL(N' · ' + c.local, N''), 400),
                    c.sala, NULL, c.id
               FROM @avisar a
               JOIN gestor.compromissos c ON c.id = a.compromisso_id;
           COMMIT;
         END`,
      );
  } catch (e) {
    if (ehAgendaTravadaInativa(e)) {
      inativaAte = Date.now() + ESPERA_SE_INATIVA_MS;
      return;
    }
    console.warn("[agenda travada] não entregou os avisos:", (e as Error)?.message);
  }
}
