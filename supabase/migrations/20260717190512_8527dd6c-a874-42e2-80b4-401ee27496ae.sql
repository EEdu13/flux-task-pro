GRANT SELECT ON public.tarefas TO anon;
CREATE POLICY "Anon can read tarefas" ON public.tarefas FOR SELECT TO anon USING (true);