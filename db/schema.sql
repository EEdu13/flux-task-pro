-- Schema `gestor` do SGL - CONECTA (flux-task-pro), gerado do banco em 2026-10-08.
-- Fonte da verdade do que existe no Azure SQL. Ao criar ou alterar uma tabela,
-- atualize este arquivo junto (scripts/exportar-schema.mjs gera de novo).
-- Só o schema `gestor` — as tabelas `dbo.*` e `iam.*` são de outros sistemas.

CREATE TABLE gestor.anexos (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_anexos_id DEFAULT (newsequentialid()),
  dono_tipo NVARCHAR(12) NOT NULL,
  dono_id UNIQUEIDENTIFIER NOT NULL,
  nome NVARCHAR(260) NOT NULL,
  tamanho BIGINT NOT NULL,
  tipo_mime NVARCHAR(120) NOT NULL,
  url NVARCHAR(500) NOT NULL,
  enviado_por INT NOT NULL,
  enviado_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_anexos_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_anexos PRIMARY KEY CLUSTERED (id),
  CONSTRAINT CK_anexos_dono_tipo CHECK ([dono_tipo]='mensagem' OR [dono_tipo]='tarefa' OR [dono_tipo]='comentario' OR [dono_tipo]='projeto'),
  CONSTRAINT CK_anexos_tamanho CHECK ([tamanho]>(0))
);
CREATE NONCLUSTERED INDEX IX_anexos_dono ON gestor.anexos (dono_tipo, dono_id);

CREATE TABLE gestor.anotacoes_do_dia (
  pessoa_id INT NOT NULL,
  dia DATE NOT NULL,
  texto NVARCHAR(MAX) NOT NULL,
  atualizada_em DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_anotacoes_do_dia_atualizada DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_anotacoes_do_dia PRIMARY KEY CLUSTERED (pessoa_id, dia)
);

CREATE TABLE gestor.ata_participantes (
  ata_id UNIQUEIDENTIFIER NOT NULL,
  nome NVARCHAR(160) NOT NULL,
  pessoa_id INT NULL,
  CONSTRAINT PK_gestor_ata_participantes PRIMARY KEY CLUSTERED (ata_id, nome),
  CONSTRAINT FK_ata_part_ata FOREIGN KEY (ata_id) REFERENCES gestor.atas(id) ON DELETE CASCADE
);

CREATE TABLE gestor.atas (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_atas_id DEFAULT (newsequentialid()),
  sala NVARCHAR(80) NOT NULL,
  titulo_da_sala NVARCHAR(120) NULL,
  markdown NVARCHAR(MAX) NOT NULL,
  criada_por INT NOT NULL,
  criada_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_atas_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_atas PRIMARY KEY CLUSTERED (id)
);
CREATE NONCLUSTERED INDEX IX_atas_sala ON gestor.atas (sala, criada_em DESC);

CREATE TABLE gestor.atualizacoes_telegram (
  update_id BIGINT NOT NULL,
  recebido_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_tgup_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_atualizacoes_telegram PRIMARY KEY CLUSTERED (update_id)
);
CREATE NONCLUSTERED INDEX IX_tgup_limpeza ON gestor.atualizacoes_telegram (recebido_em);

CREATE TABLE gestor.avisos_de_tela (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_gestor_aviso_id DEFAULT (newsequentialid()),
  de_pessoa_id INT NOT NULL,
  de_nome NVARCHAR(120) NOT NULL,
  de_avatar NVARCHAR(20) NULL,
  para_pessoa_id INT NOT NULL,
  tipo NVARCHAR(20) NOT NULL CONSTRAINT DF_gestor_aviso_tipo DEFAULT ('cutucada'),
  mensagem NVARCHAR(200) NULL,
  em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_gestor_aviso_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_avisos_de_tela PRIMARY KEY CLUSTERED (id),
  CONSTRAINT CK_gestor_aviso_tipo CHECK ([tipo]='trator' OR [tipo]='cutucada'),
  CONSTRAINT CK_gestor_aviso_pessoas CHECK ([de_pessoa_id]<>[para_pessoa_id]),
  CONSTRAINT CK_gestor_aviso_trator CHECK ([tipo]<>'trator' OR [mensagem] IS NOT NULL)
);
CREATE NONCLUSTERED INDEX IX_avisos_para ON gestor.avisos_de_tela (para_pessoa_id, em DESC);

CREATE TABLE gestor.blocos_de_notas (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_notas_id DEFAULT (newsequentialid()),
  pessoa_id INT NOT NULL,
  titulo NVARCHAR(120) NOT NULL,
  conteudo NVARCHAR(MAX) NULL,
  ordem INT NOT NULL CONSTRAINT DF_notas_ordem DEFAULT ((0)),
  atualizada_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_notas_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_blocos_de_notas PRIMARY KEY CLUSTERED (id)
);
CREATE NONCLUSTERED INDEX IX_notas_pessoa ON gestor.blocos_de_notas (pessoa_id, ordem);

CREATE TABLE gestor.chamadas (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_gestor_cham_id DEFAULT (newsequentialid()),
  de_pessoa_id INT NOT NULL,
  para_pessoa_id INT NOT NULL,
  sala NVARCHAR(160) NOT NULL,
  sala_rotulo NVARCHAR(400) NOT NULL,
  situacao NVARCHAR(20) NOT NULL CONSTRAINT DF_gestor_cham_sit DEFAULT ('tocando'),
  em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_gestor_cham_em DEFAULT (sysdatetimeoffset()),
  respondida_em DATETIMEOFFSET(3) NULL,
  CONSTRAINT PK_gestor_chamadas PRIMARY KEY CLUSTERED (id),
  CONSTRAINT CK_gestor_chamadas_situacao CHECK ([situacao]='perdida' OR [situacao]='recusada' OR [situacao]='aceita' OR [situacao]='tocando')
);
CREATE NONCLUSTERED INDEX IX_chamadas_de ON gestor.chamadas (de_pessoa_id, em DESC);
CREATE NONCLUSTERED INDEX IX_chamadas_para ON gestor.chamadas (para_pessoa_id, situacao, em DESC);

CREATE TABLE gestor.comentarios (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_comentarios_id DEFAULT (newsequentialid()),
  tarefa_id UNIQUEIDENTIFIER NOT NULL,
  autor_id INT NOT NULL,
  texto NVARCHAR(MAX) NOT NULL,
  criado_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_comentarios_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_comentarios PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_comentarios_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id) ON DELETE CASCADE
);
CREATE NONCLUSTERED INDEX IX_comentarios_tarefa ON gestor.comentarios (tarefa_id, criado_em);

CREATE TABLE gestor.conclusoes (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_conclusoes_id DEFAULT (newsequentialid()),
  tarefa_id UNIQUEIDENTIFIER NOT NULL,
  pessoa_id INT NOT NULL,
  pontos INT NOT NULL,
  prioridade NVARCHAR(10) NOT NULL,
  no_prazo BIT NOT NULL,
  em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_conclusoes_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_conclusoes PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_conclusoes_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id)
);
CREATE NONCLUSTERED INDEX IX_conclusoes_pessoa_em ON gestor.conclusoes (pessoa_id, em DESC) INCLUDE (pontos, no_prazo);

CREATE TABLE gestor.contagem_de_chamadas (
  de_pessoa_id INT NOT NULL,
  sala NVARCHAR(80) NOT NULL,
  para_pessoa_id INT NOT NULL,
  vezes INT NOT NULL CONSTRAINT DF_contagem_vezes DEFAULT ((0)),
  ultima_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_contagem_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_contagem_de_chamadas PRIMARY KEY CLUSTERED (de_pessoa_id, sala, para_pessoa_id)
);
CREATE NONCLUSTERED INDEX IX_contagem_recentes ON gestor.contagem_de_chamadas (de_pessoa_id, ultima_em DESC) INCLUDE (para_pessoa_id, vezes);

CREATE TABLE gestor.conversas_limpas (
  pessoa_id INT NOT NULL,
  outro_id INT NOT NULL,
  limpa_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_conversas_limpas_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_conversas_limpas PRIMARY KEY CLUSTERED (pessoa_id, outro_id)
);

CREATE TABLE gestor.dias_de_recorrencia (
  tarefa_id UNIQUEIDENTIFIER NOT NULL,
  dia_da_semana TINYINT NOT NULL,
  CONSTRAINT PK_gestor_dias_de_recorrencia PRIMARY KEY CLUSTERED (tarefa_id, dia_da_semana),
  CONSTRAINT FK_dias_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id) ON DELETE CASCADE,
  CONSTRAINT CK_dias_intervalo CHECK ([dia_da_semana]>=(0) AND [dia_da_semana]<=(6))
);

CREATE TABLE gestor.dispositivos_conhecidos (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_disp_id DEFAULT (newsequentialid()),
  pessoa_id INT NOT NULL,
  apelido NVARCHAR(80) NULL,
  primeiro_acesso DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_disp_pri DEFAULT (sysdatetimeoffset()),
  ultimo_acesso DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_disp_ult DEFAULT (sysdatetimeoffset()),
  confiavel BIT NOT NULL CONSTRAINT DF_disp_conf DEFAULT ((0)),
  CONSTRAINT PK_gestor_dispositivos_conhecidos PRIMARY KEY CLUSTERED (id)
);
CREATE NONCLUSTERED INDEX IX_disp_pessoa ON gestor.dispositivos_conhecidos (pessoa_id, ultimo_acesso DESC);

CREATE TABLE gestor.entrada_whatsapp (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_wa_id DEFAULT (newsequentialid()),
  titulo NVARCHAR(200) NOT NULL,
  descricao NVARCHAR(MAX) NULL,
  telefone NVARCHAR(20) NULL,
  situacao NVARCHAR(12) NOT NULL CONSTRAINT DF_wa_sit DEFAULT ('pendente'),
  responsavel_id INT NULL,
  criador_id INT NULL,
  prazo DATETIMEOFFSET(3) NULL,
  recorrente BIT NOT NULL CONSTRAINT DF_wa_rec DEFAULT ((0)),
  recorre_ate DATETIMEOFFSET(3) NULL,
  exige_comprovante BIT NOT NULL CONSTRAINT DF_wa_comp DEFAULT ((0)),
  prioridade NVARCHAR(10) NOT NULL CONSTRAINT DF_wa_prio DEFAULT ('media'),
  criado_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_wa_em DEFAULT (sysdatetimeoffset()),
  processada_em DATETIMEOFFSET(3) NULL,
  tarefa_id UNIQUEIDENTIFIER NULL,
  CONSTRAINT PK_gestor_entrada_whatsapp PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_wa_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id) ON DELETE SET NULL
);
CREATE NONCLUSTERED INDEX IX_wa_pendentes ON gestor.entrada_whatsapp (criado_em DESC) WHERE ([processada_em] IS NULL);

CREATE TABLE gestor.etiquetas (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_etiquetas_id DEFAULT (newsequentialid()),
  nome NVARCHAR(40) NOT NULL,
  cor NVARCHAR(40) NULL,
  criada_por INT NOT NULL,
  criada_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_etiquetas_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_etiquetas PRIMARY KEY CLUSTERED (id),
  CONSTRAINT UQ_gestor_etiquetas_nome UNIQUE (nome)
);

CREATE TABLE gestor.grade_pessoal_celulas (
  pessoa_id INT NOT NULL,
  tarefa_id UNIQUEIDENTIFIER NOT NULL,
  coluna_id UNIQUEIDENTIFIER NOT NULL,
  valor NVARCHAR(400) NULL,
  CONSTRAINT PK_gestor_grade_pessoal_celulas PRIMARY KEY CLUSTERED (pessoa_id, tarefa_id, coluna_id),
  CONSTRAINT FK_grade_cel_coluna FOREIGN KEY (coluna_id) REFERENCES gestor.grade_pessoal_colunas(id) ON DELETE CASCADE,
  CONSTRAINT FK_grade_cel_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id) ON DELETE CASCADE
);

CREATE TABLE gestor.grade_pessoal_colunas (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_grade_col_id DEFAULT (newsequentialid()),
  pessoa_id INT NOT NULL,
  nome NVARCHAR(80) NOT NULL,
  tipo NVARCHAR(10) NOT NULL,
  ordem INT NOT NULL CONSTRAINT DF_grade_col_ordem DEFAULT ((0)),
  CONSTRAINT PK_gestor_grade_pessoal_colunas PRIMARY KEY CLUSTERED (id),
  CONSTRAINT CK_grade_col_tipo CHECK ([tipo]='datetime' OR [tipo]='time' OR [tipo]='date' OR [tipo]='select' OR [tipo]='number' OR [tipo]='text')
);
CREATE NONCLUSTERED INDEX IX_grade_col_pessoa ON gestor.grade_pessoal_colunas (pessoa_id, ordem);

CREATE TABLE gestor.historico_da_tarefa (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_historico_id DEFAULT (newsequentialid()),
  tarefa_id UNIQUEIDENTIFIER NOT NULL,
  autor_id INT NOT NULL,
  tipo NVARCHAR(14) NOT NULL,
  texto NVARCHAR(500) NOT NULL,
  em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_historico_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_historico_da_tarefa PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_historico_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id) ON DELETE CASCADE,
  CONSTRAINT CK_historico_tipo CHECK ([tipo]='mencao' OR [tipo]='concluida' OR [tipo]='editada' OR [tipo]='checklist' OR [tipo]='comentario' OR [tipo]='atribuicao' OR [tipo]='status' OR [tipo]='criada')
);
CREATE NONCLUSTERED INDEX IX_historico_tarefa ON gestor.historico_da_tarefa (tarefa_id, em DESC);

CREATE TABLE gestor.itens_de_checklist (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_checklist_id DEFAULT (newsequentialid()),
  tarefa_id UNIQUEIDENTIFIER NOT NULL,
  texto NVARCHAR(300) NOT NULL,
  feito BIT NOT NULL CONSTRAINT DF_checklist_feito DEFAULT ((0)),
  ordem INT NOT NULL CONSTRAINT DF_checklist_ordem DEFAULT ((0)),
  CONSTRAINT PK_gestor_itens_de_checklist PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_checklist_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id) ON DELETE CASCADE
);
CREATE NONCLUSTERED INDEX IX_checklist_tarefa ON gestor.itens_de_checklist (tarefa_id, ordem);

CREATE TABLE gestor.itens_do_modelo_de_pack (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_itens_modelo_id DEFAULT (newsequentialid()),
  modelo_id UNIQUEIDENTIFIER NOT NULL,
  titulo NVARCHAR(200) NOT NULL,
  minutos_estimados INT NULL,
  ordem INT NOT NULL CONSTRAINT DF_itens_modelo_ordem DEFAULT ((0)),
  CONSTRAINT PK_gestor_itens_do_modelo_de_pack PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_itens_modelo FOREIGN KEY (modelo_id) REFERENCES gestor.modelos_de_pack(id) ON DELETE CASCADE
);
CREATE NONCLUSTERED INDEX IX_itens_modelo ON gestor.itens_do_modelo_de_pack (modelo_id, ordem);

CREATE TABLE gestor.lembretes (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_lembretes_id DEFAULT (newsequentialid()),
  pessoa_id INT NOT NULL,
  quando DATETIMEOFFSET(7) NOT NULL,
  texto NVARCHAR(300) NOT NULL,
  avisado_em DATETIMEOFFSET(7) NULL,
  criado_em DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_lembretes_criado DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_lembretes PRIMARY KEY CLUSTERED (id)
);
CREATE NONCLUSTERED INDEX IX_lembretes_pessoa_quando ON gestor.lembretes (pessoa_id, quando);

CREATE TABLE gestor.mencoes (
  tarefa_id UNIQUEIDENTIFIER NOT NULL,
  pessoa_id INT NOT NULL,
  em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_mencoes_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_mencoes PRIMARY KEY CLUSTERED (tarefa_id, pessoa_id),
  CONSTRAINT FK_mencoes_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id) ON DELETE CASCADE
);
CREATE NONCLUSTERED INDEX IX_mencoes_pessoa ON gestor.mencoes (pessoa_id, em DESC);

CREATE TABLE gestor.mensagens (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_gestor_msg_id DEFAULT (newsequentialid()),
  de_pessoa_id INT NOT NULL,
  para_pessoa_id INT NOT NULL,
  corpo NVARCHAR(MAX) NULL,
  em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_gestor_msg_em DEFAULT (sysdatetimeoffset()),
  lida_em DATETIMEOFFSET(3) NULL,
  CONSTRAINT PK_gestor_mensagens PRIMARY KEY CLUSTERED (id),
  CONSTRAINT CK_gestor_msg_pessoas CHECK ([de_pessoa_id]<>[para_pessoa_id])
);
CREATE NONCLUSTERED INDEX IX_msg_conversa ON gestor.mensagens (de_pessoa_id, para_pessoa_id, em DESC);
CREATE NONCLUSTERED INDEX IX_msg_nao_lidas ON gestor.mensagens (para_pessoa_id, lida_em);

CREATE TABLE gestor.metas (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_metas_id DEFAULT (newsequentialid()),
  escopo NVARCHAR(8) NOT NULL,
  escopo_id NVARCHAR(40) NOT NULL,
  periodo NVARCHAR(10) NOT NULL,
  metrica NVARCHAR(10) NOT NULL,
  alvo INT NOT NULL,
  CONSTRAINT PK_gestor_metas PRIMARY KEY CLUSTERED (id),
  CONSTRAINT UQ_gestor_metas UNIQUE (escopo, escopo_id, periodo, metrica),
  CONSTRAINT CK_metas_escopo CHECK ([escopo]='setor' OR [escopo]='pessoa'),
  CONSTRAINT CK_metas_periodo CHECK ([periodo]='mensal' OR [periodo]='semanal' OR [periodo]='diaria'),
  CONSTRAINT CK_metas_metrica CHECK ([metrica]='pontos' OR [metrica]='tarefas'),
  CONSTRAINT CK_metas_alvo CHECK ([alvo]>(0))
);

CREATE TABLE gestor.modelos_de_pack (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_modelos_id DEFAULT (newsequentialid()),
  nome NVARCHAR(120) NOT NULL,
  descricao NVARCHAR(500) NULL,
  alvo_tipo NVARCHAR(8) NOT NULL,
  alvo_cargo NVARCHAR(120) NULL,
  alvo_pessoa_id INT NULL,
  criado_por INT NOT NULL,
  criado_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_modelos_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_modelos_de_pack PRIMARY KEY CLUSTERED (id),
  CONSTRAINT CK_modelos_alvo_coerente CHECK ([alvo_tipo]='cargo' AND [alvo_cargo] IS NOT NULL AND [alvo_pessoa_id] IS NULL OR [alvo_tipo]='pessoa' AND [alvo_pessoa_id] IS NOT NULL AND [alvo_cargo] IS NULL),
  CONSTRAINT CK_modelos_alvo_tipo CHECK ([alvo_tipo]='pessoa' OR [alvo_tipo]='cargo')
);

CREATE TABLE gestor.notificacoes (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_notif_id DEFAULT (newsequentialid()),
  destinatario_id INT NOT NULL,
  de_pessoa_id INT NULL,
  tipo NVARCHAR(16) NOT NULL,
  titulo NVARCHAR(160) NOT NULL,
  descricao NVARCHAR(400) NULL,
  tarefa_id UNIQUEIDENTIFIER NULL,
  sala NVARCHAR(80) NULL,
  titulo_da_sala NVARCHAR(120) NULL,
  lida BIT NOT NULL CONSTRAINT DF_notif_lida DEFAULT ((0)),
  em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_notif_em DEFAULT (sysdatetimeoffset()),
  projeto_id UNIQUEIDENTIFIER NULL,
  CONSTRAINT PK_gestor_notificacoes PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_notif_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id) ON DELETE CASCADE,
  CONSTRAINT CK_notif_tipo CHECK ([tipo]='lembrete' OR [tipo]='chamada_perdida' OR [tipo]='concluida' OR [tipo]='prazo' OR [tipo]='atribuida' OR [tipo]='mencao' OR [tipo]='projeto')
);
CREATE NONCLUSTERED INDEX IX_notif_nao_lidas ON gestor.notificacoes (destinatario_id, em DESC) WHERE ([lida]=(0));

CREATE TABLE gestor.perfis (
  pessoa_id INT NOT NULL,
  pontuacao INT NOT NULL CONSTRAINT DF_perfis_pontos DEFAULT ((0)),
  sequencia INT NOT NULL CONSTRAINT DF_perfis_seq DEFAULT ((0)),
  avatar NVARCHAR(200) NULL,
  contato_confirmado BIT NOT NULL CONSTRAINT DF_perfis_contato DEFAULT ((0)),
  criado_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_perfis_em DEFAULT (sysdatetimeoffset()),
  atualizado_em DATETIMEOFFSET(3) NULL,
  setor NVARCHAR(40) NULL,
  papel NVARCHAR(12) NULL,
  supervisor_nome NVARCHAR(120) NULL,
  nome NVARCHAR(120) NULL,
  email NVARCHAR(255) NULL,
  telefone VARCHAR(20) NULL,
  CONSTRAINT PK_gestor_perfis PRIMARY KEY CLUSTERED (pessoa_id),
  CONSTRAINT CK_gestor_perfis_papel CHECK ([papel] IS NULL OR ([papel]='adm' OR [papel]='supervisor' OR [papel]='gerente'))
);
CREATE NONCLUSTERED INDEX IX_perfis_setor ON gestor.perfis (setor) WHERE ([setor] IS NOT NULL);

CREATE TABLE gestor.preferencias (
  pessoa_id INT NOT NULL,
  chave NVARCHAR(60) NOT NULL,
  valor NVARCHAR(400) NOT NULL,
  atualizada_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_prefs_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_preferencias PRIMARY KEY CLUSTERED (pessoa_id, chave)
);

CREATE TABLE gestor.presenca (
  pessoa_id INT NOT NULL,
  visto_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_gestor_pres_em DEFAULT (sysdatetimeoffset()),
  digitando_para INT NULL,
  digitando_em DATETIMEOFFSET(7) NULL,
  estado NVARCHAR(12) NULL,
  CONSTRAINT PK_gestor_presenca PRIMARY KEY CLUSTERED (pessoa_id),
  CONSTRAINT CK_gestor_presenca_estado CHECK ([estado]='ausente' OR [estado]='ocupado' OR [estado]='disponivel')
);

CREATE TABLE gestor.projeto_membros (
  projeto_id UNIQUEIDENTIFIER NOT NULL,
  pessoa_id INT NOT NULL,
  entrou_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_proj_membros_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_gestor_projeto_membros PRIMARY KEY CLUSTERED (projeto_id, pessoa_id),
  CONSTRAINT FK_proj_membros_projeto FOREIGN KEY (projeto_id) REFERENCES gestor.projetos(id) ON DELETE CASCADE
);
CREATE NONCLUSTERED INDEX IX_proj_membros_pessoa ON gestor.projeto_membros (pessoa_id);

CREATE TABLE gestor.projetos (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_projetos_id DEFAULT (newsequentialid()),
  id_legado NVARCHAR(60) NULL,
  nome NVARCHAR(120) NOT NULL,
  descricao NVARCHAR(MAX) NULL,
  situacao NVARCHAR(10) NOT NULL CONSTRAINT DF_projetos_situacao DEFAULT ('ativo'),
  dono_id INT NOT NULL,
  setor NVARCHAR(40) NULL,
  prazo DATETIMEOFFSET(3) NULL,
  cor NVARCHAR(40) NULL,
  criado_por INT NOT NULL,
  criado_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_projetos_em DEFAULT (sysdatetimeoffset()),
  foto_anexo_id UNIQUEIDENTIFIER NULL,
  CONSTRAINT PK_gestor_projetos PRIMARY KEY CLUSTERED (id),
  CONSTRAINT CK_gestor_projetos_situacao CHECK ([situacao]='concluido' OR [situacao]='pausado' OR [situacao]='ativo')
);
CREATE NONCLUSTERED INDEX IX_projetos_dono ON gestor.projetos (dono_id) INCLUDE (nome, situacao);

CREATE TABLE gestor.reacoes_tarefa (
  tarefa_id UNIQUEIDENTIFIER NOT NULL,
  pessoa_id INT NOT NULL,
  emoji NVARCHAR(16) NOT NULL,
  em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_reacoes_tarefa_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK_reacoes_tarefa PRIMARY KEY CLUSTERED (tarefa_id, pessoa_id),
  CONSTRAINT FK_reacoes_tarefa_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id) ON DELETE CASCADE
);

CREATE TABLE gestor.registros_de_acesso (
  id BIGINT IDENTITY(1,1) NOT NULL,
  pessoa_id INT NULL,
  em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_acesso_em DEFAULT (sysdatetimeoffset()),
  ip NVARCHAR(45) NULL,
  dispositivo_id UNIQUEIDENTIFIER NULL,
  agente NVARCHAR(300) NULL,
  sucesso BIT NOT NULL,
  motivo NVARCHAR(60) NULL,
  CONSTRAINT PK_gestor_registros_de_acesso PRIMARY KEY CLUSTERED (id)
);
CREATE NONCLUSTERED INDEX IX_acesso_falhas ON gestor.registros_de_acesso (em DESC) INCLUDE (pessoa_id, ip) WHERE ([sucesso]=(0));
CREATE NONCLUSTERED INDEX IX_acesso_pessoa ON gestor.registros_de_acesso (pessoa_id, em DESC);

CREATE TABLE gestor.sala_participantes (
  sala NVARCHAR(80) NOT NULL,
  pessoa_id INT NOT NULL,
  entrou_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_sala_part_em DEFAULT (sysdatetimeoffset()),
  adicionado_por INT NULL,
  CONSTRAINT PK_gestor_sala_participantes PRIMARY KEY CLUSTERED (sala, pessoa_id),
  CONSTRAINT FK_sala_part_sala FOREIGN KEY (sala) REFERENCES gestor.salas(sala) ON DELETE CASCADE
);
CREATE NONCLUSTERED INDEX IX_sala_part_pessoa ON gestor.sala_participantes (pessoa_id);

CREATE TABLE gestor.sala_pedidos_de_entrada (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_pedidos_id DEFAULT (newsequentialid()),
  sala NVARCHAR(80) NOT NULL,
  pessoa_id INT NOT NULL,
  situacao NVARCHAR(10) NOT NULL CONSTRAINT DF_pedidos_sit DEFAULT ('esperando'),
  em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_pedidos_em DEFAULT (sysdatetimeoffset()),
  respondido_em DATETIMEOFFSET(3) NULL,
  pessoa_nome NVARCHAR(240) NOT NULL CONSTRAINT DF_gestor_ped_nome DEFAULT (''),
  respondido_por INT NULL,
  CONSTRAINT PK_gestor_sala_pedidos_de_entrada PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_pedidos_sala FOREIGN KEY (sala) REFERENCES gestor.salas(sala) ON DELETE CASCADE,
  CONSTRAINT CK_pedidos_situacao CHECK ([situacao]='recusado' OR [situacao]='aceito' OR [situacao]='esperando')
);
CREATE NONCLUSTERED INDEX IX_pedidos_esperando ON gestor.sala_pedidos_de_entrada (sala, em) WHERE ([situacao]='esperando');

CREATE TABLE gestor.salas (
  sala NVARCHAR(80) NOT NULL,
  privada BIT NOT NULL CONSTRAINT DF_salas_privada DEFAULT ((0)),
  atualizada_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_salas_em DEFAULT (sysdatetimeoffset()),
  locutores NVARCHAR(MAX) NOT NULL CONSTRAINT DF_gestor_salas_loc DEFAULT ('[]'),
  locutores_em DATETIMEOFFSET(3) NULL,
  atualizada_por INT NULL,
  CONSTRAINT PK_gestor_salas PRIMARY KEY CLUSTERED (sala)
);

CREATE TABLE gestor.sessoes_de_foco (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_foco_id DEFAULT (newsequentialid()),
  pessoa_id INT NOT NULL,
  tarefa_id UNIQUEIDENTIFIER NULL,
  minutos INT NOT NULL,
  encerrou_em DATETIMEOFFSET(3) NOT NULL,
  CONSTRAINT PK_gestor_sessoes_de_foco PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_foco_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id) ON DELETE SET NULL,
  CONSTRAINT CK_foco_minutos CHECK ([minutos]>(0))
);
CREATE NONCLUSTERED INDEX IX_foco_pessoa ON gestor.sessoes_de_foco (pessoa_id, encerrou_em DESC);

CREATE TABLE gestor.sessoes_de_tempo (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_sessoes_id DEFAULT (newsequentialid()),
  pessoa_id INT NOT NULL,
  tarefa_id UNIQUEIDENTIFIER NOT NULL,
  iniciou_em DATETIMEOFFSET(3) NOT NULL,
  encerrou_em DATETIMEOFFSET(3) NOT NULL,
  segundos INT NOT NULL,
  CONSTRAINT PK_gestor_sessoes_de_tempo PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_sessoes_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id) ON DELETE CASCADE,
  CONSTRAINT CK_sessoes_segundos CHECK ([segundos]>(0)),
  CONSTRAINT CK_sessoes_ordem CHECK ([encerrou_em]>=[iniciou_em])
);
CREATE NONCLUSTERED INDEX IX_sessoes_pessoa_periodo ON gestor.sessoes_de_tempo (pessoa_id, iniciou_em) INCLUDE (tarefa_id, segundos);

CREATE TABLE gestor.tarefa_etiquetas (
  tarefa_id UNIQUEIDENTIFIER NOT NULL,
  etiqueta_id UNIQUEIDENTIFIER NOT NULL,
  CONSTRAINT PK_gestor_tarefa_etiquetas PRIMARY KEY CLUSTERED (tarefa_id, etiqueta_id),
  CONSTRAINT FK_te_etiqueta FOREIGN KEY (etiqueta_id) REFERENCES gestor.etiquetas(id) ON DELETE CASCADE,
  CONSTRAINT FK_te_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id) ON DELETE CASCADE
);
CREATE NONCLUSTERED INDEX IX_te_etiqueta ON gestor.tarefa_etiquetas (etiqueta_id);

CREATE TABLE gestor.tarefas (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_gestor_id DEFAULT (newsequentialid()),
  id_legado NVARCHAR(60) NULL,
  titulo NVARCHAR(200) NOT NULL,
  descricao NVARCHAR(MAX) NULL,
  setor NVARCHAR(40) NOT NULL,
  criado_por INT NOT NULL,
  responsavel_id INT NOT NULL,
  projeto_id UNIQUEIDENTIFIER NULL,
  frequencia NVARCHAR(10) NOT NULL CONSTRAINT DF_gestor_freq DEFAULT ('diaria'),
  situacao NVARCHAR(12) NOT NULL CONSTRAINT DF_gestor_situacao DEFAULT ('pendente'),
  prioridade NVARCHAR(10) NOT NULL CONSTRAINT DF_gestor_prio DEFAULT ('media'),
  pontos INT NOT NULL CONSTRAINT DF_gestor_pontos DEFAULT ((0)),
  prazo DATETIMEOFFSET(3) NULL,
  recorrente BIT NOT NULL CONSTRAINT DF_gestor_rec DEFAULT ((0)),
  recorre_ate DATETIMEOFFSET(3) NULL,
  dia_do_mes SMALLINT NULL,
  minutos_estimados INT NULL,
  exige_comprovante BIT NOT NULL CONSTRAINT DF_gestor_comp DEFAULT ((0)),
  no_pack BIT NOT NULL CONSTRAINT DF_gestor_pack DEFAULT ((0)),
  ordem INT NOT NULL CONSTRAINT DF_gestor_ordem DEFAULT ((0)),
  criada_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_gestor_em DEFAULT (sysdatetimeoffset()),
  concluida_em DATETIMEOFFSET(3) NULL,
  arquivada_em DATETIMEOFFSET(3) NULL,
  data_real_de_conclusao DATE NULL,
  horario TIME(0) NULL,
  CONSTRAINT PK_gestor_tarefas PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_gestor_projeto FOREIGN KEY (projeto_id) REFERENCES gestor.projetos(id) ON DELETE SET NULL,
  CONSTRAINT CK_gestor_frequencia CHECK ([frequencia]='anual' OR [frequencia]='mensal' OR [frequencia]='quinzenal' OR [frequencia]='semanal' OR [frequencia]='diaria'),
  CONSTRAINT CK_gestor_dia_do_mes CHECK ([dia_do_mes] IS NULL OR ([dia_do_mes]=(-2) OR [dia_do_mes]=(-1)) OR [dia_do_mes]>=(1) AND [dia_do_mes]<=(31)),
  CONSTRAINT CK_gestor_situacao CHECK ([situacao]='concluida' OR [situacao]='andamento' OR [situacao]='pendente'),
  CONSTRAINT CK_gestor_prioridade CHECK ([prioridade]='baixa' OR [prioridade]='media' OR [prioridade]='alta')
);
CREATE NONCLUSTERED INDEX IX_gestor_projeto ON gestor.tarefas (projeto_id) WHERE ([projeto_id] IS NOT NULL);
CREATE NONCLUSTERED INDEX IX_gestor_responsavel_prazo ON gestor.tarefas (responsavel_id, prazo) INCLUDE (titulo, situacao, prioridade, minutos_estimados) WHERE ([situacao]<>'concluida');
CREATE NONCLUSTERED INDEX IX_gestor_setor ON gestor.tarefas (setor, prazo);
CREATE NONCLUSTERED INDEX IX_tarefas_ativas ON gestor.tarefas (responsavel_id, situacao, ordem) WHERE ([arquivada_em] IS NULL);

CREATE TABLE gestor.telegram_contas (
  pessoa_id INT NOT NULL,
  telegram_user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  vinculado_em DATETIMEOFFSET(7) NOT NULL CONSTRAINT DF_telegram_contas_em DEFAULT (sysdatetimeoffset()),
  CONSTRAINT PK__telegram__434CC5DB0968A801 PRIMARY KEY CLUSTERED (pessoa_id)
);
CREATE UNIQUE NONCLUSTERED INDEX UX_telegram_contas_user ON gestor.telegram_contas (telegram_user_id);

CREATE TABLE gestor.topicos_da_ata (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_topicos_id DEFAULT (newsequentialid()),
  ata_id UNIQUEIDENTIFIER NOT NULL,
  texto NVARCHAR(600) NOT NULL,
  tipo NVARCHAR(10) NOT NULL,
  tarefa_id UNIQUEIDENTIFIER NULL,
  ordem INT NOT NULL CONSTRAINT DF_topicos_ordem DEFAULT ((0)),
  CONSTRAINT PK_gestor_topicos_da_ata PRIMARY KEY CLUSTERED (id),
  CONSTRAINT FK_topicos_ata FOREIGN KEY (ata_id) REFERENCES gestor.atas(id) ON DELETE CASCADE,
  CONSTRAINT FK_topicos_tarefa FOREIGN KEY (tarefa_id) REFERENCES gestor.tarefas(id),
  CONSTRAINT CK_topicos_tipo CHECK ([tipo]='atencao' OR [tipo]='proximo' OR [tipo]='decisao')
);
CREATE NONCLUSTERED INDEX IX_topicos_ata ON gestor.topicos_da_ata (ata_id, ordem);

CREATE TABLE gestor.vinculos_telegram (
  pessoa_id INT NOT NULL,
  telegram_user_id BIGINT NOT NULL,
  telegram_chat_id BIGINT NOT NULL,
  telefone NVARCHAR(20) NOT NULL,
  vinculado_em DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_tg_em DEFAULT (sysdatetimeoffset()),
  ativo BIT NOT NULL CONSTRAINT DF_tg_ativo DEFAULT ((1)),
  CONSTRAINT PK_gestor_vinculos_telegram PRIMARY KEY CLUSTERED (pessoa_id),
  CONSTRAINT UQ_gestor_vinculos_telegram_conta UNIQUE (telegram_user_id)
);
CREATE NONCLUSTERED INDEX IX_tg_conta_ativa ON gestor.vinculos_telegram (telegram_user_id) INCLUDE (pessoa_id, telegram_chat_id) WHERE ([ativo]=(1));

