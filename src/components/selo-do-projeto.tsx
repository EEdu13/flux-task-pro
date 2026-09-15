import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderKanban } from "lucide-react";
import type { Project } from "@/lib/fluxo-types";
import { corDoProjeto as corDo, useProjetoDaTarefa } from "@/lib/projeto-da-tarefa";

/**
 * "Projeto: Nome", na cor do projeto, com a foto quando ele tem uma.
 *
 * Subtarefa de projeto cai em "Minhas tarefas" junto com todo o resto, e sem
 * isto não havia como saber, olhando o cartão, que ela fazia parte de algo
 * maior — nem de qual projeto.
 */
export function SeloDoProjeto({
  projectId,
  className = "mr-1.5 align-[1px]",
}: {
  projectId?: string;
  className?: string;
}) {
  const projeto = useProjetoDaTarefa(projectId);
  if (!projeto) return null;
  const cor = corDo(projeto);
  return (
    <span
      title={`Projeto: ${projeto.name}`}
      className={`inline-flex max-w-full min-w-0 items-center gap-1 rounded-md py-px pl-0.5 pr-1.5 text-[11px] font-semibold normal-case tracking-normal ${className}`}
      style={{
        background: `color-mix(in oklab, ${cor} 18%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${cor} 45%, transparent)`,
        // Puxado para a cor do texto: as cores escuras (azul-marinho, vinho)
        // sumiriam no tema escuro se o texto usasse a cor pura.
        color: `color-mix(in oklab, ${cor} 72%, var(--foreground))`,
      }}
    >
      {projeto.photoUrl ? (
        <FotoDoProjeto projeto={projeto} tamanho={16} />
      ) : (
        <FolderKanban className="ml-1 h-3 w-3 shrink-0" style={{ color: cor }} aria-hidden />
      )}
      <span className="truncate">
        <span className="font-medium opacity-80">Projeto:</span> {projeto.name}
      </span>
    </span>
  );
}

/**
 * A foto do projeto em miniatura, que cresce ao passar o mouse.
 *
 * A ampliação abre num portal, fora do cartão: o cartão do quadro corta o que
 * passa da borda, e a foto grande nasceria recortada. A posição vem da
 * miniatura e vira para cima ou para a esquerda quando não cabe na tela.
 */
export function FotoDoProjeto({
  projeto,
  tamanho = 20,
  className = "",
}: {
  projeto: Project;
  tamanho?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  if (!projeto.photoUrl) return null;

  const LADO = 240;
  const abrir = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const cabeEmbaixo = r.bottom + 8 + LADO + 28 < window.innerHeight;
    setPos({
      top: cabeEmbaixo ? r.bottom + 8 : Math.max(8, r.top - LADO - 36),
      left: Math.max(8, Math.min(r.left + r.width / 2 - LADO / 2, window.innerWidth - LADO - 8)),
    });
  };

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={abrir}
        onMouseLeave={() => setPos(null)}
        className={`inline-block shrink-0 overflow-hidden rounded-full ring-1 ring-black/10 ${className}`}
        style={{ width: tamanho, height: tamanho }}
      >
        <img
          src={projeto.photoUrl}
          alt={`Foto do projeto ${projeto.name}`}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      </span>
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="pointer-events-none fixed z-500 overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90"
            style={{ top: pos.top, left: pos.left, width: LADO }}
          >
            <img
              src={projeto.photoUrl}
              alt=""
              className="block object-cover"
              style={{ width: LADO, height: LADO }}
            />
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-popover-foreground">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: corDo(projeto) }} />
              <span className="truncate">{projeto.name}</span>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
