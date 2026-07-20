import { X } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { InlineTaskCreator } from "@/components/inline-task-creator";

export function QuickTaskModal() {
  const { quickCreate, closeQuickCreate } = useFluxo();
  if (!quickCreate.open) return null;
  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center overflow-y-auto bg-black/85 p-0 pt-0 backdrop-blur-sm"
      onClick={closeQuickCreate}
    >
      <div
        className="w-[100vw] min-h-[100vh] rounded-none border-0 border-foreground/80 bg-background text-foreground shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b-2 border-foreground/80 bg-secondary/60 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <div className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
              Criar tarefas rapidamente
            </div>
            <div className="mt-1 text-xs font-medium text-foreground/80 sm:text-sm">
              Uma linha = uma tarefa. Preencha o título e os campos ao lado —{" "}
              <strong className="text-foreground">tudo está visível abaixo</strong>.
            </div>
          </div>
          <button
            onClick={closeQuickCreate}
            className="inline-flex items-center gap-1.5 rounded-md border-2 border-foreground/70 bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground shadow-sm transition hover:bg-destructive hover:text-destructive-foreground"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">Fechar</span>
          </button>
        </div>
        <div className="p-2 sm:p-4">
          <InlineTaskCreator
            defaultStatus={quickCreate.status ?? "pendente"}
            defaultDueDate={quickCreate.dueDate}
            defaultAssigneeId={quickCreate.assigneeId}
          />
        </div>
      </div>
    </div>
  );
}