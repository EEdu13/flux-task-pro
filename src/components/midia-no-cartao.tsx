import { useEffect, useState, useSyncExternalStore } from "react";
import { Play, Video } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ReprodutorDeAudio, ReprodutorDeVideo } from "@/components/reprodutor-de-midia";
import type { MidiasDaTarefa } from "@/lib/midias-das-tarefas.functions";

/*
 * O recado de voz e a gravação de tela no cartão da tarefa (19/10/2026):
 * o áudio toca ali mesmo; o vídeo aparece como miniatura e abre grande.
 *
 * Os cartões pedem juntos: cada um se inscreve com o id da tarefa, e depois
 * de um instante sai UMA chamada com todos (`midiasDasTarefas`). A resposta
 * fica guardada por alguns minutos — trocar de aba ou de filtro não pergunta
 * de novo.
 */

// Um recado novo renova a tarefa na hora (`renovarMidiaDaTarefa`); o resto pode esperar.
const VALIDADE_MS = 10 * 60_000;
const cache = new Map<string, { em: number; m: MidiasDaTarefa }>();
const pedidos = new Set<string>();
const ouvintes = new Set<() => void>();
let versao = 0;
let agendado: number | null = null;

const avisar = () => {
  versao++;
  ouvintes.forEach((f) => f());
};

function pedir(id: string) {
  const c = cache.get(id);
  if (c && Date.now() - c.em < VALIDADE_MS) return;
  pedidos.add(id);
  if (agendado !== null) return;
  agendado = window.setTimeout(() => {
    agendado = null;
    const ids = [...pedidos];
    pedidos.clear();
    void (async () => {
      try {
        const { midiasDasTarefas } = await import("@/lib/midias-das-tarefas.functions");
        // O servidor responde até 400 tarefas por vez: quadro maior vai em partes.
        for (let k = 0; k < ids.length; k += 400) {
          const parte = ids.slice(k, k + 400);
          const { midias } = await midiasDasTarefas({ data: { ids: parte } });
          const agora = Date.now();
          for (const i of parte) cache.set(i, { em: agora, m: midias[i] ?? {} });
        }
        avisar();
      } catch (e) {
        // Sem a mídia o cartão continua como era; tenta de novo na próxima montagem.
        console.warn("[cartão] não deu para buscar áudio/vídeo:", (e as Error)?.message);
      }
    })();
  }, 150);
}

/** Esquece o que foi guardado desta tarefa: um recado novo acabou de subir. */
export function renovarMidiaDaTarefa(id: string) {
  cache.delete(id.toUpperCase());
  pedir(id.toUpperCase());
}

function useMidiaDaTarefa(taskId: string): MidiasDaTarefa | undefined {
  const id = taskId.toUpperCase();
  const valido = /^[0-9A-F-]{36}$/.test(id);
  useEffect(() => {
    if (valido) pedir(id);
  }, [id, valido]);
  useSyncExternalStore(
    (f) => {
      ouvintes.add(f);
      return () => ouvintes.delete(f);
    },
    () => versao,
    () => 0,
  );
  return cache.get(id)?.m;
}

/** O cartão é arrastável e abre a tarefa no clique: aqui dentro, nada disso. */
const naoPropagar = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

export function MidiaNoCartao({ taskId, className = "" }: { taskId: string; className?: string }) {
  const m = useMidiaDaTarefa(taskId);
  const [videoAberto, setVideoAberto] = useState(false);
  if (!m || (!m.audio && !m.video)) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} {...naoPropagar}>
      {m.video && (
        <>
          <button
            type="button"
            onClick={() => setVideoAberto(true)}
            title={`Assistir: ${m.video.nome}`}
            className="group/video inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-0.5 pl-0.5 pr-2 text-[11px] font-medium text-foreground/80 transition hover:border-primary/50 hover:text-foreground"
          >
            {/* O primeiro quadro, do tamanho de um selo: só os metadados e o
                começo do arquivo são baixados. */}
            <span className="relative h-6 w-10 shrink-0 overflow-hidden rounded-full bg-black">
              <video
                src={`/api/anexo/${m.video.id}#t=0.1`}
                preload="metadata"
                muted
                playsInline
                className="pointer-events-none h-full w-full object-cover opacity-80"
              />
              <span className="absolute inset-0 grid place-items-center">
                <Play className="ml-px h-3 w-3 fill-white text-white drop-shadow" />
              </span>
            </span>
            <Video className="h-3 w-3" /> Vídeo
          </button>
          <Dialog open={videoAberto} onOpenChange={setVideoAberto}>
            <DialogContent className="max-w-4xl p-3" {...naoPropagar}>
              <DialogTitle className="truncate pr-8 text-sm">{m.video.nome}</DialogTitle>
              {videoAberto && <ReprodutorDeVideo src={`/api/anexo/${m.video.id}`} />}
            </DialogContent>
          </Dialog>
        </>
      )}
      {m.audio && <ReprodutorDeAudio src={`/api/anexo/${m.audio.id}`} semente={m.audio.id} mini />}
    </div>
  );
}
