/**
 * Telefone brasileiro: máscara para digitar, formatação para exibir.
 *
 * Existe porque os números chegam de origens diferentes em formatos diferentes:
 * a IAM devolve cru e às vezes sem DDI ("42991005626"), enquanto o dado
 * canônico da empresa carrega o 55 ("5542991005626"). Concentrar aqui evita que
 * cada tela adivinhe do seu jeito.
 *
 * Convenção adotada:
 *   - digitar  → formato nacional, (XX) XXXXX-XXXX. Ninguém quer digitar DDI.
 *   - guardar  → com DDI, que é o que o WhatsApp precisa.
 *   - exibir   → +55 (XX) XXXXX-XXXX quando há DDI; sem ele quando não há.
 */

const soDigitos = (v: string) => (v ?? "").replace(/\D/g, "");

/**
 * Separa DDI do número nacional.
 *
 * O cuidado: "5542991005626" tem 13 dígitos e o 55 é DDI; mas "5542991005"
 * poderia ser um fixo com DDD 55 (Rio Grande do Sul). Só trata como DDI quando
 * o que sobra tem exatamente 10 ou 11 dígitos — tamanho de número nacional.
 */
function separarDdi(bruto: string): { ddi: string; nacional: string } {
  const d = soDigitos(bruto);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    return { ddi: "55", nacional: d.slice(2) };
  }
  return { ddi: "", nacional: d };
}

/** Aplica (XX) XXXXX-XXXX a um número nacional, parcial ou completo. */
function aplicarMascara(nacional: string): string {
  const d = nacional.slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Máscara progressiva para campo de digitação. O DDI é descartado da vista. */
export function mascararTelefone(valor: string): string {
  return aplicarMascara(separarDdi(valor).nacional);
}

/**
 * Formata para leitura, mostrando o DDI quando ele existe no dado.
 * Devolve o valor original quando não dá para interpretar — número torto
 * exibido como veio é melhor que número inventado.
 */
export function formatarTelefone(bruto: string | null | undefined): string {
  const original = (bruto ?? "").trim();
  if (!original) return "";
  const { ddi, nacional } = separarDdi(original);
  if (nacional.length !== 10 && nacional.length !== 11) return original;
  const formatado = aplicarMascara(nacional);
  return ddi ? `+${ddi} ${formatado}` : formatado;
}

/** Só dígitos, com DDI — o formato de armazenamento. Vazio se inválido. */
export function telefoneParaGuardar(valor: string): string {
  const { nacional } = separarDdi(valor);
  if (nacional.length !== 10 && nacional.length !== 11) return "";
  return `55${nacional}`;
}
