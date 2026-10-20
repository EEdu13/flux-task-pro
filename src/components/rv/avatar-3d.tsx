import { useContext, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Euler, Quaternion, Vector3, type Group, type MeshBasicMaterial } from "three";
import type { AvatarConfig } from "@/lib/avatar-3d";
import { Bloco } from "@/components/rv/bloco";
import { Barba3D, COBRE_O_ALTO, Cabelo, Chapeu } from "@/components/rv/cabeca-3d";
import { ContextoDoAvatar, QualidadeDoAvatar } from "@/components/rv/contexto-avatar";
import { MEDIDAS, type Medidas } from "@/components/rv/medidas";
import { desenharRosto, escurecer, type RostoDeReacao } from "@/components/rv/avatar-texturas";
import { CorpoVestido, type BracoSolto } from "@/components/rv/roupa/corpo-vestido";
import { comprimentoDaManga } from "@/components/rv/roupa/peca";
import { MANGA_DE, TEM_PAINEL } from "@/components/rv/roupa/pecas-cima";
import { ACESSORIOS_EXTRAS, AcessorioExtra } from "@/components/rv/acessorios-extras";
import {
  BRACOS_DO_GESTO,
  poseDaReacao,
  type Gesto,
  type Lado,
  type PoseDeReacao,
} from "@/components/rv/poses-de-reacao";

/**
 * O avatar estilo blocos (tipo Roblox): corpo em blocos de canto arredondado
 * e o rosto desenhado num adesivo (ver `avatar-texturas.ts`). A roupa é
 * pintada num atlas por peça, como o molde de Shirt/Pants do Roblox (ver
 * `roupa/`): o corpo vestido são ~4 malhas, uma por material.
 *
 * `pose`: em pé (o provador) ou sentado (a mesa). Origem no chão, de frente
 * para +z. Ao falar, o adesivo alterna entre a boca fechada e a aberta.
 *
 * `acenar` (16/10/2026, tela Início): um pulinho e um tchauzinho — ver
 * `poseDoAceno`. Desligado (padrão), o boneco é exatamente o de sempre.
 * `acenarChave`: mudar o número recomeça a sequência na hora.
 *
 * `gesto` (17/10/2026, reações do avatar): "acenar" (o mesmo que `acenar`),
 * "beijo" ou "bravo" — ver `poses-de-reacao.ts`. Só em pé. `gestoTempo`
 * congela a sequência num instante (movimento reduzido, pré-visualização).
 * `expressaoForcada` troca o rosto só aqui, sem tocar na `config` salva.
 */
export function Avatar3D({
  config,
  nome,
  falando = false,
  mostrarNome = true,
  pose = "sentado",
  acenar = false,
  acenarChave,
  gesto,
  gestoTempo,
  expressaoForcada,
  semAnel = false,
}: {
  config: AvatarConfig;
  nome?: string;
  falando?: boolean;
  mostrarNome?: boolean;
  pose?: "sentado" | "em-pe";
  acenar?: boolean;
  acenarChave?: number;
  gesto?: Gesto;
  gestoTempo?: number;
  expressaoForcada?: RostoDeReacao;
  /** Sem o anel verde de "falando" no chão (a conversa no refeitório, 19/10/2026). */
  semAnel?: boolean;
}) {
  const m = MEDIDAS[config.corpo];
  const sentado = pose === "sentado";
  const quadrilY = sentado ? 0.52 : m.pernaH;
  const ombroY = quadrilY + m.troncoH - 0.06;
  const cabecaY = quadrilY + m.troncoH + 0.03 + m.cabeca / 2;

  const cabeca = useRef<Group>(null);
  const rosto = useRef<MeshBasicMaterial>(null);
  const anel = useRef<{ opacity: number }>(null);
  const semente = useRef(Math.random() * 10);
  const corpo = useRef<Group>(null);
  const braco = useRef<Group>(null);
  /** O braço direito, solto só nos gestos que usam os dois (bravo). */
  const bracoDireito = useRef<Group>(null);
  /** Início da sequência do gesto (relógio do R3F); −1 = começa no próximo frame. */
  const inicioAceno = useRef(-1);
  /**
   * Tempo da reação, somado quadro a quadro com o passo limitado a 50 ms: o
   * primeiro quadro de um <Canvas> novo demora (shader, pintura da roupa) e,
   * medido pelo relógio, o gesto já começaria pela metade.
   */
  const tempoDaReacao = useRef(0);
  const mexido = useRef(false);
  const gestoAtivo: Gesto | undefined = gesto ?? (acenar ? "acenar" : undefined);
  const lados = gestoAtivo ? BRACOS_DO_GESTO[gestoAtivo] : null;
  /* O que vai na mão direita não acompanha o braço solto: o relógio passa
     para dentro do grupo do braço; prancheta, muda e balão saem de cena. */
  const maoDireitaSolta = !!lados?.includes(-1);
  const relogioNoBraco = maoDireitaSolta && config.acessorio === "relogio";
  const bracos = useMemo<BracoSolto[] | undefined>(
    () =>
      lados?.map((lado) => ({
        lado,
        ref: lado === LADO_DO_ACENO ? braco : bracoDireito,
        filhos:
          lado === -1 && relogioNoBraco ? <PulseiraDoRelogio config={config} m={m} /> : undefined,
      })),
    // a pulseira só muda com a roupa (manga) e o corpo
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lados, relogioNoBraco, config.roupa, m],
  );
  useEffect(() => {
    inicioAceno.current = -1;
    tempoDaReacao.current = 0;
  }, [gestoAtivo, acenarChave]);

  const [rostoFechado, rostoAberto] = useMemo(
    () => [
      desenharRosto(config, false, expressaoForcada),
      desenharRosto(config, true, expressaoForcada),
    ],
    [config, expressaoForcada],
  );
  // Um descarte por textura: descartar todas juntas quando só uma muda
  // apagava texturas que o material ainda usava.
  useEffect(() => () => rostoFechado?.dispose(), [rostoFechado]);
  useEffect(() => () => rostoAberto?.dispose(), [rostoAberto]);

  useFrame(({ clock }, passo) => {
    const t = clock.elapsedTime + semente.current;
    // Reação (beijo, bravo): a pose do instante, aplicada no corpo, na cabeça e nos braços.
    let reacao: PoseDeReacao | null = null;
    if (gestoAtivo && gestoAtivo !== "acenar") {
      tempoDaReacao.current += Math.min(passo, 0.05);
      reacao = poseDaReacao(gestoAtivo, gestoTempo ?? tempoDaReacao.current, m);
    }
    if (cabeca.current) {
      cabeca.current.position.y = cabecaY + Math.sin(t * 1.6) * 0.005;
      cabeca.current.rotation.y = Math.sin(t * 0.35) * 0.15;
      cabeca.current.rotation.z = Math.sin(t * 0.5) * 0.03;
      if (reacao) {
        cabeca.current.rotation.x = reacao.cabeca[0];
        cabeca.current.rotation.y = reacao.cabeca[1] + Math.sin(t * 0.35) * 0.04;
        cabeca.current.rotation.z += reacao.cabeca[2];
      }
    }
    if (rosto.current && rostoFechado && rostoAberto) {
      const alvo = falando && Math.floor(t * 8) % 2 === 0 ? rostoAberto : rostoFechado;
      if (rosto.current.map !== alvo) {
        rosto.current.map = alvo;
        rosto.current.needsUpdate = true;
      }
    }
    if (anel.current) anel.current.opacity += ((falando ? 0.85 : 0) - anel.current.opacity) * 0.15;
    if (reacao && corpo.current) {
      corpo.current.position.y = reacao.y;
      corpo.current.scale.set(reacao.largo, reacao.alto, reacao.largo);
      corpo.current.rotation.set(reacao.inclina, 0, reacao.balanco);
      apontarBraco(braco.current, 1, reacao.bracos[1]);
      apontarBraco(bracoDireito.current, -1, reacao.bracos[-1]);
      mexido.current = true;
    } else if (gestoAtivo === "acenar" && corpo.current) {
      if (inicioAceno.current < 0) inicioAceno.current = clock.elapsedTime;
      const p = poseDoAceno((clock.elapsedTime - inicioAceno.current) % PERIODO_DO_ACENO);
      corpo.current.position.y = p.y;
      corpo.current.scale.set(p.largo, p.alto, p.largo);
      if (braco.current) {
        braco.current.rotation.set(p.bracoX, 0, p.bracoZ * LADO_DO_ACENO);
      }
      mexido.current = true;
    } else if (mexido.current && corpo.current) {
      corpo.current.position.y = 0;
      corpo.current.scale.set(1, 1, 1);
      corpo.current.rotation.set(0, 0, 0);
      mexido.current = false;
    }
  });

  const pele = config.pele;
  // Casacos têm painéis por cima do tronco: colar e crachá vão para fora deles (R5).
  const frente = m.troncoD / 2 + (TEM_PAINEL.has(config.roupa) ? 0.039 : 0.006);
  const topo = quadrilY + m.troncoH;

  // Cabelo e roupa leem a config, a pose e a qualidade daqui, sem descer
  // props por toda a árvore (contrato fixo em `contexto-avatar.ts`).
  const qualidade = useContext(QualidadeDoAvatar);
  const ctxAvatar = useMemo(() => ({ config, pose, qualidade }), [config, pose, qualidade]);

  return (
    <ContextoDoAvatar.Provider value={ctxAvatar}>
      <group ref={corpo}>
        {!semAnel && (
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, sentado ? 0.2 : 0]}>
            <ringGeometry args={[0.45, 0.58, 48]} />
            <meshBasicMaterial ref={anel as never} color="#4ade80" transparent opacity={0} />
          </mesh>
        )}

        {/* ——— Corpo vestido (pernas, tronco, braços, calçado): 4 malhas ———
          A key muda quando a ESTRUTURA muda (peça ou pose): reaproveitar o
          fiber de outra estrutura quebra o R3F em modo dev (data-tsd-source). */}
        <CorpoVestido
          key={`${config.roupa}|${config.calca}|${config.sapato}|${pose}${lados ? `|bracos:${lados.join(",")}` : ""}`}
          config={config}
          m={m}
          pose={pose}
          quadrilY={quadrilY}
          ombroY={ombroY}
          topo={topo}
          bracos={bracos}
        />

        <Acessorio
          key={`${config.acessorio}|${pose}`}
          config={config}
          m={m}
          frente={frente}
          topo={topo}
          quadrilY={quadrilY}
          ombroY={ombroY}
          sentado={sentado}
          maoDireitaSolta={maoDireitaSolta}
        />

        {/* ——— Pescoço e cabeça ——— */}
        <mesh position={[0, topo + 0.02, 0]}>
          <cylinderGeometry args={[0.08, 0.09, 0.08, 16]} />
          <meshStandardMaterial color={pele} roughness={0.6} />
        </mesh>
        <group ref={cabeca} position={[0, cabecaY, 0]}>
          <Bloco tam={[m.cabeca, m.cabeca, m.cabeca * 0.92]} cor={pele} raio={0.1} />
          <mesh position={[0, -0.01, (m.cabeca * 0.92) / 2 + 0.003]}>
            <planeGeometry args={[m.cabeca * 0.9, m.cabeca * 0.9]} />
            <meshBasicMaterial
              ref={rosto}
              map={rostoFechado ?? undefined}
              transparent
              toneMapped={false}
            />
          </mesh>
          {/* Só o lenhador vira malha 3D de fios; as outras barbas seguem no adesivo do rosto. */}
          <Barba3D
            key={"barba-" + config.barba}
            tipo={config.barba}
            cor={escurecer(config.corCabelo, 0.15)}
            t={m.cabeca}
            m={m}
          />

          {/* As chaves recriam a peça quando ela troca de tipo: reaproveitar o
            objeto 3D de outra peça quebra o R3F em modo dev (data-tsd-source). */}
          <Cabelo
            key={`${config.cabelo}-${COBRE_O_ALTO.has(config.chapeu)}`}
            config={config}
            m={m}
          />
          <Chapeu key={config.chapeu} tipo={config.chapeu} cor={config.corChapeu} t={m.cabeca} />
        </group>

        {mostrarNome && nome && (
          <Html
            position={[0, cabecaY + m.cabeca / 2 + (config.chapeu === "cartola" ? 0.5 : 0.3), 0]}
            center
            distanceFactor={6}
            zIndexRange={[20, 0]}
          >
            <div
              className={`pointer-events-none whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold shadow ${
                falando ? "bg-emerald-500 text-white" : "bg-black/60 text-white"
              }`}
            >
              {falando && "🎙 "}
              {nome}
            </div>
          </Html>
        )}
      </group>
    </ContextoDoAvatar.Provider>
  );
}

/* ————————————————— Aceno (16/10/2026) ————————————————— */

/**
 * Quem acena é o braço ESQUERDO do boneco (x > 0, lado 1 do esqueleto): de
 * frente para a câmera ele fica à DIREITA de quem olha. O direito ficou
 * parado porque é nele que vai o relógio (`Acessorio`), que não acompanha o
 * braço solto. Girar +z no ombro leva a mão para fora e para cima.
 */
const LADO_DO_ACENO = 1 as const;
/** A sequência (~2,9 s) repete a cada tantos segundos. */
const PERIODO_DO_ACENO = 6;
const BRACO_ERGUIDO = (150 * Math.PI) / 180;

const suave = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * A pose do aceno `s` segundos depois do início:
 * - pulinho: agacha (0–0,12 s), sobe 12 cm e desce (0,12–0,42), amassa ao
 *   pousar (0,42–0,62). `alto`/`largo` são a escala do corpo a partir do chão
 *   (o volume quase se mantém: achatou, alarga);
 * - braço: ergue até 150° (0,15–0,6), balança ±18° de um lado para o outro
 *   (0,6–2,4, ~2,2 vaivéns por segundo) e abaixa (2,4–2,9). Inclina um pouco
 *   para a frente enquanto está erguido, para a mão ficar à vista.
 */
function poseDoAceno(s: number) {
  let y = 0;
  let alto = 1;
  if (s < 0.12) alto = 1 - 0.07 * suave(s / 0.12);
  else if (s < 0.42) {
    const p = (s - 0.12) / 0.3;
    y = 0.12 * Math.sin(Math.PI * p);
    // sai do agachado esticando um pouco no ar
    alto = p < 0.25 ? 0.93 + 0.11 * suave(p / 0.25) : 1 + 0.04 * (1 - suave((p - 0.25) / 0.75));
  } else if (s < 0.62) alto = 1 - 0.08 * Math.sin((Math.PI * (s - 0.42)) / 0.2);
  const largo = 1 + (1 - alto) * 0.5;

  let erguido = 0;
  let balanco = 0;
  if (s >= 0.15 && s < 0.6) erguido = suave((s - 0.15) / 0.45);
  else if (s >= 0.6 && s < 2.4) {
    erguido = 1;
    const entra = suave((s - 0.6) / 0.15) * (1 - suave((s - 2.25) / 0.15));
    balanco = 0.32 * Math.sin(2 * Math.PI * 2.2 * (s - 0.6)) * entra;
  } else if (s >= 2.4 && s < 2.9) erguido = 1 - suave((s - 2.4) / 0.5);
  return {
    y,
    alto,
    largo,
    bracoZ: BRACO_ERGUIDO * erguido + balanco,
    bracoX: 0.18 * erguido,
  };
}

/* ————————————————— Reações (17/10/2026) ————————————————— */

const BAIXO = new Vector3(0, -1, 0);
const _direcao = new Vector3();
/** Desfaz o giro do pivô do ombro em pé (0,06 rad em z, ver `esqueleto`). */
const DESFAZ_OMBRO: Record<Lado, Quaternion> = {
  1: new Quaternion().setFromEuler(new Euler(0, 0, -0.06)),
  [-1]: new Quaternion().setFromEuler(new Euler(0, 0, 0.06)),
};

/**
 * Gira o grupo do braço para ele apontar na direção `d` (referencial do
 * avatar). Sem `d`, o braço volta a cair como sempre.
 */
function apontarBraco(g: Group | null, l: Lado, d: [number, number, number] | undefined) {
  if (!g) return;
  if (!d) {
    g.quaternion.identity();
    return;
  }
  _direcao.set(d[0], d[1], d[2]).applyQuaternion(DESFAZ_OMBRO[l]);
  g.quaternion.setFromUnitVectors(BAIXO, _direcao);
}

/* ————————————————— Acessórios ————————————————— */

/** Acessórios presos à mão direita, que não acompanham o braço quando ele se solta. */
const NA_MAO_DIREITA: ReadonlySet<string> = new Set(["relogio", "prancheta", "muda", "balao"]);

/**
 * O relógio no pulso direito, no espaço do grupo do braço (pivô no ombro):
 * por cima do antebraço ou da manga longa (+6 mm).
 */
function PulseiraDoRelogio({ config, m }: { config: AvatarConfig; m: Medidas }) {
  const comp = m.troncoH + 0.02;
  const manga = comprimentoDaManga(m, MANGA_DE[config.roupa]);
  const folga = manga > comp - 0.2 ? 0.012 : 0;
  return (
    <group position={[0, -comp + 0.2, 0]}>
      <Bloco
        tam={[m.bracoW + 0.012 + folga, 0.05, m.bracoW + 0.03 + folga]}
        cor="#1f2937"
        raio={0.012}
      />
      <mesh position={[0, 0, (m.bracoW + folga) / 2 + 0.02]}>
        <boxGeometry args={[0.06, 0.06, 0.01]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Acessorio({
  config,
  m,
  frente,
  topo,
  quadrilY,
  ombroY,
  sentado,
  maoDireitaSolta = false,
}: {
  config: AvatarConfig;
  m: Medidas;
  /** A frente efetiva: tronco + painel do casaco, quando houver (R5). */
  frente: number;
  topo: number;
  quadrilY: number;
  ombroY: number;
  sentado: boolean;
  /** O braço direito está solto num gesto: o relógio vai com ele (`PulseiraDoRelogio`). */
  maoDireitaSolta?: boolean;
}) {
  if (maoDireitaSolta && NA_MAO_DIREITA.has(config.acessorio)) return null;
  const painel = TEM_PAINEL.has(config.roupa);
  switch (config.acessorio) {
    case "colar":
      return (
        <group>
          {[-1, 1].map((l) => (
            <mesh key={l} position={[0.05 * l, topo - 0.08, frente + 0.006]} rotation-z={-0.35 * l}>
              <boxGeometry args={[0.012, 0.16, 0.006]} />
              <meshStandardMaterial color="#1f2937" />
            </mesh>
          ))}
          <mesh position={[0, topo - 0.19, frente + 0.012]}>
            <boxGeometry args={[0.05, 0.07, 0.02]} />
            <meshStandardMaterial
              color="#22c55e"
              metalness={0.3}
              roughness={0.2}
              emissive="#16a34a"
              emissiveIntensity={0.25}
            />
          </mesh>
        </group>
      );
    case "cracha":
      return (
        <group>
          {[-1, 1].map((l) => (
            <mesh key={l} position={[0.06 * l, topo - 0.1, frente + 0.006]} rotation-z={-0.25 * l}>
              <boxGeometry args={[0.02, 0.22, 0.006]} />
              <meshStandardMaterial color="#2563eb" />
            </mesh>
          ))}
          <Bloco
            tam={[0.12, 0.16, 0.012]}
            pos={[0, topo - 0.29, frente + 0.012]}
            cor="#f8fafc"
            raio={0.01}
          />
          <mesh position={[0, topo - 0.235, frente + 0.02]}>
            <boxGeometry args={[0.11, 0.035, 0.004]} />
            <meshStandardMaterial color="#16a34a" />
          </mesh>
        </group>
      );
    case "mochila": {
      // Sentado, o encosto da cadeira ocupa as costas: a mochila não aparece.
      if (sentado) return null;
      const folga = painel ? 0.04 : 0.01;
      const fundo = 0.16 - folga;
      return (
        <group>
          <Bloco
            tam={[m.troncoW * 0.75, m.troncoH * 0.8, fundo]}
            pos={[0, quadrilY + m.troncoH * 0.5, -(m.troncoD / 2 + folga) - fundo / 2]}
            cor="#334155"
            raio={0.05}
          />
          {[-1, 1].map((l) => (
            <mesh key={l} position={[m.troncoW * 0.25 * l, topo - 0.15, frente + 0.004]}>
              <boxGeometry args={[0.05, 0.28, 0.01]} />
              <meshStandardMaterial color="#1e293b" />
            </mesh>
          ))}
        </group>
      );
    }
    case "relogio":
      // No pulso direito: o grupo do ombro, e a pulseira dentro dele.
      return (
        <group
          position={[-(m.troncoW / 2 + m.bracoW / 2 + 0.01), ombroY, 0]}
          rotation={sentado ? [-1.2, 0, 0] : [0, 0, -0.06]}
        >
          <PulseiraDoRelogio config={config} m={m} />
        </group>
      );
    case "foneNoPescoco":
      return (
        <group position={[0, topo + 0.02, 0.02]}>
          <mesh rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.16, 0.02, 10, 32, Math.PI]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          {[-1, 1].map((l) => (
            <mesh key={l} position={[0.16 * l, 0, 0]} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.06, 0.06, 0.05, 20]} />
              <meshStandardMaterial color={config.corChapeu} />
            </mesh>
          ))}
        </group>
      );
    default:
      // Acessórios novos do catálogo (16/10/2026): ver `acessorios-extras.tsx`.
      return ACESSORIOS_EXTRAS.has(config.acessorio) ? (
        <AcessorioExtra
          config={config}
          m={m}
          frente={frente}
          topo={topo}
          quadrilY={quadrilY}
          ombroY={ombroY}
          sentado={sentado}
        />
      ) : null;
  }
}
