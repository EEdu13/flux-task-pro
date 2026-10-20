/*
 * As pessoas no andar (18/10/2026). Duas versões de cada uma:
 *   - PERTO (a sala em foco): o avatar de verdade — sentado digitando, ou de
 *     pé no refeitório com a caneca — e o nome por cima;
 *   - LONGE (a visão do andar inteiro): um "peão" de três peças nas cores da
 *     pessoa (pele, camisa, cabelo). Um andar com 40 avatares completos
 *     pesaria demais; o peão custa três malhas.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { Group } from "three";
import { Avatar3D } from "@/components/rv/avatar-3d";
import { MEDIDAS } from "@/components/rv/medidas";
import { maoNoGesto } from "@/components/rv/poses-de-reacao";
import { AvatarNaCadeira, type MedidaDoAvatar } from "@/components/rv/sala/avatar-na-cadeira";
import type { Lugar } from "@/components/rv/sala/lugares";
import type { AvatarConfig } from "@/lib/avatar-3d";
import { BolinhaDeSituacao, Caneca, COR_DA_SITUACAO, PapeisVoando, type Situacao } from "./moveis";

const LUGAR_NA_ORIGEM: Lugar = { x: 0, z: 0, rotY: 0, nx: 0, nz: 1, graus: 0 };

export const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

/** Status no chip: curto, para o chip não virar faixa por cima da sala. */
const MAX_STATUS_NO_CHIP = 22;

/**
 * O chip com o nome, por cima da cabeça (cresce e diminui com o zoom).
 *
 * (19/10/2026) Leva também o status personalizado ("· 🚜 Em campo") — no MESMO
 * `<Html>`, e não num segundo: cada `<Html>` do drei é um elemento do DOM
 * reposicionado a cada quadro, e um a mais por pessoa pesaria no andar.
 */
export function NomeFlutuante({
  nome,
  situacao,
  altura,
  prefixo = "",
  status,
}: {
  nome: string;
  situacao: Situacao;
  altura: number;
  prefixo?: string;
  status?: { emoji: string; texto: string };
}) {
  const texto =
    status && status.texto.length > MAX_STATUS_NO_CHIP
      ? `${status.texto.slice(0, MAX_STATUS_NO_CHIP - 1)}…`
      : status?.texto;
  return (
    <Html position={[0, altura, 0]} center distanceFactor={7} zIndexRange={[15, 0]}>
      <div className="pointer-events-none flex select-none items-center gap-1 whitespace-nowrap rounded-full bg-black/70 px-2.5 py-0.5 text-[13px] font-semibold text-white shadow">
        <span className="h-2 w-2 rounded-full" style={{ background: COR_DA_SITUACAO[situacao] }} />
        {prefixo}
        {primeiroNome(nome)}
        {status && (
          <span className="font-medium text-white/85">
            · {status.emoji} {texto}
          </span>
        )}
      </div>
    </Html>
  );
}

/**
 * Sentado digitando: o corpo balança no ritmo do teclado (o braço do boneco é
 * uma peça só — o movimento vem do corpo e da cabeça). Ocupado digita rápido,
 * com papéis voando, 💦 e a bolinha vermelha pulsando.
 */
export function Trabalhando({
  id,
  nome,
  config,
  ocupado,
  elevacao,
  aoMedir,
  gestor,
  status,
}: {
  id: string;
  nome: string;
  config: AvatarConfig;
  ocupado: boolean;
  elevacao: number;
  aoMedir: (id: string, m: MedidaDoAvatar) => void;
  gestor: boolean;
  status?: { emoji: string; texto: string };
}) {
  const ritmo = useRef<Group>(null);
  const fase = useMemo(() => Math.random() * 10, []);
  useFrame(({ clock }) => {
    const g = ritmo.current;
    if (!g) return;
    const t = clock.elapsedTime + fase;
    const v = ocupado ? 14 : 6;
    g.position.y = Math.abs(Math.sin(t * v)) * (ocupado ? 0.012 : 0.006);
    g.rotation.x = 0.03 + Math.sin(t * v * 0.5) * (ocupado ? 0.02 : 0.008);
    g.rotation.y = ocupado ? Math.sin(t * 1.7) * 0.12 : Math.sin(t * 0.4) * 0.05;
  });
  const m = MEDIDAS[config.corpo];
  const topo = 0.52 + m.troncoH + 0.03 + m.cabeca + elevacao;
  return (
    <group>
      <group ref={ritmo}>
        <AvatarNaCadeira
          id={id}
          config={config}
          nome={nome}
          falando={false}
          lugar={LUGAR_NA_ORIGEM}
          saindo={false}
          eu={false}
          elevacao={elevacao}
          aoMedir={aoMedir}
        />
      </group>
      <NomeFlutuante
        nome={nome}
        situacao={ocupado ? "ocupado" : "disponivel"}
        altura={topo + 0.42}
        status={status}
      />
      {ocupado && <BolinhaDeSituacao situacao="ocupado" altura={topo + 0.22} />}
      {ocupado && <PapeisVoando altura={topo + 0.05} />}
      {ocupado && (
        <Html position={[0.32, topo + 0.05, 0.1]} center distanceFactor={7} zIndexRange={[10, 0]}>
          <span className="pointer-events-none select-none text-3xl drop-shadow">💦</span>
        </Html>
      )}
    </group>
  );
}

/** De pé no refeitório, com a caneca na mão e o nome por cima. */
export function NoRefeitorio({
  nome,
  config,
  status,
  sentado = false,
  naMesa = "caneca",
}: {
  nome: string;
  config: AvatarConfig;
  status?: { emoji: string; texto: string };
  /** Sentado no banco da mesa comprida (19/10/2026), conversando. */
  sentado?: boolean;
  naMesa?: "caneca" | "prato";
}) {
  const m = MEDIDAS[config.corpo];
  // O instante do gesto do café em que a xícara está na frente do peito.
  const INSTANTE = 1.0;
  const mao = useMemo(() => maoNoGesto("cafe", INSTANTE, m, 1), [m]);
  const topo = sentado
    ? 0.52 + m.troncoH + 0.03 + m.cabeca
    : m.pernaH + m.troncoH + 0.03 + m.cabeca;
  /* Conversando: a boca abre e fecha por uns segundos e para, em turnos — cada
     um com o seu ritmo (a fase sai do nome), para a mesa não falar em coro. */
  const [falando, setFalando] = useState(false);
  useEffect(() => {
    if (!sentado) return;
    const fase = [...nome].reduce((n, c) => n + c.charCodeAt(0), 0) % 7;
    let ligado = false;
    const id = window.setInterval(
      () => {
        ligado = !ligado;
        setFalando(ligado);
      },
      (2.2 + fase * 0.45) * 1000,
    );
    return () => window.clearInterval(id);
  }, [sentado, nome]);
  return (
    <group>
      {sentado ? (
        <>
          <Avatar3D config={config} mostrarNome={false} pose="sentado" falando={falando} semAnel />
          {naMesa === "prato" ? (
            <group position={[0.05, 0.765, 0.42]}>
              <mesh>
                <cylinderGeometry args={[0.11, 0.09, 0.015, 20]} />
                <meshStandardMaterial color="#fafafa" roughness={0.3} />
              </mesh>
              <mesh position={[0, 0.03, 0]}>
                <boxGeometry args={[0.12, 0.045, 0.08]} />
                <meshStandardMaterial color="#d6a35c" roughness={0.7} />
              </mesh>
            </group>
          ) : (
            <Caneca pos={[0.12, 0.765, 0.4]} cor="#f5f5f4" />
          )}
        </>
      ) : (
        <>
          <Avatar3D
            config={config}
            mostrarNome={false}
            pose="em-pe"
            gesto="cafe"
            gestoTempo={INSTANTE}
            expressaoForcada="tranquilo"
          />
          <Caneca pos={[mao[0], mao[1] - 0.06, mao[2] + 0.02]} cor="#f5f5f4" />
        </>
      )}
      <NomeFlutuante
        nome={nome}
        situacao="ausente"
        altura={topo + 0.3}
        prefixo={status ? "" : "☕ "}
        status={status}
      />
    </group>
  );
}

/**
 * O peão da visão de longe: corpo na cor da camisa, cabeça na cor da pele e
 * o "cabelo" por cima. Sentado ou de pé; uma bolinha da situação em cima.
 */
export function Peao({
  config,
  sentado,
  situacao,
}: {
  config: AvatarConfig;
  sentado: boolean;
  situacao: Situacao;
}) {
  const base = sentado ? 0.5 : 0.85;
  return (
    <group>
      <mesh position={[0, base + 0.25, 0]} castShadow>
        <boxGeometry args={[0.42, 0.5, 0.26]} />
        <meshStandardMaterial color={config.corRoupa} roughness={0.7} />
      </mesh>
      {!sentado && (
        <mesh position={[0, 0.42, 0]} castShadow>
          <boxGeometry args={[0.36, 0.84, 0.22]} />
          <meshStandardMaterial color={config.corCalca} roughness={0.8} />
        </mesh>
      )}
      <mesh position={[0, base + 0.72, 0]} castShadow>
        <boxGeometry args={[0.36, 0.36, 0.33]} />
        <meshStandardMaterial color={config.pele} roughness={0.6} />
      </mesh>
      <mesh position={[0, base + 0.92, -0.02]}>
        <boxGeometry args={[0.38, 0.08, 0.36]} />
        <meshStandardMaterial color={config.corCabelo} roughness={0.8} />
      </mesh>
      <mesh position={[0, base + 1.25, 0]}>
        <sphereGeometry args={[0.1, 12, 10]} />
        <meshBasicMaterial color={COR_DA_SITUACAO[situacao]} toneMapped={false} />
      </mesh>
    </group>
  );
}
