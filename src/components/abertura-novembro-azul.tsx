import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";

/**
 * Abertura do login em novembro — Novembro Azul com cara de silvicultura
 * (pedido do usuário, 05/11/2026), irmã da abertura do Outubro Rosa.
 *
 * A cena: começa a chuva sobre a linha de plantio, a muda brota e as duas
 * primeiras folhas se enrolam num bigode (o símbolo da campanha). O caule
 * segue subindo e vira o laço azul. Vem a mensagem, e a volta do laço vira o
 * "O" que voa para o lugar dele em "SGL - CONECTA" (layoutId compartilhado com
 * a marca). ~6 s; um clique pula.
 *
 * Fora de novembro, ou com "reduzir movimento", vai direto para a marca.
 */

export const AZUL = "#3b82f6";
export const AZUL_CLARO = "#93c5fd";
export const AZUL_ESCURO = "#1d4ed8";
const VERDE = "#4ade80";
const VERDE_ESCURO = "#15803d";

export function ehNovembro(agora = new Date()): boolean {
  return agora.getMonth() === 10;
}

/** O fim da animação, em ms; a marca entra logo depois. */
const DURACAO_MS = 6400;

type Fase = "cena" | "final";

export function AberturaNovembroAzul({ marca }: { marca: ReactNode }) {
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
            className="relative flex min-h-[460px] cursor-pointer flex-col items-center justify-center"
            onClick={() => setFase("final")}
            title="Clique para pular"
          >
            <Cena />
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

/* Mesmo traçado do laço do Outubro Rosa: começa no caule, sobe, faz a volta
   de cima e cruza descendo nas duas pontas. */
const CAULE = "M200 330 C 200 305, 199 285, 200 250";
const LACO =
  "M200 250 C 205 215, 240 185, 236 150 C 232 112, 168 112, 164 150 C 160 185, 195 215, 200 250 C 206 280, 236 300, 252 330 M200 250 C 194 280, 164 300, 148 330";

/* As duas primeiras folhas da muda, desenhadas como as metades de um bigode:
   saem do caule e terminam numa voltinha para cima. */
const BIGODE_ESQ =
  "M200 292 C 190 280, 170 278, 156 288 C 146 295, 134 292, 130 280 C 126 296, 140 310, 160 306 C 176 303, 190 298, 200 300 Z";
const BIGODE_DIR =
  "M200 292 C 210 280, 230 278, 244 288 C 254 295, 266 292, 270 280 C 274 296, 260 310, 240 306 C 224 303, 210 298, 200 300 Z";

function Cena() {
  const gotas = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        id: i,
        x: 3 + Math.random() * 94,
        atraso: Math.random() * 2.4,
        dur: 0.9 + Math.random() * 0.7,
        repete: 1 + Math.floor(Math.random() * 2),
        tam: 6 + Math.random() * 6,
      })),
    [],
  );

  return (
    <div className="relative w-full max-w-md select-none">
      {/* chuva sobre o plantio */}
      <div className="pointer-events-none absolute inset-x-0 -top-10 h-[420px] overflow-hidden">
        {gotas.map((g) => (
          <motion.svg
            key={g.id}
            viewBox="0 0 20 20"
            className="absolute"
            style={{ left: `${g.x}%`, width: g.tam, height: g.tam * 1.4 }}
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 400, opacity: [0, 0.9, 0.9, 0] }}
            transition={{
              duration: g.dur,
              delay: g.atraso,
              ease: "easeIn",
              repeat: g.repete,
              repeatDelay: 0.2,
            }}
            aria-hidden
          >
            <path
              d="M10 1 C 14 8, 17 12, 17 15 A 7 7 0 0 1 3 15 C 3 12, 6 8, 10 1 Z"
              fill={g.id % 3 ? AZUL_CLARO : AZUL}
            />
          </motion.svg>
        ))}
      </div>

      <svg viewBox="0 0 400 360" className="relative mx-auto h-[300px] w-full" aria-hidden>
        <defs>
          <linearGradient id="laco-azul" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={AZUL_CLARO} />
            <stop offset="55%" stopColor={AZUL} />
            <stop offset="100%" stopColor={AZUL_ESCURO} />
          </linearGradient>
          <linearGradient id="folha-bigode" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={VERDE} />
            <stop offset="100%" stopColor={VERDE_ESCURO} />
          </linearGradient>
          <radialGradient id="brilho-azul" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={AZUL} stopOpacity={0.45} />
            <stop offset="100%" stopColor={AZUL} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* halo */}
        <motion.circle
          cx={200}
          cy={190}
          r={150}
          fill="url(#brilho-azul)"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: [0, 1, 0.7], scale: [0.6, 1, 1.05] }}
          transition={{ duration: 3, delay: 1.8 }}
          style={{ transformOrigin: "200px 190px" }}
        />

        {/* solo: linha de plantio, torrões e as poças da chuva */}
        <motion.path
          d="M40 332 Q 120 326, 200 332 T 360 332"
          fill="none"
          stroke="#8b5a2b"
          strokeWidth={6}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
        {[90, 140, 260, 310].map((x, i) => (
          <motion.ellipse
            key={x}
            cx={x}
            cy={340}
            rx={14}
            ry={5}
            fill="#6b4423"
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 0.7 }}
            transition={{ delay: 0.3 + i * 0.08, duration: 0.3 }}
            style={{ transformOrigin: `${x}px 340px` }}
          />
        ))}
        {[115, 285].map((x, i) => (
          <motion.ellipse
            key={`poca-${x}`}
            cx={x}
            cy={337}
            rx={18}
            ry={3}
            fill="none"
            stroke={AZUL_CLARO}
            strokeWidth={1.5}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1, 1.5], opacity: [0, 0.8, 0] }}
            transition={{ delay: 0.9 + i * 0.5, duration: 1.4, repeat: 2, repeatDelay: 0.3 }}
            style={{ transformOrigin: `${x}px 337px` }}
          />
        ))}

        {/* caule da muda */}
        <motion.path
          d={CAULE}
          fill="none"
          stroke={VERDE_ESCURO}
          strokeWidth={9}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.6, delay: 0.6, ease: "easeOut" }}
        />

        {/* as primeiras folhas se abrem como um bigode */}
        {[
          { d: BIGODE_ESQ, at: 1.0 },
          { d: BIGODE_DIR, at: 1.12 },
        ].map((f) => (
          <motion.path
            key={f.d}
            d={f.d}
            fill="url(#folha-bigode)"
            stroke={VERDE_ESCURO}
            strokeWidth={2}
            strokeLinejoin="round"
            initial={{ scale: 0, rotate: 0 }}
            animate={{ scale: [0, 1.2, 1], rotate: [0, 0, -2, 2, 0] }}
            transition={{
              scale: { delay: f.at, duration: 0.5 },
              rotate: { delay: 2.2, duration: 1.2, repeat: 1 },
            }}
            style={{ transformOrigin: "200px 296px" }}
          />
        ))}

        {/* o caule vira o laço azul */}
        <motion.path
          d={LACO}
          fill="none"
          stroke="url(#laco-azul)"
          strokeWidth={22}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 1 }}
          animate={{ pathLength: 1, opacity: [1, 1, 0] }}
          transition={{
            pathLength: { duration: 1.6, delay: 1.35, ease: "easeInOut" },
            opacity: { duration: 0.5, delay: 4.8, times: [0, 0.1, 1] },
          }}
        />

        {/* folhinhas de eucalipto ao longo do laço */}
        {[
          { x: 236, y: 150, r: 35 },
          { x: 164, y: 150, r: -35 },
          { x: 200, y: 118, r: 0 },
        ].map((f, i) => (
          <motion.path
            key={i}
            d={`M${f.x} ${f.y} c -8 -10, -18 -8, -22 2 c 10 6, 18 4, 22 -2 z`}
            fill={VERDE}
            initial={{ scale: 0, rotate: f.r }}
            animate={{ scale: [0, 1.2, 1, 1, 0] }}
            transition={{ delay: 2.4 + i * 0.15, duration: 2.6, times: [0, 0.1, 0.2, 0.85, 1] }}
            style={{ transformOrigin: `${f.x}px ${f.y}px` }}
          />
        ))}

        {/* brotos azuis nas pontas do laço */}
        {[
          { x: 252, y: 330 },
          { x: 148, y: 330 },
        ].map((p, i) => (
          <motion.g
            key={i}
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.25, 1, 1, 0] }}
            transition={{ delay: 2.8 + i * 0.12, duration: 2.1, times: [0, 0.12, 0.25, 0.85, 1] }}
            style={{ transformOrigin: `${p.x}px ${p.y}px` }}
          >
            {[0, 72, 144, 216, 288].map((a) => (
              <ellipse
                key={a}
                cx={p.x}
                cy={p.y - 9}
                rx={6}
                ry={10}
                fill={AZUL_CLARO}
                stroke={AZUL}
                strokeWidth={1.5}
                transform={`rotate(${a} ${p.x} ${p.y})`}
              />
            ))}
            <circle cx={p.x} cy={p.y} r={4} fill="#fde047" />
          </motion.g>
        ))}
      </svg>

      {/* A volta do laço vira o "O": nasce no lugar da volta e, no fim, é
          este mesmo elemento (layoutId) que voa até o título. */}
      <motion.div
        layoutId="conecta-o"
        className="absolute left-1/2 rounded-full"
        style={{
          top: 46,
          width: 92,
          height: 92,
          marginLeft: -46,
          border: `10px solid ${AZUL}`,
          boxShadow: `0 0 30px ${AZUL}, inset 0 0 18px ${AZUL_CLARO}`,
        }}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0, 0, 1], scale: [0.6, 0.6, 1] }}
        transition={{ duration: 5.1, times: [0, 0.9, 1] }}
      />

      {/* a mensagem */}
      <div className="relative mt-2 text-center">
        <motion.div
          initial={{ opacity: 0, y: 14, letterSpacing: "0.4em" }}
          animate={{ opacity: [0, 1, 1, 0], y: 0, letterSpacing: "0.08em" }}
          transition={{ delay: 2.7, duration: 3.5, times: [0, 0.15, 0.85, 1] }}
          className="font-display text-4xl font-bold uppercase"
          style={{ color: AZUL_CLARO, textShadow: `0 0 24px ${AZUL}` }}
        >
          Novembro Azul
        </motion.div>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: [0, 1, 1, 0], y: 0 }}
          transition={{ delay: 3.2, duration: 3.0, times: [0, 0.15, 0.85, 1] }}
          className="mt-2 text-base text-white/80"
        >
          Homem que se cuida também planta futuro. 🌱
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 1, 0] }}
          transition={{ delay: 3.7, duration: 2.5, times: [0, 0.15, 0.85, 1] }}
          className="mt-1 text-xs uppercase tracking-[0.2em] text-white/50"
        >
          Prevenção · procure um urologista
        </motion.p>
      </div>
    </div>
  );
}

/**
 * O "O" do CONECTA na marca, em novembro: a mesma logo, com o anel azul e o
 * layoutId que recebe o círculo da cena.
 */
export function OAzul({ children }: { children: ReactNode }) {
  return (
    <motion.span
      layoutId="conecta-o"
      className="relative inline-block rounded-full"
      style={{
        verticalAlign: "-0.015em",
        boxShadow: `0 0 0 0.05em ${AZUL}, 0 0 18px ${AZUL}`,
      }}
      transition={{ type: "spring", stiffness: 140, damping: 18 }}
    >
      {children}
    </motion.span>
  );
}

/** O selo do mês, embaixo do texto da marca. */
export function SeloNovembroAzul() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.9 }}
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur"
      style={{
        borderColor: `color-mix(in oklab, ${AZUL} 55%, transparent)`,
        background: `color-mix(in oklab, ${AZUL} 14%, transparent)`,
        color: AZUL_CLARO,
      }}
    >
      🎗️ Novembro Azul — cuide da sua saúde. Prevenção salva vidas.
    </motion.div>
  );
}
