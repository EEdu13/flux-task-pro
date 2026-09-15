import { FolderKanban } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";

/**
 * O nome do projeto, na cor dele, na frente do título da tarefa.
 *
 * Subtarefa de projeto cai em "Minhas tarefas" junto com todo o resto, e sem
 * isto não havia como saber, olhando o cartão, que ela fazia parte de algo
 * maior — nem de qual projeto.
 *
 * Procura em TODOS os projetos, não só nos visíveis: quem recebe a subtarefa
 * pode não participar do projeto (foi incluído e depois saiu), e o selo ainda
 * deve dizer de onde a tarefa veio. O id é comparado sem caixa porque o banco
 * devolve o GUID em maiúsculas e o que nasce no navegador vem em minúsculas.
 */
export function SeloDoProjeto({ projectId }: { projectId?: string }) {
  const { projects } = useFluxo();
  if (!projectId) return null;
  const alvo = projectId.toLowerCase();
  const projeto = projects.find((p) => p.id.toLowerCase() === alvo);
  if (!projeto) return null;

  const cor = projeto.color ?? "var(--color-primary)";
  return (
    <span
      title={`Projeto: ${projeto.name}`}
      className="mr-1.5 inline-flex max-w-[60%] items-center gap-1 rounded-md px-1.5 py-px align-[1px] text-[11px] font-semibold no-underline"
      style={{
        background: `color-mix(in oklab, ${cor} 18%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${cor} 45%, transparent)`,
        // Puxado para a cor do texto: as cores escuras da paleta (azul-marinho,
        // vinho) sumiriam no tema escuro se o texto usasse a cor pura.
        color: `color-mix(in oklab, ${cor} 72%, var(--foreground))`,
      }}
    >
      <FolderKanban className="h-3 w-3 shrink-0" style={{ color: cor }} aria-hidden />
      <span className="truncate">{projeto.name}</span>
    </span>
  );
}
