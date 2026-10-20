import { useEffect, useState } from "react";
import { CalendarPlus, Loader2, MapPin, Repeat, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useEscFecha } from "@/hooks/use-esc-fecha";
import { TravaScroll } from "@/components/trava-scroll";
import type { Task } from "@/lib/fluxo-types";
import { descreverRecorrencia as descrever } from "@/lib/recorrencia";
import {
  avisarMuralPublicado,
  doCampoDataHora,
  ehErroDeMuralInativo,
  MSG_MURAL_INATIVO,
  paraCampoDataHora,
} from "@/lib/mural-cliente";

/** A regra da recorrência ("Toda segunda"); o prazo nulo vira "sem prazo". */
const descreverRecorrencia = (t: Task) => descrever({ ...t, dueDate: t.dueDate ?? undefined });

/*
 * "Divulgar como evento no mural" (17/10/2026): uma tarefa que é na verdade
 * um encontro — o "Cultivar Semanal" de toda segunda — vira um evento no
 * Mural, com a folhinha e o "Vou participar". A janela já vem preenchida com
 * o nome, a data/hora do prazo e a descrição; se a tarefa repete, a regra
 * ("Toda segunda") entra no texto.
 *
 * Mora uma vez só na raiz (`PortaDoEventoDaTarefa`, em GlobaisDoApp) e é
 * chamada por evento, como o "Agradecer no mural".
 */

const EVENTO_ABRIR = "fluxo:tarefa-em-evento";
const MAX_TEXTO = 1000;

/** Abre a janela de divulgar a tarefa como evento, de qualquer lugar do app. */
export function abrirTarefaEmEvento(tarefa: Task): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Task>(EVENTO_ABRIR, { detail: tarefa }));
}

/** Montada uma vez, na raiz: escuta `abrirTarefaEmEvento` e mostra a janela. */
export function PortaDoEventoDaTarefa() {
  const [tarefa, setTarefa] = useState<Task | null>(null);
  useEffect(() => {
    const abrir = (e: Event) => setTarefa((e as CustomEvent<Task>).detail ?? null);
    window.addEventListener(EVENTO_ABRIR, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR, abrir);
  }, []);
  if (!tarefa) return null;
  return <TarefaEmEventoDialog key={tarefa.id} tarefa={tarefa} aoFechar={() => setTarefa(null)} />;
}

/**
 * A data sugerida: o prazo da tarefa, na hora escolhida (ou 9h). Prazo que já
 * passou não serve para evento — aí vai para amanhã, no mesmo horário.
 */
function inicioSugerido(t: Task): string {
  const d = t.dueDate ? new Date(t.dueDate) : new Date();
  const [h, m] = (t.dueTime ?? "09:00").split(":").map(Number);
  d.setHours(h || 9, m || 0, 0, 0);
  if (d.getTime() < Date.now()) {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    amanha.setHours(d.getHours(), d.getMinutes(), 0, 0);
    return amanha.toISOString();
  }
  return d.toISOString();
}

function textoSugerido(t: Task): string {
  const partes = [t.description?.trim() ?? ""];
  if (t.recurring) partes.push(`🔁 ${descreverRecorrencia(t)}`);
  return partes.filter(Boolean).join("\n\n").slice(0, MAX_TEXTO);
}

function TarefaEmEventoDialog({ tarefa, aoFechar }: { tarefa: Task; aoFechar: () => void }) {
  useEscFecha(true, aoFechar);
  const [titulo, setTitulo] = useState(tarefa.title.slice(0, 160));
  const [inicio, setInicio] = useState(() => paraCampoDataHora(inicioSugerido(tarefa)));
  const [local, setLocal] = useState("");
  const [texto, setTexto] = useState(() => textoSugerido(tarefa));
  const [enviando, setEnviando] = useState(false);

  const pode = titulo.trim().length >= 3 && !!doCampoDataHora(inicio) && !enviando;

  const publicar = async () => {
    if (!pode) return;
    setEnviando(true);
    try {
      const { publicarNoMural } = await import("@/lib/mural.functions");
      await publicarNoMural({
        data: {
          tipo: "evento",
          titulo,
          texto,
          evento: { inicio: doCampoDataHora(inicio) ?? "", local: local.trim() || null },
        },
      });
      toast.success("Evento publicado no mural 📅", {
        description: "Quem quiser já pode marcar “Vou participar”.",
      });
      avisarMuralPublicado();
      aoFechar();
    } catch (e) {
      toast.error(
        ehErroDeMuralInativo(e) ? MSG_MURAL_INATIVO : "Não foi possível publicar o evento.",
        { description: ehErroDeMuralInativo(e) ? undefined : (e as Error)?.message },
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[450] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <TravaScroll />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Divulgar como evento no mural"
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-border bg-gradient-to-r from-sky-500/10 via-cyan-400/10 to-transparent p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-300">
            <CalendarPlus className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Divulgar como evento no mural</h2>
            <p className="text-[11px] text-muted-foreground">
              Vira um cartão com a data e o “Vou participar”. A tarefa continua igual.
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          <div>
            <label
              htmlFor="evento-titulo"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Nome do evento
            </label>
            <input
              id="evento-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value.slice(0, 160))}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="evento-inicio"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Quando
              </label>
              <input
                id="evento-inicio"
                type="datetime-local"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label
                htmlFor="evento-local"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Onde <span className="font-normal">(opcional)</span>
              </label>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="evento-local"
                  value={local}
                  onChange={(e) => setLocal(e.target.value.slice(0, 160))}
                  placeholder="Sala, link da reunião…"
                  className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          </div>

          {tarefa.recurring && (
            <p className="flex items-center gap-1.5 rounded-md bg-sky-500/[0.07] px-2.5 py-1.5 text-[11px] text-sky-700 dark:text-sky-300">
              <Repeat className="h-3.5 w-3.5 shrink-0" />A tarefa repete (
              {descreverRecorrencia(tarefa).toLowerCase()}): a regra já vai no texto. O evento é
              desta data.
            </p>
          )}

          <div>
            <label
              htmlFor="evento-texto"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Detalhes <span className="font-normal">(opcional)</span>
            </label>
            <textarea
              id="evento-texto"
              value={texto}
              onChange={(e) => setTexto(e.target.value.slice(0, MAX_TEXTO))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void publicar();
                }
              }}
              rows={4}
              placeholder="Pauta, o que levar, quem participa…"
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border p-3">
          <span className="text-[11px] text-muted-foreground">
            {titulo.trim().length < 3
              ? "Dê um nome ao evento."
              : !doCampoDataHora(inicio)
                ? "Escolha a data e a hora."
                : "Todo mundo vê no Mural."}
          </span>
          <button
            type="button"
            onClick={() => void publicar()}
            disabled={!pode}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:opacity-50"
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Publicar evento
          </button>
        </div>
      </div>
    </div>
  );
}
