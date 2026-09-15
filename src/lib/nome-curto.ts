const capitalizar = (p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();

/** "LUCAS GABRIEL BARRETO" → "Lucas Barreto". O cadastro vem em maiúsculas da IAM. */
export function nomeCurto(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const primeiro = partes[0] ?? "";
  const ultimo = partes.length > 1 ? partes[partes.length - 1]! : "";
  return [primeiro, ultimo].filter(Boolean).map(capitalizar).join(" ");
}
