import { useEffect, useMemo, useRef, useState } from "react";
import { SemTresD } from "@/components/rv/sem-tres-d";
import { motion, useReducedMotion } from "framer-motion";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { Group } from "three";
import { Html } from "@react-three/drei";
import { primeiroNome } from "@/integrations/iam/types";
import type { AvatarConfig } from "@/lib/avatar-3d";
import { REACOES_DO_AVATAR, type ReacaoDoAvatar } from "@/lib/reacoes-do-avatar";
import { Avatar3D } from "@/components/rv/avatar-3d";
import { MEDIDAS } from "@/components/rv/medidas";
import {
  ABRACO_EM,
  BEIJO_SOLTO_EM,
  INSTANTE_PARADO,
  JOINHA_EM,
  OBRIGADO_CURVA_EM,
  OLHO_APONTA_EM,
  PISAO_EM,
  ROSTO_DO_GESTO,
  SONO_TOMBA_EM,
  maoNoGesto,
  maoQueAtirouOBeijo,
  type GestoDeReacao,
  type Lado,
} from "@/components/rv/poses-de-reacao";

/**
 * A cena da reação do avatar (17/10/2026): o <Canvas> com o boneco fazendo o
 * gesto, os efeitos (corações, 💢, fumacinha, confete, Zzz…), o que vai na
 * mão (☕, 🏆, 👍), a faixa com o nome e o som. Cada reação tem o seu visual
 * na tabela `VISUAL`.
 * Carregada sob demanda por `reacao-de-avatar.tsx`, que ouve o evento.
 */

export type EventoDeReacao = {
  reacao: ReacaoDoAvatar;
  deNome: string;
  meu: boolean;
  avatar: AvatarConfig;
  chave: number;
};

/* ————————————————— O visual de cada reação ————————————————— */

type Som = "beijo" | "pisao" | "festa" | "pop" | "sino" | "bocejo";

type Visual = {
  /** O fundo que cobre a tela por trás do boneco. */
  fundo: string;
  /** As cores da faixa com o nome (gradiente do Tailwind). */
  faixa: string;
  /** O som e quando ele toca (segundos do gesto). */
  som?: { tipo: Som; em: number };
};

const VISUAL: Record<ReacaoDoAvatar, Visual> = {
  beijo: {
    fundo:
      "radial-gradient(circle at 50% 45%, rgba(244,114,182,0.28), rgba(244,114,182,0.08) 60%, transparent)",
    faixa: "from-pink-500 via-rose-500 to-fuchsia-500",
    som: { tipo: "beijo", em: BEIJO_SOLTO_EM },
  },
  bravo: {
    fundo: "radial-gradient(circle at 50% 45%, rgba(239,68,68,0.10), rgba(220,38,38,0.22) 75%)",
    faixa: "from-red-600 via-orange-600 to-amber-500",
    som: { tipo: "pisao", em: PISAO_EM },
  },
  comemorar: {
    fundo:
      "radial-gradient(circle at 50% 45%, rgba(250,204,21,0.25), rgba(251,146,60,0.10) 65%, transparent)",
    faixa: "from-amber-500 via-orange-500 to-pink-500",
    som: { tipo: "festa", em: 0.2 },
  },
  abraco: {
    fundo:
      "radial-gradient(circle at 50% 45%, rgba(251,146,60,0.22), rgba(244,114,182,0.10) 65%, transparent)",
    faixa: "from-orange-400 via-rose-400 to-pink-500",
    som: { tipo: "pop", em: ABRACO_EM },
  },
  obrigado: {
    fundo:
      "radial-gradient(circle at 50% 45%, rgba(56,189,248,0.22), rgba(250,204,21,0.08) 65%, transparent)",
    faixa: "from-sky-500 via-cyan-500 to-teal-500",
    som: { tipo: "sino", em: OBRIGADO_CURVA_EM },
  },
  joinha: {
    fundo:
      "radial-gradient(circle at 50% 45%, rgba(34,197,94,0.22), rgba(34,197,94,0.06) 65%, transparent)",
    faixa: "from-emerald-500 via-green-500 to-lime-500",
    som: { tipo: "pop", em: JOINHA_EM },
  },
  olho: {
    fundo: "radial-gradient(circle at 50% 45%, rgba(139,92,246,0.10), rgba(76,29,149,0.25) 75%)",
    faixa: "from-violet-600 via-purple-600 to-indigo-600",
    som: { tipo: "pop", em: OLHO_APONTA_EM },
  },
  rindo: {
    fundo:
      "radial-gradient(circle at 50% 45%, rgba(253,224,71,0.28), rgba(250,204,21,0.08) 65%, transparent)",
    faixa: "from-yellow-400 via-amber-500 to-orange-500",
  },
  bora: {
    fundo: "radial-gradient(circle at 50% 45%, rgba(249,115,22,0.18), rgba(220,38,38,0.18) 75%)",
    faixa: "from-orange-500 via-red-500 to-rose-600",
    som: { tipo: "pisao", em: 0.4 },
  },
  sono: {
    fundo: "radial-gradient(circle at 50% 45%, rgba(30,58,138,0.12), rgba(15,23,42,0.40) 80%)",
    faixa: "from-indigo-500 via-blue-600 to-slate-600",
    som: { tipo: "bocejo", em: 0.3 },
  },
  cafe: {
    fundo:
      "radial-gradient(circle at 50% 45%, rgba(180,83,9,0.18), rgba(120,53,15,0.08) 65%, transparent)",
    faixa: "from-amber-700 via-orange-700 to-yellow-600",
    som: { tipo: "sino", em: 0.35 },
  },
  trofeu: {
    fundo:
      "radial-gradient(circle at 50% 45%, rgba(250,204,21,0.32), rgba(234,179,8,0.10) 65%, transparent)",
    faixa: "from-yellow-500 via-amber-500 to-yellow-600",
    som: { tipo: "festa", em: 0.5 },
  },
};

export function CenaDaReacao({ evento }: { evento: EventoDeReacao }) {
  const reduzir = !!useReducedMotion();
  const { reacao, avatar, meu } = evento;
  const def = REACOES_DO_AVATAR[reacao];
  const visual = VISUAL[reacao];
  /* O relógio da cena começa no PRIMEIRO QUADRO do boneco, não na montagem:
     o primeiro quadro espera o shader compilar e a roupa pintar (centenas de
     ms), e os efeitos e o som têm de cair no tempo do gesto. */
  const [comecou, setComecou] = useState(false);

  useEffect(() => {
    if (reduzir || !comecou || !visual.som) return;
    return tocarSom(visual.som.tipo, visual.som.em * 1000);
  }, [visual, reduzir, comecou]);

  const efeitos = comecou && !reduzir;
  /* O jeito do boneco entrar e se mexer na tela: o pisão do bravo e do
     "bora" sacodem; o abraço vem para perto de quem olha. */
  const sacode = reacao === "bravo" || reacao === "bora";
  const animar = !comecou
    ? undefined
    : reduzir
      ? { opacity: 1 }
      : sacode
        ? { y: 0, scale: 1, opacity: 1, x: [0, 0, -9, 9, -6, 6, 0] }
        : reacao === "abraco"
          ? { y: 0, opacity: 1, scale: [1, 1, 1.22, 1.22, 1] }
          : { y: 0, scale: 1, opacity: 1 };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      className="pointer-events-none fixed inset-0 z-[470] overflow-hidden"
      style={{ background: visual.fundo }}
      aria-live="polite"
      data-reacao={comecou ? "rodando" : "preparando"}
    >
      {efeitos && reacao === "beijo" && <CoracoesSubindo />}
      {efeitos && reacao === "beijo" && <BeijoVoando />}
      {efeitos && <EfeitosDaTela reacao={reacao} />}

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.div
          initial={reduzir ? { opacity: 0 } : { y: "55vh", scale: 0.35, opacity: 0 }}
          animate={animar}
          exit={reduzir ? { opacity: 0 } : { y: "45vh", scale: 0.5, opacity: 0 }}
          transition={
            reduzir
              ? { duration: 0.2 }
              : reacao === "abraco"
                ? {
                    y: { type: "spring", stiffness: 260, damping: 17 },
                    opacity: { duration: 0.2 },
                    scale: { duration: 3.2, times: [0, 0.3, 0.42, 0.88, 1], ease: "easeInOut" },
                  }
                : {
                    y: { type: "spring", stiffness: 260, damping: 17 },
                    scale: { type: "spring", stiffness: 260, damping: 15 },
                    opacity: { duration: 0.2 },
                    // O bravo sacode no pisão (0,6 s); o "bora", no pulo (0,4 s).
                    x: {
                      duration: reacao === "bora" ? 0.75 : 0.95,
                      times: [0, 0.6, 0.68, 0.76, 0.84, 0.92, 1],
                    },
                  }
          }
          style={{ height: "min(70vh, 112vw)", width: "min(56vh, 90vw)" }}
        >
          {/* `offsetSize`: medir sem a escala da entrada. Medido escalado (0,35),
              o <canvas> nascia pequeno e não crescia junto com a animação. */}
          <SemTresD>
            <Canvas
              resize={{ offsetSize: true }}
              dpr={[1, 1.75]}
              gl={{ alpha: true, antialias: true }}
              camera={{ position: [0, 1.3, 3.6], fov: 30 }}
              style={{ background: "transparent" }}
            >
              <Enquadrar avatar={avatar} />
              <PrimeiroQuadro aoComecar={() => setComecou(true)} />
              <hemisphereLight args={["#ffffff", "#9ca3af", 1.15]} />
              <directionalLight position={[2, 3, 2.5]} intensity={1.3} />
              <directionalLight position={[-2, 2, -1]} intensity={0.4} />
              <Avatar3D
                config={avatar}
                pose="em-pe"
                mostrarNome={false}
                gesto={reacao}
                gestoTempo={reduzir ? INSTANTE_PARADO[reacao] : undefined}
                expressaoForcada={ROSTO_DO_GESTO[reacao]}
              />
              {/* O que vai na mão: o relógio é o mesmo do boneco, então anda junto. */}
              <ObjetosNaMao reacao={reacao} avatar={avatar} reduzir={reduzir} />
              {comecou && reacao === "beijo" && <CoracoesDaMao avatar={avatar} reduzir={reduzir} />}
              {comecou && reacao === "bravo" && <Raiva avatar={avatar} reduzir={reduzir} />}
              {efeitos && <EfeitosNaCabeca reacao={reacao} avatar={avatar} />}
            </Canvas>
          </SemTresD>
        </motion.div>

        {/* Quem mandou, embaixo do boneco — como no emoji gigante. */}
        <motion.div
          initial={reduzir ? { opacity: 0 } : { y: 30, opacity: 0, scale: 0.8 }}
          animate={comecou ? { y: 0, opacity: 1, scale: 1 } : undefined}
          transition={
            reduzir
              ? { duration: 0.2 }
              : { delay: 0.45, type: "spring", stiffness: 300, damping: 18 }
          }
          className={`-mt-2 rounded-full bg-gradient-to-r px-7 py-2.5 text-center text-xl font-black uppercase tracking-tight text-white shadow-2xl md:text-3xl ${visual.faixa}`}
          style={{ textShadow: "0 2px 8px oklch(0.2 0.02 260 / 0.45)" }}
        >
          {def.faixa(primeiroNome(evento.deNome), meu)}
        </motion.div>
      </div>
    </motion.div>
  );
}

/**
 * A câmera, mirando o boneco dos joelhos até acima da cabeça (com folga para
 * a mão do beijo e o 💢). O R3F aponta a câmera para a origem — o chão —, por
 * isso a mira é feita aqui (o mesmo conserto de `avatar-acenando.tsx`).
 */
function Enquadrar({ avatar }: { avatar: AvatarConfig }) {
  const { camera, size } = useThree();
  const m = MEDIDAS[avatar.corpo];
  useEffect(() => {
    const topo = m.pernaH + m.troncoH + 0.03 + m.cabeca + 0.22;
    const base = m.pernaH * 0.4;
    const meio = (topo + base) / 2;
    // fov 30: a altura visível é 2·d·tg(15°) ≈ 0,536·d; 8% de folga.
    const d = ((topo - base) * 1.08) / 0.536;
    camera.position.set(0, meio + 0.12, d);
    camera.lookAt(0, meio, 0);
    camera.updateProjectionMatrix();
  }, [camera, m, size.width, size.height]);
  return null;
}

/** Avisa uma vez, no primeiro quadro desenhado. */
function PrimeiroQuadro({ aoComecar }: { aoComecar: () => void }) {
  const avisou = useRef(false);
  useFrame(() => {
    if (avisou.current) return;
    avisou.current = true;
    aoComecar();
  });
  return null;
}

/* ————————————————— Beijo ————————————————— */

const CORACOES = ["❤️", "💕", "💖", "💗", "💋"];

/** Os corações que estouram da mão no instante em que o beijo é atirado. */
function CoracoesDaMao({ avatar, reduzir }: { avatar: AvatarConfig; reduzir: boolean }) {
  const mao = useMemo(() => maoQueAtirouOBeijo(MEDIDAS[avatar.corpo]), [avatar.corpo]);
  const pedacos = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
        const r = 70 + Math.random() * 90;
        return {
          id: i,
          emoji: CORACOES[i % CORACOES.length]!,
          x: Math.cos(a) * r,
          y: Math.sin(a) * r - 40,
          tamanho: 20 + Math.random() * 18,
          atraso: Math.random() * 0.15,
        };
      }),
    [],
  );
  return (
    <Html position={mao} center zIndexRange={[10, 0]}>
      <div className="pointer-events-none relative h-0 w-0">
        {pedacos.map((p) =>
          reduzir ? (
            p.id % 3 === 0 && (
              <span
                key={p.id}
                className="absolute select-none leading-none"
                style={{
                  fontSize: p.tamanho,
                  left: -p.tamanho / 2,
                  top: -p.tamanho / 2,
                  transform: `translate(${p.x * 0.6}px, ${p.y * 0.6}px)`,
                }}
              >
                {p.emoji}
              </span>
            )
          ) : (
            <motion.span
              key={p.id}
              // Centrado pela margem: o `transform` é do framer (x, y, escala).
              className="absolute select-none leading-none"
              style={{ fontSize: p.tamanho, left: -p.tamanho / 2, top: -p.tamanho / 2 }}
              initial={{ x: 0, y: 0, scale: 0.2, opacity: 0 }}
              animate={{ x: p.x, y: p.y, scale: [0.2, 1.3, 1], opacity: [0, 1, 1, 0] }}
              transition={{ delay: BEIJO_SOLTO_EM + p.atraso, duration: 1.3, ease: "easeOut" }}
            >
              {p.emoji}
            </motion.span>
          ),
        )}
      </div>
    </Html>
  );
}

/** O 💋 que sai da mão e vem na direção de quem olha, crescendo até sumir. */
function BeijoVoando() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <motion.span
        className="select-none leading-none drop-shadow-[0_12px_30px_rgba(190,24,93,0.45)]"
        style={{ fontSize: "min(16vh, 22vw)" }}
        initial={{ x: "9vh", y: "-12vh", scale: 0.15, opacity: 0, rotate: -15 }}
        animate={{
          x: ["9vh", "6vh", "0vh"],
          y: ["-12vh", "-10vh", "-4vh"],
          scale: [0.15, 1, 3.2],
          opacity: [0, 1, 0],
          rotate: [-15, 5, 0],
        }}
        transition={{
          delay: BEIJO_SOLTO_EM + 0.05,
          duration: 1.2,
          ease: "easeIn",
          times: [0, 0.3, 1],
        }}
      >
        💋
      </motion.span>
    </div>
  );
}

/** Corações subindo devagar do pé da tela, como a chuva do emoji gigante (mais calma). */
function CoracoesSubindo() {
  const gotas = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        id: i,
        emoji: CORACOES[i % 4]!,
        x: Math.random() * 100,
        tamanho: 22 + Math.random() * 30,
        atraso: 0.3 + Math.random() * 1.8,
        duracao: 2.2 + Math.random() * 1.2,
        balanco: (Math.random() - 0.5) * 80,
      })),
    [],
  );
  return (
    <>
      {gotas.map((g) => (
        <motion.span
          key={g.id}
          className="absolute select-none"
          style={{ left: `${g.x}%`, fontSize: g.tamanho }}
          initial={{ y: "105vh", x: 0, opacity: 0 }}
          animate={{ y: "-10vh", x: g.balanco, opacity: [0, 0.9, 0.9, 0] }}
          transition={{ duration: g.duracao, delay: g.atraso, ease: "easeOut" }}
        >
          {g.emoji}
        </motion.span>
      ))}
    </>
  );
}

/* ————————————————— Bravo ————————————————— */

/** O 💢 pulsando na testa e a fumacinha saindo dos dois lados da cabeça. */
function Raiva({ avatar, reduzir }: { avatar: AvatarConfig; reduzir: boolean }) {
  const m = MEDIDAS[avatar.corpo];
  const cabecaY = m.pernaH + m.troncoH + 0.03 + m.cabeca / 2;
  return (
    <>
      <Html
        position={[m.cabeca * 0.62, cabecaY + m.cabeca * 0.5, 0.1]}
        center
        zIndexRange={[10, 0]}
      >
        <motion.div
          className="pointer-events-none select-none leading-none drop-shadow-[0_4px_10px_rgba(185,28,28,0.5)]"
          style={{ fontSize: 56 }}
          initial={{ scale: 0, rotate: -20 }}
          animate={
            reduzir
              ? { scale: 1, rotate: 0 }
              : { scale: [0, 1.35, 1, 1.25, 1, 1.25, 1, 1.25, 1], rotate: 0 }
          }
          transition={
            reduzir ? { duration: 0.2 } : { delay: PISAO_EM, duration: 2.6, ease: "easeInOut" }
          }
        >
          💢
        </motion.div>
      </Html>
      {!reduzir &&
        ([-1, 1] as const).map((lado) => (
          <Html
            key={lado}
            position={[lado * m.cabeca * 0.55, cabecaY + m.cabeca * 0.05, 0]}
            center
            zIndexRange={[10, 0]}
          >
            <div className="pointer-events-none relative h-0 w-0">
              {[0, 1, 2, 3, 4].map((i) => (
                <motion.span
                  key={i}
                  // Branca com contorno cinza: some no fundo claro se for só branca.
                  className="absolute rounded-full bg-white shadow-[0_0_0_2px_rgba(100,116,139,0.35),0_4px_10px_rgba(15,23,42,0.18)]"
                  style={{ width: 28, height: 28, left: -14, top: -14 }}
                  initial={{ x: 0, y: 0, scale: 0.3, opacity: 0 }}
                  animate={{
                    x: lado * (40 + i * 6),
                    y: -50 - i * 8,
                    scale: [0.3, 1.2, 1.8],
                    opacity: [0, 0.9, 0],
                  }}
                  transition={{
                    delay: PISAO_EM + 0.15 + i * 0.45,
                    duration: 0.9,
                    ease: "easeOut",
                  }}
                />
              ))}
            </div>
          </Html>
        ))}
    </>
  );
}

/* ————————————————— As dez novas (17/10/2026) ————————————————— */

type NaMao = { emoji: string; lado: Lado; tamanho: number; acima: number; desde: number };

/** O que cada reação segura: emoji, mão (1 = esquerda do boneco), tamanho e folga acima da mão. */
const NA_MAO: Partial<Record<ReacaoDoAvatar, NaMao[]>> = {
  joinha: [{ emoji: "👍", lado: 1, tamanho: 64, acima: 0.02, desde: JOINHA_EM - 0.1 }],
  bora: [
    { emoji: "💪", lado: 1, tamanho: 52, acima: 0.02, desde: 0.3 },
    { emoji: "💪", lado: -1, tamanho: 52, acima: 0.02, desde: 0.3 },
  ],
  cafe: [{ emoji: "☕", lado: 1, tamanho: 50, acima: 0.03, desde: 0.15 }],
  trofeu: [{ emoji: "🏆", lado: -1, tamanho: 76, acima: 0.12, desde: 0.2 }],
};

/**
 * Os objetos presos à mão (👍, ☕, 🏆, 💪). O boneco não tem mão de verdade
 * para segurar: o emoji fica onde o meio da mão está a cada quadro, com o
 * MESMO relógio do Avatar3D (passo limitado a 50 ms) — andam juntos.
 */
function ObjetosNaMao({
  reacao,
  avatar,
  reduzir,
}: {
  reacao: ReacaoDoAvatar;
  avatar: AvatarConfig;
  reduzir: boolean;
}) {
  const itens = NA_MAO[reacao];
  if (!itens) return null;
  return (
    <>
      {itens.map((it, i) => (
        <PresoNaMao key={i} gesto={reacao} avatar={avatar} reduzir={reduzir} item={it} />
      ))}
    </>
  );
}

function PresoNaMao({
  gesto,
  avatar,
  reduzir,
  item,
}: {
  gesto: GestoDeReacao;
  avatar: AvatarConfig;
  reduzir: boolean;
  item: NaMao;
}) {
  const grupo = useRef<Group>(null);
  const tempo = useRef(0);
  const [visivel, setVisivel] = useState(reduzir);
  const m = MEDIDAS[avatar.corpo];
  useFrame((_, passo) => {
    tempo.current += Math.min(passo, 0.05);
    const s = reduzir ? INSTANTE_PARADO[gesto] : tempo.current;
    const [x, y, z] = maoNoGesto(gesto, s, m, item.lado);
    grupo.current?.position.set(x, y + item.acima, z + 0.04);
    if (!visivel && s >= item.desde) setVisivel(true);
  });
  return (
    <group ref={grupo}>
      {visivel && (
        <Html center zIndexRange={[10, 0]}>
          <motion.div
            className="pointer-events-none select-none leading-none drop-shadow-[0_6px_14px_rgba(15,23,42,0.35)]"
            style={{ fontSize: item.tamanho }}
            initial={reduzir ? false : { scale: 0, rotate: -25 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 14 }}
          >
            {item.emoji}
          </motion.div>
        </Html>
      )}
    </group>
  );
}

type Ponto = [number, number, number];

/** Os efeitos que saem da cabeça: 👀, ✨, os "KKKK", os "Zzz". */
function EfeitosNaCabeca({ reacao, avatar }: { reacao: ReacaoDoAvatar; avatar: AvatarConfig }) {
  const m = MEDIDAS[avatar.corpo];
  const cabecaY = m.pernaH + m.troncoH + 0.03 + m.cabeca / 2;
  const topo: Ponto = [m.cabeca * 0.55, cabecaY + m.cabeca * 0.45, 0.1];
  switch (reacao) {
    case "olho":
      return <Estouro posicao={topo} emoji="👀" tamanho={54} em={0.4} pulsa />;
    case "obrigado":
      return <Brilhos posicao={[0, cabecaY, 0]} em={OBRIGADO_CURVA_EM} />;
    case "rindo":
      return (
        <Subindo
          posicao={topo}
          textos={["KKKK", "KKKKKK", "HAHAHA", "KKK", "KKKKK", "HAHA"]}
          em={0.35}
          intervalo={0.4}
          classe="font-black text-amber-500 [-webkit-text-stroke:1.5px_white]"
          tamanho={30}
        />
      );
    case "sono":
      return (
        <Subindo
          posicao={[m.cabeca * 0.45, cabecaY + m.cabeca * 0.3, 0.1]}
          textos={["Z", "z", "Z", "z", "Z"]}
          em={SONO_TOMBA_EM}
          intervalo={0.35}
          classe="font-black italic text-indigo-200 drop-shadow-[0_2px_6px_rgba(30,27,75,0.8)]"
          tamanho={38}
        />
      );
    case "comemorar":
      return <Estouro posicao={topo} emoji="🥳" tamanho={46} em={0.3} />;
    case "trofeu":
      return <Brilhos posicao={[0, cabecaY + m.cabeca * 0.6, 0]} em={0.5} />;
    default:
      return null;
  }
}

/** Um emoji que estoura num ponto (e, com `pulsa`, fica batendo como o 💢). */
function Estouro({
  posicao,
  emoji,
  tamanho,
  em,
  pulsa = false,
}: {
  posicao: Ponto;
  emoji: string;
  tamanho: number;
  em: number;
  pulsa?: boolean;
}) {
  return (
    <Html position={posicao} center zIndexRange={[10, 0]}>
      <motion.div
        className="pointer-events-none select-none leading-none drop-shadow-[0_4px_10px_rgba(15,23,42,0.35)]"
        style={{ fontSize: tamanho }}
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: pulsa ? [0, 1.3, 1, 1.2, 1, 1.2, 1] : [0, 1.3, 1], rotate: 0 }}
        transition={{ delay: em, duration: pulsa ? 2.6 : 0.5, ease: "easeOut" }}
      >
        {emoji}
      </motion.div>
    </Html>
  );
}

/** Textos (ou emojis) subindo da cabeça, um atrás do outro. */
function Subindo({
  posicao,
  textos,
  em,
  intervalo,
  classe,
  tamanho,
}: {
  posicao: Ponto;
  textos: string[];
  em: number;
  intervalo: number;
  classe: string;
  tamanho: number;
}) {
  return (
    <Html position={posicao} center zIndexRange={[10, 0]}>
      <div className="pointer-events-none relative h-0 w-0">
        {textos.map((t, i) => (
          <motion.span
            key={i}
            className={`absolute select-none whitespace-nowrap leading-none ${classe}`}
            style={{ fontSize: tamanho * (i % 2 ? 0.8 : 1), left: 0, top: 0 }}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
            animate={{
              x: [0, 18 + i * 6, 6 + i * 10],
              y: [0, -60, -130],
              opacity: [0, 1, 0],
              scale: [0.4, 1.1, 1.2],
              rotate: i % 2 ? 10 : -8,
            }}
            transition={{ delay: em + i * intervalo, duration: 1.5, ease: "easeOut" }}
          >
            {t}
          </motion.span>
        ))}
      </div>
    </Html>
  );
}

/** Brilhos ✨ piscando em volta de um ponto (a cabeça, o troféu). */
function Brilhos({ posicao, em }: { posicao: Ponto; em: number }) {
  const pontos = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * Math.PI * 2;
        return { id: i, x: Math.cos(a) * 95, y: Math.sin(a) * 80 - 15 };
      }),
    [],
  );
  return (
    <Html position={posicao} center zIndexRange={[10, 0]}>
      <div className="pointer-events-none relative h-0 w-0">
        {pontos.map((p) => (
          <motion.span
            key={p.id}
            className="absolute select-none leading-none"
            style={{ fontSize: 26, left: -13, top: -13, x: p.x, y: p.y }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.3, 0.6, 1.2, 0], opacity: [0, 1, 0.7, 1, 0] }}
            transition={{ delay: em + p.id * 0.08, duration: 1.8, ease: "easeInOut" }}
          >
            ✨
          </motion.span>
        ))}
      </div>
    </Html>
  );
}

/** Os efeitos da tela inteira (por cima do fundo, atrás do boneco). */
function EfeitosDaTela({ reacao }: { reacao: ReacaoDoAvatar }) {
  switch (reacao) {
    case "comemorar":
      return <Chuva emojis={CHUVAS.festa} n={26} de="cima" />;
    case "trofeu":
      return <Chuva emojis={CHUVAS.estrelas} n={22} de="cima" atraso={0.4} />;
    case "abraco":
      return (
        <>
          <Chuva emojis={CHUVAS.carinho} n={16} de="baixo" />
          <Carimbo emoji="🤗" em={ABRACO_EM} />
        </>
      );
    case "obrigado":
      return <Chuva emojis={CHUVAS.gratidao} n={12} de="baixo" atraso={0.6} />;
    case "joinha":
      return <Carimbo emoji="👍" em={JOINHA_EM + 0.15} />;
    case "olho":
      return <Carimbo emoji="👀" em={OLHO_APONTA_EM} />;
    case "rindo":
      return <Chuva emojis={CHUVAS.risos} n={18} de="baixo" />;
    case "bora":
      return <Chuva emojis={CHUVAS.energia} n={16} de="baixo" atraso={0.3} />;
    case "cafe":
      return <Chuva emojis={CHUVAS.cafe} n={10} de="baixo" atraso={0.5} />;
    default:
      return null;
  }
}

const CHUVAS = {
  festa: ["🎉", "🎊", "✨", "🥳", "🎈"],
  estrelas: ["⭐", "✨", "🏆", "🌟", "🎊"],
  carinho: ["❤️", "🧡", "💛", "🤗", "💕"],
  gratidao: ["🙏", "✨", "💙", "🙏"],
  risos: ["😂", "🤣", "😂", "😆"],
  energia: ["🔥", "⚡", "💪", "🚀"],
  cafe: ["☕", "🍪", "☕", "🥐"],
};

/** Emojis caindo de cima (confete) ou subindo de baixo (como os corações). */
function Chuva({
  emojis,
  n,
  de,
  atraso = 0,
}: {
  emojis: string[];
  n: number;
  de: "cima" | "baixo";
  atraso?: number;
}) {
  const gotas = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => ({
        id: i,
        emoji: emojis[i % emojis.length]!,
        x: Math.random() * 100,
        tamanho: 22 + Math.random() * 28,
        atraso: atraso + Math.random() * 1.8,
        duracao: 2 + Math.random() * 1.3,
        balanco: (Math.random() - 0.5) * 90,
        giro: (Math.random() - 0.5) * 360,
      })),
    [emojis, n, atraso],
  );
  const cima = de === "cima";
  return (
    <>
      {gotas.map((g) => (
        <motion.span
          key={g.id}
          className="absolute select-none"
          style={{ left: `${g.x}%`, fontSize: g.tamanho }}
          initial={{ y: cima ? "-12vh" : "105vh", x: 0, opacity: 0, rotate: 0 }}
          animate={{
            y: cima ? "108vh" : "-10vh",
            x: g.balanco,
            opacity: [0, 0.95, 0.95, 0],
            rotate: cima ? g.giro : 0,
          }}
          transition={{ duration: g.duracao, delay: g.atraso, ease: cima ? "easeIn" : "easeOut" }}
        >
          {g.emoji}
        </motion.span>
      ))}
    </>
  );
}

/** O emoji enorme que "carimba" o meio da tela e some. */
function Carimbo({ emoji, em }: { emoji: string; em: number }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <motion.span
        className="select-none leading-none drop-shadow-[0_12px_30px_rgba(15,23,42,0.35)]"
        style={{ fontSize: "min(22vh, 30vw)" }}
        initial={{ scale: 0, opacity: 0, rotate: -12 }}
        animate={{ scale: [0, 1.25, 1, 1.6], opacity: [0, 0.9, 0.9, 0], rotate: [-12, 4, 0, 0] }}
        transition={{ delay: em, duration: 1.3, times: [0, 0.25, 0.6, 1], ease: "easeOut" }}
      >
        {emoji}
      </motion.span>
    </div>
  );
}

/* ————————————————— Som ————————————————— */

/**
 * Um som curto sintetizado na hora, como o "bum" da bomba: o "smack" do beijo
 * (agudo que sobe), o pisão (grave que cai), a festa (arpejo subindo), o pop,
 * o sino (duas notas que somem devagar) e o bocejo (grave descendo devagar).
 * Devolve o cancelamento, para a cena que some antes do tempo não tocar no vazio.
 */
function tocarSom(tipo: Som, atrasoMs: number): () => void {
  const id = window.setTimeout(() => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const agora = ctx.currentTime;
      /** Uma nota: frequência de/até, início, duração, forma e volume. */
      const nota = (
        de: number,
        ate: number,
        ini: number,
        dur: number,
        forma: OscillatorType,
        volume: number,
      ) => {
        const osc = ctx.createOscillator();
        const vol = ctx.createGain();
        osc.type = forma;
        osc.frequency.setValueAtTime(de, agora + ini);
        osc.frequency.exponentialRampToValueAtTime(ate, agora + ini + dur);
        vol.gain.setValueAtTime(0.0001, agora + ini);
        vol.gain.exponentialRampToValueAtTime(volume, agora + ini + 0.015);
        vol.gain.exponentialRampToValueAtTime(0.0001, agora + ini + dur);
        osc.connect(vol).connect(ctx.destination);
        osc.start(agora + ini);
        osc.stop(agora + ini + dur + 0.02);
        return osc;
      };
      let ultima: OscillatorNode;
      switch (tipo) {
        case "beijo":
          ultima = nota(520, 1300, 0, 0.16, "sine", 0.25);
          break;
        case "pisao":
          ultima = nota(150, 55, 0, 0.22, "triangle", 0.25);
          break;
        case "festa":
          [523, 659, 784].forEach((f, i) => nota(f, f, i * 0.08, 0.12, "triangle", 0.16));
          ultima = nota(1047, 1047, 0.24, 0.3, "triangle", 0.18);
          break;
        case "pop":
          ultima = nota(380, 950, 0, 0.09, "sine", 0.22);
          break;
        case "sino":
          nota(880, 880, 0, 0.7, "sine", 0.14);
          ultima = nota(1320, 1320, 0.12, 0.7, "sine", 0.1);
          break;
        case "bocejo":
          ultima = nota(320, 170, 0, 0.8, "triangle", 0.1);
          break;
      }
      ultima.onended = () => void ctx.close();
    } catch (erro) {
      // Sem áudio (navegador sem permissão de tocar): a cena segue muda.
      console.warn("reação do avatar: som indisponível", erro);
    }
  }, atrasoMs);
  return () => window.clearTimeout(id);
}
