import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AudioLines,
  CalendarDays,
  Check,
  Mic,
  MicOff,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useFluxo } from "@/lib/fluxo-store";
import type { User } from "@/lib/fluxo-types";
import { useMicrofone, type EstadoMicrofone } from "@/lib/use-microfone";
import { useDitado } from "@/lib/use-ditado";
import {
  interpretarVoz,
  transcreverVoz,
  type Prioridade,
  type TarefaDitada,
  type TarefaInterpretada,
} from "@/lib/voz.functions";
import { dataParaIso, isoParaData } from "@/lib/data-iso";
import { ALTURA_DA_FAIXA, FaixaDeVoz } from "@/components/faixa-de-voz";
import { UserAvatar } from "@/components/user-avatar";
import { TravaScroll } from "@/components/trava-scroll";
import { confirmar } from "@/components/confirm-dialog";

/**
 * Tarefa por voz.
 *
 * A pessoa dita, e as tarefas vão aparecendo prontas enquanto ela fala:
 *   1. `useDitado` corta a fala nas pausas e entrega cada frase como áudio;
 *   2. a OpenAI transcreve a frase (`transcreverVoz`);
 *   3. o Claude Haiku atualiza a lista de tarefas com o que foi dito
 *      (`interpretarVoz`) — inclusive correções: "não, essa é para a Milena".
 *
 * As transcrições correm em paralelo, mas a interpretação vai uma de cada vez,
 * na ordem em que as frases foram ditas: "a segunda é para amanhã" não pode
 * ser lida antes da frase que criou a segunda. Frases que ficam prontas
 * enquanto uma interpretação está no ar vão juntas na próxima — uma chamada a
 * menos.
 *
 * Nada é gravado no banco até a pessoa clicar em Criar.
 */

interface LinhaDoLog {
  id: number;
  texto: string;
  resultado?: string;
  feito: boolean;
  destaque?: boolean;
  erro?: boolean;
}

/** O estado da conversa com a IA. Trocado inteiro ao recomeçar. */
interface Pipeline {
  /** Número da próxima frase gravada. */
  seq: number;
  /** Próxima frase a interpretar, na ordem em que foi dita. */
  proximo: number;
  /** Frases já transcritas esperando a vez. Texto vazio = não havia fala. */
  prontos: Map<number, string>;
  interpretando: boolean;
  /** Tudo o que já foi interpretado — contexto para "essa", "a última". */
  fala: string;
  refSeq: number;
}

const novaPipeline = (): Pipeline => ({
  seq: 0,
  proximo: 0,
  prontos: new Map(),
  interpretando: false,
  fala: "",
  refSeq: 0,
});

const capitalizar = (p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();

/** "LUCAS GABRIEL BARRETO" → "Lucas Barreto". O cadastro vem em maiúsculas da IAM. */
function nomeCurto(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const primeiro = partes[0] ?? "";
  const ultimo = partes.length > 1 ? partes[partes.length - 1]! : "";
  return [primeiro, ultimo].filter(Boolean).map(capitalizar).join(" ");
}

/** "sex, 18/09" */
const rotuloDia = (d: Date) =>
  d
    .toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })
    .replace(".", "");

function rotuloPrazo(t: TarefaDitada): string {
  const dia = isoParaData(t.prazo);
  if (!dia) return "Hoje";
  return `${rotuloDia(dia)}${t.hora ? ` · ${t.hora}` : ""}`;
}

const paraBase64 = (b: Blob) =>
  new Promise<string>((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result).split(",")[1] ?? "");
    leitor.onerror = () => rejeitar(leitor.error);
    leitor.readAsDataURL(b);
  });

const mensagemDe = (e: unknown) =>
  (e instanceof Error && e.message) || "Algo deu errado. Tente de novo.";

/* ------------------------------------------------------------------ */
/* Casca: portal + animação de entrada e saída                          */
/* ------------------------------------------------------------------ */

export function TarefaPorVoz({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  // Portal para o body: o raio mora dentro de um contêiner com `transform`
  // (a animação do menu), e `fixed` dentro de um elemento transformado passa a
  // ser relativo a ele — o modal abriria preso no canto do raio.
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>{aberto && <VozAberta key="voz" aoFechar={aoFechar} />}</AnimatePresence>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* O modal aberto                                                       */
/* ------------------------------------------------------------------ */

/**
 * Montado só enquanto aberto: fechar desmonta, e desmontar é o que solta o
 * microfone e faz respostas atrasadas da IA serem ignoradas.
 */
function VozAberta({ aoFechar }: { aoFechar: () => void }) {
  const { users, currentUser, createTask } = useFluxo();
  const [pausado, setPausado] = useState(false);
  const { estado: estadoMic, leituraRef } = useMicrofone(!pausado);

  const [rodada, setRodada] = useState(0);
  const [trechos, setTrechos] = useState<string[]>([]);
  const [transcrevendo, setTranscrevendo] = useState(0);
  const [interpretando, setInterpretando] = useState(false);
  const [log, setLog] = useState<LinhaDoLog[]>([]);
  const [tarefas, setTarefas] = useState<TarefaDitada[]>([]);

  /* Quem as funções assíncronas leem. Uma resposta da IA chega segundos
     depois, e o que vale é a lista de AGORA — a pessoa pode ter descartado um
     cartão enquanto esperava. */
  const pipelineRef = useRef<Pipeline>(novaPipeline());
  const tarefasRef = useRef<TarefaDitada[]>([]);
  const usersRef = useRef(users);
  const eu = useRef(currentUser);
  useEffect(() => {
    usersRef.current = users;
    eu.current = currentUser;
  }, [users, currentUser]);

  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  /* Tela baixa (notebook de 768 de altura, com barra de tarefas e título da
     janela sobrando ~700): a faixa de voz e a caixa de fala encolhem, e o
     espaço vai para os cartões — que são o que se revisa aqui. */
  const [compacto, setCompacto] = useState(() =>
    typeof window === "undefined" ? false : window.innerHeight < 820,
  );
  useEffect(() => {
    const aoRedimensionar = () => setCompacto(window.innerHeight < 820);
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, []);
  const alturaDaFaixa = compacto ? 150 : ALTURA_DA_FAIXA;

  /* ---------------- Registro do "Organizando" ---------------- */

  const logSeq = useRef(0);
  const anotar = (linha: Omit<LinhaDoLog, "id">) => {
    const id = ++logSeq.current;
    setLog((l) => [...l.slice(-40), { ...linha, id }]);
    return id;
  };
  const atualizarLinha = (id: number, mudanca: Partial<LinhaDoLog>) =>
    setLog((l) => l.map((x) => (x.id === id ? { ...x, ...mudanca } : x)));

  /* O mesmo erro em cada frase (sem crédito, chave recusada) vira um aviso só. */
  const ultimoAviso = useRef({ msg: "", em: 0 });
  const avisar = (msg: string) => {
    if (msg === ultimoAviso.current.msg && Date.now() - ultimoAviso.current.em < 15_000) return;
    ultimoAviso.current = { msg, em: Date.now() };
    toast.error(msg);
  };

  /* ---------------- Entender ---------------- */

  const aplicar = (interpretadas: TarefaInterpretada[]) => {
    const p = pipelineRef.current;
    const atuais = tarefasRef.current;
    const porRef = new Map(atuais.map((t) => [t.ref, t]));
    const nova: TarefaDitada[] = [];

    for (const t of interpretadas) {
      // Ref que não está mais na lista foi descartado durante a espera.
      if (t.ref && !porRef.has(t.ref)) continue;
      const tarefa: TarefaDitada = { ...t, ref: t.ref ?? `t${++p.refSeq}` };
      nova.push(tarefa);

      const antes = t.ref ? porRef.get(t.ref) : undefined;
      if (!antes) {
        const pessoa = usersRef.current.find((u) => u.id === tarefa.responsavelId);
        anotar({
          texto: "Identificando responsável",
          resultado: pessoa ? nomeCurto(pessoa.name) : "não reconheci o nome",
          feito: true,
        });
        anotar({
          texto: "Interpretando prazo",
          resultado: tarefa.prazo ? rotuloPrazo(tarefa) : "não dito — fica para hoje",
          feito: true,
        });
        anotar({ texto: "Tarefa pronta", resultado: tarefa.titulo, feito: true, destaque: true });
      } else if (
        antes.titulo !== tarefa.titulo ||
        antes.descricao !== tarefa.descricao ||
        antes.responsavelId !== tarefa.responsavelId ||
        antes.prazo !== tarefa.prazo ||
        antes.hora !== tarefa.hora ||
        antes.prioridade !== tarefa.prioridade
      ) {
        anotar({ texto: "Tarefa ajustada", resultado: tarefa.titulo, feito: true, destaque: true });
      }
    }

    const ficaram = new Set(nova.map((t) => t.ref));
    for (const t of atuais) {
      if (!ficaram.has(t.ref))
        anotar({ texto: "Tarefa removida", resultado: t.titulo, feito: true });
    }

    tarefasRef.current = nova;
    setTarefas(nova);
  };

  const bombear = async () => {
    const p = pipelineRef.current;
    if (p.interpretando || !montadoRef.current) return;

    const novos: string[] = [];
    while (p.prontos.has(p.proximo)) {
      const texto = p.prontos.get(p.proximo)!;
      p.prontos.delete(p.proximo);
      p.proximo++;
      if (texto) novos.push(texto);
    }
    if (novos.length === 0) return;

    const trechoNovo = novos.join(" ");
    const falaAnterior = p.fala;
    p.fala = `${p.fala} ${trechoNovo}`.trim();
    setTrechos((ts) => [...ts, trechoNovo]);

    p.interpretando = true;
    setInterpretando(true);
    const linha = anotar({ texto: "Organizando orientações", feito: false });
    const vale = () => pipelineRef.current === p && montadoRef.current;

    try {
      const r = await interpretarVoz({
        data: {
          trechoNovo,
          falaAnterior,
          tarefas: tarefasRef.current,
          pessoas: usersRef.current.map((u) => ({
            id: u.id,
            nome: u.name,
            setor: u.sector,
            cargo: u.jobTitle,
          })),
          quemDita: eu.current.id,
          hoje: dataParaIso(new Date()),
        },
      });
      if (!vale()) return;
      atualizarLinha(linha, { feito: true });
      aplicar(r.tarefas);
    } catch (e) {
      if (!vale()) return;
      const msg = mensagemDe(e);
      atualizarLinha(linha, { feito: true, erro: true, resultado: msg });
      avisar(msg);
    } finally {
      if (vale()) {
        p.interpretando = false;
        setInterpretando(false);
        void bombear();
      }
    }
  };

  /* ---------------- Ouvir ---------------- */

  const aoTrecho = async (audio: Blob) => {
    if (!montadoRef.current) return;
    const p = pipelineRef.current;
    const seq = p.seq++;
    const vale = () => pipelineRef.current === p && montadoRef.current;

    setTranscrevendo((n) => n + 1);
    const linha = anotar({ texto: "Transcrevendo fala", feito: false });
    let texto = "";
    try {
      const r = await transcreverVoz({
        data: {
          audio: await paraBase64(audio),
          mime: audio.type,
          nomes: usersRef.current.slice(0, 80).map((u) => nomeCurto(u.name)),
        },
      });
      texto = r.texto;
      if (!vale()) return;
      if (texto) atualizarLinha(linha, { feito: true, texto: "Fala transcrita" });
      // Trecho sem palavra nenhuma (tosse, bater na mesa) não deixa rastro.
      else setLog((l) => l.filter((x) => x.id !== linha));
    } catch (e) {
      if (!vale()) return;
      const msg = mensagemDe(e);
      atualizarLinha(linha, { feito: true, erro: true, resultado: msg });
      avisar(msg);
    } finally {
      if (vale()) {
        setTranscrevendo((n) => Math.max(0, n - 1));
        p.prontos.set(seq, texto);
        void bombear();
      }
    }
  };

  const escutando = estadoMic === "ativo" && !pausado;
  const { falandoAgora, semSuporte } = useDitado({
    ativo: escutando,
    leituraRef,
    aoTrecho: (audio) => void aoTrecho(audio),
  });

  /* Dois minutos sem fala soltam o microfone. Esquecer o painel aberto não
     pode deixar o microfone da pessoa aceso a tarde inteira. */
  useEffect(() => {
    if (!escutando || falandoAgora) return;
    const id = window.setTimeout(() => {
      setPausado(true);
      toast.info("Pausei o microfone depois de 2 minutos sem fala.");
    }, 120_000);
    return () => window.clearTimeout(id);
  }, [escutando, falandoAgora]);

  /* ---------------- Tela ---------------- */

  const ocupado = transcrevendo > 0 || interpretando;
  const semMicrofone = estadoMic === "negado" || estadoMic === "indisponivel" || semSuporte;

  /* A fala rola sozinha até o fim quando passa da caixa. */
  const falaRef = useRef<HTMLDivElement>(null);
  const [falaTransbordou, setFalaTransbordou] = useState(false);
  useEffect(() => {
    const caixa = falaRef.current;
    if (!caixa) return;
    const transborda = caixa.scrollHeight > caixa.clientHeight + 1;
    caixa.scrollTop = transborda ? caixa.scrollHeight : 0;
    setFalaTransbordou(transborda);
  }, [trechos, falandoAgora, transcrevendo, compacto]);

  /* A tarefa que acabou de sair é a que importa naquele instante. A partir da
     terceira ela nasce abaixo da dobra, e sem rolar até ela o contador subia
     para "3" com a lista mostrando só duas — parecendo que a terceira sumiu. */
  const listaDeTarefasRef = useRef<HTMLDivElement>(null);
  const qtdTarefas = tarefas.length;
  useEffect(() => {
    const lista = listaDeTarefasRef.current;
    if (!lista || qtdTarefas === 0) return;
    const id = window.setTimeout(() => {
      lista.scrollTo({ top: lista.scrollHeight, behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(id);
  }, [qtdTarefas]);

  const descartar = (ref: string) => {
    tarefasRef.current = tarefasRef.current.filter((t) => t.ref !== ref);
    setTarefas(tarefasRef.current);
  };

  const recomecar = () => {
    // Uma pipeline nova faz as respostas que ainda estão no ar serem ignoradas.
    pipelineRef.current = novaPipeline();
    tarefasRef.current = [];
    setTrechos([]);
    setLog([]);
    setTarefas([]);
    setTranscrevendo(0);
    setInterpretando(false);
    setPausado(false);
    setRodada((r) => r + 1);
  };

  /* Fechar com tarefas na tela pergunta antes: ditar cinco pedidos e perdê-los
     num clique fora do painel é o erro mais caro desta tela. */
  const confirmandoRef = useRef(false);
  const fechar = async () => {
    if (confirmandoRef.current) return;
    const n = tarefasRef.current.length;
    if (n > 0) {
      confirmandoRef.current = true;
      const ok = await confirmar({
        titulo: "Descartar as tarefas ditadas?",
        descricao:
          n === 1
            ? "Uma tarefa ainda não foi criada e vai se perder."
            : `${n} tarefas ainda não foram criadas e vão se perder.`,
        confirmar: "Descartar",
        perigo: true,
      });
      confirmandoRef.current = false;
      if (!ok) return;
    }
    aoFechar();
  };
  const fecharRef = useRef(fechar);
  useEffect(() => {
    fecharRef.current = fechar;
  });

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      void fecharRef.current();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  const criar = () => {
    const lista = tarefasRef.current;
    if (lista.length === 0) return;
    const quem = eu.current;
    for (const t of lista) {
      // Sem responsável reconhecido, a tarefa fica com quem ditou — o cartão avisa.
      const pessoa = usersRef.current.find((u) => u.id === t.responsavelId) ?? quem;
      const prazo = isoParaData(t.prazo) ?? new Date();
      const [h, m] = t.hora ? t.hora.split(":").map(Number) : [23, 59];
      prazo.setHours(h ?? 23, m ?? 59, 0, 0);
      createTask({
        title: t.titulo,
        description: t.descricao || undefined,
        sector: pessoa.sector,
        createdBy: quem.id,
        assigneeId: pessoa.id,
        mentions: pessoa.id !== quem.id ? [pessoa.id] : [],
        frequency: "diaria",
        status: "pendente",
        score: 20,
        dueDate: prazo.toISOString(),
        recurring: false,
        priority: t.prioridade,
        tags: ["voz"],
      });
    }
    toast.success(lista.length === 1 ? "Tarefa criada" : `${lista.length} tarefas criadas`);
    tarefasRef.current = [];
    aoFechar();
  };

  const faseDaVoz = pausado ? "pausado" : ocupado && !falandoAgora ? "processando" : "ouvindo";
  const rotuloEstado = pausado
    ? "Pausado"
    : semMicrofone
      ? "Sem microfone"
      : estadoMic === "pedindo"
        ? "Aguardando microfone"
        : faseDaVoz === "processando"
          ? "Organizando"
          : "Ouvindo";

  const placeholder = semMicrofone
    ? "Sem acesso ao microfone. Libere o microfone nas permissões para ditar."
    : estadoMic === "pedindo"
      ? "Aguardando a permissão do microfone…"
      : "Fale naturalmente. Ex.: “uma tarefa para a Ana conferir as notas até sexta”.";

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="voz-titulo"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[180] overflow-y-auto text-sidebar-foreground"
    >
      <TravaScroll />

      {/* Fundo: escurece e desfoca o app, com uma lavagem da cor de destaque
          embaixo, atrás da faixa de voz, e uma grade de pontos que some nas
          bordas — o "HUD". */}
      <div className="fixed inset-0 bg-black/75 backdrop-blur-md" onClick={() => void fechar()} />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(70% 42% at 50% 90%, color-mix(in oklab, var(--sidebar-primary) 16%, transparent), transparent 70%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(color-mix(in oklab, var(--sidebar-primary) 30%, transparent) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage: "radial-gradient(ellipse 60% 55% at 50% 50%, black 20%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 60% 55% at 50% 50%, black 20%, transparent 75%)",
        }}
      />

      {/* A caixa em cima e a faixa de voz embaixo, as duas na MESMA largura.
          Com vários pedidos ditados juntos, os cartões das tarefas é que
          precisam de espaço, então a caixa ocupa a largura e a altura da tela
          e a voz acompanha por baixo. */}
      <div className="pointer-events-none relative flex min-h-full flex-col items-center justify-center gap-3 px-6 py-8">
        {/* ------------ Em cima: a caixa ------------ */}
        <motion.section
          initial={{ opacity: 0, y: -24, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -16, filter: "blur(6px)" }}
          transition={{ type: "spring", stiffness: 240, damping: 30 }}
          className="pointer-events-auto relative flex w-full max-w-310 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-sidebar/85 backdrop-blur-xl"
          style={{
            // O que sobra da tela depois da faixa de voz e das margens, sem
            // ficar menor que o necessário para os cartões nem gigante num
            // monitor alto.
            height: `clamp(400px, calc(100vh - ${alturaDaFaixa + 94}px), 720px)`,
            boxShadow:
              "0 0 0 1px color-mix(in oklab, var(--sidebar-primary) 16%, transparent), 0 30px 80px -24px rgba(0,0,0,.65), 0 0 90px -34px var(--sidebar-primary)",
          }}
        >
          {/* Filete de luz na borda de baixo — o vidro pegando o brilho da
              faixa de voz logo abaixo. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-16 bottom-0 h-px bg-gradient-to-r from-transparent via-sidebar-primary/70 to-transparent"
          />

          <header className="flex items-center gap-3 px-6 pb-4 pt-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/15 text-sidebar-primary">
              <AudioLines className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="voz-titulo" className="text-base font-semibold tracking-tight">
                Tarefa por voz
              </h2>
              <p className="truncate text-[12px] text-sidebar-foreground/55">
                Dite quantos pedidos quiser: para quem é, o que fazer e até quando. Para corrigir, é
                só falar.
              </p>
            </div>
            <Estado rotulo={rotuloEstado} aceso={escutando} rodada={rodada} />
            <button
              type="button"
              onClick={() => void fechar()}
              aria-label="Fechar"
              className="rounded-full p-1.5 text-sidebar-foreground/60 transition hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidebar-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {/* A coluna estreita conta o que está acontecendo; a larga mostra o
              resultado — as tarefas são o que se vem aqui revisar.
              `minmax(0, …)` e não `1fr` puro: `1fr` não encolhe abaixo do
              conteúdo, e as colunas mudavam de largura conforme a frase
              ditada crescia — a caixa inteira "respirava" de lado. */}
          <div className="grid min-h-0 flex-1 gap-6 px-6 pb-4 lg:grid-cols-[minmax(280px,0.78fr)_minmax(0,2fr)]">
            {/* Coluna 1: o que está sendo dito + o que a IA está fazendo */}
            <div className="flex min-h-0 flex-col gap-4">
              <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
                <Rotulo>Você está dizendo</Rotulo>
                {/* Altura FIXA, como legenda ao vivo: crescendo com o texto, a
                    caixa empurrava a lista de baixo para dentro do rodapé.
                    O texto começa no topo e só rola quando passa da caixa; o
                    esmaecido do topo só aparece quando rolou. */}
                <div
                  ref={falaRef}
                  className={`mt-2 overflow-hidden ${compacto ? "h-24" : "h-36"}`}
                  style={
                    falaTransbordou
                      ? {
                          maskImage: "linear-gradient(to bottom, transparent, black 30%)",
                          WebkitMaskImage: "linear-gradient(to bottom, transparent, black 30%)",
                        }
                      : undefined
                  }
                >
                  <p className="text-[15px] leading-6" aria-live="off">
                    {trechos.length === 0 && !falandoAgora && transcrevendo === 0 ? (
                      <span className="text-sidebar-foreground/35">{placeholder}</span>
                    ) : (
                      <>
                        {/* A frase mais nova em destaque; as anteriores recuam. */}
                        {trechos.map((t, i) => (
                          <span
                            key={i}
                            className={
                              i === trechos.length - 1
                                ? "text-sidebar-foreground/90"
                                : "text-sidebar-foreground/50"
                            }
                          >
                            {t}{" "}
                          </span>
                        ))}
                        {(falandoAgora || transcrevendo > 0) && <Reticencias />}
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
                <Rotulo>Organizando</Rotulo>
                {/* Só as últimas linhas, e as mais velhas se apagando por cima:
                    é um registro do que está acontecendo AGORA, não um
                    histórico para ler. */}
                <ul
                  className="mt-2 flex h-32 flex-col justify-end gap-2 overflow-hidden lg:h-auto lg:min-h-0 lg:flex-1"
                  aria-live="polite"
                  style={{
                    maskImage: "linear-gradient(to bottom, transparent, black 38%)",
                    WebkitMaskImage: "linear-gradient(to bottom, transparent, black 38%)",
                  }}
                >
                  <AnimatePresence initial={false}>
                    {log.slice(-10).map((l) => (
                      <motion.li
                        key={l.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: "spring", stiffness: 380, damping: 32 }}
                        className="flex min-w-0 items-center gap-2 text-[13px]"
                      >
                        {l.erro ? (
                          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-300" />
                        ) : l.feito ? (
                          <Check
                            className={`h-3.5 w-3.5 shrink-0 ${l.destaque ? "text-sidebar-primary" : "text-sidebar-primary/70"}`}
                          />
                        ) : (
                          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-sidebar-primary/25 border-t-sidebar-primary" />
                        )}
                        <span
                          className={`shrink-0 ${l.destaque ? "font-semibold text-sidebar-foreground" : "text-sidebar-foreground/75"}`}
                        >
                          {l.texto}
                          {!l.feito && "…"}
                        </span>
                        {l.resultado && (
                          <span
                            className={`min-w-0 truncate ${l.erro ? "text-red-300" : "text-sidebar-primary"}`}
                            title={l.resultado}
                          >
                            → {l.resultado}
                          </span>
                        )}
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </div>
            </div>

            {/* Coluna 2: as tarefas que já saíram */}
            <div className="flex min-h-0 flex-col">
              <div className="flex items-baseline justify-between">
                <Rotulo>Tarefas geradas</Rotulo>
                <span className="text-[12px] tabular-nums text-sidebar-foreground/55">
                  {tarefas.length} {tarefas.length === 1 ? "tarefa" : "tarefas"}
                </span>
              </div>
              {/* Contêiner de consulta: a grade decide as colunas pela largura
                  DESTA área, não da janela — duas colunas só quando cada
                  cartão ainda cabe grande. */}
              <div
                ref={listaDeTarefasRef}
                className="@container mt-3 max-h-96 min-h-40 flex-1 overflow-y-auto pr-1 lg:max-h-none lg:min-h-0"
              >
                {tarefas.length === 0 ? (
                  <div className="flex h-full min-h-40 items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 text-center text-[13px] text-sidebar-foreground/40">
                    As tarefas aparecem aqui conforme você fala — cada pedido vira um cartão.
                  </div>
                ) : (
                  <ul className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
                    <AnimatePresence initial={false}>
                      {tarefas.map((t, i) => (
                        <CartaoDeTarefa
                          key={t.ref}
                          numero={i + 1}
                          tarefa={t}
                          pessoa={users.find((u) => u.id === t.responsavelId)}
                          meuId={currentUser.id}
                          aoDescartar={() => descartar(t.ref)}
                        />
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </div>
            </div>
          </div>

          <footer className="flex flex-wrap items-center gap-3 border-t border-white/[0.07] px-6 py-3.5">
            <button
              type="button"
              // O foco entra no modal pelo controle principal: quem abriu pelo
              // teclado já está no botão que pausa a escuta.
              autoFocus
              onClick={() => setPausado((p) => !p)}
              aria-pressed={pausado}
              aria-label={pausado ? "Retomar o microfone" : "Pausar o microfone"}
              title={pausado ? "Retomar" : "Pausar"}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-primary ${
                pausado
                  ? "bg-white/10 text-sidebar-foreground hover:bg-white/15"
                  : "bg-sidebar-primary text-sidebar-primary-foreground hover:brightness-110"
              }`}
            >
              {pausado ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <p className="min-w-0 flex-1 text-[11px] leading-snug text-sidebar-foreground/55">
              {legendaDoMicrofone(estadoMic, pausado, semSuporte)}
            </p>
            <button
              type="button"
              onClick={recomecar}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-sidebar-foreground/70 transition hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidebar-primary"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Recomeçar
            </button>
            {/* Travado enquanto ainda há frase sendo organizada: criar ali
                deixaria de fora justamente a última coisa que a pessoa disse. */}
            <button
              type="button"
              onClick={criar}
              disabled={tarefas.length === 0 || ocupado}
              className="rounded-full bg-sidebar-primary px-4 py-2 text-xs font-semibold text-sidebar-primary-foreground shadow-[0_0_24px_-6px_var(--sidebar-primary)] transition hover:brightness-110 disabled:opacity-35 disabled:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-primary"
            >
              {ocupado && tarefas.length > 0
                ? "Organizando…"
                : tarefas.length === 0
                  ? "Criar tarefas"
                  : `Criar ${tarefas.length} ${tarefas.length === 1 ? "tarefa" : "tarefas"}`}
            </button>
          </footer>
        </motion.section>

        {/* ------------ Embaixo: a faixa de voz ------------
            Entra se abrindo do centro para as bordas, como se esticasse até a
            largura da caixa. O recorte vertical é negativo de propósito: sem
            folga, ele cortaria a aura desfocada em cima e embaixo. */}
        <motion.div
          initial={{ opacity: 0, clipPath: "inset(-60% 50% -60% 50%)" }}
          animate={{ opacity: 1, clipPath: "inset(-60% -6% -60% -6%)" }}
          exit={{ opacity: 0, clipPath: "inset(-60% 50% -60% 50%)" }}
          transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1], delay: 0.12 }}
          className="pointer-events-auto flex w-full max-w-310 flex-col items-center"
        >
          <FaixaDeVoz
            fase={faseDaVoz}
            falando={false}
            leituraRef={leituraRef}
            altura={alturaDaFaixa}
          />
          <span className="-mt-2 text-[11px] font-medium uppercase tracking-[0.32em] text-sidebar-foreground/55">
            {rotuloEstado}
          </span>
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Peças                                                                */
/* ------------------------------------------------------------------ */

function Rotulo({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/45">
      {children}
    </div>
  );
}

/** Três pontos respirando: há fala sendo ouvida ou transcrita. */
function Reticencias() {
  return (
    <span className="inline-flex translate-y-[-2px] gap-1 align-middle" aria-hidden="true">
      {[0, 150, 300].map((atraso) => (
        <span
          key={atraso}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-sidebar-primary"
          style={{ animationDelay: `${atraso}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * O que o microfone está fazendo, dito para a pessoa.
 *
 * A legenda diz para onde a voz vai: microfone aceso num app de trabalho, sem
 * explicação, é a primeira coisa que gera desconfiança.
 */
function legendaDoMicrofone(estado: EstadoMicrofone, pausado: boolean, semSuporte: boolean) {
  if (pausado) return "Microfone pausado. O que já foi ditado continua na lista.";
  if (semSuporte) return "Este navegador não consegue gravar áudio.";
  switch (estado) {
    case "pedindo":
      return "Pedindo acesso ao microfone…";
    case "ativo":
      return "Cada frase é enviada para transcrição (OpenAI). O app não guarda o áudio.";
    case "negado":
      return "Sem permissão para o microfone. Libere nas configurações do navegador ou do app.";
    case "indisponivel":
      return "Nenhum microfone encontrado.";
    default:
      return "";
  }
}

/** "● Ouvindo 00:14" — o estado e há quanto tempo a escuta está aberta. */
function Estado({ rotulo, aceso, rodada }: { rotulo: string; aceso: boolean; rodada: number }) {
  return (
    <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium sm:inline-flex">
      <span className="relative flex h-2 w-2">
        {aceso && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sidebar-primary opacity-60" />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${aceso ? "bg-sidebar-primary" : "bg-sidebar-foreground/40"}`}
        />
      </span>
      {rotulo}
      {/* A chave zera o cronômetro ao recomeçar. */}
      <Cronometro key={rodada} pausado={!aceso} />
    </span>
  );
}

function Cronometro({ pausado }: { pausado: boolean }) {
  const [segundos, setSegundos] = useState(0);
  useEffect(() => {
    if (pausado) return;
    const id = window.setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [pausado]);
  const mm = String(Math.floor(segundos / 60)).padStart(2, "0");
  const ss = String(segundos % 60).padStart(2, "0");
  return <span className="font-mono tabular-nums text-sidebar-foreground/55">{`${mm}:${ss}`}</span>;
}

const PRIORIDADE: Record<Prioridade, { rotulo: string; classe: string }> = {
  alta: { rotulo: "Alta", classe: "bg-red-500/15 text-red-300" },
  media: { rotulo: "Média", classe: "bg-amber-400/15 text-amber-200" },
  baixa: { rotulo: "Baixa", classe: "bg-white/[0.06] text-sidebar-foreground/70" },
};

/**
 * Uma tarefa que acabou de sair da fala.
 *
 * Grande de propósito: vários pedidos saem de uma vez e a pessoa revisa todos
 * antes de criar, então cada cartão precisa ser lido de relance. Por isso os
 * três dados que decidem a tarefa — para quem, até quando, com que urgência —
 * ficam numa linha própria, cada um com o seu rótulo.
 *
 * O número é a ordem na lista: é como a pessoa se refere a ela ao corrigir
 * ("a terceira está com o prazo errado").
 *
 * Ele "materializa": entra desfocado e uma faixa de luz passa por cima uma vez.
 * É o momento em que a fala virou tarefa — vale um efeito, e só um.
 */
function CartaoDeTarefa({
  tarefa: t,
  numero,
  pessoa,
  meuId,
  aoDescartar,
}: {
  tarefa: TarefaDitada;
  numero: number;
  pessoa: User | undefined;
  meuId: string;
  aoDescartar: () => void;
}) {
  const p = PRIORIDADE[t.prioridade];
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.96, filter: "blur(4px)" }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] p-4"
    >
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-sidebar-primary/25 to-transparent"
        initial={{ x: "0%" }}
        animate={{ x: "400%" }}
        transition={{ duration: 1.1, ease: "easeOut" }}
      />
      <div className="flex items-start gap-3">
        <span className="mt-1 font-mono text-[11px] font-semibold tabular-nums text-sidebar-primary/80">
          {String(numero).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-snug text-sidebar-foreground">
            {t.titulo}
          </h3>
          {t.descricao && (
            <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-sidebar-foreground/60">
              {t.descricao}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={aoDescartar}
          aria-label={`Descartar "${t.titulo}"`}
          title="Descartar"
          className="rounded-full p-1.5 text-sidebar-foreground/40 opacity-0 transition hover:bg-white/10 hover:text-sidebar-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* `mt-auto` no invólucro: na grade de duas colunas, cartões lado a lado
          têm a altura do maior, e os dados ficam alinhados embaixo nos dois. O
          `pt-4` é o respiro mínimo quando o cartão já é o mais alto. */}
      <div className="mt-auto pt-4">
        {/* O detalhe de cada campo (você, a hora, "não dito") vai numa segunda
            linha menor: na mesma linha, "Reginaldo Junior (você)" e
            "seg, 14/09 · 15:00" eram cortados no meio. */}
        <dl className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] gap-3 border-t border-white/[0.07] pt-3">
          <Campo rotulo="Para">
            {pessoa ? (
              <>
                <UserAvatar
                  nome={pessoa.name}
                  iniciais={pessoa.avatar || pessoa.name.slice(0, 1)}
                  className="h-7 w-7 text-[10px]"
                />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate">{nomeCurto(pessoa.name)}</span>
                  {pessoa.id === meuId && (
                    <span className="text-[11px] text-sidebar-foreground/45">você</span>
                  )}
                </span>
              </>
            ) : (
              // Sem nome reconhecido a tarefa fica com quem ditou, e isso tem
              // que estar escrito — senão "Você" parece um acerto da IA.
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate">Você</span>
                <span className="truncate text-[11px] text-amber-300/90">nome não reconhecido</span>
              </span>
            )}
          </Campo>
          <Campo rotulo="Prazo">
            <CalendarDays className="h-4 w-4 shrink-0 text-sidebar-primary/80" />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate">
                {isoParaData(t.prazo) ? rotuloDia(isoParaData(t.prazo)!) : "Hoje"}
              </span>
              {(t.hora || !t.prazo) && (
                <span className="truncate text-[11px] text-sidebar-foreground/45">
                  {t.hora ? `às ${t.hora}` : "prazo não dito"}
                </span>
              )}
            </span>
          </Campo>
          <Campo rotulo="Prioridade">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${p.classe}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {p.rotulo}
            </span>
          </Campo>
        </dl>
      </div>
    </motion.li>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
        {rotulo}
      </dt>
      <dd className="mt-1.5 flex min-h-7 min-w-0 items-center gap-2 text-[13.5px] text-sidebar-foreground/90">
        {children}
      </dd>
    </div>
  );
}
