import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type TarefaWA = {
  id: string;
  titulo: string;
  telefone: string | null;
  status: string;
  criado_em: string;
};

export const Route = createFileRoute("/tarefas-wa")({
  head: () => ({
    meta: [
      { title: "Tarefas WhatsApp" },
      { name: "description", content: "Tarefas criadas via WhatsApp." },
    ],
  }),
  component: TarefasWAPage,
});

function TarefasWAPage() {
  const [rows, setRows] = useState<TarefaWA[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("tarefas")
        .select("*")
        .order("criado_em", { ascending: false })
        .limit(200);
      if (!alive) return;
      if (error) setErr(error.message);
      else setRows((data ?? []) as TarefaWA[]);
      setLoading(false);
    })();

    const channel = supabase
      .channel("tarefas-wa")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tarefas" },
        (payload) => {
          setRows((curr) => {
            if (payload.eventType === "INSERT") {
              return [payload.new as TarefaWA, ...curr];
            }
            if (payload.eventType === "UPDATE") {
              return curr.map((r) =>
                r.id === (payload.new as TarefaWA).id
                  ? (payload.new as TarefaWA)
                  : r,
              );
            }
            if (payload.eventType === "DELETE") {
              return curr.filter((r) => r.id !== (payload.old as TarefaWA).id);
            }
            return curr;
          });
        },
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, []);

  async function toggleStatus(row: TarefaWA) {
    const next = row.status === "concluida" ? "pendente" : "concluida";
    await supabase.from("tarefas").update({ status: next }).eq("id", row.id);
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Tarefas via WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Atualiza em tempo real conforme as mensagens chegam no webhook.
        </p>
      </header>

      {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {err && <p className="text-sm text-destructive">Erro: {err}</p>}

      <ul className="divide-y rounded-lg border bg-card">
        {rows.length === 0 && !loading && (
          <li className="p-4 text-sm text-muted-foreground">
            Nenhuma tarefa ainda. Envie uma mensagem no WhatsApp conectado.
          </li>
        )}
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 p-3">
            <button
              type="button"
              onClick={() => toggleStatus(r)}
              className={`h-5 w-5 shrink-0 rounded border ${
                r.status === "concluida"
                  ? "bg-primary border-primary"
                  : "border-muted-foreground/40"
              }`}
              aria-label="Alternar status"
            />
            <div className="min-w-0 flex-1">
              <p
                className={`truncate text-sm ${
                  r.status === "concluida"
                    ? "line-through text-muted-foreground"
                    : ""
                }`}
              >
                {r.titulo}
              </p>
              <p className="text-xs text-muted-foreground">
                {r.telefone ?? "—"} ·{" "}
                {new Date(r.criado_em).toLocaleString("pt-BR")}
              </p>
            </div>
            <span className="text-xs rounded-full border px-2 py-0.5 text-muted-foreground">
              {r.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}