/*
 * Índices para as sondagens do chat e da sineta (03/11/2026).
 *
 * O relatório de uso do banco apontou o CONECTA com ~1.000 s por semana em
 * consultas pequenas repetidas milhares de vezes. A maior parte saiu pelo
 * código (ver `sinal-das-conversas.server`, a lista de conversas reescrita e
 * a etiqueta em `COLUNAS_TAREFA`); estes índices fecham o que sobrou:
 *
 *   IX_notif_destinatario_em  a sineta (`listarNotificacoes`) pede os 200
 *                             avisos mais novos de uma pessoa, lidos ou não.
 *                             O IX_notif_nao_lidas é filtrado em lida=0 e não
 *                             serve; o IX_notif_destinatario é por tipo e
 *                             obrigava ordenar tudo a cada minuto.
 *   IX_msg_conversa           ganha corpo e lida_em: a conversa aberta e a
 *                             última mensagem da lista leem direto do índice,
 *                             sem voltar à tabela linha a linha.
 *   IX_msg_nao_lidas          ganha de_pessoa_id e em: "com quem eu falo" e a
 *                             contagem de não lidas param de voltar à tabela.
 *
 * Só índices: nenhum dado muda. ONLINE = ON não trava as tabelas enquanto
 * criam. Para desfazer: DROP INDEX IX_notif_destinatario_em ON
 * gestor.notificacoes, e recriar os dois de mensagens sem o INCLUDE.
 */

CREATE NONCLUSTERED INDEX IX_notif_destinatario_em
  ON gestor.notificacoes (destinatario_id, em DESC)
  INCLUDE (de_pessoa_id, tipo, titulo, descricao, tarefa_id, sala, titulo_da_sala, projeto_id, lida)
  WITH (ONLINE = ON);

CREATE NONCLUSTERED INDEX IX_msg_conversa
  ON gestor.mensagens (de_pessoa_id, para_pessoa_id, em DESC)
  INCLUDE (corpo, lida_em)
  WITH (DROP_EXISTING = ON, ONLINE = ON);

CREATE NONCLUSTERED INDEX IX_msg_nao_lidas
  ON gestor.mensagens (para_pessoa_id, lida_em)
  INCLUDE (de_pessoa_id, em)
  WITH (DROP_EXISTING = ON, ONLINE = ON);
