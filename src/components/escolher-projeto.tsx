import { useMemo, useState } from "react";
import { Check, FolderKanban, FolderMinus, Search } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFluxo } from "@/lib/fluxo-store";
import { corDoProjeto } from "@/lib/projeto-da-tarefa";
import type { Task } from "@/lib/fluxo-types";

/**
 * "Atribuir ao projeto" direto da tarefa (pedido do usuário, 13/10/2026): criar
 * a tarefa em Minhas tarefas e ligá-la a um projeto ativo sem precisar ir até a
 * tela do projeto. Lista só os ATIVOS de que a pessoa é dona.
 */
export function ListaDeProjetos({ task, aoEscolher }: { task: Task; aoEscolher?: () => void }) {
  const { projects, currentUser, updateTask } = useFluxo();
  const [busca, setBusca] = useState("");

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    /* Só os projetos de que a pessoa é DONA (pedido do usuário, 13/10/2026):
       pôr tarefa no projeto dos outros bagunçava o projeto alheio. O projeto
       atual da tarefa continua na lista, para mostrar o visto. */
    return projects
      .filter(
        (p) => (p.status === "ativo" && p.ownerId === currentUser.id) || p.id === task.projectId,
      )
      .filter((p) => !termo || p.name.toLowerCase().includes(termo))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [projects, busca, currentUser.id, task.projectId]);

  const escolher = (projectId: string | undefined, nome?: string) => {
    if ((projectId ?? null) === (task.projectId ?? null)) {
      aoEscolher?.();
      return;
    }
    const antes = task.projectId;
    updateTask(task.id, { projectId });
    toast.success(projectId ? `Tarefa no projeto ${nome}` : "Tarefa tirada do projeto", {
      action: { label: "Desfazer", onClick: () => updateTask(task.id, { projectId: antes }) },
    });
    aoEscolher?.();
  };

  return (
    <div className="flex flex-col">
      <div className="relative px-1 pb-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-[60%] text-muted-foreground" />
        <input
          autoFocus
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Buscar projeto…"
          className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary"
        />
      </div>
      <div className="max-h-64 overflow-y-auto">
        {lista.length === 0 ? (
          <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
            {busca
              ? "Nenhum projeto seu com esse nome."
              : "Você não é dono de nenhum projeto ativo."}
          </div>
        ) : (
          lista.map((p) => {
            const atual = p.id === task.projectId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  escolher(p.id, p.name);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-secondary ${
                  atual ? "font-semibold" : ""
                }`}
              >
                <FolderKanban className="h-3.5 w-3.5 shrink-0" style={{ color: corDoProjeto(p) }} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {atual && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            );
          })
        )}
      </div>
      {task.projectId && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            escolher(undefined);
          }}
          className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-left text-xs text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <FolderMinus className="h-3.5 w-3.5" /> Tirar do projeto
        </button>
      )}
    </div>
  );
}

/** O botão com a pastinha, para a linha da tarefa: abre a lista num popover. */
export function BotaoAtribuirProjeto({ task, className = "" }: { task: Task; className?: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={task.projectId ? "Trocar o projeto da tarefa" : "Atribuir ao projeto"}
          className={`rounded p-1 transition hover:bg-secondary ${
            task.projectId ? "text-primary" : "text-muted-foreground hover:text-foreground"
          } ${className}`}
        >
          <FolderKanban className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="z-[460] w-64 rounded-xl p-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-2 pb-1.5 pt-0.5 text-[11px] font-semibold text-muted-foreground">
          Atribuir ao projeto
        </div>
        <ListaDeProjetos task={task} aoEscolher={() => setAberto(false)} />
      </PopoverContent>
    </Popover>
  );
}
