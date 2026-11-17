import { confirmar } from "@/components/confirm-dialog";
import { GERAM_PDF_NOVO } from "./blocos";
import type { Bloco } from "./tipos";

/*
 * Os avisos que pedem uma decisão antes de converter (12/11/2026). O texto de "atenção" de cada
 * bloco (`Bloco.atencao`) aparece sempre; aqui fica o que depende do ARQUIVO da pessoa.
 */

/**
 * PDF com assinatura digital num bloco que faz um PDF novo a partir dele: o novo sai sem a
 * assinatura valer, e a pessoa decide antes. `true` = seguir (também quando não há assinatura).
 */
export async function seguirApesarDaAssinatura(
  bloco: Bloco,
  arquivos: readonly File[],
): Promise<boolean> {
  if (!GERAM_PDF_NOVO.has(bloco.id)) return true;
  const { temAssinaturaDigital } = await import("./locais/assinatura");
  for (const a of arquivos) {
    if (!(await temAssinaturaDigital(a).catch(() => false))) continue;
    return confirmar({
      titulo: "Este PDF tem assinatura digital",
      descricao: `“${a.name}” é assinado digitalmente. “${bloco.rotulo}” faz um PDF novo, e nele a assinatura não vale mais. O original continua assinado, como está.`,
      confirmar: "Continuar mesmo assim",
      cancelar: "Cancelar",
    });
  }
  return true;
}
