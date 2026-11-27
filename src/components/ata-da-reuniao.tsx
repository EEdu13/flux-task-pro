import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  GripHorizontal,
  Loader2,
  Maximize2,
  Minus,
  Pause,
  Play,
  Square,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { baixarArquivo } from "@/lib/baixar-arquivo";
import { ataTemConteudo, type AtaAoVivo } from "@/lib/ata-ao-vivo";
import type { AtaDaReuniao } from "@/lib/use-ata-da-reuniao";
import { ReprodutorDeAudio } from "@/components/reprodutor-de-midia";

/**
 * A ata na tela da reunião: o botão, o painel aberto e a versão minimizada.
 *
 * Minimizada, ela vai para a sobra à direita da reunião e fica desfocada — dá
 * para ver que está sendo escrita sem disputar atenção com quem está falando.
 * Passar o mouse deixa espiar; clicar abre de novo.
 */

export type VistaDaAta = "fechada" | "aberta" | "minimizada";

/* ------------------------------------------------------------------ */
/* Estado em palavras                                                   */
/* ------------------------------------------------------------------ */

function situacao(a: AtaDaReuniao): { texto: string; aoVivo: boolean } {
  const e = a.estado;
  if (!e) return { texto: "Não iniciada", aoVivo: false };
  if (a.donoSaiu) return { texto: `${e.dono.nome} saiu da reunião`, aoVivo: false };
  if (e.salva) return { texto: "Salva em Atas & Planos", aoVivo: false };
  if (e.escrevendo) return { texto: "Escrevendo…", aoVivo: true };
  if (e.fase === "pausada") return { texto: "Pausada", aoVivo: false };
  if (e.fase === "encerrada") return { texto: "Encerrada", aoVivo: false };
  if (!a.souDono) return { texto: `Escrita por ${e.dono.nome}`, aoVivo: true };
  if (a.falandoAgora.length) return { texto: `Ouvindo ${a.falandoAgora.join(", ")}`, aoVivo: true };
  return { texto: "Ouvindo a reunião", aoVivo: true };
}

function PontoAoVivo({ aceso }: { aceso: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {aceso && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60 motion-reduce:animate-none" />
      )}
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${aceso ? "bg-red-500" : "bg-white/35"}`}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Botão da barra                                                       */
/* ------------------------------------------------------------------ */

export function BotaoDaAta({
  ata,
  vista,
  onClick,
}: {
  ata: AtaDaReuniao;
  vista: VistaDaAta;
  onClick: () => void;
}) {
  const e = ata.estado;
  const aoVivo = !!e && e.fase === "ouvindo" && !ata.donoSaiu;
  const naoSalva = ata.temConteudoNaoSalvo();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={vista !== "fechada"}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
        vista !== "fechada" || aoVivo
          ? "border-primary/60 bg-primary/20 text-white"
          : "border-white/15 bg-white/5 text-white hover:bg-white/10"
      }`}
      title={
        aoVivo
          ? ata.souDono
            ? "A ata está sendo escrita — clique para ver"
            : `${e.dono.nome} está escrevendo a ata — clique para acompanhar`
          : e
            ? "Ver a ata da reunião"
            : "Começar a ata: a IA ouve a reunião e escreve a ata"
      }
    >
      {aoVivo ? <PontoAoVivo aceso /> : <FileText className="h-3.5 w-3.5" />}
      Ata
      {naoSalva && (
        <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" title="Ata não salva" />
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* O conteúdo da ata                                                    */
/* ------------------------------------------------------------------ */

function Secao({
  icone,
  titulo,
  children,
}: {
  icone: ReactNode;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
        {icone}
        {titulo}
      </h4>
      {children}
    </section>
  );
}

/** Itens entram suavemente: a chave é o texto, então o que o Claude reescreve "surge" de novo. */
function Item({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className={className}
    >
      {children}
    </motion.li>
  );
}

export function ConteudoDaAta({ ata, compacto = false }: { ata: AtaAoVivo; compacto?: boolean }) {
  const corpo = compacto ? "text-[10.5px] leading-snug" : "text-[13px] leading-relaxed";
  return (
    <div className={compacto ? "space-y-3" : "space-y-5"}>
      {ata.resumo && (
        <Secao icone={<FileText className="h-3 w-3" />} titulo="Resumo">
          <p className={`${corpo} text-white/85`}>{ata.resumo}</p>
        </Secao>
      )}

      {ata.assuntos.length > 0 && (
        <Secao icone={<span className="h-1.5 w-1.5 rounded-full bg-primary" />} titulo="Assuntos">
          <ul className={compacto ? "space-y-2" : "space-y-3"}>
            <AnimatePresence initial={false}>
              {ata.assuntos.map((s) => (
                <Item key={s.titulo}>
                  <div className={`${corpo} font-semibold text-white`}>{s.titulo}</div>
                  <ul className="mt-1 space-y-1">
                    <AnimatePresence initial={false}>
                      {s.pontos.map((p) => (
                        <Item key={p} className={`flex gap-2 ${corpo} text-white/70`}>
                          <span className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-white/40" />
                          <span>{p}</span>
                        </Item>
                      ))}
                    </AnimatePresence>
                  </ul>
                </Item>
              ))}
            </AnimatePresence>
          </ul>
        </Secao>
      )}

      {ata.decisoes.length > 0 && (
        <Secao icone={<CheckCircle2 className="h-3 w-3 text-emerald-400" />} titulo="Decisões">
          <ul className="space-y-1.5">
            <AnimatePresence initial={false}>
              {ata.decisoes.map((d) => (
                <Item key={d} className={`flex gap-2 ${corpo} text-white/85`}>
                  <CheckCircle2 className="mt-[0.2em] h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span>{d}</span>
                </Item>
              ))}
            </AnimatePresence>
          </ul>
        </Secao>
      )}

      {ata.proximosPassos.length > 0 && (
        <Secao icone={<Square className="h-3 w-3 text-primary" />} titulo="Próximos passos">
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {ata.proximosPassos.map((p) => (
                <Item key={p.acao} className={`flex gap-2 ${corpo} text-white/85`}>
                  <Square className="mt-[0.25em] h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="min-w-0">
                    {p.acao}
                    {(p.responsavel || p.prazo) && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {p.responsavel && (
                          <span className="rounded-full bg-primary/20 px-2 py-px text-[10.5px] font-medium text-white/90">
                            {p.responsavel}
                          </span>
                        )}
                        {p.prazo && (
                          <span className="rounded-full bg-white/10 px-2 py-px text-[10.5px] text-white/70">
                            {p.prazo}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </Item>
              ))}
            </AnimatePresence>
          </ul>
        </Secao>
      )}

      {ata.pontosDeAtencao.length > 0 && (
        <Secao
          icone={<AlertTriangle className="h-3 w-3 text-amber-400" />}
          titulo="Pontos de atenção"
        >
          <ul className="space-y-1.5">
            <AnimatePresence initial={false}>
              {ata.pontosDeAtencao.map((p) => (
                <Item key={p} className={`flex gap-2 ${corpo} text-white/80`}>
                  <AlertTriangle className="mt-[0.2em] h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span>{p}</span>
                </Item>
              ))}
            </AnimatePresence>
          </ul>
        </Secao>
      )}
    </div>
  );
}

/** Linhas de rascunho: o lugar da ata enquanto ela ainda não tem texto. */
function Rascunho({ linhas = 9 }: { linhas?: number }) {
  const larguras = [92, 78, 85, 40, 88, 70, 95, 60, 82, 50, 90, 74];
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: linhas }, (_, i) => (
        <div
          key={i}
          className={`h-2 rounded-full ${i % 4 === 3 ? "mt-3 bg-white/25" : "bg-white/15"}`}
          style={{ width: `${larguras[i % larguras.length]}%` }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Painel aberto                                                        */
/* ------------------------------------------------------------------ */

export function PainelDaAta({
  ata,
  aoMinimizar,
  aoFechar,
  nomeDoArquivo,
}: {
  ata: AtaDaReuniao;
  aoMinimizar: () => void;
  aoFechar: () => void;
  nomeDoArquivo: string;
}) {
  const temAta = ataTemConteudo(ata.ata);
  /* Durante a reunião o que existe é a transcrição; a ata só sai no fim.
     Quando ela chega, a aba troca sozinha. */
  const [aba, setAba] = useState<"ata" | "falas">(temAta ? "ata" : "falas");
  useEffect(() => {
    if (temAta) setAba("ata");
  }, [temAta]);
  const [salvando, setSalvando] = useState(false);
  const e = ata.estado;
  const s = situacao(ata);
  const ouvindoComigo = ata.souDono && e?.fase === "ouvindo";

  const falasRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (aba !== "falas") return;
    const caixa = falasRef.current;
    if (caixa) caixa.scrollTop = caixa.scrollHeight;
  }, [aba, ata.falas.length]);

  const copiar = () => {
    navigator.clipboard
      ?.writeText(ata.markdown())
      .then(() => toast.success("Ata copiada"))
      .catch(() => {});
  };
  // No app de mesa grava em Downloads pelo comando do app (o link ele ignora) — ver `baixar-arquivo.ts`.
  const baixar = () => {
    void baixarArquivo(nomeDoArquivo, new Blob([ata.markdown()], { type: "text/markdown" }));
  };
  const salvar = async () => {
    setSalvando(true);
    const ok = await ata.finalizarESalvar();
    setSalvando(false);
    if (!ok) toast.error("A ata não foi salva. Tente de novo em instantes.");
  };

  /* Ancorado ACIMA da barra de controles (`bottom-full`), que é o `relative`
     mais próximo — ver o comentário antigo em meeting-extras sobre a altura. */
  return (
    <div
      role="dialog"
      aria-label="Ata da reunião"
      className="absolute bottom-full right-2 z-40 mb-2 flex h-[min(74vh,38rem)] w-[420px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-950/95 text-white shadow-2xl backdrop-blur"
    >
      <header className="flex items-start gap-2.5 px-4 pb-2 pt-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">Ata da reunião</h3>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-white/55">
            <PontoAoVivo aceso={s.aoVivo} />
            <span className="truncate">{s.texto}</span>
          </p>
        </div>
        {ata.souDono && e && !e.salva && e.fase !== "encerrada" && (
          <button
            type="button"
            onClick={e.fase === "ouvindo" ? ata.pausar : ata.retomar}
            className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
            title={e.fase === "ouvindo" ? "Pausar: parar de ouvir" : "Retomar: voltar a ouvir"}
            aria-label={e.fase === "ouvindo" ? "Pausar a ata" : "Retomar a ata"}
          >
            {e.fase === "ouvindo" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={aoMinimizar}
          className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
          title="Minimizar para o lado"
          aria-label="Minimizar a ata"
        >
          <Minus className="h-4 w-4" />
        </button>
        {/* Enquanto ouve, a ata não some da tela: fechar esconderia que a
            reunião está sendo transcrita. Dá para minimizar ou pausar. */}
        {!ouvindoComigo && (
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
            title="Fechar"
            aria-label="Fechar a ata"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      {/* Fio de luz correndo enquanto o Claude escreve. */}
      <div className="relative h-px shrink-0 overflow-hidden bg-white/10">
        {e?.escrevendo && (
          <motion.span
            className="absolute inset-y-0 w-1/3 bg-linear-to-r from-transparent via-primary to-transparent"
            initial={{ x: "-100%" }}
            animate={{ x: "300%" }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>

      <div className="flex shrink-0 gap-1 px-4 pt-2.5" role="tablist">
        {(
          [
            ["ata", "Ata"],
            ["falas", `Transcrição${ata.falas.length ? ` (${ata.falas.length})` : ""}`],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aba === id}
            onClick={() => setAba(id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              aba === id ? "bg-white/12 text-white" : "text-white/55 hover:text-white"
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aba === "ata" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {temAta ? (
            <ConteudoDaAta ata={ata.ata} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              {e && e.fase === "ouvindo" && !ata.donoSaiu ? (
                <>
                  <FileText className="h-5 w-5 text-primary" />
                  <p className="text-[13px] text-white/75">A ata sai quando a reunião terminar</p>
                  <p className="text-[11.5px] leading-relaxed text-white/45">
                    Por enquanto tudo o que é dito vai para a Transcrição, com o nome de quem falou.
                    No fim, a IA lê a reunião inteira de uma vez e escreve a ata — resumo, decisões
                    e próximos passos.
                  </p>
                </>
              ) : (
                <p className="text-[12px] leading-relaxed text-white/50">
                  {e ? "Nada virou ata ainda." : "A ata não foi iniciada nesta reunião."}
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div ref={falasRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {ata.falas.length === 0 ? (
            <p className="mt-8 text-center text-[12px] text-white/45">
              Nenhuma fala transcrita ainda.
            </p>
          ) : (
            <ul className="space-y-2">
              {ata.falas.map((f) => (
                <li key={f.id} className="text-[12px] leading-relaxed">
                  <span className="tabular-nums text-white/35">{f.hora}</span>{" "}
                  <span className="font-semibold text-white/85">{f.quem}:</span>{" "}
                  <span className="text-white/75">{f.texto}</span>
                  {/* O áudio do trecho fica guardado: dá para conferir o que foi dito. */}
                  {f.audio && e?.ataId && (
                    <div className="mt-1">
                      <ReprodutorDeAudio
                        mini
                        src={`/api/ata-audio/${e.ataId}/${f.audio}`}
                        semente={f.audio}
                      />
                    </div>
                  )}
                </li>
              ))}
              {ata.transcrevendo > 0 && (
                <li className="flex items-center gap-1.5 text-[11px] text-white/40">
                  <Loader2 className="h-3 w-3 animate-spin" /> transcrevendo…
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {ata.erro && (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{ata.erro}</span>
        </div>
      )}

      <footer className="flex items-center gap-2 border-t border-white/10 bg-black/40 px-4 py-2.5">
        {ata.donoSaiu || !e ? (
          <button
            type="button"
            onClick={() => ata.iniciar()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-95"
          >
            <Play className="h-3.5 w-3.5" />
            {e ? "Continuar a ata" : "Começar a ata"}
          </button>
        ) : ata.souDono && !e.salva ? (
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando || (!temAta && ata.falas.length === 0)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50"
            title="Para de ouvir, escreve o que faltou e salva em Atas & Planos"
          >
            {salvando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            {salvando ? "Finalizando…" : "Finalizar e salvar"}
          </button>
        ) : e.salva && ata.souDono ? (
          <button
            type="button"
            onClick={() => ata.iniciar()}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
          >
            <Play className="h-3.5 w-3.5" /> Nova ata
          </button>
        ) : (
          <span className="truncate text-[11px] text-white/45">
            {e.salva ? "Salva por " : "Quem salva é "}
            {e.dono.nome}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={copiar}
            disabled={!temAta}
            className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30"
            title="Copiar a ata"
            aria-label="Copiar a ata"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={baixar}
            disabled={!temAta}
            className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30"
            title="Baixar .md"
            aria-label="Baixar a ata"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Minimizada, na sobra da direita                                      */
/* ------------------------------------------------------------------ */

type Posicao = { left: number; top: number; width: number; height: number };

/**
 * Onde a ata minimizada cabe.
 *
 * A reunião ocupa o meio da tela e sobra uma faixa à direita dela. Se a faixa
 * tem largura para um cartão, ele vai lá, alinhado ao topo da reunião e parando
 * antes do canto de baixo — onde moram o balão do chat e o acesso rápido. Tela
 * estreita, sem sobra: o cartão fica dentro da reunião, no canto de cima.
 */
function usePosicaoNaSobra(alvo: RefObject<HTMLElement | null>): Posicao | null {
  const [pos, setPos] = useState<Posicao | null>(null);
  useEffect(() => {
    const medir = () => {
      const el = alvo.current;
      if (!el) return setPos(null);
      const r = el.getBoundingClientRect();
      const sobra = window.innerWidth - r.right;
      const nova: Posicao =
        sobra >= 176
          ? (() => {
              const width = Math.min(300, sobra - 24);
              return {
                width,
                left: r.right + (sobra - width) / 2,
                top: r.top,
                height: Math.max(180, Math.min(460, r.height - 170)),
              };
            })()
          : {
              width: 240,
              left: r.right - 240 - 12,
              top: r.top + 44,
              height: Math.max(160, Math.min(320, r.height * 0.5)),
            };
      setPos((p) =>
        p &&
        p.left === nova.left &&
        p.top === nova.top &&
        p.width === nova.width &&
        p.height === nova.height
          ? p
          : nova,
      );
    };
    medir();
    const ro = new ResizeObserver(medir);
    if (alvo.current) ro.observe(alvo.current);
    window.addEventListener("resize", medir);
    // A reunião também se move sem mudar de tamanho (barra lateral recolhendo).
    const id = window.setInterval(medir, 1000);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", medir);
      window.clearInterval(id);
    };
  }, [alvo]);
  return pos;
}

/* ------------------------------------------------------------------ */
/* Arrastar a minimizada (27/11/2026)                                   */
/* ------------------------------------------------------------------ */

/*
 * Com o chat aberto, a sobra à direita é o próprio chat: o cartão caía em cima
 * dele e não saía de lá. Agora dá para arrastar o cartão para onde quiser. Um
 * clique sem arrastar continua abrindo a ata. O lugar escolhido fica guardado
 * neste computador e vale nas próximas vezes que a ata for minimizada; sem ele,
 * o cartão volta à regra automática acima.
 */
const CHAVE_DA_POSICAO = "fluxo:ata-minimizada-posicao";
/** Distância mínima até a borda da janela. */
const MARGEM_DA_TELA = 8;
/** Abaixo disso o gesto é clique, não arraste. */
const LIMIAR_DO_ARRASTE = 4;

type Lugar = { left: number; top: number };

function lerLugarGuardado(): Lugar | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_DA_POSICAO) ?? "null") as Lugar | null;
    return v && Number.isFinite(v.left) && Number.isFinite(v.top)
      ? { left: v.left, top: v.top }
      : null;
  } catch {
    return null;
  }
}

function guardarLugar(l: Lugar) {
  try {
    localStorage.setItem(CHAVE_DA_POSICAO, JSON.stringify(l));
  } catch {
    /* sem armazenamento: vale só até fechar a ata */
  }
}

/** Mantém o cartão inteiro dentro da janela. */
function dentroDaTela(l: Lugar, largura: number, altura: number): Lugar {
  const prender = (v: number, max: number) =>
    Math.min(Math.max(v, MARGEM_DA_TELA), Math.max(MARGEM_DA_TELA, max));
  return {
    left: prender(l.left, window.innerWidth - largura - MARGEM_DA_TELA),
    top: prender(l.top, window.innerHeight - altura - MARGEM_DA_TELA),
  };
}

export function AtaMinimizada({
  ata,
  alvo,
  aoExpandir,
}: {
  ata: AtaDaReuniao;
  alvo: RefObject<HTMLElement | null>;
  aoExpandir: () => void;
}) {
  const pos = usePosicaoNaSobra(alvo);
  /** Onde a pessoa deixou o cartão (null = lugar automático). */
  const [movida, setMovida] = useState<Lugar | null>(() =>
    typeof window === "undefined" ? null : lerLugarGuardado(),
  );
  const [arrastando, setArrastando] = useState(false);
  const arraste = useRef<{ x0: number; y0: number; inicio: Lugar; movendo: boolean } | null>(null);
  /** O clique que vem no fim de um arraste não abre a ata. */
  const engolirClique = useRef(false);
  // Janela mudou de tamanho: redesenha para o cartão não ficar fora dela.
  const [, setTela] = useState(0);
  useEffect(() => {
    const aoMudar = () => setTela((n) => n + 1);
    window.addEventListener("resize", aoMudar);
    return () => window.removeEventListener("resize", aoMudar);
  }, []);

  if (!pos || typeof document === "undefined") return null;
  const lugar = movida ? dentroDaTela(movida, pos.width, pos.height) : pos;

  const soltar = (el: HTMLElement, pointerId: number) => {
    const a = arraste.current;
    arraste.current = null;
    if (!a?.movendo) return;
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    engolirClique.current = true;
    const novo = dentroDaTela(
      { left: parseFloat(el.style.left), top: parseFloat(el.style.top) },
      pos.width,
      pos.height,
    );
    setMovida(novo);
    guardarLugar(novo);
    setArrastando(false);
  };
  const e = ata.estado;
  const s = situacao(ata);
  const escrevendo = !!e?.escrevendo;
  const rotulo = escrevendo
    ? "Escrevendo a ata"
    : e?.fase === "ouvindo" && !ata.donoSaiu
      ? "Ata · ouvindo"
      : `Ata · ${s.texto.toLowerCase()}`;

  return createPortal(
    <motion.button
      type="button"
      onClick={() => {
        if (engolirClique.current) {
          engolirClique.current = false;
          return;
        }
        aoExpandir();
      }}
      onPointerDown={(ev) => {
        if (ev.button !== 0) return;
        // O left/top do estilo, e não o retângulo na tela: o leve aumento
        // durante o arraste mexeria no retângulo.
        const st = ev.currentTarget.style;
        engolirClique.current = false;
        arraste.current = {
          x0: ev.clientX,
          y0: ev.clientY,
          inicio: {
            left: parseFloat(st.left) || lugar.left,
            top: parseFloat(st.top) || lugar.top,
          },
          movendo: false,
        };
      }}
      onPointerMove={(ev) => {
        const a = arraste.current;
        if (!a) return;
        const dx = ev.clientX - a.x0;
        const dy = ev.clientY - a.y0;
        if (!a.movendo) {
          if (Math.hypot(dx, dy) < LIMIAR_DO_ARRASTE) return;
          a.movendo = true;
          ev.currentTarget.setPointerCapture(ev.pointerId);
          setArrastando(true);
        }
        // Direto no elemento: arrastar não redesenha a ata a cada movimento.
        const l = dentroDaTela(
          { left: a.inicio.left + dx, top: a.inicio.top + dy },
          pos.width,
          pos.height,
        );
        ev.currentTarget.style.left = `${l.left}px`;
        ev.currentTarget.style.top = `${l.top}px`;
      }}
      onPointerUp={(ev) => soltar(ev.currentTarget, ev.pointerId)}
      onPointerCancel={(ev) => soltar(ev.currentTarget, ev.pointerId)}
      initial={{ opacity: 0, x: 16, filter: "blur(6px)" }}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)", scale: arrastando ? 1.02 : 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      style={{
        position: "fixed",
        left: lugar.left,
        top: lugar.top,
        width: pos.width,
        height: pos.height,
      }}
      className={`group z-45 flex touch-none select-none flex-col overflow-hidden rounded-xl border bg-neutral-950/85 text-left text-white backdrop-blur-md focus-visible:outline-2 focus-visible:outline-primary ${
        arrastando
          ? "cursor-grabbing border-primary/40 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]"
          : "cursor-grab border-white/10 shadow-2xl"
      }`}
      title="Clique para abrir a ata · arraste para mudar de lugar"
      aria-label={`${rotulo}. Abrir a ata.`}
    >
      <span className="flex w-full shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2 text-[11px] font-semibold">
        <PontoAoVivo aceso={s.aoVivo} />
        <span className="min-w-0 flex-1 truncate">{rotulo}</span>
        <GripHorizontal
          className={`h-3.5 w-3.5 shrink-0 transition ${
            arrastando ? "opacity-100" : "opacity-40 group-hover:opacity-80"
          }`}
          aria-hidden="true"
        />
        <Maximize2 className="h-3 w-3 shrink-0 opacity-50 transition group-hover:opacity-100" />
      </span>

      <span className="relative block min-h-0 w-full flex-1 overflow-hidden px-3 py-3">
        {/* Desfocada de propósito: presença, não leitura. O mouse por cima deixa espiar. */}
        <span
          className="pointer-events-none block select-none opacity-60 blur-[3px] transition-[filter,opacity] duration-300 group-hover:opacity-90 group-hover:blur-[1px] motion-reduce:transition-none"
          aria-hidden="true"
        >
          {ataTemConteudo(ata.ata) ? (
            <ConteudoDaAta ata={ata.ata} compacto />
          ) : (
            <Rascunho linhas={24} />
          )}
        </span>

        {/* A caneta passando: uma faixa de luz descendo enquanto o Claude escreve. */}
        {escrevendo && (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 h-16 bg-linear-to-b from-transparent via-primary/25 to-transparent"
            initial={{ top: "-20%" }}
            animate={{ top: "100%" }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-linear-to-t from-neutral-950 to-transparent"
        />
      </span>
    </motion.button>,
    document.body,
  );
}
