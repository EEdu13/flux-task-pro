import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,

    /**
     * Baixa o código da rota quando o mouse passa no link, antes do clique.
     *
     * Cada rota é um arquivo JS separado, e sem isto ele só começava a ser
     * baixado no clique. Nesse intervalo o roteador mantém a tela anterior
     * renderizada — daí a sensação de que a aba antiga "fica" por um instante
     * na primeira visita e só depois troca. Da segunda vez em diante já estava
     * em memória e ficava instantâneo.
     *
     * Como ninguém clica num item de menu sem antes levar o ponteiro até ele,
     * o download normalmente termina antes do clique acontecer.
     *
     * Vale com `defaultPreloadStaleTime: 0` logo acima? Vale. Aquilo trata do
     * DADO do loader, que continua sendo buscado de novo na navegação de
     * verdade; o código da rota é cacheado à parte e não se repete. E aqui só
     * o login tem loader — e ninguém passa o mouse sobre o link de login
     * estando dentro do app.
     */
    defaultPreload: "intent",
  });

  return router;
};
