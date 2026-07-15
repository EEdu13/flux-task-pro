## O que vou entregar

### 1. Busca global (Ctrl/Cmd+K)
- Nova `<CommandPalette />` global (Radix Dialog + `cmdk`).
- Índice em memória construído do `fluxo-store`: **tarefas** (título, tag, responsável), **pessoas**, **salas**, **atas**, **notas**, **mensagens do inbox**.
- Ações navegáveis: "Criar tarefa", "Abrir minhas tarefas", "Entrar na sala X", "Ligar pra pessoa Y", "Abrir ata Z".
- Agrupado por tipo, navegação por ↑↓ Enter, `Esc` fecha.
- Atalho global registrado no `FluxoLayout`.

### 2. Snooze — botão "Deixar pra amanhã"
- Botão no card da tarefa (hover) e no menu de contexto: **"Deixar pra amanhã"** — move `dueDate` pra amanhã 9h e some da lista de hoje.
- Variantes no menu de contexto: "Adiar 1h", "Amanhã de manhã", "Próxima segunda".
- Registra na `activity` como "adiada por X".
- Toast com Undo (integra com item 4).

### 3. Modo Foco (Pomodoro)
- Botão ▶ nos itens do **Pack** ("Meu pack" em `minhas-tarefas`).
- Overlay minimalista fullscreen: título da tarefa, timer 25:00, botões pausar/parar, checklist embutido.
- Ao clicar iniciar: pede permissão de notificação, silencia toasts internos (flag no store), muta som de nudge/chamada entrante durante o foco.
- No fim: som suave + notificação "5 min de pausa?", incrementa `pomos` do dia (novo `focusLog` em `fluxo-store`: `{date, taskId, minutes}`).
- Novo bloco "Foco hoje" no header de Minhas Tarefas: **X pomos · Yh Zm**.

### 4. Undo global (Ctrl+Z)
- Novo `useUndoStack()` no store: registra ações reversíveis com `{label, undo: () => void, at}`.
- Ações plugadas: excluir tarefa, concluir tarefa (rápido), snooze, mover kanban, arquivar nota, encerrar chamada.
- Toast Sonner "Tarefa excluída — Desfazer" (8s) + atalho global **Ctrl/Cmd+Z** quando foco não é em input.

### 5. Painel de equipe (Ctrl+E) — delegação por arrasto
- Atalho global **Ctrl/Cmd+E** abre `<TeamDelegatePanel />` fullscreen.
- Layout kanban horizontal: **1 coluna por pessoa da minha equipe** (ou do meu setor).
- Cada coluna mostra: avatar, nome, status (usando `PresenceBadge` que já existe), carga da semana (nº tarefas ativas), próximos vencimentos.
- Barra de tarefas do lado (minhas em aberto + busca rápida) — **arrasta pra coluna da pessoa = delega**.
- "Criar tarefa aqui" direto na coluna (mini creator).
- Fecha com Esc.

### 6. Transcrição melhor
- Trocar `webkitSpeechRecognition` (item que estava ruim/lento) por **STT server-side com Lovable AI `openai/gpt-4o-transcribe`**.
- Nova serverFn `transcribeChunk` recebe blob de áudio (~15s), retorna texto + segmentos.
- No `active-call-widget`: cada participante grava o próprio mic com `MediaRecorder` em pedaços de 15s (`timeslice: 15000`), envia via serverFn, resultado vai pro data channel `fluxo-transcript` com `{from, text, at}`.
- VAD leve (checa se houve som no chunk antes de enviar) pra não gastar toa.
- Chunks curtos = feedback rápido (aparece em ~2s vs. hoje que às vezes leva 20s+).
- Fallback: se serverFn falhar, mantém `webkitSpeechRecognition` local como backup.
- Painel de transcrição já existente continua igual, só a fonte muda.

## Arquivos novos
- `src/components/command-palette.tsx`
- `src/components/team-delegate-panel.tsx`
- `src/components/focus-overlay.tsx`
- `src/lib/undo-stack.tsx` (context + hook)
- `src/lib/transcription.functions.ts` (STT server-side)
- `src/hooks/use-global-shortcuts.ts` (Ctrl+K, Ctrl+E, Ctrl+Z)

## Arquivos editados
- `src/lib/fluxo-store.tsx` — `focusLog`, `snoozeTask()`, integração com undo stack, flag `focusMode`
- `src/lib/fluxo-types.ts` — tipo `FocusEntry`
- `src/components/fluxo-layout.tsx` — monta Palette, Undo provider, atalhos globais
- `src/components/task-context-menu.tsx` — itens "Deixar pra amanhã" / "Adiar" / undo
- `src/components/inline-task-creator.tsx` e cards de tarefa — botão hover "Deixar pra amanhã"
- `src/routes/minhas-tarefas.tsx` — botão ▶ Foco no pack, contador "Foco hoje"
- `src/components/active-call-widget.tsx` — nova fonte de transcrição via serverFn
- pacote `cmdk` instalado

## Fora do escopo desta leva
- Handoff de fim de expediente (fica pra próxima como falamos)
- Reunião-que-não-precisou-acontecer
- Detector de tarefa órfã por IA
- Workload heatmap avançado (o painel do Ctrl+E já mostra carga básica)

Aprovando, começo pela ordem: **1 → 4 → 2 → 3 → 5 → 6** (Cmd+K e Undo primeiro porque tudo depende deles).