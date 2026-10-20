import { useEffect, useRef, useState } from "react";
import { BellRing, Eraser, PersonStanding, Send, Smile, Tractor } from "lucide-react";
import { confirmar } from "@/components/confirm-dialog";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFluxo } from "@/lib/fluxo-store";
import { useChat } from "@/lib/chat-store";
import { sendNudge } from "@/components/attention-overlay";
import { corpoDoAviso, dispararReacaoDoAvatar, type AvisoNoChat } from "@/lib/avisos-no-chat";
import { EMOJIS_GIGANTES } from "@/lib/emojis";
import { LISTA_DE_REACOES, REACOES_DO_AVATAR } from "@/lib/reacoes-do-avatar";
import type { AvatarConfig } from "@/lib/avatar-3d";
import { primeiroNome } from "@/integrations/iam/types";

/**
 * Chamar atenção, trator e emoji gigante, no cabeçalho da conversa — saíram
 * das Ações rápidas (pedido do usuário, 08/10/2026). Cada um manda o aviso de
 * tela e grava a linha na conversa; ver `avisos-no-chat.ts`.
 *
 * Um intervalo curto entre um aviso e outro: tremer a tela de alguém dez
 * vezes seguidas deixa de ser chamar atenção.
 */
const INTERVALO_MS = 4000;

export function AcoesDoChat({ peerId, claro = false }: { peerId: string; claro?: boolean }) {
  const { currentUser, users } = useFluxo();
  const { sendMessage } = useChat();
  const [ocupado, setOcupado] = useState(false);
  const [faixa, setFaixa] = useState("");
  const [tratorAberto, setTratorAberto] = useState(false);
  const campoDaFaixa = useRef<HTMLInputElement>(null);
  const [emojiAberto, setEmojiAberto] = useState(false);
  const [avatarAberto, setAvatarAberto] = useState(false);
  /** O meu avatar, para as reações: `undefined` carregando, `null` ainda não montei. */
  const [meuAvatar, setMeuAvatar] = useState<AvatarConfig | null | undefined>(undefined);
  const nome = primeiroNome(users.find((u) => u.id === peerId)?.name ?? "a pessoa");

  /* Reações do avatar (17/10/2026): o boneco é lido ao abrir o popover — só
     então importa saber se ele existe —, e de novo a cada abertura, para
     pegar um avatar montado agora há pouco nas Configurações. */
  useEffect(() => {
    if (!avatarAberto) return;
    let vivo = true;
    import("@/lib/avatar-3d")
      .then((lib) => lib.carregarMeuAvatar())
      .then((a) => vivo && setMeuAvatar(a))
      .catch((erro: unknown) => {
        console.warn("reações do avatar: não deu para ler o meu avatar", erro);
        if (vivo) setMeuAvatar(null);
      });
    return () => {
      vivo = false;
    };
  }, [avatarAberto]);

  const avisar = async (aviso: AvisoNoChat) => {
    if (ocupado) return;
    setOcupado(true);
    window.setTimeout(() => setOcupado(false), INTERVALO_MS);
    try {
      await sendNudge(
        peerId,
        currentUser.name,
        currentUser.avatar,
        currentUser.id,
        aviso.tipo,
        aviso.tipo === "trator"
          ? aviso.texto
          : aviso.tipo === "emoji"
            ? aviso.emoji
            : aviso.tipo === "avatar"
              ? aviso.reacao
              : undefined,
      );
      await sendMessage(peerId, corpoDoAviso(aviso));
      // O emoji gigante vai SÓ para a pessoa (17/10/2026: "quem mandou não
      // precisa receber"); aqui, só a confirmação.
      if (aviso.tipo === "emoji") toast.success(`${aviso.emoji} Emoji enviado para ${nome}`);
      // A reação do avatar, quem manda vê junto — com o boneco que já está à mão.
      else if (aviso.tipo === "avatar")
        dispararReacaoDoAvatar(
          aviso.reacao,
          currentUser.name,
          currentUser.id,
          true,
          meuAvatar ?? undefined,
        );
      else
        toast.success(
          aviso.tipo === "trator"
            ? `🚜 O trator saiu para ${nome}`
            : `Você chamou a atenção de ${nome}`,
        );
    } catch {
      toast.error("Não foi possível enviar agora");
    }
  };

  /* Limpar é só para mim — ver `chatLimparConversa`. A janela diz isso com
     todas as letras, para ninguém achar que apagou do outro lado. */
  const limpar = async () => {
    const ok = await confirmar({
      titulo: `Limpar a conversa com ${nome}?`,
      descricao: `As mensagens somem só para você. ${nome} continua vendo o histórico dela.`,
      confirmar: "Limpar conversa",
      cancelar: "Cancelar",
      perigo: true,
    });
    if (!ok) return;
    try {
      const { chatLimparConversa } = await import("@/lib/chat.functions");
      await chatLimparConversa({ data: { peerId } });
      toast.success("Conversa limpa");
    } catch {
      toast.error("Não foi possível limpar agora");
    }
  };

  /** Emoji na faixa do trator (17/10/2026): entra onde está o cursor. */
  const porEmojiNaFaixa = (emoji: string) => {
    const campo = campoDaFaixa.current;
    const ini = campo?.selectionStart ?? faixa.length;
    const fim = campo?.selectionEnd ?? faixa.length;
    const nova = (faixa.slice(0, ini) + emoji + faixa.slice(fim)).slice(0, 200);
    setFaixa(nova);
    requestAnimationFrame(() => {
      campo?.focus();
      const pos = Math.min(ini + emoji.length, nova.length);
      campo?.setSelectionRange(pos, pos);
    });
  };

  const mandarTrator = () => {
    const texto = faixa.trim();
    if (!texto) return;
    setFaixa("");
    setTratorAberto(false);
    void avisar({ tipo: "trator", texto });
  };

  /* No cabeçalho preto do dock o hover é claro; no da página, sobre o
     cartão, os botões ganham rótulo e o fundo do tema. */
  const botao = claro
    ? "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-40"
    : "rounded p-1 opacity-80 transition hover:bg-white/10 hover:opacity-100 disabled:opacity-40";

  return (
    <div className={`flex items-center ${claro ? "gap-1.5" : "gap-0.5"}`}>
      <button
        type="button"
        onClick={() => void avisar({ tipo: "cutucada" })}
        disabled={ocupado}
        className={botao}
        title={`Chamar a atenção de ${nome} (treme a tela)`}
        aria-label="Chamar atenção"
      >
        <BellRing className="h-4 w-4" />
        {claro && "Chamar atenção"}
      </button>

      <Popover open={tratorAberto} onOpenChange={setTratorAberto}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={ocupado}
            className={botao}
            title={`Mandar o trator para ${nome}`}
            aria-label="Enviar trator"
          >
            <Tractor className="h-4 w-4" />
            {claro && "Trator"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="z-[460] w-72 p-2.5">
          <div className="mb-1.5 text-xs font-semibold">🚜 O trator atravessa a tela de {nome}</div>
          <div className="flex items-center gap-1.5">
            <input
              ref={campoDaFaixa}
              autoFocus
              value={faixa}
              maxLength={200}
              onChange={(e) => setFaixa(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  mandarTrator();
                }
              }}
              placeholder="O que vai escrito na faixa?"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={mandarTrator}
              disabled={!faixa.trim()}
              className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
              aria-label="Enviar o trator"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-0.5">
            {EMOJIS_GIGANTES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => porEmojiNaFaixa(e)}
                className="grid h-7 w-7 place-items-center rounded-md text-base transition hover:scale-110 hover:bg-secondary"
                aria-label={`Pôr ${e} na faixa`}
              >
                {e}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Popover open={emojiAberto} onOpenChange={setEmojiAberto}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={ocupado}
            className={botao}
            title={`Mandar um emoji gigante para ${nome}`}
            aria-label="Enviar emoji gigante"
          >
            <Smile className="h-4 w-4" />
            {claro && "Emoji"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="z-[460] w-auto p-2">
          <div className="mb-1 px-1 text-xs font-semibold">Emoji na tela inteira de {nome}</div>
          <div className="grid grid-cols-8 gap-0.5">
            {EMOJIS_GIGANTES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  setEmojiAberto(false);
                  void avisar({ tipo: "emoji", emoji: e });
                }}
                className="grid h-9 w-9 place-items-center rounded-lg text-2xl transition hover:scale-125 hover:bg-secondary"
              >
                {e}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Reações do avatar numa caixa própria (17/10/2026: "uma caixinha nova
          chamada avatar, fica bem separado"): o MEU boneco na tela da pessoa. */}
      <Popover open={avatarAberto} onOpenChange={setAvatarAberto}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={ocupado}
            className={botao}
            title={`Mandar o seu avatar para a tela de ${nome}`}
            aria-label="Enviar reação do avatar"
          >
            <PersonStanding className="h-4 w-4" />
            {claro && "Avatar"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="z-[460] w-[22rem] p-2">
          <div className="mb-1.5 px-1 text-xs font-semibold">Seu avatar na tela de {nome}</div>
          <div className="grid grid-cols-3 gap-1.5">
            {LISTA_DE_REACOES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setAvatarAberto(false);
                  void avisar({ tipo: "avatar", reacao: r });
                }}
                className="flex flex-col items-center gap-1 rounded-lg border border-border px-1.5 py-2 text-[11px] font-medium transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-secondary"
              >
                <span className="text-2xl leading-none">{REACOES_DO_AVATAR[r].emoji}</span>
                <span className="truncate">{REACOES_DO_AVATAR[r].rotulo}</span>
              </button>
            ))}
          </div>
          {meuAvatar === null && (
            <p className="mt-2 px-1 text-[11px] text-muted-foreground">
              Você ainda está com o avatar em branco — monte o seu em Configurações → Meu avatar.
            </p>
          )}
        </PopoverContent>
      </Popover>

      <button
        type="button"
        onClick={() => void limpar()}
        /* Vermelho de propósito: das quatro, é a única que tira algo da tela. */
        className={
          claro
            ? "inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
            : "rounded p-1 text-red-400 transition hover:bg-destructive hover:text-white"
        }
        title="Limpar a conversa (só para você)"
        aria-label="Limpar conversa"
      >
        <Eraser className="h-4 w-4" />
        {claro && "Limpar"}
      </button>
    </div>
  );
}
