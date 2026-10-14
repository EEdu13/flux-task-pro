import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarClock,
  Check,
  Flame,
  Home,
  Lock,
  Sparkles,
  Tag,
  Users,
  Wrench,
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
 * tela muda de cor.
 */
const VERSAO = "2026-10-14-repaginada";

const chaveLocal = (pessoaId: string) => `fluxo:novidades:${pessoaId}`;

type Tela = {
  titulo: string;
  texto: string;
  Ilustracao: () => React.ReactElement;
};

/* A leva de 14/10/2026: o que mudou desde as novidades do chat (08/10) —
   telas repaginadas, a agenda travada, o pack mais fácil e as correções. */
const TELAS: Tela[] = [
  {
    titulo: "O CONECTA ficou de cara nova",
    texto:
      "Início, Calendário, Pack, Relatórios e Metas foram repaginados — e chegou a agenda travada. São 6 telinhas rápidas para mostrar onde está cada coisa.",
    Ilustracao: IlustracaoAbertura,
  },
  {
    titulo: "Um Início que mostra o seu dia",
    texto:
      "Seu placar de hoje, da semana e do mês em anéis, o seu ritmo dos últimos 30 dias, a carga dos próximos dias e o tempo trabalhado ontem — com as tarefas que mais tomaram tempo.",
    Ilustracao: IlustracaoInicio,
  },
  {
    titulo: "Travar agenda, como no Outlook",
    texto:
      "O calendário ganhou linhas de horário. Clique com o botão direito num horário → Travar agenda, escolha as pessoas e o assunto. 30 e 10 minutos antes, o CONECTA vem para a frente da tela e avisa — quem criou também é avisado.",
    Ilustracao: IlustracaoAgenda,
  },
  {
    titulo: "Pack tão fácil quanto criar tarefa",
    texto:
      "No Pack diário, escreva e dê Enter: o item já entra, com horário, prioridade e tags se quiser. Em “Montar para alguém” dá para escolher várias pessoas de uma vez e ver o que cada uma já tem no dia.",
    Ilustracao: IlustracaoPack,
  },
  {
    titulo: "Minhas tarefas mais limpa",
    texto:
      "Tarefa que chegou hoje ganha o selo NOVA no próprio cartão — amanhã ele some sozinho. Setor e tags viraram listas suspensas, com busca. E dá para ligar a tarefa a um projeto seu pela pastinha.",
    Ilustracao: IlustracaoTarefas,
  },
  {
    titulo: "Relatórios e Metas de verdade",
    texto:
      "Relatórios virou uma análise: comparação com o período anterior, pendências, atrasos por dia, tempo por projeto e a tabela da equipe. Metas & Score ganhou medidor, evolução, pódio e alertas. E tudo exporta em Excel.",
    Ilustracao: IlustracaoRelatorios,
  },
  {
    titulo: "E o que consertamos",
    texto:
      "Feriado não conta mais atraso, e concluir no dia do prazo é no prazo — o horário é só o plano. Também acertamos o som do computador ao mostrar a tela, a escolha de microfone e câmera e o tempo que aparecia 0m.",
    Ilustracao: IlustracaoCorrecoes,
  },
];

export function Novidades() {
  const { currentUser, isAuthenticated } = useFluxo();
  const [aberta, setAberta] = useState(false);
  const [indice, setIndice] = useState(0);
  const [sentido, setSentido] = useState(1);

  /* Decide se mostra: a cópia local responde na hora; sem ela, pergunta ao
     banco — a pessoa pode ter visto em outro computador. */
  useEffect(() => {
    if (!isAuthenticated || !currentUser.id) return;
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

  return (
    <DialogPrimitive.Root open={aberta} onOpenChange={(v) => !v && marcarComoVista()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[480] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[481] w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
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
          <div className="relative flex h-60 items-center justify-center overflow-hidden bg-gradient-to-br from-primary/15 via-background to-secondary/60">
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
                <tela.Ilustracao />
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="px-6 pb-5 pt-4">
            <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
              {tela.titulo}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1.5 min-h-[4.5rem] text-sm leading-relaxed text-muted-foreground">
              {tela.texto.replace("Eduardo", primeiroNome(currentUser.name) || "Eduardo")}
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
                  {ultima ? "Entendi!" : "Próximo"}
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

/** A moldura de uma "tela" em miniatura. */
function Janela({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-border bg-card p-3 shadow-2xl ${className}`}
    >
      {children}
    </div>
  );
}

function IlustracaoAbertura() {
  const itens = [
    { Icone: Home, rotulo: "Início" },
    { Icone: CalendarClock, rotulo: "Agenda" },
    { Icone: Flame, rotulo: "Pack" },
    { Icone: BarChart3, rotulo: "Relatórios" },
  ];
  return (
    <div className="relative flex items-center gap-3">
      {itens.map(({ Icone, rotulo }, i) => (
        <motion.div
          key={rotulo}
          initial={{ opacity: 0, y: 16, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.15 + i * 0.12, type: "spring", stiffness: 260, damping: 18 }}
          className="flex flex-col items-center gap-1.5"
        >
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-card text-primary shadow-lg">
            <Icone className="h-6 w-6" />
          </span>
          <span className="text-[10px] font-semibold text-muted-foreground">{rotulo}</span>
        </motion.div>
      ))}
      <motion.span
        className="absolute -right-5 -top-6"
        animate={{ scale: [1, 1.3, 1], rotate: [0, 15, 0] }}
        transition={{ duration: 1.4, repeat: Infinity }}
      >
        <Sparkles className="h-6 w-6 text-amber-400" />
      </motion.span>
    </div>
  );
}

function IlustracaoInicio() {
  const aneis = [
    { r: 30, p: 0.8, cor: "var(--color-primary)" },
    { r: 22, p: 0.55, cor: "var(--color-success)" },
    { r: 14, p: 0.35, cor: "var(--color-warning)" },
  ];
  return (
    <Janela className="flex w-80 items-center gap-4">
      <svg viewBox="0 0 70 70" className="h-20 w-20 -rotate-90">
        {aneis.map((a, i) => {
          const volta = 2 * Math.PI * a.r;
          return (
            <g key={a.r}>
              <circle
                cx={35}
                cy={35}
                r={a.r}
                fill="none"
                strokeWidth={6}
                stroke="var(--color-secondary)"
              />
              <motion.circle
                cx={35}
                cy={35}
                r={a.r}
                fill="none"
                strokeWidth={6}
                strokeLinecap="round"
                stroke={a.cor}
                strokeDasharray={volta}
                initial={{ strokeDashoffset: volta }}
                animate={{ strokeDashoffset: volta * (1 - a.p) }}
                transition={{ duration: 1, delay: 0.2 + i * 0.15 }}
              />
            </g>
          );
        })}
      </svg>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          Seu ritmo
        </div>
        <svg viewBox="0 0 120 40" className="mt-1 h-10 w-full">
          <motion.path
            d="M0,32 C10,30 15,20 25,24 C35,28 40,10 50,14 C60,18 65,30 75,22 C85,14 95,6 105,12 C112,16 116,10 120,8"
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={2.5}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.4, ease: "easeOut" }}
          />
        </svg>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-[9px] text-muted-foreground">Ontem</span>
          <span className="font-display text-base font-bold text-primary">6h 40m</span>
        </div>
      </div>
    </Janela>
  );
}

function IlustracaoAgenda() {
  return (
    <div className="relative">
      <Janela className="w-72 p-0">
        {["13:00", "14:00", "15:00"].map((h, i) => (
          <div key={h} className="flex h-9 border-b border-border last:border-0">
            <span className="w-11 shrink-0 px-1.5 pt-0.5 text-[9px] text-muted-foreground">
              {h}
            </span>
            <div className="relative flex-1 border-l border-border">
              {i === 1 && (
                <motion.div
                  initial={{ opacity: 0, scaleY: 0.4 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  transition={{ delay: 0.3 }}
                  className="absolute inset-x-1 top-0.5 flex h-8 origin-top items-center gap-1 rounded-md bg-violet-500/90 px-1.5 text-[9px] font-semibold text-white"
                >
                  <Lock className="h-2.5 w-2.5" /> Alinhamento PCP
                </motion.div>
              )}
            </div>
          </div>
        ))}
      </Janela>
      <motion.div
        initial={{ opacity: 0, x: 30, y: 10 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        transition={{ delay: 1, type: "spring", stiffness: 200, damping: 18 }}
        className="absolute -bottom-8 -right-12 w-44 rounded-xl border border-violet-500/40 bg-card p-2 shadow-2xl"
      >
        <div className="text-[9px] font-bold uppercase text-violet-600">Em 10 minutos · 14:00</div>
        <div className="text-[11px] font-semibold">Alinhamento PCP</div>
        <div className="mt-1 flex -space-x-1.5">
          {["bg-sky-400", "bg-amber-400", "bg-emerald-400"].map((c) => (
            <span key={c} className={`h-5 w-5 rounded-full ring-2 ring-card ${c}`} />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function IlustracaoPack() {
  return (
    <Janela className="w-80">
      <div className="flex items-center gap-1.5 rounded-lg border border-primary/50 bg-background px-2 py-1.5">
        <Flame className="h-3.5 w-3.5 text-amber-500" />
        <motion.span
          className="flex-1 overflow-hidden whitespace-nowrap text-[11px]"
          initial={{ width: 0 }}
          animate={{ width: "100%" }}
          transition={{ duration: 1.2, ease: "linear" }}
        >
          Conferir boletins do 820
        </motion.span>
        <span className="rounded border border-border px-1 text-[9px] text-muted-foreground">
          Enter
        </span>
      </div>
      <div className="mt-2 flex gap-1">
        {["08:00", "Alta", "#campo"].map((c) => (
          <span key={c} className="rounded-full bg-secondary px-2 py-0.5 text-[9px] font-medium">
            {c}
          </span>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.4 }}
        className="mt-3 flex items-center gap-2 rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-primary-foreground"
      >
        <Users className="h-3.5 w-3.5" /> Enviar pack para 3 pessoas
      </motion.div>
    </Janela>
  );
}

function IlustracaoTarefas() {
  return (
    <div className="flex w-80 flex-col gap-2">
      <div className="flex gap-2">
        {[
          { Icone: Users, t: "Todos os setores" },
          { Icone: Tag, t: "Filtrar por tag" },
        ].map(({ Icone, t }) => (
          <span
            key={t}
            className="inline-flex flex-1 items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] text-muted-foreground shadow"
          >
            <Icone className="h-3 w-3" /> {t}
          </span>
        ))}
      </div>
      <Janela>
        <div className="flex items-center gap-1.5 text-sm font-medium">
          Revisar apontamentos da equipe
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.25, 1] }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[8px] font-bold uppercase text-white"
          >
            <Sparkles className="h-2.5 w-2.5" /> Nova
          </motion.span>
        </div>
        <div className="mt-0.5 text-[10px] font-medium text-emerald-600">chegou hoje 14/10</div>
      </Janela>
    </div>
  );
}

function IlustracaoRelatorios() {
  const barras = [40, 65, 52, 80, 70, 92];
  return (
    <Janela className="flex w-80 items-end gap-3">
      <div className="flex h-20 flex-1 items-end gap-1.5">
        {barras.map((h, i) => (
          <motion.span
            key={i}
            className="flex-1 rounded-t"
            style={{
              background:
                i === barras.length - 1
                  ? "var(--color-primary)"
                  : "color-mix(in oklab, var(--color-primary) 45%, var(--color-secondary))",
            }}
            initial={{ height: 2 }}
            animate={{ height: `${h}%` }}
            transition={{ delay: 0.1 + i * 0.08, duration: 0.5 }}
          />
        ))}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="font-display text-2xl font-bold text-success">92%</span>
        <span className="text-[9px] text-muted-foreground">no prazo · +8 pts</span>
        <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
          Excel
        </span>
      </div>
    </Janela>
  );
}

function IlustracaoCorrecoes() {
  const itens = [
    "Feriado não conta atraso",
    "No dia do prazo = no prazo",
    "Som do computador na tela",
    "Escolher microfone e câmera",
  ];
  return (
    <Janela className="w-72">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Wrench className="h-3 w-3" /> Corrigido
      </div>
      <ul className="space-y-1.5">
        {itens.map((t, i) => (
          <motion.li
            key={t}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 + i * 0.2 }}
            className="flex items-center gap-2 text-[11px]"
          >
            <span className="grid h-4 w-4 place-items-center rounded-full bg-success text-white">
              <Check className="h-2.5 w-2.5" />
            </span>
            {t}
          </motion.li>
        ))}
      </ul>
    </Janela>
  );
}
