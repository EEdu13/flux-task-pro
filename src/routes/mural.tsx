import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  HeartHandshake,
  LayoutGrid,
  List,
  Loader2,
  Megaphone,
  Newspaper,
  RefreshCw,
  Sprout,
  TreePine,
  Trophy,
  Vote,
} from "lucide-react";
import { toast } from "sonner";
import { FluxoLayout } from "@/components/fluxo-layout";
import { BlocoEntrada } from "@/components/stagger";
import { Compositor } from "@/components/mural/compositor";
import { CartaoDoPost } from "@/components/mural/cartao-do-post";
import { GaleriaDoCampo } from "@/components/mural/galeria-do-campo";
import { TrilhoDoMural } from "@/components/mural/trilho-do-mural";
import { abrirAgradecer } from "@/components/mural/agradecer";
import { UserAvatar } from "@/components/user-avatar";
import { useFluxo } from "@/lib/fluxo-store";
import { sectors } from "@/lib/fluxo-types";

/* O meu boneco comemorando, no cartão da lateral (só traz o three.js em tela grande). */
const AvatarComemorando = lazy(() => import("@/components/mural/avatar-comemorando"));
import {
  carregarPainelDoMural,
  EVENTO_MURAL_PUBLICADO,
  MSG_MURAL_INATIVO,
} from "@/lib/mural-cliente";
import type {
  CursorDoMural,
  FiltroDoMural,
  PainelDoMural,
  PostDoMural,
} from "@/lib/mural.functions";

/*
 * Mural (pedido do usuário, 14/10/2026): o feed de notícias da empresa, logo
 * depois do Início. Coluna principal com o compositor e os posts; à direita,
 * aniversariantes, tempo de casa, boas-vindas e os comunicados fixados.
 *
 * Leve de propósito: 20 posts por vez ("Carregar mais" busca os seguintes), e
 * a primeira página é relida a cada 2 minutos só com a janela à vista — no
 * servidor ela vem da memória compartilhada, não do banco.
 *
 * Fases 2 e 3 (14/10/2026): fichas de filtro no topo (Tudo, Comunicados, Do
 * campo, Eventos, Enquetes, Conquistas, Elogios) — cada uma é uma página
 * guardada à parte no servidor —, e "Do campo" pode ser visto em galeria.
 */

export const Route = createFileRoute("/mural")({
  head: () => ({
    meta: [
      { title: "Mural · SGL - CONECTA" },
      {
        name: "description",
        content: "Notícias, comunicados e aniversariantes da Larsil.",
      },
    ],
  }),
  component: MuralPage,
});

type Estado = {
  ativo: boolean | null;
  posts: PostDoMural[];
  fixados: PostDoMural[];
  proximo: CursorDoMural | null;
  destinatarios: number;
  souGerente: boolean;
  possoComunicar: boolean;
};

const INICIAL: Estado = {
  ativo: null,
  posts: [],
  fixados: [],
  proximo: null,
  destinatarios: 0,
  souGerente: false,
  possoComunicar: false,
};

const FICHAS: { id: FiltroDoMural; rotulo: string; icone: ReactNode; vazio: string }[] = [
  {
    id: "tudo",
    rotulo: "Tudo",
    icone: <Newspaper className="h-3.5 w-3.5" />,
    vazio:
      "Seja a primeira pessoa a publicar: uma conquista da equipe, uma foto do campo, um bom-dia.",
  },
  {
    id: "comunicado",
    rotulo: "Comunicados",
    icone: <Megaphone className="h-3.5 w-3.5" />,
    vazio: "Nenhum comunicado oficial por enquanto.",
  },
  {
    id: "campo",
    rotulo: "Do campo",
    icone: <TreePine className="h-3.5 w-3.5" />,
    vazio: 'Escolha "Do campo" no compositor e mande a primeira foto da operação.',
  },
  {
    id: "evento",
    rotulo: "Eventos",
    icone: <CalendarDays className="h-3.5 w-3.5" />,
    vazio: "Nenhum evento marcado. Que tal organizar um?",
  },
  {
    id: "enquete",
    rotulo: "Enquetes",
    icone: <Vote className="h-3.5 w-3.5" />,
    vazio: "Nenhuma enquete ainda. Pergunte alguma coisa para a turma!",
  },
  {
    id: "conquista",
    rotulo: "Conquistas",
    icone: <Trophy className="h-3.5 w-3.5" />,
    vazio: "As conquistas aparecem aqui sozinhas: pack em dia, recordes, time 100%…",
  },
  {
    id: "elogio",
    rotulo: "Elogios",
    icone: <HeartHandshake className="h-3.5 w-3.5" />,
    vazio: 'Ninguém foi agradecido ainda. Use "Agradecer alguém" no compositor.',
  },
];

function MuralPage() {
  const [estado, setEstado] = useState<Estado>(INICIAL);
  const [filtro, setFiltro] = useState<FiltroDoMural>("tudo");
  const [galeria, setGaleria] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [painel, setPainel] = useState<PainelDoMural | null>(null);
  const [destaque, setDestaque] = useState<string | null>(null);
  /** Post a mostrar assim que a página do filtro novo chegar (ver `abrirPost`). */
  const [procurando, setProcurando] = useState<string | null>(null);
  const vivoRef = useRef(true);
  const filtroRef = useRef<FiltroDoMural>("tudo");

  /** Relê a primeira página e junta com o que já foi carregado abaixo dela. */
  const carregarInicio = useCallback(async () => {
    const pedido = filtroRef.current;
    try {
      const { feedDoMural } = await import("@/lib/mural.functions");
      const r = await feedDoMural({ data: { filtro: pedido } });
      // A pessoa trocou de ficha enquanto esperava: esta resposta é de outra.
      if (!vivoRef.current || pedido !== filtroRef.current) return;
      setErro(null);
      if (!r.ativo) {
        setEstado({
          ...INICIAL,
          ativo: false,
          souGerente: r.souGerente,
          possoComunicar: r.possoComunicar,
        });
        return;
      }
      setEstado((atual) => {
        const ids = new Set(r.posts.map((p) => p.id));
        const ultimo = r.posts.at(-1)?.criadoEm ?? "";
        // O que já estava carregado das páginas seguintes continua lá.
        const resto = r.proximo
          ? atual.posts.filter((p) => !ids.has(p.id) && p.criadoEm < ultimo)
          : [];
        return {
          ativo: true,
          posts: [...r.posts, ...resto],
          fixados: r.fixados,
          proximo: resto.length ? atual.proximo : r.proximo,
          destinatarios: r.destinatarios,
          souGerente: r.souGerente,
          possoComunicar: r.possoComunicar,
        };
      });
    } catch (e) {
      if (vivoRef.current) setErro((e as Error)?.message || "Não foi possível carregar o mural.");
    }
  }, []);

  const carregarPainel = useCallback(async (forcar = false) => {
    try {
      const p = await carregarPainelDoMural(forcar);
      if (vivoRef.current) setPainel(p);
    } catch (e) {
      console.warn("[mural] painel:", (e as Error)?.message);
    }
  }, []);

  useEffect(() => {
    vivoRef.current = true;
    void carregarInicio();
    void carregarPainel();
    // Relê com a janela à vista; parada quando a pessoa está em outra coisa.
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void carregarInicio();
    }, 120_000);
    // Publicado por fora (o "Agradecer" da tarefa): relê o topo.
    const aoPublicarFora = () => void carregarInicio();
    window.addEventListener(EVENTO_MURAL_PUBLICADO, aoPublicarFora);
    return () => {
      vivoRef.current = false;
      window.clearInterval(id);
      window.removeEventListener(EVENTO_MURAL_PUBLICADO, aoPublicarFora);
    };
  }, [carregarInicio, carregarPainel]);

  const trocarFiltro = (f: FiltroDoMural) => {
    if (f === filtroRef.current) return;
    filtroRef.current = f;
    setFiltro(f);
    setErro(null);
    // Mantém quem é quem (gerência, comunicado); os posts são da ficha nova.
    setEstado((atual) => ({
      ...atual,
      ativo: atual.ativo === false ? false : null,
      posts: [],
      fixados: [],
      proximo: null,
    }));
    void carregarInicio();
  };

  const carregarMais = async () => {
    if (!estado.proximo || carregandoMais) return;
    setCarregandoMais(true);
    const pedido = filtroRef.current;
    try {
      const { feedDoMural } = await import("@/lib/mural.functions");
      const r = await feedDoMural({ data: { antes: estado.proximo, filtro: pedido } });
      if (!r.ativo || pedido !== filtroRef.current) return;
      setEstado((atual) => {
        const ids = new Set(atual.posts.map((p) => p.id));
        return {
          ...atual,
          posts: [...atual.posts, ...r.posts.filter((p) => !ids.has(p.id))],
          proximo: r.proximo,
        };
      });
    } catch (e) {
      toast.error("Não foi possível carregar mais.", { description: (e as Error)?.message });
    } finally {
      setCarregandoMais(false);
    }
  };

  const atualizar = async () => {
    setAtualizando(true);
    await Promise.all([carregarInicio(), carregarPainel(true)]);
    setAtualizando(false);
  };

  const mudarPost = (p: PostDoMural) =>
    setEstado((atual) => ({
      ...atual,
      posts: atual.posts.map((x) => (x.id === p.id ? p : x)),
      fixados: atual.fixados.map((x) => (x.id === p.id ? p : x)),
    }));
  const removerPost = (id: string) =>
    setEstado((atual) => ({
      ...atual,
      posts: atual.posts.filter((x) => x.id !== id),
      fixados: atual.fixados.filter((x) => x.id !== id),
    }));

  const rolarAte = useCallback((id: string): boolean => {
    const el = document.getElementById(`post-${id}`);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setDestaque(id);
    window.setTimeout(() => setDestaque((d) => (d === id ? null : d)), 2200);
    return true;
  }, []);

  /**
   * Leva até um post. Se ele não está na tela (um evento do painel lateral,
   * por exemplo), troca para a ficha do tipo dele e procura quando chegar.
   */
  const abrirPost = (id: string, tipo?: FiltroDoMural) => {
    if (galeria && filtro === "campo") setGaleria(false);
    if (rolarAte(id)) return;
    // Não achou em alguns segundos (post antigo, além da primeira página): desiste.
    window.setTimeout(() => setProcurando((p) => (p === id ? null : p)), 6000);
    if (tipo && tipo !== filtroRef.current) {
      setProcurando(id);
      trocarFiltro(tipo);
      return;
    }
    // O cartão pode estar só esperando a lista sair da galeria.
    setProcurando(id);
  };
  useEffect(() => {
    if (!procurando) return;
    const t = window.setTimeout(() => {
      if (rolarAte(procurando)) setProcurando(null);
    }, 60);
    return () => window.clearTimeout(t);
  }, [procurando, estado.posts, galeria, rolarAte]);

  const cartao = (p: PostDoMural) => (
    <CartaoDoPost
      key={p.id}
      post={p}
      destinatarios={estado.destinatarios}
      souGerente={estado.souGerente}
      aoMudar={mudarPost}
      aoRemover={removerPost}
      aoRecarregar={() => void carregarInicio()}
      destacado={destaque === p.id}
    />
  );

  const ficha = FICHAS.find((f) => f.id === filtro) ?? FICHAS[0];
  const verGaleria = filtro === "campo" && galeria;

  return (
    <FluxoLayout title="Mural">
      {/* Tela grande (19/10/2026: "aproveite os espaços em branco"): três
          colunas, como numa rede social — a empresa à esquerda, o feed no
          meio, as pessoas à direita. */}
      <div className="mx-auto w-full max-w-[1760px]">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-primary to-emerald-400 text-primary-foreground shadow-md shadow-primary/20">
              <Newspaper className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-2xl font-bold leading-tight tracking-tight">
                Mural
              </h1>
              <p className="text-sm text-muted-foreground">
                Notícias, comunicados e quem está de parabéns.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void atualizar()}
            disabled={atualizando}
            title="Atualizar"
            aria-label="Atualizar o mural"
            className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition hover:text-foreground disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${atualizando ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="grid gap-6 lg:max-xl:grid-cols-[minmax(0,1fr)_minmax(0,320px)] xl:grid-cols-[minmax(0,260px)_minmax(0,1fr)_minmax(0,300px)] 2xl:grid-cols-[minmax(0,300px)_minmax(0,1fr)_minmax(0,340px)]">
          <aside className="hidden min-w-0 xl:sticky xl:top-4 xl:block xl:self-start">
            <CartaoDeQuemVe />
            <div className="mt-4">
              <TrilhoDoMural
                parte="esquerda"
                painel={painel}
                fixados={estado.fixados}
                aoSalvarAniversario={() => void carregarPainel(true)}
                aoAbrirComunicado={(id) => abrirPost(id, "comunicado")}
                aoAbrirEvento={(id) => abrirPost(id, "evento")}
              />
            </div>
          </aside>
          <main className="min-w-0 space-y-4">
            {estado.ativo === false ? (
              <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
                <Sprout className="mx-auto h-9 w-9 text-primary/70" />
                <h2 className="mt-3 font-display text-lg font-semibold">{MSG_MURAL_INATIVO}</h2>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Falta só um ajuste no servidor. Assim que for liberado, as notícias aparecem aqui.
                </p>
              </div>
            ) : (
              <>
                <BlocoEntrada indice={0}>
                  <Compositor
                    possoComunicar={estado.possoComunicar}
                    aoPublicar={() => void carregarInicio()}
                  />
                </BlocoEntrada>

                {/* Fichas de filtro */}
                <div role="tablist" aria-label="Filtrar o mural" className="flex flex-wrap gap-1.5">
                  {FICHAS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      role="tab"
                      aria-selected={filtro === f.id}
                      onClick={() => trocarFiltro(f.id)}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                        filtro === f.id
                          ? "bg-foreground text-background shadow-sm"
                          : "bg-card text-muted-foreground shadow-sm ring-1 ring-border hover:text-foreground hover:ring-primary/40"
                      }`}
                    >
                      {f.icone} {f.rotulo}
                    </button>
                  ))}
                  {filtro === "campo" && (
                    <div className="ml-auto flex shrink-0 overflow-hidden rounded-full border border-border bg-card">
                      <button
                        type="button"
                        onClick={() => setGaleria(true)}
                        aria-pressed={galeria}
                        aria-label="Ver em galeria"
                        title="Galeria"
                        className={`px-2.5 py-1 ${galeria ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
                      >
                        <LayoutGrid className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setGaleria(false)}
                        aria-pressed={!galeria}
                        aria-label="Ver como lista"
                        title="Lista"
                        className={`px-2.5 py-1 ${!galeria ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
                      >
                        <List className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {erro && estado.ativo === null && (
                  <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                    {erro}{" "}
                    <button
                      type="button"
                      onClick={() => void carregarInicio()}
                      className="font-semibold underline"
                    >
                      Tentar de novo
                    </button>
                  </div>
                )}

                {estado.ativo === null && !erro && (
                  <div className="space-y-4">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="h-40 animate-pulse rounded-xl border border-border bg-card"
                      />
                    ))}
                  </div>
                )}

                {estado.fixados.length > 0 && (
                  <div className="space-y-4">{estado.fixados.map(cartao)}</div>
                )}

                {estado.ativo &&
                  estado.posts.length === 0 &&
                  estado.fixados.length === 0 &&
                  !verGaleria && (
                    <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
                      <Newspaper className="mx-auto h-9 w-9 text-muted-foreground/60" />
                      <h2 className="mt-3 font-display text-lg font-semibold">
                        {filtro === "tudo" ? "O mural está fresquinho" : "Nada por aqui ainda"}
                      </h2>
                      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                        {ficha.vazio}
                      </p>
                    </div>
                  )}

                {verGaleria && estado.ativo ? (
                  <GaleriaDoCampo posts={estado.posts} aoAbrirPost={(id) => abrirPost(id)} />
                ) : (
                  <div className="space-y-4">{estado.posts.map(cartao)}</div>
                )}

                {estado.proximo && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => void carregarMais()}
                      disabled={carregandoMais}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-60"
                    >
                      {carregandoMais && <Loader2 className="h-4 w-4 animate-spin" />} Carregar mais
                    </button>
                  </div>
                )}
                {estado.ativo && !estado.proximo && estado.posts.length > 5 && (
                  <p className="pb-4 text-center text-xs text-muted-foreground">
                    Você chegou ao começo do mural. 🌱
                  </p>
                )}
              </>
            )}
          </main>

          {/* Tela mais estreita (ou zoom alto): duas colunas, e o cartão de quem
              vê sobe para o topo da lateral — o Mural é o mesmo em 90% e 100%. */}
          <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start xl:hidden">
            <div className="mb-4 hidden lg:block">
              <CartaoDeQuemVe />
            </div>
            <TrilhoDoMural
              painel={painel}
              fixados={estado.fixados}
              aoSalvarAniversario={() => void carregarPainel(true)}
              aoAbrirComunicado={(id) => abrirPost(id, "comunicado")}
              aoAbrirEvento={(id) => abrirPost(id, "evento")}
            />
          </aside>
          <aside className="hidden min-w-0 xl:sticky xl:top-4 xl:block xl:self-start">
            <TrilhoDoMural
              parte="direita"
              painel={painel}
              fixados={estado.fixados}
              aoSalvarAniversario={() => void carregarPainel(true)}
              aoAbrirComunicado={(id) => abrirPost(id, "comunicado")}
              aoAbrirEvento={(id) => abrirPost(id, "evento")}
            />
          </aside>
        </div>
      </div>
    </FluxoLayout>
  );
}

/**
 * O cartão de quem está olhando, no alto da lateral esquerda (19/10/2026):
 * a capa na cor do setor, a foto, o nome e o cargo — e o próprio boneco
 * comemorando no canto. Dois atalhos: agradecer alguém e montar o avatar.
 */
function CartaoDeQuemVe() {
  const { currentUser } = useFluxo();
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  const setor = sectors.find((x) => x.id === currentUser.sector);
  const cor = setor?.color ?? "oklch(0.55 0.12 160)";
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div
        className="relative h-24 overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${cor}, color-mix(in oklch, ${cor} 40%, white))`,
        }}
      >
        <span className="absolute -left-6 -top-10 h-28 w-28 rounded-full bg-white/15" />
        <span className="absolute right-16 top-10 h-16 w-16 rounded-full bg-white/10" />
      </div>
      {montado && (
        <Suspense fallback={null}>
          <AvatarComemorando pessoa={currentUser.id} className="absolute right-0 top-2 h-36 w-36" />
        </Suspense>
      )}
      <div className="px-4 pb-4">
        <UserAvatar
          nome={currentUser.name}
          iniciais={currentUser.avatar}
          className="-mt-8 h-16 w-16 text-base shadow-md ring-4 ring-card"
        />
        <div className="mt-2 font-display text-base font-bold capitalize leading-tight">
          {currentUser.name.toLowerCase()}
        </div>
        <div className="text-xs text-muted-foreground first-letter:uppercase">
          {currentUser.jobTitle.toLowerCase()}
        </div>
        {setor && (
          <span
            className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
            style={{ background: cor }}
          >
            {setor.name}
          </span>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => abrirAgradecer()}
            className="inline-flex items-center justify-center gap-1 rounded-md border border-pink-400/40 bg-pink-500/[0.06] px-2 py-1.5 text-xs font-semibold text-pink-700 transition hover:bg-pink-500/10 dark:text-pink-300"
          >
            <HeartHandshake className="h-3.5 w-3.5" /> Agradecer
          </button>
          <a
            href="/configuracoes"
            className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-medium transition hover:bg-secondary"
          >
            🧍 Meu avatar
          </a>
        </div>
      </div>
    </div>
  );
}
