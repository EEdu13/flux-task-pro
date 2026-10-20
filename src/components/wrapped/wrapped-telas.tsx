import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "framer-motion";
import { Loader2, Megaphone, X } from "lucide-react";
import { toast } from "sonner";
import { useEscFecha } from "@/hooks/use-esc-fecha";
import { TravaScroll } from "@/components/trava-scroll";
import { useFluxo } from "@/lib/fluxo-store";
import { primeiroNome } from "@/integrations/iam/types";
import type { AvatarConfig } from "@/lib/avatar-3d";
import type { MeuWrapped } from "@/lib/wrapped.functions";
import type { Gesto } from "@/components/rv/poses-de-reacao";
import { avisarMuralPublicado, ehErroDeMuralInativo, MSG_MURAL_INATIVO } from "@/lib/mural-cliente";

/*
 * As telas do Wrapped do mês (19/10/2026) — como stories: barrinhas no topo,
 * toque/clique/seta avança (o terço esquerdo volta), e passa sozinho a cada
 * ~5 s até o cartão-resumo, onde para e espera o "Postar no mural" ou o
 * "Fechar". Cada tela tem o seu gradiente e o seu gesto do boneco.
 *
 * Carregado sob demanda por `porta-do-wrapped.tsx`; o boneco (three.js) vem
 * de mais longe ainda, `wrapped-avatar.tsx`, só quando o avatar chega.
 */

const AvatarDoWrapped = lazy(() => import("@/components/wrapped/wrapped-avatar"));

const DURACAO_MS = 5200;
/** "segunda-feira" vira "segundas-feiras", não "segunda-feiras". */
const DIAS_NO_PLURAL = [
  "domingos",
  "segundas-feiras",
  "terças-feiras",
  "quartas-feiras",
  "quintas-feiras",
  "sextas-feiras",
  "sábados",
];

const DIAS_DA_SEMANA = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];
/** As barrinhas do dia da semana, de segunda a domingo. */
const ORDEM_DA_SEMANA = [1, 2, 3, 4, 5, 6, 0];
const SIGLAS = ["D", "S", "T", "Q", "Q", "S", "S"];

type Tela = {
  id: string;
  fundo: string;
  /** Cor das bolhas que flutuam por trás. */
  bolhas: [string, string];
  gesto: Gesto;
  conteudo: React.ReactNode;
};

export default function TelasDoWrapped({ mes, aoFechar }: { mes: string; aoFechar: () => void }) {
  const { currentUser } = useFluxo();
  const [dados, setDados] = useState<MeuWrapped | null>(null);
  const [avatar, setAvatar] = useState<AvatarConfig | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEscFecha(true, aoFechar);

  /* Os números e o boneco chegam em paralelo; o boneco é enfeite — se falhar,
     vai o em branco e o Wrapped abre do mesmo jeito. */
  useEffect(() => {
    let vivo = true;
    import("@/lib/wrapped.functions")
      .then((m) => m.meuWrapped({ data: { mes } }))
      .then((d) => vivo && setDados(d))
      .catch((e: unknown) => {
        console.warn("wrapped: não deu para carregar o mês", e);
        if (vivo) setErro((e as Error)?.message || "Não deu para montar o seu mês agora.");
      });
    import("@/lib/avatar-3d")
      .then(async (lib) => (await lib.carregarMeuAvatar()) ?? lib.AVATAR_EM_BRANCO)
      .catch(async (e: unknown) => {
        console.warn("wrapped: não deu para carregar o avatar", e);
        return (await import("@/lib/avatar-3d")).AVATAR_EM_BRANCO;
      })
      .then((a) => vivo && setAvatar(a));
    return () => {
      vivo = false;
    };
  }, [mes]);

  const nomeDoMes = useMemo(() => {
    const [a, m] = mes.split("-").map(Number);
    return new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString("pt-BR", {
      month: "long",
      timeZone: "UTC",
    });
  }, [mes]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[480] select-none overflow-hidden text-white"
      role="dialog"
      aria-modal="true"
      aria-label={`Seu ${nomeDoMes} no CONECTA`}
    >
      <TravaScroll />
      {dados ? (
        <Sequencia
          dados={dados}
          avatar={avatar}
          nomeDoMes={nomeDoMes}
          nome={primeiroNome(currentUser.name ?? "")}
          aoFechar={aoFechar}
        />
      ) : (
        <div
          className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
          style={{ background: "linear-gradient(135deg,#7c3aed,#db2777 55%,#f97316)" }}
        >
          {erro ? (
            <>
              <p className="max-w-sm text-lg font-semibold">{erro}</p>
              <button
                type="button"
                onClick={aoFechar}
                className="rounded-full bg-white px-6 py-2.5 font-bold text-zinc-900 shadow-lg"
              >
                Fechar
              </button>
            </>
          ) : (
            <>
              <Loader2 className="h-10 w-10 animate-spin" aria-hidden />
              <p className="text-lg font-semibold">Preparando o seu {nomeDoMes}…</p>
            </>
          )}
        </div>
      )}
    </motion.div>
  );
}

/* ————————————————— A sequência ————————————————— */

function Sequencia({
  dados,
  avatar,
  nomeDoMes,
  nome,
  aoFechar,
}: {
  dados: MeuWrapped;
  avatar: AvatarConfig | null;
  nomeDoMes: string;
  nome: string;
  aoFechar: () => void;
}) {
  const reduzir = !!useReducedMotion();
  const telas = useMemo(
    () => montarTelas(dados, nomeDoMes, nome, aoFechar),
    [dados, nomeDoMes, nome, aoFechar],
  );
  const [indice, setIndice] = useState(0);
  const ultima = telas.length - 1;
  const tela = telas[Math.min(indice, ultima)];

  const avancar = useCallback(() => setIndice((i) => Math.min(i + 1, ultima)), [ultima]);
  const voltar = useCallback(() => setIndice((i) => Math.max(i - 1, 0)), []);

  // Passa sozinho; no cartão-resumo, para.
  useEffect(() => {
    if (indice >= ultima) return;
    const t = window.setTimeout(avancar, DURACAO_MS);
    return () => window.clearTimeout(t);
  }, [indice, ultima, avancar]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        avancar();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        voltar();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [avancar, voltar]);

  /* Toque: o terço esquerdo volta, o resto avança — como nos stories. Os
     botões do cartão-resumo param o clique antes de chegar aqui. */
  const aoTocar = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX - r.left < r.width / 3) voltar();
    else avancar();
  };

  const naUltima = indice >= ultima;

  return (
    <div className="relative h-full w-full cursor-pointer" onClick={aoTocar}>
      {/* O fundo: um gradiente por tela, trocando em fade, com bolhas flutuando. */}
      <AnimatePresence initial={false}>
        <motion.div
          key={tela.id}
          className="absolute inset-0"
          style={{ background: tela.fundo }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Bolhas cores={tela.bolhas} parado={reduzir} />
        </motion.div>
      </AnimatePresence>

      {/* As barrinhas de progresso. */}
      <div className="absolute inset-x-0 top-0 z-20 flex gap-1.5 px-3 pt-3 md:px-6 md:pt-4">
        {telas.map((t, i) => (
          <div key={t.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
            {i < indice || (i === indice && naUltima) ? (
              <div className="h-full w-full bg-white" />
            ) : i === indice ? (
              <motion.div
                key={`${t.id}-${indice}`}
                className="h-full bg-white"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: DURACAO_MS / 1000, ease: "linear" }}
              />
            ) : null}
          </div>
        ))}
      </div>
      <button
        type="button"
        aria-label="Fechar"
        onClick={(e) => {
          e.stopPropagation();
          aoFechar();
        }}
        className="absolute right-3 top-6 z-30 rounded-full bg-black/20 p-2 backdrop-blur transition hover:bg-black/35 md:right-6 md:top-8"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="relative z-10 flex h-full flex-col pt-12 md:flex-row md:items-center md:px-12 md:pt-10">
        {/* O texto da tela. */}
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 md:justify-start">
          <AnimatePresence mode="wait">
            <motion.div
              key={tela.id}
              className="w-full max-w-xl"
              initial={reduzir ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduzir ? { opacity: 0 } : { opacity: 0, y: -30 }}
              transition={{ type: "spring", stiffness: 220, damping: 24 }}
            >
              {tela.conteudo}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* O boneco: um <Canvas> só para a sequência inteira. */}
        <div
          className={`pointer-events-none mx-auto w-full shrink-0 transition-[height] duration-500 md:h-[80vh] md:w-[38vw] ${
            naUltima ? "h-[24vh]" : "h-[40vh]"
          }`}
          aria-hidden
        >
          {avatar && (
            <Suspense fallback={null}>
              <AvatarDoWrapped config={avatar} gesto={tela.gesto} chave={indice} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}

/** Bolhas desfocadas atravessando o fundo — o "gradiente vivo". */
function Bolhas({ cores, parado }: { cores: [string, string]; parado: boolean }) {
  const bolhas = [
    {
      cor: cores[0],
      tam: "55vmax",
      x: ["-10%", "15%", "-10%"],
      y: ["-10%", "10%", "-10%"],
      top: "-15%",
      left: "-15%",
    },
    {
      cor: cores[1],
      tam: "45vmax",
      x: ["10%", "-15%", "10%"],
      y: ["5%", "-10%", "5%"],
      top: "45%",
      left: "55%",
    },
  ];
  return (
    <>
      {bolhas.map((b, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full opacity-60 blur-3xl"
          style={{ background: b.cor, width: b.tam, height: b.tam, top: b.top, left: b.left }}
          animate={parado ? undefined : { x: b.x, y: b.y }}
          transition={{ duration: 14 + i * 4, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </>
  );
}

/* ————————————————— Os números ————————————————— */

/** Um número grande contando do zero. */
function Contador({ valor, formato }: { valor: number; formato?: (v: number) => string }) {
  const reduzir = !!useReducedMotion();
  const [v, setV] = useState(reduzir ? valor : 0);
  useEffect(() => {
    if (reduzir) {
      setV(valor);
      return;
    }
    const c = animate(0, valor, { duration: 1.6, ease: [0.16, 1, 0.3, 1], onUpdate: setV });
    return () => c.stop();
  }, [valor, reduzir]);
  return <>{formato ? formato(v) : Math.round(v).toLocaleString("pt-BR")}</>;
}

const Rotulo = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm font-bold uppercase tracking-[0.25em] text-white/80 md:text-base">
    {children}
  </p>
);
const Grande = ({ children }: { children: React.ReactNode }) => (
  <p
    className="my-2 text-[clamp(4.5rem,18vw,10rem)] font-black leading-none tracking-tighter tabular-nums"
    style={{ textShadow: "0 6px 30px rgba(0,0,0,0.25)" }}
  >
    {children}
  </p>
);
const Frase = ({ children }: { children: React.ReactNode }) => (
  <p className="text-lg font-semibold leading-snug text-white/95 md:text-2xl">{children}</p>
);

/** Estatísticas que as telas e o cartão-resumo usam. */
function resumir(d: MeuWrapped) {
  const porDia = Array<number>(7).fill(0);
  let melhor: { dia: string; n: number } | null = null;
  for (const l of d.dias) {
    porDia[new Date(`${l.dia}T00:00:00Z`).getUTCDay()] += l.concluidas;
    if (!melhor || l.concluidas > melhor.n) melhor = { dia: l.dia, n: l.concluidas };
  }
  const maxSemana = Math.max(...porDia);
  const diaTop = maxSemana > 0 ? porDia.indexOf(maxSemana) : -1;
  const pctPrazo = d.comPrazo > 0 ? Math.round((d.noPrazo / d.comPrazo) * 100) : null;
  const horas = Math.floor(d.segundos / 3600);
  const minutos = Math.floor((d.segundos % 3600) / 60);
  return { porDia, maxSemana, diaTop, melhor, pctPrazo, horas, minutos };
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

function montarTelas(d: MeuWrapped, nomeDoMes: string, nome: string, aoFechar: () => void): Tela[] {
  const s = resumir(d);
  const telas: Tela[] = [];

  telas.push({
    id: "abertura",
    fundo: "linear-gradient(135deg,#7c3aed 0%,#db2777 55%,#f97316 100%)",
    bolhas: ["#f472b6", "#facc15"],
    gesto: "acenar",
    conteudo: (
      <div>
        <Rotulo>{nome ? `Oi, ${nome}!` : "Oi!"}</Rotulo>
        <h1 className="mt-3 text-[clamp(2.6rem,9vw,5.5rem)] font-black leading-[0.95] tracking-tight">
          Seu <span className="capitalize">{nomeDoMes}</span> no CONECTA
        </h1>
        <Frase>
          <span className="mt-4 block">Bora relembrar o que você fez nesse mês? 🎧</span>
        </Frase>
      </div>
    ),
  });

  telas.push({
    id: "tarefas",
    fundo: "linear-gradient(160deg,#059669 0%,#0d9488 45%,#0ea5e9 100%)",
    bolhas: ["#34d399", "#38bdf8"],
    gesto: "comemorar",
    conteudo: (
      <div>
        <Rotulo>Tarefas concluídas</Rotulo>
        <Grande>
          <Contador valor={d.concluidas} />
        </Grande>
        <Frase>
          {d.concluidas === 0
            ? "Mês tranquilo por aqui — o próximo é seu! 💪"
            : s.melhor && s.melhor.n > 1
              ? `Seu dia mais forte foi ${ddmm(s.melhor.dia)}, com ${s.melhor.n} tarefas concluídas. 🔥`
              : `${plural(d.concluidas, "Uma entrega", "Entregas")} que fizeram diferença. ✅`}
        </Frase>
      </div>
    ),
  });

  if (s.pctPrazo !== null) {
    const pct = s.pctPrazo;
    telas.push({
      id: "prazo",
      fundo: "linear-gradient(150deg,#f59e0b 0%,#f97316 45%,#ef4444 100%)",
      bolhas: ["#fde047", "#fb7185"],
      gesto: "joinha",
      conteudo: (
        <div>
          <Rotulo>Concluídas no prazo</Rotulo>
          <Grande>
            <Contador valor={pct} formato={(v) => `${Math.round(v)}%`} />
          </Grande>
          <Frase>
            {d.noPrazo} de {d.comPrazo} com prazo foram entregues até o dia combinado.{" "}
            {pct >= 90
              ? "Pontualidade de relógio suíço! ⏰"
              : pct >= 70
                ? "Mandou bem! 👍"
                : "Dá para subir esse número no próximo mês. 🚀"}
          </Frase>
        </div>
      ),
    });
  }

  if (s.diaTop >= 0) {
    telas.push({
      id: "semana",
      fundo: "linear-gradient(150deg,#2563eb 0%,#4f46e5 50%,#7c3aed 100%)",
      bolhas: ["#60a5fa", "#c084fc"],
      gesto: "bora",
      conteudo: (
        <div>
          <Rotulo>Seu dia mais produtivo</Rotulo>
          <p className="my-3 text-[clamp(2.8rem,11vw,6rem)] font-black capitalize leading-none tracking-tight">
            {DIAS_DA_SEMANA[s.diaTop]}
          </p>
          <div className="mt-6 flex h-32 items-end gap-2 md:h-40" aria-hidden>
            {ORDEM_DA_SEMANA.map((dia, i) => (
              <div key={dia} className="flex flex-1 flex-col items-center gap-1.5">
                <motion.div
                  className={`w-full rounded-t-lg ${dia === s.diaTop ? "bg-white" : "bg-white/35"}`}
                  initial={{ height: 0 }}
                  animate={{ height: `${Math.max(4, (s.porDia[dia] / s.maxSemana) * 100)}%` }}
                  transition={{
                    delay: 0.2 + i * 0.07,
                    type: "spring",
                    stiffness: 160,
                    damping: 18,
                  }}
                />
                <span className="text-xs font-bold text-white/80">{SIGLAS[dia]}</span>
              </div>
            ))}
          </div>
          <Frase>
            <span className="mt-4 block">
              {s.maxSemana} {plural(s.maxSemana, "tarefa concluída", "tarefas concluídas")} em{" "}
              {DIAS_NO_PLURAL[s.diaTop]}.
            </span>
          </Frase>
        </div>
      ),
    });
  }

  if (d.segundos >= 60) {
    telas.push({
      id: "horas",
      fundo: "linear-gradient(160deg,#0891b2 0%,#0e7490 40%,#4338ca 100%)",
      bolhas: ["#22d3ee", "#818cf8"],
      gesto: "cafe",
      conteudo: (
        <div>
          <Rotulo>Tempo cronometrado</Rotulo>
          <Grande>
            <Contador valor={s.horas} />
            <span className="text-[0.4em] font-extrabold tracking-normal">h</span>
            {s.minutos > 0 && (
              <span className="ml-2 text-[0.3em] font-bold tracking-normal">{s.minutos}min</span>
            )}
          </Grande>
          <Frase>
            Em {d.diasCronometrados} {plural(d.diasCronometrados, "dia", "dias diferentes")} com o
            relógio ligado. Foco total! ☕
          </Frase>
        </div>
      ),
    });
  }

  if (d.diasDePack > 0) {
    telas.push({
      id: "pack",
      fundo: "linear-gradient(150deg,#16a34a 0%,#65a30d 45%,#ca8a04 100%)",
      bolhas: ["#86efac", "#fde047"],
      gesto: "trofeu",
      conteudo: (
        <div>
          <Rotulo>Dias de pack fechado 🏆</Rotulo>
          <Grande>
            <Contador valor={d.packsFechados} />
            <span className="ml-2 text-[0.3em] font-bold tracking-normal text-white/80">
              de {d.diasDePack}
            </span>
          </Grande>
          <Frase>
            {d.maiorSequenciaDePack >= 2
              ? `Sua maior sequência: ${d.maiorSequenciaDePack} dias seguidos com tudo entregue. 🔥`
              : d.packsFechados > 0
                ? "Pack fechado é dia ganho. Bora emendar uma sequência? 📦"
                : "O pack do próximo mês é todo seu. 📦"}
          </Frase>
        </div>
      ),
    });
  }

  const recebidos = d.agradecimentosRecebidos;
  const dados = d.agradecimentosDados;
  if (recebidos !== null && dados !== null && recebidos + dados > 0) {
    telas.push({
      id: "mural",
      fundo: "linear-gradient(150deg,#e11d48 0%,#db2777 50%,#f472b6 100%)",
      bolhas: ["#fda4af", "#f9a8d4"],
      gesto: "obrigado",
      conteudo: (
        <div>
          <Rotulo>Agradecimentos no mural 💛</Rotulo>
          <div className="my-3 flex flex-wrap items-end gap-8">
            <div>
              <Grande>
                <Contador valor={recebidos} />
              </Grande>
              <p className="font-bold text-white/85">
                {plural(recebidos, "recebido", "recebidos")}
              </p>
            </div>
            <div>
              <Grande>
                <Contador valor={dados} />
              </Grande>
              <p className="font-bold text-white/85">{plural(dados, "dado", "dados")}</p>
            </div>
          </div>
          <Frase>
            {recebidos > 0
              ? "Seu trabalho foi notado. Gente boa faz diferença! 🙌"
              : "Quem agradece espalha energia boa. 🙌"}
          </Frase>
        </div>
      ),
    });
  }

  telas.push({
    id: "resumo",
    fundo: "linear-gradient(150deg,#111827 0%,#4c1d95 50%,#be185d 100%)",
    bolhas: ["#8b5cf6", "#f43f5e"],
    gesto: "comemorar",
    conteudo: <CartaoResumo d={d} s={s} nomeDoMes={nomeDoMes} nome={nome} aoFechar={aoFechar} />,
  });

  return telas;
}

/* ————————————————— O cartão-resumo ————————————————— */

function textoDoResumo(d: MeuWrapped, s: ReturnType<typeof resumir>, nomeDoMes: string): string {
  const linhas = [`🎧 Meu ${nomeDoMes} no CONECTA`, ""];
  linhas.push(
    `✅ ${d.concluidas} ${plural(d.concluidas, "tarefa concluída", "tarefas concluídas")}`,
  );
  if (s.pctPrazo !== null) linhas.push(`⏰ ${s.pctPrazo}% no prazo`);
  if (s.diaTop >= 0) linhas.push(`📅 Dia mais produtivo: ${DIAS_DA_SEMANA[s.diaTop]}`);
  if (d.segundos >= 60)
    linhas.push(`⏱️ ${s.horas}h${s.minutos ? ` ${s.minutos}min` : ""} cronometradas`);
  if (d.diasDePack > 0)
    linhas.push(`📦 ${d.packsFechados} ${plural(d.packsFechados, "dia", "dias")} de pack fechado`);
  if (d.agradecimentosRecebidos)
    linhas.push(
      `💛 ${d.agradecimentosRecebidos} ${plural(d.agradecimentosRecebidos, "agradecimento recebido", "agradecimentos recebidos")}`,
    );
  return linhas.join("\n");
}

function CartaoResumo({
  d,
  s,
  nomeDoMes,
  nome,
  aoFechar,
}: {
  d: MeuWrapped;
  s: ReturnType<typeof resumir>;
  nomeDoMes: string;
  nome: string;
  aoFechar: () => void;
}) {
  const [postando, setPostando] = useState(false);
  const [postado, setPostado] = useState(false);
  /** Trava contra clique duplo antes do estado atualizar. */
  const enviando = useRef(false);

  const itens: { rotulo: string; valor: string }[] = [
    { rotulo: "tarefas", valor: d.concluidas.toLocaleString("pt-BR") },
  ];
  if (s.pctPrazo !== null) itens.push({ rotulo: "no prazo", valor: `${s.pctPrazo}%` });
  if (d.segundos >= 60) itens.push({ rotulo: "cronometradas", valor: `${s.horas}h` });
  if (d.diasDePack > 0) itens.push({ rotulo: "packs fechados", valor: String(d.packsFechados) });
  if (d.agradecimentosRecebidos)
    itens.push({ rotulo: "agradecimentos", valor: String(d.agradecimentosRecebidos) });

  const postar = async () => {
    if (enviando.current || postado) return;
    enviando.current = true;
    setPostando(true);
    try {
      const { publicarNoMural } = await import("@/lib/mural.functions");
      await publicarNoMural({ data: { tipo: "geral", texto: textoDoResumo(d, s, nomeDoMes) } });
      setPostado(true);
      avisarMuralPublicado();
      toast.success("Seu resumo foi para o mural 🎉");
    } catch (e) {
      console.warn("wrapped: não deu para postar no mural", e);
      toast.error(
        ehErroDeMuralInativo(e)
          ? MSG_MURAL_INATIVO
          : (e as Error)?.message || "Não deu para postar no mural agora.",
      );
    } finally {
      enviando.current = false;
      setPostando(false);
    }
  };

  return (
    <div
      className="cursor-default rounded-3xl border border-white/20 bg-white/10 p-6 shadow-2xl backdrop-blur-md md:p-8"
      onClick={(e) => e.stopPropagation()}
    >
      <Rotulo>{nome ? `O ${nomeDoMes} de ${nome}` : `Seu ${nomeDoMes}`}</Rotulo>
      <p className="mt-1 text-3xl font-black tracking-tight md:text-4xl">no CONECTA ✨</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {itens.map((it, i) => (
          <motion.div
            key={it.rotulo}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.08 }}
            className="rounded-2xl px-4 py-3"
            style={{ background: "rgba(255,255,255,0.12)" }}
          >
            <p className="text-3xl font-black tabular-nums md:text-4xl">{it.valor}</p>
            <p className="text-xs font-bold uppercase tracking-wider text-white/75">{it.rotulo}</p>
          </motion.div>
        ))}
        {s.diaTop >= 0 && (
          <div
            className="col-span-2 rounded-2xl px-4 py-3"
            style={{ background: "rgba(255,255,255,0.12)" }}
          >
            <p className="text-xs font-bold uppercase tracking-wider text-white/75">
              dia mais produtivo
            </p>
            <p className="text-xl font-black capitalize">{DIAS_DA_SEMANA[s.diaTop]}</p>
          </div>
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void postar()}
          disabled={postando || postado}
          className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 font-bold text-zinc-900 shadow-lg transition hover:scale-[1.03] disabled:opacity-70 disabled:hover:scale-100"
        >
          {postando ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Megaphone className="h-4 w-4" aria-hidden />
          )}
          {postado ? "Postado no mural" : "Postar no mural"}
        </button>
        <button
          type="button"
          onClick={aoFechar}
          className="rounded-full border border-white/40 px-5 py-2.5 font-bold transition hover:bg-white/10"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
