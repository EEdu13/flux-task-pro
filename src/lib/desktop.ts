/**
 * Ponte com o shell nativo (Tauri). Todas as funções são no-op no navegador,
 * então os componentes podem chamá-las sem checar o ambiente.
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Faz o botão do app piscar na barra de tarefas do Windows (pedido de atenção). */
export async function desktopFlashTaskbar(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow, UserAttentionType } = await import("@tauri-apps/api/window");
    await getCurrentWindow().requestUserAttention(UserAttentionType.Critical);
  } catch {
    /* ignore */
  }
}

/**
 * Traz a janela pra frente de todas as telas, estilo "nudge" do MSN:
 * mostra, restaura, foca e força sempre-no-topo por alguns segundos.
 */
export async function desktopBringToFront(topMs = 4000): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    // O Windows impede que um app em segundo plano "roube" o foco, então
    // setFocus() sozinho não levanta a janela. Forçamos sempre-no-topo ANTES
    // de mostrar — aí ela sobe acima de tudo mesmo sem receber foco.
    await w.setAlwaysOnTop(true);
    await w.show();
    await w.unminimize();
    await w.setFocus();
    setTimeout(() => {
      void w.setAlwaysOnTop(false).catch(() => {});
    }, topMs);
  } catch (e) {
    console.error("[fluxo] bringToFront falhou", e);
  }
}

/** Notificação nativa do Windows (aparece mesmo com a janela minimizada na bandeja). */
export async function desktopNotify(title: string, body: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const mod = await import("@tauri-apps/plugin-notification");
    let granted = await mod.isPermissionGranted();
    if (!granted) granted = (await mod.requestPermission()) === "granted";
    if (granted) mod.sendNotification({ title, body });
  } catch {
    /* ignore */
  }
}

/**
 * Sinaliza um evento que exige atenção imediata (chamada de atenção ou ligação):
 * puxa a janela pra frente, pisca a barra e dispara notificação nativa.
 */
export async function desktopAlert(title: string, body: string): Promise<void> {
  if (!isTauri()) return;
  await Promise.allSettled([
    desktopBringToFront(),
    desktopFlashTaskbar(),
    desktopNotify(title, body),
  ]);
}

/* ---------------- Janela de chamada no canto (estilo Teams) ---------------- */

export const CALL_WINDOW_LABEL = "chamada";

/**
 * Cada chamada abre uma janela com label único (chamada-<n>). Reaproveitar um
 * label fixo causava dois problemas: erro "label already exists" e, pior, o
 * card mostrar os dados da chamada anterior.
 */
let currentCallWindowLabel: string | null = null;

/** Label da janela Tauri atual (null no navegador). */
export function tauriWindowLabel(): string | null {
  if (!isTauri()) return null;
  try {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
      }
    ).__TAURI_INTERNALS__;
    return internals?.metadata?.currentWindow?.label ?? null;
  } catch {
    return null;
  }
}

/**
 * Abre um card pequeno, sempre-no-topo, no canto inferior direito — aparece
 * mesmo com a janela principal escondida na bandeja.
 */
export async function showIncomingCallWindow(p: {
  callId: string;
  caller: string;
  roomLabel: string;
  /** Quem está recebendo — o card grava a resposta direto no servidor. */
  userId: string;
  /** Só para chamadas vindas do servidor (têm id UUID). */
  remote: boolean;
}): Promise<void> {
  if (!isTauri()) return;
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

    // Fecha o card anterior (se houver). Nunca reaproveitamos a janela: ela
    // carregaria os dados da chamada antiga.
    await closeIncomingCallWindow();

    const W = 380;
    const H = 190;
    let x = 40;
    let y = 40;
    try {
      const { currentMonitor } = await import("@tauri-apps/api/window");
      const mon = await currentMonitor();
      if (mon) {
        const sf = mon.scaleFactor || 1;
        const sw = Math.round(mon.size.width / sf);
        const sh = Math.round(mon.size.height / sf);
        x = Math.max(0, sw - W - 24);
        y = Math.max(0, sh - H - 56);
      }
    } catch {
      /* usa posição padrão */
    }

    const params = new URLSearchParams({
      callId: p.callId,
      caller: p.caller,
      room: p.roomLabel,
      userId: p.userId,
      remote: p.remote ? "1" : "0",
    });
    const label = `${CALL_WINDOW_LABEL}-${Date.now().toString(36)}`;
    currentCallWindowLabel = label;
    const win = new WebviewWindow(label, {
      url: `/chamada?${params.toString()}`,
      width: W,
      height: H,
      x,
      y,
      resizable: false,
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focus: true,
      title: "Chamada recebida",
    });
    // Erros de criação chegam por evento, não por exceção.
    void win.once("tauri://error", (e) => {
      console.error("[fluxo] erro ao criar janela de chamada", e);
      void reportDesktopError(`Card de chamada falhou: ${JSON.stringify(e.payload)}`);
    });
  } catch (e) {
    console.error("[fluxo] falha ao abrir janela de chamada", e);
    void reportDesktopError(`Card de chamada falhou: ${(e as Error)?.message ?? e}`);
  }
}

/** Mostra o erro na tela em vez de engolir — essencial para diagnosticar no notebook do usuário. */
async function reportDesktopError(msg: string) {
  try {
    const { toast } = await import("sonner");
    toast.error("Falha na sobreposição nativa", { description: msg, duration: 10_000 });
  } catch {
    /* ignore */
  }
}

/** Diagnóstico: dispara as sobreposições para teste em uma máquina só. */
export async function desktopSelfTest(): Promise<string> {
  if (!isTauri()) {
    return "Modo nativo INATIVO — a ponte do Tauri não está disponível nesta janela.";
  }
  const results: string[] = [];
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    results.push(`janela: ${w.label}`);
  } catch (e) {
    results.push(`janela: ERRO ${(e as Error)?.message}`);
  }
  try {
    await desktopFlashTaskbar();
    results.push("piscar: ok");
  } catch (e) {
    results.push(`piscar: ERRO ${(e as Error)?.message}`);
  }
  try {
    await desktopNotify("Fluxo", "Teste de notificação nativa");
    results.push("notificação: enviada");
  } catch (e) {
    results.push(`notificação: ERRO ${(e as Error)?.message}`);
  }
  return results.join(" · ");
}

/** Fecha o card de chamada, se estiver aberto. */
export async function closeIncomingCallWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const labels = [currentCallWindowLabel, CALL_WINDOW_LABEL].filter(
      (l): l is string => !!l,
    );
    for (const label of labels) {
      const w = await WebviewWindow.getByLabel(label);
      if (w) {
        try {
          await w.close();
        } catch {
          /* ignore */
        }
      }
    }
    currentCallWindowLabel = null;
  } catch {
    /* ignore */
  }
}

/**
 * Fecha a própria janela (usado pelo card). Tenta várias vias porque, se a
 * permissão de uma delas faltar, o card ficaria preso na tela sem saída.
 * Retorna null em caso de sucesso, ou a lista de erros para exibição.
 */
export async function closeSelfWindow(): Promise<string | null> {
  if (!isTauri()) return "sem ponte nativa";
  const errs: string[] = [];

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
    return null;
  } catch (e) {
    errs.push(`window.close: ${(e as Error)?.message ?? String(e)}`);
  }

  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().close();
    return null;
  } catch (e) {
    errs.push(`webview.close: ${(e as Error)?.message ?? String(e)}`);
  }

  // Último recurso: pelo menos some da tela.
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
    return null;
  } catch (e) {
    errs.push(`hide: ${(e as Error)?.message ?? String(e)}`);
  }

  return errs.join(" | ");
}

export type CallAction = { action: "accept" | "decline"; callId: string };

/** O card avisa a janela principal do que o usuário escolheu. Nunca lança. */
export async function emitCallAction(action: "accept" | "decline", callId: string) {
  if (!isTauri()) return;
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("fluxo:call-action", { action, callId } satisfies CallAction);
  } catch (e) {
    console.error("[fluxo] emit da ação falhou", e);
  }
}

/** A janela principal escuta a escolha feita no card. */
export async function onCallAction(cb: (p: CallAction) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<CallAction>("fluxo:call-action", (e) => cb(e.payload));
  } catch {
    return () => {};
  }
}
