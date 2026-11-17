import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { useAmbienteDoConversor } from "./ambiente";
import { porQueNaoServe } from "./blocos";
import { temArquivo } from "./so-arquivo";
import type { Bloco, OrigemDaAtivacao, Realce, Trabalho } from "./tipos";

/** O quanto o bloco cresce quando está ativo — o "ficar maior" do mouse em cima. */
const CRESCE = 1.3;
const MOLA = { type: "spring", stiffness: 420, damping: 26, mass: 0.6 } as const;

const SOMBRA_PARADO = "0 6px 18px rgb(0 0 0 / 0.35)";
const SOMBRA_ATIVO =
  "0 0 0 3px var(--acento), 0 12px 44px color-mix(in oklab, var(--acento) 55%, transparent)";
const SOMBRA_ACEITA =
  "0 0 0 2px color-mix(in oklab, var(--acento) 85%, transparent), 0 0 26px color-mix(in oklab, var(--acento) 45%, transparent)";
const SOMBRA_ERRO = "0 0 0 2px rgb(248 113 113 / 0.85), 0 6px 18px rgb(0 0 0 / 0.35)";

/**
 * Um bloco da roda de conversão (05/11/2026): um círculo com o ícone e o nome.
 * Clicar abre as pastas; soltar um arquivo em cima converte.
 *
 * Ativo — mouse em cima, foco do teclado ou arquivo por cima — ele cresce e
 * ganha um aro de destaque; quem descreve o bloco é o centro da roda, que
 * recebe a ativação pelo `aoAtivar`. Enquanto um arquivo é arrastado, o bloco
 * que aceita ganha um aro suave e o que não aceita fica apagado e recusa o
 * soltar. Convertendo, mostra o progresso em volta do círculo; se falhar, um
 * aro vermelho e um "!".
 *
 * Quem escuta o mouse e o arraste é o contêiner, e não o botão: bloco "em
 * breve" ou ocupado não é `disabled` (o navegador esconderia o mouse dele e o
 * centro da roda não poderia explicar o motivo), é `aria-disabled`.
 *
 * O soltar não para a propagação: quem está em volta (a faixa ou o fundo da
 * paleta) olha se já foi tratado (`defaultPrevented`) antes de agir.
 */
export function NoDaRoda({
  bloco,
  diametro,
  ativo,
  realce,
  trabalho,
  comRotulo = true,
  aoAtivar,
  aoDesativar,
  aoEscolher,
  aoSoltar,
}: {
  bloco: Bloco;
  /** Em pixels, sem contar o crescimento do bloco ativo. */
  diametro: number;
  ativo: boolean;
  realce: Realce;
  trabalho?: Trabalho;
  /** O nome dentro do círculo. Na faixa do arrastar ele vai fora, embaixo. */
  comRotulo?: boolean;
  aoAtivar: (origem: OrigemDaAtivacao) => void;
  aoDesativar: () => void;
  aoEscolher: () => void;
  aoSoltar: (arquivos: File[]) => void;
}) {
  const rodando = trabalho?.estado === "rodando";
  const comErro = trabalho?.estado === "erro";
  // Em construção, ou do Office fora do app novo: apagado, e o centro explica (`porQueNaoServe`).
  const motivo = porQueNaoServe(bloco, useAmbienteDoConversor());
  const indisponivel = motivo !== null;
  const bloqueado = rodando || indisponivel;
  const recusa = realce === "nao";
  const Icone = bloco.icone;
  const pct = Math.round((trabalho?.progresso ?? 0) * 100);

  const sombra = ativo
    ? SOMBRA_ATIVO
    : realce === "sim"
      ? SOMBRA_ACEITA
      : comErro
        ? SOMBRA_ERRO
        : SOMBRA_PARADO;
  const tamanhoDoIcone = Math.round(diametro * (comRotulo ? 0.26 : 0.4));
  const tamanhoDaFonte = Math.max(9, Math.min(12, Math.round(diametro * 0.108)));

  return (
    <div
      className="relative"
      style={{ width: diametro, height: diametro }}
      onPointerEnter={(e) => {
        // No toque o "enter" dispara ao encostar, e o centro piscaria sem motivo.
        if (e.pointerType !== "touch") aoAtivar("ponteiro");
      }}
      onPointerLeave={aoDesativar}
      onDragEnter={(e) => {
        if (!temArquivo(e)) return;
        e.preventDefault();
        aoAtivar("arraste");
      }}
      onDragOver={(e) => {
        if (!temArquivo(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = recusa || bloqueado ? "none" : "copy";
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) aoDesativar();
      }}
      onDrop={(e) => {
        if (!temArquivo(e)) return;
        e.preventDefault();
        aoDesativar();
        if (recusa || bloqueado) return;
        aoSoltar(Array.from(e.dataTransfer.files));
      }}
    >
      <motion.button
        type="button"
        data-no-da-roda=""
        aria-disabled={bloqueado || undefined}
        aria-label={`${bloco.rotulo}: de ${bloco.de} para ${bloco.para}`}
        onClick={() => {
          if (!bloqueado) aoEscolher();
        }}
        onFocus={(e) => {
          // Só o foco do teclado ativa: o clique também dá foco, e o bloco ficaria
          // grande depois de o mouse sair.
          if (e.currentTarget.matches(":focus-visible")) aoAtivar("foco");
        }}
        onBlur={aoDesativar}
        animate={{ scale: ativo ? CRESCE : 1 }}
        whileTap={bloqueado ? undefined : { scale: ativo ? CRESCE - 0.06 : 0.94 }}
        transition={MOLA}
        className={`relative grid h-full w-full place-items-center rounded-full border text-white outline-none transition-[background-color,border-color,box-shadow,opacity,filter] duration-200 ${
          ativo
            ? "border-[var(--acento)] bg-white/20"
            : comErro
              ? "border-red-400/70 bg-white/10"
              : "border-white/15 bg-white/10"
        } ${recusa ? "opacity-35 grayscale" : indisponivel ? "opacity-50" : ""} ${
          rodando ? "cursor-progress" : indisponivel ? "cursor-not-allowed" : "cursor-pointer"
        }`}
        style={{ boxShadow: sombra }}
      >
        <span className="flex flex-col items-center justify-center gap-1 px-2">
          <Icone
            strokeWidth={1.75}
            style={{ width: tamanhoDoIcone, height: tamanhoDoIcone }}
            aria-hidden
          />
          {comRotulo && (
            <span
              className="text-balance text-center font-semibold leading-[1.1]"
              style={{ fontSize: tamanhoDaFonte, maxWidth: diametro * 0.78 }}
            >
              {rodando ? `${pct}%` : bloco.rotulo}
            </span>
          )}
        </span>

        {rodando && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
            viewBox="0 0 100 100"
            aria-hidden
          >
            <circle
              cx="50"
              cy="50"
              r="47"
              fill="none"
              stroke="white"
              strokeOpacity="0.18"
              strokeWidth="3"
            />
            <circle
              cx="50"
              cy="50"
              r="47"
              fill="none"
              stroke="var(--acento)"
              strokeWidth="3"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={100}
              strokeDashoffset={100 - Math.max(pct, 3)}
              className="transition-[stroke-dashoffset] duration-300"
            />
          </svg>
        )}

        {comErro && (
          <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-red-500 text-white shadow">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}

        {motivo && (
          <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/25 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white">
            {motivo.selo}
          </span>
        )}
      </motion.button>
    </div>
  );
}
