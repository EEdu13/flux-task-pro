/*
 * A sala de reunião 3D da Realidade Virtual.
 *
 * Mesa oval com cadeiras em ferradura voltada ao telão, eu no lugar 0 (ponta
 * de baixo, câmera atrás de mim — o meu boneco some nela, ver `enquadramento.ts`). Por cima do Canvas, UMA camada 2D
 * com crachás, selos (mudo, gesto) e balões dos cards — posicionada pelo
 * Projetor a cada quadro, sem drei <Html>.
 *
 * Arquivos: tudo o que é da sala está em `./sala/` (contrato em `sala/tipos.ts`).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { PerspectiveCamera } from "three";
import { QualidadeDoAvatar } from "@/components/rv/contexto-avatar";
import type { CardNaSala, NaMesa, PessoaNaSala } from "./sala/tipos";
import { Ambiente } from "./sala/ambiente";
import { Aparador, Cadeiras, type CadeiraNaSala, Mesa } from "./sala/mobilia";
import { Telao } from "./sala/telao";
import { Quadro } from "./sala/quadro";
import { AvatarNaCadeira, type MedidaDoAvatar } from "./sala/avatar-na-cadeira";
import { CamadaSobreCabecas, balaoDaPessoa } from "./sala/camada-sobre-cabecas";
import { type ItemDoProjetor, Projetor, RegistroDaCamada, debugLigado } from "./sala/projetor";
import { cadeirasVisiveis, distribuirLugares, lugar, topoDaCabecaReserva } from "./sala/lugares";
import { fovParaProporcao } from "./sala/enquadramento";
import {
  CAMERA_ALVO,
  CAMERA_AZIMUTE,
  CAMERA_DIST_MAX,
  CAMERA_DIST_MIN,
  CAMERA_FOLGA_DO_FORRO,
  CAMERA_FOV,
  CAMERA_POLAR_MAX,
  CAMERA_POSICAO,
  CAMERA_X_MAX,
  CAMERA_Y_MAX,
  CAMERA_Z_MAX,
  SOMBRA_HZ,
} from "./sala/medidas-da-sala";
import "./sala/sala.css";

export type { NaMesa, PessoaNaSala } from "./sala/tipos";

/** Campos novos com os padrões da especificação (a rota antiga só manda os 5 primeiros). */
function completar(p: PessoaNaSala): NaMesa {
  return {
    mudo: false,
    semMicrofone: false,
    mao: null,
    maoDesde: null,
    posicaoNaFila: null,
    momentaneo: null,
    cards: [],
    iaOuvindo: false,
    cameraGestos: false,
    conduz: false,
    cabeca: null,
    ...p,
  };
}

/* ───────── Câmera ───────── */

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

function Camera({ aoInteragir }: { aoInteragir?: () => void }) {
  const controles = useRef<OrbitControlsImpl>(null);
  const livre = useRef(false);
  const interagiu = useRef(false);

  // Anticolisão (prioridade 0: depois do update do OrbitControls, que é −1).
  // Polar mínimo dinâmico: alvo.y + d·cos(polar) ≤ alvo.y + 1,85 → câmera ≤ 2,8 m.
  useFrame(({ camera }) => {
    const c = controles.current;
    if (!c || livre.current) return;
    c.minPolarAngle = Math.acos(Math.min(1, CAMERA_FOLGA_DO_FORRO / c.getDistance()));
    camera.position.y = Math.min(camera.position.y, CAMERA_Y_MAX);
    camera.position.x = clamp(camera.position.x, -CAMERA_X_MAX, CAMERA_X_MAX);
    camera.position.z = Math.min(camera.position.z, CAMERA_Z_MAX);
  });

  // Só para os testes de render (dev + ?__sala): soltar a câmera para vistas de cima.
  const { scene, gl, camera } = useThree();
  useEffect(() => {
    if (!debugLigado()) return;
    const w = window as unknown as { __salaDev?: unknown };
    w.__salaDev = {
      scene,
      gl,
      camera,
      controles: controles.current,
      soltar(sim: boolean) {
        livre.current = sim;
        if (controles.current) controles.current.enabled = !sim;
      },
    };
    return () => {
      delete w.__salaDev;
    };
  }, [scene, gl, camera]);

  return (
    <OrbitControls
      ref={controles}
      makeDefault
      target={CAMERA_ALVO}
      enablePan={false}
      enableDamping
      minDistance={CAMERA_DIST_MIN}
      maxDistance={CAMERA_DIST_MAX}
      maxPolarAngle={CAMERA_POLAR_MAX}
      minAzimuthAngle={-CAMERA_AZIMUTE}
      maxAzimuthAngle={CAMERA_AZIMUTE}
      onStart={() => {
        if (interagiu.current) return;
        interagiu.current = true;
        aoInteragir?.();
      }}
    />
  );
}

/**
 * FOV que acompanha a proporção do palco. O FOV do three é VERTICAL: com ele
 * fixo, um palco mais estreito (painel aberto, notebook, janela em pé) corta
 * as laterais da mesa — justamente onde sentam os primeiros a chegar. Aqui o
 * campo horizontal nunca fica abaixo de ~90° (ver `fovParaProporcao`).
 */
function FovAdaptativo() {
  const camera = useThree((s) => s.camera);
  const largura = useThree((s) => s.size.width);
  const altura = useThree((s) => s.size.height);
  useLayoutEffect(() => {
    const c = camera as PerspectiveCamera;
    if (!c.isPerspectiveCamera || altura <= 0) return;
    const fov = fovParaProporcao(largura / altura);
    if (Math.abs(c.fov - fov) < 0.05) return;
    c.fov = fov;
    c.updateProjectionMatrix();
  }, [camera, largura, altura]);
  return null;
}

/**
 * Sombra "preguiçosa": a sala é quase estática, então o mapa de sombra é
 * redesenhado a 2 Hz e quando muda quem está na mesa — não a cada quadro.
 */
function SombraLenta({ versao }: { versao: string }) {
  const gl = useThree((s) => s.gl);
  const ultimo = useRef(0);
  useLayoutEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);
  useEffect(() => {
    gl.shadowMap.needsUpdate = true;
  }, [gl, versao]);
  useFrame(({ clock }) => {
    if (clock.elapsedTime - ultimo.current >= 1 / SOMBRA_HZ) {
      ultimo.current = clock.elapsedTime;
      gl.shadowMap.needsUpdate = true;
    }
  });
  return null;
}

/* ───────── Quem entra e quem sai ───────── */

/**
 * Mantém por 300 ms quem acabou de sair (o boneco encolhe em vez de sumir).
 * Quem volta antes disso é "ressuscitado" — some da lista de saída.
 */
function useComSaidas(pessoas: NaMesa[]) {
  const [saindo, setSaindo] = useState<NaMesa[]>([]);
  const anteriores = useRef<NaMesa[]>([]);
  useEffect(() => {
    const agora = new Set(pessoas.map((p) => p.id));
    const sairam = anteriores.current.filter((p) => !agora.has(p.id));
    anteriores.current = pessoas;
    setSaindo((s) => {
      const base = s.filter((p) => !agora.has(p.id));
      const novos = sairam.filter((p) => !base.some((b) => b.id === p.id));
      return novos.length || base.length !== s.length ? [...base, ...novos] : s;
    });
  }, [pessoas]);
  const terminou = useCallback((id: string) => {
    setSaindo((s) => s.filter((p) => p.id !== id));
  }, []);
  return { saindo, terminou };
}

/* ───────── A sala ───────── */

export function Sala3D({
  pessoas: entrada,
  telao,
  quemCompartilha,
  mural,
  nomeDaSala = "Sala de reunião",
  aoInteragir,
  aoVerTela,
  aoAbrirCards,
}: {
  pessoas: PessoaNaSala[];
  telao: HTMLVideoElement | null;
  quemCompartilha?: string;
  /** Todos os cards, o mais novo por último (≤ MAX_MURAL). */
  mural?: CardNaSala[];
  nomeDaSala?: string;
  /** 1ª interação com a câmera. */
  aoInteragir?: () => void;
  /** Duplo clique no telão com vídeo. */
  aoVerTela?: () => void;
  /** Clique no quadro da parede (e nos balões). */
  aoAbrirCards?: () => void;
}) {
  const pessoas = useMemo(() => entrada.map(completar), [entrada]);
  const muralSeguro = mural ?? [];
  const { saindo, terminou } = useComSaidas(pessoas);

  // Lugares estáveis: quem está sentado não troca de cadeira quando alguém entra/sai.
  const lugaresAnteriores = useRef(new Map<string, number>());
  const todos = useMemo(() => [...pessoas, ...saindo], [pessoas, saindo]);
  const chaveDosIds = todos.map((p) => p.id + (p.eu ? "*" : "")).join("|");
  const lugares = useMemo(
    () => distribuirLugares(todos, lugaresAnteriores.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chaveDosIds],
  );
  useEffect(() => {
    lugaresAnteriores.current = lugares;
  }, [lugares]);

  // Medidas do boneco (topo da cabeça e "gás" da cadeira), vindas do AvatarNaCadeira.
  const [medidas, setMedidas] = useState<Record<string, MedidaDoAvatar>>({});
  const aoMedir = useCallback((id: string, m: MedidaDoAvatar) => {
    setMedidas((t) => {
      const a = t[id];
      if (a && Math.abs(a.topo - m.topo) < 0.005 && Math.abs(a.elevacao - m.elevacao) < 0.002)
        return t;
      return { ...t, [id]: m };
    });
  }, []);

  // Testes de render (dev + ?__sala): as medidas do boneco (mão, coxa, gás) ficam à vista.
  useEffect(() => {
    if (debugLigado()) (window as unknown as { __salaMedidas?: unknown }).__salaMedidas = medidas;
  }, [medidas]);

  const cadeiras: CadeiraNaSala[] = useMemo(() => {
    const ocupantes = new Map<number, string>();
    for (const [id, l] of lugares) ocupantes.set(l, id);
    return cadeirasVisiveis(pessoas.length).map((i) => {
      const id = ocupantes.get(i);
      return {
        lugar: lugar(i),
        ocupada: id !== undefined,
        elevacao: id !== undefined ? (medidas[id]?.elevacao ?? 0) : 0,
      };
    });
  }, [lugares, pessoas.length, medidas]);

  // A camada 2D: um registro por sala (refs estáveis e ResizeObserver).
  const [registro] = useState(() => new RegistroDaCamada());
  useEffect(() => () => registro.desligar(), [registro]);

  const itens: ItemDoProjetor[] = useMemo(
    () =>
      pessoas
        .filter((p) => lugares.has(p.id))
        .map((p) => {
          const m = medidas[p.id];
          return {
            id: p.id,
            eu: p.eu,
            lugar: lugar(lugares.get(p.id)!),
            topo: (m?.topo ?? topoDaCabecaReserva(p.config)) + (m?.elevacao ?? 0),
            elevacao: m?.elevacao ?? 0,
            balaoChegou: balaoDaPessoa(p)?.item.chegou ?? null,
          };
        }),
    [pessoas, lugares, medidas],
  );
  const naMesa = useMemo(() => pessoas.filter((p) => lugares.has(p.id)), [pessoas, lugares]);
  const abrirCard = useCallback(() => aoAbrirCards?.(), [aoAbrirCards]);

  return (
    <div className="relative h-full w-full">
      <Canvas
        dpr={[1, 1.5]}
        shadows
        camera={{ position: CAMERA_POSICAO, fov: CAMERA_FOV, near: 0.1, far: 40 }}
      >
        <color attach="background" args={["#1b1410"]} />
        <SombraLenta versao={chaveDosIds} />
        <Ambiente />
        <Mesa />
        <Aparador />
        <Cadeiras cadeiras={cadeiras} />
        <Telao
          video={telao}
          quem={quemCompartilha}
          mural={muralSeguro}
          nomeDaSala={nomeDaSala}
          aoVerTela={aoVerTela}
        />
        <Quadro mural={muralSeguro} aoAbrirCards={aoAbrirCards} />

        <QualidadeDoAvatar.Provider value="media">
          {todos.map((p) => {
            const i = lugares.get(p.id);
            if (i === undefined) return null;
            const saiu = saindo.some((s) => s.id === p.id);
            return (
              <AvatarNaCadeira
                key={p.id}
                id={p.id}
                config={p.config}
                nome={p.nome}
                falando={p.falando && !p.mudo}
                lugar={lugar(i)}
                saindo={saiu}
                eu={p.eu}
                elevacao={medidas[p.id]?.elevacao ?? 0}
                aoMedir={aoMedir}
                aoSair={terminou}
              />
            );
          })}
        </QualidadeDoAvatar.Provider>

        <Camera aoInteragir={aoInteragir} />
        <FovAdaptativo />
        <Projetor itens={itens} registro={registro} comVideo={Boolean(telao)} />
      </Canvas>
      <CamadaSobreCabecas pessoas={naMesa} registro={registro} aoAbrirCard={abrirCard} />
    </div>
  );
}
