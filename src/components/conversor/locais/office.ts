import { ErroDeConversao, type AoExecutar, type Resultado } from "../tipos";
import { ateCancelar, blobDe, nomeBase, pararSeCancelado } from "./arquivos";

/*
 * Os blocos do Office (11/11/2026): Word → PDF, PDF → Word, Excel → PDF e PowerPoint → PDF,
 * pelo Office instalado no computador. Só no app de mesa, a partir da 0.2.3
 * (`PRIMEIRA_VERSAO_COM_OFFICE`): quem converte é o comando `converter_com_office` do app
 * (`src-tauri/src/office.rs`), que abre o programa escondido numa área de trabalho invisível,
 * converte e devolve os bytes. O arquivo não sai do computador.
 *
 * - Os bytes vão e voltam direto, sem a lista de números do `save_attachment_file` e até
 *   200 MB; o nome vai num cabeçalho, com `encodeURIComponent`, porque cabeçalho só leva ASCII.
 * - O Office não diz quanto falta: a barra anda por estimativa e fica perto do fim até a
 *   resposta chegar.
 * - Cancelar só deixa de esperar: o Office, no app, termina sozinho dentro do tempo-limite dele.
 * - O app responde "CODIGO|detalhe", e o código vira a frase para a pessoa.
 */

export type ProgramaDoOffice = "Word" | "Excel" | "PowerPoint";
export type DestinoDoOffice = "pdf" | "docx";

const TIPO: Record<DestinoDoOffice, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Quanto uma conversão costuma levar, contando a abertura do programa. Só para a barra andar. */
const TEMPO_TIPICO_MS: Record<DestinoDoOffice, number> = { pdf: 8_000, docx: 15_000 };

export async function converterNoOffice(
  arquivos: File[],
  para: DestinoDoOffice,
  programa: ProgramaDoOffice,
  ao: AoExecutar,
): Promise<Resultado> {
  const arquivo = arquivos[0]!;
  pararSeCancelado(ao.sinal);
  if (para === "docx") {
    /* O que não é PDF e o PDF protegido são recusados aqui, com a frase dos outros blocos,
       antes de abrir o Word. */
    await (await import("./pdf")).carregar(arquivo);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  pararSeCancelado(ao.sinal);

  const inicio = Date.now();
  ao.progresso(0.05);
  const relogio = window.setInterval(() => {
    const passado = (Date.now() - inicio) / TEMPO_TIPICO_MS[para];
    ao.progresso(0.05 + 0.85 * (1 - Math.exp(-passado)));
  }, 250);
  try {
    const conversao = invoke<unknown>("converter_com_office", bytes, {
      headers: { "x-nome": encodeURIComponent(arquivo.name), "x-para": para },
    });
    const convertido = emBytes(await ateCancelar(conversao, ao.sinal));
    ao.progresso(1);
    return {
      arquivos: [
        { nome: `${nomeBase(arquivo.name)}.${para}`, blob: blobDe(convertido, TIPO[para]) },
      ],
    };
  } catch (e) {
    throw traduzir(e, arquivo.name, programa);
  } finally {
    window.clearInterval(relogio);
  }
}

/** A resposta em bytes chega como `ArrayBuffer`; numa via mais antiga do Tauri, como lista de números. */
function emBytes(resposta: unknown): Uint8Array {
  if (resposta instanceof ArrayBuffer) return new Uint8Array(resposta);
  if (resposta instanceof Uint8Array) return resposta;
  if (Array.isArray(resposta)) return Uint8Array.from(resposta as number[]);
  throw new ErroDeConversao("O app devolveu uma resposta que não é um arquivo.", "NAO_CONVERTEU");
}

/** O app responde "CODIGO|detalhe" (`office.rs`). Sem o comando = app de antes da 0.2.3. */
function traduzir(e: unknown, nome: string, programa: ProgramaDoOffice): Error {
  if (e instanceof ErroDeConversao) return e;
  const texto = String(e);
  if (/converter_com_office/.test(texto) && /not allowed|not found|unknown|denied/i.test(texto)) {
    return new ErroDeConversao(
      "Este bloco precisa da versão nova do app de mesa, que chega sozinha.",
      "APP_ANTIGO",
    );
  }
  const [codigo, ...resto] = texto.split("|");
  const detalhe = resto.join("|");
  switch (codigo) {
    case "PROTEGIDO":
      return new ErroDeConversao(
        `“${nome}” está protegido por senha. Tire a senha no ${programa} e tente de novo.`,
        "PROTEGIDO",
      );
    case "VAZIO":
      return new ErroDeConversao(`“${nome}” não tem nada para imprimir.`, "VAZIO");
    case "SEM_OFFICE":
      return new ErroDeConversao(
        `O ${programa} não foi encontrado neste computador.`,
        "SEM_OFFICE",
      );
    case "TEMPO":
      return new ErroDeConversao(
        `O ${programa} demorou demais para responder. Tente de novo.`,
        "TEMPO",
      );
    case "ENTRADA":
      return detalhe.includes("200 MB")
        ? new ErroDeConversao(`“${nome}” passa de 200 MB.`, "GRANDE_DEMAIS")
        : new ErroDeConversao(`O ${programa} não converte “${nome}” por este bloco.`, "ENTRADA");
    default:
      console.warn(`[office] o ${programa} não converteu`, nome, detalhe || texto);
      return new ErroDeConversao(
        `O ${programa} não conseguiu converter “${nome}”.`,
        "NAO_CONVERTEU",
      );
  }
}
