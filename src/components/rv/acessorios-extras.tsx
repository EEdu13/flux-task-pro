import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { DoubleSide, Quaternion, Vector3, type Group, type Mesh } from "three";
import type { AvatarConfig } from "@/lib/avatar-3d";
import { Bloco } from "@/components/rv/bloco";
import type { Medidas } from "@/components/rv/medidas";
import { clarear, escurecer } from "@/components/rv/avatar-texturas";
import { TEM_PAINEL } from "@/components/rv/roupa/pecas-cima";

/**
 * Acessórios novos do catálogo (16/10/2026, "crie pelo menos mais 10, bem
 * criativo e dinâmico, baseado em Roblox"): os ids estão em
 * `lib/avatar-catalogo/extras.ts`. O `Acessorio` de `avatar-3d.tsx` cai aqui
 * para todo id que não é dele.
 *
 * Regras do boneco que valem para todos:
 * - só as MEDIDAS do corpo (nada de caso por tipo de corpo): serve nos 10 corpos;
 * - o que vai na mão fica na mão DIREITA (x < 0): a esquerda é a do aceno;
 * - o que fica nas costas some sentado (o encosto da cadeira ocupa as costas),
 *   como a mochila antiga;
 * - animação leve no `useFrame` (chama, asa, capa, balão, cauda, papagaio).
 *
 * Cores: capa, cachecol, gravata-borboleta e balão usam `corChapeu`; o resto
 * tem cor própria.
 */

export type PropsAcessorio = {
  config: AvatarConfig;
  m: Medidas;
  /** A frente efetiva: tronco + painel do casaco, quando houver. */
  frente: number;
  topo: number;
  quadrilY: number;
  ombroY: number;
  sentado: boolean;
};

/** Os ids desenhados aqui (os mesmos de `EXTRAS_ACESSORIO`). */
export const ACESSORIOS_EXTRAS: ReadonlySet<string> = new Set([
  "jetpack",
  "asasAnjo",
  "asasFada",
  "capa",
  "espadaCostas",
  "violao",
  "cachecol",
  "gravataBorboleta",
  "correnteOuro",
  "bolsaTransversal",
  "radio",
  "prancheta",
  "muda",
  "papagaio",
  "balao",
]);

const OURO = "#f2b417";
const OURO_ESCURO = "#b7820b";

/** As costas efetivas (z < 0): tronco + painel do casaco, quando houver. */
function costasDe(p: PropsAcessorio) {
  return -(p.m.troncoD / 2 + (TEM_PAINEL.has(p.config.roupa) ? 0.04 : 0.01));
}

export function AcessorioExtra(p: PropsAcessorio): ReactNode {
  const costas = costasDe(p);
  switch (p.config.acessorio) {
    case "jetpack":
      return p.sentado ? null : <Jetpack {...p} costas={costas} />;
    case "asasAnjo":
      return p.sentado ? null : <Asas {...p} costas={costas} tipo="anjo" />;
    case "asasFada":
      return p.sentado ? null : <Asas {...p} costas={costas} tipo="fada" />;
    case "capa":
      return p.sentado ? null : <Capa {...p} costas={costas} />;
    case "espadaCostas":
      return p.sentado ? null : <Espada {...p} costas={costas} />;
    case "violao":
      return p.sentado ? null : <Violao {...p} costas={costas} />;
    case "cachecol":
      return <Cachecol {...p} costas={costas} />;
    case "gravataBorboleta":
      return <GravataBorboleta {...p} />;
    case "correnteOuro":
      return <Corrente {...p} />;
    case "bolsaTransversal":
      return <Bolsa {...p} costas={costas} />;
    case "radio":
      return <Radio {...p} />;
    case "prancheta":
      return <NaMao {...p} item="prancheta" />;
    case "muda":
      return <NaMao {...p} item="muda" />;
    case "papagaio":
      return <Papagaio {...p} />;
    case "balao":
      return <Balao {...p} />;
    default:
      return null;
  }
}

type ComCostas = PropsAcessorio & { costas: number };

/* ————————————————— Mão direita ————————————————— */

/** Posição do ombro direito (o pivô do braço, as MESMAS fórmulas da roupa). */
const xDoBracoDireito = (m: Medidas) => -(m.troncoW / 2 + m.bracoW / 2 + 0.01);
const comprimentoDoBraco = (m: Medidas) => m.troncoH + 0.02;
const GIRO_SENTADO = 1.2;

/**
 * Onde a mão direita encosta, no referencial do avatar. Em pé: a ponta do
 * braço caído (ombro girado −0,06 rad em z). Sentado: o braço vai para a
 * frente (−1,2 rad em x) e a mão pousa no tampo; `y` é a altura da palma
 * (a quina mais baixa do bloco do braço) — o tampo da mesa.
 */
function maoDireita(m: Medidas, ombroY: number, sentado: boolean) {
  const x = xDoBracoDireito(m);
  const c = comprimentoDoBraco(m);
  if (sentado) {
    const cos = Math.cos(GIRO_SENTADO);
    const sen = Math.sin(GIRO_SENTADO);
    return { x, y: ombroY - c * cos - (m.bracoW / 2) * sen, z: c * sen };
  }
  return { x: x - c * Math.sin(0.06), y: ombroY - c * Math.cos(0.06), z: 0 };
}

/** O pulso direito: no EIXO do braço, 6 cm antes da ponta (onde fica o relógio). */
function pulsoDireito(m: Medidas, ombroY: number, sentado: boolean) {
  const x = xDoBracoDireito(m);
  const c = comprimentoDoBraco(m) - 0.06;
  const giro = sentado ? GIRO_SENTADO : 0.06;
  return sentado
    ? { x, y: ombroY - c * Math.cos(giro), z: c * Math.sin(giro) }
    : { x: x - c * Math.sin(giro), y: ombroY - c * Math.cos(giro), z: 0 };
}

/** Escala dos objetos de mão: acompanha a grossura do braço (mini ↔ gigante). */
const escalaDaMao = (m: Medidas) => Math.min(1.2, Math.max(0.8, m.bracoW / 0.24));

/**
 * Prancheta de inventário florestal / muda de eucalipto no vasinho. Em pé,
 * seguros na frente da mão direita (a mão "pega" a borda de cima/o vaso).
 * Sentado, pousados no tampo, logo à frente da mão.
 */
function NaMao({ m, ombroY, sentado, item }: PropsAcessorio & { item: "prancheta" | "muda" }) {
  const mao = maoDireita(m, ombroY, sentado);
  const s = escalaDaMao(m);
  if (item === "prancheta") {
    // Em pé: a presilha na mão, a prancheta pendurada de frente. Sentado: deitada na mesa.
    return sentado ? (
      <group
        position={[mao.x + 0.06, mao.y + 0.006, mao.z + 0.14]}
        rotation={[-Math.PI / 2, 0, 0.3]}
      >
        <Prancheta s={s} />
      </group>
    ) : (
      <group position={[mao.x, mao.y - 0.1 * s, m.bracoW / 2 + 0.016]} rotation={[0, 0, -0.06]}>
        <Prancheta s={s} />
      </group>
    );
  }
  // A origem da muda é a boca do vaso (o vaso desce 11 cm): sentado, o fundo pousa no tampo.
  const sm = s * 1.2;
  return sentado ? (
    <group position={[mao.x + 0.05, mao.y + 0.12 * sm, mao.z + 0.12]}>
      <Muda s={sm} />
    </group>
  ) : (
    <group position={[mao.x, mao.y - 0.04 * sm, m.bracoW / 2 + 0.06 * sm]}>
      <Muda s={sm} />
    </group>
  );
}

/** A prancheta em pé no plano xy, centro no meio da folha; a presilha em cima. */
function Prancheta({ s }: { s: number }) {
  return (
    <group scale={s}>
      <Bloco tam={[0.2, 0.27, 0.014]} cor="#a0703f" raio={0.012} brilho={0.7} />
      <mesh position={[0, -0.012, 0.0075]}>
        <boxGeometry args={[0.17, 0.215, 0.002]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.9} />
      </mesh>
      {/* cabeçalho verde (o da planilha de inventário) e as linhas da tabela */}
      <mesh position={[0, 0.07, 0.0092]}>
        <boxGeometry args={[0.15, 0.03, 0.001]} />
        <meshStandardMaterial color="#15803d" />
      </mesh>
      {[0.03, 0.0, -0.03, -0.06, -0.09].map((y) => (
        <mesh key={y} position={[0, y, 0.0092]}>
          <boxGeometry args={[0.15, 0.004, 0.001]} />
          <meshStandardMaterial color="#94a3b8" />
        </mesh>
      ))}
      <mesh position={[-0.035, -0.03, 0.0092]}>
        <boxGeometry args={[0.003, 0.13, 0.001]} />
        <meshStandardMaterial color="#94a3b8" />
      </mesh>
      {/* presilha de metal */}
      <Bloco
        tam={[0.09, 0.035, 0.022]}
        pos={[0, 0.125, 0.006]}
        cor="#cbd5e1"
        raio={0.008}
        brilho={0.3}
      />
      {/* lápis preso na presilha */}
      <mesh position={[0.065, 0.06, 0.016]} rotation-z={0.15}>
        <cylinderGeometry args={[0.006, 0.006, 0.15, 6]} />
        <meshStandardMaterial color="#facc15" />
      </mesh>
    </group>
  );
}

/** Muda de eucalipto no saquinho/vasinho; as folhas balançam. Origem na boca do vaso. */
function Muda({ s }: { s: number }) {
  const copa = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (copa.current) {
      const t = clock.elapsedTime;
      copa.current.rotation.z = Math.sin(t * 1.7) * 0.07;
      copa.current.rotation.x = Math.sin(t * 1.3 + 1) * 0.05;
    }
  });
  // Folhas de eucalipto: compridas, verde-azuladas, aos pares ao longo do caule.
  const folhas = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        y: 0.07 + i * 0.03,
        lado: i % 2 === 0 ? 1 : -1,
        giro: i * 1.3,
        tam: 0.075 - i * 0.005,
      })),
    [],
  );
  return (
    <group scale={s}>
      {/* vasinho de barro com terra */}
      <mesh position={[0, -0.055, 0]}>
        <cylinderGeometry args={[0.06, 0.045, 0.11, 16]} />
        <meshStandardMaterial color="#c2410c" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.0, 0]}>
        <cylinderGeometry args={[0.066, 0.066, 0.02, 16]} />
        <meshStandardMaterial color="#9a3412" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.006, 0]}>
        <cylinderGeometry args={[0.055, 0.055, 0.012, 16]} />
        <meshStandardMaterial color="#3f2a1d" roughness={1} />
      </mesh>
      <group ref={copa}>
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.005, 0.008, 0.29, 6]} />
          <meshStandardMaterial color="#7c4a2d" />
        </mesh>
        {folhas.map((f, i) => (
          <group key={i} position={[0, f.y, 0]} rotation-y={f.giro}>
            <mesh
              position={[f.lado * f.tam * 0.5, 0.01, 0]}
              rotation-z={f.lado * -0.5}
              scale={[f.tam * 0.5, 0.018, 0.01]}
            >
              <sphereGeometry args={[1, 8, 6]} />
              <meshStandardMaterial color={i % 3 === 0 ? "#6b9e7a" : "#4d8a63"} roughness={0.6} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/* ————————————————— Costas ————————————————— */

/** Mochila a jato: dois tanques com chamas que tremulam. */
function Jetpack({ m, quadrilY, topo, frente, costas }: ComCostas) {
  const chamas = useRef<(Group | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    chamas.current.forEach((g, i) => {
      if (!g) return;
      const f = 0.85 + 0.2 * Math.sin(t * 31 + i * 2.1) + 0.1 * Math.sin(t * 17 + i);
      g.scale.set(1 + 0.08 * Math.sin(t * 23 + i), f, 1 + 0.08 * Math.sin(t * 23 + i));
    });
  });
  const r = Math.min(0.075, m.troncoW * 0.14);
  const h = m.troncoH * 0.62;
  const cy = quadrilY + m.troncoH * 0.55;
  const z = costas - r - 0.03;
  const dx = r + 0.012;
  return (
    <group>
      {/* placa que prende no corpo */}
      <Bloco
        tam={[dx * 2 + 0.04, h * 0.8, 0.04]}
        pos={[0, cy, costas - 0.02]}
        cor="#475569"
        raio={0.015}
      />
      {[-1, 1].map((l, i) => (
        <group key={l} position={[dx * l, cy, z]}>
          <mesh>
            <cylinderGeometry args={[r, r, h, 20]} />
            <meshStandardMaterial color="#dc2626" metalness={0.35} roughness={0.35} />
          </mesh>
          {/* faixa e topo arredondado */}
          <mesh position={[0, h * 0.18, 0]}>
            <cylinderGeometry args={[r + 0.004, r + 0.004, 0.03, 20]} />
            <meshStandardMaterial color="#e2e8f0" metalness={0.6} roughness={0.25} />
          </mesh>
          <mesh position={[0, h / 2, 0]}>
            <sphereGeometry args={[r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#dc2626" metalness={0.35} roughness={0.35} />
          </mesh>
          {/* bocal */}
          <mesh position={[0, -h / 2 - 0.03, 0]}>
            <cylinderGeometry args={[r * 0.6, r * 0.85, 0.06, 16]} />
            <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.3} />
          </mesh>
          {/* chama: cone de fora laranja, de dentro amarelo; pivô no bocal */}
          <group
            position={[0, -h / 2 - 0.06, 0]}
            ref={(g) => {
              chamas.current[i] = g;
            }}
          >
            <mesh position={[0, -0.11, 0]} rotation-x={Math.PI}>
              <coneGeometry args={[r * 0.6, 0.22, 14]} />
              <meshBasicMaterial color="#f97316" transparent opacity={0.85} toneMapped={false} />
            </mesh>
            <mesh position={[0, -0.07, 0]} rotation-x={Math.PI}>
              <coneGeometry args={[r * 0.35, 0.14, 12]} />
              <meshBasicMaterial color="#fde047" toneMapped={false} />
            </mesh>
          </group>
        </group>
      ))}
      {/* alças na frente */}
      {[-1, 1].map((l) => (
        <mesh key={l} position={[m.troncoW * 0.25 * l, topo - 0.15, frente + 0.004]}>
          <boxGeometry args={[0.05, 0.28, 0.01]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Asas de anjo (penas brancas em leque) ou de fada (duas folhas translúcidas,
 * cores de borboleta). Batem devagar (anjo) ou rápido (fada).
 */
function Asas({ m, ombroY, costas, tipo }: ComCostas & { tipo: "anjo" | "fada" }) {
  const asas = useRef<(Group | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const bate = tipo === "anjo" ? 0.35 + 0.22 * Math.sin(t * 2.2) : 0.35 + 0.3 * Math.sin(t * 7);
    asas.current.forEach((g, i) => {
      if (g) g.rotation.y = (i === 0 ? -1 : 1) * bate;
    });
  });
  const tam = Math.max(0.85, Math.min(1.2, m.troncoW / 0.56));
  return (
    <group position={[0, ombroY - m.troncoH * 0.12, costas - 0.02]}>
      {[-1, 1].map((l, i) => (
        <group
          key={l}
          position={[0.05 * l, 0, 0]}
          ref={(g) => {
            asas.current[i] = g;
          }}
        >
          <group scale={tam}>{tipo === "anjo" ? <AsaDeAnjo l={l} /> : <AsaDeFada l={l} />}</group>
        </group>
      ))}
    </group>
  );
}

/**
 * Asa de anjo: o osso sobe para fora a partir do pivô (x cresce para fora no
 * lado `l`) e as penas penduram dele, abrindo em leque — as da ponta (rêmiges)
 * mais compridas; uma fileira de penas curtas (coberteiras) por cima.
 */
function AsaDeAnjo({ l }: { l: number }) {
  const osso = 0.5;
  const ang = 0.8;
  const n = 7;
  const penas = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return {
      x: l * osso * t * Math.cos(ang),
      y: osso * t * Math.sin(ang),
      giro: l * (0.05 + 0.8 * t),
      c: 0.28 + 0.22 * t,
    };
  });
  return (
    <group>
      <group rotation-z={l * ang}>
        <Bloco
          tam={[osso + 0.06, 0.075, 0.07]}
          pos={[(l * osso) / 2, 0, 0.005]}
          cor="#ffffff"
          raio={0.035}
        />
      </group>
      {penas.map((p, i) => (
        <group key={i} position={[p.x, p.y, 0]} rotation-z={p.giro}>
          <Bloco
            tam={[0.085, p.c, 0.025]}
            pos={[0, -p.c / 2 + 0.02, -0.015 - i * 0.002]}
            cor={i % 2 === 0 ? "#ffffff" : "#eef2f8"}
            raio={0.04}
            brilho={0.45}
          />
          <Bloco
            tam={[0.09, p.c * 0.45, 0.03]}
            pos={[0, -p.c * 0.2, 0.012]}
            cor="#f8fafc"
            raio={0.04}
            brilho={0.45}
          />
        </group>
      ))}
    </group>
  );
}

/** Duas folhas (de cima, maior; de baixo, menor), com borda e "olho" turquesa. */
function AsaDeFada({ l }: { l: number }) {
  const folhas = [
    { x: 0.22, y: 0.14, sx: 0.26, sy: 0.18, giro: 0.5, cor: "#e9d5ff", borda: "#c084fc" },
    { x: 0.15, y: -0.11, sx: 0.16, sy: 0.12, giro: -0.55, cor: "#fbcfe8", borda: "#f472b6" },
  ];
  return (
    <group>
      {folhas.map((f, i) => (
        <group key={i} position={[l * f.x, f.y, -0.005 * i]} rotation-z={l * f.giro}>
          <mesh scale={[f.sx + 0.015, f.sy + 0.015, 1]}>
            <circleGeometry args={[1, 28]} />
            <meshStandardMaterial color={f.borda} side={DoubleSide} transparent opacity={0.9} />
          </mesh>
          <mesh scale={[f.sx, f.sy, 1]} position={[0, 0, 0.002]}>
            <circleGeometry args={[1, 28]} />
            <meshStandardMaterial
              color={f.cor}
              emissive={f.cor}
              emissiveIntensity={0.45}
              side={DoubleSide}
              transparent
              opacity={0.6}
              depthWrite={false}
            />
          </mesh>
          <mesh scale={[f.sx * 0.35, f.sy * 0.35, 1]} position={[l * f.sx * 0.25, 0, 0.004]}>
            <circleGeometry args={[1, 20]} />
            <meshBasicMaterial color="#67e8f9" side={DoubleSide} transparent opacity={0.85} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * Capa de super-herói: gomos encadeados (cada um gira um pouco a mais),
 * ondulando como pano ao vento. Presa nos ombros por dois botões dourados.
 */
function Capa({ config, m, topo, frente, costas }: ComCostas) {
  const N = 7;
  const gomos = useRef<(Group | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    gomos.current.forEach((g, i) => {
      if (g)
        g.rotation.x =
          (i === 0 ? 0.12 : 0.045) + 0.05 * Math.sin(t * 2.6 - i * 0.7) * (i / N + 0.3);
    });
  });
  const comprimento = m.troncoH + m.pernaH * 0.6;
  const passo = comprimento / N;
  const cor = config.corChapeu;
  const forro = escurecer(cor, 0.25);
  // Encadeado: cada gomo é filho do anterior e começa na ponta dele.
  const montar = (i: number): ReactNode => {
    if (i >= N) return null;
    const w = m.troncoW + 0.05 + i * 0.025;
    return (
      <group
        position={[0, i === 0 ? 0 : -passo, 0]}
        ref={(g) => {
          gomos.current[i] = g;
        }}
      >
        <mesh position={[0, -passo / 2, 0]}>
          <boxGeometry args={[w, passo + 0.004, 0.018]} />
          <meshStandardMaterial color={cor} roughness={0.55} />
        </mesh>
        <mesh position={[0, -passo / 2, 0.0095]}>
          <boxGeometry args={[w - 0.02, passo + 0.004, 0.002]} />
          <meshStandardMaterial color={forro} roughness={0.7} />
        </mesh>
        {montar(i + 1)}
      </group>
    );
  };
  return (
    <group>
      <group position={[0, topo - 0.01, costas - 0.012]}>{montar(0)}</group>
      {/* gola que dobra por cima dos ombros */}
      <Bloco
        tam={[m.troncoW + 0.04, 0.03, Math.abs(costas) + frente]}
        pos={[0, topo + 0.012, (frente + costas) / 2]}
        cor={cor}
        raio={0.012}
      />
      {[-1, 1].map((l) => (
        <mesh
          key={l}
          position={[m.troncoW * 0.3 * l, topo - 0.03, frente + 0.01]}
          rotation-x={Math.PI / 2}
        >
          <cylinderGeometry args={[0.03, 0.03, 0.015, 16]} />
          <meshStandardMaterial color={OURO} metalness={0.7} roughness={0.25} />
        </mesh>
      ))}
    </group>
  );
}

/** Espada na bainha, na diagonal: o punho aparece por cima do ombro direito. */
function Espada({ m, quadrilY, topo, frente, costas }: ComCostas) {
  const s = Math.max(0.8, Math.min(1.15, m.troncoH / 0.6));
  const giro = 0.62;
  return (
    <group>
      <group position={[0, quadrilY + m.troncoH * 0.5, costas - 0.035]} rotation-z={giro} scale={s}>
        {/* bainha de couro com ponteira dourada */}
        <Bloco
          tam={[0.075, 0.66, 0.035]}
          pos={[0, -0.05, 0]}
          cor="#5b3a1e"
          raio={0.015}
          brilho={0.65}
        />
        <Bloco tam={[0.08, 0.06, 0.04]} pos={[0, -0.37, 0]} cor={OURO} raio={0.015} brilho={0.3} />
        <Bloco
          tam={[0.08, 0.035, 0.04]}
          pos={[0, 0.0, 0]}
          cor={OURO_ESCURO}
          raio={0.01}
          brilho={0.3}
        />
        {/* guarda, punho e pomo */}
        <Bloco tam={[0.24, 0.04, 0.05]} pos={[0, 0.3, 0]} cor={OURO} raio={0.015} brilho={0.3} />
        <mesh position={[0, 0.39, 0]}>
          <cylinderGeometry args={[0.022, 0.022, 0.14, 10]} />
          <meshStandardMaterial color="#1e3a8a" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.48, 0]}>
          <sphereGeometry args={[0.035, 14, 10]} />
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#0ea5e9"
            emissiveIntensity={0.5}
            metalness={0.3}
            roughness={0.15}
          />
        </mesh>
      </group>
      {/* boldrié: a correia que cruza o peito (do ombro direito ao quadril esquerdo) */}
      <Correia
        de={[-m.troncoW * 0.32, topo - 0.01]}
        ate={[m.troncoW * 0.4, quadrilY + 0.08]}
        z={frente + 0.006}
        cor="#5b3a1e"
      />
    </group>
  );
}

/** Uma correia reta no plano da frente (ou das costas), de `de` até `ate` (x, y). */
function Correia({
  de,
  ate,
  z,
  cor,
  largura = 0.045,
}: {
  de: [number, number];
  ate: [number, number];
  z: number;
  cor: string;
  largura?: number;
}) {
  const dx = ate[0] - de[0];
  const dy = ate[1] - de[1];
  const comp = Math.hypot(dx, dy);
  return (
    <mesh
      position={[(de[0] + ate[0]) / 2, (de[1] + ate[1]) / 2, z]}
      rotation-z={Math.atan2(dy, dx)}
    >
      <boxGeometry args={[comp, largura, 0.01]} />
      <meshStandardMaterial color={cor} roughness={0.7} />
    </mesh>
  );
}

/** Violão nas costas: o braço sobe por trás do ombro esquerdo; correia na frente. */
function Violao({ m, quadrilY, topo, frente, costas }: ComCostas) {
  const s = Math.max(0.8, Math.min(1.15, m.troncoH / 0.6));
  const madeira = "#c8803e";
  const fundo = 0.09;
  const z = costas - fundo / 2 - 0.005;
  return (
    <group>
      <group position={[0, quadrilY + m.troncoH * 0.42, z]} rotation-z={-0.5} scale={s}>
        {/* corpo em 8: bojo de baixo e de cima (cilindros de frente para −z) */}
        {[
          { y: -0.08, r: 0.17 },
          { y: 0.13, r: 0.13 },
        ].map((b) => (
          <mesh key={b.y} position={[0, b.y, 0]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[b.r, b.r, fundo, 32]} />
            <meshStandardMaterial color={madeira} roughness={0.45} />
          </mesh>
        ))}
        {/* tampo (o lado de fora, −z), boca e cavalete */}
        <mesh position={[0, -0.08, -fundo / 2 - 0.001]} rotation-y={Math.PI}>
          <circleGeometry args={[0.165, 32]} />
          <meshStandardMaterial color="#e9b672" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.13, -fundo / 2 - 0.001]} rotation-y={Math.PI}>
          <circleGeometry args={[0.125, 32]} />
          <meshStandardMaterial color="#e9b672" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.04, -fundo / 2 - 0.003]} rotation-y={Math.PI}>
          <circleGeometry args={[0.05, 24]} />
          <meshBasicMaterial color="#1c1009" />
        </mesh>
        <mesh position={[0, -0.14, -fundo / 2 - 0.006]}>
          <boxGeometry args={[0.11, 0.025, 0.012]} />
          <meshStandardMaterial color="#3b2412" />
        </mesh>
        {/* braço, mão (cabeça) e cordas */}
        <mesh position={[0, 0.43, -0.02]}>
          <boxGeometry args={[0.055, 0.4, 0.035]} />
          <meshStandardMaterial color="#5b3a1e" roughness={0.5} />
        </mesh>
        <Bloco tam={[0.085, 0.11, 0.035]} pos={[0, 0.68, -0.02]} cor="#3b2412" raio={0.012} />
        {[-0.018, -0.006, 0.006, 0.018].map((x) => (
          <mesh key={x} position={[x, 0.27, -fundo / 2 - 0.01]}>
            <boxGeometry args={[0.002, 0.8, 0.002]} />
            <meshStandardMaterial color="#e5e7eb" metalness={0.8} roughness={0.2} />
          </mesh>
        ))}
      </group>
      <Correia
        de={[m.troncoW * 0.32, topo - 0.01]}
        ate={[-m.troncoW * 0.4, quadrilY + 0.1]}
        z={frente + 0.006}
        cor="#7c4a2d"
        largura={0.05}
      />
    </group>
  );
}

/** Cachecol listrado (cor do chapéu + faixas claras), com a ponta caindo na frente. */
function Cachecol({ config, m, topo, frente, costas }: ComCostas) {
  const ponta = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (ponta.current) ponta.current.rotation.z = -0.12 + Math.sin(clock.elapsedTime * 1.8) * 0.04;
  });
  const cor = config.corChapeu;
  const listra = clarear(cor, 0.55);
  const r = 0.135;
  const tubo = 0.048;
  // Alarga na frente e atrás até cobrir a gola do casaco (corpo fundo, painéis).
  const sz = Math.max(1, (Math.max(frente, -costas) + 0.02) / (r + tubo));
  const comp = Math.min(0.32, m.troncoH * 0.5);
  return (
    <group>
      <mesh position={[0, topo + 0.01, 0]} rotation-x={Math.PI / 2} scale={[1, sz, 0.8]}>
        <torusGeometry args={[r, tubo, 12, 32]} />
        <meshStandardMaterial color={cor} roughness={0.9} />
      </mesh>
      <group ref={ponta} position={[-0.075, topo - 0.01, frente + 0.03]}>
        <Bloco
          tam={[0.1, comp, 0.035]}
          pos={[0, -comp / 2, 0]}
          cor={cor}
          raio={0.015}
          brilho={0.9}
        />
        {[0.3, 0.55, 0.8].map((f) => (
          <mesh key={f} position={[0, -comp * f, 0.0185]}>
            <boxGeometry args={[0.1, 0.025, 0.002]} />
            <meshStandardMaterial color={listra} roughness={0.9} />
          </mesh>
        ))}
        {/* franja */}
        {[-0.036, -0.012, 0.012, 0.036].map((x) => (
          <mesh key={x} position={[x, -comp - 0.02, 0]}>
            <boxGeometry args={[0.012, 0.04, 0.012]} />
            <meshStandardMaterial color={listra} roughness={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Gravata-borboleta na gola (cor do chapéu). */
function GravataBorboleta({ config, topo, frente }: PropsAcessorio) {
  const cor = config.corChapeu;
  return (
    <group position={[0, topo - 0.055, frente + 0.018]}>
      {[-1, 1].map((l) => (
        <mesh key={l} position={[0.058 * l, 0, 0]} rotation={[Math.PI / 2, 0, (l * Math.PI) / 2]}>
          {/* prisma de 3 lados: a ponta encosta no nó */}
          <cylinderGeometry args={[0.065, 0.065, 0.035, 3]} />
          <meshStandardMaterial color={cor} roughness={0.5} />
        </mesh>
      ))}
      <Bloco tam={[0.035, 0.04, 0.035]} pos={[0, 0, 0.004]} cor={escurecer(cor, 0.2)} raio={0.01} />
    </group>
  );
}

/** Corrente de ouro grossa (elos alternados) com medalhão de folha. */
function Corrente({ m, topo, frente }: PropsAcessorio) {
  const elos = useMemo(() => {
    const n = 17;
    const largura = Math.min(0.15, m.troncoW * 0.27);
    const queda = Math.min(0.2, m.troncoH * 0.33);
    return Array.from({ length: n }, (_, i) => {
      const s = -1 + (2 * i) / (n - 1);
      return {
        x: s * largura,
        y: topo - 0.015 - queda * (1 - s * s),
        giro: Math.atan2(2 * queda * s, largura),
        par: i % 2 === 0,
      };
    });
  }, [m, topo]);
  const fundo = elos[(elos.length - 1) / 2]!;
  return (
    <group>
      {elos.map((e, i) => (
        <mesh
          key={i}
          position={[e.x, e.y, frente + 0.012]}
          rotation={[e.par ? 0 : Math.PI / 2, 0, e.giro + Math.PI / 2]}
          scale={[1, 1.4, 1]}
        >
          <torusGeometry args={[0.013, 0.005, 8, 16]} />
          <meshStandardMaterial color={OURO} metalness={0.85} roughness={0.2} />
        </mesh>
      ))}
      <group position={[0, fundo.y - 0.055, frente + 0.014]}>
        <mesh rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.05, 0.05, 0.014, 28]} />
          <meshStandardMaterial color={OURO} metalness={0.85} roughness={0.18} />
        </mesh>
        <mesh position={[0, 0, 0.008]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.038, 0.038, 0.004, 28]} />
          <meshStandardMaterial color={OURO_ESCURO} metalness={0.8} roughness={0.3} />
        </mesh>
        {/* folha de eucalipto em relevo */}
        <mesh position={[0, 0, 0.012]} rotation-z={0.6} scale={[0.013, 0.03, 0.004]}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial
            color="#16a34a"
            emissive="#15803d"
            emissiveIntensity={0.3}
            metalness={0.3}
            roughness={0.25}
          />
        </mesh>
      </group>
    </group>
  );
}

/** Bolsa transversal: alça do ombro esquerdo ao quadril direito, bolsa de couro com fivela. */
function Bolsa({ m, topo, frente, costas, quadrilY }: ComCostas) {
  const bx = -m.troncoW * 0.26;
  const by = quadrilY + 0.06;
  const couro = "#8b5a2b";
  return (
    <group>
      <Correia
        de={[m.troncoW * 0.34, topo - 0.005]}
        ate={[bx, by + 0.08]}
        z={frente + 0.006}
        cor={escurecer(couro, 0.2)}
      />
      <Correia
        de={[m.troncoW * 0.34, topo - 0.005]}
        ate={[-m.troncoW * 0.45, by + 0.04]}
        z={costas - 0.006}
        cor={escurecer(couro, 0.2)}
      />
      <group position={[bx, by, frente + 0.05]}>
        <Bloco tam={[0.22, 0.17, 0.08]} cor={couro} raio={0.025} brilho={0.65} />
        {/* aba e fivela */}
        <Bloco
          tam={[0.225, 0.09, 0.012]}
          pos={[0, 0.045, 0.041]}
          cor={escurecer(couro, 0.15)}
          raio={0.006}
          brilho={0.65}
        />
        <Bloco
          tam={[0.04, 0.03, 0.01]}
          pos={[0, 0.005, 0.05]}
          cor={OURO}
          raio={0.004}
          brilho={0.3}
        />
      </group>
    </group>
  );
}

/** Rádio comunicador (HT) preso no peito direito: antena e LED piscando. */
function Radio({ m, topo, frente }: PropsAcessorio) {
  const led = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (led.current) led.current.visible = Math.floor(clock.elapsedTime * 2) % 3 !== 0;
  });
  const x = -m.troncoW * 0.24;
  const y = topo - Math.min(0.2, m.troncoH * 0.34);
  return (
    <group position={[x, y, frente + 0.03]} scale={1.25}>
      {/* alça/clipe que segura no colete */}
      <mesh position={[0, 0.03, -0.022]}>
        <boxGeometry args={[0.05, 0.13, 0.008]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
      <Bloco tam={[0.085, 0.15, 0.045]} cor="#475569" raio={0.014} brilho={0.5} />
      {/* faixa laranja de campo, alto-falante e visor */}
      <mesh position={[0, 0.045, 0.0235]}>
        <boxGeometry args={[0.07, 0.035, 0.002]} />
        <meshStandardMaterial color="#f59e0b" />
      </mesh>
      {[-0.012, -0.024, -0.036, -0.048].map((yy) => (
        <mesh key={yy} position={[0, yy, 0.0235]}>
          <boxGeometry args={[0.055, 0.005, 0.002]} />
          <meshStandardMaterial color="#4b5563" />
        </mesh>
      ))}
      {/* antena e botão */}
      <mesh position={[0.022, 0.15, 0]}>
        <cylinderGeometry args={[0.008, 0.011, 0.15, 8]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
      <mesh position={[-0.02, 0.085, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.02, 10]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      <mesh ref={led} position={[-0.026, 0.045, 0.025]}>
        <sphereGeometry args={[0.006, 8, 6]} />
        <meshBasicMaterial color="#22c55e" toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ————————————————— Ombro e pulso ————————————————— */

/** Papagaio no ombro DIREITO (o esquerdo acena): mexe a cabeça e o rabo. */
function Papagaio({ m, topo }: PropsAcessorio) {
  const cabeca = useRef<Group>(null);
  const rabo = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (cabeca.current) {
      // olha em volta aos saltos (passarinho), com um aceno de cabeça de vez em quando
      cabeca.current.rotation.y =
        0.5 * Math.sign(Math.sin(t * 0.9)) * Math.min(1, Math.abs(Math.sin(t * 0.9)) * 6);
      cabeca.current.rotation.x = Math.max(0, Math.sin(t * 2.3)) * 0.25;
    }
    if (rabo.current) rabo.current.rotation.x = 0.5 + Math.sin(t * 1.6) * 0.06;
  });
  const x = -(m.troncoW / 2 + m.bracoW * 0.3);
  return (
    <group position={[x, topo, 0]} rotation-y={0.35}>
      {/* pés */}
      {[-1, 1].map((l) => (
        <mesh key={l} position={[0.02 * l, 0.01, 0.01]}>
          <boxGeometry args={[0.015, 0.02, 0.04]} />
          <meshStandardMaterial color="#6b7280" />
        </mesh>
      ))}
      {/* corpo e asas */}
      <mesh position={[0, 0.09, 0]} scale={[0.065, 0.09, 0.07]}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#16a34a" roughness={0.6} />
      </mesh>
      {[-1, 1].map((l) => (
        <mesh
          key={l}
          position={[0.055 * l, 0.085, -0.01]}
          rotation-z={-0.15 * l}
          scale={[0.02, 0.07, 0.055]}
        >
          <sphereGeometry args={[1, 12, 10]} />
          <meshStandardMaterial color="#2563eb" roughness={0.6} />
        </mesh>
      ))}
      <group ref={rabo} position={[0, 0.04, -0.05]}>
        {[
          { x: -0.012, cor: "#dc2626" },
          { x: 0.012, cor: "#2563eb" },
        ].map((p) => (
          <mesh key={p.x} position={[p.x, -0.07, 0]}>
            <boxGeometry args={[0.022, 0.15, 0.008]} />
            <meshStandardMaterial color={p.cor} />
          </mesh>
        ))}
      </group>
      {/* cabeça: amarela com bico curvo e olhos */}
      <group ref={cabeca} position={[0, 0.19, 0.005]}>
        <mesh>
          <sphereGeometry args={[0.052, 16, 12]} />
          <meshStandardMaterial color="#facc15" roughness={0.6} />
        </mesh>
        <mesh position={[0, -0.006, 0.05]} rotation-x={Math.PI / 2 + 0.5}>
          <coneGeometry args={[0.02, 0.05, 10]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
        {[-1, 1].map((l) => (
          <group key={l} position={[0.035 * l, 0.012, 0.032]}>
            <mesh>
              <sphereGeometry args={[0.014, 10, 8]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
            <mesh position={[0, 0, 0.01]}>
              <sphereGeometry args={[0.007, 8, 6]} />
              <meshBasicMaterial color="#111827" />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();
const _cima = new Vector3(0, 1, 0);

/** Balão (cor do chapéu) amarrado no pulso direito: flutua, balança e o barbante acompanha. */
function Balao({ config, m, ombroY, sentado, topo }: PropsAcessorio) {
  const balao = useRef<Group>(null);
  const fio = useRef<Mesh>(null);
  const mao = pulsoDireito(m, ombroY, sentado);
  const alto = topo + 0.03 + m.cabeca + (sentado ? 0.2 : 0.08);
  // Sentado, mais para fora e para trás: não tapa o rosto de quem está ao lado.
  const fora = sentado ? 0.42 : 0.3;
  const atras = sentado ? -0.35 : -0.02;
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const bx = mao.x - fora + Math.sin(t * 0.8) * 0.05;
    const by = alto + Math.sin(t * 1.3) * 0.04;
    const bz = mao.z + atras + Math.sin(t * 0.6 + 1) * 0.04;
    if (balao.current) {
      balao.current.position.set(bx, by, bz);
      balao.current.rotation.z = Math.sin(t * 0.8) * 0.12;
    }
    if (fio.current) {
      // do pulso até o nó (embaixo do balão)
      _a.set(mao.x - m.bracoW / 2 - 0.012, mao.y, mao.z);
      _b.set(bx, by - 0.2, bz);
      const comp = _a.distanceTo(_b);
      fio.current.position.copy(_a).add(_b).multiplyScalar(0.5);
      _q.setFromUnitVectors(_cima, _b.sub(_a).normalize());
      fio.current.quaternion.copy(_q);
      fio.current.scale.set(1, comp, 1);
    }
  });
  const cor = config.corChapeu;
  return (
    <group>
      <mesh ref={fio}>
        <cylinderGeometry args={[0.003, 0.003, 1, 5]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      {/* nó no pulso, do lado de fora do braço */}
      <mesh position={[mao.x - m.bracoW / 2 - 0.012, mao.y, mao.z]}>
        <sphereGeometry args={[0.018, 10, 8]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <group ref={balao} position={[mao.x - fora, alto, mao.z + atras]}>
        <mesh scale={[0.16, 0.19, 0.16]}>
          <sphereGeometry args={[1, 24, 18]} />
          <meshStandardMaterial
            color={cor}
            roughness={0.2}
            metalness={0.05}
            emissive={cor}
            emissiveIntensity={0.08}
          />
        </mesh>
        {/* brilho */}
        <mesh position={[-0.06, 0.08, 0.12]} scale={[0.025, 0.04, 0.01]}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.7} />
        </mesh>
        <mesh position={[0, -0.195, 0]}>
          <coneGeometry args={[0.02, 0.025, 10]} />
          <meshStandardMaterial color={escurecer(cor, 0.2)} />
        </mesh>
      </group>
    </group>
  );
}
