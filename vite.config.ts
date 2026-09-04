// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  /* Alvo do build: servidor Node, não Cloudflare Workers.
   *
   * O padrão do wrapper é `cloudflare-module`, e era ele que quebrava o deploy
   * no Railway: o build terminava com sucesso, o container subia, e nada
   * escutava a porta — porque a saída era um Worker (`.output/server/` saía com
   * um `wrangler.json`), que só ganha vida dentro do runtime da Cloudflare. O
   * log parava em "Starting Container" e o roteador respondia 502.
   *
   * Não é preferência de plataforma, é requisito: este app fala com o Azure SQL
   * pelo driver `mssql`, que abre socket TCP. Workers não tem socket TCP, então
   * o alvo Cloudflare nunca poderia ter funcionado aqui.
   */
  nitro: { preset: "node-server" },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Porta dedicada: a 8080 (padrão do wrapper) já é usada por outro projeto local.
  // host: true expõe na rede local, pra outro notebook acessar via IP para testes.
  vite: {
    // host: true expõe na rede; allowedHosts: true aceita acesso pelo nome da
    // máquina (ex.: http://NOTE-LAR-38-24:5199), assim o notebook 2 acha o
    // servidor pelo nome e não quebra quando o IP muda.
    server: { port: 5199, strictPort: true, host: true, allowedHosts: true },
  },
});
