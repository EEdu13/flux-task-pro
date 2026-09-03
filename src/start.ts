import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/* `functionMiddleware` saiu junto com o Supabase.
   Ele existia para anexar o token do Supabase a cada chamada de servidor. A
   identidade do Fluxo nunca passou por ali: ela vem do cookie httpOnly da IAM,
   que o navegador manda sozinho e que o servidor lê em `pessoaDaSessao`. */
export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
}));
