import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import emblema from "@/assets/plantsil-emblema.svg";
import {
  ANEL,
  CREME,
  DISCO,
  EMBLEMA_VIEWBOX,
  FOLHAS,
  SOLO,
} from "@/components/plantsil-emblema-pecas";
import { AZUL, AZUL_CLARO, AZUL_ESCURO, ehNovembro } from "@/components/abertura-novembro-azul";

/**
 * Abertura do login da PlantSil Florestal, 25 anos (pedido de 11/11/2026: a
 * Larsil virou PlantSil, festivo pelos 25 anos, mesclado com o Novembro Azul).
 *
 * A cena monta o emblema do logotipo peça por peça: o disco verde, a chuva azul
 * do Novembro Azul caindo dentro dele, o solo de terra subindo, as cinco mudas
 * brotando e o anel dourado fechando o selo. Aí estoura o "25 ANOS" com
 * confete e o laço azul pousa no anel. No fim o emblema inteiro voa para o
 * lugar do "O" em "SGL - CONECTA" (layoutId compartilhado com a marca).
 * ~7 s; um clique pula. Com "reduzir movimento", vai direto para a marca.
 */

export const DOURADO = "#D9AE5C";
export const DOURADO_ESCURO = "#B48A3C";
export const VERDE_PLANTSIL = "#1E3D2F";
export const SALVIA = "#6E9C8A";
export const TERRA = "#8A5A2B";

const DURACAO_MS = 7200;

type Fase = "cena" | "final";

export function AberturaPlantsil25({ marca }: { marca: ReactNode }) {
  const reduzir = useReducedMotion();
  const [fase, setFase] = useState<Fase>(reduzir ? "final" : "cena");

  useEffect(() => {
    if (fase !== "cena") return;
    const t = window.setTimeout(() => setFase("final"), DURACAO_MS);
    return () => window.clearTimeout(t);
  }, [fase]);

  return (
    <LayoutGroup id="abertura-conecta">
      <AnimatePresence mode="popLayout">
        {fase === "cena" ? (
          <motion.div
            key="cena"
            exit={{ opacity: 0, transition: { duration: 0.35 } }}
            className="relative flex min-h-[480px] cursor-pointer flex-col items-center justify-center"
            onClick={() => setFase("final")}
            title="Clique para pular"
          >
            <Cena azul={ehNovembro()} />
          </motion.div>
        ) : (
          <motion.div
            key="final"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            {marca}
          </motion.div>
        )}
      </AnimatePresence>
    </LayoutGroup>
  );
}

/* ———————————————————————— a cena ———————————————————————— */

/* Laço do Novembro Azul, pequeno, no traçado do laço da abertura antiga. */
const LACO =
  "M20 26 C 22 18, 30 12, 29 5 C 28 -2, 12 -2, 11 5 C 10 12, 18 18, 20 26 C 22 31, 28 35, 31 40 M20 26 C 18 31, 12 35, 9 40";

const CORES_CONFETE = [DOURADO, DOURADO_ESCURO, SALVIA, CREME, AZUL, AZUL_CLARO, TERRA];

function Cena({ azul }: { azul: boolean }) {
  const gotas = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        id: i,
        x: 22 + Math.random() * 84,
        atraso: 0.35 + Math.random() * 1.6,
        dur: 0.6 + Math.random() * 0.4,
        tam: 2.2 + Math.random() * 1.6,
      })),
    [],
  );

  const confete = useMemo(
    () =>
      Array.from({ length: 46 }, (_, i) => {
        const ang = (Math.PI * 2 * i) / 46 + Math.random() * 0.3;
        const dist = 140 + Math.random() * 170;
        return {
          id: i,
          dx: Math.cos(ang) * dist,
          dy: Math.sin(ang) * dist * 0.75 - 40,
          giro: (Math.random() - 0.5) * 720,
          cor: CORES_CONFETE[i % CORES_CONFETE.length]!,
          w: 6 + Math.random() * 6,
          h: 3 + Math.random() * 4,
          redondo: i % 4 === 0,
          atraso: 3.05 + Math.random() * 0.25,
        };
      }),
    [],
  );

  return (
    <div className="relative w-full max-w-md select-none">
      {/* O emblema se montando. É este bloco (layoutId) que voa para o "O". */}
      <motion.div
        layoutId="conecta-o"
        className="relative mx-auto h-[230px] w-[230px] rounded-full"
        style={{ boxShadow: `0 0 0 0 transparent` }}
        transition={{ type: "spring", stiffness: 140, damping: 18 }}
      >
        {/* halo dourado */}
        <motion.div
          className="pointer-events-none absolute -inset-16 rounded-full"
          style={{
            background: `radial-gradient(circle, ${DOURADO}55 0%, transparent 62%)`,
          }}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: [0, 0, 1, 0.75], scale: [0.6, 0.6, 1.05, 1] }}
          transition={{ duration: 3.6, times: [0, 0.6, 0.85, 1] }}
        />

        <svg viewBox={EMBLEMA_VIEWBOX} className="relative h-full w-full overflow-visible" aria-hidden>
          <defs>
            <clipPath id="ps25-disco">
              <circle cx={64} cy={64} r={52.48} />
            </clipPath>
            <linearGradient id="ps25-laco" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={AZUL_CLARO} />
              <stop offset="55%" stopColor={AZUL} />
              <stop offset="100%" stopColor={AZUL_ESCURO} />
            </linearGradient>
          </defs>

          {/* fundo creme (os troncos são vazados no disco e mostram ele) */}
          <motion.circle
            cx={64}
            cy={64}
            r={59.5}
            fill={CREME}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.45, ease: "backOut" }}
            style={{ transformOrigin: "64px 64px" }}
          />

          {/* disco verde */}
          <motion.path
            d={DISCO.d}
            fill={DISCO.cor}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.15, ease: "backOut" }}
            style={{ transformOrigin: "64px 64px" }}
          />

          {/* chuva azul dentro do disco */}
          <g clipPath="url(#ps25-disco)">
            {gotas.map((g) => (
              <motion.path
                key={g.id}
                d={`M${g.x} 0 c ${g.tam * 0.6} ${g.tam * 1.4}, ${g.tam} ${g.tam * 2}, ${g.tam} ${g.tam * 2.6} a ${g.tam} ${g.tam} 0 0 1 ${-g.tam * 2} 0 c 0 ${-g.tam * 0.6}, ${g.tam * 0.4} ${-g.tam * 1.2}, ${g.tam} ${-g.tam * 2.6} z`}
                fill={g.id % 3 ? AZUL_CLARO : AZUL}
                initial={{ y: 0, opacity: 0 }}
                animate={{ y: 100, opacity: [0, 0.95, 0.95, 0] }}
                transition={{ duration: g.dur, delay: g.atraso, ease: "easeIn", repeat: 1, repeatDelay: 0.15 }}
              />
            ))}
          </g>

          {/* solo de terra subindo */}
          <motion.path
            d={SOLO.d}
            fill={SOLO.cor}
            initial={{ y: 22, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.55, delay: 0.7, ease: "easeOut" }}
            clipPath="url(#ps25-disco)"
          />

          {/* as cinco mudas brotando */}
          {FOLHAS.map((f, i) => (
            <motion.path
              key={i}
              d={f.d}
              fill={f.cor}
              initial={{ scaleY: 0, scaleX: 0.4, opacity: 0 }}
              animate={{ scaleY: [0, 1.15, 1], scaleX: [0.4, 1, 1], opacity: 1 }}
              transition={{ duration: 0.6, delay: 1.35 + [0.2, 0.05, 0.35, 0.12, 0.28][i]!, ease: "easeOut" }}
              style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
            />
          ))}

          {/* anel dourado fechando o selo */}
          <motion.path
            d={ANEL.d}
            fill={ANEL.cor}
            initial={{ scale: 1.5, opacity: 0, rotate: -90 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ duration: 0.7, delay: 2.35, ease: "backOut" }}
            style={{ transformOrigin: "64px 64px" }}
          />

          {/* brilho passando no anel */}
          <motion.circle
            cx={64}
            cy={64}
            r={60.2}
            fill="none"
            stroke="#fff6dc"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeDasharray="30 400"
            initial={{ strokeDashoffset: 0, opacity: 0 }}
            animate={{ strokeDashoffset: -380, opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.2, delay: 3.0, ease: "easeInOut" }}
          />

          {/* laço do Novembro Azul pousando no anel */}
          {azul && (
            <motion.g
              initial={{ opacity: 0, scale: 0, rotate: -40 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{ delay: 3.4, duration: 0.6, ease: "backOut" }}
              style={{ transformOrigin: "106px 104px" }}
            >
              <g transform="translate(94 86) scale(0.62)">
                <path
                  d={LACO}
                  fill="none"
                  stroke="url(#ps25-laco)"
                  strokeWidth={8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </motion.g>
          )}
        </svg>
      </motion.div>

      {/* confete estourando do selo */}
      <div className="pointer-events-none absolute left-1/2 top-[115px]">
        {confete.map((c) => (
          <motion.span
            key={c.id}
            className="absolute block"
            style={{
              width: c.w,
              height: c.redondo ? c.w : c.h,
              borderRadius: c.redondo ? 999 : 2,
              background: c.cor,
              marginLeft: -c.w / 2,
            }}
            initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
            animate={{
              x: c.dx,
              y: [0, c.dy, c.dy + 160],
              opacity: [0, 1, 1, 0],
              rotate: c.giro,
            }}
            transition={{ delay: c.atraso, duration: 2.6, ease: "easeOut", times: [0, 0.35, 1] }}
          />
        ))}
      </div>

      {/* a mensagem */}
      <div className="relative mt-5 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.12, 1, 1] }}
          transition={{
            opacity: { delay: 3.05, duration: 3.6, times: [0, 0.08, 0.88, 1] },
            scale: { delay: 3.05, duration: 0.9, times: [0, 0.5, 0.8, 1] },
          }}
          className="flex items-end justify-center gap-3"
        >
          <span
            className="font-display text-7xl font-extrabold leading-none"
            style={{
              backgroundImage: `linear-gradient(180deg, #fff1c9 0%, #f0c86e 45%, ${DOURADO} 100%)`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              filter: `drop-shadow(0 0 18px ${DOURADO}66)`,
            }}
          >
            25
          </span>
          <motion.span
            initial={{ letterSpacing: "0.6em", opacity: 0 }}
            animate={{ letterSpacing: "0.3em", opacity: 1 }}
            transition={{ delay: 3.35, duration: 0.6 }}
            className="mb-2 text-xl font-semibold uppercase text-[#F4F1EA]"
          >
            anos
          </motion.span>
        </motion.div>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: [0, 1, 1, 0], y: 0 }}
          transition={{ delay: 3.6, duration: 3.1, times: [0, 0.15, 0.85, 1] }}
          className="mt-3 text-base font-semibold uppercase tracking-[0.28em]"
          style={{ color: CREME }}
        >
          Plant<span style={{ color: DOURADO }}>Sil</span> Florestal
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 1, 0] }}
          transition={{ delay: 4.0, duration: 2.7, times: [0, 0.15, 0.85, 1] }}
          className="mt-1 text-sm text-white/70"
        >
          {azul
            ? "25 anos plantando futuro. E no Novembro Azul, o cuidado começa em você. 💙"
            : "25 anos plantando futuro. 🌱"}
        </motion.p>
      </div>
    </div>
  );
}

/**
 * O "O" do CONECTA na marca: o emblema PlantSil, com o layoutId que recebe o
 * selo montado na cena. Em novembro, o anel externo ganha o brilho azul.
 */
export function OPlantsil({ azul }: { azul?: boolean }) {
  return (
    <motion.span
      layoutId="conecta-o"
      className="relative inline-block rounded-full"
      style={{
        verticalAlign: "-0.015em",
        boxShadow: azul
          ? `0 0 0 0.04em ${AZUL}, 0 0 18px ${AZUL}, 0 0 34px ${DOURADO}55`
          : `0 0 22px ${DOURADO}66`,
      }}
      transition={{ type: "spring", stiffness: 140, damping: 18 }}
    >
      <img src={emblema} alt="O" className="block" style={{ height: "0.76em", width: "0.76em" }} />
    </motion.span>
  );
}

/**
 * Folhas de eucalipto e confete dourado caindo devagar no fundo do login —
 * a festa dos 25 anos sem atrapalhar quem quer só entrar. Gotas azuis entram
 * na mistura em novembro.
 */
export function FestaDeFundo() {
  const reduzir = useReducedMotion();
  const azul = ehNovembro();
  const pecas = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => {
        const tipo = i % 5 === 0 && azul ? "gota" : i % 3 === 0 ? "confete" : "folha";
        return {
          id: i,
          tipo,
          x: Math.random() * 100,
          atraso: Math.random() * 14,
          dur: 14 + Math.random() * 12,
          tam: 10 + Math.random() * 12,
          deriva: (Math.random() - 0.5) * 160,
          giro: (Math.random() - 0.5) * 540,
          cor:
            tipo === "folha"
              ? [SALVIA, DOURADO, "#4f7d68"][i % 3]!
              : tipo === "gota"
                ? AZUL_CLARO
                : [DOURADO, CREME, DOURADO_ESCURO][i % 3]!,
        };
      }),
    [azul],
  );
  if (reduzir) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {pecas.map((p) => (
        <motion.svg
          key={p.id}
          viewBox="0 0 20 20"
          className="absolute -top-10"
          style={{ left: `${p.x}%`, width: p.tam, height: p.tam, opacity: 0.55 }}
          initial={{ y: -40, x: 0, rotate: 0 }}
          animate={{ y: "110vh", x: p.deriva, rotate: p.giro }}
          transition={{ duration: p.dur, delay: p.atraso, repeat: Infinity, ease: "linear" }}
        >
          {p.tipo === "folha" ? (
            <path d="M10 1 C 16 6, 16 14, 10 19 C 4 14, 4 6, 10 1 Z M10 3 L10 18" fill={p.cor} stroke="#00000022" strokeWidth={0.6} />
          ) : p.tipo === "gota" ? (
            <path d="M10 1 C 14 8, 17 12, 17 15 A 7 7 0 0 1 3 15 C 3 12, 6 8, 10 1 Z" fill={p.cor} />
          ) : (
            <rect x={6} y={2} width={8} height={16} rx={1.5} fill={p.cor} />
          )}
        </motion.svg>
      ))}
    </div>
  );
}
