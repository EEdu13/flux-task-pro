/*
 * Gantt: o início da tarefa e as dependências entre tarefas (17/11/2026).
 *
 * O Gantt de Projetos desenha cada tarefa como uma barra do início ao prazo, e liga com uma seta a tarefa que
 * só pode começar quando outra terminar. Hoje a tarefa só tem o prazo (o fim); sem início, a barra começa em
 * `criada_em`. As duas mudanças, só no schema `gestor`:
 *
 *   gestor.tarefas.inicio         o dia em que a tarefa começa. NULL = não definido (a barra começa em
 *                                 `criada_em`, como hoje). Mesmo tipo do `prazo`.
 *
 *   gestor.tarefa_dependencias    "tarefa_id só começa quando depende_de_id terminar".
 *     tarefa_id                   a tarefa que ESPERA.
 *     depende_de_id               a tarefa que precisa terminar antes.
 *     tipo                        FS = fim → início, o único que a tela cria. O CHECK já aceita os outros três
 *                                 (SS, FF, SF) para não exigir outra migração se um dia entrarem.
 *     criado_por, criado_em       quem ligou e quando (o id da pessoa é o da IAM, sem FK, como em tarefas).
 *
 *     PK_tarefa_dependencias      a mesma ligação não entra duas vezes.
 *     FK_tarefa_dep_tarefa        apaga a ligação junto com a tarefa que espera (ON DELETE CASCADE).
 *     FK_tarefa_dep_depende       SEM cascata: o SQL Server não aceita dois caminhos de cascata vindos da mesma
 *                                 tabela (erro 1785). Na prática não faz diferença: o CONECTA nunca apaga
 *                                 tarefa, só arquiva (`arquivada_em`), e a leitura do Gantt ignora ligação com
 *                                 tarefa arquivada.
 *     CK_tarefa_dep_si_mesma      a tarefa não depende de si mesma. O ciclo maior (A → B → A) quem barra é o
 *                                 servidor, antes de gravar.
 *     IX_tarefa_dep_depende_de    achar as tarefas que esperam por uma (a PK já cobre o outro lado).
 *
 * Só ACRESCENTA. A coluna nova nasce vazia em todas as tarefas, e nada nelas muda; coluna nova vazia não
 * reescreve a tabela. A tabela nova nasce vazia.
 *
 * ORDEM: este script roda ANTES de subir o código que lê `inicio`. Sem a coluna, a lista de tarefas do
 * CONECTA (que já passa a pedi-la) falharia para todo mundo.
 *
 * Pode rodar mais de uma vez: cada passo confere se já foi feito.
 *
 * Para desfazer:
 *   DROP TABLE gestor.tarefa_dependencias;
 *   ALTER TABLE gestor.tarefas DROP COLUMN inicio;
 */

IF COL_LENGTH('gestor.tarefas', 'inicio') IS NULL
  ALTER TABLE gestor.tarefas ADD inicio DATETIMEOFFSET(3) NULL;
GO

IF OBJECT_ID(N'gestor.tarefa_dependencias', N'U') IS NULL
  CREATE TABLE gestor.tarefa_dependencias (
    tarefa_id     UNIQUEIDENTIFIER  NOT NULL,
    depende_de_id UNIQUEIDENTIFIER  NOT NULL,
    tipo          NVARCHAR(4)       NOT NULL CONSTRAINT DF_tarefa_dep_tipo DEFAULT N'FS',
    criado_por    INT               NOT NULL,
    criado_em     DATETIMEOFFSET(3) NOT NULL CONSTRAINT DF_tarefa_dep_criado_em DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT PK_tarefa_dependencias PRIMARY KEY (tarefa_id, depende_de_id),
    CONSTRAINT FK_tarefa_dep_tarefa FOREIGN KEY (tarefa_id)
      REFERENCES gestor.tarefas(id) ON DELETE CASCADE,
    CONSTRAINT FK_tarefa_dep_depende FOREIGN KEY (depende_de_id)
      REFERENCES gestor.tarefas(id),
    CONSTRAINT CK_tarefa_dep_tipo CHECK (tipo IN (N'FS', N'SS', N'FF', N'SF')),
    CONSTRAINT CK_tarefa_dep_si_mesma CHECK (tarefa_id <> depende_de_id)
  );
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = 'IX_tarefa_dep_depende_de'
                  AND object_id = OBJECT_ID(N'gestor.tarefa_dependencias'))
  CREATE NONCLUSTERED INDEX IX_tarefa_dep_depende_de
    ON gestor.tarefa_dependencias (depende_de_id);
GO
