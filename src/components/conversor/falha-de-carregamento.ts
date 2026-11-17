/**
 * O CONECTA foi atualizado (um deploy) com a aba aberta (05/11/2026): os
 * arquivos que o conversor carrega só quando precisa — as telas de ordenar e
 * escolher páginas, o pdf-lib, o pdf.js, o heic2any — ganham nome novo, e o
 * pedido pelo nome antigo dá 404. O app de mesa fica aberto o dia todo, então
 * isto acontece de verdade.
 *
 * Não é defeito do arquivo da pessoa. Dizer "arquivo corrompido" ou "tente de
 * novo" a mandaria pelo caminho errado: tentar de novo não adianta, e só
 * recarregar a página resolve.
 */
export const MENSAGEM_DE_ATUALIZACAO =
  "O CONECTA foi atualizado enquanto estava aberto. Recarregue a página (Ctrl+R) para voltar a converter.";

/**
 * O erro é de carregamento de módulo? Os navegadores escrevem de jeitos
 * diferentes — Chrome/Edge ("Failed to fetch dynamically imported module"),
 * Firefox ("error loading dynamically imported module"), Safari ("Importing a
 * module script failed") — e o pdf.js, quando o worker dele não carrega
 * ("Setting up fake worker failed").
 */
export function ehFalhaDeCarregamento(e: unknown): boolean {
  const texto = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /dynamically imported module|importing a module script failed|error loading dynamically|chunkloaderror|loading chunk|setting up fake worker failed/i.test(
    texto,
  );
}
