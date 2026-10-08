import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  Eraser,
  MessageCircle,
  Minus,
  Send,
  Smile,
  SmilePlus,
  Sparkles,
  Tractor,
  X,
  Zap,
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
const VERSAO = "2026-10-08-chat";

const chaveLocal = (pessoaId: string) => `fluxo:novidades:${pessoaId}`;

type Tela = {
  titulo: string;
  texto: string;
  Ilustracao: () => React.ReactElement;
};

const TELAS: Tela[] = [
  {
    titulo: "Novidades no SGL - CONECTA",
    texto:
      "Chamar a atenção de alguém agora mora no chat — junto com o trator e uma brincadeira nova. Vem ver onde ficou.",
    Ilustracao: IlustracaoAbertura,
  },
  {
    titulo: "Chamar atenção agora é no chat",
    texto:
      "Saiu das Ações rápidas (o raio ⚡). Abra a conversa com a pessoa e clique no sininho, no topo da janela. A tela dela treme, a conversa abre sozinha do lado de lá e fica registrado: “Eduardo chamou sua atenção”.",
    Ilustracao: () => <JanelaDoChat destaque="atencao" />,
  },
  {
    titulo: "O trator também",
    texto:
      "No mesmo lugar, o tratorzinho: escreva o recado e ele atravessa a tela da pessoa puxando a faixa. O recado também fica na conversa.",
    Ilustracao: () => <JanelaDoChat destaque="trator" />,
  },
  {
    titulo: "Novo: emoji gigante 🎉",
    texto:
      "Clique na carinha e escolha um emoji: ele toma a tela inteira da pessoa, com o seu nome embaixo — como no velho MSN. Use para comemorar, agradecer… ou só para alegrar o dia.",
    Ilustracao: IlustracaoEmojiGigante,
  },
  {
    titulo: "E dá para reagir às tarefas",
    texto:
      "Recebeu uma tarefa? Em vez de só “visto”, clique em Reagir e escolha um emoji. Quem mandou fica sabendo — e todo mundo vê quem reagiu. Também dá pelo botão direito na tarefa.",
    Ilustracao: IlustracaoReacao,
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
              <div className="flex items-center gap-1.5" role="tablist" aria-label="Telas de novidades">
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

/** O anel que pulsa em volta do que a pessoa precisa achar. */
function Destaque({ children, ativo }: { children: React.ReactNode; ativo: boolean }) {
  if (!ativo) return <span className="opacity-60">{children}</span>;
  return (
    <span className="relative grid place-items-center">
      <motion.span
        className="absolute -inset-1.5 rounded-lg ring-2 ring-primary"
        animate={{ scale: [1, 1.25, 1], opacity: [1, 0.3, 1] }}
        transition={{ duration: 1.4, repeat: Infinity }}
      />
      <span className="relative rounded-md bg-primary p-1 text-primary-foreground">{children}</span>
    </span>
  );
}

/** A janelinha do chat, com o cabeçalho preto e os botões do jeito que estão no app. */
function JanelaDoChat({ destaque }: { destaque: "atencao" | "trator" }) {
  return (
    <div className="relative">
      <div className="w-72 overflow-hidden rounded-t-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-2 bg-sidebar px-2.5 py-2 text-sidebar-foreground">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/30 text-[10px] font-bold">
            SO
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-semibold">SOPHIA</div>
            <div className="text-[9px] text-emerald-400">Disponível</div>
          </div>
          <span className="flex items-center gap-1.5">
            <Destaque ativo={destaque === "atencao"}>
              <BellRing className="h-3.5 w-3.5" />
            </Destaque>
            <Destaque ativo={destaque === "trator"}>
              <Tractor className="h-3.5 w-3.5" />
            </Destaque>
            <span className="opacity-60">
              <Smile className="h-3.5 w-3.5" />
            </span>
            <span className="text-red-400">
              <Eraser className="h-3.5 w-3.5" />
            </span>
            <span className="h-3 w-px bg-white/20" />
            <Minus className="h-3.5 w-3.5 opacity-60" />
            <X className="h-3.5 w-3.5 opacity-60" />
          </span>
        </div>
        <div className="space-y-1.5 p-2.5">
          <div className="w-fit rounded-xl rounded-bl-sm bg-secondary px-2.5 py-1 text-[10px]">
            Bom dia! Viu o relatório?
          </div>
          {destaque === "atencao" ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="mx-auto w-fit rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-medium"
            >
              🔔 Você chamou a atenção
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="flex items-center gap-1 rounded-md border border-border bg-background p-1"
            >
              <span className="flex-1 truncate px-1 text-[10px] text-muted-foreground">
                Reunião às 14h, não esquece! 🚜
              </span>
              <span className="grid h-5 w-5 place-items-center rounded bg-primary text-primary-foreground">
                <Send className="h-2.5 w-2.5" />
              </span>
            </motion.div>
          )}
        </div>
      </div>
      {destaque === "trator" && (
        <motion.div
          className="absolute -bottom-6 left-0 flex items-center gap-1 text-2xl"
          initial={{ x: -120 }}
          animate={{ x: 260 }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }}
        >
          <span className="rounded bg-amber-300 px-1.5 py-0.5 text-[9px] font-bold text-amber-950">
            Reunião às 14h!
          </span>
          🚜
        </motion.div>
      )}
      {destaque === "atencao" && (
        <motion.span
          className="absolute -right-6 -top-5 text-3xl"
          animate={{ rotate: [0, -18, 18, -12, 12, 0] }}
          transition={{ duration: 0.8, repeat: Infinity, repeatDelay: 0.8 }}
        >
          🔔
        </motion.span>
      )}
    </div>
  );
}

function IlustracaoAbertura() {
  return (
    <div className="flex items-center gap-4">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-card text-muted-foreground shadow-lg">
        <Zap className="h-6 w-6" />
      </span>
      <motion.span
        animate={{ x: [0, 8, 0] }}
        transition={{ duration: 1.2, repeat: Infinity }}
        className="text-primary"
      >
        <ArrowRight className="h-7 w-7" />
      </motion.span>
      <span className="relative grid h-16 w-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-xl">
        <MessageCircle className="h-8 w-8" />
        <motion.span
          className="absolute -right-2 -top-2 text-xl"
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
        >
          <Sparkles className="h-5 w-5 text-amber-400" />
        </motion.span>
      </span>
    </div>
  );
}

function IlustracaoEmojiGigante() {
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {Array.from({ length: 9 }, (_, i) => (
        <motion.span
          key={i}
          className="absolute text-xl"
          style={{ left: `${8 + i * 10.5}%` }}
          initial={{ y: 140, opacity: 0 }}
          animate={{ y: -140, opacity: [0, 1, 0] }}
          transition={{ duration: 2.4, delay: i * 0.25, repeat: Infinity }}
        >
          🎉
        </motion.span>
      ))}
      <div className="flex flex-col items-center">
        <motion.span
          className="text-7xl leading-none drop-shadow-lg"
          animate={{ scale: [0.4, 1.15, 1], rotate: [-15, 6, 0] }}
          transition={{ duration: 1, repeat: Infinity, repeatDelay: 1.4 }}
        >
          🎉
        </motion.span>
        <span className="mt-2 rounded-full bg-gradient-to-r from-primary via-lime-500 to-amber-400 px-4 py-1 text-xs font-black uppercase text-white shadow">
          Eduardo mandou!
        </span>
      </div>
      <span className="absolute bottom-3 right-4 flex items-center gap-1 rounded-md bg-sidebar px-2 py-1 text-sidebar-foreground shadow">
        <Destaque ativo>
          <Smile className="h-3.5 w-3.5" />
        </Destaque>
        <span className="text-[10px] font-semibold">Emoji</span>
      </span>
    </div>
  );
}

function IlustracaoReacao() {
  return (
    <div className="w-72 rounded-xl border border-border bg-card p-3 shadow-xl">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="rounded bg-sky-500/15 px-1.5 text-[9px] font-semibold text-sky-600">TI</span>
      </div>
      <div className="text-sm font-medium">Conferir os boletins de hoje</div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <span className="relative inline-flex items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          <motion.span
            className="absolute -inset-1 rounded-full ring-2 ring-primary"
            animate={{ scale: [1, 1.15, 1], opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.4, repeat: Infinity }}
          />
          <SmilePlus className="h-3 w-3" /> Reagir
        </span>
        <span className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px]">
          <span>👍❤️</span>
          <span className="text-muted-foreground">Você e Sophia</span>
        </span>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="mt-2.5 flex gap-1 rounded-full border border-border bg-background p-1 shadow"
      >
        {["👍", "❤️", "😂", "🙏", "🔥", "✅"].map((e) => (
          <span key={e} className="grid h-6 w-6 place-items-center text-base">
            {e}
          </span>
        ))}
      </motion.div>
    </div>
  );
}
