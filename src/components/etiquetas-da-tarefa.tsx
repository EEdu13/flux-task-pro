import { comCerquilha } from "@/lib/etiquetas-do-projeto";
import type { Task } from "@/lib/fluxo-types";
import { useEtiquetasDoCartao } from "@/lib/projeto-da-tarefa";

/** Até `max` etiquetas; as outras viram "+N", com os nomes no título. */
export function PilulasDeEtiqueta({
  etiquetas,
  max = 3,
  className = "",
}: {
  etiquetas: string[];
  max?: number;
  className?: string;
}) {
  if (etiquetas.length === 0) return null;
  const resto = etiquetas.slice(max);
  return (
    <span className={`flex min-w-0 flex-wrap items-center gap-1 ${className}`}>
      {etiquetas.slice(0, max).map((e) => (
        <span
          key={e}
          title={comCerquilha(e)}
          className="max-w-36 truncate rounded border border-border bg-secondary/60 px-1.5 text-[10px] font-medium leading-4 text-muted-foreground"
        >
          {comCerquilha(e)}
        </span>
      ))}
      {resto.length > 0 && (
        <span
          title={resto.map(comCerquilha).join(" ")}
          className="text-[10px] text-muted-foreground"
        >
          +{resto.length}
        </span>
      )}
    </span>
  );
}

/** As etiquetas do cartão de uma tarefa, sem as que o selo do projeto já mostra. */
export function EtiquetasDaTarefa({
  task,
  max,
  className,
}: {
  task: Pick<Task, "tags" | "projectId">;
  max?: number;
  className?: string;
}) {
  const etiquetas = useEtiquetasDoCartao(task);
  return <PilulasDeEtiqueta etiquetas={etiquetas} max={max} className={className} />;
}
