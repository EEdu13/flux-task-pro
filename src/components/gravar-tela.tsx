import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MonitorPlay, Send, Square, Trash2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TravaScroll } from "@/components/trava-scroll";
import { ReprodutorDeVideo } from "@/components/reprodutor-de-midia";
import { useFluxo } from "@/lib/fluxo-store";
import { formatBytes } from "@/lib/attachments";
import {
  LIMITE_TELA_S,
  iniciarGravacaoDeTela,
  type GravacaoDeTelaEmCurso,
} from "@/lib/gravador-de-tela";
import { formatarDuracao, gravacaoComoAnexo, type GravacaoPronta } from "@/lib/gravacao-de-midia";
import type { Attachment } from "@/lib/fluxo-types";

/** O mesmo teto do servidor (`envio-em-pedacos.server.ts`). */
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

const CHAVE_OPCOES = "fluxo:gravar-tela:opcoes";

function lerOpcoes(): { microfone: boolean; camera: boolean } {
  try {
    const v = JSON.parse(window.localStorage.getItem(CHAVE_OPCOES) ?? "null") as {
      microfone?: unknown;
      camera?: unknown;
    } | null;
    return { microfone: v?.microfone !== false, camera: v?.camera === true };
  } catch {
    return { microfone: true, camera: false };
  }
}

/**
 * "Gravar tela" (19/10/2026), estilo Loom: escolhe microfone e câmera, escolhe
 * a tela/janela/aba, grava até 2 minutos com uma barrinha flutuante "gravando
 * 0:37 · Parar", e ao parar mostra a prévia com Enviar / Descartar.
 *
 * Quem chama recebe o anexo pronto (`blob:` na memória do navegador) e manda
 * para o comentário ou para a conversa; o envio em pedaços acontece lá.
 */
export function BotaoGravarTela({
  aoConcluir,
  rotulo = "Gravar tela",
  className = "",
  tamanhoIcone = "h-4 w-4",
}: {
  aoConcluir: (anexo: Attachment) => void;
  /** `null` para só o ícone (o chat, que tem pouco espaço). */
  rotulo?: string | null;
  className?: string;
  tamanhoIcone?: string;
}) {
  const { currentUser } = useFluxo();
  const [aberto, setAberto] = useState(false);
  const [opcoes, setOpcoes] = useState(lerOpcoes);
  const [emCurso, setEmCurso] = useState<GravacaoDeTelaEmCurso | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [pronta, setPronta] = useState<{ g: GravacaoPronta; url: string } | null>(null);
  const emCursoRef = useRef<GravacaoDeTelaEmCurso | null>(null);
  emCursoRef.current = emCurso;

  // O relógio da barrinha. Só exibição — quem para no limite é o gravador.
  useEffect(() => {
    if (!emCurso) return;
    const id = window.setInterval(() => setSegundos((Date.now() - emCurso.inicio) / 1000), 250);
    return () => window.clearInterval(id);
  }, [emCurso]);

  // Saiu da tela no meio (fechou a tarefa): a gravação é descartada e a tela solta.
  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      emCursoRef.current?.descartar();
    };
  }, []);

  // O endereço local da prévia some quando a prévia some sem ter sido enviada.
  const prontaRef = useRef(pronta);
  prontaRef.current = pronta;
  useEffect(
    () => () => {
      if (prontaRef.current) URL.revokeObjectURL(prontaRef.current.url);
    },
    [],
  );

  const mudarOpcao = (chave: "microfone" | "camera", valor: boolean) => {
    const novas = { ...opcoes, [chave]: valor };
    setOpcoes(novas);
    try {
      window.localStorage.setItem(CHAVE_OPCOES, JSON.stringify(novas));
    } catch {
      /* sem armazenamento a escolha vale só agora */
    }
  };

  const comecar = async () => {
    setAberto(false);
    setSegundos(0);
    const g = await iniciarGravacaoDeTela(opcoes, (resultado) => {
      if (!montadoRef.current) return;
      setEmCurso(null);
      if (resultado) setPronta({ g: resultado, url: URL.createObjectURL(resultado.arquivo) });
    });
    // Fechou a tela enquanto escolhia o que compartilhar: solta tudo na hora.
    if (!montadoRef.current) {
      g?.descartar();
      return;
    }
    if (g) setEmCurso(g);
  };

  const descartarPrevia = () => {
    if (pronta) URL.revokeObjectURL(pronta.url);
    setPronta(null);
  };

  const enviar = () => {
    if (!pronta) return;
    URL.revokeObjectURL(pronta.url);
    // Um endereço novo, que passa a ser do anexo; quem sobe é quem solta.
    aoConcluir(gravacaoComoAnexo(pronta.g, currentUser.id));
    setPronta(null);
  };

  const grandeDemais = !!pronta && pronta.g.arquivo.size > MAX_VIDEO_BYTES;

  return (
    <>
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={!!emCurso}
            title="Gravar a tela (até 2 minutos), com a sua voz e, se quiser, a câmera"
            className={`inline-flex items-center gap-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50 ${className}`}
          >
            <MonitorPlay className={tamanhoIcone} />
            {rotulo}
          </button>
        </PopoverTrigger>
        <PopoverContent className="z-[450] w-64 p-3" align="start">
          <div className="text-sm font-semibold">Gravar a tela</div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Até 2 minutos. Depois você vê a prévia e decide se envia.
          </p>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={opcoes.microfone}
              onChange={(e) => mudarOpcao("microfone", e.target.checked)}
            />
            Gravar a minha voz (microfone)
          </label>
          <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={opcoes.camera}
              onChange={(e) => mudarOpcao("camera", e.target.checked)}
            />
            Mostrar a câmera numa bolinha
          </label>
          <button
            type="button"
            onClick={() => void comecar()}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
          >
            <MonitorPlay className="h-3.5 w-3.5" /> Escolher a tela e gravar
          </button>
        </PopoverContent>
      </Popover>

      {emCurso &&
        createPortal(
          <div className="fixed bottom-5 left-1/2 z-[450] flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card/95 py-1.5 pl-4 pr-1.5 text-sm shadow-2xl backdrop-blur">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" />
            <span className="font-medium">
              gravando <span className="tabular-nums">{formatarDuracao(segundos)}</span>
              <span className="text-muted-foreground tabular-nums">
                {" "}
                / {formatarDuracao(LIMITE_TELA_S)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => emCurso.descartar()}
              title="Descartar a gravação"
              className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => emCurso.parar()}
              className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
            >
              <Square className="h-3 w-3 fill-current" /> Parar
            </button>
          </div>,
          document.body,
        )}

      {pronta &&
        createPortal(
          /* Clique fora NÃO descarta: perder uma gravação por um clique sem
             querer é caro. Só os botões descartam. O `stopPropagation` segura
             o clique aqui — o portal repassa evento aos pais no React, e a
             tarefa por trás poderia entender como "clicou fora". */
          <div
            className="fixed inset-0 z-[450] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <TravaScroll />
            {/* `role="dialog"` com o foco dentro: o Esc da tarefa por trás
                reconhece a camada e não fecha a tarefa (o que jogaria a
                gravação fora junto). */}
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Prévia da gravação de tela"
              className="flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
                <MonitorPlay className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">Prévia da gravação</div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatarDuracao(pronta.g.segundos)} · {formatBytes(pronta.g.arquivo.size)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={descartarPrevia}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  title="Fechar sem enviar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="bg-black p-2">
                <ReprodutorDeVideo src={pronta.url} />
              </div>
              {grandeDemais && (
                <div className="border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
                  O vídeo passou de 25 MB e não pode ser enviado. Grave de novo, mais curto.
                </div>
              )}
              <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
                <button
                  type="button"
                  onClick={descartarPrevia}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Descartar
                </button>
                <button
                  type="button"
                  onClick={enviar}
                  disabled={grandeDemais}
                  autoFocus
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" /> Enviar
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
