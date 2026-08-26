import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { reportLovableError } from "../lib/lovable-error-reporting";
import { FluxoProvider } from "@/lib/fluxo-store";
import { TaskTimerProvider } from "@/lib/task-timer";
import { useApplyPalette, useApplyTheme } from "@/lib/use-theme";
import { Toaster } from "@/components/ui/sonner";
import { ActiveCallProvider } from "@/lib/active-call-context";
import { ActiveCallWidget } from "@/components/active-call-widget";
import { CallInviterProvider } from "@/lib/call-inviter-context";
import { RoomPresenceProvider } from "@/lib/room-presence-context";
import { QuickFab } from "@/components/quick-fab";
import { FloatingNotepad } from "@/components/floating-notepad";
import { TitleBar } from "@/components/title-bar";
import { InteractionFX } from "@/components/interaction-fx";
import { Celebration } from "@/components/celebration";
import { ChatProvider } from "@/lib/chat-store";

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

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Fluxo · Painel de desempenho" },
      { name: "description", content: "Visão executiva com foco de hoje, ranking e metas do time." },
      { name: "author", content: "Fluxo" },
      { property: "og:title", content: "Fluxo · Painel de desempenho" },
      { property: "og:description", content: "Visão executiva com foco de hoje, ranking e metas do time." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Fluxo · Painel de desempenho" },
      { name: "twitter:description", content: "Visão executiva com foco de hoje, ranking e metas do time." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/74be6d4c-d20a-4ea5-b031-c61481212a47/id-preview-01378b6a--16ea518b-6e0d-4dec-904f-0cfdb1a55070.lovable.app-1783543670810.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/74be6d4c-d20a-4ea5-b031-c61481212a47/id-preview-01378b6a--16ea518b-6e0d-4dec-904f-0cfdb1a55070.lovable.app-1783543670810.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
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
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useApplyPalette();
  useApplyTheme();
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
              <Outlet />
              <ActiveCallWidget />
              <QuickFab />
              <FloatingNotepad />
              <InteractionFX />
              <Celebration />
              <Toaster />
            </CallInviterProvider>
          </ActiveCallProvider>
        </RoomPresenceProvider>
        </TaskTimerProvider>
        </ChatProvider>
      </FluxoProvider>
    </QueryClientProvider>
  );
}
