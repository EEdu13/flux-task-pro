import { useEffect, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { primeiroNome } from "@/integrations/iam/types";

/**
 * A bomba do MSN (pedido do usuário, 16/10/2026): a bomba preta cai, quica
 * três vezes com o pavio queimando e explode na tela — clarão, estouro
 * laranja, estilhaços, fumaça e um "BOOM!". É o 💣 do emoji gigante: quem
 * escolhe a bomba no chat dispara esta cena em vez da chuva de emojis.
 *
 * Linha do tempo (~3,6 s): 0–1,5 s cai e quica · 1,5–1,8 s treme · 1,8 s
 * explode · até 3,6 s a fumaça some. Não bloqueia nada (`pointer-events-none`).
 */

export const DURACAO_DA_BOMBA_MS = 3800;
const EXPLODE_EM = 1.8; // segundos

/** Um "bum" curto, sintetizado na hora: ruído grave que some rápido. */
function tocarExplosao(atrasoMs: number) {
  const id = window.setTimeout(() => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const dur = 1.2;
      const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
      const dados = buf.getChannelData(0);
      let ultimo = 0;
      for (let i = 0; i < dados.length; i++) {
        // Ruído "marrom" (grave), decaindo.
        ultimo = (ultimo + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        dados[i] = ultimo * 3.5 * Math.pow(1 - i / dados.length, 2);
      }
      const fonte = ctx.createBufferSource();
      fonte.buffer = buf;
      const filtro = ctx.createBiquadFilter();
      filtro.type = "lowpass";
      filtro.frequency.value = 900;
      const ganho = ctx.createGain();
      ganho.gain.value = 0.9;
      fonte.connect(filtro).connect(ganho).connect(ctx.destination);
      fonte.start();
      fonte.onended = () => void ctx.close().catch(() => {});
    } catch {
      /* sem áudio: a explosão é só visual */
    }
  }, atrasoMs);
  return () => window.clearTimeout(id);
}

function Bomba() {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full overflow-visible" aria-hidden>
      {/* pavio: encurta enquanto queima */}
      <motion.path
        d="M128 46 C 140 26, 158 22, 168 30"
        fill="none"
        stroke="#c8a26b"
        strokeWidth={9}
        strokeLinecap="round"
        initial={{ pathLength: 1 }}
        animate={{ pathLength: 0.15 }}
        transition={{ duration: EXPLODE_EM, ease: "linear" }}
      />
      {/* faísca na ponta do pavio */}
      <motion.g
        initial={{ x: 0, y: 0 }}
        animate={{ x: -34, y: 14 }}
        transition={{ duration: EXPLODE_EM, ease: "linear" }}
      >
        <motion.g
          style={{ originX: "168px", originY: "30px" }}
          animate={{ scale: [1, 1.4, 0.8, 1.3, 1], rotate: [0, 25, -15, 30, 0] }}
          transition={{ duration: 0.3, repeat: Infinity }}
        >
          <polygon
            points="168,6 173,22 190,16 178,29 194,38 175,36 176,54 167,40 156,52 160,35 142,36 158,27 148,14 163,21"
            fill="#ffb703"
            stroke="#e63946"
            strokeWidth={3}
            strokeLinejoin="round"
          />
          <circle cx={168} cy={30} r={5} fill="#fff8d6" />
        </motion.g>
      </motion.g>
      {/* gargalo */}
      <rect
        x={104}
        y={44}
        width={34}
        height={26}
        rx={6}
        transform="rotate(-28 121 57)"
        fill="#2b2b2b"
        stroke="#111"
        strokeWidth={4}
      />
      {/* corpo */}
      <circle cx={92} cy={118} r={70} fill="#1c1c1c" stroke="#0a0a0a" strokeWidth={5} />
      <circle cx={92} cy={118} r={70} fill="url(#bomba-brilho)" />
      <ellipse cx={118} cy={104} rx={13} ry={18} fill="#f1f1f1" transform="rotate(-20 118 104)" />
      <circle cx={112} cy={136} r={7} fill="#f1f1f1" />
      <defs>
        <radialGradient id="bomba-brilho" cx="65%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#555" stopOpacity={0.55} />
          <stop offset="60%" stopColor="#222" stopOpacity={0} />
        </radialGradient>
      </defs>
    </svg>
  );
}

export function BombaNaTela({ deNome, meu }: { deNome: string; meu: boolean }) {
  const reduzir = useReducedMotion();
  useEffect(() => tocarExplosao(EXPLODE_EM * 1000), []);

  // Estilhaços e fumaça: sorteados uma vez por bomba.
  const estilhacos = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => {
        const ang = (i / 26) * Math.PI * 2 + Math.random() * 0.3;
        const dist = 30 + Math.random() * 40; // em vmin
        return {
          id: i,
          x: Math.cos(ang) * dist,
          y: Math.sin(ang) * dist,
          giro: (Math.random() - 0.5) * 720,
          tam: 8 + Math.random() * 16,
          cor: ["#1c1c1c", "#3a3a3a", "#ff7b00", "#ffb703", "#e63946"][i % 5]!,
        };
      }),
    [],
  );
  const fumacas = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 50,
        y: (Math.random() - 0.5) * 30 - 8,
        tam: 18 + Math.random() * 16,
      })),
    [],
  );

  const assinatura = meu ? "Você mandou!" : `${primeiroNome(deNome)} mandou!`;

  if (reduzir) {
    return (
      <div className="pointer-events-none fixed inset-0 z-[470] grid place-items-center bg-black/20">
        <div className="text-center">
          <div className="text-[30vmin] leading-none">💥</div>
          <div className="mt-2 text-3xl font-black uppercase text-white drop-shadow">
            {assinatura}
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-[470] overflow-hidden"
      // Tremida da tela no estouro.
      animate={{
        x: [0, 0, -14, 12, -10, 8, -5, 3, 0],
        y: [0, 0, 10, -12, 8, -6, 4, -2, 0],
      }}
      transition={{
        duration: 0.6,
        delay: EXPLODE_EM,
        times: [0, 0.01, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1],
      }}
      aria-live="polite"
    >
      {/* A bomba: cai, quica três vezes, treme e some no estouro. */}
      <motion.div
        className="absolute left-1/2 top-1/2"
        style={{ width: "34vmin", height: "34vmin", marginLeft: "-17vmin", marginTop: "-17vmin" }}
        initial={{ y: "-120vh", scaleX: 1, scaleY: 1, rotate: -15, opacity: 1 }}
        animate={{
          y: ["-120vh", "0vh", "-22vh", "0vh", "-9vh", "0vh", "-3vh", "0vh", "0vh", "0vh"],
          scaleY: [1, 0.78, 1.06, 0.86, 1.03, 0.93, 1, 1, 1.08, 1.6],
          scaleX: [1, 1.2, 0.95, 1.1, 0.98, 1.05, 1, 1, 1.08, 1.6],
          rotate: [-15, 0, 6, 0, -4, 0, 2, 0, 0, 0],
          opacity: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
        }}
        transition={{
          duration: EXPLODE_EM + 0.05,
          times: [0, 0.25, 0.37, 0.48, 0.56, 0.63, 0.68, 0.72, 0.97, 1],
          ease: "easeOut",
        }}
      >
        {/* Treme antes de estourar. */}
        <motion.div
          className="h-full w-full"
          animate={{ x: [0, 0, -4, 4, -5, 5, -6, 6, 0] }}
          transition={{
            duration: EXPLODE_EM,
            times: [0, 0.78, 0.81, 0.84, 0.87, 0.9, 0.93, 0.96, 1],
          }}
        >
          <Bomba />
        </motion.div>
      </motion.div>

      {/* Clarão */}
      <motion.div
        className="absolute inset-0 bg-white"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.95, 0] }}
        transition={{ duration: 0.45, delay: EXPLODE_EM, times: [0, 0.15, 1] }}
      />

      {/* Estouro: estrela laranja e amarela crescendo */}
      <div className="absolute inset-0 grid place-items-center">
        <motion.svg
          viewBox="-100 -100 200 200"
          style={{ width: "80vmin", height: "80vmin" }}
          initial={{ scale: 0, opacity: 0, rotate: 0 }}
          animate={{ scale: [0, 1.15, 1.25], opacity: [0, 1, 0], rotate: [0, 12, 20] }}
          transition={{ duration: 1.1, delay: EXPLODE_EM, times: [0, 0.35, 1] }}
          aria-hidden
        >
          <polygon
            points={Array.from({ length: 28 }, (_, i) => {
              const r = i % 2 === 0 ? 96 : 52;
              const a = (i / 28) * Math.PI * 2;
              return `${Math.cos(a) * r},${Math.sin(a) * r}`;
            }).join(" ")}
            fill="#ff7b00"
            stroke="#e63946"
            strokeWidth={4}
            strokeLinejoin="round"
          />
          <polygon
            points={Array.from({ length: 22 }, (_, i) => {
              const r = i % 2 === 0 ? 64 : 34;
              const a = (i / 22) * Math.PI * 2 + 0.2;
              return `${Math.cos(a) * r},${Math.sin(a) * r}`;
            }).join(" ")}
            fill="#ffd166"
          />
          <circle r={22} fill="#fff8d6" />
        </motion.svg>
      </div>

      {/* Estilhaços voando */}
      <div className="absolute left-1/2 top-1/2">
        {estilhacos.map((e) => (
          <motion.span
            key={e.id}
            className="absolute rounded-sm"
            style={{ width: e.tam, height: e.tam * 0.7, background: e.cor, left: 0, top: 0 }}
            initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
            animate={{
              x: `${e.x}vmin`,
              y: [`0vmin`, `${e.y}vmin`, `${e.y + 25}vmin`],
              opacity: [0, 1, 1, 0],
              rotate: e.giro,
            }}
            transition={{ duration: 1.4, delay: EXPLODE_EM, ease: "easeOut" }}
          />
        ))}
      </div>

      {/* Fumaça subindo */}
      <div className="absolute left-1/2 top-1/2">
        {fumacas.map((f) => (
          <motion.span
            key={f.id}
            className="absolute rounded-full bg-zinc-500/60 blur-md"
            style={{
              width: `${f.tam}vmin`,
              height: `${f.tam}vmin`,
              left: `-${f.tam / 2}vmin`,
              top: `-${f.tam / 2}vmin`,
            }}
            initial={{ x: 0, y: 0, scale: 0.2, opacity: 0 }}
            animate={{
              x: `${f.x}vmin`,
              y: `${f.y - 18}vmin`,
              scale: [0.2, 1, 1.4],
              opacity: [0, 0.8, 0],
            }}
            transition={{ duration: 1.8, delay: EXPLODE_EM + 0.15, ease: "easeOut" }}
          />
        ))}
      </div>

      {/* BOOM! e quem mandou */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.div
          className="select-none font-black italic leading-none text-[#ffd166]"
          style={{
            fontSize: "min(22vw, 22vh)",
            WebkitTextStroke: "0.035em #1c1c1c",
            textShadow: "0.06em 0.06em 0 #e63946",
          }}
          initial={{ scale: 0, rotate: -12, opacity: 0 }}
          animate={{ scale: [0, 1.35, 1], rotate: [-12, 6, -4], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 1.6, delay: EXPLODE_EM + 0.1, times: [0, 0.2, 0.85, 1] }}
        >
          BOOM!
        </motion.div>
        <motion.div
          initial={{ y: 30, opacity: 0, scale: 0.8 }}
          animate={{ y: 0, opacity: [0, 1, 1, 0], scale: 1 }}
          transition={{ delay: EXPLODE_EM + 0.35, duration: 1.4, times: [0, 0.15, 0.85, 1] }}
          className="mt-3 rounded-full bg-[#1c1c1c] px-7 py-2.5 text-2xl font-black uppercase tracking-tight text-[#ffd166] shadow-2xl md:text-3xl"
        >
          💣 {assinatura}
        </motion.div>
      </div>
    </motion.div>
  );
}
