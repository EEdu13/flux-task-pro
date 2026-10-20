import { useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  HeartHandshake,
  ImagePlus,
  Loader2,
  Megaphone,
  PenLine,
  Plus,
  Send,
  TreePine,
  Vote,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { AgradecerDialog } from "@/components/mural/agradecer";
import { mencionadosNoTexto, useMencoes } from "@/components/mural/mencoes";
import { useFluxo } from "@/lib/fluxo-store";
import { reduzirFoto } from "@/lib/foto-reduzida";
import { subirAnexos } from "@/lib/anexo-upload";
import { doCampoDataHora, ehErroDeMuralInativo, MSG_MURAL_INATIVO } from "@/lib/mural-cliente";
import type { Attachment } from "@/lib/fluxo-types";
import type { EntradaDoPost } from "@/lib/mural.functions";

/*
 * Onde se escreve no Mural (14/10/2026): texto, até 4 fotos e, para a
 * gerência e o RH, a chave "Comunicado oficial" (com título).
 *
 * Fases 2 e 3 (14/10/2026): o compositor escolhe o tipo do post —
 *   Post · Do campo (com foto) · Evento (data, hora, local) · Enquete (2 a 6
 *   opções, com fim opcional) · Comunicado (gerência e RH) —
 * e tem o "Agradecer alguém", que abre a janela de elogio.
 *
 * "@" abre a lista de pessoas; escolher alguém escreve "@Nome" no texto, e a
 * pessoa recebe um aviso. As fotos são reduzidas no navegador (lado maior de
 * 1600 px) e sobem pela mesma porta dos anexos de tarefa, depois que o post
 * existe — o post é o dono delas.
 */

const MAX_FOTOS = 4;
const MAX_TEXTO = 4000;
const MAX_OPCOES = 6;

type Foto = { name: string; type: string; dataUrl: string };
type Tipo = "geral" | "campo" | "evento" | "enquete" | "comunicado";

const PLACEHOLDER: Record<Tipo, string> = {
  geral: "Compartilhe uma novidade com a turma… (use @ para marcar alguém)",
  campo: "Conte o que está acontecendo no campo…",
  evento: "Detalhes do evento (opcional)…",
  enquete: "Qual é a pergunta?",
  comunicado: "Escreva o comunicado…",
};

export function Compositor({
  possoComunicar,
  aoPublicar,
}: {
  possoComunicar: boolean;
  aoPublicar: () => void;
}) {
  const { currentUser, users } = useFluxo();
  const [tipo, setTipo] = useState<Tipo>("geral");
  const [texto, setTexto] = useState("");
  const [titulo, setTitulo] = useState("");
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [inicio, setInicio] = useState("");
  const [local, setLocal] = useState("");
  const [opcoes, setOpcoes] = useState<string[]>(["", ""]);
  const [fimEnquete, setFimEnquete] = useState("");
  const [publicando, setPublicando] = useState(false);
  const [focado, setFocado] = useState(false);
  const [agradecendo, setAgradecendo] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const mencoes = useMencoes<HTMLTextAreaElement>({ texto, setTexto, max: MAX_TEXTO });

  const comunicado = tipo === "comunicado";
  const aceitaFotos = tipo !== "enquete";

  const escolherFotos = async (lista: FileList | null) => {
    if (!lista?.length) return;
    const vagas = MAX_FOTOS - fotos.length;
    if (vagas <= 0) {
      toast.info(`No máximo ${MAX_FOTOS} fotos por post.`);
      return;
    }
    const escolhidas = Array.from(lista).filter((f) => f.type.startsWith("image/"));
    if (escolhidas.length > vagas)
      toast.info(`Só cabem mais ${vagas} — as outras ficaram de fora.`);
    const novas: Foto[] = [];
    for (const f of escolhidas.slice(0, vagas)) {
      try {
        novas.push(await reduzirFoto(f, 1600));
      } catch (e) {
        toast.error(`"${f.name}" não pôde ser lida.`, { description: (e as Error)?.message });
      }
    }
    setFotos((atual) => [...atual, ...novas].slice(0, MAX_FOTOS));
  };

  const opcoesPreenchidas = opcoes.map((o) => o.trim()).filter(Boolean);
  const podePublicar =
    !publicando &&
    (tipo === "geral"
      ? texto.trim().length > 0 || fotos.length > 0
      : tipo === "campo"
        ? fotos.length > 0
        : tipo === "comunicado"
          ? titulo.trim().length >= 3 && (texto.trim().length > 0 || fotos.length > 0)
          : tipo === "evento"
            ? titulo.trim().length >= 3 && !!doCampoDataHora(inicio)
            : texto.trim().length >= 3 && opcoesPreenchidas.length >= 2);

  /** O que falta para publicar — a dica ao lado do botão. */
  const falta =
    tipo === "campo" && !fotos.length
      ? "Escolha pelo menos uma foto."
      : tipo === "evento" && (!titulo.trim() || !inicio)
        ? "Dê um nome e a data do evento."
        : tipo === "enquete" && opcoesPreenchidas.length < 2
          ? "A enquete precisa de 2 opções."
          : null;

  const limpar = () => {
    setTexto("");
    setTitulo("");
    setFotos([]);
    setInicio("");
    setLocal("");
    setOpcoes(["", ""]);
    setFimEnquete("");
    setTipo("geral");
    setFocado(false);
  };

  const publicar = async () => {
    if (!podePublicar) return;
    setPublicando(true);
    try {
      const { publicarNoMural } = await import("@/lib/mural.functions");
      const fotosDoPost = aceitaFotos ? fotos : [];
      const dados: EntradaDoPost = {
        texto,
        tipo,
        titulo: comunicado || tipo === "evento" ? titulo : undefined,
        mencoes: mencionadosNoTexto(texto, users),
        comFotos: fotosDoPost.length > 0,
        evento: tipo === "evento" ? { inicio: doCampoDataHora(inicio) ?? "", local } : undefined,
        enquete:
          tipo === "enquete"
            ? { opcoes: opcoesPreenchidas, fim: doCampoDataHora(fimEnquete) }
            : undefined,
      };
      const { id } = await publicarNoMural({ data: dados });
      if (fotosDoPost.length) {
        const agora = new Date().toISOString();
        const anexos: Attachment[] = fotosDoPost.map((f, i) => ({
          id: `foto-${i}`,
          name: f.name,
          type: f.type,
          size: 0,
          dataUrl: f.dataUrl,
          at: agora,
          userId: currentUser.id,
        }));
        await subirAnexos("mural", id, anexos);
      }
      const era = tipo;
      limpar();
      toast.success(
        era === "comunicado"
          ? "Comunicado publicado — todos foram avisados."
          : era === "enquete"
            ? "Enquete publicada!"
            : era === "evento"
              ? "Evento publicado!"
              : "Publicado no mural!",
      );
      aoPublicar();
    } catch (e) {
      toast.error(ehErroDeMuralInativo(e) ? MSG_MURAL_INATIVO : "Não foi possível publicar.", {
        description: ehErroDeMuralInativo(e) ? undefined : (e as Error)?.message,
      });
    } finally {
      setPublicando(false);
    }
  };

  const aberto = focado || texto.length > 0 || fotos.length > 0 || tipo !== "geral";

  const botaoDeTipo = (t: Tipo, icone: ReactNode, rotulo: string, cor: string) => (
    <button
      type="button"
      onClick={() => setTipo(t)}
      aria-pressed={tipo === t}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
        tipo === t ? cor : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      }`}
    >
      {icone} {rotulo}
    </button>
  );

  return (
    <section
      className={`rounded-xl border bg-card p-4 shadow-sm transition ${
        comunicado ? "border-warning/60" : "border-border"
      }`}
    >
      <div className="flex gap-3">
        <UserAvatar
          nome={currentUser.name}
          iniciais={currentUser.avatar}
          className="h-10 w-10 text-xs"
        />
        <div className="relative min-w-0 flex-1">
          {(comunicado || tipo === "evento") && (
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value.slice(0, 160))}
              placeholder={comunicado ? "Título do comunicado" : "Nome do evento"}
              className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          {tipo === "evento" && (
            <div className="mb-2 grid gap-2 sm:grid-cols-2">
              <label className="text-[11px] text-muted-foreground">
                Quando
                <input
                  type="datetime-local"
                  value={inicio}
                  onChange={(e) => setInicio(e.target.value)}
                  className="input mt-0.5 w-full"
                />
              </label>
              <label className="text-[11px] text-muted-foreground">
                Onde (opcional)
                <input
                  value={local}
                  onChange={(e) => setLocal(e.target.value.slice(0, 160))}
                  placeholder="Ex.: refeitório da sede"
                  className="input mt-0.5 w-full"
                />
              </label>
            </div>
          )}
          <textarea
            ref={mencoes.campoRef}
            value={texto}
            onFocus={() => setFocado(true)}
            onPaste={(e) => {
              /* Colar imagem (Ctrl+V de um print) vira foto do post (17/10/2026);
                 texto colado segue normal. */
              const imagens = Array.from(e.clipboardData.files).filter((f) =>
                f.type.startsWith("image/"),
              );
              if (!imagens.length) return;
              e.preventDefault();
              if (!aceitaFotos) {
                toast.info("Enquete não leva foto.");
                return;
              }
              const lista = new DataTransfer();
              imagens.forEach((f) => lista.items.add(f));
              void escolherFotos(lista.files);
            }}
            onChange={(e) => {
              setTexto(e.target.value.slice(0, MAX_TEXTO));
              mencoes.aoMudar(e.target.value, e.target.selectionStart);
            }}
            onKeyDown={(e) => {
              if (mencoes.aoTeclar(e)) return;
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void publicar();
              }
            }}
            onBlur={mencoes.fechar}
            rows={aberto ? 3 : 1}
            placeholder={PLACEHOLDER[tipo]}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {mencoes.lista}

          {tipo === "enquete" && (
            <div className="mt-2 space-y-1.5">
              {opcoes.map((o, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/50" />
                  <input
                    value={o}
                    onChange={(e) =>
                      setOpcoes((l) =>
                        l.map((x, j) => (j === i ? e.target.value.slice(0, 120) : x)),
                      )
                    }
                    placeholder={`Opção ${i + 1}`}
                    className="input min-w-0 flex-1"
                  />
                  {opcoes.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setOpcoes((l) => l.filter((_, j) => j !== i))}
                      aria-label={`Tirar a opção ${i + 1}`}
                      className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {opcoes.length < MAX_OPCOES ? (
                  <button
                    type="button"
                    onClick={() => setOpcoes((l) => [...l, ""])}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" /> Mais uma opção
                  </button>
                ) : (
                  <span />
                )}
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  Encerra em (opcional)
                  <input
                    type="datetime-local"
                    value={fimEnquete}
                    onChange={(e) => setFimEnquete(e.target.value)}
                    className="input w-auto py-1 text-xs"
                  />
                </label>
              </div>
            </div>
          )}

          {aceitaFotos && fotos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {fotos.map((f, i) => (
                <div
                  key={i}
                  className="group relative h-20 w-20 overflow-hidden rounded-lg border border-border"
                >
                  <img src={f.dataUrl} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setFotos((l) => l.filter((_, j) => j !== i))}
                    aria-label="Tirar foto"
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-90 hover:bg-black/80"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {aberto && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/60 pt-2">
                {botaoDeTipo(
                  "geral",
                  <PenLine className="h-4 w-4" />,
                  "Post",
                  "bg-primary/10 text-primary",
                )}
                {botaoDeTipo(
                  "campo",
                  <TreePine className="h-4 w-4" />,
                  "Do campo",
                  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                )}
                {botaoDeTipo(
                  "evento",
                  <CalendarDays className="h-4 w-4" />,
                  "Evento",
                  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
                )}
                {botaoDeTipo(
                  "enquete",
                  <Vote className="h-4 w-4" />,
                  "Enquete",
                  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
                )}
                {possoComunicar &&
                  botaoDeTipo(
                    "comunicado",
                    <Megaphone className="h-4 w-4" />,
                    "Comunicado oficial",
                    "bg-warning/15 text-amber-700 dark:text-amber-300",
                  )}
                <button
                  type="button"
                  onClick={() => setAgradecendo(true)}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-pink-700 transition hover:bg-pink-500/10 dark:text-pink-300"
                  title="Um elogio público: vira um cartão no Mural e a pessoa é avisada"
                >
                  <HeartHandshake className="h-4 w-4" /> Agradecer alguém
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <input
                    ref={arquivoRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                      void escolherFotos(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  {aceitaFotos && (
                    <button
                      type="button"
                      onClick={() => arquivoRef.current?.click()}
                      disabled={fotos.length >= MAX_FOTOS || publicando}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition hover:bg-secondary hover:text-foreground disabled:opacity-50 ${
                        tipo === "campo" && !fotos.length
                          ? "text-emerald-700 dark:text-emerald-300"
                          : "text-muted-foreground"
                      }`}
                    >
                      <ImagePlus className="h-4 w-4" /> Fotos{" "}
                      {fotos.length > 0 && `(${fotos.length}/${MAX_FOTOS})`}
                    </button>
                  )}
                  {falta && <span className="text-[11px] text-muted-foreground">{falta}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {texto.length > MAX_TEXTO - 300 && (
                    <span className="text-[11px] text-muted-foreground">
                      {MAX_TEXTO - texto.length}
                    </span>
                  )}
                  {(texto || fotos.length > 0 || tipo !== "geral") && (
                    <button
                      type="button"
                      onClick={limpar}
                      disabled={publicando}
                      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      Cancelar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void publicar()}
                    disabled={!podePublicar}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:opacity-50"
                  >
                    {publicando ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Publicar
                  </button>
                </div>
              </div>
            </>
          )}
          {comunicado && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Todos recebem um aviso na sineta e podem marcar "Li e estou ciente".
            </p>
          )}
        </div>
      </div>

      {agradecendo && (
        <AgradecerDialog aoFechar={() => setAgradecendo(false)} aoPublicar={aoPublicar} />
      )}
    </section>
  );
}
