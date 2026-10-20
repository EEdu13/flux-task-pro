import { createServerFn } from "@tanstack/react-start";
import { comSessao, semIdentidade } from "@/integrations/iam/funcao-com-sessao";
import type { AnexoGravado } from "@/lib/anexo.functions";

/* Envio de anexo em pedaços (19/10/2026) — para o recado de voz e a gravação
 * de tela. A lógica mora em `envio-em-pedacos.server.ts`; aqui só a porta de
 * entrada, com a validação do que vem do navegador. O porquê de tudo está no
 * topo daquele arquivo. */

type Dono = "tarefa" | "comentario" | "mensagem";
const DONOS: readonly string[] = ["tarefa", "comentario", "mensagem"];
const GUID = /^[0-9a-f-]{36}$/i;

/** 2 MB de pedaço viram ~2,7 MB em base64; acima disso nem decodifica. */
const MAX_BASE64 = Math.ceil((2 * 1024 * 1024 * 4) / 3) + 8;

export const comecarEnvioEmPedacos = createServerFn({ method: "POST" })
  .validator(
    semIdentidade(
      (entrada: {
        donoTipo: string;
        donoId: string;
        nome: string;
        tipoMime: string;
        tamanho: number;
      }) => {
        if (!DONOS.includes(entrada?.donoTipo)) throw new Error("Tipo de dono inválido");
        const donoId = typeof entrada?.donoId === "string" ? entrada.donoId.trim() : "";
        if (!GUID.test(donoId)) throw new Error("Dono inválido");
        const nome =
          typeof entrada?.nome === "string" && entrada.nome.trim()
            ? entrada.nome.trim().slice(0, 260)
            : "arquivo";
        const tipoMime =
          typeof entrada?.tipoMime === "string" ? entrada.tipoMime.slice(0, 120) : "";
        const tamanho = Number(entrada?.tamanho);
        if (!Number.isFinite(tamanho)) throw new Error("Tamanho inválido");
        return { donoTipo: entrada.donoTipo as Dono, donoId, nome, tipoMime, tamanho };
      },
    ),
  )
  .handler(
    comSessao(
      async (
        eu,
        dados: { donoTipo: Dono; donoId: string; nome: string; tipoMime: string; tamanho: number },
      ) => {
        const { comecarEnvio } = await import("@/lib/envio-em-pedacos.server");
        return comecarEnvio(eu, dados);
      },
    ),
  );

export const enviarPedacoDoAnexo = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((entrada: { envioId: string; indice: number; conteudo: string }) => {
      const envioId = typeof entrada?.envioId === "string" ? entrada.envioId.trim() : "";
      if (!GUID.test(envioId)) throw new Error("Envio inválido");
      const indice = Number(entrada?.indice);
      if (!Number.isInteger(indice) || indice < 0 || indice > 999) {
        throw new Error("Pedaço inválido");
      }
      const conteudo = typeof entrada?.conteudo === "string" ? entrada.conteudo : "";
      if (!conteudo) throw new Error("Pedaço vazio");
      if (conteudo.length > MAX_BASE64) throw new Error("Pedaço grande demais");
      if (!/^[A-Za-z0-9+/]+=*$/.test(conteudo)) throw new Error("Pedaço em formato inesperado");
      return { envioId, indice, conteudo };
    }),
  )
  .handler(
    comSessao(async (eu, dados: { envioId: string; indice: number; conteudo: string }) => {
      const { receberPedaco } = await import("@/lib/envio-em-pedacos.server");
      return receberPedaco(eu, dados);
    }),
  );

export const concluirEnvioEmPedacos = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((entrada: { envioId: string }) => {
      const envioId = typeof entrada?.envioId === "string" ? entrada.envioId.trim() : "";
      if (!GUID.test(envioId)) throw new Error("Envio inválido");
      return { envioId };
    }),
  )
  .handler(
    comSessao(async (eu, dados: { envioId: string }): Promise<AnexoGravado> => {
      const { concluirEnvio } = await import("@/lib/envio-em-pedacos.server");
      return concluirEnvio(eu, dados.envioId);
    }),
  );

export const cancelarEnvioEmPedacos = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((entrada: { envioId: string }) => {
      const envioId = typeof entrada?.envioId === "string" ? entrada.envioId.trim() : "";
      if (!GUID.test(envioId)) throw new Error("Envio inválido");
      return { envioId };
    }),
  )
  .handler(
    comSessao(async (eu, dados: { envioId: string }) => {
      const { cancelarEnvio } = await import("@/lib/envio-em-pedacos.server");
      cancelarEnvio(eu, dados.envioId);
      return { ok: true };
    }),
  );
