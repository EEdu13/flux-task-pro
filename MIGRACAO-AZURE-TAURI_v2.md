# Plano de Migração — Fluxo Task Pro
## Azure SQL + Tauri Desktop App

> Documento-guia para o Claude Code executar a migração completa do projeto do Lovable Cloud (Supabase) para Azure SQL, e o empacotamento do app web em um cliente desktop nativo com Tauri.

---

## 1. Contexto do projeto
> **v2 — atualização de escopo.** Desde a v1 o produto ganhou: módulo **Projetos** (com membros e subtarefas), **Pack Templates** (por cargo ou pessoa), **Focus Log** (Pomodoro), inbox de tarefas via **WhatsApp** (`/api/public/whatsapp-webhook`), e o status `revisao` foi removido. As tabelas 3.24–3.29 e a coluna `tasks.project_id` cobrem esses casos.


**Fluxo Task Pro** é um gestor de tarefas + comunicação interna para uma empresa que tem Azure como padrão de infraestrutura. Hoje roda:

- **Frontend**: React 19 + TanStack Start v1 (SSR/SSG) + Vite 7 + Tailwind v4 + shadcn/ui
- **Backend atual**: Supabase (Postgres + Auth + Realtime + Storage) via Lovable Cloud
- **Chamadas de vídeo/áudio**: LiveKit (mantém — não migra)
- **IA**: Lovable AI Gateway (para atas de reunião, resumos, transcrição)
- **Estado local**: `localStorage` para tarefas, packs, "Minha Visão", timer, etc. (o motivo principal da migração — não sincroniza entre PCs)

### Funcionalidades-chave (o que precisa continuar funcionando após migração)

| Área | Descrição resumida |
|------|---------------------|
| Tarefas | CRUD, kanban, atribuição, comentários, checklist, anexos, prioridade, tags, recorrência, frequência (diária/semanal/mensal), estimativa de tempo, "comprovante obrigatório" |
| Pack diário | Lista de tarefas "não-negociáveis" do dia, criada pelo próprio usuário ou por supervisor/PCP para outra pessoa |
| Timer Pomodoro | Play/Pause/Stop por tarefa, com logs de sessão (início/fim/duração) para relatórios |
| Minha Visão | Planilha privada por usuário: colunas customizadas (texto, número, select, data, hora, data+hora), cor da linha, notas, ordem drag-and-drop |
| Metas & Score | Metas por usuário/setor, período (diário/semanal/mensal), pontos por tarefa concluída |
| Salas de reunião | LiveKit; salas públicas, privadas com knock (pedido de entrada em tempo real), salas restritas (Diretoria = sempre privada) |
| Atas | Geradas por IA a partir da transcrição da chamada, com tópicos convertíveis em tarefas |
| Contatos & Hierarquia | Lista de contatos, árvore hierárquica animada até a diretoria, botão "chamar" (WhatsApp / gestor / e-mail) |
| Equipe | Visão do gestor: filtros de data (hoje, amanhã, semana, mês, entre datas) + drawer com tarefas por pessoa |
| Notificações | Menções, atribuições, prazos, chamadas perdidas, aprovação de entrada em sala |
| Relatórios | Score, tempo trabalhado, top tarefas por tempo, estimado vs realizado, export CSV |

### Permissões
- Todos podem **criar** tarefas para todos.
- Só o **criador** ou um **gerente** pode **excluir**.
- Todos podem **concluir** tarefas atribuídas a eles.
- Apenas quem está **dentro** de uma sala pode **aprovar knocks**.
- Sala "Diretoria" é sempre privada; só entra quem já é membro ou foi aprovado.

---

## 2. Arquitetura-alvo (Azure)

```text
┌────────────────────────────┐
│  Tauri Desktop (Windows)   │  ← app nativo, ícone na bandeja, autostart
│  ────────────────────────  │
│  React SPA (Vite build)    │
└──────────────┬─────────────┘
               │ HTTPS/WSS
               ▼
┌────────────────────────────┐        ┌──────────────────────┐
│  Azure App Service (API)   │◄──────►│  Azure AD / Entra ID │
│  .NET 8 Minimal API ou     │  auth  │  (SSO corporativo)   │
│  Node/Express — a escolher │        └──────────────────────┘
└──┬────────────┬─────────┬──┘
   │            │         │
   │            │         └────────► LiveKit Cloud (chamadas, mantém)
   │            │
   │            └──► Azure SignalR Service (realtime: knocks, tasks, presença)
   │
   ▼
┌────────────────────────────┐        ┌──────────────────────┐
│  Azure SQL Database        │        │  Azure Blob Storage  │
│  (dados relacionais)       │        │  (anexos, comprov.)  │
└────────────────────────────┘        └──────────────────────┘
```

### Serviços Azure necessários
1. **Azure SQL Database** — banco principal (S1 ou GP_S_Gen5_2 serverless para começar)
2. **Azure App Service** (Linux, plano B1+) — hospeda a API REST
3. **Azure AD / Entra ID** — autenticação corporativa (OAuth2 / OIDC)
4. **Azure SignalR Service** (Standard) — realtime (substitui Supabase Realtime)
5. **Azure Blob Storage** — anexos de tarefas e comentários (substitui Supabase Storage)
6. **Azure Key Vault** — segredos (connection string SQL, LiveKit keys, Lovable API key)
7. **Application Insights** — logs e telemetria

### Camadas da API (sugestão .NET 8 Minimal API)
```
/api
  /auth        → login, refresh, /me
  /users       → CRUD usuários, hierarquia
  /tasks       → CRUD tarefas, filtros, comentários, checklist
  /pack        → pack diário (get/set)
  /timer       → sessões de tempo (start/stop/list)
  /myview      → colunas e valores da "Minha Visão"
  /meta        → metas e score
  /rooms       → salas, membros, knocks, state
  /minutes     → atas de reunião
  /notifications
  /attachments → upload/download via SAS token do Blob
  /livekit     → gera JWT de acesso à sala
  /hubs/realtime → SignalR (WebSocket)
```

---

## 3. Modelagem do banco (Azure SQL)

Todas as tabelas usam `UNIQUEIDENTIFIER` como PK com `NEWSEQUENTIALID()` default (melhor para índices clusterizados no SQL Server). Timestamps em `DATETIME2(3)` UTC. Enums viram `NVARCHAR` com `CHECK` constraint.

### 3.1 `users`
Representa cada colaborador. Espelha o `User` do TypeScript.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | UNIQUEIDENTIFIER PK | ID interno |
| azure_ad_oid | NVARCHAR(64) UNIQUE | Object ID do Entra ID (chave de login SSO) |
| name | NVARCHAR(120) NOT NULL | Nome exibido |
| email | NVARCHAR(200) UNIQUE NOT NULL | E-mail corporativo |
| phone | NVARCHAR(30) NULL | Para link do WhatsApp |
| role | NVARCHAR(20) NOT NULL CHECK (role IN ('gerente','supervisor','adm')) | Papel |
| job_title | NVARCHAR(120) | Cargo |
| sector_id | UNIQUEIDENTIFIER FK → sectors.id | Setor |
| supervisor_id | UNIQUEIDENTIFIER FK → users.id NULL | Chefe imediato (base da hierarquia de Contatos) |
| avatar_url | NVARCHAR(500) NULL | URL no Blob |
| score | INT NOT NULL DEFAULT 0 | Pontos acumulados |
| streak | INT NOT NULL DEFAULT 0 | Dias consecutivos batendo pack |
| contact_completed | BIT NOT NULL DEFAULT 0 | Se completou perfil |
| created_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() | |
| deleted_at | DATETIME2(3) NULL | Soft delete |

Índices: `IX_users_email`, `IX_users_supervisor` (para queries de hierarquia), `IX_users_sector`.

### 3.2 `sectors`
Setores da empresa (hoje hardcoded em `fluxo-types.ts`).

| Coluna | Tipo |
|--------|------|
| id | UNIQUEIDENTIFIER PK |
| slug | NVARCHAR(40) UNIQUE (`comercial`, `operacoes`, `marketing`, `financeiro`, `rh`) |
| name | NVARCHAR(80) |
| color | NVARCHAR(40) (oklch) |
| order_idx | INT |

### 3.3 `tasks`
Núcleo do sistema.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | UNIQUEIDENTIFIER PK | |
| title | NVARCHAR(300) NOT NULL | |
| description | NVARCHAR(MAX) NULL | Suporta markdown |
| sector_id | UNIQUEIDENTIFIER FK → sectors.id | |
| created_by | UNIQUEIDENTIFIER FK → users.id NOT NULL | Autor (única pessoa, além de gerente, que pode excluir) |
| assignee_id | UNIQUEIDENTIFIER FK → users.id NOT NULL | Responsável |
| frequency | NVARCHAR(20) CHECK IN ('diaria','semanal','mensal') | |
| status | NVARCHAR(20) CHECK IN ('pendente','andamento','concluida') | (o status `revisao` foi removido do produto) |
| priority | NVARCHAR(10) CHECK IN ('alta','media','baixa') | |
| score | INT NOT NULL DEFAULT 10 | Pontos ao concluir |
| due_date | DATETIME2(3) NOT NULL | Prazo |
| recurring | BIT NOT NULL DEFAULT 0 | Se recria automaticamente |
| recurring_until | DATETIME2(3) NULL | Até quando |
| order_idx | INT NOT NULL DEFAULT 0 | Ordem no kanban |
| in_pack | BIT NOT NULL DEFAULT 0 | Marca "meu pack" do assignee |
| require_proof | BIT NOT NULL DEFAULT 0 | Exige anexo antes de concluir |
| estimated_minutes | INT NULL | Estimativa em minutos |
| project_id | UNIQUEIDENTIFIER FK → projects.id NULL | Se preenchido, a tarefa é subtarefa de um projeto |
| created_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() | |
| completed_at | DATETIME2(3) NULL | Quando virou 'concluida' |
| deleted_at | DATETIME2(3) NULL | Soft delete |

Índices: `IX_tasks_assignee_status`, `IX_tasks_due_date`, `IX_tasks_created_by`, `IX_tasks_sector_status`, filtro `WHERE deleted_at IS NULL` em todos.

### 3.4 `task_tags`
Relacionamento N:N — cada tarefa pode ter várias tags livres.

| task_id | UNIQUEIDENTIFIER FK CASCADE |
| tag | NVARCHAR(60) |
| PK (task_id, tag) |

### 3.5 `task_mentions`
Menções `@fulano` dentro do texto.

| task_id | UNIQUEIDENTIFIER FK CASCADE |
| user_id | UNIQUEIDENTIFIER FK |
| PK (task_id, user_id) |

### 3.6 `task_checklist_items`
Sub-itens da tarefa.

| id | UNIQUEIDENTIFIER PK |
| task_id | FK CASCADE |
| text | NVARCHAR(500) |
| done | BIT DEFAULT 0 |
| order_idx | INT |

### 3.7 `task_comments`
Discussão dentro da tarefa.

| id | UNIQUEIDENTIFIER PK |
| task_id | FK CASCADE |
| user_id | FK → users |
| text | NVARCHAR(MAX) |
| created_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() |
| edited_at | DATETIME2(3) NULL |

### 3.8 `task_activity`
Histórico de auditoria (imutável).

| id | UNIQUEIDENTIFIER PK |
| task_id | FK CASCADE |
| user_id | FK |
| kind | NVARCHAR(20) CHECK IN ('criada','status','atribuicao','comentario','checklist','editada','concluida','mencao') |
| text | NVARCHAR(500) |
| at | DATETIME2(3) DEFAULT SYSUTCDATETIME() |

### 3.9 `attachments`
Anexos de tarefas ou comentários. Ficheiro no Blob, metadados no SQL.

| id | UNIQUEIDENTIFIER PK |
| task_id | FK NULL |
| comment_id | FK NULL |
| user_id | FK NOT NULL |
| name | NVARCHAR(300) |
| size | BIGINT |
| mime_type | NVARCHAR(120) |
| blob_url | NVARCHAR(1000) — path no container, não URL pública |
| uploaded_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() |

Download sempre via **SAS token** temporário emitido pela API — nunca URL pública.

### 3.10 `time_logs`
Sessões do timer Pomodoro. **Cada play→stop gera uma linha.**

| id | UNIQUEIDENTIFIER PK |
| task_id | FK |
| user_id | FK — quem cronometrou |
| started_at | DATETIME2(3) NOT NULL |
| ended_at | DATETIME2(3) NULL (NULL = sessão em curso) |
| duration_seconds | AS (DATEDIFF(SECOND, started_at, ended_at)) PERSISTED |
| note | NVARCHAR(300) NULL |

Índices: `IX_time_logs_user_started`, `IX_time_logs_task`.
Regra: só uma sessão com `ended_at IS NULL` por usuário por vez (constraint via trigger ou index filtrado único).

### 3.11 `pack_items` (opcional — hoje é derivado de `tasks.in_pack`)
Se o time preferir manter pack como flag na tarefa, essa tabela **não** é necessária. Mantenha `tasks.in_pack` como fonte da verdade.

### 3.12 `my_view_columns`
Colunas customizadas da "Minha Visão" (por usuário).

| id | UNIQUEIDENTIFIER PK |
| user_id | FK |
| name | NVARCHAR(80) |
| type | NVARCHAR(20) CHECK IN ('text','number','select','date','time','datetime') |
| options_json | NVARCHAR(MAX) NULL — JSON para tipo 'select' |
| order_idx | INT |

### 3.13 `my_view_rows`
Estado por linha (por par usuário × tarefa) — cor, ordem, notas.

| id | UNIQUEIDENTIFIER PK |
| user_id | FK |
| task_id | FK |
| color | NVARCHAR(20) NULL |
| note | NVARCHAR(MAX) NULL |
| order_idx | INT |
| UNIQUE (user_id, task_id) |

### 3.14 `my_view_values`
Valores das colunas customizadas.

| user_id | FK |
| task_id | FK |
| column_id | FK → my_view_columns.id CASCADE |
| value | NVARCHAR(MAX) |
| PK (user_id, task_id, column_id) |

### 3.15 `goals` (metas)
| id | UNIQUEIDENTIFIER PK |
| scope | NVARCHAR(10) CHECK IN ('user','sector') |
| scope_id | UNIQUEIDENTIFIER (user_id ou sector_id) |
| period | NVARCHAR(10) CHECK IN ('diaria','semanal','mensal') |
| metric | NVARCHAR(10) CHECK IN ('tarefas','pontos') |
| target | INT |
| created_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() |

### 3.16 `completions`
Log de tarefas concluídas — base para cálculos de score histórico.

| id | UNIQUEIDENTIFIER PK |
| task_id | FK |
| user_id | FK |
| points | INT |
| priority | NVARCHAR(10) |
| on_time | BIT |
| at | DATETIME2(3) DEFAULT SYSUTCDATETIME() |

### 3.17 `rooms`
Metadados persistentes de salas LiveKit.

| id | UNIQUEIDENTIFIER PK |
| name | NVARCHAR(120) UNIQUE — nome técnico usado no LiveKit |
| label | NVARCHAR(200) — nome exibido ("Diretoria · Sala 1") |
| is_private | BIT DEFAULT 0 |
| is_restricted | BIT DEFAULT 0 — Diretoria = TRUE (sempre privada) |
| department | NVARCHAR(80) NULL |
| created_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() |

### 3.18 `room_members`
Quem já está autorizado a entrar direto.

| room_id | FK CASCADE |
| user_id | FK |
| added_by | FK → users NULL |
| added_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() |
| PK (room_id, user_id) |

### 3.19 `room_knocks`
Pedidos de entrada em salas privadas — precisa **realtime** (SignalR).

| id | UNIQUEIDENTIFIER PK |
| room_id | FK |
| requester_id | FK → users |
| status | NVARCHAR(20) CHECK IN ('pending','approved','denied','cancelled') DEFAULT 'pending' |
| handled_by | FK → users NULL |
| created_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() |
| handled_at | DATETIME2(3) NULL |

### 3.20 `room_call_events`
Convites/chamadas 1-a-1 (badge "chamando", notificação de chamada perdida).

| id | UNIQUEIDENTIFIER PK |
| room_id | FK |
| caller_id | FK → users |
| target_id | FK → users |
| status | NVARCHAR(20) CHECK IN ('ringing','accepted','declined','missed','cancelled') DEFAULT 'ringing' |
| created_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() |
| handled_at | DATETIME2(3) NULL |

### 3.21 `meeting_minutes`
Atas geradas por IA.

| id | UNIQUEIDENTIFIER PK |
| room_id | FK NULL |
| room_name | NVARCHAR(120) |
| room_label | NVARCHAR(200) |
| created_by | FK → users |
| created_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() |
| participants_json | NVARCHAR(MAX) — array de {userId, name} |
| markdown | NVARCHAR(MAX) |

### 3.22 `meeting_minute_topics`
Tópicos extraídos que podem virar tarefas.

| id | UNIQUEIDENTIFIER PK |
| minute_id | FK CASCADE |
| text | NVARCHAR(1000) |
| kind | NVARCHAR(20) CHECK IN ('decisao','proximo','atencao') |
| task_id | FK NULL — se virou tarefa |

### 3.23 `notifications`
| id | UNIQUEIDENTIFIER PK |
| user_id | FK — destinatário |
| type | NVARCHAR(30) CHECK IN ('mencao','atribuida','prazo','concluida','chamada_perdida','knock') |
| title | NVARCHAR(200) |
| description | NVARCHAR(500) |
| task_id | FK NULL |
| room_id | FK NULL |
| from_user_id | FK NULL |
| read_at | DATETIME2(3) NULL |
| created_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() |

Índice: `IX_notifications_user_unread (user_id) WHERE read_at IS NULL`.

---

### 3.24 `projects`
Projetos que agrupam subtarefas (módulo Projetos estilo Asana).

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | UNIQUEIDENTIFIER PK | |
| name | NVARCHAR(200) NOT NULL | |
| description | NVARCHAR(MAX) NULL | |
| status | NVARCHAR(20) CHECK IN ('ativo','pausado','concluido') DEFAULT 'ativo' | |
| owner_id | UNIQUEIDENTIFIER FK → users.id NOT NULL | Responsável / criador do projeto |
| sector_id | UNIQUEIDENTIFIER FK → sectors.id NULL | Setor opcional (colaboração é global, não limita membros) |
| due_date | DATETIME2(3) NULL | Prazo geral do projeto |
| color | NVARCHAR(40) NULL | Cor de destaque (oklch) |
| created_by | UNIQUEIDENTIFIER FK → users.id NOT NULL | |
| created_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() | |
| deleted_at | DATETIME2(3) NULL | Soft delete |

Índices: `IX_projects_owner`, `IX_projects_status`.
Subtarefas ficam em `tasks` com `project_id` preenchido — cada subtarefa continua sendo uma tarefa "de verdade" do dia-a-dia do assignee.

### 3.25 `project_members`
Colaboradores do projeto (compartilhamento por projeto inteiro, não só por tarefa).

| project_id | UNIQUEIDENTIFIER FK CASCADE |
| user_id | UNIQUEIDENTIFIER FK → users.id |
| role | NVARCHAR(20) CHECK IN ('owner','editor','viewer') DEFAULT 'editor' |
| added_by | UNIQUEIDENTIFIER FK → users.id NULL |
| added_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() |
| PK (project_id, user_id) |

### 3.26 `pack_templates`
Modelos de "Meu pack" que gerentes/supervisores publicam. Pode ser por **cargo** (todo mundo com aquele job_title) ou por **pessoa** específica.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | UNIQUEIDENTIFIER PK | |
| name | NVARCHAR(200) NOT NULL | Ex.: "Supervisor de Operações" |
| description | NVARCHAR(MAX) NULL | |
| scope | NVARCHAR(10) CHECK IN ('cargo','pessoa') NOT NULL | |
| target_job_title | NVARCHAR(120) NULL | Preenchido quando `scope = 'cargo'` |
| target_user_id | UNIQUEIDENTIFIER FK → users.id NULL | Preenchido quando `scope = 'pessoa'` |
| created_by | UNIQUEIDENTIFIER FK → users.id NOT NULL | |
| created_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() | |

Constraint: `CHECK ((scope='cargo' AND target_job_title IS NOT NULL) OR (scope='pessoa' AND target_user_id IS NOT NULL))`.

### 3.27 `pack_template_items`
Itens dentro de um template de pack.

| id | UNIQUEIDENTIFIER PK |
| template_id | UNIQUEIDENTIFIER FK CASCADE |
| title | NVARCHAR(300) NOT NULL |
| estimated_minutes | INT NULL |
| order_idx | INT NOT NULL DEFAULT 0 |

### 3.28 `focus_log`
Registro de sessões de foco (Pomodoro) — usado no contador "Foco hoje".

| id | UNIQUEIDENTIFIER PK |
| user_id | UNIQUEIDENTIFIER FK → users.id |
| task_id | UNIQUEIDENTIFIER FK → tasks.id NULL |
| date | DATE NOT NULL |
| minutes | INT NOT NULL |
| created_at | DATETIME2(3) DEFAULT SYSUTCDATETIME() |

Índice: `IX_focus_log_user_date (user_id, date)`.
Observação: pode ser derivado agregando `time_logs`, mas manter tabela separada barateia o widget diário.

### 3.29 `whatsapp_task_inbox`
Tarefas criadas via bot do WhatsApp (webhook `/api/public/whatsapp-webhook`). Hoje no Supabase é a tabela `tarefas` — na migração vira uma view/tabela de entrada que depois **promove** para `tasks` quando um humano confirma o assignee.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | UNIQUEIDENTIFIER PK | |
| titulo | NVARCHAR(300) NOT NULL | Texto cru vindo do WhatsApp |
| description | NVARCHAR(MAX) NULL | |
| telefone | NVARCHAR(30) NULL | Número que enviou |
| creator_user_id | UNIQUEIDENTIFIER FK → users.id NULL | Match por telefone quando possível |
| assignee_user_id | UNIQUEIDENTIFIER FK → users.id NULL | Ainda sem dono até alguém aceitar |
| priority | NVARCHAR(10) CHECK IN ('alta','media','baixa') DEFAULT 'media' | |
| status | NVARCHAR(20) CHECK IN ('pendente','andamento','concluida') DEFAULT 'pendente' | |
| due_date | DATETIME2(3) NULL | |
| recurring | BIT NOT NULL DEFAULT 0 | |
| recurring_until | DATETIME2(3) NULL | |
| require_proof | BIT NOT NULL DEFAULT 0 | |
| promoted_task_id | UNIQUEIDENTIFIER FK → tasks.id NULL | Preenchido quando vira tarefa oficial |
| criado_em | DATETIME2(3) DEFAULT SYSUTCDATETIME() | |

Índice: `IX_wa_inbox_creator`, `IX_wa_inbox_status`.

---

## 4. Relacionamentos (visão geral)

```text
sectors ────< users >──── users (supervisor_id, self-FK)
                │
                ├──< tasks (created_by, assignee_id)
                │       ├── project_id → projects
                │       ├──< task_tags
                │       ├──< task_mentions >── users
                │       ├──< task_checklist_items
                │       ├──< task_comments >── users
                │       │        └──< attachments
                │       ├──< task_activity
                │       ├──< attachments
                │       ├──< time_logs >── users
                │       ├──< completions
                │       ├──< my_view_rows (user × task)
                │       └──< my_view_values (user × task × column)
                │
                ├──< my_view_columns
                ├──< goals (scope='user')
                ├──< notifications
                ├──< focus_log
                ├──< projects (owner_id)
                │       ├──< project_members >── users
                │       └──< tasks (project_id, subtarefas)
                ├──< pack_templates (created_by, target_user_id)
                │       └──< pack_template_items
                ├──< whatsapp_task_inbox (creator/assignee)
                │       └── promoted_task_id → tasks
                └──< room_members >── rooms
                                        ├──< room_knocks
                                        ├──< room_call_events
                                        └──< meeting_minutes
                                                 └──< meeting_minute_topics
```

---

## 5. Autenticação (Entra ID)

1. Registrar um **App Registration** no Azure AD do tenant da empresa.
2. Configurar redirect URI: `http://localhost:1420/auth/callback` (Tauri) + `https://<app>.azurewebsites.net/auth/callback` (web).
3. Fluxo **Authorization Code + PKCE** — biblioteca MSAL (JS no front, `Microsoft.Identity.Web` no backend .NET).
4. API valida o Bearer token JWT em toda requisição; extrai `oid` (Object ID) → mapeia para `users.azure_ad_oid`.
5. **Provisioning**: no primeiro login, se `azure_ad_oid` não existir em `users`, criar registro com `role = 'adm'` por padrão (gerente promove depois).

---

## 6. Realtime (Azure SignalR)

Substitui os canais Supabase Realtime. Um único hub `/hubs/realtime` com grupos:

- `user:{userId}` — notificações pessoais, chamadas entrantes
- `room:{roomId}` — knocks pendentes, mudança de estado da sala
- `task:{taskId}` — atualizações de tarefas abertas (opcional; pode ser polling)
- `sector:{sectorId}` — feed de atividade do setor

A API publica eventos no hub após cada mutação. O cliente Tauri/web conecta com o mesmo Bearer token do Entra ID.

---

## 7. Storage (Blob)

- Container único `attachments` com blobs `{taskId}/{attachmentId}-{safeName}`.
- Upload: cliente pede à API um **SAS token de escrita** (válido 15 min) → sobe direto pro Blob (não passa pela API — economia de banda).
- Download: cliente pede à API um **SAS token de leitura** (válido 60 min) → baixa direto.
- API só armazena `blob_url` (path relativo), nunca URL absoluta.

---

## 8. Migração — passo a passo para o Claude Code

### Fase 0 — Preparação
1. Criar branch `migracao-azure` a partir de `main`.
2. Criar pasta `backend/` na raiz para a API .NET (ou `api/` para Node).
3. Criar `src/lib/api/` no front — camada única para chamadas HTTP.

### Fase 1 — Provisionar Azure
1. Criar Resource Group `rg-fluxo-taskpro-prod`.
2. Deploy dos serviços (via Bicep/Terraform, script pronto em `infra/`):
   - Azure SQL Server + Database
   - App Service Plan + App Service
   - SignalR Service (modo Default)
   - Storage Account + container `attachments`
   - Key Vault
   - Application Insights
3. Registrar App no Entra ID e salvar `TenantId`/`ClientId` no Key Vault.

### Fase 2 — Backend API
1. Scaffold `dotnet new webapi -minimal` (ou `express-generator`).
2. Instalar: `Microsoft.Data.SqlClient`, `Dapper` (ou `EF Core`), `Microsoft.AspNetCore.SignalR`, `Microsoft.Identity.Web`, `Azure.Storage.Blobs`, `Azure.Identity`.
3. Rodar migrations SQL (script único gerado a partir da seção 3 deste doc).
4. Implementar endpoints seguindo a divisão da seção 2 ("Camadas da API").
5. Escrever middleware de autorização:
   - `[Authorize]` global.
   - Policy `CanDeleteTask` → checa `created_by == currentUser.id || currentUser.role == 'gerente'`.
   - Policy `RoomMember` → checa `EXISTS (SELECT 1 FROM room_members WHERE …)`.

### Fase 3 — Camada de dados no front
1. Criar `src/lib/api/client.ts` — wrapper `fetch` com Bearer token do MSAL.
2. Criar um arquivo por recurso: `tasks.api.ts`, `pack.api.ts`, `timer.api.ts`, `myview.api.ts`, `rooms.api.ts`, etc.
3. Cada função devolve o mesmo shape do TypeScript atual (`Task`, `User`, etc. de `fluxo-types.ts`) para não quebrar componentes.
4. Substituir chamadas ao `fluxo-store.tsx` (que hoje usa `localStorage`) por hooks TanStack Query em cima dessa camada.
5. Substituir `import { supabase } from "@/integrations/supabase/client"` por chamadas à nova API — arquivos afetados:
   - `src/lib/livekit-token.functions.ts` → vira endpoint `/api/livekit/token` no backend
   - `src/lib/meeting-summary.functions.ts` → vira `/api/minutes/generate`
   - `src/lib/transcription.functions.ts` → vira `/api/livekit/transcribe`
   - `src/lib/notes-ai.functions.ts` → vira `/api/notes/ai`
6. Remover pasta `src/integrations/supabase/` inteira.
7. Remover `_authenticated/route.tsx` gerado pelo Supabase; substituir por gate que checa MSAL.

### Fase 4 — Realtime
1. Instalar `@microsoft/signalr` no front.
2. Criar `src/lib/realtime.ts` — conexão única, reconectar automático, subscribe por grupo.
3. Trocar todos os `.channel(...)` do Supabase pelos grupos SignalR listados na seção 6.

### Fase 5 — Migração de dados (opcional)
Como hoje quase tudo está em `localStorage`, provavelmente **não há dados no Supabase para migrar** além de `room_call_events`, `room_knocks`, `room_members`, `room_state`. Script `scripts/export-supabase.ts` exporta essas 4 tabelas em JSON, `scripts/import-azure.ts` importa no Azure SQL. Rodar uma vez antes do go-live.

### Fase 6 — Validação
1. Testes E2E com Playwright (mesmos que já existem no projeto).
2. Smoke test: criar tarefa, iniciar timer, parar, gerar ata, aprovar knock.
3. Load test simples (k6) — 50 usuários simultâneos criando tarefas.

---

## 9. Tauri — empacotamento desktop

### Por que Tauri
- Bundle nativo Windows/macOS/Linux (o alvo aqui é **Windows** — a empresa é Microsoft).
- Roda em background com **tray icon** — recebe chamadas mesmo com janela fechada.
- **Notificações nativas** do Windows (flash na taskbar, som).
- **Autostart** com o SO — usuário loga no PC, o Fluxo já está pronto.
- Muito mais leve que Electron (~10 MB vs ~150 MB).

### Passo a passo (executar no VSCode local, não no Lovable)

```bash
# 1. Instalar prerequisitos Windows
# - Rust: https://rustup.rs
# - WebView2 (já vem no Windows 11)
# - Visual Studio Build Tools 2022 (C++)

# 2. Adicionar Tauri ao projeto
bun add -D @tauri-apps/cli @tauri-apps/api
bunx tauri init
# Respostas:
#   App name: Fluxo Task Pro
#   Window title: Fluxo Task Pro
#   Web assets location: ../dist
#   Dev server URL: http://localhost:8080
#   Frontend dev command: bun run dev
#   Frontend build command: bun run build
```

### Ajustes em `src-tauri/tauri.conf.json`

```json
{
  "productName": "Fluxo Task Pro",
  "identifier": "com.suaempresa.fluxo",
  "build": {
    "beforeDevCommand": "bun run dev",
    "devUrl": "http://localhost:8080",
    "beforeBuildCommand": "bun run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [{
      "title": "Fluxo Task Pro",
      "width": 1400,
      "height": 900,
      "minWidth": 1024,
      "minHeight": 640,
      "decorations": true,
      "resizable": true
    }],
    "trayIcon": {
      "iconPath": "icons/tray.png",
      "iconAsTemplate": false,
      "menuOnLeftClick": false
    },
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis"],
    "icon": ["icons/32x32.png","icons/128x128.png","icons/icon.ico"],
    "windows": { "webviewInstallMode": { "type": "embedBootstrapper" } }
  }
}
```

### Plugins Tauri obrigatórios

```bash
bun add @tauri-apps/plugin-notification @tauri-apps/plugin-autostart \
        @tauri-apps/plugin-single-instance @tauri-apps/plugin-updater \
        @tauri-apps/plugin-os @tauri-apps/plugin-deep-link
```

E no `src-tauri/Cargo.toml`:
```toml
tauri-plugin-notification = "2"
tauri-plugin-autostart = "2"
tauri-plugin-single-instance = "2"
tauri-plugin-updater = "2"
```

Registrar no `src-tauri/src/lib.rs`:
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| { /* focus */ }))
    .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(|app| {
        // tray icon, atalho global, etc.
        Ok(())
    })
    .run(tauri::generate_context!())
```

### Comportamentos desktop a implementar

1. **Fechar janela ≠ sair** — botão X minimiza para a bandeja. Só sai pelo menu do tray.
2. **Chamada entrante** — quando SignalR recebe `room_call_events` com `target_id = eu`:
   - Notificação nativa com botões "Atender" / "Recusar".
   - Flash da taskbar (`window.requestUserAttention`).
   - Som configurável (`src-tauri/sounds/ring.mp3`).
   - Se janela minimizada, `window.show(); window.setFocus(); window.setAlwaysOnTop(true)` por 3 segundos.
3. **Autostart** — checkbox em Configurações que liga/desliga `enable()` do plugin.
4. **Single instance** — evita abrir o app duas vezes; deep-link `fluxo://` para links de sala.
5. **Auto-update** — servidor de updates em `https://updates.suaempresa.com/fluxo/{{target}}/{{current_version}}` (pode ser um blob público).

### Build de produção

```bash
bunx tauri build
# Saída: src-tauri/target/release/bundle/msi/Fluxo Task Pro_1.0.0_x64_en-US.msi
```

Distribuir via GPO / Intune / manualmente.

### CI/CD (GitHub Actions)
Arquivo `.github/workflows/tauri-release.yml` — build automático em `push` de tag `v*`, publica MSI + NSIS na release do GitHub. Template pronto em https://github.com/tauri-apps/tauri-action.

---

## 10. Ordem sugerida de execução

1. **[Semana 1]** Provisionar Azure + rodar migration SQL + backend com endpoints `/users`, `/tasks`, `/pack` (CRUD básico) + autenticação Entra ID.
2. **[Semana 2]** Trocar `localStorage` do front por chamadas à API para tarefas e packs (o problema principal do usuário). Já resolve o bug do "pack não chega pra Elisa".
3. **[Semana 3]** Migrar salas, knocks, chamadas para Azure SQL + SignalR. Manter LiveKit intocado.
4. **[Semana 4]** Migrar anexos para Blob + atas + notificações. Remover integração Supabase inteira.
5. **[Semana 5]** Empacotar em Tauri, testar autostart/tray/notificações no Windows do time.
6. **[Semana 6]** Piloto com 5 usuários, ajustes, rollout geral.

---

## 11. Referências rápidas

- Tauri 2 docs: https://v2.tauri.app/
- Azure SignalR quickstart .NET: https://learn.microsoft.com/azure/azure-signalr/signalr-quickstart-dotnet-core
- MSAL React: https://learn.microsoft.com/entra/msal/javascript/react/
- Azure SQL + Dapper: https://learn.microsoft.com/azure/azure-sql/database/connect-query-dotnet-visual-studio
- Blob SAS tokens: https://learn.microsoft.com/azure/storage/common/storage-sas-overview
- LiveKit server SDK (mantém no backend .NET/Node): https://docs.livekit.io/server-sdk-js/

---

## 12. Checklist final antes do go-live

- [ ] Backup do Supabase exportado (JSON) e arquivado
- [ ] Azure SQL com backup automático diário (7 dias mínimo)
- [ ] Key Vault com todos os segredos (SQL conn string, LiveKit key/secret, Lovable API key)
- [ ] HTTPS obrigatório no App Service (redirect 80→443)
- [ ] CORS restrito ao domínio do app + `tauri://localhost`
- [ ] Rate limit por IP no App Service (mínimo 60 req/min por usuário)
- [ ] Application Insights ativo com alerta de erro 5xx > 1%
- [ ] Firewall do Azure SQL só permite o App Service e IPs de admin
- [ ] Certificado do MSI assinado (evita SmartScreen no Windows)

---

**Este documento é a fonte única de verdade para a migração.** Qualquer decisão que fugir daqui precisa ser adicionada como nota no final antes de ser executada.
