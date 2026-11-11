/**
 * O servidor decide quais atas estão disponíveis. Preserva apenas cópias locais
 * ainda não confirmadas, para uma releitura não apagar uma gravação em andamento.
 */
export function mesclarAtas<T extends { id: string }>(
  doBanco: readonly T[],
  locais: readonly T[],
  preservar: ReadonlySet<string>,
): T[] {
  const protegidas = new Set([...preservar].map((id) => id.toLowerCase()));
  const porId = new Map(locais.map((ata) => [ata.id.toLowerCase(), ata]));
  const recebidas = new Set(doBanco.map((ata) => ata.id.toLowerCase()));
  return [
    ...locais.filter(
      (ata) => protegidas.has(ata.id.toLowerCase()) && !recebidas.has(ata.id.toLowerCase()),
    ),
    ...doBanco.map((ata) =>
      protegidas.has(ata.id.toLowerCase()) ? (porId.get(ata.id.toLowerCase()) ?? ata) : ata,
    ),
  ];
}
