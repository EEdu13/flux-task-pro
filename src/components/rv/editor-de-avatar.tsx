import { useEffect, useRef, useState } from "react";
import { SemTresD } from "@/components/rv/sem-tres-d";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  Check,
  Footprints,
  Glasses,
  Palette,
  PersonStanding,
  Plus,
  Scissors,
  Shirt,
  Shuffle,
  Smile,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar3D } from "@/components/rv/avatar-3d";
import { FabricaDeMiniaturas, useMiniatura, type Quadro } from "@/components/rv/miniaturas";
import {
  AVATAR_PADRAO,
  COM_ESTAMPA,
  CORES_DE_CALCA,
  CORES_DE_CABELO,
  CORES_DE_CHAPEU,
  CORES_DE_MECHAS,
  CORES_DE_OLHOS,
  CORES_DE_ROUPA,
  CORES_DE_SAPATO,
  OPCOES,
  ROUPA_INTEIRA,
  ROUPAS_FEMININAS,
  ROUPAS_MASCULINAS,
  TONS_DE_PELE,
  type AvatarConfig,
} from "@/lib/avatar-3d";
import { CABELOS_FEMININOS, CABELOS_MASCULINOS, EXPRESSOES_FEMININAS } from "@/lib/avatar-generos";

/** Calça não tem ícone no lucide: um desenho pequeno no mesmo traço. */
const Calca = (({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M6 3h12l1 18h-5l-2-11-2 11H5z" />
    <path d="M6 7h12" />
  </svg>
)) as unknown as LucideIcon;

const CATEGORIAS = [
  { id: "corpo", rotulo: "Corpo", Icone: PersonStanding },
  { id: "rosto", rotulo: "Rosto", Icone: Smile },
  { id: "cabelo", rotulo: "Cabelo", Icone: Scissors },
  { id: "cima", rotulo: "Cima", Icone: Shirt },
  { id: "baixo", rotulo: "Baixo", Icone: Calca },
  { id: "pes", rotulo: "Calçado", Icone: Footprints },
  { id: "extras", rotulo: "Extras", Icone: Glasses },
] as const;
type Categoria = (typeof CATEGORIAS)[number]["id"];

/** Acessórios pintados com `corChapeu` — mostram o seletor de cor. */
const ACESSORIOS_COM_COR: ReadonlySet<string> = new Set([
  "foneNoPescoco",
  "capa",
  "cachecol",
  "gravataBorboleta",
  "balao",
]);

/**
 * O boneco de exemplo das fotinhas do catálogo (17/10/2026). Antes cada foto
 * era o PRÓPRIO avatar vestindo a opção: trocar o cabelo ou uma cor refazia
 * dezenas de fotos 3D e o provador travava. Com um modelo fixo, cada foto é
 * tirada uma vez (e guardada no navegador — ver `miniaturas.tsx`); a prévia
 * de verdade, com o avatar da pessoa, é o boneco grande ao lado (passar o
 * mouse veste ele).
 *
 * Camiseta lisa (aceita estampa), jeans e tênis: nada que tampe a peça que a
 * foto quer mostrar.
 */
const MODELO_DA_VITRINE: AvatarConfig = {
  ...AVATAR_PADRAO,
  roupa: "camiseta",
  corRoupa: "#94a3b8",
  corRoupa2: "#f8fafc",
  calca: "jeans",
  sapato: "tenis",
  acessorio: "nenhum",
  oculos: "nenhum",
  barba: "nenhuma",
  detalhe: "nenhum",
  chapeu: "nenhum",
  mechas: "nenhuma",
};

/** Quantas cores ficam à mostra; o resto está na paleta (pedido do usuário, 13/10/2026). */
const CORES_A_MOSTRA = 8;

type Estilo = "todas" | "f" | "m";

/**
 * O provador: o avatar girando à esquerda e, à direita, o catálogo em
 * categorias com fotinha de cada opção — como o do Roblox (pedido do usuário,
 * 13/10/2026: "os menus estão ruins, ver uma prévia igual de roblox").
 *
 * Passar o mouse numa opção já veste o avatar grande (prévia); clicar escolhe.
 * Cada grupo mostra duas fileiras e um "+" para ver o resto. Cores: as
 * principais à mostra e a paleta para qualquer outra.
 */
export function EditorDeAvatar({
  inicial,
  nome,
  salvando,
  aoSalvar,
  aoCancelar,
  aoMudar,
  rotuloSalvar = "Pronto, entrar com esse",
}: {
  inicial: AvatarConfig;
  nome: string;
  salvando: boolean;
  aoSalvar: (a: AvatarConfig) => void;
  aoCancelar?: () => void;
  /** Avisa a cada mudança se o avatar está diferente do salvo (para perguntar antes de sair). */
  aoMudar?: (sujo: boolean, atual: AvatarConfig) => void;
  /** Texto do botão de salvar (16/10/2026: nas Configurações é "Salvar avatar"). */
  rotuloSalvar?: string;
}) {
  const [a, setA] = useState<AvatarConfig>(inicial);
  const [cat, setCat] = useState<Categoria>("corpo");
  const [estilo, setEstilo] = useState<Estilo>("todas");
  const [previa, setPrevia] = useState<AvatarConfig | null>(null);
  const aoMudarRef = useRef(aoMudar);
  aoMudarRef.current = aoMudar;
  useEffect(() => {
    aoMudarRef.current?.(JSON.stringify(a) !== JSON.stringify(inicial), a);
  }, [a, inicial]);
  const mudar = (parte: Partial<AvatarConfig>) => {
    setA((v) => ({ ...v, ...parte }));
    setPrevia(null);
  };

  /* A prévia espera um instante: passar o mouse correndo pela grade não pode
     remontar o avatar grande a cada opção cruzada. */
  const espera = useRef<number | undefined>(undefined);
  const prever = (parte: Partial<AvatarConfig> | null) => {
    window.clearTimeout(espera.current);
    espera.current = window.setTimeout(() => setPrevia(parte ? { ...a, ...parte } : null), 140);
  };
  useEffect(() => () => window.clearTimeout(espera.current), []);

  const sortear = () => {
    const um = <T,>(l: readonly T[]) => l[Math.floor(Math.random() * l.length)]!;
    // "Nenhum" sai mais vezes nos opcionais, senão todo sorteio vira fantasia.
    const talvez = <T,>(l: readonly { v: T }[], chance: number) =>
      Math.random() < chance ? um(l).v : l[0]!.v;
    setA({
      pele: um(TONS_DE_PELE),
      corpo: um(OPCOES.corpo).v,
      cabeca: um(OPCOES.cabeca).v,
      expressao: um(OPCOES.expressao).v,
      olhos: um(CORES_DE_OLHOS),
      detalhe: talvez(OPCOES.detalhe, 0.4),
      cabelo: um(OPCOES.cabelo).v,
      corCabelo: um(CORES_DE_CABELO),
      chapeu: talvez(OPCOES.chapeu, 0.35),
      corChapeu: um(CORES_DE_CHAPEU),
      barba: talvez(OPCOES.barba, 0.45),
      oculos: talvez(OPCOES.oculos, 0.35),
      roupa: um(OPCOES.roupa).v,
      corRoupa: um(CORES_DE_ROUPA),
      estampa: talvez(OPCOES.estampa, 0.4),
      calca: um(OPCOES.calca).v,
      corCalca: um(CORES_DE_CALCA),
      sapato: um(OPCOES.sapato).v,
      corSapato: um(CORES_DE_SAPATO),
      acessorio: talvez(OPCOES.acessorio, 0.4),
      mechas: talvez(OPCOES.mechas, 0.3),
      corMechas: um(CORES_DE_MECHAS),
      corRoupa2: um(CORES_DE_ROUPA),
    });
    setPrevia(null);
  };

  /** Uma grade de opções com fotinha, ligada a um campo do avatar. */
  const grade = <K extends keyof typeof OPCOES>(
    campo: K & keyof AvatarConfig,
    quadro: Quadro,
    extra: Partial<AvatarConfig> = {},
    filtrar?: (v: string) => boolean,
  ) => {
    const lista = (OPCOES[campo] as readonly { v: string; rotulo: string }[])
      .filter((o) => !filtrar || filtrar(o.v))
      // O uniforme da empresa vem primeiro na parte de cima (19/10/2026).
      .sort((a, b) => Number(PRIMEIRO.has(b.v)) - Number(PRIMEIRO.has(a.v)));
    return (
      <Grade
        lista={lista}
        valor={a[campo] as string}
        quadro={quadro}
        base={MODELO_DA_VITRINE}
        campo={campo}
        extra={extra}
        aoEscolher={(v) => mudar({ [campo]: v } as Partial<AvatarConfig>)}
        aoPrever={(v) => prever(v === null ? null : ({ [campo]: v } as Partial<AvatarConfig>))}
      />
    );
  };

  /* O mesmo filtro vale para cabelo e rosto (16/10/2026): feminino mostra o
     feminino + o unissex; masculino, o masculino + o unissex. */
  const peloEstilo = (fem: ReadonlySet<string>, masc: ReadonlySet<string>) => (v: string) =>
    estilo === "todas" || (estilo === "f" ? !masc.has(v) : !fem.has(v));
  const cabeloDoEstilo = peloEstilo(CABELOS_FEMININOS, CABELOS_MASCULINOS);
  const rostoDoEstilo = peloEstilo(EXPRESSOES_FEMININAS, new Set<string>());
  const doEstilo = (v: string) =>
    estilo === "todas" || (estilo === "f" ? !ROUPAS_MASCULINAS.has(v) : !ROUPAS_FEMININAS.has(v));
  const inteira = ROUPA_INTEIRA.has(a.roupa);

  return (
    /* Ocupa a tela toda (19/10/2026: "preencher esse espaço em branco,
       expandir para os lados"): o boneco cresce com a janela, e o catálogo
       ganha colunas quanto mais largo ele fica. */
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(520px,48%)]">
      <FabricaDeMiniaturas />
      <div className="relative h-[calc(100vh-170px)] min-h-[460px] overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-sky-100 to-slate-200 dark:from-slate-800 dark:to-slate-900">
        {/* Corpo inteiro: a câmera mira o meio do avatar em pé, de longe o
            bastante para caber da cabeça ao sapato (e a cartola). Arrastar
            gira; sozinho, ele gira devagar. */}
        <SemTresD>
          <Canvas camera={{ position: [0, 1.1, 4.6], fov: 34 }}>
            <hemisphereLight args={["#ffffff", "#9ca3af", 1.1]} />
            <directionalLight position={[2, 3, 2.5]} intensity={1.3} />
            <directionalLight position={[-2, 2, -1]} intensity={0.4} />
            <Avatar3D config={previa ?? a} mostrarNome={false} pose="em-pe" />
            <mesh rotation-x={-Math.PI / 2}>
              <circleGeometry args={[0.6, 48]} />
              <meshStandardMaterial color="#cbd5e1" />
            </mesh>
            <OrbitControls
              target={[0, 1.0, 0]}
              enablePan={false}
              autoRotate
              autoRotateSpeed={1.2}
              minDistance={1.2}
              maxDistance={5.5}
              minPolarAngle={Math.PI / 4}
              maxPolarAngle={Math.PI / 1.9}
            />
          </Canvas>
        </SemTresD>
        {previa && (
          <div className="absolute left-3 top-3 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground shadow">
            Prévia — clique para vestir
          </div>
        )}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
          {nome}
        </div>
      </div>

      <div className="flex h-[calc(100vh-170px)] min-h-[460px] overflow-hidden rounded-2xl border border-border bg-card">
        {/* As categorias numa coluna de ícones, como a do Roblox. */}
        <nav className="flex w-[72px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-secondary/30 p-1.5">
          {CATEGORIAS.map(({ id, rotulo, Icone }) => (
            <button
              key={id}
              type="button"
              onClick={() => setCat(id)}
              className={`flex flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-[10px] font-semibold transition ${
                cat === id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <Icone className="h-5 w-5" />
              {rotulo}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto p-4" onMouseLeave={() => prever(null)}>
            {cat === "corpo" && (
              <>
                <Grupo titulo="Tipo de cabeça">{grade("cabeca", "rosto")}</Grupo>
                <Grupo titulo="Tipo de corpo">{grade("corpo", "corpo")}</Grupo>
                <Grupo titulo="Cor da pele">
                  <Cores
                    lista={TONS_DE_PELE}
                    valor={a.pele}
                    aoEscolher={(pele) => mudar({ pele })}
                  />
                </Grupo>
              </>
            )}

            {cat === "rosto" && (
              <>
                <FiltroDeEstilo valor={estilo} aoMudar={setEstilo} />
                <Grupo titulo="Expressão">{grade("expressao", "rosto", {}, rostoDoEstilo)}</Grupo>
                <Grupo titulo="Cor dos olhos">
                  <Cores
                    lista={CORES_DE_OLHOS}
                    valor={a.olhos}
                    aoEscolher={(olhos) => mudar({ olhos })}
                  />
                </Grupo>
                <Grupo titulo="Detalhe">{grade("detalhe", "rosto")}</Grupo>
                <Grupo titulo="Barba e bigode" dica="A barba usa a cor do cabelo.">
                  {grade("barba", "rosto", {}, (v) => estilo !== "f" || v === "nenhuma")}
                </Grupo>
              </>
            )}

            {cat === "cabelo" && (
              <>
                {/* A fotinha do penteado sai sem chapéu: senão o chapéu cobre o que se escolhe. */}
                <FiltroDeEstilo valor={estilo} aoMudar={setEstilo} />
                <Grupo titulo="Penteado">
                  {grade("cabelo", "cabelo", { chapeu: "nenhum" }, cabeloDoEstilo)}
                </Grupo>
                <Grupo titulo="Cor do cabelo e da barba">
                  <Cores
                    lista={CORES_DE_CABELO}
                    valor={a.corCabelo}
                    aoEscolher={(corCabelo) => mudar({ corCabelo })}
                  />
                </Grupo>
                <Grupo titulo="Mechas">{grade("mechas", "cabelo", { chapeu: "nenhum" })}</Grupo>
                {a.mechas !== "nenhuma" && (
                  <Grupo titulo="Cor das mechas">
                    <Cores
                      lista={CORES_DE_MECHAS}
                      valor={a.corMechas}
                      aoEscolher={(corMechas) => mudar({ corMechas })}
                    />
                  </Grupo>
                )}
              </>
            )}

            {cat === "cima" && (
              <>
                <FiltroDeEstilo valor={estilo} aoMudar={setEstilo} />
                <Grupo titulo="Parte de cima">{grade("roupa", "tronco", {}, doEstilo)}</Grupo>
                <Grupo titulo="Cor principal">
                  <Cores
                    lista={CORES_DE_ROUPA}
                    valor={a.corRoupa}
                    aoEscolher={(corRoupa) => mudar({ corRoupa })}
                  />
                </Grupo>
                <Grupo titulo="Cor dos detalhes" dica="Listras, xadrez, gola, babado, laço…">
                  <Cores
                    lista={CORES_DE_ROUPA}
                    valor={a.corRoupa2}
                    aoEscolher={(corRoupa2) => mudar({ corRoupa2 })}
                  />
                </Grupo>
                {COM_ESTAMPA.has(a.roupa) && (
                  <Grupo titulo="Estampa">{grade("estampa", "tronco")}</Grupo>
                )}
              </>
            )}

            {cat === "baixo" &&
              (inteira ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Essa peça de cima já cobre as pernas. Troque em <b>Cima</b> para escolher calça,
                  saia ou short.
                </p>
              ) : (
                <>
                  <FiltroDeEstilo valor={estilo} aoMudar={setEstilo} />
                  <Grupo titulo="Parte de baixo">{grade("calca", "pernas", {}, doEstilo)}</Grupo>
                  <Grupo titulo="Cor">
                    <Cores
                      lista={CORES_DE_CALCA}
                      valor={a.corCalca}
                      aoEscolher={(corCalca) => mudar({ corCalca })}
                    />
                  </Grupo>
                </>
              ))}

            {cat === "pes" && (
              <>
                <FiltroDeEstilo valor={estilo} aoMudar={setEstilo} />
                <Grupo titulo="Calçado">{grade("sapato", "pes", {}, doEstilo)}</Grupo>
                <Grupo titulo="Cor">
                  <Cores
                    lista={CORES_DE_SAPATO}
                    valor={a.corSapato}
                    aoEscolher={(corSapato) => mudar({ corSapato })}
                  />
                </Grupo>
              </>
            )}

            {cat === "extras" && (
              <>
                {/* Chapéus e enfeites de cabeça moraram numa aba própria; vieram
                    para Extras (16/10/2026). */}
                <Grupo titulo="Chapéu e enfeite">{grade("chapeu", "chapeu")}</Grupo>
                {a.chapeu !== "nenhum" && a.chapeu !== "coroa" && (
                  <Grupo titulo="Cor">
                    <Cores
                      lista={CORES_DE_CHAPEU}
                      valor={a.corChapeu}
                      aoEscolher={(corChapeu) => mudar({ corChapeu })}
                    />
                  </Grupo>
                )}

                <Grupo titulo="Óculos">{grade("oculos", "rosto")}</Grupo>
                <Grupo titulo="Acessório">{grade("acessorio", "tronco")}</Grupo>
                {/* Acessórios que usam a cor do chapéu como cor própria (16/10/2026). */}
                {ACESSORIOS_COM_COR.has(a.acessorio) && (
                  <Grupo
                    titulo={a.acessorio === "foneNoPescoco" ? "Cor do fone" : "Cor do acessório"}
                  >
                    <Cores
                      lista={CORES_DE_CHAPEU}
                      valor={a.corChapeu}
                      aoEscolher={(corChapeu) => mudar({ corChapeu })}
                    />
                  </Grupo>
                )}
              </>
            )}
          </div>

          {/* Salvar no meio do rodapé (20/10/2026): na ponta direita ele ficava
              escondido atrás dos botões flutuantes do app. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-border p-3">
            <button
              type="button"
              onClick={sortear}
              className="inline-flex items-center gap-1.5 justify-self-start rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Shuffle className="h-3.5 w-3.5" /> Sortear
            </button>
            <button
              type="button"
              disabled={salvando}
              onClick={() => aoSalvar(a)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:brightness-110 disabled:opacity-60"
            >
              <Check className="h-4 w-4" /> {salvando ? "Salvando…" : rotuloSalvar}
            </button>
            <div className="justify-self-end">
              {aoCancelar && (
                <button
                  type="button"
                  onClick={aoCancelar}
                  className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Grupo({
  titulo,
  dica,
  children,
}: {
  titulo: string;
  dica?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {titulo}
        </h3>
        {dica && <span className="text-[11px] text-muted-foreground/80">{dica}</span>}
      </div>
      {children}
    </section>
  );
}

function FiltroDeEstilo({ valor, aoMudar }: { valor: Estilo; aoMudar: (v: Estilo) => void }) {
  const opcoes: [Estilo, string][] = [
    ["todas", "Todas"],
    ["f", "Femininas"],
    ["m", "Masculinas"],
  ];
  return (
    <div className="inline-flex rounded-full border border-border p-0.5 text-xs font-semibold">
      {opcoes.map(([v, rotulo]) => (
        <button
          key={v}
          type="button"
          onClick={() => aoMudar(v)}
          className={`rounded-full px-3 py-1 transition ${
            valor === v
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {rotulo}
        </button>
      ))}
    </div>
  );
}

/** Opções que abrem a grade, antes das outras (o uniforme). */
const PRIMEIRO: ReadonlySet<string> = new Set(["uniformeSocial", "uniformePolo"]);

/** Doze à mostra (duas ou três fileiras, conforme a largura); o "+" abre o resto. */
const A_MOSTRA = 12;

function Grade({
  lista,
  valor,
  quadro,
  base,
  campo,
  extra,
  aoEscolher,
  aoPrever,
}: {
  lista: readonly { v: string; rotulo: string }[];
  valor: string;
  quadro: Quadro;
  base: AvatarConfig;
  campo: keyof AvatarConfig;
  extra: Partial<AvatarConfig>;
  aoEscolher: (v: string) => void;
  aoPrever: (v: string | null) => void;
}) {
  const [aberta, setAberta] = useState(false);
  // A escolhida sempre à mostra, mesmo se estiver lá no fim da lista.
  let visiveis = lista;
  if (!aberta && lista.length > A_MOSTRA) {
    visiveis = lista.slice(0, A_MOSTRA - 1);
    const escolhida = lista.find((o) => o.v === valor);
    if (escolhida && !visiveis.includes(escolhida))
      visiveis = [...visiveis.slice(0, -1), escolhida];
  }
  const escondidas = lista.length - visiveis.length;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
      {visiveis.map((o) => (
        <Peca
          key={o.v}
          rotulo={o.rotulo}
          ativa={o.v === valor}
          config={{ ...base, ...extra, [campo]: o.v }}
          quadro={quadro}
          aoClicar={() => aoEscolher(o.v)}
          aoEntrar={() => aoPrever(o.v)}
        />
      ))}
      {escondidas > 0 && (
        <button
          type="button"
          onClick={() => setAberta(true)}
          className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-muted-foreground transition hover:border-primary/60 hover:text-primary"
        >
          <Plus className="h-6 w-6" />
          <span className="text-[11px] font-semibold">mais {escondidas}</span>
        </button>
      )}
      {aberta && lista.length > A_MOSTRA && (
        <button
          type="button"
          onClick={() => setAberta(false)}
          className="col-span-full rounded-md py-1 text-[11px] font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Mostrar menos
        </button>
      )}
    </div>
  );
}

function Peca({
  rotulo,
  ativa,
  config,
  quadro,
  aoClicar,
  aoEntrar,
}: {
  rotulo: string;
  ativa: boolean;
  config: AvatarConfig;
  quadro: Quadro;
  aoClicar: () => void;
  aoEntrar: () => void;
}) {
  const foto = useMiniatura(config as AvatarConfig, quadro);
  return (
    <button
      type="button"
      title={rotulo}
      aria-pressed={ativa}
      onClick={aoClicar}
      onMouseEnter={aoEntrar}
      className={`group relative flex aspect-square flex-col overflow-hidden rounded-xl border-2 bg-gradient-to-b from-sky-50 to-slate-200 transition hover:-translate-y-0.5 hover:shadow-md dark:from-slate-700 dark:to-slate-900 ${
        ativa ? "border-primary ring-2 ring-primary/30" : "border-transparent"
      }`}
    >
      {foto ? (
        <img src={foto} alt="" className="min-h-0 w-full flex-1 object-contain" draggable={false} />
      ) : (
        <span className="m-2 flex-1 animate-pulse rounded-lg bg-white/50 dark:bg-white/10" />
      )}
      <span
        className={`truncate px-1 pb-1 text-[10px] font-semibold leading-tight ${
          ativa ? "text-primary" : "text-foreground/80"
        }`}
      >
        {rotulo}
      </span>
      {ativa && (
        <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
          <Check className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}

/* ————————————————— Cores ————————————————— */

function hslParaHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** A paleta inteira: 12 tons × 6 claridades, mais os cinzas. */
const PALETA: string[] = [
  ...[92, 80, 66, 52, 38, 24].flatMap((l) =>
    Array.from({ length: 12 }, (_, i) => hslParaHex(i * 30, l > 85 ? 70 : 78, l)),
  ),
  ...[100, 85, 70, 55, 40, 28, 16, 6].map((l) => hslParaHex(0, 0, l)),
];

function Cores({
  lista,
  valor,
  aoEscolher,
}: {
  lista: string[];
  valor: string;
  aoEscolher: (c: string) => void;
}) {
  const principais = lista.slice(0, CORES_A_MOSTRA);
  // Uma cor escolhida na paleta aparece junto das principais, marcada.
  const fora = !principais.some((c) => c.toLowerCase() === valor.toLowerCase());
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {principais.map((c) => (
        <Bolinha
          key={c}
          cor={c}
          ativa={c.toLowerCase() === valor.toLowerCase()}
          aoClicar={() => aoEscolher(c)}
        />
      ))}
      {fora && <Bolinha cor={valor} ativa aoClicar={() => undefined} />}
      <Paleta valor={valor} aoEscolher={aoEscolher} />
    </div>
  );
}

function Bolinha({ cor, ativa, aoClicar }: { cor: string; ativa: boolean; aoClicar: () => void }) {
  return (
    <button
      type="button"
      aria-label={cor}
      aria-pressed={ativa}
      onClick={aoClicar}
      className={`h-7 w-7 rounded-full border-2 transition hover:scale-110 ${
        ativa ? "border-primary ring-2 ring-primary/40" : "border-white/70 shadow-sm"
      }`}
      style={{ background: cor }}
    />
  );
}

function Paleta({ valor, aoEscolher }: { valor: string; aoEscolher: (c: string) => void }) {
  const [hex, setHex] = useState(valor);
  useEffect(() => setHex(valor), [valor]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Mais cores"
          aria-label="Mais cores"
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white/70 shadow-sm transition hover:scale-110"
          style={{
            background:
              "conic-gradient(#ef4444,#f59e0b,#eab308,#22c55e,#06b6d4,#3b82f6,#8b5cf6,#ec4899,#ef4444)",
          }}
        >
          <Palette className="h-3.5 w-3.5 text-white drop-shadow" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[460] w-[296px] p-3">
        <div className="mb-2 text-xs font-semibold">Todas as cores</div>
        <div className="grid grid-cols-12 gap-1">
          {PALETA.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => aoEscolher(c)}
              className={`aspect-square rounded-[5px] transition hover:z-10 hover:scale-125 ${
                c.toLowerCase() === valor.toLowerCase() ? "ring-2 ring-primary ring-offset-1" : ""
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
          <label className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border">
            <span className="absolute inset-0" style={{ background: hex }} />
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#000000"}
              onChange={(e) => aoEscolher(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Escolher qualquer cor"
            />
          </label>
          <input
            value={hex}
            onChange={(e) => {
              const v = e.target.value.trim();
              setHex(v);
              if (/^#[0-9a-f]{6}$/i.test(v)) aoEscolher(v.toLowerCase());
            }}
            spellCheck={false}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary"
            placeholder="#RRGGBB"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
