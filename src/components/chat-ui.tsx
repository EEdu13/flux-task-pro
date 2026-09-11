import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Paperclip, Send, Smile, X } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@/lib/fluxo-types";
import { filesToAttachments, isImage, openAttachment } from "@/lib/attachments";
import {
  pessoaOlhando,
  useChat,
  useConversation,
  type MensagemDaConversa,
} from "@/lib/chat-store";
import { useFluxo } from "@/lib/fluxo-store";
import { UserAvatar } from "@/components/user-avatar";

const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😉", "😎", "🤩",
  "🥳", "🤔", "😴", "😅", "😭", "😡", "👍", "👎", "👏", "🙌",
  "🙏", "💪", "🔥", "✨", "🎉", "❤️", "💚", "💙", "💛", "⭐",
  "✅", "❌", "⚡", "☕", "🍺", "🚀", "💧", "🌳", "🚜", "📌",
  "👀", "🤝", "💯", "😬", "🥲", "😱", "🤷", "👋",
];

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((s) => s.charAt(0)).join("").toUpperCase();
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

export function OnlineDot({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ring-2 ring-card ${
        online ? "bg-success" : "bg-muted-foreground/40"
      }`}
    />
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
  const endRef = useRef<HTMLDivElement>(null);

  // Também quando o balão de "digitando" aparece: ele nasce no fim da lista e,
  // numa conversa já rolada até embaixo, surgiria fora de vista.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
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
    <div className={`flex flex-1 flex-col gap-1.5 overflow-y-auto ${compact ? "p-2" : "p-4"}`}>
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
      <div ref={endRef} />
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
    <div role="separator" aria-label={rotulo} className="sticky top-0 z-10 flex justify-center py-1">
      <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
        {rotulo}
      </span>
    </div>
  );
}

function Balao({ m, mine }: { m: MensagemDaConversa; mine: boolean }) {
  const hasImg = m.att_data && m.att_type && isImage(m.att_type);
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
        {m.att_data && !hasImg && (
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
          {mine && <Visto lidaEm={m.read_at} />}
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
    <span title={`Visualizada ${quandoLida(lidaEm)}`} className="inline-flex" style={{ color: COR_LIDA }}>
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
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pending, setPending] = useState<{ name: string; type: string; dataUrl: string } | null>(null);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  /* Pronto para digitar assim que a conversa abre.
     Depende de `peerId` e não de `[]`: trocar de contato remonta o conteúdo mas
     não o componente, e sem a dependência o foco ficaria na primeira conversa
     aberta da sessão. */
  useEffect(() => {
    campoRef.current?.focus();
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

  const send = async () => {
    if (sending) return;
    if (!text.trim() && !pending) return;
    setSending(true);
    try {
      await sendMessage(peerId, text.trim(), pending ?? undefined);
      setText("");
      setPending(null);
    } catch {
      toast.error("Não foi possível enviar");
    } finally {
      setSending(false);
      // O clique no botão de enviar tira o foco do campo; devolver é o que
      // permite escrever a próxima sem voltar ao mouse.
      campoRef.current?.focus();
    }
  };

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    const { ok, rejected } = await filesToAttachments(files, currentUser.id);
    if (rejected.length) toast.error(`Muito grande: ${rejected.join(", ")}`);
    const a = ok[0];
    if (a) setPending({ name: a.name, type: a.type, dataUrl: a.dataUrl });
  };

  return (
    <div className="relative border-t border-border bg-card p-2">
      {pending && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-secondary/50 p-1.5 text-xs">
          {isImage(pending.type) ? (
            <img src={pending.dataUrl} alt="" className="h-10 w-10 rounded object-cover" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
          <span className="flex-1 truncate">{pending.name}</span>
          <button onClick={() => setPending(null)} className="text-muted-foreground hover:text-destructive">
            <X className="h-3.5 w-3.5" />
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

      <div className="flex items-end gap-1.5">
        <button
          onClick={() => setEmojiOpen((v) => !v)}
          className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
          title="Emoji"
        >
          <Smile className="h-5 w-5" />
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
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
              void send();
            }
          }}
          rows={1}
          placeholder="Mensagem…"
          className="max-h-28 flex-1 resize-none rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          onClick={() => void send()}
          disabled={sending || (!text.trim() && !pending)}
          className="rounded-full bg-primary p-2.5 text-primary-foreground transition hover:brightness-110 disabled:opacity-40"
          title="Enviar"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
