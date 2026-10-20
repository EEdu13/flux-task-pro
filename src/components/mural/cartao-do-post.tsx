import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  CalendarDays,
  CheckCircle2,
  Eye,
  HeartHandshake,
  ImagePlus,
  Loader2,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  PartyPopper,
  Pencil,
  Pin,
  PinOff,
  Send,
  Trash2,
  TreePine,
  Vote,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user-avatar";
import { BarraDeReacoes } from "@/components/reacoes-da-tarefa";
import { confirmar } from "@/components/confirm-dialog";
import { TextoDoPost } from "@/components/mural/texto-do-post";
import { LeiturasDoComunicadoDialog } from "@/components/mural/leituras-do-comunicado";
import { EnqueteDoPost } from "@/components/mural/enquete-do-post";
import { EventoDoPost } from "@/components/mural/evento-do-post";

/* O boneco de quem conquistou, comemorando (17/10/2026). Sob demanda: traz o three.js. */
const AvatarComemorando = lazy(() => import("@/components/mural/avatar-comemorando"));
/* O time abraçado no "Time 100%" (19/10/2026). Também sob demanda. */
const GrupoAbracado = lazy(() =>
  import("@/components/mural/avatar-comemorando").then((m) => ({ default: m.GrupoAbracado })),
);
import { mencionadosNoTexto, useMencoes } from "@/components/mural/mencoes";
import { useFluxo } from "@/lib/fluxo-store";
import { formatRelative } from "@/lib/use-theme";
import { openAttachment } from "@/lib/attachments";
import { reduzirFoto } from "@/lib/foto-reduzida";
import { subirAnexos } from "@/lib/anexo-upload";
import { nomeCurto } from "@/lib/nome-curto";
import {
  doCampoDataHora,
  ehErroDeMuralInativo,
  iniciaisDe,
  MSG_MURAL_INATIVO,
  paraCampoDataHora,
} from "@/lib/mural-cliente";
import { sectors, type Attachment } from "@/lib/fluxo-types";
import type {
  ComentarioDoMural,
  FotoDoPost,
  PostDoMural,
  SeloDaConquista,
} from "@/lib/mural.functions";

/*
 * Um post do Mural (14/10/2026): cabeçalho com autor e hora, texto, fotos em
 * grade, reações (a mesma barra das tarefas), comentários (2 à vista, "ver
 * mais" busca o resto) e, no comunicado, o "Li e estou ciente" e o "lido por
 * N de M" para quem publicou e para a gerência.
 *
 * Fases 2 e 3 (14/10/2026): cada tipo ganha o seu jeito —
 *   - conquista (automática, do "CONECTA"): cartão de festa, com o selo, o
 *     título e quem está sendo celebrado;
 *   - elogio: "Fulano agradeceu Beltrano pela entrega de 'X'";
 *   - evento: a folhinha com data, local e o "Vou participar";
 *   - enquete: a pergunta e as opções/resultado;
 *   - do campo: a etiqueta "Do campo".
 * Editar agora também tira e põe fotos, e o comentário aceita @menção.
 *
 * As mudanças aparecem na hora (otimistas) e o servidor confirma depois; se
 * ele recusar, o cartão volta ao que era e um aviso diz o porquê.
 */

const MAX_FOTOS = 4;

const erroAmigavel = (e: unknown, padrao: string) =>
  ehErroDeMuralInativo(e) ? MSG_MURAL_INATIVO : (e as Error)?.message || padrao;

/**
 * O fundo do banner de cada selo (19/10/2026, mural repaginado): cores vivas
 * e claras no tema claro, um véu da cor no escuro.
 */
const FUNDO_DO_SELO: Record<SeloDaConquista, string> = {
  pack: "from-orange-200 via-amber-100 to-rose-100 dark:from-orange-500/25 dark:via-amber-500/10 dark:to-transparent",
  setor:
    "from-amber-200 via-yellow-100 to-orange-100 dark:from-amber-500/25 dark:via-yellow-500/10 dark:to-transparent",
  recorde:
    "from-violet-200 via-fuchsia-100 to-pink-100 dark:from-violet-500/25 dark:via-fuchsia-500/10 dark:to-transparent",
  primeira:
    "from-emerald-200 via-teal-100 to-cyan-100 dark:from-emerald-500/25 dark:via-teal-500/10 dark:to-transparent",
  tempo_casa:
    "from-pink-200 via-rose-100 to-orange-100 dark:from-pink-500/25 dark:via-rose-500/10 dark:to-transparent",
  boas_vindas:
    "from-sky-200 via-cyan-100 to-indigo-100 dark:from-sky-500/25 dark:via-cyan-500/10 dark:to-transparent",
  aniversario:
    "from-fuchsia-200 via-pink-100 to-amber-100 dark:from-fuchsia-500/25 dark:via-pink-500/10 dark:to-transparent",
};

/** O desenho de cada selo de conquista: o emoji grande e a etiqueta. */
const SELOS: Record<SeloDaConquista, { emoji: string; rotulo: string; cor: string }> = {
  pack: { emoji: "🔥", rotulo: "Pack em dia", cor: "from-orange-500/20 via-amber-400/10" },
  setor: { emoji: "🏆", rotulo: "Time 100%", cor: "from-yellow-400/25 via-amber-300/10" },
  recorde: { emoji: "⚡", rotulo: "Recorde pessoal", cor: "from-violet-500/20 via-fuchsia-400/10" },
  primeira: { emoji: "✅", rotulo: "Primeira tarefa", cor: "from-emerald-500/20 via-teal-400/10" },
  tempo_casa: { emoji: "🎉", rotulo: "Tempo de casa", cor: "from-pink-500/20 via-rose-400/10" },
  boas_vindas: { emoji: "👋", rotulo: "Boas-vindas", cor: "from-sky-500/20 via-cyan-400/10" },
  aniversario: { emoji: "🎂", rotulo: "Aniversário", cor: "from-fuchsia-500/20 via-pink-400/10" },
};

function GradeDeFotos({ fotos }: { fotos: FotoDoPost[] }) {
  if (!fotos.length) return null;
  const abrir = (f: FotoDoPost) =>
    openAttachment({ dataUrl: f.url, name: f.nome, type: f.tipoMime, size: f.tamanho });
  const n = fotos.length;
  const grade =
    n === 1
      ? "grid-cols-1"
      : n === 2
        ? "grid-cols-2"
        : n === 3
          ? "grid-cols-2 grid-rows-2"
          : "grid-cols-2";
  return (
    <div className={`mt-3 grid gap-1 overflow-hidden rounded-lg ${grade}`}>
      {fotos.map((f, i) => (
        <button
          key={f.id}
          type="button"
          onClick={() => abrir(f)}
          className={`group relative overflow-hidden bg-secondary ${
            n === 1
              ? "max-h-[440px]"
              : n === 3 && i === 0
                ? "row-span-2 aspect-auto"
                : "aspect-square"
          }`}
          title={f.nome}
        >
          <img
            src={f.url}
            alt=""
            loading="lazy"
            className={`h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] ${
              n === 1 ? "max-h-[440px]" : ""
            }`}
          />
        </button>
      ))}
    </div>
  );
}

type FotoNova = { name: string; type: string; dataUrl: string };

/** As fotos durante a edição: as que ficam (com X para tirar) e as novas. */
function EditorDeFotos({
  atuais,
  novas,
  aoTirarAtual,
  aoTirarNova,
  aoEscolher,
  desabilitado,
}: {
  atuais: FotoDoPost[];
  novas: FotoNova[];
  aoTirarAtual: (id: string) => void;
  aoTirarNova: (i: number) => void;
  aoEscolher: (l: FileList | null) => void;
  desabilitado: boolean;
}) {
  const arquivoRef = useRef<HTMLInputElement>(null);
  const total = atuais.length + novas.length;
  const miniatura = (src: string, chave: string, tirar: () => void) => (
    <div
      key={chave}
      className="group relative h-20 w-20 overflow-hidden rounded-lg border border-border"
    >
      <img src={src} alt="" className="h-full w-full object-cover" />
      <button
        type="button"
        onClick={tirar}
        disabled={desabilitado}
        aria-label="Tirar foto"
        className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-90 hover:bg-black/80"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {atuais.map((f) => miniatura(f.url, f.id, () => aoTirarAtual(f.id)))}
      {novas.map((f, i) => miniatura(f.dataUrl, `nova-${i}`, () => aoTirarNova(i)))}
      <input
        ref={arquivoRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          aoEscolher(e.target.files);
          e.target.value = "";
        }}
      />
      {total < MAX_FOTOS && (
        <button
          type="button"
          onClick={() => arquivoRef.current?.click()}
          disabled={desabilitado}
          className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground disabled:opacity-50"
        >
          <ImagePlus className="h-4 w-4" /> Foto
        </button>
      )}
    </div>
  );
}

export function CartaoDoPost({
  post,
  destinatarios,
  souGerente,
  aoMudar,
  aoRemover,
  aoRecarregar,
  destacado = false,
}: {
  post: PostDoMural;
  destinatarios: number;
  souGerente: boolean;
  aoMudar: (p: PostDoMural) => void;
  aoRemover: (id: string) => void;
  aoRecarregar: () => void;
  destacado?: boolean;
}) {
  const { currentUser, users } = useFluxo();
  const autor = users.find((u) => u.id === post.autorId);
  const nomeAutor = post.automatico ? "CONECTA" : (autor?.name ?? "Alguém");
  const souAutor = !post.automatico && post.autorId === currentUser.id;
  const li = post.leitores.includes(currentUser.id);
  const ehConquista = post.tipo === "conquista";
  const selo = post.selo ? SELOS[post.selo] : null;

  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(post.texto);
  const [rascunhoTitulo, setRascunhoTitulo] = useState(post.titulo ?? "");
  const [rascunhoInicio, setRascunhoInicio] = useState("");
  const [rascunhoLocal, setRascunhoLocal] = useState("");
  const [fotosQueFicam, setFotosQueFicam] = useState<FotoDoPost[]>(post.fotos);
  const [fotosNovas, setFotosNovas] = useState<FotoNova[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [menu, setMenu] = useState(false);
  const [comentarios, setComentarios] = useState<ComentarioDoMural[] | null>(null);
  const [carregandoComentarios, setCarregandoComentarios] = useState(false);
  const [novoComentario, setNovoComentario] = useState("");
  const [comentando, setComentando] = useState(false);
  const [verLeituras, setVerLeituras] = useState(false);
  const [marcandoCiente, setMarcandoCiente] = useState(false);
  const mencoes = useMencoes<HTMLInputElement>({
    texto: novoComentario,
    setTexto: setNovoComentario,
    max: 1000,
    paraCima: true,
  });

  const listaDeComentarios = comentarios ?? post.comentarios;
  const faltamComentarios = post.totalComentarios - listaDeComentarios.length;

  const nomeDe = (id: string) => users.find((u) => u.id === id)?.name ?? "alguém";
  const homenageadosCurto = post.homenageados.map((id) => nomeCurto(nomeDe(id)));
  const juntarNomes = (l: string[]) =>
    l.length <= 1 ? (l[0] ?? "") : `${l.slice(0, -1).join(", ")} e ${l.at(-1)}`;

  /* ---- Ações ---- */

  const reagir = async (emoji: string | null) => {
    const antes = post;
    const outras = post.reacoes.filter((r) => r.userId !== currentUser.id);
    aoMudar({ ...post, reacoes: emoji ? [...outras, { userId: currentUser.id, emoji }] : outras });
    try {
      const { reagirNoPost } = await import("@/lib/mural.functions");
      await reagirNoPost({ data: { postId: post.id, emoji } });
    } catch (e) {
      aoMudar(antes);
      toast.error(erroAmigavel(e, "Não foi possível reagir."));
    }
  };

  const comecarEdicao = () => {
    setMenu(false);
    setRascunho(post.texto);
    setRascunhoTitulo(post.titulo ?? "");
    setRascunhoInicio(post.evento ? paraCampoDataHora(post.evento.inicio) : "");
    setRascunhoLocal(post.evento?.local ?? "");
    setFotosQueFicam(post.fotos);
    setFotosNovas([]);
    setEditando(true);
  };

  const escolherFotos = async (lista: FileList | null) => {
    if (!lista?.length) return;
    const vagas = MAX_FOTOS - fotosQueFicam.length - fotosNovas.length;
    const escolhidas = Array.from(lista).filter((f) => f.type.startsWith("image/"));
    if (escolhidas.length > vagas)
      toast.info(`Só cabem mais ${vagas} — as outras ficaram de fora.`);
    const novas: FotoNova[] = [];
    for (const f of escolhidas.slice(0, Math.max(0, vagas))) {
      try {
        novas.push(await reduzirFoto(f, 1600));
      } catch (e) {
        toast.error(`"${f.name}" não pôde ser lida.`, { description: (e as Error)?.message });
      }
    }
    setFotosNovas((atual) => [...atual, ...novas]);
  };

  const fotosNoRascunho = fotosQueFicam.length + fotosNovas.length;
  const podeSalvar =
    !salvando &&
    (rascunho.trim().length > 0 ||
      fotosNoRascunho > 0 ||
      post.tipo === "evento" ||
      post.tipo === "elogio") &&
    (post.tipo !== "evento" || (rascunhoTitulo.trim().length >= 3 && !!rascunhoInicio));

  const salvarEdicao = async () => {
    if (!podeSalvar) return;
    setSalvando(true);
    try {
      const { editarPostDoMural } = await import("@/lib/mural.functions");
      // Só manda data e local se mudaram: um evento antigo continua editável.
      const eventoMudou =
        !!post.evento &&
        (rascunhoInicio !== paraCampoDataHora(post.evento.inicio) ||
          rascunhoLocal.trim() !== (post.evento.local ?? ""));
      const inicioIso = eventoMudou ? doCampoDataHora(rascunhoInicio) : null;
      await editarPostDoMural({
        data: {
          id: post.id,
          texto: rascunho,
          titulo: rascunhoTitulo,
          evento: inicioIso ? { inicio: inicioIso, local: rascunhoLocal } : null,
        },
      });
      // As fotos: primeiro as que saíram, depois as novas (o limite é 4 no total).
      const ficam = new Set(fotosQueFicam.map((f) => f.id));
      const sairam = post.fotos.filter((f) => !ficam.has(f.id));
      let fotos = fotosQueFicam;
      if (sairam.length || fotosNovas.length) {
        const { removerFotoDoPost } = await import("@/lib/mural-interacoes.functions");
        for (const f of sairam) await removerFotoDoPost({ data: { fotoId: f.id } });
        if (fotosNovas.length) {
          const agora = new Date().toISOString();
          const anexos: Attachment[] = fotosNovas.map((f, i) => ({
            id: `foto-${i}`,
            name: f.name,
            type: f.type,
            size: 0,
            dataUrl: f.dataUrl,
            at: agora,
            userId: currentUser.id,
          }));
          const subiram = await subirAnexos("mural", post.id, anexos);
          fotos = [
            ...fotosQueFicam,
            ...subiram.map((a) => ({
              id: a.id,
              nome: a.name,
              tipoMime: a.type,
              tamanho: a.size,
              url: a.dataUrl,
            })),
          ];
        }
      }
      aoMudar({
        ...post,
        texto: rascunho.trim(),
        titulo:
          post.tipo === "comunicado" || post.tipo === "evento"
            ? rascunhoTitulo.trim() || post.titulo
            : post.titulo,
        evento:
          post.evento && inicioIso
            ? { ...post.evento, inicio: inicioIso, local: rascunhoLocal.trim() || null }
            : post.evento,
        fotos,
        editadoEm: new Date().toISOString(),
      });
      setEditando(false);
    } catch (e) {
      toast.error(erroAmigavel(e, "Não foi possível salvar."));
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async () => {
    setMenu(false);
    const ok = await confirmar({
      titulo: post.comunicado
        ? "Excluir este comunicado?"
        : ehConquista
          ? "Excluir esta conquista?"
          : "Excluir este post?",
      descricao: ehConquista
        ? "Ela some do mural para todo mundo (e não é gerada de novo)."
        : souAutor
          ? "Ele some do mural para todo mundo."
          : `O post de ${nomeAutor} some do mural para todo mundo.`,
      confirmar: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    try {
      const { excluirPostDoMural } = await import("@/lib/mural.functions");
      await excluirPostDoMural({ data: { id: post.id } });
      aoRemover(post.id);
      toast.success("Post excluído.");
    } catch (e) {
      toast.error(erroAmigavel(e, "Não foi possível excluir."));
    }
  };

  const fixar = async (fixar: boolean) => {
    setMenu(false);
    try {
      const { fixarComunicado } = await import("@/lib/mural.functions");
      await fixarComunicado({ data: { id: post.id, fixar } });
      toast.success(fixar ? "Fixado no topo do mural." : "Desafixado.");
      aoRecarregar();
    } catch (e) {
      toast.error(erroAmigavel(e, "Não foi possível fixar."));
    }
  };

  const verMaisComentarios = async () => {
    setCarregandoComentarios(true);
    try {
      const { comentariosDoPost } = await import("@/lib/mural.functions");
      const r = await comentariosDoPost({ data: { postId: post.id } });
      setComentarios(r.comentarios);
    } catch (e) {
      toast.error(erroAmigavel(e, "Não foi possível carregar os comentários."));
    } finally {
      setCarregandoComentarios(false);
    }
  };

  const comentar = async () => {
    const texto = novoComentario.trim();
    if (!texto || comentando) return;
    setComentando(true);
    try {
      const { comentarNoPost } = await import("@/lib/mural.functions");
      const c = await comentarNoPost({
        data: { postId: post.id, texto, mencoes: mencionadosNoTexto(texto, users) },
      });
      setNovoComentario("");
      if (comentarios) setComentarios([...comentarios, c]);
      aoMudar({
        ...post,
        comentarios: [...post.comentarios, c].slice(-2),
        totalComentarios: post.totalComentarios + 1,
      });
    } catch (e) {
      toast.error(erroAmigavel(e, "Não foi possível comentar."));
    } finally {
      setComentando(false);
    }
  };

  const excluirComentario = async (c: ComentarioDoMural) => {
    const ok = await confirmar({
      titulo: "Excluir este comentário?",
      confirmar: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    try {
      const { excluirComentarioDoMural } = await import("@/lib/mural.functions");
      await excluirComentarioDoMural({ data: { id: c.id } });
      if (comentarios) setComentarios(comentarios.filter((x) => x.id !== c.id));
      aoMudar({
        ...post,
        comentarios: post.comentarios.filter((x) => x.id !== c.id),
        totalComentarios: Math.max(0, post.totalComentarios - 1),
      });
    } catch (e) {
      toast.error(erroAmigavel(e, "Não foi possível excluir."));
    }
  };

  const ciente = async () => {
    setMarcandoCiente(true);
    try {
      const { marcarCiente } = await import("@/lib/mural.functions");
      await marcarCiente({ data: { postId: post.id } });
      aoMudar({ ...post, leitores: [...post.leitores, currentUser.id] });
    } catch (e) {
      toast.error(erroAmigavel(e, "Não foi possível marcar agora."));
    } finally {
      setMarcandoCiente(false);
    }
  };

  const podeMenu = souAutor || souGerente;
  const menuDoPost = (
    <Popover open={menu} onOpenChange={setMenu}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Opções do post"
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-[460] w-48 rounded-xl p-1">
        {souAutor && (
          <button
            type="button"
            onClick={comecarEdicao}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-secondary"
          >
            <Pencil className="h-3.5 w-3.5" /> Editar
          </button>
        )}
        {souGerente && post.comunicado && (
          <button
            type="button"
            onClick={() => void fixar(!post.fixado)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-secondary"
          >
            {post.fixado ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {post.fixado ? "Desafixar" : "Fixar no topo"}
          </button>
        )}
        <button
          type="button"
          onClick={() => void excluir()}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" /> Excluir
        </button>
      </PopoverContent>
    </Popover>
  );

  /** A etiqueta do tipo, ao lado da hora. */
  const etiqueta =
    post.tipo === "campo" ? (
      <span className="inline-flex items-center gap-0.5 font-medium text-emerald-700 dark:text-emerald-300">
        <TreePine className="h-3 w-3" /> Do campo
      </span>
    ) : post.tipo === "evento" ? (
      <span className="inline-flex items-center gap-0.5 font-medium text-sky-700 dark:text-sky-300">
        <CalendarDays className="h-3 w-3" /> Evento
      </span>
    ) : post.tipo === "enquete" ? (
      <span className="inline-flex items-center gap-0.5 font-medium text-violet-700 dark:text-violet-300">
        <Vote className="h-3 w-3" /> Enquete
      </span>
    ) : ehConquista && selo ? (
      <span className="font-medium text-amber-700 dark:text-amber-300">{selo.rotulo}</span>
    ) : null;

  return (
    <article
      id={`post-${post.id}`}
      className={`relative rounded-xl border bg-card shadow-sm transition ${
        post.comunicado
          ? "border-warning/50 bg-gradient-to-b from-warning/[0.07] to-card"
          : ehConquista
            ? "overflow-hidden border-border"
            : post.tipo === "elogio"
              ? "border-pink-400/40 bg-gradient-to-br from-pink-500/[0.07] to-card"
              : "border-border"
      } ${destacado ? "ring-2 ring-primary/60" : ""}`}
    >
      {post.comunicado && (
        <div className="flex items-center gap-2 rounded-t-xl border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
          <Megaphone className="h-3.5 w-3.5" /> Comunicado oficial
          {post.fixado && (
            <span className="ml-auto inline-flex items-center gap-1 normal-case tracking-normal">
              <Pin className="h-3 w-3" /> Fixado
            </span>
          )}
        </div>
      )}

      <div className="relative p-4">
        {/* Conquista: o banner de comemoração no lugar do cabeçalho (19/10/2026). */}
        {ehConquista && !editando && (
          <BannerDaConquista
            selo={post.selo}
            titulo={post.titulo}
            texto={post.texto}
            homenageados={post.homenageados}
            users={users}
            nomeDe={nomeDe}
            criadoEm={post.criadoEm}
            menu={podeMenu ? menuDoPost : null}
          />
        )}
        {/* Cabeçalho */}
        <div className={`flex items-start gap-3 ${ehConquista ? "hidden" : ""}`}>
          {post.automatico ? (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-pink-500 text-white shadow-sm">
              <PartyPopper className="h-6 w-6" />
            </span>
          ) : (
            <UserAvatar
              nome={nomeAutor}
              iniciais={autor?.avatar ?? iniciaisDe(nomeAutor)}
              className="h-12 w-12 text-sm ring-2 ring-card shadow-sm"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold leading-tight">
              {post.tipo === "elogio" && post.homenageados.length > 0 ? (
                <span>
                  {nomeAutor} <span className="font-normal text-muted-foreground">agradeceu</span>{" "}
                  {juntarNomes(homenageadosCurto)}
                </span>
              ) : (
                <span className="truncate">{nomeAutor}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-1 truncate text-[11px] text-muted-foreground">
              {!post.automatico && autor?.jobTitle ? `${autor.jobTitle} · ` : ""}
              <time
                dateTime={post.criadoEm}
                title={new Date(post.criadoEm).toLocaleString("pt-BR")}
              >
                {formatRelative(post.criadoEm)}
              </time>
              {post.editadoEm && " · editado"}
              {etiqueta && <span aria-hidden>·</span>}
              {etiqueta}
            </div>
          </div>
          {podeMenu && !editando && menuDoPost}
        </div>

        {/* Corpo */}
        {editando ? (
          <div className="mt-3 space-y-2">
            {(post.tipo === "comunicado" || post.tipo === "evento") && (
              <input
                value={rascunhoTitulo}
                onChange={(e) => setRascunhoTitulo(e.target.value.slice(0, 160))}
                placeholder={post.tipo === "evento" ? "Nome do evento" : "Título"}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}
            {post.tipo === "evento" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="datetime-local"
                  value={rascunhoInicio}
                  onChange={(e) => setRascunhoInicio(e.target.value)}
                  aria-label="Data e hora do evento"
                  className="input w-full"
                />
                <input
                  value={rascunhoLocal}
                  onChange={(e) => setRascunhoLocal(e.target.value.slice(0, 160))}
                  placeholder="Local (opcional)"
                  className="input w-full"
                />
              </div>
            )}
            <textarea
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value.slice(0, 4000))}
              rows={4}
              autoFocus
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {post.tipo !== "enquete" && (
              <EditorDeFotos
                atuais={fotosQueFicam}
                novas={fotosNovas}
                aoTirarAtual={(id) => setFotosQueFicam((l) => l.filter((f) => f.id !== id))}
                aoTirarNova={(i) => setFotosNovas((l) => l.filter((_, j) => j !== i))}
                aoEscolher={(l) => void escolherFotos(l)}
                desabilitado={salvando}
              />
            )}
            {post.tipo === "enquete" && post.enquete && post.enquete.total > 0 && (
              <p className="text-[11px] text-muted-foreground">
                A pergunta não muda depois do primeiro voto — só o resto do texto.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditando(false)}
                disabled={salvando}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void salvarEdicao()}
                disabled={!podeSalvar}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
              >
                {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Salvar
              </button>
            </div>
          </div>
        ) : ehConquista ? null : (
          <>
            {post.tipo === "elogio" && post.homenageados.length > 0 && (
              <div className="mt-3">
                <PessoasEmDestaque
                  ids={post.homenageados}
                  users={users}
                  nomeDe={nomeDe}
                  selo="💖"
                />
              </div>
            )}
            {post.tipo === "elogio" && post.tarefa && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-pink-400/30 bg-pink-500/[0.06] px-3 py-2 text-sm">
                <HeartHandshake className="h-4 w-4 shrink-0 text-pink-600 dark:text-pink-300" />
                <span className="min-w-0">
                  pela entrega de <span className="font-semibold">“{post.tarefa.titulo}”</span>
                </span>
              </div>
            )}
            {(post.comunicado || post.tipo === "evento") && post.titulo && (
              <h3 className="mt-3 font-display text-lg font-bold leading-snug">{post.titulo}</h3>
            )}
            <TextoDoPost
              texto={post.texto}
              users={users}
              className={`mt-2 text-sm leading-relaxed ${
                post.tipo === "enquete" ? "font-semibold" : ""
              }`}
            />
          </>
        )}

        {!editando && <GradeDeFotos fotos={post.fotos} />}

        {!editando && post.evento && (
          <EventoDoPost
            postId={post.id}
            evento={post.evento}
            aoMudar={(evento) => aoMudar({ ...post, evento })}
          />
        )}

        {post.enquete && (
          <EnqueteDoPost
            postId={post.id}
            enquete={post.enquete}
            podeEncerrar={souAutor || souGerente}
            aoMudar={(enquete) => aoMudar({ ...post, enquete })}
          />
        )}

        {/* Comunicado: ciência e leituras */}
        {post.comunicado && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!souAutor &&
              (li ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Você está ciente
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void ciente()}
                  disabled={marcandoCiente}
                  className="inline-flex items-center gap-1.5 rounded-md bg-warning px-3 py-1.5 text-xs font-semibold text-amber-950 shadow-sm transition hover:brightness-110 disabled:opacity-60"
                >
                  {marcandoCiente ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Li e estou ciente
                </button>
              ))}
            {(souAutor || souGerente) && (
              <button
                type="button"
                onClick={() => setVerLeituras(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <Eye className="h-3.5 w-3.5" /> Lido por {post.leitores.length} de{" "}
                {Math.max(destinatarios - 1, post.leitores.length)}
              </button>
            )}
          </div>
        )}

        {/* Reações e contagem de comentários */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
          <BarraDeReacoes reacoes={post.reacoes} aoReagir={(e) => void reagir(e)} compacto />
          {post.totalComentarios > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <MessageCircle className="h-3.5 w-3.5" /> {post.totalComentarios}{" "}
              {post.totalComentarios === 1 ? "comentário" : "comentários"}
            </span>
          )}
        </div>

        {/* Comentários */}
        {faltamComentarios > 0 && (
          <button
            type="button"
            onClick={() => void verMaisComentarios()}
            disabled={carregandoComentarios}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {carregandoComentarios && <Loader2 className="h-3 w-3 animate-spin" />}
            Ver mais {faltamComentarios} {faltamComentarios === 1 ? "comentário" : "comentários"}
          </button>
        )}
        {listaDeComentarios.length > 0 && (
          <ul className="mt-2 space-y-2">
            {listaDeComentarios.map((c) => {
              const u = users.find((x) => x.id === c.autorId);
              const nome = u?.name ?? "Alguém";
              const podeExcluir = c.autorId === currentUser.id || souGerente;
              return (
                <li key={c.id} className="group flex gap-2">
                  <UserAvatar
                    nome={nome}
                    iniciais={u?.avatar ?? iniciaisDe(nome)}
                    className="h-7 w-7 text-[9px]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="inline-block max-w-full rounded-2xl bg-secondary/70 px-3 py-1.5">
                      <div className="text-xs font-semibold">{nome}</div>
                      <TextoDoPost texto={c.texto} users={users} className="text-sm" />
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 pl-3 text-[10px] text-muted-foreground">
                      {formatRelative(c.em)}
                      {podeExcluir && (
                        <button
                          type="button"
                          onClick={() => void excluirComentario(c)}
                          className="opacity-0 transition hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-3 flex items-center gap-2">
          <UserAvatar
            nome={currentUser.name}
            iniciais={currentUser.avatar}
            className="h-7 w-7 text-[9px]"
          />
          <div className="relative flex min-w-0 flex-1 items-center rounded-full border border-border bg-background pr-1 focus-within:ring-2 focus-within:ring-ring">
            <input
              ref={mencoes.campoRef}
              value={novoComentario}
              onChange={(e) => {
                setNovoComentario(e.target.value.slice(0, 1000));
                mencoes.aoMudar(e.target.value, e.target.selectionStart);
              }}
              onKeyDown={(e) => {
                if (mencoes.aoTeclar(e)) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void comentar();
                }
              }}
              onBlur={mencoes.fechar}
              placeholder="Escreva um comentário… (@ para marcar alguém)"
              className="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-sm focus:outline-none"
            />
            {mencoes.lista}
            {novoComentario && (
              <button
                type="button"
                onClick={() => setNovoComentario("")}
                aria-label="Limpar"
                className="rounded-full p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void comentar()}
              disabled={!novoComentario.trim() || comentando}
              aria-label="Enviar comentário"
              className="rounded-full p-1.5 text-primary transition hover:bg-primary/10 disabled:opacity-40"
            >
              {comentando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {verLeituras && (
        <LeiturasDoComunicadoDialog
          postId={post.id}
          titulo={post.titulo ?? "Comunicado"}
          aoFechar={() => setVerLeituras(false)}
        />
      )}
    </article>
  );
}

/**
 * As pessoas homenageadas (conquista, elogio) em destaque: foto grande com um
 * selo, nome em fonte grande e o cargo embaixo. Até 6 lado a lado; uma só
 * ganha o tamanho maior.
 */
function PessoasEmDestaque({
  ids,
  users,
  nomeDe,
  selo,
}: {
  ids: string[];
  users: { id: string; avatar?: string; jobTitle?: string }[];
  nomeDe: (id: string) => string;
  selo: string;
}) {
  const uma = ids.length === 1;
  const mostrar = ids.slice(0, 6);
  return (
    <div className={uma ? "" : "flex flex-wrap gap-4"}>
      {mostrar.map((id) => {
        const nome = nomeDe(id);
        const u = users.find((x) => x.id === id);
        return (
          <div key={id} className={`flex items-center gap-3 ${uma ? "" : "min-w-0"}`}>
            <span className="relative shrink-0">
              <UserAvatar
                nome={nome}
                iniciais={u?.avatar ?? iniciaisDe(nome)}
                className={`${uma ? "h-20 w-20 text-xl" : "h-14 w-14 text-base"} shadow-md ring-4 ring-card`}
              />
              <span
                aria-hidden
                className={`absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-card shadow ring-2 ring-amber-300/70 ${uma ? "h-8 w-8 text-lg" : "h-6 w-6 text-sm"}`}
              >
                {selo}
              </span>
            </span>
            <span className="min-w-0">
              <span
                className={`block truncate font-display font-bold leading-tight ${uma ? "text-xl" : "text-base"}`}
              >
                {nomeCurto(nome)}
              </span>
              {u?.jobTitle && (
                <span className="block truncate text-xs text-muted-foreground">{u.jobTitle}</span>
              )}
            </span>
          </div>
        );
      })}
      {ids.length > mostrar.length && (
        <span className="self-center text-sm font-semibold text-muted-foreground">
          +{ids.length - mostrar.length}
        </span>
      )}
    </div>
  );
}

/** Monta os filhos só depois de hidratar: o servidor não tem WebGL. */
function SoNoNavegador({ children }: { children: React.ReactNode }) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  return montado ? <>{children}</> : null;
}

/**
 * O banner de uma conquista (19/10/2026: "o mural tá muito feio ainda"): a
 * faixa colorida do selo no alto do cartão, com a etiqueta e a hora, o título
 * grande, o texto e as pessoas — e, à direita, quem conquistou comemorando
 * (o avatar 3D em foto) ou, numa conquista de time, o selo grande flutuando.
 */
function BannerDaConquista({
  selo,
  titulo,
  texto,
  homenageados,
  users,
  nomeDe,
  criadoEm,
  menu,
}: {
  selo: SeloDaConquista | null;
  titulo: string | null;
  texto: string;
  homenageados: string[];
  users: { id: string; avatar?: string; jobTitle?: string }[];
  nomeDe: (id: string) => string;
  criadoEm: string;
  menu: ReactNode;
}) {
  const s = selo ? SELOS[selo] : null;
  const fundo = selo ? FUNDO_DO_SELO[selo] : FUNDO_DO_SELO.setor;
  const pessoa = homenageados[0];
  /* Time 100%: a foto de grupo, todo mundo abraçado (19/10/2026). Os posts da
     regra nova trazem o time em `homenageados`; os antigos não — aí o time sai
     do nome do setor no título ("Time de PCP bateu…"), com quem é do setor hoje. */
  const { users: todos } = useFluxo();
  const equipe =
    selo !== "setor"
      ? []
      : homenageados.length > 1
        ? homenageados
        : (() => {
            const nome = /Time de (.+?) bateu/
              .exec(titulo ?? "")?.[1]
              ?.trim()
              .toLowerCase();
            const setor = sectors.find((x) => x.name.toLowerCase() === nome);
            return setor ? todos.filter((u) => u.sector === setor.id).map((u) => u.id) : [];
          })();
  const timeAbracado = equipe.length > 1;
  return (
    <div
      className={`relative -mx-4 -mt-4 overflow-hidden bg-gradient-to-br px-5 pb-5 pt-4 ${fundo}`}
    >
      {/* bolhas e confetes de fundo, bem leves */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/40 dark:bg-white/5"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-white/30 dark:bg-white/5"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50 [background-image:radial-gradient(circle,rgba(255,255,255,0.9)_1.5px,transparent_1.6px)] [background-size:22px_22px] dark:opacity-10"
      />

      <div className="relative flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-bold text-foreground shadow-sm backdrop-blur dark:bg-black/30">
          <span aria-hidden>{s?.emoji ?? "🏅"}</span>
          {s?.rotulo ?? "Conquista"}
        </span>
        <span className="text-[11px] font-medium text-foreground/60">
          CONECTA ·{" "}
          <time dateTime={criadoEm} title={new Date(criadoEm).toLocaleString("pt-BR")}>
            {formatRelative(criadoEm)}
          </time>
        </span>
        <span className="ml-auto">{menu}</span>
      </div>

      <div className="relative mt-3 grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          {homenageados.length > 0 && (
            <div className="mb-3">
              <PessoasEmDestaque
                ids={homenageados}
                users={users}
                nomeDe={nomeDe}
                selo={s?.emoji ?? "🏅"}
              />
            </div>
          )}
          {titulo && (
            <h3 className="font-display text-xl font-extrabold leading-snug tracking-tight">
              {titulo}
            </h3>
          )}
          <TextoDoPost
            texto={texto}
            users={users as never}
            className="mt-1 text-sm leading-relaxed text-foreground/80"
          />
        </div>
        <div className={`hidden shrink-0 sm:block ${timeAbracado ? "h-36" : "h-36 w-36"}`}>
          {timeAbracado ? (
            <SoNoNavegador>
              <Suspense fallback={null}>
                <GrupoAbracado pessoas={equipe} className="h-36" />
              </Suspense>
            </SoNoNavegador>
          ) : pessoa ? (
            <SoNoNavegador>
              <Suspense fallback={null}>
                <AvatarComemorando pessoa={pessoa} className="h-36 w-36" />
              </Suspense>
            </SoNoNavegador>
          ) : (
            <motion.span
              aria-hidden
              className="grid h-36 w-36 select-none place-items-center text-[96px] leading-none drop-shadow-[0_10px_18px_rgba(0,0,0,0.18)]"
              animate={{ y: [0, -6, 0], rotate: [-3, 3, -3] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            >
              {s?.emoji ?? "🏆"}
            </motion.span>
          )}
        </div>
      </div>
    </div>
  );
}
