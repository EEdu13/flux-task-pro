import { toast } from "sonner";
import { formatBytes, isTauri } from "@/lib/attachments";
import {
  fraseDeGrandeDemais,
  gravarNoApp,
  LIMITE_DO_APP_BYTES,
  mostrarNaPasta,
  pastaDe,
} from "@/lib/baixar-arquivo";
import type { Resultado, Saida } from "./tipos";

/*
 * Entregar o que a conversão gerou (04/11/2026). Nunca pelo servidor: o
 * arquivo convertido no computador da pessoa não sai dele.
 *
 * NAVEGADOR — um <a download> com o arquivo em memória, e um aviso com
 * "Baixar de novo": se o download automático for barrado, o clique da pessoa
 * é um gesto de verdade e passa (o padrão de `entregarGravacao`, em
 * `meeting-extras.tsx`). Mais de um arquivo vai num .zip só.
 *
 * APP DE MESA — o WebView2 IGNORA o link de download de arquivo em memória
 * (relato de 09/10/2026; ver o comentário do `?baixar` em `api/anexo.$id.tsx`).
 * Quem grava é o próprio app, pelo `gravarNoApp` de `@/lib/baixar-arquivo` (o
 * mesmo das exportações, dos anexos e da gravação de reunião): põe em Downloads
 * e devolve o caminho. Ele só aceita os tipos da lista do `src-tauri/src/lib.rs`
 * (PDF e imagens sim, .zip não) e até 200 MB por arquivo — 12 MB no app anterior
 * à 0.2.3. Por isso, no app, cada arquivo vai separado, e o que não couber é dito
 * com todas as letras, em vez de um "pronto" que não salvou nada.
 */

/**
 * Devolve se todos os arquivos foram entregues. No app de mesa, gravar pode falhar (passou
 * do teto, o Windows negou) e isso vira um aviso, sem lançar erro: o Editor de PDF precisa
 * saber, para não dar como salvo e fechar perdendo o trabalho (revisão de 05/11/2026).
 */
export async function entregar(resultado: Resultado): Promise<boolean> {
  if (resultado.arquivos.length === 0) return true;
  if (isTauri()) return entregarNoApp(resultado);
  await entregarNoNavegador(resultado);
  return true;
}

/* -------------------------------- Navegador -------------------------------- */

async function entregarNoNavegador({ arquivos, pacote, resumo }: Resultado): Promise<void> {
  let saida = arquivos[0]!;
  if (arquivos.length > 1) {
    const { zipar } = await import("./locais/zip");
    saida = await zipar(pacote ?? "convertidos.zip", arquivos);
  }
  baixarComLink(saida, arquivos.length, undefined, resumo);
}

/** `resumo`: a linha do bloco ("De 12 MB para 2 MB") no lugar do tamanho do arquivo. */
function baixarComLink(saida: Saida, quantos: number, aviso?: string, resumo?: string): void {
  const url = URL.createObjectURL(saida.blob);
  const baixar = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = saida.nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  baixar();
  const detalhe = quantos > 1 ? ` · ${quantos} arquivos dentro` : "";
  toast.success(`Pronto: ${saida.nome}`, {
    duration: 30_000,
    description:
      aviso ??
      `${resumo ?? formatBytes(saida.blob.size)}${detalhe}. Se o download não começou sozinho, use o botão.`,
    action: { label: "Baixar de novo", onClick: baixar },
  });
  // Dois minutos, e não segundos: o botão do aviso aponta para este endereço.
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/* ------------------------------- App de mesa ------------------------------- */

async function entregarNoApp(resultado: Resultado): Promise<boolean> {
  const salvos: string[] = [];
  const grandes: string[] = [];
  const falhas: string[] = [];
  let limite = LIMITE_DO_APP_BYTES;

  for (const s of resultado.arquivos) {
    const r = await gravarNoApp(s.nome, s.blob);
    if (r.ok) {
      salvos.push(r.caminho);
      continue;
    }
    if (r.motivo === "sem-comando") {
      /* App instalado antes da 0.2.2: não tem comando de salvar. Resta o link, que o
         WebView2 pode ignorar — e o aviso diz isso, para a pessoa saber o que fazer em
         vez de procurar um arquivo que não veio. */
      const aviso =
        "Se nada aparecer em Downloads, atualize o app de mesa ou use o CONECTA no navegador.";
      if (resultado.arquivos.length > 1) {
        const { zipar } = await import("./locais/zip");
        baixarComLink(
          await zipar(resultado.pacote ?? "convertidos.zip", resultado.arquivos),
          resultado.arquivos.length,
          aviso,
        );
      } else {
        baixarComLink(s, 1, aviso);
      }
      // O link pode ter sido ignorado, e daqui não dá para saber.
      return false;
    }
    if (r.motivo === "grande") {
      grandes.push(s.nome);
      limite = r.limite;
      continue;
    }
    if (r.motivo === "erro") console.warn("[conversor] o app não salvou", s.nome, r.erro);
    falhas.push(s.nome);
  }

  if (salvos.length > 0) {
    const ultimo = salvos[salvos.length - 1]!;
    const pasta = pastaDe(ultimo);
    const mostrar = () => mostrarNaPasta(ultimo);
    toast.success(
      salvos.length === 1
        ? `Pronto: ${ultimo.slice(pasta.length + 1)}`
        : `Pronto: ${salvos.length} arquivos`,
      {
        duration: 10_000,
        description: resultado.resumo
          ? `${resultado.resumo}. Salvo na pasta ${pasta}`
          : `Salvo na pasta ${pasta}`,
        action: { label: "Mostrar na pasta", onClick: mostrar },
      },
    );
  }
  if (grandes.length > 0) {
    toast.error(
      grandes.length === 1
        ? `${grandes[0]} ficou grande demais para o app`
        : `${grandes.length} arquivos ficaram grandes demais para o app`,
      {
        duration: 15_000,
        description: fraseDeGrandeDemais(limite, "faça esta conversão no CONECTA pelo navegador."),
      },
    );
  }
  if (falhas.length > 0) {
    toast.error("O app não conseguiu salvar", {
      duration: 15_000,
      description: `${falhas.join(", ")}. Tente de novo, ou use o CONECTA pelo navegador.`,
    });
  }
  return salvos.length === resultado.arquivos.length;
}
