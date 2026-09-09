import { useEffect, useRef, useState } from "react";
import { Paperclip, Send, Smile, X } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@/lib/fluxo-types";
import { filesToAttachments, isImage, openAttachment } from "@/lib/attachments";
import { useChat, useConversation } from "@/lib/chat-store";
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

/** Lista de mensagens de uma conversa. */
export function MessageList({ peerId, compact = false }: { peerId: string; compact?: boolean }) {
  const { currentUser } = useFluxo();
  const messages = useConversation(peerId);
  const endRef = useRef<HTMLDivElement>(null);

  // Também quando o balão de "digitando" aparece: ele nasce no fim da lista e,
  // numa conversa já rolada até embaixo, surgiria fora de vista.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, messages.peerDigitando]);

  return (
    <div className={`flex flex-1 flex-col gap-1.5 overflow-y-auto ${compact ? "p-2" : "p-4"}`}>
      {messages.length === 0 && (
        <div className="m-auto text-center text-xs text-muted-foreground">
          Nenhuma mensagem ainda. Diga oi 👋
        </div>
      )}
      {messages.map((m) => {
        const mine = m.from_user_id === currentUser.id;
        const hasImg = m.att_data && m.att_type && isImage(m.att_type);
        return (
          <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
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
              <div className={`mt-0.5 text-right text-[9px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                {fmtTime(m.created_at)}
              </div>
            </div>
          </div>
        );
      })}
      {messages.peerDigitando && <BalaoDigitando />}
      <div ref={endRef} />
    </div>
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
