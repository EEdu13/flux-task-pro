/*
 * Mural: responder e reagir num comentário (27/11/2026).
 *
 * Pedido do usuário: os comentários do mural ganham um "Reagir" (um emoji por
 * pessoa, como no post) e um "Responder", que coloca a resposta embaixo da
 * mensagem.
 *
 *   mural_comentarios.resposta_de   o comentário que esta mensagem responde.
 *                                   NULL = comentário direto no post (todos os
 *                                   que já existem). Só um nível: responder a
 *                                   uma resposta pendura na mesma conversa (o
 *                                   servidor grava a raiz).
 *   IX_mural_coment_resposta        as respostas de cada comentário, das mais
 *                                   novas para as mais antigas (o feed mostra
 *                                   as 2 últimas e conta o resto).
 *   mural_comentario_reacoes        uma reação por pessoa por comentário, igual
 *                                   a mural_reacoes. Some junto com o
 *                                   comentário (e o comentário com o post).
 *
 * Só ACRESCENTA, e só no schema gestor. A coluna nova nasce vazia, então nada
 * muda nos comentários existentes nem no código que está no ar hoje (ele não
 * lê a coluna nem a tabela nova).
 *
 * Pode rodar mais de uma vez: cada passo confere se já foi feito.
 *
 * Para desfazer:
 *   DROP TABLE gestor.mural_comentario_reacoes;
 *   DROP INDEX IX_mural_coment_resposta ON gestor.mural_comentarios;
 *   ALTER TABLE gestor.mural_comentarios DROP COLUMN resposta_de;
 */

IF COL_LENGTH('gestor.mural_comentarios', 'resposta_de') IS NULL
  ALTER TABLE gestor.mural_comentarios ADD resposta_de UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = 'IX_mural_coment_resposta'
                  AND object_id = OBJECT_ID('gestor.mural_comentarios'))
  CREATE NONCLUSTERED INDEX IX_mural_coment_resposta
    ON gestor.mural_comentarios (resposta_de, criado_em DESC)
    INCLUDE (autor_id)
    WHERE ([resposta_de] IS NOT NULL AND [excluido_em] IS NULL);
GO

IF OBJECT_ID('gestor.mural_comentario_reacoes', 'U') IS NULL
  CREATE TABLE gestor.mural_comentario_reacoes (
    comentario_id UNIQUEIDENTIFIER NOT NULL,
    pessoa_id INT NOT NULL,
    emoji NVARCHAR(16) NOT NULL,
    em DATETIMEOFFSET(3) NOT NULL
      CONSTRAINT DF_mural_coment_reacoes_em DEFAULT (sysdatetimeoffset()),
    CONSTRAINT PK_gestor_mural_comentario_reacoes PRIMARY KEY CLUSTERED (comentario_id, pessoa_id),
    CONSTRAINT FK_mural_coment_reacoes_coment FOREIGN KEY (comentario_id)
      REFERENCES gestor.mural_comentarios(id) ON DELETE CASCADE
  );
GO
