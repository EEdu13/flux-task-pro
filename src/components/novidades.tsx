import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, animate, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Cake,
  CalendarCheck,
  Captions,
  Check,
  Coffee,
  Download,
  FileSpreadsheet,
  Flame,
  Heart,
  ImageIcon,
  Loader2,
  Megaphone,
  MessageCircle,
  Mic,
  Monitor,
  Pause,
  PhoneOff,
  Play,
  Send,
  Shirt,
  Smile,
  Sparkles,
  Square,
  Timer,
  Trophy,
  Video,
  X,
} from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { primeiroNome } from "@/integrations/iam/types";

/**
 * "O que mudou" — a janela de novidades que aparece UMA vez por pessoa,
 * depois do login (pedido do usuário, 08/10/2026). A pessoa vai passando as
 * telas; ao terminar ou fechar, não volta mais.
 *
 * Para a próxima leva de novidades, troque `VERSAO` e as `TELAS`: quem já viu
 * a versão anterior vê a nova uma vez.
 *
 * O "já vi" fica no banco (`gestor.preferencias`, chave "novidades"), para
 * não reaparecer em outro computador, e numa cópia local, para não piscar
 * enquanto o servidor responde.
 *
 * As ilustrações são miniaturas da tela de verdade, desenhadas aqui — e não
 * prints: seguem o tema e a paleta de cada pessoa e não envelhecem quando a
 * tela muda de cor. Cada uma é um "vídeo" curto, como nas apresentações do
 * WhatsApp: a novidade sendo usada, com o cursor clicando (pedido de 19/10).
 * Tudo em 2D, sem WebGL — abre em qualquer computador.
 *
 * Para ver de novo sem mexer no banco: `?novidades=1` na URL.
 */
const VERSAO = "2026-10-20-avatar-e-mural";

const chaveLocal = (pessoaId: string) => `fluxo:novidades:${pessoaId}`;

type Tela = {
  titulo: string;
  texto: string;
  Ilustracao: (p: { pessoaId: string }) => React.ReactElement;
};

/* A leva de 20/10/2026: avatar 3D, Mural, escritório 3D, recado de voz e
   gravação de tela, a ata nova com legenda, e o que mais entrou desde 14/10. */
export const TELAS: Tela[] = [
  {
    titulo: "Agora você tem um avatar 3D!",
    texto:
      "Monte o seu em Configurações → Meu avatar: rosto, cabelo, roupa, acessórios — tem até o uniforme da empresa, a camisa social azul com as bandeiras do Brasil e do Paraná e a polo azul-marinho. Ele aparece no Mural, no chat e no escritório 3D.",
    Ilustracao: IlustracaoAvatar,
  },
  {
    titulo: "Chegou o Mural",
    texto:
      "O lugar das notícias da empresa: comunicados, eventos, enquetes e elogios. Os aniversários, o tempo de casa e as boas-vindas aparecem sozinhos — e quando o time inteiro fecha 100% das tarefas da semana, o Mural comemora com todo mundo abraçado.",
    Ilustracao: IlustracaoMural,
  },
  {
    titulo: "O escritório em 3D",
    texto:
      "Em Contatos → Escritório 3D você vê a empresa inteira: cada setor com as suas mesas, as gerências, a diretoria, as salas de reunião e a recepção. Quem está ausente vai tomar um café no refeitório, e quem está ocupado aparece com a mesa cheia de papel.",
    Ilustracao: IlustracaoEscritorio,
  },
  {
    titulo: "Reaja com o seu avatar",
    texto:
      "No chat, além dos emojis, a caixinha Avatar traz 12 reações animadas com o seu boneco: “você é top” com troféu, joinha, bora, pausa pro café… E dá para colocar um status com emoji e até quando ele vale — “🏖️ De férias até sexta”.",
    Ilustracao: IlustracaoReacoes,
  },
  {
    titulo: "Recado de voz e gravação de tela",
    texto:
      "Em vez de escrever um textão, grave: o microfone manda um recado de até 3 minutos e o “Gravar tela” mostra o passo a passo em até 2 minutos. Funciona no chat, nos comentários e ao criar tarefa — e o recado já toca direto no cartão da tarefa.",
    Ilustracao: IlustracaoVoz,
  },
  {
    titulo: "Reunião com legenda e ata de verdade",
    texto:
      "Ligue a Ata: o que cada um fala aparece como legenda embaixo do vídeo, e tudo é transcrito com o nome de quem falou. No fim, a ata sai pronta em Atas & Planos — resumo, decisões e próximos passos —, com a transcrição completa e o áudio de cada trecho para conferir.",
    Ilustracao: IlustracaoReuniao,
  },
  {
    titulo: "Sua ofensiva da semana",
    texto:
      "No Início, a ofensiva mostra os dias da semana em que você deu conta do recado — e o seu avatar fica feliz, preocupado ou tristinho conforme ela vai. E todo dia ele te recebe com um bom-dia.",
    Ilustracao: IlustracaoOfensiva,
  },
  {
    titulo: "Aniversário com festa",
    texto:
      "No seu aniversário, o CONECTA abre com chuva de confete, e o seu avatar usa chapéu de festa o dia todo — no Mural, no chat e no escritório 3D. O time deixa os parabéns nos comentários do seu cartão no Mural.",
    Ilustracao: IlustracaoAniversario,
  },
  {
    titulo: "E mais",
    texto:
      "Minhas tarefas exporta para Excel (até as concluídas), a reunião mostra quanto tempo durou, dá para colar imagem direto no Mural e no chat, e quem estava com a agenda travada sem conseguir salvar já consegue.",
    Ilustracao: IlustracaoMais,
  },
];

/**
 * A tela do "Meu mês", guardada para a leva do lançamento (dia 30): ele está
 * escondido até lá — ver `meu-mes-liberado.ts`.
 */
export const TELA_DO_MEU_MES: Tela = {
  titulo: "Todo dia 1º: o seu mês",
  texto:
    "No primeiro dia de cada mês, às 6:30, chega a retrospectiva do mês que passou, no estilo Spotify Wrapped: tarefas concluídas, quanto foi no prazo, o seu melhor dia, o tempo cronometrado, a sequência do pack e os agradecimentos. Dá para rever quando quiser em Meu mês.",
  Ilustracao: IlustracaoMeuMes,
};

export function Novidades() {
  const { currentUser, isAuthenticated } = useFluxo();
  const [aberta, setAberta] = useState(false);
  const [indice, setIndice] = useState(0);
  const [sentido, setSentido] = useState(1);

  /* Decide se mostra: a cópia local responde na hora; sem ela, pergunta ao
     banco — a pessoa pode ter visto em outro computador. */
  useEffect(() => {
    if (!isAuthenticated || !currentUser.id) return;
    if (new URLSearchParams(window.location.search).get("novidades") === "1") {
      setIndice(0);
      setAberta(true);
      return;
    }
    try {
      if (localStorage.getItem(chaveLocal(currentUser.id)) === VERSAO) return;
    } catch {
      /* sem armazenamento: segue para o banco */
    }
    let vivo = true;
    import("@/lib/perfil.functions")
      .then((m) => m.minhasPreferencias())
      .then((p) => {
        if (!vivo) return;
        if (p.novidades === VERSAO) {
          try {
            localStorage.setItem(chaveLocal(currentUser.id), VERSAO);
          } catch {
            /* ok */
          }
          return;
        }
        // Um respiro depois do login, para não brigar com a tela entrando.
        window.setTimeout(() => vivo && setAberta(true), 1200);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [isAuthenticated, currentUser.id]);

  const marcarComoVista = () => {
    setAberta(false);
    try {
      localStorage.setItem(chaveLocal(currentUser.id), VERSAO);
    } catch {
      /* o banco guarda */
    }
    void import("@/lib/perfil.functions")
      .then((m) => m.salvarPreferencia({ data: { chave: "novidades", valor: VERSAO } }))
      .catch(() => {});
  };

  const ir = (para: number) => {
    setSentido(para > indice ? 1 : -1);
    setIndice(para);
  };

  const ultima = indice === TELAS.length - 1;
  const tela = TELAS[indice]!;
  const nome = primeiroNome(currentUser.name);

  return (
    <DialogPrimitive.Root open={aberta} onOpenChange={(v) => !v && marcarComoVista()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[480] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[481] w-[min(92vw,36rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" && !ultima) ir(indice + 1);
            if (e.key === "ArrowLeft" && indice > 0) ir(indice - 1);
          }}
        >
          <DialogPrimitive.Close
            className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label="Fechar novidades"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>

          {/* A ilustração, num palco com o fundo do app. */}
          <div className="relative flex h-64 items-center justify-center overflow-hidden bg-gradient-to-br from-primary/15 via-background to-secondary/60">
            <AnimatePresence mode="wait" custom={sentido}>
              <motion.div
                key={indice}
                custom={sentido}
                initial={{ opacity: 0, x: 40 * sentido }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 * sentido }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="flex h-full w-full items-center justify-center"
              >
                <tela.Ilustracao pessoaId={currentUser.id} />
              </motion.div>
            </AnimatePresence>
            <span className="absolute left-4 top-3 rounded-full bg-card/80 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground shadow-sm">
              Novidade {indice + 1} de {TELAS.length}
            </span>
          </div>

          <div className="px-6 pb-5 pt-4">
            <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
              {indice === 0 && nome ? `${nome}, agora você tem um avatar 3D!` : tela.titulo}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1.5 min-h-[5.5rem] text-sm leading-relaxed text-muted-foreground">
              {tela.texto}
            </DialogPrimitive.Description>

            <div className="mt-4 flex items-center gap-3">
              {/* Os pontinhos: onde a pessoa está, e atalho para qualquer tela. */}
              <div
                className="flex items-center gap-1.5"
                role="tablist"
                aria-label="Telas de novidades"
              >
                {TELAS.map((t, i) => (
                  <button
                    key={t.titulo}
                    type="button"
                    role="tab"
                    aria-selected={i === indice}
                    aria-label={`Tela ${i + 1}: ${t.titulo}`}
                    onClick={() => ir(i)}
                    className={`h-2 rounded-full transition-all ${
                      i === indice ? "w-6 bg-primary" : "w-2 bg-border hover:bg-muted-foreground"
                    }`}
                  />
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {indice > 0 && (
                  <button
                    type="button"
                    onClick={() => ir(indice - 1)}
                    className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" /> Voltar
                  </button>
                )}
                <button
                  type="button"
                  autoFocus
                  onClick={() => (ultima ? marcarComoVista() : ir(indice + 1))}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110"
                >
                  {ultima ? "Bora usar!" : "Próximo"}
                  {!ultima && <ArrowRight className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ————— Ilustrações ————— */

/*
 * Cada ilustração é um "vídeo" curto, no estilo das apresentações do
 * WhatsApp: uma cena roteirizada que se repete, com um cursor clicando nas
 * coisas. O roteiro é uma lista de passos (`Passo`), cada um com a sua
 * duração e, se for o caso, para onde o cursor vai e se ele clica. A cena
 * olha para o passo atual e desenha o estado correspondente.
 *
 * Quem pediu menos movimento no sistema vê direto o último passo, parado.
 */

type Passo = {
  id: string;
  ms: number;
  /** Para onde o cursor vai (em px, dentro do palco da cena). */
  cursor?: readonly [number, number];
  /** Se o cursor clica ao chegar neste passo. */
  clica?: boolean;
};

/** Toca um roteiro em loop; para o relógio quando a cena sai da tela. */
function useRoteiro(passos: readonly Passo[]) {
  const reduz = useReducedMotion() ?? false;
  const [p, setP] = useState(0);
  useEffect(() => {
    if (reduz) return;
    const id = window.setTimeout(() => setP((v) => (v + 1) % passos.length), passos[p]!.ms);
    return () => window.clearTimeout(id);
  }, [p, reduz, passos]);

  const atual = reduz ? passos.length - 1 : p;
  const indice = (id: string) => passos.findIndex((x) => x.id === id);
  let cursor: readonly [number, number] = [0, 0];
  for (let i = atual; i >= 0; i--) {
    const c = passos[i]!.cursor;
    if (c) {
      cursor = c;
      break;
    }
  }
  return {
    p: atual,
    reduz,
    /** O roteiro já chegou (ou passou) deste passo. */
    ja: (id: string) => atual >= indice(id),
    /** O roteiro está exatamente neste passo. */
    em: (id: string) => atual === indice(id),
    cursor,
    clique: passos[atual]!.clica ? atual : null,
  };
}
type Roteiro = ReturnType<typeof useRoteiro>;

/** Conta de 1 em 1 enquanto `ativo`; volta a zero quando para. */
function useContador(ativo: boolean, cadaMs: number, max = Infinity) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!ativo) {
      setN(0);
      return;
    }
    const id = window.setInterval(() => setN((v) => Math.min(max, v + 1)), cadaMs);
    return () => window.clearInterval(id);
  }, [ativo, cadaMs, max]);
  return n;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * O palco de uma cena: ela é desenhada num tamanho fixo (para o cursor saber
 * onde clicar) e encolhe por inteiro quando a janela é estreita (celular).
 */
function Palco({ w, h, children }: { w: number; h: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setEscala(Math.min(1, el.clientWidth / w, el.clientHeight / h));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);
  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="absolute inset-x-3 bottom-2 top-8" data-palco>
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            width: w,
            height: h,
            transform: `translate(-50%, -50%) scale(${escala})`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** A moldura de uma "tela" em miniatura, ocupando o palco todo. */
const MOLDURA =
  "absolute inset-0 overflow-hidden rounded-xl border border-border bg-card shadow-2xl";

/** A setinha do mouse: anda até o alvo e, ao clicar, solta uma onda. */
function Cursor({ r }: { r: Roteiro }) {
  if (r.reduz) return null;
  const [x, y] = r.cursor;
  return (
    <motion.div
      className="pointer-events-none absolute left-0 top-0 z-40"
      initial={false}
      animate={{ x, y }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
    >
      <AnimatePresence>
        {r.clique !== null && (
          <motion.span
            key={r.clique}
            className="absolute -left-3.5 -top-3.5 h-7 w-7 rounded-full border-2 border-primary bg-primary/25"
            initial={{ scale: 0.2, opacity: 1 }}
            animate={{ scale: 1.5, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
      <motion.svg
        key={`s${r.clique ?? "x"}`}
        width="17"
        height="23"
        viewBox="0 0 17 23"
        className="relative drop-shadow-[0_2px_3px_rgba(0,0,0,0.35)]"
        style={{ transformOrigin: "0 0" }}
        animate={r.clique !== null ? { scale: [1, 0.78, 1] } : { scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <path
          d="M1 1 L1 18 L5.3 14 L8.4 21 L11.2 19.8 L8.2 13 L14 13 Z"
          fill="#fff"
          stroke="#111"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </motion.svg>
    </motion.div>
  );
}

/** Letrinhas aparecendo, como alguém digitando. */
function Digitando({ texto, cadaMs = 55 }: { texto: string; cadaMs?: number }) {
  const reduz = useReducedMotion() ?? false;
  const letras = Array.from(texto);
  const n = useContador(!reduz, cadaMs, letras.length);
  return <>{reduz ? texto : letras.slice(0, n).join("")}</>;
}

/** Um número que sobe do zero até o alvo. */
function NumeroSobe({
  alvo,
  dur = 1.1,
  sufixo = "",
}: {
  alvo: number;
  dur?: number;
  sufixo?: string;
}) {
  const reduz = useReducedMotion() ?? false;
  const [v, setV] = useState(reduz ? alvo : 0);
  useEffect(() => {
    if (reduz) {
      setV(alvo);
      return;
    }
    const c = animate(0, alvo, {
      duration: dur,
      ease: "easeOut",
      onUpdate: (x) => setV(Math.round(x)),
    });
    return () => c.stop();
  }, [alvo, dur, reduz]);
  return (
    <>
      {v}
      {sufixo}
    </>
  );
}

const CORES_FESTA = ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];

/** Um estouro de confete saindo do centro do elemento pai. */
function Estouro({ n = 14, raio = 70 }: { n?: number; raio?: number }) {
  return (
    <span className="pointer-events-none absolute left-1/2 top-1/2">
      {Array.from({ length: n }, (_, i) => {
        const ang = (i / n) * Math.PI * 2 + (i % 3) * 0.2;
        const dist = raio * (0.6 + ((i * 7) % 5) / 10);
        return (
          <motion.span
            key={i}
            className="absolute h-2 w-1.5 rounded-sm"
            style={{ background: CORES_FESTA[i % CORES_FESTA.length] }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            animate={{
              x: Math.cos(ang) * dist,
              y: Math.sin(ang) * dist + 20,
              opacity: 0,
              rotate: 280,
            }}
            transition={{ duration: 1.1, ease: "easeOut" }}
          />
        );
      })}
    </span>
  );
}

/* ————— O bonequinho de blocos (o mesmo jeitão dos avatares do app) ————— */

type Humor = "feliz" | "preocupado" | "triste";
type Visual = {
  pele?: string;
  cabelo?: string;
  estilo?: "curto" | "topete" | "longo";
  camisa?: string;
  roupa?: "camiseta" | "social" | "polo";
  calca?: string;
  oculos?: boolean;
  festa?: boolean;
  humor?: Humor;
};

function Boneco({ alto, className = "", ...v }: Visual & { alto: number; className?: string }) {
  const {
    pele = "#f1c27d",
    cabelo = "#5b3a29",
    estilo = "curto",
    camisa = "#9ca3af",
    roupa = "camiseta",
    calca = "#334155",
    oculos = false,
    festa = false,
    humor = "feliz",
  } = v;
  return (
    <svg
      viewBox="0 -18 60 118"
      width={(alto * 60) / 118}
      height={alto}
      className={className}
      aria-hidden
    >
      {/* pernas e sapatos */}
      <rect x="18" y="68" width="11" height="26" rx="1.5" fill={calca} />
      <rect x="31" y="68" width="11" height="26" rx="1.5" fill={calca} />
      <rect x="17" y="92" width="12.5" height="6" rx="2" fill="#1f2937" />
      <rect x="30.5" y="92" width="12.5" height="6" rx="2" fill="#1f2937" />
      {/* braços e mãos */}
      <rect x="6" y="39" width="10" height="24" rx="2" fill={camisa} />
      <rect x="44" y="39" width="10" height="24" rx="2" fill={camisa} />
      <rect x="6.5" y="61" width="9" height="7" rx="2" fill={pele} />
      <rect x="44.5" y="61" width="9" height="7" rx="2" fill={pele} />
      {/* tronco */}
      <rect x="16" y="37" width="28" height="33" rx="2.5" fill={camisa} />
      {roupa === "camiseta" && <path d="M25 37 Q30 42.5 35 37 Z" fill={pele} />}
      {roupa === "social" && (
        <>
          <path d="M22.5 37 L30 44 L30 37 Z M37.5 37 L30 44 L30 37 Z" fill="#fff" opacity="0.92" />
          <line x1="30" y1="44" x2="30" y2="69" stroke="#2b8fd1" strokeWidth="0.9" />
          {/* as bandeiras do Brasil e do Paraná, no peito */}
          <rect x="19" y="47" width="7" height="4.6" rx="0.5" fill="#16a34a" />
          <path d="M22.5 47.7 L25.3 49.3 L22.5 50.9 L19.7 49.3 Z" fill="#facc15" />
          <circle cx="22.5" cy="49.3" r="0.9" fill="#1e3a8a" />
          <rect x="34" y="47" width="7" height="4.6" rx="0.5" fill="#16a34a" />
          <rect x="35.6" y="47.9" width="3.8" height="2.8" fill="#fff" />
        </>
      )}
      {roupa === "polo" && (
        <>
          <path d="M21.5 37 L30 42.5 L38.5 37 L36 35.5 L24 35.5 Z" fill="#33497a" />
          <rect x="29.2" y="40" width="1.6" height="9" fill="#e5e7eb" opacity="0.55" />
          <circle cx="30" cy="43" r="0.8" fill="#fff" />
          <circle cx="30" cy="46.5" r="0.8" fill="#fff" />
        </>
      )}
      {/* cabeça */}
      <rect x="17" y="8" width="26" height="28" rx="5" fill={pele} />
      {/* cabelo */}
      <g fill={cabelo}>
        {estilo === "longo" ? (
          <>
            <rect x="15" y="5" width="30" height="9" rx="4.5" />
            <rect x="14" y="9" width="5.5" height="31" rx="2" />
            <rect x="40.5" y="9" width="5.5" height="31" rx="2" />
          </>
        ) : (
          <>
            <rect x="16" y="5" width="28" height="8" rx="4" />
            <rect x="16" y="9" width="3.2" height="9" rx="1" />
            <rect x="40.8" y="9" width="3.2" height="9" rx="1" />
            {estilo === "topete" && <path d="M18 9 Q21 -2 33 1.5 Q42 4 42.5 9 Z" />}
          </>
        )}
      </g>
      {/* sobrancelhas de quem está preocupado ou tristinho */}
      {humor !== "feliz" && (
        <g stroke="#3f2a1d" strokeWidth="1.3" strokeLinecap="round">
          <line x1="21.5" y1={humor === "triste" ? 16.5 : 15.5} x2="26.5" y2="14" />
          <line x1="33.5" y1="14" x2="38.5" y2={humor === "triste" ? 16.5 : 15.5} />
        </g>
      )}
      {/* olhos */}
      <rect x="22.5" y="18" width="3.6" height="4.6" rx="1.3" fill="#1f2937" />
      <rect x="33.9" y="18" width="3.6" height="4.6" rx="1.3" fill="#1f2937" />
      {humor === "feliz" && (
        <>
          <circle cx="21" cy="26.5" r="2" fill="#f87171" opacity="0.35" />
          <circle cx="39" cy="26.5" r="2" fill="#f87171" opacity="0.35" />
        </>
      )}
      {/* boca */}
      {humor === "feliz" && <path d="M24.5 27 Q30 33.5 35.5 27 Z" fill="#7f1d1d" />}
      {humor === "preocupado" && (
        <path
          d="M25 30 Q27.5 28 30 30 Q32.5 32 35 30"
          stroke="#7f1d1d"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      )}
      {humor === "triste" && (
        <path
          d="M25 31.5 Q30 26.5 35 31.5"
          stroke="#7f1d1d"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
      )}
      {/* óculos escuros */}
      {oculos && (
        <g>
          <rect x="20" y="16.5" width="9" height="7" rx="2" fill="#111827" />
          <rect x="31" y="16.5" width="9" height="7" rx="2" fill="#111827" />
          <rect x="28.5" y="18.5" width="3" height="1.4" fill="#111827" />
          <rect x="21.5" y="17.5" width="3" height="1.5" rx="0.7" fill="#fff" opacity="0.45" />
          <rect x="32.5" y="17.5" width="3" height="1.5" rx="0.7" fill="#fff" opacity="0.45" />
        </g>
      )}
      {/* chapéu de festa */}
      {festa && (
        <g>
          <path d="M21 8 L39 8 L30 -14 Z" fill="#ec4899" />
          <path d="M23.6 1.6 L36.4 1.6 L35 -2 L25 -2 Z" fill="#facc15" />
          <path d="M26.4 -5.2 L33.6 -5.2 L32.4 -8.2 L27.6 -8.2 Z" fill="#38bdf8" />
          <circle cx="30" cy="-14.5" r="3.2" fill="#facc15" />
        </g>
      )}
    </svg>
  );
}

/* ————— 1. Avatar: montando o boneco ————— */

const CABELOS = [
  { t: "Castanho", cor: "#5b3a29", estilo: "curto" },
  { t: "Loiro", cor: "#e2b65a", estilo: "topete" },
  { t: "Preto", cor: "#1f1f1f", estilo: "longo" },
  { t: "Ruivo", cor: "#b4532a", estilo: "curto" },
] as const;
const ROUPAS = [
  { t: "Camiseta", cor: "#9ca3af", roupa: "camiseta", d: "Camiseta básica" },
  { t: "Social", cor: "#62c0ff", roupa: "social", d: "Uniforme · social azul com as bandeiras" },
  { t: "Polo", cor: "#1f2f56", roupa: "polo", d: "Uniforme · polo azul-marinho" },
  { t: "Moletom", cor: "#16a34a", roupa: "camiseta", d: "Moletom verde" },
] as const;
const ACESSORIOS = [
  { t: "Nenhum", e: "—" },
  { t: "Óculos", e: "🕶️" },
  { t: "Boné", e: "🧢" },
  { t: "Fone", e: "🎧" },
];
const ABAS_AVATAR = ["Cabelo", "Roupa", "Acessórios"];

const ROTEIRO_AVATAR: Passo[] = [
  { id: "inicio", ms: 900, cursor: [300, 200] },
  { id: "vai-loiro", ms: 550, cursor: [261, 104] },
  { id: "loiro", ms: 850, clica: true },
  { id: "vai-roupa", ms: 500, cursor: [295, 44] },
  { id: "roupa", ms: 550, clica: true },
  { id: "vai-social", ms: 500, cursor: [261, 104] },
  { id: "social", ms: 1100, clica: true },
  { id: "vai-polo", ms: 500, cursor: [329, 104] },
  { id: "polo", ms: 1100, clica: true },
  { id: "vai-acess", ms: 500, cursor: [386, 44] },
  { id: "acess", ms: 550, clica: true },
  { id: "vai-oculos", ms: 500, cursor: [261, 104] },
  { id: "oculos", ms: 1000, clica: true },
  { id: "vai-salvar", ms: 550, cursor: [388, 191] },
  { id: "salvar", ms: 2400, clica: true },
];

function IlustracaoAvatar() {
  const r = useRoteiro(ROTEIRO_AVATAR);
  const aba = r.ja("acess") ? 2 : r.ja("roupa") ? 1 : 0;
  const iCabelo = r.ja("loiro") ? 1 : 0;
  const iRoupa = r.ja("polo") ? 2 : r.ja("social") ? 1 : 0;
  const oculos = r.ja("oculos");
  const salvo = r.ja("salvar");
  const cab = CABELOS[iCabelo]!;
  const rou = ROUPAS[iRoupa]!;
  const selecionado = [iCabelo, iRoupa, oculos ? 1 : 0][aba]!;
  const descricao =
    aba === 0
      ? `Cabelo ${cab.t.toLowerCase()}`
      : aba === 1
        ? rou.d
        : oculos
          ? "Óculos escuros"
          : "Sem acessório";

  const itens =
    aba === 0
      ? CABELOS.map((c) => ({
          t: c.t,
          el: <span className="h-6 w-6 rounded-lg shadow-inner" style={{ background: c.cor }} />,
        }))
      : aba === 1
        ? ROUPAS.map((c) => ({
            t: c.t,
            el: <Shirt className="h-6 w-6" style={{ color: c.cor, fill: c.cor }} />,
          }))
        : ACESSORIOS.map((c) => ({
            t: c.t,
            el: <span className="text-lg leading-none">{c.e}</span>,
          }));

  return (
    <Palco w={440} h={216}>
      <div className={MOLDURA}>
        {/* A prévia do boneco, que muda a cada clique. */}
        <div className="absolute inset-y-0 left-0 w-[150px] bg-gradient-to-b from-primary/20 to-primary/5">
          <span className="absolute bottom-4 left-1/2 h-3 w-20 -translate-x-1/2 rounded-full bg-black/15 blur-[2px]" />
          <div className="absolute inset-x-0 bottom-5 flex justify-center">
            <motion.div
              key={`${iCabelo}-${iRoupa}-${oculos}-${salvo}`}
              initial={{ scale: 0.9, y: 0 }}
              animate={
                salvo ? { scale: 1, y: [0, -16, 0, -8, 0] } : { scale: [0.9, 1.06, 1], y: 0 }
              }
              transition={{ duration: salvo ? 0.9 : 0.4 }}
            >
              <Boneco
                alto={170}
                cabelo={cab.cor}
                estilo={cab.estilo}
                camisa={rou.cor}
                roupa={rou.roupa}
                oculos={oculos}
                calca={iRoupa === 0 ? "#334155" : "#1e293b"}
              />
            </motion.div>
          </div>
          <AnimatePresence>
            {salvo && (
              <motion.span
                initial={{ opacity: 0, y: -8, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                className="absolute left-1/2 top-2.5 inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-success px-2 py-0.5 text-[10px] font-bold text-white shadow"
              >
                <Check className="h-3 w-3" /> Salvo!
              </motion.span>
            )}
          </AnimatePresence>
          {salvo && !r.reduz && (
            <span className="absolute left-1/2 top-1/2">
              <Estouro n={18} raio={80} />
            </span>
          )}
        </div>

        {/* O editor: abas, peças e o Salvar. */}
        <div className="absolute left-[162px] top-[10px] text-[11px] font-semibold">
          Meu avatar <span className="font-normal text-muted-foreground">· Configurações</span>
        </div>
        {ABAS_AVATAR.map((t, i) => (
          <span
            key={t}
            className={`absolute top-[32px] grid h-6 w-[84px] place-items-center rounded-md text-[10px] font-semibold transition-colors ${
              aba === i
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground"
            }`}
            style={{ left: 162 + i * 91 }}
          >
            {t}
          </span>
        ))}
        {itens.map((it, i) => (
          <motion.span
            key={`${aba}-${it.t}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className={`absolute top-[70px] flex h-[68px] w-[62px] flex-col items-center justify-center gap-1.5 rounded-lg border-2 text-[9px] font-medium transition-colors ${
              selecionado === i ? "border-primary bg-primary/10" : "border-border bg-secondary/40"
            }`}
            style={{ left: 162 + i * 68 }}
          >
            {it.el}
            {it.t}
          </motion.span>
        ))}
        <AnimatePresence mode="wait">
          <motion.span
            key={descricao}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className="absolute left-[162px] top-[148px] inline-flex items-center gap-1 text-[10px] text-muted-foreground"
          >
            <Sparkles className="h-3 w-3 text-amber-500" /> {descricao}
          </motion.span>
        </AnimatePresence>
        <span className="absolute left-[270px] top-[178px] grid h-[26px] w-[72px] place-items-center rounded-md text-[10px] text-muted-foreground">
          Cancelar
        </span>
        <span
          className={`absolute left-[348px] top-[178px] grid h-[26px] w-[80px] place-items-center rounded-md text-[11px] font-semibold shadow-sm transition-colors ${
            salvo ? "bg-success text-white" : "bg-primary text-primary-foreground"
          }`}
        >
          {salvo ? "Salvo ✓" : "Salvar"}
        </span>
      </div>
      <Cursor r={r} />
    </Palco>
  );
}

/* ————— 2. Mural: o feed vivo ————— */

const ROTEIRO_MURAL: Passo[] = [
  { id: "inicio", ms: 900, cursor: [300, 196] },
  { id: "novo", ms: 2100 },
  { id: "rola", ms: 900, cursor: [92, 99] },
  { id: "reage", ms: 1000, clica: true },
  { id: "vai-comenta", ms: 500, cursor: [150, 130] },
  { id: "digita", ms: 1600, clica: true },
  { id: "vai-envia", ms: 450, cursor: [330, 130] },
  { id: "envia", ms: 2200, clica: true },
];

function IlustracaoMural() {
  const r = useRoteiro(ROTEIRO_MURAL);
  const novo = r.ja("novo");
  const curtidas = r.ja("reage") ? 13 : 12;
  const enviado = r.ja("envia");
  return (
    <Palco w={360} h={216}>
      <div className={MOLDURA}>
        <div className="flex h-7 items-center gap-1.5 border-b border-border px-3 text-[11px] font-semibold">
          <Megaphone className="h-3.5 w-3.5 text-primary" /> Mural
          <span className="ml-auto text-[9px] font-normal text-muted-foreground">
            Tudo · Eventos · Elogios
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 top-7 overflow-hidden">
          <motion.div
            className="flex flex-col gap-2 p-2"
            animate={{ y: r.ja("rola") ? -104 : 0 }}
            transition={{ duration: 0.7, ease: "easeInOut" }}
          >
            <AnimatePresence initial={false}>
              {novo && (
                <motion.div
                  key="time"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 96, opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 220, damping: 24 }}
                  className="relative shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-amber-200 to-yellow-100 p-2.5"
                >
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[9px] font-bold text-amber-800">
                    <Trophy className="h-2.5 w-2.5" /> Time 100%
                  </span>
                  <div className="mt-1.5 max-w-[10rem] font-display text-[13px] font-bold leading-tight text-amber-950">
                    Time de PCP bateu 100% na semana 🏆
                  </div>
                  {/* o time abraçado */}
                  <motion.div
                    className="absolute -bottom-6 right-3 flex items-end"
                    animate={r.reduz ? {} : { rotate: [-2, 2, -2] }}
                    transition={{ duration: 1.6, repeat: Infinity }}
                  >
                    <Boneco
                      alto={86}
                      camisa="#62c0ff"
                      roupa="social"
                      cabelo="#1f1f1f"
                      estilo="longo"
                    />
                    <Boneco
                      alto={92}
                      className="-ml-5"
                      camisa="#1f2f56"
                      roupa="polo"
                      cabelo="#e2b65a"
                      estilo="topete"
                    />
                    <Boneco
                      alto={86}
                      className="-ml-5"
                      camisa="#62c0ff"
                      roupa="social"
                      cabelo="#b4532a"
                    />
                  </motion.div>
                  {!r.reduz && <Estouro n={16} raio={90} />}
                </motion.div>
              )}
            </AnimatePresence>
            <div className="relative shrink-0 rounded-lg border border-border bg-card p-2 shadow-sm">
              <div className="flex h-4 items-center gap-1 text-[10px] font-bold text-pink-500">
                <Cake className="h-3 w-3" /> Aniversário
                <span className="ml-auto font-normal text-muted-foreground">hoje</span>
              </div>
              <div className="mt-1 h-4 text-[11px] font-medium">
                Renata faz aniversário hoje! 🎂
              </div>
              <div className="relative mt-2 flex h-[22px] items-center gap-1.5">
                <span className="relative inline-flex h-[22px] w-10 items-center justify-center gap-1 rounded-full bg-pink-500/10 text-[10px] font-semibold text-pink-600">
                  ❤️
                  <motion.span
                    key={curtidas}
                    initial={{ y: -6, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                  >
                    {curtidas}
                  </motion.span>
                  {r.em("reage") && (
                    <motion.span
                      className="absolute left-1 top-0 text-sm"
                      initial={{ y: 0, opacity: 1, scale: 0.8 }}
                      animate={{ y: -26, opacity: 0, scale: 1.6 }}
                      transition={{ duration: 0.9 }}
                    >
                      ❤️
                    </motion.span>
                  )}
                </span>
                <span
                  className={`inline-flex h-[22px] items-center gap-1 rounded-full border px-2.5 text-[10px] font-medium transition-colors ${
                    r.ja("reage")
                      ? "border-pink-400 text-pink-600"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  <Heart
                    className={`h-3 w-3 ${r.ja("reage") ? "fill-pink-500 text-pink-500" : ""}`}
                  />{" "}
                  Reagir
                </span>
              </div>
              <div
                className={`mt-2 flex h-6 items-center rounded-full border bg-secondary/50 pl-2.5 pr-0.5 text-[10px] transition-colors ${
                  r.ja("digita") && !enviado ? "border-primary" : "border-border"
                }`}
              >
                {r.ja("digita") && !enviado ? (
                  <span>
                    <Digitando texto="Parabéns, Renata! 🎉" />
                    <motion.span
                      className="ml-px inline-block h-3 w-px translate-y-0.5 bg-foreground"
                      animate={{ opacity: [1, 0, 1] }}
                      transition={{ duration: 0.8, repeat: Infinity }}
                    />
                  </span>
                ) : (
                  <span className="text-muted-foreground">Deixe os parabéns…</span>
                )}
                <span className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Send className="h-2.5 w-2.5" />
                </span>
              </div>
              <AnimatePresence>
                {enviado && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: "auto" }}
                    className="mt-1.5 flex items-center gap-1.5 text-[10px]"
                  >
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-primary/20 text-[8px] font-bold text-primary">
                      E
                    </span>
                    <span className="font-semibold">Você</span> Parabéns, Renata! 🎉
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="shrink-0 rounded-lg border border-border bg-card p-2 shadow-sm">
              <div className="flex items-center gap-1 text-[10px] font-bold text-sky-500">
                <Megaphone className="h-3 w-3" /> Comunicado
              </div>
              <div className="mt-0.5 text-[11px]">Feriado de Finados · 02/11</div>
            </div>
          </motion.div>
        </div>
      </div>
      <Cursor r={r} />
    </Palco>
  );
}

/* ————— 3. Escritório 3D: a planta viva ————— */

const ROTEIRO_ESCRITORIO: Passo[] = [
  { id: "inicio", ms: 900, cursor: [410, 40] },
  { id: "ausente", ms: 900 },
  { id: "anda", ms: 2300 },
  { id: "chegou", ms: 1300 },
  { id: "vai-mesa", ms: 700, cursor: [66, 150] },
  { id: "hover", ms: 2200 },
];

/** As salas na planta: posição (dentro da planta) e quem está nas mesas. */
const SALAS = [
  { t: "PCP", x: 10, y: 10, gente: ["#0ea5e9", "#10b981", "#8b5cf6", null] },
  { t: "Gerência", x: 146, y: 10, gente: ["#1f2f56"] },
  { t: "Diretoria", x: 282, y: 10, gente: ["#0f172a", "#334155"] },
  { t: "TI", x: 10, y: 104, gente: ["#f59e0b", "#06b6d4", "#6366f1"] },
  { t: "Reunião", x: 146, y: 104, gente: ["#14b8a6", "#f97316", "#ec4899"] },
] as const;

function Mesa({ cor }: { cor: string | null }) {
  return (
    <span className="relative flex w-[26px] flex-col items-center">
      {cor ? <Boneco alto={40} camisa={cor} /> : <span className="h-[40px]" />}
      <span className="-mt-4 h-2.5 w-7 rounded-sm bg-[#b98b5e] shadow-sm" />
    </span>
  );
}

function IlustracaoEscritorio() {
  const r = useRoteiro(ROTEIRO_ESCRITORIO);
  const anda = r.em("anda");
  const chegou = r.ja("chegou");
  const inicio = { left: 100, top: 22 };
  const fim = { left: 334, top: 118 };
  return (
    <Palco w={440} h={216}>
      <div
        className="absolute left-[10px] top-[12px] h-[190px] w-[420px] rounded-2xl bg-[#e9e3d8] shadow-2xl"
        style={{ transform: "perspective(900px) rotateX(18deg)", transformOrigin: "50% 50%" }}
      >
        {SALAS.map((s) => (
          <div
            key={s.t}
            className="absolute h-[78px] w-[128px] rounded-lg border-2 border-sky-200/80 bg-white/60 p-1.5"
            style={{ left: s.x, top: s.y }}
          >
            <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wide text-slate-600">
              <Building2 className="h-2.5 w-2.5" /> {s.t}
            </div>
            <div className="mt-0.5 flex gap-[3px]">
              {s.gente.map((c, j) => (
                <Mesa key={j} cor={c} />
              ))}
            </div>
          </div>
        ))}
        {/* o refeitório, com a mesa redonda e o café */}
        <div className="absolute left-[282px] top-[104px] h-[78px] w-[128px] rounded-lg border-2 border-amber-200 bg-amber-50/80 p-1.5">
          <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wide text-amber-700">
            <Coffee className="h-2.5 w-2.5" /> Refeitório
          </div>
          <span className="absolute left-[14px] top-[18px]">
            <Boneco alto={40} camisa="#84cc16" />
          </span>
          <span className="absolute left-[94px] top-[18px]">
            <Boneco alto={40} camisa="#d946ef" />
          </span>
          <span className="absolute left-[22px] top-[50px] h-5 w-[80px] rounded-[50%] bg-[#b98b5e] shadow" />
        </div>
        {/* O Gabriel: fica ausente e vai tomar um café. */}
        <motion.span
          className="absolute z-10"
          initial={false}
          animate={
            anda
              ? {
                  left: [inicio.left, 116, 300, fim.left],
                  top: [inicio.top, 74, 74, fim.top],
                }
              : chegou
                ? fim
                : inicio
          }
          transition={
            anda ? { duration: 2.1, times: [0, 0.25, 0.75, 1], ease: "linear" } : { duration: 0 }
          }
        >
          <motion.span
            className="block"
            animate={anda ? { y: [0, -2.5, 0] } : { y: 0 }}
            transition={anda ? { duration: 0.32, repeat: Infinity } : { duration: 0 }}
          >
            <Boneco alto={40} camisa="#f43f5e" cabelo="#1f1f1f" />
          </motion.span>
          <AnimatePresence>
            {r.ja("ausente") && (
              <motion.span
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="absolute left-full top-0 ml-0.5 whitespace-nowrap rounded-full bg-amber-400 px-1.5 text-[7px] font-bold text-amber-950 shadow"
              >
                {chegou ? "☕ Ausente" : "Ausente"}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.span>
      </div>

      {/* Avisos por cima da planta (sem a inclinação, para ler fácil). */}
      <AnimatePresence>
        {chegou && (
          <motion.span
            key="cafe"
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute right-[24px] top-[190px] z-20 inline-flex items-center gap-1 rounded-full bg-card px-2 py-1 text-[10px] font-semibold shadow-lg ring-1 ring-border"
          >
            ☕ Gabriel foi tomar um café
          </motion.span>
        )}
        {r.ja("hover") && (
          <motion.div
            key="dica"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute left-[84px] top-[150px] z-20 rounded-lg bg-card px-2 py-1 text-[10px] shadow-lg ring-1 ring-border"
          >
            <div className="font-semibold">Ana Paula · TI</div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> Disponível
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <Cursor r={r} />
    </Palco>
  );
}

/* ————— 4. Reações com o avatar e o status ————— */

const REACOES_AVATAR = [
  { t: "Top", e: "🏆", cor: "#f59e0b" },
  { t: "Joinha", e: "👍", cor: "#0ea5e9" },
  { t: "Bora!", e: "💪", cor: "#16a34a" },
  { t: "Café", e: "☕", cor: "#92400e" },
  { t: "Risada", e: "😂", cor: "#10b981" },
  { t: "Fogo", e: "🔥", cor: "#ef4444" },
];

const ROTEIRO_REACOES: Passo[] = [
  { id: "inicio", ms: 700, cursor: [300, 180] },
  { id: "vai-bolha", ms: 600, cursor: [120, 58] },
  { id: "vai-smile", ms: 450, cursor: [201, 57] },
  { id: "abre", ms: 650, clica: true },
  { id: "vai-avatar", ms: 450, cursor: [102, 92] },
  { id: "aba", ms: 750, clica: true },
  { id: "vai-top", ms: 450, cursor: [38, 146] },
  { id: "top", ms: 2100, clica: true },
  { id: "vai-status", ms: 650, cursor: [318, 15] },
  { id: "status", ms: 650, clica: true },
  { id: "vai-ferias", ms: 450, cursor: [300, 45] },
  { id: "ferias", ms: 2000, clica: true },
];

function IlustracaoReacoes() {
  const r = useRoteiro(ROTEIRO_REACOES);
  const popover = r.ja("abre") && !r.ja("top");
  const abaAvatar = r.ja("aba");
  const ferias = r.ja("ferias");
  return (
    <Palco w={380} h={216}>
      <div className={MOLDURA}>
        {/* cabeçalho da conversa e o status de quem está usando */}
        <div className="flex h-[30px] items-center gap-2 border-b border-border px-2.5">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-pink-400 text-[9px] font-bold text-white">
            R
          </span>
          <div className="leading-tight">
            <div className="text-[11px] font-semibold">Renata Souza</div>
            <div className="text-[8px] text-success">online</div>
          </div>
        </div>
        <motion.span
          key={ferias ? "f" : "s"}
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`absolute right-[10px] top-[6px] inline-flex h-[18px] items-center gap-1 rounded-full px-2 text-[10px] font-medium ${
            ferias
              ? "bg-amber-400/20 text-foreground ring-1 ring-amber-400"
              : "border border-dashed border-border text-muted-foreground"
          }`}
        >
          {ferias ? "🏖️ De férias · até sexta" : "😀 Definir status"}
        </motion.span>

        {/* a conversa */}
        <div className="absolute left-3 top-[42px] rounded-2xl rounded-tl-sm bg-secondary px-3 py-1.5 text-[11px]">
          Fechei o relatório do 820! 📊
        </div>
        <AnimatePresence>
          {r.ja("vai-smile") && !r.ja("top") && (
            <motion.span
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute left-[190px] top-[46px] grid h-[22px] w-[22px] place-items-center rounded-full bg-card text-muted-foreground shadow ring-1 ring-border"
            >
              <Smile className="h-3.5 w-3.5" />
            </motion.span>
          )}
          {r.ja("top") && !r.em("top") && (
            <motion.span
              key="chip"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute left-5 top-[66px] inline-flex items-center gap-0.5 rounded-full bg-card px-1.5 py-px text-[10px] shadow ring-1 ring-border"
            >
              🏆 <span className="font-semibold">1</span>
            </motion.span>
          )}
        </AnimatePresence>
        <div className="absolute right-3 top-[92px] rounded-2xl rounded-tr-sm bg-primary px-3 py-1.5 text-[11px] text-primary-foreground">
          Mandou bem, Renata!
        </div>
        <div className="absolute inset-x-3 bottom-2.5 flex h-7 items-center rounded-full border border-border px-3 text-[10px] text-muted-foreground">
          Escreva uma mensagem…
        </div>

        {/* a caixinha de reações: Emojis | Avatar */}
        <AnimatePresence>
          {popover && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="absolute left-3 top-[76px] z-10 h-[114px] w-[250px] rounded-xl border border-border bg-card shadow-2xl"
            >
              {["Emojis", "Avatar"].map((t, i) => (
                <span
                  key={t}
                  className={`absolute top-1.5 grid h-5 w-[52px] place-items-center rounded-md text-[10px] font-semibold ${
                    (i === 1) === abaAvatar
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground"
                  }`}
                  style={{ left: 8 + i * 56 }}
                >
                  {t}
                </span>
              ))}
              {abaAvatar ? (
                <div className="absolute left-2 top-[34px] flex gap-[3px]">
                  {REACOES_AVATAR.map((x, i) => (
                    <motion.span
                      key={x.t}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className={`relative flex h-[70px] w-9 flex-col items-center overflow-hidden rounded-lg pt-1 text-[8px] font-medium ${
                        r.ja("top") && i === 0
                          ? "bg-primary/20 ring-2 ring-primary"
                          : "bg-secondary"
                      }`}
                    >
                      <Boneco alto={46} camisa={x.cor} cabelo="#1f2f56" />
                      <span className="absolute right-0.5 top-0.5 text-[11px]">{x.e}</span>
                      <span className="mt-0.5">{x.t}</span>
                    </motion.span>
                  ))}
                </div>
              ) : (
                <div className="absolute left-2 top-[38px] flex gap-1.5 text-lg">
                  {["👍", "❤️", "😂", "😮", "🙏", "🎉"].map((e) => (
                    <span
                      key={e}
                      className="grid h-8 w-8 place-items-center rounded-full bg-secondary"
                    >
                      {e}
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* o "Você é top!" por cima do chat: o boneco levanta o troféu */}
        <AnimatePresence>
          {r.em("top") && (
            <motion.div
              key="top"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.15 }}
              className="absolute inset-0 z-20 grid place-items-center bg-card/80 backdrop-blur-[2px]"
            >
              <div className="relative flex flex-col items-center">
                <motion.span
                  className="absolute -right-12 top-6 z-10 text-[44px] drop-shadow-lg"
                  initial={{ y: 40, scale: 0.4, opacity: 0 }}
                  animate={{
                    y: [40, -6, 0],
                    scale: [0.4, 1.15, 1],
                    opacity: 1,
                    rotate: [0, -8, 6, 0],
                  }}
                  transition={{ delay: 0.35, duration: 0.8 }}
                >
                  🏆
                </motion.span>
                <motion.span
                  initial={{ y: 12 }}
                  animate={{ y: [12, -4, 0] }}
                  transition={{ delay: 0.3, duration: 0.6 }}
                  className="mt-2"
                >
                  <Boneco
                    alto={140}
                    camisa="#62c0ff"
                    roupa="social"
                    cabelo="#5b3a29"
                    estilo="curto"
                  />
                </motion.span>
                {[0, 1, 2, 3, 4].map((i) => (
                  <motion.span
                    key={i}
                    className="absolute text-sm"
                    style={{ left: -30 + i * 28, top: 8 + (i % 2) * 18 }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: [0, 1.2, 0], opacity: [0, 1, 0] }}
                    transition={{ delay: 0.8 + i * 0.15, duration: 0.9 }}
                  >
                    ✨
                  </motion.span>
                ))}
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.6, type: "spring" }}
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-bold text-white shadow-lg"
                >
                  🏆 Você é top!
                </motion.span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* o menu do status */}
        <AnimatePresence>
          {r.ja("status") && !ferias && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute right-[10px] top-[30px] z-30 w-[150px] rounded-lg border border-border bg-card p-1 shadow-2xl"
            >
              {["🏖️ De férias", "🍽️ Almoço", "🏠 Home office"].map((t, i) => (
                <div
                  key={t}
                  className={`flex h-[22px] items-center rounded-md px-2 text-[10px] ${
                    i === 0 && r.ja("vai-ferias") ? "bg-secondary font-semibold" : ""
                  }`}
                >
                  {t}
                </div>
              ))}
              <div className="mt-0.5 border-t border-border px-2 pt-1 text-[9px] text-muted-foreground">
                Vale até: <span className="font-semibold text-foreground">sexta</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Cursor r={r} />
    </Palco>
  );
}

/* ————— 5. Recado de voz e gravação de tela ————— */

const ONDA = [
  0.35, 0.6, 0.45, 0.85, 0.55, 0.95, 0.4, 0.7, 0.5, 0.8, 0.3, 0.65, 0.9, 0.5, 0.6, 0.35,
];

const ROTEIRO_VOZ: Passo[] = [
  { id: "inicio", ms: 700, cursor: [200, 120] },
  { id: "vai-mic", ms: 550, cursor: [277, 180] },
  { id: "grava", ms: 2200, clica: true },
  { id: "para", ms: 800, clica: true },
  { id: "vai-play", ms: 600, cursor: [32, 89] },
  { id: "toca", ms: 1700, clica: true },
  { id: "vai-tela", ms: 650, cursor: [344, 180] },
  { id: "tela", ms: 1000, clica: true },
  { id: "mexe", ms: 900, cursor: [150, 64] },
  { id: "vai-parar", ms: 600, cursor: [366, 16] },
  { id: "parar", ms: 900, clica: true },
  { id: "vai-enviar", ms: 500, cursor: [274, 160] },
  { id: "enviar", ms: 2400, clica: true },
];

/** As barrinhas de um áudio gravando, mexendo de verdade. */
function OndaAoVivo() {
  const reduz = useReducedMotion() ?? false;
  return (
    <span className="flex h-4 items-center gap-[2px]">
      {ONDA.map((b, i) => (
        <motion.span
          key={i}
          className="w-[2px] rounded-full bg-white"
          style={{ height: `${b * 100}%` }}
          animate={
            reduz
              ? {}
              : { height: [`${b * 30}%`, `${b * 100}%`, `${(1 - b) * 80 + 15}%`, `${b * 30}%`] }
          }
          transition={{ duration: 0.7 + (i % 4) * 0.15, repeat: Infinity }}
        />
      ))}
    </span>
  );
}

function IlustracaoVoz() {
  const r = useRoteiro(ROTEIRO_VOZ);
  const gravandoVoz = r.em("grava");
  const temAudio = r.ja("para");
  const tocando = r.em("toca");
  const gravandoTela = r.ja("tela") && !r.ja("parar");
  const previa = r.ja("parar") && !r.ja("enviar");
  const temVideo = r.ja("enviar");
  const segVoz = useContador(gravandoVoz, 50, 42);
  const segTela = useContador(gravandoTela, 480, 5);

  return (
    <Palco w={400} h={216}>
      <div className={MOLDURA}>
        <div className="absolute left-3 top-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Minhas tarefas
        </div>
        {/* o cartão da tarefa: o recado e o vídeo ficam aqui, acima do Reagir */}
        <div className="absolute inset-x-2.5 top-[30px] h-[118px] rounded-lg border border-border bg-secondary/20 p-2.5">
          <div className="text-[12px] font-semibold leading-4">Conferir boletins do 820</div>
          <div className="text-[10px] text-muted-foreground">Hoje · Eduardo · PCP</div>
          <div className="absolute left-2.5 top-[46px] flex h-[26px] items-center gap-1.5">
            <AnimatePresence>
              {temAudio && (
                <motion.span
                  key="audio"
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-0.5 pr-2 shadow-sm"
                >
                  <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-primary text-primary-foreground">
                    {tocando ? <Pause className="h-3 w-3" /> : <Play className="ml-px h-3 w-3" />}
                  </span>
                  <span className="relative flex h-4 w-[74px] items-center gap-[2px]">
                    {ONDA.map((b, i) => (
                      <span
                        key={i}
                        className="flex-1 rounded-full bg-primary/30"
                        style={{ height: `${b * 100}%` }}
                      />
                    ))}
                    {/* a parte já tocada, pintando por cima */}
                    <motion.span
                      className="absolute inset-y-0 left-0 flex items-center gap-[2px] overflow-hidden"
                      initial={{ width: "0%" }}
                      animate={{ width: r.ja("toca") ? "100%" : "0%" }}
                      transition={tocando ? { duration: 1.6, ease: "linear" } : { duration: 0 }}
                    >
                      {ONDA.map((b, i) => (
                        <span
                          key={i}
                          className="w-[2.6px] shrink-0 rounded-full bg-primary"
                          style={{ height: `${b * 100}%` }}
                        />
                      ))}
                    </motion.span>
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">0:42</span>
                </motion.span>
              )}
              {temVideo && (
                <motion.span
                  key="video"
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-0.5 pr-2 text-[10px] font-medium shadow-sm"
                >
                  <span className="relative grid h-[22px] w-9 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-slate-700 to-slate-900">
                    <span className="absolute left-1.5 top-1 h-0.5 w-4 rounded bg-white/30" />
                    <span className="absolute bottom-1 left-1.5 h-0.5 w-6 rounded bg-white/20" />
                    <Play className="h-2.5 w-2.5 fill-white text-white" />
                  </span>
                  <Video className="h-3 w-3" /> Vídeo · 0:05
                </motion.span>
              )}
            </AnimatePresence>
            {!temAudio && (
              <span className="text-[10px] italic text-muted-foreground">Sem anexos ainda</span>
            )}
          </div>
          <div className="absolute left-2.5 top-[86px] flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Heart className="h-3 w-3" /> Reagir
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="h-3 w-3" /> Comentar
            </span>
          </div>
        </div>

        {/* o compositor: microfone e "Gravar tela" */}
        <div className="absolute inset-x-2.5 top-[165px] flex h-[30px] items-center gap-1.5">
          {gravandoVoz ? (
            <motion.span
              initial={{ opacity: 0, scaleX: 0.8 }}
              animate={{ opacity: 1, scaleX: 1 }}
              className="flex h-[30px] flex-1 items-center gap-2 rounded-full bg-red-500 px-3 text-[10px] font-semibold text-white shadow-lg"
            >
              <motion.span
                className="h-2 w-2 rounded-full bg-white"
                animate={{ opacity: [1, 0.2, 1] }}
                transition={{ duration: 0.9, repeat: Infinity }}
              />
              <span className="tabular-nums">{mmss(segVoz)}</span>
              <OndaAoVivo />
              <span className="ml-auto opacity-80">até 3:00</span>
            </motion.span>
          ) : (
            <span className="flex h-[30px] flex-1 items-center rounded-full border border-border px-3 text-[10px] text-muted-foreground">
              Escreva um comentário…
            </span>
          )}
          <span
            className={`grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full transition-colors ${
              gravandoVoz ? "bg-red-600 text-white" : "bg-primary/15 text-primary"
            }`}
          >
            {gravandoVoz ? (
              <Square className="h-3 w-3 fill-white" />
            ) : (
              <Mic className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="inline-flex h-[30px] w-[92px] shrink-0 items-center justify-center gap-1 rounded-full border border-border text-[10px] font-medium">
            <Monitor className="h-3.5 w-3.5 text-primary" /> Gravar tela
          </span>
        </div>

        {/* gravando a tela: a moldura vermelha e a barrinha com o tempo */}
        <AnimatePresence>
          {gravandoTela && (
            <motion.span
              key="moldura"
              className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset ring-red-500"
              initial={{ opacity: 0 }}
              animate={{ opacity: [1, 0.5, 1] }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              transition={{ duration: 1.2, repeat: Infinity }}
            />
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {gravandoTela && (
          <motion.div
            key="barra"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute right-3 top-[4px] z-20 flex h-6 items-center gap-2 whitespace-nowrap rounded-full bg-neutral-900 pl-2.5 ring-1 ring-white/20 pr-1 text-[10px] font-medium text-white shadow-xl"
          >
            <motion.span
              className="h-2 w-2 rounded-full bg-red-500"
              animate={{ opacity: [1, 0.2, 1] }}
              transition={{ duration: 0.9, repeat: Infinity }}
            />
            Gravando a tela
            <span className="tabular-nums text-white/80">{mmss(segTela)} / 2:00</span>
            <span className="inline-flex h-[18px] items-center gap-1 rounded-full bg-red-500 px-2 text-[9px] font-bold">
              <Square className="h-2 w-2 fill-white" /> Parar
            </span>
          </motion.div>
        )}
        {previa && (
          <motion.div
            key="previa"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 grid place-items-center rounded-xl bg-black/45"
          >
            <motion.div
              initial={{ scale: 0.9, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              className="w-[220px] rounded-xl bg-card p-2.5 shadow-2xl"
            >
              <div className="text-[10px] font-semibold">Prévia da gravação</div>
              <div className="relative mt-1 grid h-[78px] place-items-center overflow-hidden rounded-lg bg-gradient-to-br from-slate-700 to-slate-900">
                <span className="absolute left-2 top-2 h-1.5 w-20 rounded bg-white/25" />
                <span className="absolute left-2 top-5 h-1 w-28 rounded bg-white/15" />
                <span className="absolute left-2 top-7 h-1 w-24 rounded bg-white/15" />
                <span className="grid h-8 w-8 place-items-center rounded-full bg-white/90">
                  <Play className="ml-0.5 h-4 w-4 fill-slate-900 text-slate-900" />
                </span>
                <span className="absolute bottom-1 right-1.5 text-[9px] text-white/80">0:05</span>
              </div>
              <div className="mt-2 flex justify-end gap-1.5">
                <span className="inline-flex h-6 items-center rounded-md px-2 text-[10px] text-muted-foreground">
                  Descartar
                </span>
                <span className="inline-flex h-6 items-center gap-1 rounded-md bg-primary px-2.5 text-[10px] font-semibold text-primary-foreground">
                  <Send className="h-3 w-3" /> Enviar
                </span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <Cursor r={r} />
    </Palco>
  );
}

/* ————— 6. Reunião com legenda e a ata pronta ————— */

const ROTEIRO_REUNIAO: Passo[] = [
  { id: "inicio", ms: 700, cursor: [300, 110] },
  { id: "fala1", ms: 1900 },
  { id: "fala2", ms: 1900 },
  { id: "vai-encerrar", ms: 600, cursor: [374, 193] },
  { id: "encerra", ms: 900, clica: true },
  { id: "ata", ms: 1700 },
  { id: "vai-ouvir", ms: 550, cursor: [250, 180] },
  { id: "ouve", ms: 2000, clica: true },
];

const NA_REUNIAO = [
  { nome: "Lucas", camisa: "#0ea5e9", cabelo: "#5b3a29", estilo: "curto" },
  { nome: "Ana", camisa: "#10b981", cabelo: "#1f1f1f", estilo: "longo" },
  { nome: "Você", camisa: "#1f2f56", cabelo: "#e2b65a", estilo: "topete" },
  { nome: "Paulo", camisa: "#f59e0b", cabelo: "#b4532a", estilo: "curto" },
] as const;

function IlustracaoReuniao() {
  const r = useRoteiro(ROTEIRO_REUNIAO);
  const falando = r.em("fala1") ? 0 : r.em("fala2") ? 1 : -1;
  const encerrou = r.ja("encerra");
  const legenda = r.em("fala1")
    ? { quem: "Lucas", t: "a peça da máquina 22 chega segunda." }
    : r.em("fala2")
      ? { quem: "Ana", t: "então fechamos o prêmio do 820 na quarta." }
      : null;
  return (
    <Palco w={420} h={216}>
      <div className="absolute inset-0 overflow-hidden rounded-xl bg-neutral-900 shadow-2xl">
        <motion.div
          className="absolute inset-x-2 top-2 grid h-[162px] grid-cols-2 gap-1"
          animate={{ opacity: encerrou ? 0.25 : 1 }}
        >
          {NA_REUNIAO.map((p, i) => (
            <div
              key={p.nome}
              className={`relative overflow-hidden rounded-lg bg-neutral-800 transition-shadow ${
                falando === i ? "ring-2 ring-emerald-400" : ""
              }`}
            >
              <span className="absolute left-1/2 top-[-14px] -translate-x-1/2">
                <Boneco
                  alto={120}
                  camisa={p.camisa}
                  cabelo={p.cabelo}
                  estilo={p.estilo}
                  humor="feliz"
                />
              </span>
              <span className="absolute bottom-1 left-1.5 rounded bg-black/60 px-1.5 text-[9px] text-white">
                {p.nome}
              </span>
              {falando === i && (
                <span className="absolute right-1.5 top-1.5 flex h-3 items-end gap-[2px]">
                  {[0, 1, 2].map((k) => (
                    <motion.span
                      key={k}
                      className="w-[3px] rounded-full bg-emerald-400"
                      animate={{ height: ["30%", "100%", "40%"] }}
                      transition={{ duration: 0.5, repeat: Infinity, delay: k * 0.12 }}
                    />
                  ))}
                </span>
              )}
            </div>
          ))}
        </motion.div>
        {/* a legenda ao vivo */}
        <AnimatePresence mode="wait">
          {legenda && (
            <motion.p
              key={legenda.quem}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute inset-x-10 top-[134px] rounded-lg bg-black/85 px-2 py-1 text-center text-[11px] text-white"
            >
              <span className="font-semibold text-amber-300">{legenda.quem}:</span>{" "}
              <Digitando texto={legenda.t} cadaMs={30} />
            </motion.p>
          )}
        </AnimatePresence>
        {/* a barra de controles */}
        <div className="absolute inset-x-2 bottom-2 flex h-[30px] items-center gap-1.5">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-neutral-700 text-white">
            <Mic className="h-3 w-3" />
          </span>
          <span className="grid h-6 w-6 place-items-center rounded-full bg-neutral-700 text-white">
            <Video className="h-3 w-3" />
          </span>
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-neutral-800 px-2 text-[9px] font-semibold text-white">
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-red-500"
              animate={encerrou ? {} : { opacity: [1, 0.2, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
            <Captions className="h-3 w-3" /> Ata ligada
          </span>
          <span className="text-[10px] tabular-nums text-white/60">47:12</span>
          <span className="ml-auto inline-flex h-[26px] w-[76px] items-center justify-center gap-1 rounded-full bg-red-600 text-[10px] font-semibold text-white">
            <PhoneOff className="h-3 w-3" /> Encerrar
          </span>
        </div>
        {r.em("encerra") && (
          <div className="absolute inset-x-0 top-[70px] flex items-center justify-center gap-1.5 text-[11px] font-medium text-white">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Gerando a ata…
          </div>
        )}
      </div>
      {/* a ata pronta, com resumo, decisões e próximos passos */}
      <AnimatePresence>
        {r.ja("ata") && (
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
            className="absolute right-3 top-3 z-10 h-[190px] w-[220px] rounded-xl border border-border bg-card p-2.5 shadow-2xl"
          >
            <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-primary">
              <Captions className="h-3 w-3" /> Ata pronta
              <span className="ml-auto font-normal normal-case text-muted-foreground">
                Atas & Planos
              </span>
            </div>
            {[
              { t: "Resumo", s: "Peça da 22 e prêmio do 820" },
              { t: "Decisões", s: "Fechar o prêmio na quarta" },
              { t: "Próximos passos", s: "Lucas confirma a entrega" },
            ].map((x, i) => (
              <motion.div
                key={x.t}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.3 }}
                className="mt-1.5 flex gap-1.5"
              >
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.45 + i * 0.3, type: "spring" }}
                  className="mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full bg-success text-white"
                >
                  <Check className="h-2.5 w-2.5" />
                </motion.span>
                <span className="leading-tight">
                  <span className="block text-[11px] font-semibold">{x.t}</span>
                  <span className="block text-[9px] text-muted-foreground">{x.s}</span>
                </span>
              </motion.div>
            ))}
            <span
              className={`absolute inset-x-2.5 bottom-2.5 flex h-[26px] items-center gap-1.5 rounded-full border px-1 text-[10px] font-medium transition-colors ${
                r.ja("ouve") ? "border-primary bg-primary/10" : "border-border"
              }`}
            >
              <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                {r.ja("ouve") ? (
                  <Pause className="h-2.5 w-2.5" />
                ) : (
                  <Play className="ml-px h-2.5 w-2.5" />
                )}
              </span>
              <span className="whitespace-nowrap">Ouvir trecho</span>
              <span className="ml-auto flex h-3 items-center gap-[2px] pr-1.5">
                {ONDA.slice(0, 7).map((b, i) => (
                  <motion.span
                    key={i}
                    className="w-[2px] rounded-full bg-primary"
                    style={{ height: `${b * 100}%` }}
                    animate={
                      r.em("ouve")
                        ? { height: [`${b * 100}%`, `${(1 - b) * 70 + 25}%`, `${b * 100}%`] }
                        : {}
                    }
                    transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.05 }}
                  />
                ))}
              </span>
              <span className="pr-1.5 text-[9px] tabular-nums text-muted-foreground">0:08</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <Cursor r={r} />
    </Palco>
  );
}

/* ————— 7. A ofensiva da semana ————— */

const ROTEIRO_OFENSIVA: Passo[] = [
  { id: "inicio", ms: 1100 },
  { id: "d1", ms: 750 },
  { id: "d2", ms: 750 },
  { id: "d3", ms: 750 },
  { id: "d4", ms: 900 },
  { id: "fala", ms: 3000 },
];

function IlustracaoOfensiva() {
  const r = useRoteiro(ROTEIRO_OFENSIVA);
  const feitos = ["d1", "d2", "d3", "d4"].filter((d) => r.ja(d)).length;
  const humor: Humor = feitos === 0 ? "triste" : feitos < 3 ? "preocupado" : "feliz";
  const dias = ["S", "T", "Q", "Q", "S"];
  return (
    <Palco w={380} h={216}>
      <span className="absolute bottom-1 left-[40px] h-3 w-24 rounded-full bg-black/15 blur-[2px]" />
      <div className="absolute bottom-3 left-[44px]">
        <motion.div
          key={humor}
          initial={{ y: 0 }}
          animate={humor === "feliz" && !r.reduz ? { y: [0, -14, 0] } : { y: [0, -4, 0] }}
          transition={{ duration: 0.5 }}
        >
          <Boneco
            alto={196}
            humor={humor}
            camisa="#1f2f56"
            roupa="polo"
            cabelo="#5b3a29"
            estilo="topete"
          />
        </motion.div>
      </div>
      {/* o balão do bom-dia */}
      <div className="absolute left-[150px] top-[14px] min-h-[38px] w-[222px] rounded-2xl bg-card px-3 py-2 text-[12px] font-medium shadow-lg ring-1 ring-border">
        <span className="absolute -left-1.5 top-4 h-3 w-3 rotate-45 bg-card" />
        {r.ja("fala") ? (
          <Digitando texto="Bom dia! Bora fechar a semana? ☀️" cadaMs={45} />
        ) : (
          <span className="flex h-5 items-center gap-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-muted-foreground"
                animate={r.reduz ? {} : { opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </span>
        )}
      </div>
      <div className="absolute left-[150px] top-[96px] w-[222px] rounded-xl border border-border bg-card p-3 shadow-2xl">
        <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-orange-500">
          <Flame className="h-3 w-3" /> Ofensiva ·{" "}
          <motion.span key={feitos} initial={{ scale: 1.6 }} animate={{ scale: 1 }}>
            {feitos}
          </motion.span>{" "}
          {feitos === 1 ? "dia" : "dias"}
        </div>
        <div className="mt-2.5 flex justify-between">
          {dias.map((d, i) => {
            const feito = i < feitos;
            const hoje = i === 4;
            return (
              <span key={i} className="flex flex-col items-center gap-1">
                <motion.span
                  key={`${i}-${feito}`}
                  initial={feito ? { scale: 0.4 } : false}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 12 }}
                  className={`grid h-8 w-8 place-items-center rounded-full text-[10px] font-bold ${
                    feito
                      ? "bg-orange-500 text-white shadow-[0_0_12px_rgba(249,115,22,0.6)]"
                      : hoje
                        ? "bg-secondary text-foreground ring-2 ring-orange-400 ring-offset-1 ring-offset-card"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {feito ? <Flame className="h-4 w-4 fill-amber-200" /> : d}
                </motion.span>
                <span className="text-[8px] text-muted-foreground">{hoje ? "hoje" : d}</span>
              </span>
            );
          })}
        </div>
      </div>
    </Palco>
  );
}

/* ————— 8. Meu mês (estilo Wrapped) ————— */

const ROTEIRO_MES: Passo[] = [
  { id: "s0", ms: 2500 },
  { id: "s1", ms: 2500 },
  { id: "s2", ms: 2800 },
];

const STORIES = [
  { de: "from-fuchsia-600", ate: "to-violet-700", t: "tarefas concluídas" },
  { de: "from-emerald-500", ate: "to-teal-700", t: "o seu melhor dia" },
  { de: "from-orange-500", ate: "to-rose-600", t: "no prazo" },
];

function IlustracaoMeuMes() {
  const r = useRoteiro(ROTEIRO_MES);
  const s = r.p;
  const st = STORIES[s]!;
  const vizinho = (k: number) => STORIES[(k + STORIES.length) % STORIES.length]!;
  return (
    <Palco w={380} h={216}>
      {/* as histórias vizinhas, espiando dos lados */}
      <div
        className={`absolute left-[34px] top-[26px] h-[164px] w-[100px] -rotate-6 rounded-2xl bg-gradient-to-br opacity-40 blur-[1px] ${vizinho(s - 1).de} ${vizinho(s - 1).ate}`}
      />
      <div
        className={`absolute left-[246px] top-[26px] h-[164px] w-[100px] rotate-6 rounded-2xl bg-gradient-to-br opacity-40 blur-[1px] ${vizinho(s + 1).de} ${vizinho(s + 1).ate}`}
      />
      <div
        className="absolute left-[120px] top-[2px] h-[212px] w-[140px]"
        style={{ perspective: 700 }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={s}
            initial={{ rotateY: 90, opacity: 0.4 }}
            animate={{ rotateY: 0, opacity: 1 }}
            exit={{ rotateY: -90, opacity: 0.4 }}
            transition={{ duration: 0.3 }}
            className={`absolute inset-0 flex flex-col overflow-hidden rounded-2xl bg-gradient-to-br p-3 pt-5 text-white shadow-2xl ${st.de} ${st.ate}`}
          >
            <div className="text-[9px] font-semibold uppercase tracking-wider opacity-80">
              Outubro de 2026
            </div>
            {s === 0 && (
              <>
                <div className="mt-auto font-display text-5xl font-black leading-none">
                  <NumeroSobe alvo={87} dur={1.3} />
                </div>
                <div className="mt-1 text-[11px] font-semibold leading-tight">{st.t}</div>
                <div className="mt-2 flex flex-wrap gap-0.5">
                  {Array.from({ length: 12 }, (_, i) => (
                    <motion.span
                      key={i}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2 + i * 0.07 }}
                      className="grid h-3.5 w-3.5 place-items-center rounded-sm bg-white/25"
                    >
                      <Check className="h-2.5 w-2.5" />
                    </motion.span>
                  ))}
                </div>
              </>
            )}
            {s === 1 && (
              <>
                <div className="mt-3 flex h-[64px] items-end gap-1.5">
                  {[0.45, 1, 0.6, 0.7, 0.5].map((h, i) => (
                    <span key={i} className="flex flex-1 flex-col items-center gap-0.5">
                      <motion.span
                        className={`w-full rounded-t ${i === 1 ? "bg-white" : "bg-white/35"}`}
                        initial={{ height: 0 }}
                        animate={{ height: h * 52 }}
                        transition={{
                          delay: 0.2 + i * 0.08,
                          type: "spring",
                          stiffness: 160,
                          damping: 16,
                        }}
                      />
                      <span className="text-[8px] opacity-80">{"STQQS"[i]}</span>
                    </span>
                  ))}
                </div>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="mt-auto font-display text-4xl font-black leading-none"
                >
                  Terça
                </motion.div>
                <div className="mt-1 text-[11px] font-semibold leading-tight">{st.t}</div>
              </>
            )}
            {s === 2 && (
              <>
                <div className="relative mx-auto mt-2 h-[76px] w-[76px]">
                  <svg viewBox="0 0 40 40" className="h-full w-full -rotate-90">
                    <circle
                      cx="20"
                      cy="20"
                      r="16"
                      fill="none"
                      stroke="rgba(255,255,255,0.25)"
                      strokeWidth="5"
                    />
                    <motion.circle
                      cx="20"
                      cy="20"
                      r="16"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="5"
                      strokeLinecap="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 0.94 }}
                      transition={{ duration: 1.3, ease: "easeOut" }}
                    />
                  </svg>
                  <Check className="absolute inset-0 m-auto h-6 w-6" />
                </div>
                <div className="mt-auto font-display text-5xl font-black leading-none">
                  <NumeroSobe alvo={94} dur={1.3} sufixo="%" />
                </div>
                <div className="mt-1 text-[11px] font-semibold leading-tight">{st.t}</div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
        {/* as barrinhas de progresso, como nos stories */}
        <div className="absolute inset-x-2.5 top-2 z-10 flex gap-1">
          {STORIES.map((_, i) => (
            <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
              <motion.span
                key={`${i}-${s}`}
                className="block h-full rounded-full bg-white"
                initial={{ width: i < s ? "100%" : "0%" }}
                animate={{ width: i <= s ? "100%" : "0%" }}
                transition={
                  i === s && !r.reduz
                    ? { duration: ROTEIRO_MES[i]!.ms / 1000, ease: "linear" }
                    : { duration: 0 }
                }
              />
            </span>
          ))}
        </div>
      </div>
    </Palco>
  );
}

/* ————— 9. Aniversário com festa ————— */

const ROTEIRO_ANIVERSARIO: Passo[] = [
  { id: "inicio", ms: 1000 },
  { id: "c1", ms: 900 },
  { id: "c2", ms: 900 },
  { id: "c3", ms: 900 },
  { id: "fim", ms: 2600 },
];

const PARABENS = [
  { id: "c1", quem: "Ana", cor: "bg-emerald-500", t: "Parabéns!! 🎉" },
  { id: "c2", quem: "Lucas", cor: "bg-sky-500", t: "Felicidades, muita saúde 🎂" },
  { id: "c3", quem: "Renata", cor: "bg-pink-500", t: "Muitos anos de vida! 🥳" },
];

function IlustracaoAniversario() {
  const r = useRoteiro(ROTEIRO_ANIVERSARIO);
  const coracoes = 21 + PARABENS.filter((c) => r.ja(c.id)).length;
  return (
    <Palco w={400} h={216}>
      {/* a chuva de confete */}
      <div className="pointer-events-none absolute -inset-y-4 inset-x-0 overflow-hidden">
        {Array.from({ length: 30 }, (_, i) => (
          <motion.span
            key={i}
            className="absolute top-0 h-2.5 w-1.5 rounded-sm"
            style={{
              left: `${(i * 37) % 100}%`,
              background: CORES_FESTA[i % CORES_FESTA.length],
              top: r.reduz ? `${(i * 53) % 100}%` : 0,
            }}
            initial={{ y: -20, rotate: 0 }}
            animate={r.reduz ? {} : { y: 260, rotate: 360 }}
            transition={{
              duration: 2.4 + (i % 5) * 0.3,
              delay: (i % 7) * 0.25,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        ))}
      </div>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 16 }}
        className="absolute left-[12px] top-[6px] flex h-[204px] w-[172px] flex-col items-center overflow-hidden rounded-3xl bg-gradient-to-br from-fuchsia-500 via-pink-500 to-amber-400 pt-2 text-white shadow-2xl"
      >
        <motion.div
          animate={r.reduz ? {} : { y: [0, -8, 0], rotate: [0, -3, 3, 0] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        >
          <Boneco
            alto={140}
            festa
            camisa="#62c0ff"
            roupa="social"
            cabelo="#5b3a29"
            estilo="topete"
          />
        </motion.div>
        <div className="font-display text-[14px] font-black">Feliz aniversário! 🎂</div>
        <div className="text-[10px] opacity-90">Eduardo · 20/10</div>
        {r.em("inicio") && !r.reduz && <Estouro n={20} raio={90} />}
      </motion.div>
      <div className="absolute left-[196px] top-[16px] h-[184px] w-[192px] rounded-xl border border-border bg-card p-2.5 shadow-2xl">
        <div className="flex items-center gap-1 text-[10px] font-bold text-pink-500">
          <Cake className="h-3 w-3" /> Parabéns no Mural
          <span className="ml-auto inline-flex items-center gap-0.5 font-semibold text-foreground">
            ❤️{" "}
            <motion.span key={coracoes} initial={{ scale: 1.5 }} animate={{ scale: 1 }}>
              {coracoes}
            </motion.span>
          </span>
        </div>
        <div className="mt-2 space-y-2">
          <AnimatePresence>
            {PARABENS.filter((c) => r.ja(c.id)).map((c) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, x: 14, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                className="flex gap-1.5"
              >
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white ${c.cor}`}
                >
                  {c.quem[0]}
                </span>
                <span className="rounded-xl rounded-tl-sm bg-secondary px-2 py-1 text-[10px] leading-tight">
                  <span className="block font-semibold">{c.quem}</span>
                  {c.t}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </Palco>
  );
}

/* ————— 10. E mais ————— */

const ROTEIRO_MAIS: Passo[] = [
  { id: "inicio", ms: 600, cursor: [200, 120] },
  { id: "vai1", ms: 450, cursor: [305, 34] },
  { id: "c1", ms: 1000, clica: true },
  { id: "vai2", ms: 450, cursor: [305, 84] },
  { id: "c2", ms: 1100, clica: true },
  { id: "vai3", ms: 450, cursor: [305, 134] },
  { id: "c3", ms: 1100, clica: true },
  { id: "vai4", ms: 450, cursor: [305, 184] },
  { id: "c4", ms: 2200, clica: true },
];

function IlustracaoMais() {
  const r = useRoteiro(ROTEIRO_MAIS);
  const linhas = [
    {
      id: "c1",
      Icone: FileSpreadsheet,
      t: "Minhas tarefas em Excel",
      antes: (
        <span className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[10px] font-medium">
          <Download className="h-3 w-3" /> Exportar
        </span>
      ),
      depois: (
        <motion.span
          initial={{ y: -14, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 14 }}
          className="inline-flex h-6 items-center gap-1 rounded-md bg-emerald-600 px-2 text-[10px] font-semibold text-white"
        >
          <FileSpreadsheet className="h-3 w-3" /> tarefas.xlsx
        </motion.span>
      ),
    },
    {
      id: "c2",
      Icone: Timer,
      t: "Duração da reunião",
      antes: (
        <span className="inline-flex h-6 items-center gap-1 rounded-md bg-red-600 px-2 text-[10px] font-semibold text-white">
          <PhoneOff className="h-3 w-3" /> Encerrar
        </span>
      ),
      depois: (
        <span className="inline-flex h-6 items-center gap-1 rounded-md bg-secondary px-2 text-[10px] font-semibold">
          <Timer className="h-3 w-3 text-primary" /> Durou <NumeroSobe alvo={47} dur={0.8} /> min
        </span>
      ),
    },
    {
      id: "c3",
      Icone: ImageIcon,
      t: "Colar imagem no Mural e no chat",
      antes: (
        <span className="inline-flex h-6 w-[86px] items-center rounded-md border border-border px-2 text-[10px] text-muted-foreground">
          Mensagem…
        </span>
      ),
      depois: (
        <span className="inline-flex items-center gap-1">
          <motion.kbd
            initial={{ scale: 1.2 }}
            animate={{ scale: 1 }}
            className="rounded border border-border bg-secondary px-1 text-[9px] font-semibold"
          >
            Ctrl+V
          </motion.kbd>
          <motion.span
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.25, type: "spring" }}
            className="relative h-7 w-10 overflow-hidden rounded-md bg-gradient-to-b from-sky-300 to-sky-100 shadow"
          >
            <span className="absolute bottom-0 left-0 h-3 w-7 rounded-tr-full bg-emerald-500" />
            <span className="absolute bottom-0 right-0 h-4 w-6 rounded-tl-full bg-emerald-600" />
            <span className="absolute right-1.5 top-1 h-2 w-2 rounded-full bg-amber-300" />
          </motion.span>
        </span>
      ),
    },
    {
      id: "c4",
      Icone: CalendarCheck,
      t: "Agenda travada voltou a salvar",
      antes: (
        <span className="inline-flex h-6 items-center rounded-md bg-primary px-3 text-[10px] font-semibold text-primary-foreground">
          Salvar
        </span>
      ),
      depois: (
        <span className="inline-flex h-6 items-center gap-1 rounded-md bg-success px-2.5 text-[10px] font-semibold text-white">
          <Check className="h-3 w-3" /> Salvo
        </span>
      ),
    },
  ];
  return (
    <Palco w={380} h={216}>
      <div className={MOLDURA}>
        {linhas.map((l, i) => {
          const feito = r.ja(l.id);
          return (
            <div
              key={l.id}
              className="absolute inset-x-2 flex h-11 items-center gap-2 rounded-lg px-2"
              style={{ top: 6 + i * 50 }}
            >
              <motion.span
                key={`${l.id}-${feito}`}
                initial={feito ? { scale: 0.3 } : false}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 12 }}
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                  feito ? "bg-success text-white" : "border-2 border-border"
                }`}
              >
                {feito && <Check className="h-3 w-3" />}
              </motion.span>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                <l.Icone className="h-3.5 w-3.5" />
              </span>
              <span
                className={`w-[182px] text-[11px] leading-tight ${feito ? "font-semibold" : ""}`}
              >
                {l.t}
              </span>
              <span className="absolute left-[266px] flex h-full items-center">
                {feito ? l.depois : l.antes}
              </span>
            </div>
          );
        })}
      </div>
      <Cursor r={r} />
    </Palco>
  );
}
