import { ArrowRight } from "lucide-react";

/**
 * "PDF → Excel": os dois lados da transição, o de saída com a cor de destaque
 * (`--acento`). É a marca do conversor: aparece no centro da roda e no
 * cabeçalho do painel que abre depois de escolher o bloco (05/11/2026).
 */
export function Transicao({
  de,
  para,
  compacto = false,
  alinhar = "centro",
}: {
  de: string;
  para: string;
  /** Roda pequena: chips menores. */
  compacto?: boolean;
  alinhar?: "centro" | "inicio";
}) {
  const chip = compacto ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";
  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 font-semibold ${
        alinhar === "centro" ? "justify-center" : "justify-start"
      }`}
    >
      <span className={`rounded-full bg-white/15 text-white ${chip}`}>{de}</span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--acento)]" aria-hidden />
      <span className={`rounded-full bg-[var(--acento)] text-neutral-950 ${chip}`}>{para}</span>
    </div>
  );
}
