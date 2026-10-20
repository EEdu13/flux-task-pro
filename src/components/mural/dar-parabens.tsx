import { useState } from "react";
import { Loader2, PartyPopper, Send } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useChat } from "@/lib/chat-store";
import { useFluxo } from "@/lib/fluxo-store";
import { nomeCurto } from "@/lib/nome-curto";

/**
 * "Dar parabéns" (Mural, 14/10/2026): abre uma mensagem já escrita
 * ("Parabéns! 🎉"), a pessoa ajusta se quiser e manda pelo chat. Depois do
 * envio a conversa abre, para continuar o papo se quiser.
 */
export function DarParabens({
  pessoaId,
  nome,
  pequeno = false,
}: {
  pessoaId: string;
  nome: string;
  pequeno?: boolean;
}) {
  const { currentUser } = useFluxo();
  const { sendMessage, openChat } = useChat();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("Parabéns! 🎉");
  const [enviando, setEnviando] = useState(false);

  if (pessoaId === currentUser.id) {
    return <span className="text-[11px] font-semibold text-primary">É hoje! 🎉</span>;
  }

  const enviar = async () => {
    const corpo = texto.trim();
    if (!corpo || enviando) return;
    setEnviando(true);
    try {
      await sendMessage(pessoaId, corpo);
      openChat(pessoaId);
      setAberto(false);
      toast.success(`Parabéns enviados para ${nomeCurto(nome)}!`);
    } catch (e) {
      toast.error("Não foi possível enviar agora.", { description: (e as Error)?.message });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground ${
            pequeno ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-xs"
          }`}
        >
          <PartyPopper className={pequeno ? "h-3 w-3" : "h-3.5 w-3.5"} /> Dar parabéns
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-[460] w-72 rounded-xl p-3">
        <div className="mb-2 text-xs font-semibold">Mensagem para {nomeCurto(nome)}</div>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value.slice(0, 500))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar();
            }
          }}
          rows={3}
          autoFocus
          className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={enviando || !texto.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            {enviando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Enviar no chat
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
