/*
 * De onde veio a tarefa: a API de integração (17/11/2026).
 *
 * Outro sistema da empresa cria tarefas no CONECTA pela API (`src/routes/api/public/v1/`). Estas duas
 * colunas, só na tabela de tarefas do CONECTA, dizem qual sistema criou a tarefa e qual é o código dela lá:
 *
 *   sistema_origem  o nome do sistema, o mesmo da variável API_INTEGRACAO_CHAVES ("gantt").
 *                   NULL = criada na tela do CONECTA (todas as que já existem).
 *   id_externo      o código da tarefa no sistema de origem (o `idExterno` da API).
 *                   NULL = o sistema não mandou código.
 *
 *   UX_tarefas_origem_externo  o mesmo código, do mesmo sistema, não vira duas tarefas: quem garante é o
 *                              banco, e não só o servidor.
 *   IX_tarefas_sistema_origem  a listagem de cada sistema (GET /tarefas), das mais novas para as mais antigas.
 *
 * Só ACRESCENTA. As tarefas existentes ficam com as duas colunas vazias, e nada nelas muda; coluna nova vazia
 * não reescreve a tabela. Os dois índices são filtrados: só guardam as tarefas da integração.
 *
 * O último passo leva a tarefa de teste de 17/11 (arquivada) da marca provisória em `id_legado`
 * ("api:teste:TESTE-API-1") para as colunas novas, e o `id_legado` volta a ficar livre em todas as tarefas.
 *
 * Pode rodar mais de uma vez: cada passo confere se já foi feito.
 *
 * Para desfazer:
 *   DROP INDEX UX_tarefas_origem_externo ON gestor.tarefas;
 *   DROP INDEX IX_tarefas_sistema_origem ON gestor.tarefas;
 *   ALTER TABLE gestor.tarefas DROP COLUMN sistema_origem, id_externo;
 */

IF COL_LENGTH('gestor.tarefas', 'sistema_origem') IS NULL
  ALTER TABLE gestor.tarefas ADD sistema_origem NVARCHAR(16) NULL;

IF COL_LENGTH('gestor.tarefas', 'id_externo') IS NULL
  ALTER TABLE gestor.tarefas ADD id_externo NVARCHAR(36) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = 'UX_tarefas_origem_externo' AND object_id = OBJECT_ID('gestor.tarefas'))
  CREATE UNIQUE NONCLUSTERED INDEX UX_tarefas_origem_externo
    ON gestor.tarefas (sistema_origem, id_externo)
    WHERE id_externo IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = 'IX_tarefas_sistema_origem' AND object_id = OBJECT_ID('gestor.tarefas'))
  CREATE NONCLUSTERED INDEX IX_tarefas_sistema_origem
    ON gestor.tarefas (sistema_origem, criada_em DESC)
    WHERE sistema_origem IS NOT NULL;
GO

/* A marca provisória da tarefa de teste ("api:<sistema>:<código>") vai para as colunas novas. */
UPDATE gestor.tarefas
   SET sistema_origem = SUBSTRING(id_legado, 5, CHARINDEX(N':', id_legado, 5) - 5),
       id_externo = NULLIF(SUBSTRING(id_legado, CHARINDEX(N':', id_legado, 5) + 1, 60), N''),
       id_legado = NULL
 WHERE id_legado LIKE N'api:%:%';
GO
