import { X } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { InlineTaskCreator } from "@/components/inline-task-creator";

export function QuickTaskModal() {
  const { quickCreate, closeQuickCreate } = useFluxo();
  if (!quickCreate.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-16"
      onClick={closeQuickCreate}
    >
      <div
        className="w-full max-w-5xl rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div>
            <div className="text-sm font-semibold">Criar tarefas rapidamente</div>
            <div className="text-[11px] text-muted-foreground">
              Enter para próxima linha · @ menciona · arraste arquivos para anexar
            </div>
          </div>
          <button
            onClick={closeQuickCreate}
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-3">
          <InlineTaskCreator
            defaultStatus={quickCreate.status ?? "pendente"}
            defaultDueDate={quickCreate.dueDate}
          />
        </div>
      </div>
    </div>
  );
}