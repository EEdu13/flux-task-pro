/*
 * Mural — o feed de notícias da empresa (pedido do usuário, 14/10/2026):
 * "colocar um feed de notícias depois do Início, permitir publicarem notícias,
 * aniversariantes da semana/do mês… divertido mas sem atrapalhar a essência
 * do sistema".
 *
 *   mural_posts          a publicação: texto (e até 4 fotos, que moram em
 *                        gestor.anexos com dono_tipo='mural'). Um comunicado
 *                        oficial é um post com `comunicado = 1` e título;
 *                        só a gerência e o RH publicam comunicado, só a
 *                        gerência fixa. Excluir é marcar `excluido_em`.
 *   mural_reacoes        uma reação por pessoa por post, como na tarefa.
 *   mural_comentarios    lista simples sob o post (sem resposta a resposta).
 *   mural_leituras       o "Li e estou ciente" dos comunicados.
 *   mural_homenageados   (fase 2, 14/10/2026) quem o post celebra: as pessoas
 *                        agradecidas num elogio, o dono de uma conquista.
 *   mural_enquete_opcoes (fase 3) as 2 a 6 opções de uma enquete;
 *   mural_enquete_votos  um voto por pessoa por enquete (a chave garante).
 *   mural_evento_presencas  o "Vou participar" de um evento, um por pessoa.
 *   mural_lotes          uma linha por dia: a marca (e a trava) do lote diário
 *                        que gera as conquistas automáticas. Só um servidor
 *                        consegue inserir a linha do dia — é ele que roda.
 *   aniversarios         dia e mês (SEM ano, por privacidade) que a própria
 *                        pessoa informa em Configurações. Tabela e não
 *                        gestor.preferencias: o mural pergunta "quem faz
 *                        aniversário neste mês", e numa tabela chave/valor
 *                        isso seria varrer e converter texto de todo mundo.
 *                        Aqui é uma busca no índice (mes, dia).
 *
 * Fases 2 e 3 (14/10/2026): o post ganha um `tipo` — geral | campo |
 * comunicado | evento | conquista | elogio | enquete — e as colunas de cada
 * um (evento: data e local; enquete: fim e fechamento; elogio: a tarefa;
 * conquista: `automatico`, a `chave_auto` que impede repetir e o `selo`).
 * As conquistas automáticas têm autor 0 ("o sistema"). A opção de não
 * aparecer nelas mora em gestor.preferencias (chave 'mural_conquistas') e
 * não precisa de coluna nova.
 *
 * E um índice filtrado novo em gestor.tarefas (só as do pack), para o lote
 * diário contar as sequências de pack sem varrer a tabela.
 *
 * Também amplia duas listas fechadas que já existem:
 *   - gestor.anexos.dono_tipo ganha 'mural' (as fotos do post);
 *   - gestor.notificacoes.tipo ganha 'comunicado' (aviso para todos) e
 *     'mural' (alguém te marcou com @ num post).
 *
 * Fora isso, só ACRESCENTA tabelas; não mexe em dado nenhum.
 * Volta atrás: ver o bloco comentado no fim do arquivo.
 */

SET XACT_ABORT ON;
BEGIN TRAN;

CREATE TABLE gestor.mural_posts (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_mural_posts_id DEFAULT (newsequentialid()),
  autor_id INT NOT NULL,
  texto NVARCHAR(4000) NOT NULL,
  comunicado BIT NOT NULL CONSTRAINT DF_mural_posts_comunicado DEFAULT ((0)),
  titulo NVARCHAR(160) NULL,
  fixado_em DATETIMEOFFSET(3) NULL,
  fixado_por INT NULL,
  criado_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_mural_posts_em DEFAULT (sysdatetimeoffset()),
  editado_em DATETIMEOFFSET(3) NULL,
  excluido_em DATETIMEOFFSET(3) NULL,
  excluido_por INT NULL,
  -- Fases 2 e 3 (14/10/2026).
  tipo NVARCHAR(12) NOT NULL CONSTRAINT DF_mural_posts_tipo DEFAULT (N'geral'),
  automatico BIT NOT NULL CONSTRAINT DF_mural_posts_auto DEFAULT ((0)),
  selo NVARCHAR(16) NULL,
  chave_auto NVARCHAR(80) NULL,
  tarefa_id UNIQUEIDENTIFIER NULL,
  evento_inicio DATETIMEOFFSET(3) NULL,
  evento_local NVARCHAR(160) NULL,
  enquete_fim DATETIMEOFFSET(3) NULL,
  enquete_fechada_em DATETIMEOFFSET(3) NULL,
  CONSTRAINT PK_gestor_mural_posts PRIMARY KEY CLUSTERED (id),
  CONSTRAINT CK_mural_posts_tipo CHECK ([tipo]='geral' OR [tipo]='campo' OR [tipo]='comunicado' OR [tipo]='evento' OR [tipo]='conquista' OR [tipo]='elogio' OR [tipo]='enquete'),
  -- `comunicado` continua valendo (fase 1) e anda junto com o tipo.
  CONSTRAINT CK_mural_posts_comunicado_tipo CHECK ([comunicado]=(1) AND [tipo]='comunicado' OR [comunicado]=(0) AND [tipo]<>'comunicado'),
  -- Comunicado e evento sempre têm título; e só comunicado é fixado.
  CONSTRAINT CK_mural_posts_titulo CHECK ([tipo]<>'comunicado' AND [tipo]<>'evento' OR [titulo] IS NOT NULL),
  CONSTRAINT CK_mural_posts_fixado CHECK ([fixado_em] IS NULL OR [comunicado]=(1)),
  CONSTRAINT CK_mural_posts_evento CHECK ([tipo]<>'evento' OR [evento_inicio] IS NOT NULL),
  -- Post automático sempre tem a chave que impede gerar duas vezes.
  CONSTRAINT CK_mural_posts_auto CHECK ([automatico]=(0) OR [chave_auto] IS NOT NULL),
  CONSTRAINT FK_mural_posts_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id) ON DELETE SET NULL
);
-- O feed: 20 por página, do mais novo para o mais antigo, por chave
-- (criado_em, id). Os fixados saem do feed e vão para o topo (índice abaixo).
CREATE NONCLUSTERED INDEX IX_mural_posts_feed ON gestor.mural_posts (criado_em DESC, id DESC)
  INCLUDE (autor_id, comunicado)
  WHERE ([excluido_em] IS NULL AND [fixado_em] IS NULL);
CREATE NONCLUSTERED INDEX IX_mural_posts_fixados ON gestor.mural_posts (fixado_em DESC)
  WHERE ([fixado_em] IS NOT NULL AND [excluido_em] IS NULL);
-- O feed filtrado ("Do campo", "Eventos"…): o mesmo caminho, por tipo.
CREATE NONCLUSTERED INDEX IX_mural_posts_tipo ON gestor.mural_posts (tipo, criado_em DESC, id DESC)
  WHERE ([excluido_em] IS NULL AND [fixado_em] IS NULL);
-- Uma conquista automática por chave (tipo+pessoa+período): o lote pode rodar
-- de novo sem repetir post.
CREATE UNIQUE NONCLUSTERED INDEX UX_mural_posts_chave_auto ON gestor.mural_posts (chave_auto)
  WHERE ([chave_auto] IS NOT NULL);
-- "Próximos eventos" do painel lateral.
CREATE NONCLUSTERED INDEX IX_mural_posts_eventos ON gestor.mural_posts (evento_inicio)
  INCLUDE (titulo, evento_local)
  WHERE ([tipo]='evento' AND [excluido_em] IS NULL);

CREATE TABLE gestor.mural_homenageados (
  post_id UNIQUEIDENTIFIER NOT NULL,
  pessoa_id INT NOT NULL,
  CONSTRAINT PK_gestor_mural_homenageados PRIMARY KEY CLUSTERED (post_id, pessoa_id),
  CONSTRAINT FK_mural_homenageados_post FOREIGN KEY (post_id) REFERENCES gestor.mural_posts(id) ON DELETE CASCADE
);

CREATE TABLE gestor.mural_enquete_opcoes (
  post_id UNIQUEIDENTIFIER NOT NULL,
  ordem TINYINT NOT NULL,
  texto NVARCHAR(120) NOT NULL,
  CONSTRAINT PK_gestor_mural_enquete_opcoes PRIMARY KEY CLUSTERED (post_id, ordem),
  CONSTRAINT FK_mural_enquete_opcoes_post FOREIGN KEY (post_id) REFERENCES gestor.mural_posts(id) ON DELETE CASCADE,
  CONSTRAINT CK_mural_enquete_opcoes_ordem CHECK ([ordem]>=(1) AND [ordem]<=(6))
);

CREATE TABLE gestor.mural_enquete_votos (
  post_id UNIQUEIDENTIFIER NOT NULL,
  pessoa_id INT NOT NULL,
  ordem TINYINT NOT NULL,
  em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_mural_enquete_votos_em DEFAULT (sysdatetimeoffset()),
  -- Um voto por pessoa por enquete.
  CONSTRAINT PK_gestor_mural_enquete_votos PRIMARY KEY CLUSTERED (post_id, pessoa_id),
  CONSTRAINT FK_mural_enquete_votos_opcao FOREIGN KEY (post_id, ordem) REFERENCES gestor.mural_enquete_opcoes(post_id, ordem) ON DELETE CASCADE
);

CREATE TABLE gestor.mural_evento_presencas (
  post_id UNIQUEIDENTIFIER NOT NULL,
  pessoa_id INT NOT NULL,
  em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_mural_evento_presencas_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_mural_evento_presencas PRIMARY KEY CLUSTERED (post_id, pessoa_id),
  CONSTRAINT FK_mural_evento_presencas_post FOREIGN KEY (post_id) REFERENCES gestor.mural_posts(id) ON DELETE CASCADE
);

-- A marca do lote diário das conquistas (dia de Brasília). Inserir a linha do
-- dia é pegar a trava; `concluido_em` nulo há mais de 15 min = lote que caiu,
-- e outro servidor pode retomar.
CREATE TABLE gestor.mural_lotes (
  dia DATE NOT NULL,
  iniciado_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_mural_lotes_em DEFAULT (sysdatetimeoffset()),
  concluido_em DATETIMEOFFSET(3) NULL,
  tentativas INT NOT NULL CONSTRAINT DF_mural_lotes_tentativas DEFAULT ((1)),
  posts INT NULL,
  CONSTRAINT PK_gestor_mural_lotes PRIMARY KEY CLUSTERED (dia)
);

-- As sequências de pack do lote diário: só as tarefas do pack, por prazo.
CREATE NONCLUSTERED INDEX IX_tarefas_pack_prazo ON gestor.tarefas (prazo)
  INCLUDE (responsavel_id, situacao, concluida_em, data_real_de_conclusao, arquivada_em)
  WHERE ([no_pack]=(1));

CREATE TABLE gestor.mural_reacoes (
  post_id UNIQUEIDENTIFIER NOT NULL,
  pessoa_id INT NOT NULL,
  emoji NVARCHAR(16) NOT NULL,
  em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_mural_reacoes_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_mural_reacoes PRIMARY KEY CLUSTERED (post_id, pessoa_id),
  CONSTRAINT FK_mural_reacoes_post FOREIGN KEY (post_id) REFERENCES gestor.mural_posts(id) ON DELETE CASCADE
);

CREATE TABLE gestor.mural_comentarios (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_mural_coment_id DEFAULT (newsequentialid()),
  post_id UNIQUEIDENTIFIER NOT NULL,
  autor_id INT NOT NULL,
  texto NVARCHAR(1000) NOT NULL,
  criado_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_mural_coment_em DEFAULT (sysdatetimeoffset()),
  excluido_em DATETIMEOFFSET(3) NULL,
  CONSTRAINT PK_gestor_mural_comentarios PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_mural_coment_post FOREIGN KEY (post_id) REFERENCES gestor.mural_posts(id) ON DELETE CASCADE
);
CREATE NONCLUSTERED INDEX IX_mural_coment_post ON gestor.mural_comentarios (post_id, criado_em DESC)
  INCLUDE (autor_id)
  WHERE ([excluido_em] IS NULL);

CREATE TABLE gestor.mural_leituras (
  post_id UNIQUEIDENTIFIER NOT NULL,
  pessoa_id INT NOT NULL,
  lido_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_mural_leituras_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_mural_leituras PRIMARY KEY CLUSTERED (post_id, pessoa_id),
  CONSTRAINT FK_mural_leituras_post FOREIGN KEY (post_id) REFERENCES gestor.mural_posts(id) ON DELETE CASCADE
);

CREATE TABLE gestor.aniversarios (
  pessoa_id INT NOT NULL,
  dia TINYINT NOT NULL,
  mes TINYINT NOT NULL,
  mostrar BIT NOT NULL CONSTRAINT DF_aniversarios_mostrar DEFAULT ((1)),
  atualizado_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_aniversarios_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_aniversarios PRIMARY KEY CLUSTERED (pessoa_id),
  CONSTRAINT CK_aniversarios_mes CHECK ([mes]>=(1) AND [mes]<=(12)),
  -- Dia que existe naquele mês (29/02 vale: o mural o mostra em 28/02 nos anos comuns).
  CONSTRAINT CK_aniversarios_dia CHECK ([dia]>=(1) AND [dia]<=(CASE WHEN [mes]=(2) THEN (29) WHEN [mes] IN ((4),(6),(9),(11)) THEN (30) ELSE (31) END))
);
CREATE NONCLUSTERED INDEX IX_aniversarios_mes_dia ON gestor.aniversarios (mes, dia)
  INCLUDE (pessoa_id)
  WHERE ([mostrar]=(1));

-- As fotos do post são anexos comuns, com dono 'mural'.
ALTER TABLE gestor.anexos DROP CONSTRAINT CK_anexos_dono_tipo;
ALTER TABLE gestor.anexos WITH CHECK ADD CONSTRAINT CK_anexos_dono_tipo
  CHECK ([dono_tipo]='mensagem' OR [dono_tipo]='tarefa' OR [dono_tipo]='comentario' OR [dono_tipo]='projeto' OR [dono_tipo]='mural');

-- 'comunicado' vai para todos; 'mural' é a marcação com @, o elogio e o @ em
-- comentário. A lista é a UNIÃO com a migração da agenda (2026-10-14-agenda-
-- travada.sql, que acrescenta 'compromisso'): as duas redefinem a mesma regra
-- com a lista inteira, então rodam em qualquer ordem.
ALTER TABLE gestor.notificacoes DROP CONSTRAINT CK_notif_tipo;
ALTER TABLE gestor.notificacoes WITH CHECK ADD CONSTRAINT CK_notif_tipo
  CHECK ([tipo]='lembrete' OR [tipo]='chamada_perdida' OR [tipo]='concluida' OR [tipo]='prazo' OR [tipo]='atribuida' OR [tipo]='mencao' OR [tipo]='projeto' OR [tipo]='comunicado' OR [tipo]='mural' OR [tipo]='compromisso');

COMMIT;

/* ---- Volta atrás (só se precisar desfazer; apaga os posts do mural, as
   enquetes, os eventos e as conquistas) ----
SET XACT_ABORT ON;
BEGIN TRAN;
DELETE FROM gestor.notificacoes WHERE tipo IN ('comunicado', 'mural');
-- Volta à lista sem os tipos do mural, mas MANTÉM 'compromisso' (da migração
-- da agenda): desfazer o mural não pode quebrar os avisos de compromisso.
ALTER TABLE gestor.notificacoes DROP CONSTRAINT CK_notif_tipo;
ALTER TABLE gestor.notificacoes WITH CHECK ADD CONSTRAINT CK_notif_tipo
  CHECK ([tipo]='lembrete' OR [tipo]='chamada_perdida' OR [tipo]='concluida' OR [tipo]='prazo' OR [tipo]='atribuida' OR [tipo]='mencao' OR [tipo]='projeto' OR [tipo]='compromisso');
-- As fotos no Blob ficam órfãs (não quebram nada); as linhas saem aqui.
DELETE FROM gestor.anexos WHERE dono_tipo = 'mural';
ALTER TABLE gestor.anexos DROP CONSTRAINT CK_anexos_dono_tipo;
ALTER TABLE gestor.anexos WITH CHECK ADD CONSTRAINT CK_anexos_dono_tipo
  CHECK ([dono_tipo]='mensagem' OR [dono_tipo]='tarefa' OR [dono_tipo]='comentario' OR [dono_tipo]='projeto');
DROP INDEX IX_tarefas_pack_prazo ON gestor.tarefas;
DROP TABLE gestor.mural_lotes;
DROP TABLE gestor.mural_evento_presencas;
DROP TABLE gestor.mural_enquete_votos;
DROP TABLE gestor.mural_enquete_opcoes;
DROP TABLE gestor.mural_homenageados;
DROP TABLE gestor.mural_leituras;
DROP TABLE gestor.mural_comentarios;
DROP TABLE gestor.mural_reacoes;
DROP TABLE gestor.mural_posts;
DROP TABLE gestor.aniversarios;
COMMIT;
*/
