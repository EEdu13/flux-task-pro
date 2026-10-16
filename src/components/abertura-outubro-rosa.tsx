import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";

/**
 * Abertura do login em outubro — Outubro Rosa com cara de silvicultura
 * (pedido do usuário, 16/10/2026: "transições bem legais, sem perder a
 * essência da silvicultura, do agro; no final fecha no O e aparece o
 * CONECTA").
 *
 * A cena: o solo se desenha, uma muda brota, o caule segue crescendo e se
 * enrola no laço rosa; pétalas de ipê-rosa caem. Vem a mensagem, e a volta do
 * laço vira um círculo — o "O" — que voa para o lugar dele em "SGL - CONECTA"
 * (layoutId compartilhado com a marca). ~6 s; um clique pula.
 *
 * Fora de outubro, ou com "reduzir movimento", vai direto para a marca.
 */

export const ROSA = "#ec4899";
export const ROSA_CLARO = "#f9a8d4";
export const ROSA_ESCURO = "#be185d";
const VERDE = "#4ade80";
const VERDE_ESCURO = "#15803d";

export function ehOutubro(agora = new Date()): boolean {
  return agora.getMonth() === 9;
}

/** O fim da animação, em ms; a marca entra logo depois. */
const DURACAO_MS = 6200;

type Fase = "cena" | "final";

export function AberturaOutubroRosa({ marca }: { marca: ReactNode }) {
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

/* O laço do Outubro Rosa desenhado como UM caminho só, que começa no caule:
   sobe, faz a volta de cima e cruza descendo nas duas pontas. */
const CAULE = "M200 330 C 200 300, 198 280, 200 250";
const LACO =
  "M200 250 C 205 215, 240 185, 236 150 C 232 112, 168 112, 164 150 C 160 185, 195 215, 200 250 C 206 280, 236 300, 252 330 M200 250 C 194 280, 164 300, 148 330";

function Cena() {
  const petalas = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        id: i,
        x: 5 + Math.random() * 90,
        atraso: 1.4 + Math.random() * 2.6,
        dur: 3 + Math.random() * 2,
        giro: (Math.random() - 0.5) * 540,
        deriva: (Math.random() - 0.5) * 80,
        tam: 10 + Math.random() * 10,
      })),
    [],
  );

  return (
    <div className="relative w-full max-w-md select-none">
      {/* pétalas de ipê-rosa caindo */}
      <div className="pointer-events-none absolute inset-x-0 -top-10 h-[480px] overflow-hidden">
        {petalas.map((p) => (
          <motion.svg
            key={p.id}
            viewBox="0 0 20 20"
            className="absolute"
            style={{ left: `${p.x}%`, width: p.tam, height: p.tam }}
            initial={{ y: -30, x: 0, rotate: 0, opacity: 0 }}
            animate={{ y: 470, x: p.deriva, rotate: p.giro, opacity: [0, 1, 1, 0] }}
            transition={{ duration: p.dur, delay: p.atraso, ease: "easeIn" }}
            aria-hidden
          >
            <path
              d="M10 1 C 16 6, 16 14, 10 19 C 4 14, 4 6, 10 1 Z"
              fill={p.id % 3 ? ROSA_CLARO : ROSA}
            />
          </motion.svg>
        ))}
      </div>

      <svg viewBox="0 0 400 360" className="relative mx-auto h-[300px] w-full" aria-hidden>
        <defs>
          <linearGradient id="laco-rosa" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={ROSA_CLARO} />
            <stop offset="55%" stopColor={ROSA} />
            <stop offset="100%" stopColor={ROSA_ESCURO} />
          </linearGradient>
          <radialGradient id="brilho-rosa" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={ROSA} stopOpacity={0.45} />
            <stop offset="100%" stopColor={ROSA} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* halo */}
        <motion.circle
          cx={200}
          cy={190}
          r={150}
          fill="url(#brilho-rosa)"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: [0, 1, 0.7], scale: [0.6, 1, 1.05] }}
          transition={{ duration: 3, delay: 1.6 }}
          style={{ transformOrigin: "200px 190px" }}
        />

        {/* solo: linha de plantio e torrões */}
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
        {/* primeiras folhas */}
        {[
          {
            d: "M200 290 C 180 280, 168 284, 160 296 C 174 300, 188 298, 200 290 Z",
            o: "200px 290px",
            at: 1.0,
          },
          {
            d: "M200 275 C 220 262, 234 266, 242 278 C 228 284, 212 282, 200 275 Z",
            o: "200px 275px",
            at: 1.15,
          },
        ].map((f) => (
          <motion.path
            key={f.d}
            d={f.d}
            fill={VERDE}
            stroke={VERDE_ESCURO}
            strokeWidth={2}
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.2, 1] }}
            transition={{ delay: f.at, duration: 0.45 }}
            style={{ transformOrigin: f.o }}
          />
        ))}

        {/* o caule vira o laço rosa */}
        <motion.path
          d={LACO}
          fill="none"
          stroke="url(#laco-rosa)"
          strokeWidth={22}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 1 }}
          animate={{ pathLength: 1, opacity: [1, 1, 0] }}
          transition={{
            pathLength: { duration: 1.6, delay: 1.25, ease: "easeInOut" },
            opacity: { duration: 0.5, delay: 4.6, times: [0, 0.1, 1] },
          }}
        />
        {/* folhinhas ao longo do laço */}
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
            transition={{ delay: 2.3 + i * 0.15, duration: 2.6, times: [0, 0.1, 0.2, 0.85, 1] }}
            style={{ transformOrigin: `${f.x}px ${f.y}px` }}
          />
        ))}

        {/* flores de ipê nas pontas */}
        {[
          { x: 252, y: 330 },
          { x: 148, y: 330 },
        ].map((p, i) => (
          <motion.g
            key={i}
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.25, 1, 1, 0] }}
            transition={{ delay: 2.7 + i * 0.12, duration: 2.1, times: [0, 0.12, 0.25, 0.85, 1] }}
            style={{ transformOrigin: `${p.x}px ${p.y}px` }}
          >
            {[0, 72, 144, 216, 288].map((a) => (
              <ellipse
                key={a}
                cx={p.x}
                cy={p.y - 9}
                rx={6}
                ry={10}
                fill={ROSA_CLARO}
                stroke={ROSA}
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
          border: `10px solid ${ROSA}`,
          boxShadow: `0 0 30px ${ROSA}, inset 0 0 18px ${ROSA_CLARO}`,
        }}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0, 0, 1], scale: [0.6, 0.6, 1] }}
        transition={{ duration: 4.9, times: [0, 0.9, 1] }}
      />

      {/* a mensagem */}
      <div className="relative mt-2 text-center">
        <motion.div
          initial={{ opacity: 0, y: 14, letterSpacing: "0.4em" }}
          animate={{ opacity: [0, 1, 1, 0], y: 0, letterSpacing: "0.08em" }}
          transition={{ delay: 2.6, duration: 3.4, times: [0, 0.15, 0.85, 1] }}
          className="font-display text-4xl font-bold uppercase"
          style={{ color: ROSA_CLARO, textShadow: `0 0 24px ${ROSA}` }}
        >
          Outubro Rosa
        </motion.div>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: [0, 1, 1, 0], y: 0 }}
          transition={{ delay: 3.1, duration: 2.9, times: [0, 0.15, 0.85, 1] }}
          className="mt-2 text-base text-white/80"
        >
          Quem planta cuidado, colhe vida. 🌱
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 1, 0] }}
          transition={{ delay: 3.6, duration: 2.4, times: [0, 0.15, 0.85, 1] }}
          className="mt-1 text-xs uppercase tracking-[0.2em] text-white/50"
        >
          Previna-se · faça o autoexame
        </motion.p>
      </div>
    </div>
  );
}

/**
 * O "O" do CONECTA na marca, em outubro: a mesma logo, com o anel rosa e o
 * layoutId que recebe o círculo da cena.
 */
export function ORosa({ children }: { children: ReactNode }) {
  return (
    <motion.span
      layoutId="conecta-o"
      className="relative inline-block rounded-full"
      style={{
        verticalAlign: "-0.015em",
        boxShadow: `0 0 0 0.05em ${ROSA}, 0 0 18px ${ROSA}`,
      }}
      transition={{ type: "spring", stiffness: 140, damping: 18 }}
    >
      {children}
    </motion.span>
  );
}

/** As letras ao redor do "O" entram depois que ele pousa. */
export function LetrasQueChegam({ children, de }: { children: ReactNode; de: "esq" | "dir" }) {
  return (
    <motion.span
      className="inline-block"
      initial={{ opacity: 0, x: de === "esq" ? -24 : 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.45, duration: 0.5, ease: "easeOut" }}
    >
      {children}
    </motion.span>
  );
}

/** O selo do mês, embaixo do texto da marca. */
export function SeloOutubroRosa() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.9 }}
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur"
      style={{
        borderColor: `color-mix(in oklab, ${ROSA} 55%, transparent)`,
        background: `color-mix(in oklab, ${ROSA} 14%, transparent)`,
        color: ROSA_CLARO,
      }}
    >
      🎗️ Outubro Rosa — cuide-se, previna-se. Faça o autoexame.
    </motion.div>
  );
}
