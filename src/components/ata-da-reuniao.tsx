import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Loader2,
  Maximize2,
  Minus,
  Pause,
  Play,
  Square,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ataTemConteudo, type AtaAoVivo } from "@/lib/ata-ao-vivo";
import type { AtaDaReuniao } from "@/lib/use-ata-da-reuniao";

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

function Secao({ icone, titulo, children }: { icone: ReactNode; titulo: string; children: ReactNode }) {
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
        <Secao icone={<AlertTriangle className="h-3 w-3 text-amber-400" />} titulo="Pontos de atenção">
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
  const [aba, setAba] = useState<"ata" | "falas">("ata");
  const [salvando, setSalvando] = useState(false);
  const e = ata.estado;
  const s = situacao(ata);
  const ouvindoComigo = ata.souDono && e?.fase === "ouvindo";
  const temAta = ataTemConteudo(ata.ata);

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
  const baixar = () => {
    const url = URL.createObjectURL(new Blob([ata.markdown()], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeDoArquivo;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
            ["falas", `Falas${ata.falas.length ? ` (${ata.falas.length})` : ""}`],
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
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <p className="text-[13px] text-white/75">Ouvindo a reunião…</p>
                  <p className="text-[11.5px] leading-relaxed text-white/45">
                    A ata começa a aparecer aqui depois das primeiras falas, e vai sendo reescrita
                    conforme a conversa avança.
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
            <p className="mt-8 text-center text-[12px] text-white/45">Nenhuma fala transcrita ainda.</p>
          ) : (
            <ul className="space-y-2">
              {ata.falas.map((f) => (
                <li key={f.id} className="text-[12px] leading-relaxed">
                  <span className="tabular-nums text-white/35">{f.hora}</span>{" "}
                  <span className="font-semibold text-white/85">{f.quem}:</span>{" "}
                  <span className="text-white/75">{f.texto}</span>
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
  if (!pos || typeof document === "undefined") return null;
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
      onClick={aoExpandir}
      initial={{ opacity: 0, x: 16, filter: "blur(6px)" }}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, height: pos.height }}
      className="group z-45 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-950/85 text-left text-white shadow-2xl backdrop-blur-md focus-visible:outline-2 focus-visible:outline-primary"
      title="Abrir a ata"
      aria-label={`${rotulo}. Abrir a ata.`}
    >
      <span className="flex w-full shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2 text-[11px] font-semibold">
        <PontoAoVivo aceso={s.aoVivo} />
        <span className="min-w-0 flex-1 truncate">{rotulo}</span>
        <Maximize2 className="h-3 w-3 shrink-0 opacity-50 transition group-hover:opacity-100" />
      </span>

      <span className="relative block min-h-0 w-full flex-1 overflow-hidden px-3 py-3">
        {/* Desfocada de propósito: presença, não leitura. O mouse por cima deixa espiar. */}
        <span
          className="pointer-events-none block select-none opacity-60 blur-[3px] transition-[filter,opacity] duration-300 group-hover:opacity-90 group-hover:blur-[1px] motion-reduce:transition-none"
          aria-hidden="true"
        >
          {ataTemConteudo(ata.ata) ? <ConteudoDaAta ata={ata.ata} compacto /> : <Rascunho linhas={24} />}
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
