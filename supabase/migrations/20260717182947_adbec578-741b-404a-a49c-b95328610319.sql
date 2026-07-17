CREATE TABLE public.tarefas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo TEXT NOT NULL,
  telefone TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  criado_em TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tarefas TO authenticated;
GRANT ALL ON public.tarefas TO service_role;

ALTER TABLE public.tarefas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read tarefas"
  ON public.tarefas FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can update tarefas"
  ON public.tarefas FOR UPDATE
  TO authenticated
  USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.tarefas;
