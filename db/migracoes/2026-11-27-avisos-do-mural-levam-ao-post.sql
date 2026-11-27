/*
 * Avisos do Mural levam até o post, e as reações viram um aviso agrupado (27/11/2026).
 *
 * Pedido do usuário: as reações no mural chegam na caixa de entrada num aviso só
 * ("Eduardo · e mais 3 pessoas reagiram ao seu post no mural"), e clicar no aviso
 * leva até o post — até o comentário, quando o aviso é de um.
 *
 *   gestor.notificacoes.mural_post_id        o post que o clique abre. Gravado
 *                                            nos avisos do mural daqui em diante
 *                                            (comunicado, elogio, @, reação).
 *                                            NULL nos avisos antigos e nos que não
 *                                            são do mural: abrem como antes.
 *   gestor.notificacoes.mural_comentario_id  o comentário a destacar (aviso de @
 *                                            num comentário ou reação nele).
 *   gestor.notificacoes.grupo                junta os avisos de reação do mesmo
 *                                            post/comentário enquanto não lidos:
 *                                            "reacao:p:<post>" ou
 *                                            "reacao:c:<comentário>".
 *   IX_notif_grupo                           acha o aviso do grupo de cada pessoa.
 *                                            Filtrado: só os avisos com grupo.
 *
 * Sem chave estrangeira nas duas colunas do mural, de propósito: o post e o
 * comentário são excluídos só com `excluido_em` (nunca somem do banco), e o aviso
 * de um post excluído só não acha o post — a tela avisa.
 *
 * Só ACRESCENTA, e só no schema gestor. As colunas nascem vazias: nenhum aviso
 * existente muda, e o código que está no ar não as lê.
 *
 * Pode rodar mais de uma vez: cada passo confere se já foi feito.
 *
 * Para desfazer:
 *   DROP INDEX IX_notif_grupo ON gestor.notificacoes;
 *   ALTER TABLE gestor.notificacoes DROP COLUMN mural_post_id, mural_comentario_id, grupo;
 */

IF COL_LENGTH('gestor.notificacoes', 'mural_post_id') IS NULL
  ALTER TABLE gestor.notificacoes ADD mural_post_id UNIQUEIDENTIFIER NULL;
GO

IF COL_LENGTH('gestor.notificacoes', 'mural_comentario_id') IS NULL
  ALTER TABLE gestor.notificacoes ADD mural_comentario_id UNIQUEIDENTIFIER NULL;
GO

IF COL_LENGTH('gestor.notificacoes', 'grupo') IS NULL
  ALTER TABLE gestor.notificacoes ADD grupo NVARCHAR(80) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = 'IX_notif_grupo'
                  AND object_id = OBJECT_ID('gestor.notificacoes'))
  CREATE NONCLUSTERED INDEX IX_notif_grupo
    ON gestor.notificacoes (grupo, destinatario_id)
    INCLUDE (lida, em)
    WHERE ([grupo] IS NOT NULL);
GO
