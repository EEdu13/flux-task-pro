import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, CheckCheck, ChevronDown, Clock3, Paperclip, Send, Smile, X } from "lucide-react";
import { ESTADOS, INFO_DO_ESTADO, type SituacaoNoChat } from "@/lib/estado-do-chat";
import { toast } from "sonner";
import type { User } from "@/lib/fluxo-types";
import { filesToAttachments, isImage, openAttachment } from "@/lib/attachments";
import { pessoaOlhando, useChat, useConversation, type MensagemDaConversa } from "@/lib/chat-store";
import { useFluxo } from "@/lib/fluxo-store";
import { UserAvatar } from "@/components/user-avatar";
import { lerAviso } from "@/lib/avisos-no-chat";
import { REACOES_DO_AVATAR } from "@/lib/reacoes-do-avatar";
import { BotaoRecadoDeVoz } from "@/components/recado-de-voz";
import { BotaoGravarTela } from "@/components/gravar-tela";
import {
  ReprodutorDeAudio,
  ReprodutorDeVideo,
  ehAudio,
  ehVideo,
} from "@/components/reprodutor-de-midia";
import type { Attachment } from "@/lib/fluxo-types";
import { primeiroNome } from "@/integrations/iam/types";
import {
  DURACOES,
  EMOJIS_DE_STATUS,
  MAX_TEXTO_DO_STATUS,
  PRESETS_DE_STATUS,
  ateDaDuracao,
  hojeNoCampoDeData,
  rotuloDoAte,
  statusEmTexto,
  statusVigente,
  type Duracao,
  type StatusPersonalizado,
} from "@/lib/status-personalizado";

const EMOJIS = [
  "😀",
  "😁",
  "😂",
  "🤣",
  "😊",
  "😍",
  "😘",
  "😉",
  "😎",
  "🤩",
  "🥳",
  "🤔",
  "😴",
  "😅",
  "😭",
  "😡",
  "👍",
  "👎",
  "👏",
  "🙌",
  "🙏",
  "💪",
  "🔥",
  "✨",
  "🎉",
  "❤️",
  "💚",
  "💙",
  "💛",
  "⭐",
  "✅",
  "❌",
  "⚡",
  "☕",
  "🍺",
  "🚀",
  "💧",
  "🌳",
  "🚜",
  "📌",
  "👀",
  "🤝",
  "💯",
  "😬",
  "🥲",
  "😱",
  "🤷",
  "👋",
];

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((s) => s.charAt(0))
    .join("")
    .toUpperCase();
}

export function ChatAvatar({ user, size = 40 }: { user?: User; size?: number }) {
  return (
    <UserAvatar
      nome={user?.name ?? ""}
      iniciais={user ? user.avatar || initials(user.name) : "?"}
      className="bg-primary text-primary-foreground"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    />
  );
}

/** A bolinha de status: offline, ou o que a pessoa escolheu (disponível, ocupado, ausente). */
export function OnlineDot({ situacao }: { situacao: SituacaoNoChat }) {
  const info = INFO_DO_ESTADO[situacao];
  return (
    <span
      title={info.rotulo}
      className={`inline-block h-2.5 w-2.5 rounded-full ring-2 ring-card ${info.ponto}`}
    />
  );
}

/** O status por extenso, na cor dele. */
export function RotuloDeSituacao({ situacao }: { situacao: SituacaoNoChat }) {
  const info = INFO_DO_ESTADO[situacao];
  return <span className={info.texto}>{info.rotulo}</span>;
}

/**
 * O status personalizado de alguém, só o emoji (19/10/2026) — ao lado do nome
 * nas listas, onde não cabe o texto. O texto inteiro e o "até quando" ficam no
 * título (passar o mouse).
 */
export function EmojiDoStatus({ userId, className = "" }: { userId: string; className?: string }) {
  const { statusDe } = useChat();
  const s = statusDe(userId);
  if (!s) return null;
  const titulo = [statusEmTexto(s), rotuloDoAte(s.ate)].filter(Boolean).join(" · ");
  return (
    <span title={titulo} aria-label={titulo} className={`shrink-0 leading-none ${className}`}>
      {s.emoji || "💬"}
    </span>
  );
}

/** O status personalizado por extenso ("🚜 Em campo"), para cabeçalhos e cartões. */
export function TextoDoStatus({
  userId,
  comAte = false,
  comSeparador = false,
  className = "",
}: {
  userId: string;
  /** Mostra também "até 14:30" — no cabeçalho da conversa, onde cabe. */
  comAte?: boolean;
  /** Um "·" antes, para ficar ao lado de outro texto (o disponível/ocupado). */
  comSeparador?: boolean;
  className?: string;
}) {
  const { statusDe } = useChat();
  const s = statusDe(userId);
  if (!s) return null;
  const ate = rotuloDoAte(s.ate);
  return (
    <span
      title={[statusEmTexto(s), ate].filter(Boolean).join(" · ")}
      className={`inline-flex min-w-0 items-center gap-1 ${className}`}
    >
      {comSeparador && <span className="shrink-0 opacity-60">·</span>}
      {s.emoji && <span className="shrink-0">{s.emoji}</span>}
      {s.texto && <span className="truncate">{s.texto}</span>}
      {comAte && ate && <span className="shrink-0 opacity-70">· {ate}</span>}
    </span>
  );
}

/**
 * Onde a pessoa escolhe o próprio status.
 *
 * A lista abre num portal, e não dentro do painel: o painel de conversas tem
 * `overflow-hidden` (é o que arredonda os cantos da animação), e uma lista
 * absoluta lá dentro seria cortada na borda.
 *
 * (19/10/2026) O mesmo popover ganhou o status personalizado, no topo: o
 * status atual com Editar/Limpar, e o editor (emoji, texto, prontos e até
 * quando) no lugar da lista enquanto se edita — sem diálogo à parte, para não
 * empilhar duas camadas por cima do chat.
 */
export function SeletorDeStatus({ className = "" }: { className?: string }) {
  const { meuEstado, mudarMeuEstado, meuStatus, mudarMeuStatus } = useChat();
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState(false);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxH: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);
  const info = INFO_DO_ESTADO[meuEstado];
  const statusAtual = statusVigente(meuStatus);

  useEffect(() => {
    if (!aberto) return;
    const fechar = () => {
      setAberto(false);
      setEditando(false);
    };
    const fora = (e: MouseEvent) => {
      const t = e.target as Node;
      if (painelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      fechar();
    };
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    window.addEventListener("resize", fechar);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", fechar);
    };
  }, [aberto]);

  const fecharTudo = () => {
    setAberto(false);
    setEditando(false);
  };

  const abrir = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const largura = 320;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - largura - 8));
    const embaixo = window.innerHeight - r.bottom - 14;
    const emCima = r.top - 14;
    /* O editor é mais alto que a lista: abre para o lado com mais espaço e
       rola por dentro se nem assim couber. Para cima, ancora pelo rodapé — o
       painel do chat mora no rodapé, e trocar a lista pelo editor não pode
       descolar o popover do botão. */
    setPos(
      embaixo >= 420 || embaixo >= emCima
        ? { top: r.bottom + 6, left, maxH: embaixo }
        : { bottom: window.innerHeight - r.top + 6, left, maxH: emCima },
    );
    setEditando(false);
    setAberto(true);
  };

  const limpar = () => {
    void mudarMeuStatus(null).catch(() =>
      toast.error("Não deu para limpar o status. Tente de novo."),
    );
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (aberto ? fecharTudo() : abrir())}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        title={
          statusAtual ? `Mudar meu status · ${statusEmTexto(statusAtual)}` : "Mudar meu status"
        }
        className={`inline-flex items-center gap-1.5 rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-semibold transition hover:bg-white/10 ${className}`}
      >
        <span className={`h-2 w-2 rounded-full ${info.ponto}`} />
        {statusAtual?.emoji && <span className="leading-none">{statusAtual.emoji}</span>}
        {info.rotulo}
        <ChevronDown
          className={`h-3 w-3 opacity-70 transition-transform ${aberto ? "rotate-180" : ""}`}
        />
      </button>
      {aberto &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={painelRef}
            role="dialog"
            aria-label="Meu status"
            className="fixed z-200 w-80 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-2xl"
            style={{ top: pos.top, bottom: pos.bottom, left: pos.left, maxHeight: pos.maxH }}
          >
            {editando ? (
              <EditorDeStatusPersonalizado
                inicial={statusAtual}
                aoCancelar={() => setEditando(false)}
                aoSalvar={async (novo) => {
                  try {
                    await mudarMeuStatus(novo);
                    fecharTudo();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Não deu para salvar o status.");
                  }
                }}
              />
            ) : (
              <>
                <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Status personalizado
                </div>
                {statusAtual ? (
                  <div className="mx-1 mb-1 flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-2.5 py-2">
                    <span className="text-lg leading-none">{statusAtual.emoji || "💬"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {statusAtual.texto}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {rotuloDoAte(statusAtual.ate) || "não limpa sozinho"}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditando(true)}
                      className="rounded-md px-1.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={limpar}
                      title="Limpar o status"
                      aria-label="Limpar o status"
                      className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditando(true)}
                    className="mx-1 mb-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-2 text-left text-sm text-muted-foreground transition hover:border-primary/50 hover:bg-secondary/60 hover:text-foreground"
                  >
                    <Smile className="h-4 w-4" />
                    Definir um status…
                    <span className="ml-auto text-[11px]">🚜 🍽️ 🏖️</span>
                  </button>
                )}
                <div className="my-1 h-px bg-border" />
                <div className="px-2.5 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Meu status no chat
                </div>
                <div role="listbox" aria-label="Meu status no chat">
                  {ESTADOS.map((estado) => {
                    const i = INFO_DO_ESTADO[estado];
                    const sel = estado === meuEstado;
                    return (
                      <button
                        key={estado}
                        type="button"
                        role="option"
                        aria-selected={sel}
                        onClick={() => {
                          mudarMeuEstado(estado);
                          fecharTudo();
                        }}
                        className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                          sel ? "bg-secondary" : "hover:bg-secondary/60"
                        }`}
                      >
                        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${i.ponto}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">{i.rotulo}</span>
                          <span className="block text-[11px] leading-snug text-muted-foreground">
                            {i.descricao}
                          </span>
                        </span>
                        {sel && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * O editor do status personalizado: emoji, texto (até 60), os prontos e até
 * quando vale. Começa no status atual, quando há; escolher um pronto troca o
 * emoji, o texto e a duração de uma vez, e dá para ajustar antes de salvar.
 */
function EditorDeStatusPersonalizado({
  inicial,
  aoCancelar,
  aoSalvar,
}: {
  inicial: StatusPersonalizado | null;
  aoCancelar: () => void;
  aoSalvar: (s: StatusPersonalizado) => Promise<void>;
}) {
  const [emoji, setEmoji] = useState(inicial?.emoji || "💬");
  const [texto, setTexto] = useState(inicial?.texto ?? "");
  /* Quem edita um status que já existe mantém o "até" dele, a menos que
     escolha outra duração — reabrir para corrigir um erro de digitação não
     pode estender o almoço. */
  const [duracao, setDuracao] = useState<Duracao | "manter">(
    inicial ? (inicial.ate ? "manter" : "nunca") : "hoje",
  );
  const [data, setData] = useState(() => hojeNoCampoDeData());
  const [escolhendoEmoji, setEscolhendoEmoji] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const campoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    campoRef.current?.focus();
  }, []);

  const podeSalvar = texto.trim().length > 0 && !salvando;

  const salvar = async () => {
    if (!podeSalvar) return;
    setSalvando(true);
    const ate =
      duracao === "manter" ? (inicial?.ate ?? null) : ateDaDuracao(duracao, new Date(), data);
    try {
      await aoSalvar({ emoji, texto: texto.trim().slice(0, MAX_TEXTO_DO_STATUS), ate });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-2 p-1.5">
      <div className="flex items-center justify-between px-1 pt-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Status personalizado
        </span>
        <button
          type="button"
          onClick={aoCancelar}
          className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Voltar"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-1.5 py-1 focus-within:border-primary">
        <button
          type="button"
          onClick={() => setEscolhendoEmoji((v) => !v)}
          title="Escolher o emoji"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-lg hover:bg-secondary"
        >
          {emoji}
        </button>
        <input
          ref={campoRef}
          value={texto}
          maxLength={MAX_TEXTO_DO_STATUS}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void salvar();
            }
          }}
          placeholder="Qual é o seu status?"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {MAX_TEXTO_DO_STATUS - texto.length}
        </span>
      </div>

      {escolhendoEmoji && (
        <div className="grid grid-cols-10 gap-0.5 rounded-lg border border-border p-1">
          {EMOJIS_DE_STATUS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                setEmoji(e);
                setEscolhendoEmoji(false);
              }}
              className={`grid h-7 place-items-center rounded text-base hover:bg-secondary ${
                e === emoji ? "bg-secondary" : ""
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      <div>
        <div className="px-1 pb-0.5 text-[10px] font-semibold text-muted-foreground">Prontos</div>
        {PRESETS_DE_STATUS.map((p) => (
          <button
            key={p.texto}
            type="button"
            onClick={() => {
              setEmoji(p.emoji);
              setTexto(p.texto);
              setDuracao(p.duracao);
              campoRef.current?.focus();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-secondary/60"
          >
            <span className="w-5 text-center">{p.emoji}</span>
            <span className="flex-1">{p.texto}</span>
            <span className="text-[10px] text-muted-foreground">
              {DURACOES.find((d) => d.id === p.duracao)?.rotulo}
            </span>
          </button>
        ))}
      </div>

      <label className="block px-1">
        <span className="mb-0.5 block text-[10px] font-semibold text-muted-foreground">
          Limpar depois de
        </span>
        <select
          value={duracao}
          onChange={(e) => setDuracao(e.target.value as Duracao | "manter")}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
        >
          {inicial?.ate && <option value="manter">Manter ({rotuloDoAte(inicial.ate)})</option>}
          {DURACOES.map((d) => (
            <option key={d.id} value={d.id}>
              {d.rotulo}
            </option>
          ))}
        </select>
      </label>
      {duracao === "data" && (
        <input
          type="date"
          value={data}
          min={hojeNoCampoDeData()}
          onChange={(e) => setData(e.target.value)}
          aria-label="Até o dia"
          className="mx-1 w-[calc(100%-0.5rem)] rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
        />
      )}

      <div className="flex justify-end gap-1.5 px-1 pb-0.5 pt-1">
        <button
          type="button"
          onClick={aoCancelar}
          className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-secondary"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={!podeSalvar}
          onClick={() => void salvar()}
          className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Meia-noite local do dia de `d`, em ms — a chave que junta mensagens do mesmo dia. */
function inicioDoDia(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * O rótulo do separador: "Hoje", "Ontem" ou a data por extenso.
 *
 * O dia da semana vem junto com a data ("Quarta-feira, 10 de setembro") porque
 * é assim que se lembra de uma conversa recente — "aquilo que falamos na
 * segunda". O ano só aparece quando não é o corrente; repetir "2026" em todo
 * separador é ruído.
 *
 * Arredonda em vez de truncar a diferença de dias: um dia com mudança de
 * horário tem 23 ou 25 horas, e truncar erraria o "Ontem" nesses dias.
 */
function rotuloDoDia(dia: Date, agora: Date): string {
  const dias = Math.round((inicioDoDia(agora) - inicioDoDia(dia)) / 86_400_000);
  if (dias === 0) return "Hoje";
  if (dias === 1) return "Ontem";
  const texto =
    dia.getFullYear() === agora.getFullYear()
      ? dia.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })
      : dia.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

type DiaDaConversa = { chave: number; dia: Date; mensagens: MensagemDaConversa[] };

/** Fatia a conversa (já em ordem cronológica) em dias consecutivos. */
function agruparPorDia(mensagens: readonly MensagemDaConversa[]): DiaDaConversa[] {
  const dias: DiaDaConversa[] = [];
  for (const m of mensagens) {
    const d = new Date(m.created_at);
    const chave = inicioDoDia(d);
    const ultimo = dias[dias.length - 1];
    if (ultimo && ultimo.chave === chave) ultimo.mensagens.push(m);
    else dias.push({ chave, dia: d, mensagens: [m] });
  }
  return dias;
}

/** Lista de mensagens de uma conversa. */
export function MessageList({ peerId, compact = false }: { peerId: string; compact?: boolean }) {
  const { currentUser } = useFluxo();
  const { markRead, registrarNaTela } = useChat();
  const messages = useConversation(peerId);
  const listaRef = useRef<HTMLDivElement>(null);

  // Também quando o balão de "digitando" aparece: ele nasce no fim da lista e,
  // numa conversa já rolada até embaixo, surgiria fora de vista.
  /* Rola SÓ a lista. Era `scrollIntoView`, que rola todo ancestral que puder
     — inclusive a página: na tela de Chat, cada mensagem nova (e cada
     sondagem) puxava a página inteira para baixo, barra lateral junto
     (relato do usuário, 08/10/2026). */
  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, messages.peerDigitando]);

  // Esta conversa está na tela enquanto este componente existir — é o que o
  // som e os badges consultam para não avisar do que já está sendo lido.
  useEffect(() => registrarNaTela(peerId), [peerId, registrarNaTela]);

  /* A mais recente do outro lado ainda sem leitura.
     O id, e não um booleano, porque é ele que dispara a marcação de novo quando
     chega outra mensagem — um booleano que já era `true` não mudaria, e a nova
     ficaria sem marcar. */
  const ultimaNaoLida = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.from_user_id === peerId && !m.read_at) return m.id;
    }
    return null;
  }, [messages, peerId]);

  /* Conversa na tela + pessoa olhando = lida.

     Mora aqui, na lista, e não em quem abre a conversa: este componente só
     existe onde a conversa está de fato desenhada (janela do dock aberta ou a
     página /chat), então "montado" já responde metade da pergunta. A outra
     metade é `pessoaOlhando` — ver a nota lá sobre o app minimizado.

     E agora isso tem plateia: `lida_em` é o que acende o ✓✓ na tela de quem
     mandou. Marcar cedo demais seria dizer a alguém que foi lido o que não foi.

     O `focus` cobre a volta ao app: o que chegou com a janela minimizada fica
     não lido até a pessoa voltar, e aí é marcado de uma vez. */
  useEffect(() => {
    if (!ultimaNaoLida) return;
    const marcar = () => {
      if (pessoaOlhando()) markRead(peerId);
    };
    marcar();
    document.addEventListener("visibilitychange", marcar);
    window.addEventListener("focus", marcar);
    return () => {
      document.removeEventListener("visibilitychange", marcar);
      window.removeEventListener("focus", marcar);
    };
  }, [ultimaNaoLida, peerId, markRead]);

  const dias = useMemo(() => agruparPorDia(messages), [messages]);
  // Fora do memo de propósito: a conversa que fica aberta de um dia para o
  // outro precisa que o "Hoje" vire "Ontem", e isso depende da hora, não das
  // mensagens. A sondagem redesenha a cada 1,5s, o que basta.
  const agora = new Date();

  return (
    <div
      ref={listaRef}
      className={`flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto ${compact ? "p-2" : "p-4"}`}
    >
      {messages.length === 0 && (
        <div className="m-auto text-center text-xs text-muted-foreground">
          Nenhuma mensagem ainda. Diga oi 👋
        </div>
      )}
      {/* Um bloco por dia, e não um separador solto entre mensagens: o
          separador é `sticky`, e o bloco é o que o limita. Solto, todos
          grudariam no topo ao mesmo tempo, empilhados — e o "Quarta-feira, 10
          de setembro", mais largo, apareceria por trás do "Hoje". Dentro do
          bloco, cada um sai de cena quando o dia dele acaba. */}
      {dias.map((d) => (
        <section key={d.chave} className="flex flex-col gap-1.5">
          <SeparadorDeDia rotulo={rotuloDoDia(d.dia, agora)} />
          {d.mensagens.map((m) => (
            <Balao key={m.id} m={m} mine={m.from_user_id === currentUser.id} />
          ))}
        </section>
      ))}
      {messages.peerDigitando && <BalaoDigitando />}
    </div>
  );
}

/**
 * O dia no meio da conversa, como no WhatsApp.
 *
 * Gruda no topo enquanto se rola pelas mensagens daquele dia: numa conversa
 * longa, é o que diz de quando é o trecho na tela sem precisar voltar até o
 * separador. O fundo é opaco pelo mesmo motivo — ele passa por cima dos balões.
 */
function SeparadorDeDia({ rotulo }: { rotulo: string }) {
  return (
    <div
      role="separator"
      aria-label={rotulo}
      className="sticky top-0 z-10 flex justify-center py-1"
    >
      <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
        {rotulo}
      </span>
    </div>
  );
}

/**
 * "Eduardo chamou sua atenção", o trator e o emoji gigante, no meio da
 * conversa — como os avisos do WhatsApp, e não como balão. Ver `lerAviso`.
 */
function LinhaDeAviso({ m, mine }: { m: MensagemDaConversa; mine: boolean }) {
  const { users } = useFluxo();
  const aviso = lerAviso(m.body)!;
  const quem = mine
    ? "Você"
    : primeiroNome(users.find((u) => u.id === m.from_user_id)?.name ?? "Alguém");
  return (
    <div className="flex flex-col items-center gap-0.5 py-1">
      {aviso.tipo === "emoji" && <div className="text-5xl leading-none">{aviso.emoji}</div>}
      <span className="max-w-[90%] rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-center text-[11px] font-medium text-foreground">
        {aviso.tipo === "cutucada" &&
          `🔔 ${quem} ${mine ? "chamou a atenção" : "chamou sua atenção!"}`}
        {aviso.tipo === "trator" && (
          <>
            🚜 {quem} mandou um trator: <b>“{aviso.texto}”</b>
          </>
        )}
        {aviso.tipo === "emoji" && `${quem} mandou um emoji gigante`}
        {aviso.tipo === "avatar" &&
          `${REACOES_DO_AVATAR[aviso.reacao].emoji} ${quem} ${REACOES_DO_AVATAR[aviso.reacao].noChat}`}
        <span className="ml-1.5 text-[9px] text-muted-foreground">{fmtTime(m.created_at)}</span>
      </span>
    </div>
  );
}

function Balao({ m, mine }: { m: MensagemDaConversa; mine: boolean }) {
  if (lerAviso(m.body)) return <LinhaDeAviso m={m} mine={mine} />;
  const hasImg = m.att_data && m.att_type && isImage(m.att_type);
  /* Recado de voz e gravação de tela (19/10/2026) tocam no próprio balão. */
  const midia = m.att_data && (ehAudio(m.att_type) || ehVideo(m.att_type));
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          mine
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-secondary text-foreground"
        }`}
      >
        {hasImg && (
          <button
            type="button"
            onClick={() => openAttachment({ dataUrl: m.att_data!, name: m.att_name || "imagem" })}
            className="mb-1 block"
          >
            <img
              src={m.att_data!}
              alt={m.att_name || "imagem"}
              className="max-h-52 rounded-lg object-cover"
            />
          </button>
        )}
        {midia && ehAudio(m.att_type) && (
          <ReprodutorDeAudio
            src={m.att_data!}
            semente={m.att_name ?? m.id}
            variante={mine ? "primario" : "padrao"}
            className="mb-1"
          />
        )}
        {midia && ehVideo(m.att_type) && (
          <ReprodutorDeVideo src={m.att_data!} className="mb-1 min-w-[240px]" />
        )}
        {m.att_data && !hasImg && !midia && (
          <button
            type="button"
            onClick={() => openAttachment({ dataUrl: m.att_data!, name: m.att_name || "arquivo" })}
            className="mb-1 flex items-center gap-1.5 rounded-md bg-black/10 px-2 py-1 text-xs underline"
          >
            <Paperclip className="h-3 w-3" /> {m.att_name || "arquivo"}
          </button>
        )}
        {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
        <div
          className={`mt-0.5 flex items-center justify-end gap-1 text-[9px] ${
            mine ? "text-primary-foreground/70" : "text-muted-foreground"
          }`}
        >
          {fmtTime(m.created_at)}
          {/* Só nas minhas: o visto responde "a pessoa leu o que EU mandei".
              Nas dela a pergunta não existe — se está na minha tela, eu li. */}
          {mine && (m.enviando ? <Enviando /> : <Visto lidaEm={m.read_at} />)}
        </div>
      </div>
    </div>
  );
}

/**
 * Azul do ✓✓ lido, puxado para a cor do texto do balão.
 *
 * Um azul fixo não serve: o balão é `bg-primary`, que muda com a paleta e com
 * o tema — escuro com texto claro no modo claro, claro com texto escuro no
 * noturno. Misturar 35% da cor do texto leva o azul para o lado que contrasta
 * com o balão, qualquer que seja ele, sem perder o tom. Em `oklab` porque a
 * mistura em `oklch` giraria o matiz em direção ao da paleta.
 *
 * A cor é reforço, não o sinal: ✓ e ✓✓ já se distinguem pela forma, então
 * quem não distingue cor não perde a informação.
 */
const COR_LIDA = "color-mix(in oklab, var(--primary-foreground) 35%, oklch(0.62 0.19 250))";

/** "às 14:59" se foi hoje, "em 10/09 às 14:59" se foi outro dia. */
function quandoLida(iso: string): string {
  const d = new Date(iso);
  const hora = `às ${fmtTime(iso)}`;
  if (inicioDoDia(d) === inicioDoDia(new Date())) return hora;
  return `em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hora}`;
}

/**
 * ✓ enviada, ✓✓ visualizada.
 *
 * Dois estados e não os três do WhatsApp (enviada / entregue / lida). O
 * "entregue" dele significa "chegou ao celular da pessoa", e aqui não existe
 * um aparelho que confirme recebimento — o mais perto seria "a pessoa estava
 * online", que é um palpite. Desenhar ✓✓ cinza com base em palpite ensinaria a
 * desconfiar do ✓✓ azul também.
 */
/** O relógio de "a caminho": a mensagem já está na conversa, mas o servidor ainda não confirmou. */
function Enviando() {
  return (
    <span title="Enviando…" className="inline-flex">
      <Clock3 className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">Enviando</span>
    </span>
  );
}

function Visto({ lidaEm }: { lidaEm: string | null }) {
  if (!lidaEm) {
    return (
      <span title="Enviada — ainda não visualizada" className="inline-flex">
        <Check className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only">Não visualizada</span>
      </span>
    );
  }
  return (
    <span
      title={`Visualizada ${quandoLida(lidaEm)}`}
      className="inline-flex"
      style={{ color: COR_LIDA }}
    >
      <CheckCheck className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">Visualizada</span>
    </span>
  );
}

/**
 * Os três pontinhos.
 *
 * Desenhado como um balão de mensagem recebida — mesmo canto, mesma cor, mesma
 * borda — porque é isso que ele anuncia: a mensagem que está vindo. Um aviso em
 * texto ("Fulano está digitando") ocuparia uma linha inteira e envelheceria mal
 * quando a pessoa parasse no meio.
 *
 * `aria-live="polite"` para quem usa leitor de tela ouvir o aviso sem ter o
 * foco roubado; os pontos em si ficam escondidos da leitura, que é o texto do
 * `sr-only` que vale.
 */
function BalaoDigitando() {
  return (
    <div className="flex justify-start" aria-live="polite">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-secondary px-3 py-2.5 shadow-sm">
        <span className="sr-only">Digitando…</span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden="true"
            className="fluxo-ponto-digitando h-1.5 w-1.5 rounded-full bg-muted-foreground"
            // Atraso NEGATIVO: cada ponto entra já adiantado no ciclo, então a
            // onda existe no primeiro quadro. Positivo deixaria os três parados
            // esperando a vez na primeira volta.
            style={{ animationDelay: `${-1.2 + i * 0.16}s` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Campo de escrever mensagem, com emoji e anexo de imagem/arquivo. */
export function Composer({ peerId }: { peerId: string }) {
  const { sendMessage } = useChat();
  const { currentUser } = useFluxo();
  const [text, setText] = useState("");
  const textoRef = useRef(text);
  textoRef.current = text;
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pending, setPending] = useState<{ name: string; type: string; dataUrl: string } | null>(
    null,
  );
  /* Envios em fila, um depois do outro. Com o campo liberado na hora, dá para
     mandar "oi" e "tudo bem?" antes de o primeiro chegar — e sem a fila os dois
     disputariam o servidor e poderiam chegar invertidos. */
  const filaRef = useRef<Promise<void>>(Promise.resolve());
  const fileRef = useRef<HTMLInputElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  /* Gravando recado de voz: a pílula da gravação ocupa a linha inteira, como
     no WhatsApp, e o resto (emoji, anexo, campo) sai da frente. */
  const [gravandoVoz, setGravandoVoz] = useState(false);

  /* Pronto para digitar assim que a conversa abre.
     Depende de `peerId` e não de `[]`: trocar de contato remonta o conteúdo mas
     não o componente, e sem a dependência o foco ficaria na primeira conversa
     aberta da sessão. */
  useEffect(() => {
    campoRef.current?.focus({ preventScroll: true });
  }, [peerId]);

  /* Aviso de "estou digitando", no máximo uma vez a cada 2,5s.
     Sem a trava seria uma requisição por TECLA. A janela que o servidor usa
     para considerar o aviso válido é de 6 segundos — mais que o dobro deste
     intervalo — então um aviso perdido no caminho não apaga o indicador. */
  const ultimoAviso = useRef(0);
  const avisarDigitando = () => {
    const agora = Date.now();
    if (agora - ultimoAviso.current < 2500) return;
    ultimoAviso.current = agora;
    void import("@/lib/chat.functions")
      .then((m) => m.chatDigitando({ data: { peerId } }))
      .catch(() => {});
  };

  /* O campo limpa NO ENTER, não quando o servidor responde.
     Limpava depois do `await`: o que a pessoa já estava digitando nesse meio
     tempo entrava no campo junto do "oi" e era apagado quando a resposta
     chegava — as primeiras letras da frase seguinte sumiam. A mensagem aparece
     na conversa na hora (ver `enviando` no chat-store), então nada se perde de
     vista. */
  const send = () => {
    const corpo = text.trim();
    const anexo = pending;
    if (!corpo && !anexo) return;
    setText("");
    setPending(null);
    // O clique no botão de enviar tira o foco do campo; devolver é o que
    // permite escrever a próxima sem voltar ao mouse.
    campoRef.current?.focus({ preventScroll: true });

    filaRef.current = filaRef.current
      .then(() => sendMessage(peerId, corpo, anexo ?? undefined))
      .catch(() => {
        // Devolve ao campo só se ele estiver vazio — nunca por cima do que a
        // pessoa já começou a escrever depois.
        // Lê pelo ref: o `text` desta função é o do momento do Enter, e o
        // campo pode ter mudado até a falha chegar.
        const devolvido = !textoRef.current.trim();
        if (devolvido) setText(corpo);
        if (anexo) setPending((p) => p ?? anexo);
        toast.error(
          devolvido || !corpo
            ? "Não foi possível enviar. A mensagem voltou para o campo."
            : `Não foi possível enviar: "${corpo.length > 60 ? corpo.slice(0, 60) + "…" : corpo}"`,
        );
      });
  };

  /* Recado de voz (ao parar) e gravação de tela (ao "Enviar" da prévia),
     19/10/2026: saem direto, sem passar pelo campo — entram na mesma fila das
     mensagens, para não chegarem fora de ordem. Se falhar, o arquivo volta
     como anexo pendente e a pessoa manda de novo com Enter. */
  const enviarGravacao = (a: Attachment) => {
    const anexo = { name: a.name, type: a.type, dataUrl: a.dataUrl };
    filaRef.current = filaRef.current
      .then(() => sendMessage(peerId, "", anexo))
      .catch(() => {
        setPending((p) => p ?? anexo);
        toast.error("Não foi possível enviar a gravação. Ela voltou para o campo — tente de novo.");
      });
  };

  const attach = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const { ok, rejected } = await filesToAttachments(files, currentUser.id);
    if (rejected.length) toast.error(`Muito grande: ${rejected.join(", ")}`);
    const a = ok[0];
    if (a) {
      setPending({ name: a.name, type: a.type, dataUrl: a.dataUrl });
      campoRef.current?.focus({ preventScroll: true });
    }
  };

  /* Colar um print (Ctrl+V), como no WhatsApp (pedido do usuário, 14/10/2026).
     A imagem da área de transferência vira o anexo pendente, com a prévia em
     cima do campo; Enter manda junto com o texto, se houver. Se o que foi
     copiado também tem texto (uma célula do Excel, um trecho do Word), o texto
     cola normal — só imagem pura é tratada como print. */
  const colar = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const dados = e.clipboardData;
    const imagens = Array.from(dados.items)
      .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (imagens.length === 0 || dados.getData("text/plain")) return;
    e.preventDefault();
    const agora = new Date();
    const hora = `${String(agora.getHours()).padStart(2, "0")}${String(agora.getMinutes()).padStart(2, "0")}`;
    const f = imagens[0]!;
    const ext = f.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    void attach([new File([f], `print-${hora}.${ext}`, { type: f.type })]);
  };

  /* Arrastar um arquivo ou print para cima do campo também anexa. */
  const [arrastando, setArrastando] = useState(false);

  return (
    <div
      className="relative border-t border-border bg-card p-2"
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        setArrastando(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastando(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setArrastando(false);
        void attach(e.dataTransfer.files);
      }}
    >
      {arrastando && (
        <div className="pointer-events-none absolute inset-1 z-20 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-primary/10 text-sm font-semibold text-primary">
          Solte para anexar
        </div>
      )}
      {pending && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-border bg-secondary/50 p-2 text-xs">
          {isImage(pending.type) ? (
            <img
              src={pending.dataUrl}
              alt="Prévia da imagem"
              className="max-h-40 max-w-[60%] rounded-lg border border-border object-contain shadow-sm"
            />
          ) : ehAudio(pending.type) ? (
            <ReprodutorDeAudio src={pending.dataUrl} semente={pending.name} className="max-w-[60%]" />
          ) : ehVideo(pending.type) ? (
            <ReprodutorDeVideo src={pending.dataUrl} className="max-h-40 max-w-[60%]" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{pending.name}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Escreva uma legenda se quiser e aperte Enter para enviar.
            </div>
          </div>
          <button
            onClick={() => setPending(null)}
            title="Tirar o anexo"
            className="rounded p-0.5 text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {emojiOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setEmojiOpen(false)} />
          <div className="absolute bottom-14 left-2 z-20 grid w-64 grid-cols-8 gap-1 rounded-lg border border-border bg-popover p-2 shadow-xl">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => {
                  setText((t) => t + e);
                  setEmojiOpen(false);
                }}
                className="rounded p-1 text-lg hover:bg-secondary"
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Enquanto grava a voz, o resto da linha some com `hidden` em vez de
          sair da árvore: o botão de voz e o de gravar tela precisam continuar
          MONTADOS — desmontar no meio descartaria a gravação. */}
      <div className="flex items-end gap-1.5">
        <button
          onClick={() => setEmojiOpen((v) => !v)}
          className={`rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground ${gravandoVoz ? "hidden" : ""}`}
          title="Emoji"
        >
          <Smile className="h-5 w-5" />
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className={`rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground ${gravandoVoz ? "hidden" : ""}`}
          title="Anexar"
        >
          <Paperclip className="h-5 w-5" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            void attach(e.target.files);
            e.target.value = "";
          }}
        />
        <textarea
          ref={campoRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Só quando há o que escrever: apagar a frase inteira não é digitar.
            if (e.target.value.trim()) avisarDigitando();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={colar}
          rows={1}
          placeholder={pending ? "Legenda (opcional)…" : "Mensagem… (Ctrl+V cola um print)"}
          className={`max-h-28 flex-1 resize-none rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary ${gravandoVoz ? "hidden" : ""}`}
        />
        <span className={gravandoVoz ? "hidden" : "contents"}>
          <BotaoGravarTela
            aoConcluir={enviarGravacao}
            rotulo={null}
            tamanhoIcone="h-5 w-5"
            className="rounded-md p-2"
          />
        </span>
        {/* Campo vazio: o botão da direita é o microfone, como no WhatsApp.
            Com texto ou anexo, volta a ser o enviar. Gravando, a pílula da
            gravação toma a linha. */}
        {!gravandoVoz && (text.trim() || pending) ? (
          <button
            onClick={send}
            className="rounded-full bg-primary p-2.5 text-primary-foreground transition hover:brightness-110"
            title="Enviar"
          >
            <Send className="h-4 w-4" />
          </button>
        ) : null}
        {!gravandoVoz && (text.trim() || pending) ? null : (
          <BotaoRecadoDeVoz
            aoGravar={enviarGravacao}
            aoMudarGravando={setGravandoVoz}
            tamanhoIcone="h-5 w-5"
            className="rounded-full p-2"
          />
        )}
      </div>
    </div>
  );
}
