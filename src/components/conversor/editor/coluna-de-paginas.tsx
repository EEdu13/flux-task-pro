import { memo, useEffect, useRef, useState } from "react";
import { DndContext } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, FilePlus2, FileUp, RotateCw, Trash2 } from "lucide-react";
import { useArrasteDeLinhas } from "@/components/arraste";
import { viewportEmPontos, type DocumentoAberto } from "../locais/editor/documento";
import { medidasNaTela, type PaginaDoEditor } from "./modelo";

/*
 * A coluna das páginas do Editor de PDF (05/11/2026): miniaturas para ir a uma
 * página, arrastar para reordenar, girar, duplicar e apagar, além de inserir uma
 * página em branco e trazer as páginas de outro PDF.
 */

const LARGURA_DA_MINIATURA = 112;

function Miniatura({
  pagina,
  documento,
  raiz,
}: {
  pagina: PaginaDoEditor;
  documento: DocumentoAberto | null;
  raiz: React.RefObject<HTMLElement | null>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const alvo = canvas.current;
    if (!alvo || !documento) return;
    let vivo = true;
    let tarefa: { cancel: () => void } | null = null;
    const obs = new IntersectionObserver(
      (e) => {
        if (!e.some((x) => x.isIntersecting)) return;
        obs.disconnect();
        documento.pagina(pagina.indice).then(
          (p) => {
            if (!vivo) return;
            const natural = viewportEmPontos(p);
            const densidade = Math.min(window.devicePixelRatio || 1, 2);
            const vp = viewportEmPontos(p, (LARGURA_DA_MINIATURA * densidade) / natural.width);
            alvo.width = Math.ceil(vp.width);
            alvo.height = Math.ceil(vp.height);
            const r = p.render({ canvas: alvo, viewport: vp });
            tarefa = r;
            r.promise.catch(() => {});
          },
          () => {},
        ); // Só falha com o Editor fechando.
      },
      { root: raiz.current, rootMargin: "300px" },
    );
    obs.observe(alvo);
    return () => {
      vivo = false;
      obs.disconnect();
      tarefa?.cancel();
    };
  }, [documento, pagina.indice, raiz]);

  const tela = medidasNaTela(pagina, pagina.giro);
  const escala = Math.min(
    LARGURA_DA_MINIATURA / tela.largura,
    (LARGURA_DA_MINIATURA * 1.45) / tela.altura,
  );
  return (
    <span
      className="relative block overflow-hidden rounded-sm bg-white shadow-md"
      style={{ width: tela.largura * escala, height: tela.altura * escala }}
    >
      <span
        className="absolute left-1/2 top-1/2 block"
        style={{
          width: pagina.largura * escala,
          height: pagina.altura * escala,
          transform: `translate(-50%, -50%) rotate(${pagina.giro}deg)`,
        }}
      >
        {documento && <canvas ref={canvas} aria-hidden className="block h-full w-full" />}
      </span>
    </span>
  );
}

/* `memo` no cartão e na coluna: rolar ou mudar a seleção não pode redesenhar 300 miniaturas. */
const CartaoDaPagina = memo(function CartaoDaPagina({
  pagina,
  numero,
  documento,
  atual,
  raiz,
  podeApagar,
  aoIr,
  aoGirar,
  aoDuplicar,
  aoApagar,
}: {
  pagina: PaginaDoEditor;
  numero: number;
  documento: DocumentoAberto | null;
  atual: boolean;
  raiz: React.RefObject<HTMLElement | null>;
  podeApagar: boolean;
  aoIr: (id: string) => void;
  aoGirar: (id: string) => void;
  aoDuplicar: (id: string) => void;
  aoApagar: (id: string) => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: pagina.id,
    attributes: { roleDescription: "página" },
  });
  return (
    <li
      ref={setNodeRef}
      data-miniatura={numero}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group relative rounded-xl border p-2 transition-colors ${
        atual ? "border-[var(--acento)] bg-white/10" : "border-transparent hover:bg-white/[0.06]"
      } ${isDragging ? "z-10 bg-white/15 shadow-xl" : ""}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={() => aoIr(pagina.id)}
        aria-label={`Ir para a página ${numero}. Arraste para mudar a ordem.`}
        aria-current={atual ? "page" : undefined}
        className="flex w-full cursor-grab touch-none flex-col items-center gap-1.5 active:cursor-grabbing"
      >
        <Miniatura pagina={pagina} documento={documento} raiz={raiz} />
        <span className="text-[11px] font-semibold text-white/55">{numero}</span>
      </button>
      {/* Aparecem com o mouse em cima, ou com o foco do teclado. */}
      <span className="absolute right-1 top-1 hidden flex-col gap-0.5 rounded-lg bg-zinc-900/95 p-0.5 shadow-lg group-focus-within:flex group-hover:flex">
        <button
          type="button"
          onClick={() => aoGirar(pagina.id)}
          aria-label={`Girar a página ${numero}`}
          title="Girar"
          className="rounded-md p-1 text-white/70 transition hover:bg-white/15 hover:text-white"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => aoDuplicar(pagina.id)}
          aria-label={`Duplicar a página ${numero}`}
          title="Duplicar"
          className="rounded-md p-1 text-white/70 transition hover:bg-white/15 hover:text-white"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        {podeApagar && (
          <button
            type="button"
            onClick={() => aoApagar(pagina.id)}
            aria-label={`Apagar a página ${numero}`}
            title="Apagar"
            className="rounded-md p-1 text-white/70 transition hover:bg-white/15 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </li>
  );
});

export const ColunaDePaginas = memo(function ColunaDePaginas({
  paginas,
  documentos,
  atual,
  aoIr,
  aoReordenar,
  aoGirar,
  aoDuplicar,
  aoApagar,
  aoInserirBranca,
  aoImportar,
}: {
  paginas: readonly PaginaDoEditor[];
  documentos: readonly DocumentoAberto[];
  atual: string | null;
  aoIr: (id: string) => void;
  aoReordenar: (ids: string[]) => void;
  aoGirar: (id: string) => void;
  aoDuplicar: (id: string) => void;
  aoApagar: (id: string) => void;
  aoInserirBranca: () => void;
  aoImportar: () => void;
}) {
  const rolagem = useRef<HTMLDivElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const ids = paginas.map((p) => p.id);
  const contexto = useArrasteDeLinhas((id, sobre) => {
    aoReordenar(arrayMove(ids, ids.indexOf(String(id)), ids.indexOf(String(sobre))));
  });
  return (
    <aside
      className="flex w-44 shrink-0 flex-col border-r border-white/10 bg-zinc-900/95"
      aria-label="Páginas"
      data-arrastando-lista={arrastando ? "" : undefined}
    >
      <div ref={rolagem} className="min-h-0 flex-1 overflow-y-auto p-2">
        <DndContext
          {...contexto}
          onDragStart={() => setArrastando(true)}
          onDragEnd={(e) => {
            setArrastando(false);
            contexto.onDragEnd?.(e);
          }}
          onDragCancel={() => setArrastando(false)}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol className="space-y-1">
              {paginas.map((p, i) => (
                <CartaoDaPagina
                  key={p.id}
                  pagina={p}
                  numero={i + 1}
                  documento={p.documento === null ? null : (documentos[p.documento] ?? null)}
                  atual={atual === p.id}
                  raiz={rolagem}
                  podeApagar={paginas.length > 1}
                  aoIr={aoIr}
                  aoGirar={aoGirar}
                  aoDuplicar={aoDuplicar}
                  aoApagar={aoApagar}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      </div>
      <div className="space-y-1 border-t border-white/10 p-2">
        <button
          type="button"
          onClick={aoInserirBranca}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <FilePlus2 className="h-3.5 w-3.5" /> Página em branco
        </button>
        <button
          type="button"
          onClick={aoImportar}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <FileUp className="h-3.5 w-3.5" /> Trazer de outro PDF
        </button>
      </div>
    </aside>
  );
});
