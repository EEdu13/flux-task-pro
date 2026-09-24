import { desktopNotify, isTauri } from "@/lib/desktop";

/* O aviso do sistema — a notificação do Windows, fora do app.

   O app avisava só por dentro: som, número na sineta, o botão piscando na
   barra de tarefas. Com a janela minimizada ou atrás de outro programa, o que
   chegava — mensagem, tarefa atribuída, "te adicionou a um projeto" — ficava
   esperando alguém voltar e reparar no número. `desktopNotify` existia desde o
   app de desktop e não era chamado por ninguém.

   Um ponto só decide QUANDO avisar (fora de foco) e POR ONDE (nativo no app de
   desktop, Notification do navegador fora dele). Quem chama diz só o quê. */

/**
 * A pessoa está olhando para o app agora?
 *
 * O mesmo critério de `pessoaOlhando` no chat, e pelo mesmo motivo: o WebView
 * do app de desktop não se declara oculto ao minimizar, então `document.hidden`
 * sozinho diria que sim. Com o foco em outro programa, também não está olhando.
 */
export function appEmFoco(): boolean {
  return typeof document === "undefined" || (!document.hidden && document.hasFocus());
}

export interface AvisoDoSistema {
  titulo: string;
  corpo?: string;
  /**
   * Identifica o aviso: outro com a mesma `tag` substitui o anterior em vez de
   * empilhar — três mensagens da mesma pessoa viram uma notificação.
   */
  tag?: string;
  /** No navegador, ao clicar. O app de desktop só traz a janela de volta. */
  aoClicar?: () => void;
}

/**
 * Mostra o aviso fora do app — só se a pessoa não estiver olhando para ele.
 * Olhando, quem avisa é a própria tela, e a notificação seria repetição.
 */
export async function avisarNoSistema(aviso: AvisoDoSistema): Promise<void> {
  if (appEmFoco()) return;
  const corpo = (aviso.corpo ?? "").replace(/\s+/g, " ").trim().slice(0, 180);

  if (isTauri()) {
    await desktopNotify(aviso.titulo, corpo);
    return;
  }

  /* No navegador, só com a permissão já dada. O pedido acontece ao entrar no
     app (ver `AttentionOverlay`); pedir daqui abriria a pergunta do navegador
     no meio de outra coisa, sem a pessoa entender de onde veio. */
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(aviso.titulo, {
      body: corpo,
      tag: aviso.tag,
      icon: "/favicon.ico",
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      aviso.aoClicar?.();
      n.close();
    };
  } catch {
    /* Navegador que exige service worker para notificar: fica sem o aviso,
       e o número na sineta continua lá. */
  }
}
