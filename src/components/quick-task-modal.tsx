import { X } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { InlineTaskCreator } from "@/components/inline-task-creator";

export function QuickTaskModal() {
  const { quickCreate, closeQuickCreate } = useFluxo();
  if (!quickCreate.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-10 backdrop-blur-sm"
      onClick={closeQuickCreate}
    >
      <div
        className="w-full max-w-6xl rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <div className="text-lg font-semibold tracking-tight">Criar tarefas rapidamente</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Uma linha = uma tarefa. Preencha o título e os campos ao lado — <strong>tudo está visível abaixo</strong>.
            </div>
          </div>
          <button
            onClick={closeQuickCreate}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">
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