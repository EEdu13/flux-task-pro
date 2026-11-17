/*
 * O PDF tem assinatura digital? (12/11/2026)
 *
 * Toda assinatura aplicada guarda, no dicionário dela, o `/ByteRange`: os trechos do arquivo
 * que ela cobre. Esse dicionário fica sempre fora da compressão (o leitor precisa achar o lugar
 * exato dos bytes assinados), então basta procurar a palavra nos bytes crus. O campo de
 * assinatura ainda vazio não tem `/ByteRange` e não conta.
 *
 * Lido em pedaços de 8 MB, com folga entre eles para a palavra não ficar partida: um PDF de
 * 200 MB não vai inteiro para a memória.
 */

const PEDACO = 8 * 1024 * 1024;
const PALAVRA = "/ByteRange";

export async function temAssinaturaDigital(arquivo: Blob): Promise<boolean> {
  const latin1 = new TextDecoder("latin1");
  for (let inicio = 0; inicio < arquivo.size; inicio += PEDACO) {
    const fim = Math.min(arquivo.size, inicio + PEDACO + PALAVRA.length);
    const texto = latin1.decode(await arquivo.slice(inicio, fim).arrayBuffer());
    if (texto.includes(PALAVRA)) return true;
  }
  return false;
}
