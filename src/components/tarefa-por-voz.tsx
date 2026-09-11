import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AudioLines, CalendarDays, Check, Mic, MicOff, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { useFluxo } from "@/lib/fluxo-store";
import type { User } from "@/lib/fluxo-types";
import { useMicrofone, type EstadoMicrofone } from "@/lib/use-microfone";
import { ALTURA_DA_FAIXA, FaixaDeVoz } from "@/components/faixa-de-voz";
import { UserAvatar } from "@/components/user-avatar";
import { TravaScroll } from "@/components/trava-scroll";

/**
 * Tarefa por voz — PRÉVIA VISUAL.
 *
 * A pessoa dita, a IA organiza, e as tarefas vão aparecendo prontas: título,
 * para quem e prazo. Várias em sequência, sem parar de falar.
 *
 * Hoje a IA ainda não está ligada. O que é real: a faixa de voz reage ao
 * microfone. O que é demonstração: a transcrição, os passos de organização e as
 * tarefas — um roteiro fixo que mostra como vai ficar. Por isso o botão de criar
 * NÃO cria nada: gravar no banco tarefas que ninguém ditou seria inventar
 * trabalho na fila de pessoas reais.
 *
 * Quando a IA chegar, o roteiro sai e entra o que ela devolver — a tela já
 * está desenhada para receber a mesma coisa: trechos de fala, passos e tarefas.
 */

type Prioridade = "alta" | "media" | "baixa";

interface TarefaGerada {
  id: number;
  titulo: string;
  descricao: string;
  /** `curto` é nome e sobrenome — no cartão grande o primeiro nome sozinho
      confunde quando há duas pessoas com ele. */
  pessoa: { nome: string; primeiro: string; curto: string; iniciais: string };
  prazo: string;
  prioridade: Prioridade;
}

interface Passo {
  texto: string;
  resultado?: string;
}

interface Trecho {
  fala: string;
  passos: Passo[];
  tarefa: Omit<TarefaGerada, "id">;
}

interface LinhaDoLog {
  id: number;
  texto: string;
  resultado?: string;
  feito: boolean;
  destaque?: boolean;
}

/* ------------------------------------------------------------------ */
/* Roteiro de demonstração                                             */
/* ------------------------------------------------------------------ */

const capitalizar = (p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();

/** "LUCAS GABRIEL BARRETO" → "Lucas". O cadastro vem em maiúsculas da IAM. */
function primeiroNome(nome: string): string {
  return capitalizar(nome.trim().split(/\s+/)[0] ?? "");
}

/** "LUCAS GABRIEL BARRETO" → "Lucas Barreto". */
function nomeCurto(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const primeiro = partes[0] ?? "";
  const ultimo = partes.length > 1 ? partes[partes.length - 1]! : "";
  return [primeiro, ultimo].filter(Boolean).map(capitalizar).join(" ");
}

function daquiA(dias: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d;
}

/** A próxima sexta — se hoje é sexta, a da semana que vem. */
function proximaSexta(): Date {
  const hoje = new Date().getDay();
  return daquiA((5 - hoje + 7) % 7 || 7);
}

/** "sex, 12/09" */
const rotuloDia = (d: Date) =>
  d
    .toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })
    .replace(".", "");

/**
 * Três pedidos ditados em sequência, com as pessoas do cadastro de verdade.
 *
 * Pessoas reais e não "Fulano": a prévia é para mostrar como vai ficar no uso,
 * e o nome de um colega no cartão é o que faz isso ser entendido de primeira.
 * Nada disto é gravado — ver o comentário no topo do arquivo.
 *
 * "para Lucas" e não "para o Lucas": o artigo exigiria saber o gênero de cada
 * pessoa do cadastro, e errar num nome de colega fica feio justamente na demo.
 */
function montarRoteiro(pessoas: User[], meuId: string): Trecho[] {
  const outras = pessoas
    .filter((u) => u.id !== meuId && u.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  const escolher = (i: number): User | undefined =>
    outras.length > 0 ? outras[i % outras.length] : pessoas.find((u) => u.id === meuId);

  const pessoa = (u: User | undefined) => ({
    nome: u?.name ?? "Você",
    primeiro: u ? primeiroNome(u.name) : "Você",
    curto: u ? nomeCurto(u.name) : "Você",
    iniciais: u?.avatar || (u?.name ?? "V").slice(0, 1),
  });

  const [a, b, c] = [pessoa(escolher(0)), pessoa(escolher(1)), pessoa(escolher(2))];
  const sexta = rotuloDia(proximaSexta());
  const amanha = daquiA(1);
  const emSeis = daquiA(6);

  return [
    {
      fala: `Cria uma tarefa para ${a.primeiro}: revisar o relatório de fretes de setembro, conferindo os valores por rota. Precisa ficar pronto até sexta, é prioridade alta.`,
      passos: [
        { texto: "Organizando orientações" },
        { texto: "Identificando responsável", resultado: a.primeiro },
        { texto: "Interpretando prazo", resultado: sexta },
        { texto: "Definindo prioridade", resultado: "Alta" },
        { texto: "Organizando estrutura" },
      ],
      tarefa: {
        titulo: "Revisar relatório de fretes de setembro",
        descricao: "Conferir os valores por rota e apontar divergências antes do fechamento.",
        pessoa: a,
        prazo: sexta,
        prioridade: "alta",
      },
    },
    {
      fala: `Outra para ${b.primeiro}: agendar a manutenção preventiva da frota para amanhã, começando pelos veículos com revisão vencida.`,
      passos: [
        { texto: "Organizando orientações" },
        { texto: "Identificando responsável", resultado: b.primeiro },
        { texto: "Interpretando prazo", resultado: `amanhã, ${rotuloDia(amanha).split(", ")[1]}` },
        { texto: "Organizando estrutura" },
      ],
      tarefa: {
        titulo: "Agendar manutenção preventiva da frota",
        descricao:
          "Começar pelos veículos com revisão vencida e confirmar o horário com a oficina.",
        pessoa: b,
        prazo: rotuloDia(amanha),
        prioridade: "media",
      },
    },
    {
      fala: `E uma para ${c.primeiro} atualizar a planilha de EPIs do almoxarifado até dia ${emSeis.getDate()}, sinalizando o que estiver abaixo do mínimo.`,
      passos: [
        { texto: "Organizando orientações" },
        { texto: "Identificando responsável", resultado: c.primeiro },
        { texto: "Interpretando prazo", resultado: rotuloDia(emSeis) },
        { texto: "Organizando estrutura" },
      ],
      tarefa: {
        titulo: "Atualizar planilha de EPIs do almoxarifado",
        descricao: "Incluir as entregas da semana e sinalizar os itens abaixo do estoque mínimo.",
        pessoa: c,
        prazo: rotuloDia(emSeis),
        prioridade: "baixa",
      },
    },
  ];
}

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
 * microfone e cancela o roteiro. Abrir de novo começa do zero.
 */
function VozAberta({ aoFechar }: { aoFechar: () => void }) {
  const { users, currentUser } = useFluxo();
  const [pausado, setPausado] = useState(false);
  const { estado: estadoMic, leituraRef } = useMicrofone(!pausado);

  const [rodada, setRodada] = useState(0);
  const [fase, setFase] = useState<"ouvindo" | "processando">("ouvindo");
  const [falando, setFalando] = useState(false);
  const [fala, setFala] = useState({ firmes: "", provisorias: "" });
  const [log, setLog] = useState<LinhaDoLog[]>([]);
  const [tarefas, setTarefas] = useState<TarefaGerada[]>([]);
  const [terminou, setTerminou] = useState(false);

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

  /* A fala rola sozinha até o fim quando passa da caixa. */
  const falaRef = useRef<HTMLDivElement>(null);
  const [falaTransbordou, setFalaTransbordou] = useState(false);
  useEffect(() => {
    const caixa = falaRef.current;
    if (!caixa) return;
    const transborda = caixa.scrollHeight > caixa.clientHeight + 1;
    caixa.scrollTop = transborda ? caixa.scrollHeight : 0;
    setFalaTransbordou(transborda);
  }, [fala, compacto]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  /* Pausa e pessoas entram no roteiro por ref: o roteiro é um laço assíncrono
     que precisa do valor ATUAL a cada espera, e recriá-lo a cada mudança
     recomeçaria a demonstração do zero. */
  const pausadoRef = useRef(pausado);
  useEffect(() => {
    pausadoRef.current = pausado;
  }, [pausado]);
  const pessoasRef = useRef(users);
  useEffect(() => {
    pessoasRef.current = users;
  }, [users]);

  useEffect(() => {
    const roteiro = montarRoteiro(pessoasRef.current, currentUser.id);
    let cancelado = false;
    const CANCELADO = Symbol("cancelado");

    /** Espera que para o relógio durante a pausa, e aborta ao fechar. */
    const espera = async (ms: number) => {
      let falta = ms;
      while (falta > 0) {
        if (cancelado) throw CANCELADO;
        const passo = Math.min(falta, 50);
        await new Promise((r) => setTimeout(r, passo));
        if (!pausadoRef.current) falta -= passo;
      }
      if (cancelado) throw CANCELADO;
    };

    let seq = 0;
    void (async () => {
      try {
        await espera(900);
        for (const trecho of roteiro) {
          setFase("ouvindo");
          setFalando(true);
          /* Palavra por palavra, como uma transcrição ao vivo: as duas últimas
             ficam "provisórias" (mais apagadas) até a seguinte chegar — é assim
             que o reconhecimento de voz de verdade se comporta, corrigindo o
             fim da frase enquanto a pessoa ainda fala. */
          const palavras = trecho.fala.split(" ");
          for (let i = 1; i <= palavras.length; i++) {
            const corte = Math.max(0, i - 2);
            setFala({
              firmes: palavras.slice(0, corte).join(" "),
              provisorias: palavras.slice(corte, i).join(" "),
            });
            const pausaDePontuacao = /[,.:]$/.test(palavras[i - 1] ?? "") ? 280 : 0;
            await espera(140 + Math.random() * 160 + pausaDePontuacao);
          }
          setFala({ firmes: trecho.fala, provisorias: "" });
          setFalando(false);
          await espera(450);

          setFase("processando");
          for (const passo of trecho.passos) {
            const id = ++seq;
            setLog((l) => [...l, { id, texto: passo.texto, feito: false }]);
            await espera(480 + Math.random() * 380);
            setLog((l) =>
              l.map((x) => (x.id === id ? { ...x, feito: true, resultado: passo.resultado } : x)),
            );
          }
          const idTarefa = ++seq;
          setTarefas((ts) => [...ts, { ...trecho.tarefa, id: idTarefa }]);
          setLog((l) => [
            ...l,
            {
              id: ++seq,
              texto: "Tarefa pronta",
              resultado: trecho.tarefa.titulo,
              feito: true,
              destaque: true,
            },
          ]);
          await espera(1100);
          setFala({ firmes: "", provisorias: "" });
          setFase("ouvindo");
          await espera(600);
        }
        setTerminou(true);
      } catch (e) {
        if (e !== CANCELADO) throw e;
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [rodada, currentUser.id]);

  /* A tarefa que acabou de sair é a que importa naquele instante. A partir da
     terceira ela nasce abaixo da dobra, e sem rolar até ela o contador subia
     para "3" com a lista mostrando só duas — parecendo que a terceira sumiu. */
  const listaDeTarefasRef = useRef<HTMLDivElement>(null);
  const qtdTarefas = tarefas.length;
  useEffect(() => {
    const lista = listaDeTarefasRef.current;
    if (!lista || qtdTarefas === 0) return;
    // Espera o cartão entrar no layout antes de medir a altura.
    const id = window.setTimeout(() => {
      lista.scrollTo({ top: lista.scrollHeight, behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(id);
  }, [qtdTarefas]);

  const recomecar = useCallback(() => {
    setFala({ firmes: "", provisorias: "" });
    setLog([]);
    setTarefas([]);
    setTerminou(false);
    setFalando(false);
    setFase("ouvindo");
    setPausado(false);
    setRodada((r) => r + 1);
  }, []);

  const criar = () => {
    toast.info("Prévia: a IA ainda não está conectada", {
      description:
        "Nenhuma tarefa foi criada. Quando a IA entrar, este botão cria as tarefas da lista.",
    });
  };

  const faseDaVoz = pausado ? "pausado" : fase;
  const vazio = !fala.firmes && !fala.provisorias;

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
      <div className="fixed inset-0 bg-black/75 backdrop-blur-md" onClick={aoFechar} />
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
          Era o orbe ao lado da caixa; com vários pedidos ditados juntos, os
          cartões das tarefas é que precisam de espaço, então a caixa ocupa a
          largura e a altura da tela e a voz acompanha por baixo. */}
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
              <h2
                id="voz-titulo"
                className="flex items-center gap-2 text-base font-semibold tracking-tight"
              >
                Tarefa por voz
                <span className="rounded-full border border-sidebar-primary/40 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-sidebar-primary">
                  Prévia
                </span>
              </h2>
              <p className="truncate text-[12px] text-sidebar-foreground/55">
                Dite quantos pedidos quiser: para quem é, o que fazer e até quando.
              </p>
            </div>
            <Estado pausado={pausado} fase={fase} rodada={rodada} />
            <button
              type="button"
              onClick={aoFechar}
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
                    O texto começa no topo e só rola quando passa da caixa —
                    ancorado embaixo, uma frase curta ficava lá no pé com um
                    vazio em cima. O esmaecido do topo também só aparece
                    quando rolou: é para a frase que está saindo. */}
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
                    {vazio ? (
                      <span className="text-sidebar-foreground/35">
                        {terminou
                          ? "Pode continuar ditando — ou revise as tarefas ao lado."
                          : "Fale naturalmente. Ex.: “uma tarefa para a Ana conferir as notas até sexta”."}
                      </span>
                    ) : (
                      <>
                        <span className="text-sidebar-foreground/90">{fala.firmes}</span>{" "}
                        <span className="text-sidebar-foreground/45">{fala.provisorias}</span>
                        {falando && !pausado && (
                          <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse rounded-full bg-sidebar-primary" />
                        )}
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
                <Rotulo>Organizando</Rotulo>
                {/* Só as últimas linhas, e as mais velhas se apagando por cima:
                      é um registro do que está acontecendo AGORA, não um
                      histórico para ler. No celular a caixa não tem altura
                      fixa, então a lista ganha a dela. */}
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
                        {l.feito ? (
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
                          <span className="min-w-0 truncate text-sidebar-primary">
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
                          key={t.id}
                          numero={i + 1}
                          tarefa={t}
                          aoDescartar={() => setTarefas((ts) => ts.filter((x) => x.id !== t.id))}
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
              {legendaDoMicrofone(estadoMic, pausado)}
            </p>
            <button
              type="button"
              onClick={recomecar}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-sidebar-foreground/70 transition hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidebar-primary"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Recomeçar
            </button>
            <button
              type="button"
              onClick={criar}
              disabled={tarefas.length === 0}
              className="rounded-full bg-sidebar-primary px-4 py-2 text-xs font-semibold text-sidebar-primary-foreground shadow-[0_0_24px_-6px_var(--sidebar-primary)] transition hover:brightness-110 disabled:opacity-35 disabled:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-primary"
            >
              {tarefas.length === 0
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
            falando={falando && !pausado}
            leituraRef={leituraRef}
            altura={alturaDaFaixa}
          />
          <span className="-mt-2 text-[11px] font-medium uppercase tracking-[0.32em] text-sidebar-foreground/55">
            {pausado ? "em pausa" : fase === "processando" ? "organizando" : "ouvindo"}
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

/**
 * O que o microfone está fazendo, dito para a pessoa.
 *
 * Honestidade primeiro: é uma prévia, então a legenda diz que nada é gravado —
 * o microfone aceso sem explicação num app de trabalho é a primeira coisa que
 * gera desconfiança.
 */
function legendaDoMicrofone(estado: EstadoMicrofone, pausado: boolean): string {
  if (pausado) return "Microfone pausado.";
  switch (estado) {
    case "pedindo":
      return "Pedindo acesso ao microfone…";
    case "ativo":
      return "O microfone só anima a faixa de voz — nada é gravado nem enviado.";
    case "negado":
      return "Sem permissão para o microfone — a faixa de voz está em modo simulado.";
    case "indisponivel":
      return "Nenhum microfone encontrado — a faixa de voz está em modo simulado.";
    default:
      return "";
  }
}

/** "● Ouvindo 00:14" — a fase e há quanto tempo a escuta está aberta. */
function Estado({
  pausado,
  fase,
  rodada,
}: {
  pausado: boolean;
  fase: "ouvindo" | "processando";
  rodada: number;
}) {
  const rotulo = pausado ? "Pausado" : fase === "processando" ? "Organizando" : "Ouvindo";
  return (
    <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium sm:inline-flex">
      <span className="relative flex h-2 w-2">
        {!pausado && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sidebar-primary opacity-60" />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${pausado ? "bg-sidebar-foreground/40" : "bg-sidebar-primary"}`}
        />
      </span>
      {rotulo}
      {/* A chave zera o cronômetro ao recomeçar. */}
      <Cronometro key={rodada} pausado={pausado} />
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
 * ficam numa linha própria, cada um com o seu rótulo, e não misturados em
 * etiquetas.
 *
 * O número é a ordem em que foi ditada: é como a pessoa se refere a ela
 * ("a terceira está com o prazo errado").
 *
 * Ele "materializa": entra desfocado e uma faixa de luz passa por cima uma vez.
 * É o momento em que a fala virou tarefa, e é o que a tela existe para mostrar
 * — vale um efeito, e só um.
 */
function CartaoDeTarefa({
  tarefa: t,
  numero,
  aoDescartar,
}: {
  tarefa: TarefaGerada;
  numero: number;
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
          <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-sidebar-foreground/60">
            {t.descricao}
          </p>
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
        <dl className="grid grid-cols-[1.4fr_1fr_1fr] gap-3 border-t border-white/[0.07] pt-3">
          <Campo rotulo="Para">
            <UserAvatar
              nome={t.pessoa.nome}
              iniciais={t.pessoa.iniciais}
              className="h-7 w-7 text-[10px]"
            />
            <span className="truncate">{t.pessoa.curto}</span>
          </Campo>
          <Campo rotulo="Prazo">
            <CalendarDays className="h-4 w-4 shrink-0 text-sidebar-primary/80" />
            <span className="truncate">{t.prazo}</span>
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
