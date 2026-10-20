import { TreePine } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { nomeCurto } from "@/lib/nome-curto";
import { openAttachment } from "@/lib/attachments";
import { formatRelative } from "@/lib/use-theme";
import type { PostDoMural } from "@/lib/mural.functions";

/*
 * "Do campo" em galeria (Mural, fase 3 — 14/10/2026): todas as fotos dos
 * posts do campo já carregados, numa grade. Clicar abre a foto; a legenda
 * diz quem mandou e quando. Sem ida ao servidor: usa as páginas do feed que a
 * tela já tem ("Carregar mais" traz mais fotos).
 */
export function GaleriaDoCampo({
  posts,
  aoAbrirPost,
}: {
  posts: PostDoMural[];
  aoAbrirPost: (id: string) => void;
}) {
  const { users } = useFluxo();
  const fotos = posts.flatMap((p) => p.fotos.map((f) => ({ foto: f, post: p })));

  if (!fotos.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <TreePine className="mx-auto h-9 w-9 text-emerald-600/70" />
        <h2 className="mt-3 font-display text-lg font-semibold">Nenhuma foto do campo ainda</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Escolha "Do campo" no compositor e mande a primeira foto da operação.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
      {fotos.map(({ foto, post }) => {
        const autor = users.find((u) => u.id === post.autorId)?.name ?? "Alguém";
        return (
          <figure
            key={foto.id}
            className="group relative aspect-square overflow-hidden rounded-lg bg-secondary"
          >
            <button
              type="button"
              onClick={() =>
                openAttachment({
                  dataUrl: foto.url,
                  name: foto.nome,
                  type: foto.tipoMime,
                  size: foto.tamanho,
                })
              }
              className="h-full w-full"
              title={post.texto.slice(0, 120) || foto.nome}
            >
              <img
                src={foto.url}
                alt={post.texto.slice(0, 80)}
                loading="lazy"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />
            </button>
            <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-[11px] text-white opacity-0 transition group-hover:opacity-100">
              <span className="font-semibold">{nomeCurto(autor)}</span> ·{" "}
              {formatRelative(post.criadoEm)}
            </figcaption>
            <button
              type="button"
              onClick={() => aoAbrirPost(post.id)}
              className="absolute right-1.5 top-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white opacity-0 transition hover:bg-black/75 group-hover:opacity-100 focus:opacity-100"
            >
              Ver post
            </button>
          </figure>
        );
      })}
    </div>
  );
}
