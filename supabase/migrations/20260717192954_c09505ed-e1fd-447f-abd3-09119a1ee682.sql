
ALTER TABLE public.tarefas
  ADD COLUMN IF NOT EXISTS assignee_user_id text,
  ADD COLUMN IF NOT EXISTS creator_user_id  text,
  ADD COLUMN IF NOT EXISTS description      text,
  ADD COLUMN IF NOT EXISTS due_date         timestamptz,
  ADD COLUMN IF NOT EXISTS recurring        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurring_until  timestamptz,
  ADD COLUMN IF NOT EXISTS require_proof    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority         text    NOT NULL DEFAULT 'media';

CREATE INDEX IF NOT EXISTS tarefas_assignee_idx ON public.tarefas (assignee_user_id);
CREATE INDEX IF NOT EXISTS tarefas_criado_em_idx ON public.tarefas (criado_em DESC);
