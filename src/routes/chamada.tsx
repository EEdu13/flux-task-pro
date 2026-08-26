import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Phone, PhoneOff, X } from "lucide-react";
import { closeSelfWindow, emitCallAction } from "@/lib/desktop";
import { updateRoomCallStatus } from "@/lib/livekit-token.functions";

export const Route = createFileRoute("/chamada")({
  head: () => ({ meta: [{ title: "Chamada recebida" }] }),
  component: CallCardWindow,
});

/**
 * Card compacto de chamada — roda numa janela Tauri própria, sempre no topo,
 * no canto da tela. Aparece mesmo com a janela principal escondida na bandeja.
 */
function CallCardWindow() {
  const [params, setParams] = useState<{
    caller: string;
    room: string;
    callId: string;
    userId: string;
    remote: boolean;
  }>({ caller: "Alguém", room: "", callId: "", userId: "", remote: false });
  const [busy, setBusy] = useState(false);
  const [closeErr, setCloseErr] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setParams({
      caller: q.get("caller") || "Alguém",
      room: q.get("room") || "",
      callId: q.get("callId") || "",
      userId: q.get("userId") || "",
      remote: q.get("remote") === "1",
    });
  }, []);

  const dismiss = useCallback(async () => {
    const err = await closeSelfWindow();
    if (err) setCloseErr(err);
  }, []);

  // Fecha sozinho se ninguém atender (a chamada expira em ~45s no servidor).
  useEffect(() => {
    const t = window.setTimeout(() => void dismiss(), 45_000);
    return () => window.clearTimeout(t);
  }, [dismiss]);

  // Esc sempre fecha — saída garantida se algum botão falhar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  const act = async (action: "accept" | "decline") => {
    if (busy) return;
    setBusy(true);

    // O card grava a resposta DIRETO no servidor. Antes isso dependia de um
    // evento chegar na janela principal — se o evento falhasse, quem ligou
    // nunca sabia que foi recusado (a chamada só expirava como "não atendeu").
    if (params.remote && params.callId && params.userId) {
      try {
        await updateRoomCallStatus({
          data: {
            callId: params.callId,
            status: action === "accept" ? "accepted" : "declined",
            userId: params.userId,
          },
        });
      } catch (e) {
        console.error("[fluxo] falha ao atualizar status da chamada", e);
      }
    }

    // O evento serve para a janela principal navegar até a sala ao atender.
    try {
      await emitCallAction(action, params.callId);
    } catch (e) {
      console.error("[fluxo] falha ao emitir ação da chamada", e);
    }
    const err = await closeSelfWindow();
    if (err) {
      setCloseErr(err);
      setBusy(false);
    }
  };

  const initials = params.caller
    .split(" ")
    .slice(0, 2)
    .map((s) => s.charAt(0))
    .join("")
    .toUpperCase();

  return (
    <div className="relative flex h-screen w-screen select-none flex-col justify-between overflow-hidden rounded-xl border border-border bg-card p-4 shadow-2xl">
      {/* Botão fechar — sempre disponível, independente do resto */}
      <button
        onClick={() => void dismiss()}
        aria-label="Fechar"
        title="Fechar (Esc)"
        className="absolute right-2 top-2 z-10 rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Só esta faixa arrasta a janela — os botões ficam livres para clique */}
      <div className="flex items-center gap-3 pr-8" data-tauri-drag-region>
        <div className="relative shrink-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
            {initials || "?"}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 animate-pulse items-center justify-center rounded-full bg-success ring-2 ring-card">
            <Phone className="h-2.5 w-2.5 text-background" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-foreground">{params.caller}</div>
          <div className="truncate text-xs text-muted-foreground">
            está te chamando{params.room ? ` · ${params.room}` : ""}
          </div>
        </div>
      </div>

      {closeErr && (
        <div className="rounded-md bg-destructive/15 p-1.5 text-[10px] leading-tight text-destructive">
          Não consegui fechar: {closeErr}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => void act("decline")}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-2.5 text-sm font-semibold text-foreground transition hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
        >
          <PhoneOff className="h-4 w-4" />
          Recusar
        </button>
        <button
          onClick={() => void act("accept")}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-success px-3 py-2.5 text-sm font-bold text-background transition hover:brightness-110 disabled:opacity-50"
        >
          <Phone className="h-4 w-4" />
          Atender
        </button>
      </div>
    </div>
  );
}
