import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRightLeft } from "lucide-react";
import { ESTILO_DO_ACENTO } from "./acento";
import { temArquivo } from "./so-arquivo";

/**
 * O alvo do arrastar: um círculo no MEIO da tela que, com o arquivo por cima, abre a roda
 * (pedido do usuário, 09/11/2026). Antes era uma faixa no alto que se abria nos blocos
 * (04/11 e 05/11/2026); agora quem mostra os blocos é a própria roda, maior, com o centro
 * explicando cada um.
 *
 * - Aparece quando um arquivo do Windows é arrastado para o CONECTA, e NÃO bloqueia a página:
 *   fora do círculo, o arquivo segue podendo ir para o chat, a grade de criação ou os arquivos
 *   do projeto, como antes.
 * - Com o arquivo sobre o círculo, o anel se enche e a roda abre (`ESPERA_MS`). A espera curta
 *   é para não abrir a roda de quem só passou pelo meio da tela a caminho do chat.
 * - Soltar no círculo antes de a roda abrir: a roda abre com o arquivo na mão, para escolher
 *   o bloco com calma (o mesmo de soltar no vazio da roda).
 * - Se uma área que já recebe arquivo estiver no meio da tela (o chat aberto na página, a grade,
 *   os arquivos do projeto), o círculo vai para o alto, como era a faixa, para não roubar o
 *   arquivo dela. Sobre uma dessas áreas, ele fica transparente ao arquivo.
 *
 * Escuro em qualquer tema, como a roda, e sem `backdrop-blur` (ver a nota em
 * `paleta-de-conversao.tsx`). `fixed inset-0`: no app de mesa, o CSS
 * (`html.tauri-app .fixed.inset-0`) já o desce para baixo da barra de título.
 */

/** Quanto tempo o arquivo fica sobre o círculo até a roda abrir. */
const ESPERA_MS = 350;
/** O anel, num `viewBox` de 100. */
const RAIO = 46;
const VOLTA = 2 * Math.PI * RAIO;
/** Metade do alvo com a legenda, mais uma folga: o quadrado que precisa estar livre no meio. */
const MEIO_DO_ALVO = 140;

type Lugar = "centro" | "alto";

/** O meio da tela está livre de áreas que já recebem arquivo? */
function lugarDoAlvo(): Lugar {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  for (const el of Array.from(document.querySelectorAll("[data-aceita-arquivo]"))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cruza =
      r.left < cx + MEIO_DO_ALVO &&
      r.right > cx - MEIO_DO_ALVO &&
      r.top < cy + MEIO_DO_ALVO &&
      r.bottom > cy - MEIO_DO_ALVO;
    if (cruza) return "alto";
  }
  return "centro";
}

export function FaixaDeArraste({
  visivel,
  sobreArea,
  aoAbrirRoda,
  aoSoltarNaFaixa,
}: {
  visivel: boolean;
  /** O arquivo está sobre uma área que já recebe arquivo: o círculo sai da frente. */
  sobreArea: boolean;
  /** O arquivo ficou sobre o círculo: abre a roda, com o arraste ainda em andamento. */
  aoAbrirRoda: () => void;
  /** Soltou no círculo antes de a roda abrir. */
  aoSoltarNaFaixa: (arquivos: File[]) => void;
}) {
  // O portal precisa do `document`, que no servidor não existe.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  const [lugar, setLugar] = useState<Lugar>("centro");
  const [enchendo, setEnchendo] = useState(false);
  const espera = useRef<number | undefined>(undefined);
  const reduzir = useReducedMotion();
  /* Lido pelo `comecar`: o círculo ainda recebe o arraste enquanto some (a animação de saída),
     e ali não pode armar outra abertura da roda por cima da que acabou de abrir. */
  const visivelRef = useRef(visivel);
  visivelRef.current = visivel;

  const parar = () => {
    if (espera.current !== undefined) window.clearTimeout(espera.current);
    espera.current = undefined;
    setEnchendo(false);
  };

  /* O lugar é decidido uma vez por arraste, quando o círculo aparece: mudar no meio faria
     ele fugir do cursor. */
  useEffect(() => {
    if (visivel) setLugar(lugarDoAlvo());
    else parar();
  }, [visivel]);
  useEffect(
    () => () => {
      if (espera.current !== undefined) window.clearTimeout(espera.current);
    },
    [],
  );

  const comecar = () => {
    if (!visivelRef.current || espera.current !== undefined) return;
    setEnchendo(true);
    espera.current = window.setTimeout(() => {
      espera.current = undefined;
      setEnchendo(false);
      aoAbrirRoda();
    }, ESPERA_MS);
  };

  if (!montado) return null;
  const centro = lugar === "centro";
  return createPortal(
    <AnimatePresence>
      {visivel && (
        <motion.div
          key="alvo-de-arraste"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: sobreArea && !enchendo ? 0.4 : 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
          transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.7 }}
          style={ESTILO_DO_ACENTO}
          className={`pointer-events-none fixed inset-0 z-[445] flex flex-col items-center ${
            centro ? "justify-center" : "justify-start pt-3"
          }`}
        >
          <motion.div
            data-alvo-do-conversor=""
            className={`relative grid place-items-center rounded-full border border-white/15 bg-zinc-900/90 text-white shadow-2xl ${
              centro ? "h-44 w-44" : "h-28 w-28"
            } ${sobreArea ? "pointer-events-none" : "pointer-events-auto"}`}
            animate={
              reduzir || enchendo ? { scale: enchendo ? 1.06 : 1 } : { scale: [1, 1.035, 1] }
            }
            transition={
              reduzir || enchendo
                ? { duration: 0.15 }
                : { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
            }
            onDragEnter={(e) => {
              if (!temArquivo(e)) return;
              e.preventDefault();
              comecar();
            }}
            onDragOver={(e) => {
              if (!temArquivo(e)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              comecar();
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) parar();
            }}
            onDrop={(e) => {
              if (!temArquivo(e)) return;
              e.preventDefault();
              parar();
              aoSoltarNaFaixa(Array.from(e.dataTransfer.files));
            }}
          >
            {/* O anel: tracejado parado; com o arquivo por cima, enche na cor de destaque. */}
            <svg
              viewBox="0 0 100 100"
              className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
              aria-hidden
            >
              <circle
                cx="50"
                cy="50"
                r={RAIO}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="3 4"
                className="text-white/30"
              />
              <motion.circle
                cx="50"
                cy="50"
                r={RAIO}
                fill="none"
                stroke="var(--acento)"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={VOLTA}
                initial={false}
                animate={{ strokeDashoffset: enchendo ? 0 : VOLTA }}
                transition={{ duration: enchendo ? ESPERA_MS / 1000 : 0.15, ease: "linear" }}
              />
            </svg>
            <div className="pointer-events-none flex flex-col items-center gap-1.5 px-4 text-center">
              <ArrowRightLeft
                className={`text-[var(--acento)] ${centro ? "h-7 w-7" : "h-5 w-5"}`}
                aria-hidden
              />
              <span className={`font-semibold leading-tight ${centro ? "text-sm" : "text-[11px]"}`}>
                {enchendo ? "Abrindo a roda…" : "Converter"}
              </span>
            </div>
          </motion.div>
          <p className="pointer-events-none mt-3 max-w-[90vw] rounded-full bg-zinc-900/85 px-3 py-1 text-center text-xs text-white shadow-lg">
            Passe o arquivo pelo círculo para abrir a roda
            {centro && (
              <span className="text-white/60"> · no chat e nos anexos, solte como sempre</span>
            )}
          </p>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
