/*
 * Agenda travada — o "compromisso" do calendário (pedido do usuário, 14/10/2026):
 * "no calendário colocar aquelas linhas de horário; com o botão direito,
 * 'Travar agenda': abre as pessoas e você trava a agenda dela naquele horário,
 * tipo como o Outlook faz. E 30 e 10 min antes o CONECTA vem pra primeiro
 * plano e mostra um card avisando ... inclusive avisa quem criou."
 *
 *   compromissos               o horário travado: assunto, início/fim, local
 *                              (texto livre) e, se houver, a sala de voz e
 *                              vídeo do CONECTA (o `name` de src/lib/rooms.ts).
 *                              Cancelar é marcar `cancelado_em` — a linha fica,
 *                              para o aviso de cancelamento ter a que apontar.
 *                              `criador_alertado_30_em/10_em` marcam os avisos
 *                              de quem criou e NÃO está entre os participantes
 *                              (quem criou e participa recebe pela própria linha
 *                              de participante — um aviso só).
 *   compromisso_participantes  quem teve a agenda travada. `alertado_30_em` e
 *                              `alertado_10_em` fazem cada aviso sair uma vez só.
 *
 * Os avisos não têm relógio próprio: quem os entrega é a leitura da sineta
 * (`listarNotificacoes`), que o app já repete a cada minuto — igual aos
 * lembretes da agenda pessoal. Os índices filtrados abaixo deixam essa
 * varredura barata: ela só olha as linhas ainda não avisadas da pessoa.
 *
 * Também amplia uma lista fechada que já existe:
 *   - gestor.notificacoes.tipo ganha 'compromisso'.
 *   ATENÇÃO: a migração do Mural (2026-10-14-mural.sql), ainda pendente,
 *   redefine o mesmo CK_notif_tipo com 'comunicado' e 'mural'. Por isso aqui o
 *   CK vira a UNIÃO completa (lista de hoje + 'comunicado','mural' +
 *   'compromisso'): fica certo rodando antes ou depois da do Mural. Se a do
 *   Mural rodar DEPOIS desta, ela tira 'compromisso' do CK — rode esta por
 *   último, ou reaplique só o bloco do CK no fim.
 *
 * Fora isso, só ACRESCENTA tabelas; não mexe em dado nenhum.
 * Volta atrás: ver o bloco comentado no fim do arquivo.
 */

SET XACT_ABORT ON;
BEGIN TRAN;

CREATE TABLE gestor.compromissos (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_compromissos_id DEFAULT (newsequentialid()),
  criado_por INT NOT NULL,
  assunto NVARCHAR(160) NOT NULL,
  descricao NVARCHAR(1000) NULL,
  local NVARCHAR(120) NULL,
  sala NVARCHAR(80) NULL,
  inicio DATETIMEOFFSET(3) NOT NULL,
  fim DATETIMEOFFSET(3) NOT NULL,
  criado_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_compromissos_criado_em DEFAULT (sysdatetimeoffset()),
  atualizado_em DATETIMEOFFSET(3) NULL,
  cancelado_em DATETIMEOFFSET(3) NULL,
  cancelado_por INT NULL,
  criador_alertado_30_em DATETIMEOFFSET(3) NULL,
  criador_alertado_10_em DATETIMEOFFSET(3) NULL,
  CONSTRAINT PK_gestor_compromissos PRIMARY KEY CLUSTERED (id),
  CONSTRAINT CK_compromissos_periodo CHECK ([fim]>[inicio])
);
-- O calendário (período) e a varredura dos avisos (próximos 30 min): só os ativos.
CREATE NONCLUSTERED INDEX IX_compromissos_inicio ON gestor.compromissos (inicio)
  INCLUDE (fim, criado_por)
  WHERE ([cancelado_em] IS NULL);
-- Os de quem criou: o calendário dele e o aviso dele ainda pendente.
CREATE NONCLUSTERED INDEX IX_compromissos_criador ON gestor.compromissos (criado_por, inicio)
  INCLUDE (fim, criador_alertado_30_em, criador_alertado_10_em)
  WHERE ([cancelado_em] IS NULL);

CREATE TABLE gestor.compromisso_participantes (
  compromisso_id UNIQUEIDENTIFIER NOT NULL,
  pessoa_id INT NOT NULL,
  alertado_30_em DATETIMEOFFSET(3) NULL,
  alertado_10_em DATETIMEOFFSET(3) NULL,
  CONSTRAINT PK_gestor_compromisso_participantes PRIMARY KEY CLUSTERED (compromisso_id, pessoa_id),
  CONSTRAINT FK_comp_part_compromisso FOREIGN KEY (compromisso_id) REFERENCES gestor.compromissos(id) ON DELETE CASCADE
);
-- A agenda de uma pessoa num período (calendário e conflitos).
CREATE NONCLUSTERED INDEX IX_comp_part_pessoa ON gestor.compromisso_participantes (pessoa_id, compromisso_id);
-- A varredura dos avisos: só as linhas da pessoa que ainda devem o aviso de 10 min.
CREATE NONCLUSTERED INDEX IX_comp_part_pendentes ON gestor.compromisso_participantes (pessoa_id, compromisso_id)
  INCLUDE (alertado_30_em)
  WHERE ([alertado_10_em] IS NULL);

-- 'compromisso': os avisos da agenda travada (criada, mudada, cancelada, 30 e 10 min antes).
-- União completa: vale com ou sem a migração do Mural aplicada (ver o cabeçalho).
ALTER TABLE gestor.notificacoes DROP CONSTRAINT CK_notif_tipo;
ALTER TABLE gestor.notificacoes WITH CHECK ADD CONSTRAINT CK_notif_tipo
  CHECK ([tipo]='lembrete' OR [tipo]='chamada_perdida' OR [tipo]='concluida' OR [tipo]='prazo' OR [tipo]='atribuida' OR [tipo]='mencao' OR [tipo]='projeto' OR [tipo]='comunicado' OR [tipo]='mural' OR [tipo]='compromisso');

COMMIT;

/* ---- Volta atrás (só se precisar desfazer; apaga as agendas travadas) ----
SET XACT_ABORT ON;
BEGIN TRAN;
DELETE FROM gestor.notificacoes WHERE tipo = 'compromisso';
ALTER TABLE gestor.notificacoes DROP CONSTRAINT CK_notif_tipo;
-- Mantém 'comunicado' e 'mural' (inofensivos sem o Mural; necessários com ele).
ALTER TABLE gestor.notificacoes WITH CHECK ADD CONSTRAINT CK_notif_tipo
  CHECK ([tipo]='lembrete' OR [tipo]='chamada_perdida' OR [tipo]='concluida' OR [tipo]='prazo' OR [tipo]='atribuida' OR [tipo]='mencao' OR [tipo]='projeto' OR [tipo]='comunicado' OR [tipo]='mural');
DROP TABLE gestor.compromisso_participantes;
DROP TABLE gestor.compromissos;
COMMIT;
*/
