import { Sparkles } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import type { Task } from "@/lib/fluxo-types";

/**
 * "Nova · chegou hoje 13/10" no próprio cartão (pedido do usuário,
 * 13/10/2026). Substitui a seção "Chegaram pra hoje" do Meu pack: em vez de
 * uma lista à parte, a tarefa recém-chegada se destaca onde ela já está.
 *
 * Nova = criada HOJE por outra pessoa (quem cria para si mesmo não "recebe"
 * nada). Amanhã ela já não é mais nova e o selo some sozinho.
 */
export function chegouHoje(t: Pick<Task, "createdAt" | "createdBy">, euId: string): boolean {
  if (!t.createdAt || t.createdBy === euId) return false;
  const criada = new Date(t.createdAt);
  const hoje = new Date();
  return (
    criada.getFullYear() === hoje.getFullYear() &&
    criada.getMonth() === hoje.getMonth() &&
    criada.getDate() === hoje.getDate()
  );
}

export function SeloNova({ task, className = "" }: { task: Task; className?: string }) {
  const { currentUser } = useFluxo();
  if (task.status === "concluida" || !chegouHoje(task, currentUser.id)) return null;
  const dia = new Date(task.createdAt).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 normal-case tracking-normal ${className}`}
      title={`Chegou hoje, ${dia}`}
    >
      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-white shadow-sm">
        <Sparkles className="h-2.5 w-2.5" /> Nova
      </span>
      <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        chegou hoje {dia}
      </span>
    </span>
  );
}
