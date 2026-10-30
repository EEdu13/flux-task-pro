import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Group } from "three";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Avatar3D } from "@/components/rv/avatar-3d";
import { FabricaDeMiniaturas, useMiniatura } from "@/components/rv/miniaturas";
import { SemTresD } from "@/components/rv/sem-tres-d";
import { AVATAR_EM_BRANCO, carregarAvataresDe, type AvatarConfig } from "@/lib/avatar-3d";
import { comChapeuDeFesta } from "@/lib/festa-de-aniversario";
import type { Role, User } from "@/lib/fluxo-types";

/*
 * A aba Equipes de Contatos (29/10/2026).
 *
 * Primeira versão era uma grade de fotos; o pedido era outro: "ver time do
 * Frota, ver time Financeiro, aí vai passando avatar por avatar em 3D mesmo".
 * Agora é uma vitrine: escolhe o time em cima, o avatar da pessoa aparece
 * grande, em 3D de verdade (gira sozinho, arrastar gira na mão), acenando —
 * e as setas (ou ← → do teclado, ou o "passar sozinho") vão para o próximo.
 *
 * Um único <Canvas> para a aba toda: troca a pessoa, não o canvas. A fita de
 * rostinhos embaixo são fotos da fábrica de miniaturas (um canvas escondido),
 * guardadas no navegador.
 *
 * Carregado sob demanda pela página (three.js é pesado e Contatos abre sem ele).
 */

type Setor = { id: string; name: string; color: string };

const ORDEM_DO_PAPEL: Record<Role, number> = { gerente: 0, supervisor: 1, adm: 2 };
const SEGUNDOS_POR_PESSOA = 5;

function nomeCurto(nome: string) {
  const partes = nome.trim().split(/\s+/);
  return partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1]}` : partes[0];
}

/** Ao trocar de pessoa, o boneco entra deslizando do lado de onde veio. */
function Entrada({ de, children }: { de: number; children: ReactNode }) {
  const g = useRef<Group>(null);
  const t = useRef(0);
  useFrame((_, dt) => {
    if (!g.current || t.current >= 1) return;
    t.current = Math.min(1, t.current + dt * 2.6);
    const k = 1 - Math.pow(1 - t.current, 3);
    g.current.position.x = de * 1.6 * (1 - k);
    g.current.scale.setScalar(0.85 + 0.15 * k);
  });
  return (
    <group ref={g} position-x={de * 1.6} scale={0.85}>
      {children}
    </group>
  );
}

function Palco({
  config,
  chave,
  de,
  cor,
}: {
  config: AvatarConfig;
  chave: string;
  de: number;
  cor: string;
}) {
  return (
    <Canvas dpr={[1, 1.75]} camera={{ position: [0, 1.1, 5.6], fov: 32 }}>
      <hemisphereLight args={["#ffffff", "#9ca3af", 1.1]} />
      <directionalLight position={[2, 3, 2.5]} intensity={1.3} />
      <directionalLight position={[-2, 2, -1]} intensity={0.4} />
      <Entrada key={chave} de={de}>
        <Avatar3D config={config} mostrarNome={false} pose="em-pe" acenar />
      </Entrada>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.001}>
        <circleGeometry args={[0.75, 48]} />
        <meshStandardMaterial color={cor} transparent opacity={0.35} />
      </mesh>
      <OrbitControls
        target={[0, 0.72, 0]}
        enablePan={false}
        enableZoom={false}
        autoRotate
        autoRotateSpeed={0.8}
        minPolarAngle={Math.PI / 3.2}
        maxPolarAngle={Math.PI / 1.9}
      />
    </Canvas>
  );
}

function Rostinho({
  user,
  config,
  ativo,
  cor,
  aoClicar,
}: {
  user: User;
  config: AvatarConfig | null;
  ativo: boolean;
  cor: string;
  aoClicar: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ativo)
      ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [ativo]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={aoClicar}
      title={user.name}
      className={`flex w-16 shrink-0 flex-col items-center gap-1 rounded-xl p-1 transition ${
        ativo ? "bg-primary/10" : "opacity-70 hover:opacity-100"
      }`}
    >
      <div
        className="grid h-12 w-12 place-items-center overflow-hidden rounded-full border-2"
        style={{
          borderColor: ativo ? cor : "transparent",
          background: `color-mix(in oklab, ${cor} 15%, transparent)`,
        }}
      >
        {config ? <FotoDoRosto config={config} /> : null}
      </div>
      <span className="w-full truncate text-center text-[10px] font-medium">
        {nomeCurto(user.name).split(" ")[0]}
      </span>
    </button>
  );
}

function FotoDoRosto({ config }: { config: AvatarConfig }) {
  const foto = useMiniatura(config, "rosto");
  if (!foto) return <div className="h-8 w-8 animate-pulse rounded-full bg-muted/60" />;
  return <img src={foto} alt="" draggable={false} className="h-full w-full object-cover" />;
}

export default function EquipesComAvatar({
  users,
  setores,
  aoEscolher,
}: {
  users: User[];
  setores: Setor[];
  aoEscolher: (id: string) => void;
}) {
  const [avatares, setAvatares] = useState<Map<string, AvatarConfig | null> | null>(null);
  const ids = useMemo(() => users.map((u) => u.id).sort(), [users]);
  const chaveIds = ids.join(",");

  useEffect(() => {
    let vivo = true;
    carregarAvataresDe(ids)
      .then((m) => vivo && setAvatares(m))
      .catch((e: unknown) => {
        console.warn("equipes: não deu para carregar os avatares", e);
        if (vivo) setAvatares(new Map());
      });
    return () => {
      vivo = false;
    };
    // `chaveIds` resume `ids`: a lista nova com as mesmas pessoas não pede de novo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveIds]);

  const times = useMemo(() => {
    const porSetor = new Map<string, User[]>();
    for (const u of users) porSetor.set(u.sector, [...(porSetor.get(u.sector) ?? []), u]);
    return setores
      .filter((s) => porSetor.has(s.id))
      .map((s) => ({
        setor: s,
        pessoas: porSetor
          .get(s.id)!
          .sort(
            (a, b) =>
              ORDEM_DO_PAPEL[a.role] - ORDEM_DO_PAPEL[b.role] || a.name.localeCompare(b.name),
          ),
      }));
  }, [users, setores]);

  const [timeId, setTimeId] = useState<string>("");
  const [indice, setIndice] = useState(0);
  const [direcao, setDirecao] = useState(1);
  const [sozinho, setSozinho] = useState(false);

  const time = times.find((t) => t.setor.id === timeId) ?? times[0];
  const pessoas = time?.pessoas ?? [];
  const atual = pessoas[Math.min(indice, pessoas.length - 1)];

  // Trocou o filtro e o time escolhido sumiu: volta para o primeiro.
  useEffect(() => {
    if (time && time.setor.id !== timeId) setTimeId(time.setor.id);
  }, [time, timeId]);

  const irPara = (novo: number, dir: number) => {
    if (!pessoas.length) return;
    setDirecao(dir);
    setIndice((novo + pessoas.length) % pessoas.length);
  };
  const anterior = () => irPara(indice - 1, -1);
  const proximo = () => irPara(indice + 1, 1);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      if (e.key === "ArrowRight") proximo();
      else if (e.key === "ArrowLeft") anterior();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  useEffect(() => {
    if (!sozinho || pessoas.length < 2) return;
    const id = window.setTimeout(proximo, SEGUNDOS_POR_PESSOA * 1000);
    return () => window.clearTimeout(id);
    // reprograma a cada pessoa nova
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sozinho, indice, timeId, pessoas.length]);

  if (!time || !atual) {
    return (
      <div className="rounded-xl border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
        Nenhuma pessoa com esse filtro.
      </div>
    );
  }

  const cor = time.setor.color;
  const salvo = avatares?.get(atual.id);
  const configAtual = avatares ? comChapeuDeFesta(atual.id, salvo ?? AVATAR_EM_BRANCO) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <FabricaDeMiniaturas />

      {/* Os times */}
      <div className="flex flex-wrap gap-1.5">
        {times.map(({ setor, pessoas: p }) => {
          const ativo = setor.id === time.setor.id;
          return (
            <button
              key={setor.id}
              type="button"
              onClick={() => {
                setTimeId(setor.id);
                setIndice(0);
                setDirecao(1);
              }}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                ativo
                  ? "border-transparent text-white shadow"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
              style={ativo ? { background: setor.color } : undefined}
            >
              {!ativo && (
                <span className="h-2 w-2 rounded-full" style={{ background: setor.color }} />
              )}
              Time {setor.name}
              <span className={ativo ? "opacity-80" : "opacity-60"}>{p.length}</span>
            </button>
          );
        })}
      </div>

      {/* O palco */}
      <div
        className="relative min-h-[360px] flex-1 overflow-hidden rounded-2xl border border-border"
        style={{
          background: `radial-gradient(ellipse at 50% 35%, color-mix(in oklab, ${cor} 22%, white) 0%, color-mix(in oklab, ${cor} 8%, #e2e8f0) 70%)`,
        }}
      >
        {configAtual ? (
          <SemTresD reserva={<div className="grid h-full place-items-center text-6xl">🙋</div>}>
            <Palco config={configAtual} chave={atual.id} de={direcao} cor={cor} />
          </SemTresD>
        ) : (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            Carregando os avatares…
          </div>
        )}

        <div className="pointer-events-none absolute left-4 top-3 rounded-full bg-background/80 px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground backdrop-blur">
          {indice + 1} de {pessoas.length}
        </div>

        <button
          type="button"
          onClick={() => setSozinho((s) => !s)}
          className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-semibold shadow backdrop-blur transition hover:bg-background"
        >
          {sozinho ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {sozinho ? "Pausar" : "Passar sozinho"}
        </button>

        {pessoas.length > 1 && (
          <>
            <button
              type="button"
              onClick={anterior}
              aria-label="Anterior"
              className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-background/85 shadow-md backdrop-blur transition hover:scale-105 hover:bg-background"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={proximo}
              aria-label="Próximo"
              className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-background/85 shadow-md backdrop-blur transition hover:scale-105 hover:bg-background"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}

        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <div className="flex flex-col items-center rounded-2xl bg-background/90 px-5 py-2 text-center shadow-md backdrop-blur">
            <div className="text-sm font-bold">{nomeCurto(atual.name)}</div>
            <div className="text-[11px] text-muted-foreground">{atual.jobTitle}</div>
            <div className="mt-1 flex items-center gap-2">
              {avatares && !salvo && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  ainda sem avatar
                </span>
              )}
              <button
                type="button"
                onClick={() => aoEscolher(atual.id)}
                className="text-[11px] font-semibold text-primary hover:underline"
              >
                Ver na hierarquia
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* A fita do time */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {pessoas.map((u, i) => {
          const s = avatares?.get(u.id);
          return (
            <Rostinho
              key={u.id}
              user={u}
              config={avatares ? comChapeuDeFesta(u.id, s ?? AVATAR_EM_BRANCO) : null}
              ativo={i === indice}
              cor={cor}
              aoClicar={() => irPara(i, i >= indice ? 1 : -1)}
            />
          );
        })}
      </div>
    </div>
  );
}
