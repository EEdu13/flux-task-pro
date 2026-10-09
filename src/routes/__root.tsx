import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GlobaisDoApp } from "@/components/globais-do-app";
import { UndoProvider } from "@/lib/undo-stack";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
// Preload das duas fontes do app. Sem isto o navegador só descobre os .woff2
// depois de baixar e parsear o CSS inteiro, e nessa janela ele já pintou a tela
// em Segoe UI (o fallback real no Windows) — daí o lampejo de fonte trocando.
// Subset latin só: cobre o português. O latin-ext carrega pelo CSS se precisar.
import soraWoff2 from "@fontsource-variable/sora/files/sora-latin-wght-normal.woff2?url";
import manropeWoff2 from "@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { FluxoProvider } from "@/lib/fluxo-store";
import { TaskTimerProvider } from "@/lib/task-timer";
import { useApplyPalette, useApplyTheme, SCRIPT_TEMA_INICIAL } from "@/lib/use-theme";
import { Toaster } from "@/components/ui/sonner";
import { ActiveCallProvider } from "@/lib/active-call-context";
import { ActiveCallWidget } from "@/components/active-call-widget";
import { CallInviterProvider } from "@/lib/call-inviter-context";
import { RoomPresenceProvider } from "@/lib/room-presence-context";
import { QuickFab } from "@/components/quick-fab";
import { FloatingNotepad } from "@/components/floating-notepad";
import { TimerFlutuante } from "@/components/timer-flutuante";
import { TitleBar } from "@/components/title-bar";
import { InteractionFX } from "@/components/interaction-fx";
import { Celebration } from "@/components/celebration";
import { TransitionVeil } from "@/components/transition-veil";
import { ConfirmHost } from "@/components/confirm-dialog";
import { PreviaDoAnexoHost } from "@/components/previa-anexo";
import { AvisoDeAppNovo } from "@/components/aviso-app-novo";
import { MotionConfig } from "framer-motion";
import { ChatProvider } from "@/lib/chat-store";
import { isTauri } from "@/lib/desktop";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você está procurando não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar para o início
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Esta página não carregou
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Algo deu errado por aqui. Tente novamente ou volte ao início.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Tentar de novo
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Início
          </a>
        </div>
      </div>
    </div>
  );
}

/** Endereço de produção, para o que precisa de URL completa (prévia de link). */
const ENDERECO_PUBLICO = "https://gestor-larsil.up.railway.app";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "SGL - CONECTA · Painel de desempenho" },
      {
        name: "description",
        content: "Visão executiva com foco de hoje, ranking e metas do time.",
      },
      { name: "author", content: "Larsil" },
      { property: "og:title", content: "SGL - CONECTA · Painel de desempenho" },
      {
        property: "og:description",
        content: "Visão executiva com foco de hoje, ranking e metas do time.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "SGL - CONECTA" },
      { property: "og:locale", content: "pt_BR" },
      /* A prévia que aparece ao colar um link do sistema no WhatsApp, Teams etc.
         Era uma captura de tela do Lovable. A imagem é nossa (public/og-sgl.png)
         e o endereço tem de ser completo — quem monta a prévia busca de fora,
         sem saber em que site o link estava. É o endereço de produção, o mesmo
         que o app de desktop abre; se o domínio mudar, muda aqui também. */
      { property: "og:image", content: `${ENDERECO_PUBLICO}/og-sgl.png` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "SGL - CONECTA, da Larsil" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "SGL - CONECTA · Painel de desempenho" },
      {
        name: "twitter:description",
        content: "Visão executiva com foco de hoje, ranking e metas do time.",
      },
      { name: "twitter:image", content: `${ENDERECO_PUBLICO}/og-sgl.png` },
    ],
    links: [
      // Antes do stylesheet de propósito: o navegador dispara o download das
      // fontes junto com o CSS em vez de esperar ele terminar.
      // `crossOrigin` é obrigatório — fonte sempre é buscada em modo CORS, e sem
      // o atributo o preload é descartado e o arquivo baixa duas vezes.
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: manropeWoff2,
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        href: soraWoff2,
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      // O símbolo da Larsil, o mesmo do app de desktop (src-tauri/icons). O
      // `?v=` força o navegador a buscar de novo: ele guarda o ícone da aba por
      // muito tempo e seguiria mostrando o antigo, que era o do Lovable.
      { rel: "icon", href: "/favicon.ico?v=sgl", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* Antes de qualquer pintura: sem isto o app aparece na paleta padrão
            por um quadro e só depois troca para a escolhida. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA_INICIAL }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Some com o menu do botão direito no app instalado.
 *
 * O WebView entrega o menu do navegador — "Voltar", "Atualizar", "Salvar como",
 * "Imprimir" — que denuncia que aquilo é uma página e oferece ações que não
 * fazem sentido num app: salvar a tela como arquivo, imprimir o painel.
 *
 * Campos de texto ficam de FORA. É por ali que se copia e cola, e num app
 * desktop essa é a via natural; tirá-la custaria mais do que o menu incomoda.
 *
 * Só no Tauri. No navegador o menu de contexto é do usuário, não nosso —
 * bloqueá-lo lá seria pegar algo que não nos pertence.
 *
 * As telas com menu próprio (tarefas, calendário) já chamam `preventDefault`
 * nos seus próprios handlers; este ouvinte roda em cima e não atrapalha.
 */
function useBloquearMenuNativo() {
  useEffect(() => {
    if (!isTauri()) return;
    const bloquear = (e: MouseEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo?.closest?.("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", bloquear);
    return () => document.removeEventListener("contextmenu", bloquear);
  }, []);
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useApplyPalette();
  useApplyTheme();
  useBloquearMenuNativo();
  // A janela pequena de chamada (/chamada) é um card isolado: sem barra de
  // título, sem FAB, sem widgets — só o próprio card.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const bareWindow = pathname.startsWith("/chamada");

  if (bareWindow) {
    return (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    );
  }

  return (
    // `reducedMotion="user"` faz TODA animação do framer-motion respeitar a
    // preferência do sistema — as transições novas de página e aba, e também as
    // que já existiam. O CSS já tinha esses blocos; as de JS não tinham.
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <FluxoProvider>
          <ChatProvider>
            <TaskTimerProvider>
              <RoomPresenceProvider>
                <ActiveCallProvider>
                  <CallInviterProvider>
                    {/* Barra de título nativa do app desktop; no navegador não renderiza. */}
                    <TitleBar />
                    {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
                    <UndoProvider>
                      <Outlet />
                      {/* Janelas globais montadas uma vez, fora da troca de página. */}
                      <GlobaisDoApp />
                    </UndoProvider>
                    <ActiveCallWidget />
                    <QuickFab />
                    {/* Fora do <Outlet />: precisa sobreviver à troca de rota, que é
                  justamente quando o crachá dentro do cartão sai de vista. */}
                    <TimerFlutuante />
                    <FloatingNotepad />
                    <InteractionFX />
                    <Celebration />
                    {/* Fora do <Outlet /> de propósito: precisa sobreviver à troca de
                  rota entre o login e o painel, que é justamente o que ele cobre. */}
                    <TransitionVeil />
                    {/* Também fora do <Outlet />: a confirmação é chamada de
                  qualquer tela e precisa sobreviver à troca de rota. */}
                    <ConfirmHost />
                    <PreviaDoAnexoHost />
                    <AvisoDeAppNovo />
                    <Toaster />
                  </CallInviterProvider>
                </ActiveCallProvider>
              </RoomPresenceProvider>
            </TaskTimerProvider>
          </ChatProvider>
        </FluxoProvider>
      </QueryClientProvider>
    </MotionConfig>
  );
}
