import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { entradasDoWhatsapp, encaminharEntrada } from "@/lib/whatsapp.functions";
import type { EntradaWhatsapp } from "@/lib/whatsapp.functions";

export const Route = createFileRoute("/tarefas-wa")({
  head: () => ({
    meta: [
      { title: "Entrada do WhatsApp" },
      { name: "description", content: "Mensagens que chegaram pelo WhatsApp." },
    ],
  }),
  component: EntradaWhatsappPage,
});

/* Esta tela era pública e lia a tabela inteira do Supabase com a chave anônima:
   quem soubesse o endereço via o telefone e o texto das mensagens de todo mundo,
   e podia marcar qualquer uma como concluída. Agora ela passa por sessão como o
   resto do sistema, e o servidor decide o que cada pessoa enxerga. */
function EntradaWhatsappPage() {
  const { users, currentUser, visibleUsersForAssign } = useFluxo();
  const [entradas, setEntradas] = useState<EntradaWhatsapp[]>([]);
  const [podeEncaminhar, setPodeEncaminhar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await entradasDoWhatsapp();
      setEntradas(r.entradas);
      setPodeEncaminhar(r.podeEncaminhar);
      setErro(null);
    } catch (e) {
      setErro((e as Error)?.message ?? "Falha ao carregar");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const nomeDe = (id: string | null) =>
    id ? (users.find((u) => u.id === id)?.name ?? `pessoa ${id}`) : null;

  async function encaminhar(entrada: EntradaWhatsapp, paraPessoaId: string) {
    try {
      const r = await encaminharEntrada({ data: { id: entrada.id, paraPessoaId } });
      if (!r.ok) {
        toast.error("Esta mensagem já virou tarefa");
      } else {
        toast.success(`Tarefa criada para ${nomeDe(paraPessoaId) ?? "a pessoa"}`);
      }
      await carregar();
    } catch (e) {
      toast.error((e as Error)?.message ?? "Não foi possível encaminhar");
    }
  }

  const pendentes = entradas.filter((e) => e.processadaEm === null);
  const resolvidas = entradas.filter((e) => e.processadaEm !== null);

  return (
    <FluxoLayout title="Entrada do WhatsApp">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Entrada do WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            O que o bot recebeu. Quando ele reconhece o telefone, a tarefa é criada na
            hora; quando não reconhece, a mensagem fica aqui esperando alguém encaminhar.
          </p>
        </header>

        {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {erro && <p className="text-sm text-destructive">Erro: {erro}</p>}

        {!carregando && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">
              Sem dono ({pendentes.length})
            </h2>
            {pendentes.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
                Nada esperando. Toda mensagem que chegou já virou tarefa de alguém.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {pendentes.map((e) => (
                  <li key={e.id} className="space-y-2 p-3">
                    <p className="text-sm font-medium">{e.titulo}</p>
                    {e.descricao && (
                      <p className="text-xs text-muted-foreground">{e.descricao}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {e.telefone ?? "sem telefone"} ·{" "}
                      {new Date(e.criadoEm).toLocaleString("pt-BR")}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void encaminhar(e, currentUser.id)}
                        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-secondary"
                      >
                        Pegar para mim
                      </button>
                      {/* Passar para outra pessoa é de quem chefia — a mesma
                          regra que o servidor aplica. Sem isto, o botão
                          apareceria para todo mundo e falharia ao ser usado. */}
                      {podeEncaminhar && (
                        <select
                          defaultValue=""
                          onChange={(ev) => {
                            const id = ev.target.value;
                            ev.target.value = "";
                            if (id) void encaminhar(e, id);
                          }}
                          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                        >
                          <option value="">Encaminhar para…</option>
                          {visibleUsersForAssign()
                            .filter((u) => u.id !== currentUser.id)
                            .map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!carregando && resolvidas.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Já viraram tarefa ({resolvidas.length})</h2>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {resolvidas.map((e) => (
                <li key={e.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{e.titulo}</p>
                    <p className="text-xs text-muted-foreground">
                      {nomeDe(e.responsavelId) ?? "sem dono"} · {e.telefone ?? "—"} ·{" "}
                      {new Date(e.criadoEm).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    virou tarefa
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </FluxoLayout>
  );
}
