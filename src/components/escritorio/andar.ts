/*
 * A planta do ANDAR inteiro. Funções puras.
 *
 * (27/10/2026) Pela planta de verdade do escritório, que o usuário mandou com
 * as divisórias desenhadas por cima: cada sala no lugar dela, com a porta onde
 * ela fica. Antes (18/10/2026) o andar era inventado — um corredor comprido com
 * as salas dos dois lados, agrupadas por gerência.
 *
 *                              ┌──────────────────────────────┐
 *                              │ REFEITÓRIO · TREINAMENTO     │
 *                              │          CULTIVAR            │
 *          ┌──────┬─────┬───┬───┬┴─────────┬──▯─┬──────────────┘
 *          │REUNIÃO│ALINE│PAU│ELI│CONTROLA- │ c │     TI       │
 *          │       │     │LO │SAM│  DORIA   │ o │              │
 *          ├─┬─────┴─────┴───┴───┴──────────┘ r ▯              │
 *          │WC▯           corredor              r │              │
 *          ├─┴─▯──┬───────┬──────┬──────────┐ e ├──────────────┤
 *          │RODRI-│LEANDRO│MSAGRO│FINANCEIRO│ d │ SUPRIMENTOS  │
 *          │  GO  │       │      │          │ o ├──────────────┤
 *          ├───┬──┴───────┴──────┴──────────┤ r │    GERAL     │
 *          │WC2▯         corredor            │   │              │
 *          └┬──┴──┬────────┬──────┬────────┤   └──────────────┘
 *           │FROTAS│SEGURAN.│ DHO  │ATEND. 2│   SALA DE ESPERA
 *           └──────┴────────┴──┬───┴────────┤   ┌──────────┐
 *              ENTRADA ──▶ ▯ RECEPÇÃO   │   │          │
 *                              ├────────────┤   │    RH    │
 *                              │ATENDIMENTO ▯   │          │
 *                              ├────────────┴─▯─┤          │
 *                              │ SALA DE REUNIÃO│          │
 *                              └────────────────┴──────────┘
 *
 * (09/11/2026) Pelo segundo esboço do usuário: TI, Suprimentos e Geral são uma
 * coluna só, rente ao corredor e da mesma largura. O corredor do lado sobe reto
 * entre a Controladoria e a TI até a porta do refeitório, que é uma sala só
 * junto com o treinamento do Cultivar, em cima. A sala "Paulo e Contabilidade"
 * foi dividida ao meio: uma salinha para o Paulo e outra para a Elisama. A
 * largura da coluna da direita é estimada (foi cortada na foto).
 *
 * As medidas da planta são em metros e o 3D as aumenta (`ESCALA`): as salas
 * reais têm 2 a 3 m, pouco para mesas com bonecos em volta. A proporção entre
 * as salas fica a da planta.
 *
 * Coordenadas: x da esquerda para a direita da planta, z de cima para baixo.
 * Dentro de uma sala, o referencial LOCAL tem a porta principal em +z.
 */
import type { Situacao } from "./moveis";

export type PessoaNoAndar = {
  id: string;
  nome: string;
  cargo: string;
  role: string;
  setor: string;
  supervisorId?: string;
  /** O nome do chefe no organograma — sobe a linha mesmo quando o chefe não usa o CONECTA. */
  supervisorNome?: string;
  situacao: Situacao;
  /**
   * O status personalizado do chat (19/10/2026), já sem o vencido — aparece no
   * chip do nome. Quem está "🚜 Em campo", de férias ou de atestado chega aqui
   * com a situação "offline" (ver `escritorio-do-setor`): mesa vazia com o
   * nome e o status, nem sentado trabalhando nem no refeitório.
   */
  status?: { emoji: string; texto: string };
};

export type SetorDoAndar = { id: string; nome: string; cor: string };

/** Um lugar de trabalho: a cadeira no chão (mundo) e para onde a pessoa olha. */
export type MesaNoAndar = {
  x: number;
  z: number;
  rotY: number;
  gestor: boolean;
  pessoa: PessoaNoAndar | null;
  /** A mesa é de alguém que ainda não usa o CONECTA: só o nome na mesa. */
  nomeFixo?: string;
  /** O balcão alto da recepção, em vez da mesa comum. */
  balcao?: boolean;
};

/** Um lugar de pé (refeitório) ou de sentar sem mesa. */
export type LugarDePe = {
  x: number;
  z: number;
  rotY: number;
  /** Sentado no banco da mesa comprida (refeitório); sem isso, de pé. */
  sentado?: boolean;
  /** Na frente de quem está sentado: caneca ou prato (para variar a mesa). */
  naMesa?: "caneca" | "prato";
};

export type TipoDeSala =
  | "setor"
  | "gerencia"
  | "reuniao"
  | "atendimento"
  | "recepcao"
  | "espera"
  | "banheiro"
  | "refeitorio";

/** O lado da sala na planta: norte (em cima), sul, leste (direita), oeste. */
export type Lado = "n" | "s" | "l" | "o";

/** Uma porta: o centro dela, no chão (mundo), e a parede onde fica. */
export type PortaNoAndar = { lado: Lado; x: number; z: number };

export type SalaNoAndar = {
  id: string;
  tipo: TipoDeSala;
  titulo: string;
  cor: string;
  /** Limites no mundo. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** O giro do referencial local: para onde a porta principal olha. */
  giro: number;
  /** No referencial local: ao longo da parede da porta, e da porta até o fundo. */
  largura: number;
  fundo: number;
  /** A primeira é a principal (a da placa). */
  portas: PortaNoAndar[];
  mesas: MesaNoAndar[];
  /** A gerência desta área (a chave de `GERENCIAS`, ou o id do gerente). */
  gerenteId: string | null;
  /** Os setores de quem senta aqui — "Ir para" um setor cai nesta sala. */
  setores: string[];
  /** Só no refeitório: quantas mesas compridas (com bancos). */
  mesasCompridas?: number;
  /** Sem divisórias próprias (a sala de espera é o hall). */
  aberta?: boolean;
  /** A etiqueta de longe: linha de cima (no lugar do título) e de baixo (no lugar da contagem). */
  rotulo?: string;
  subtitulo?: string;
};

/** Um trecho de parede, já sem as repetidas entre salas vizinhas. */
export type ParedeNoAndar = {
  de: [number, number];
  ate: [number, number];
  /** Distância do `de` até o centro da porta. */
  porta?: number;
  /** Parede de fora do prédio: alvenaria, sem vidro. */
  cheia: boolean;
};

export type Caixa = { x0: number; x1: number; z0: number; z1: number };

export type AndarMontado = {
  salas: SalaNoAndar[];
  paredes: ParedeNoAndar[];
  corredores: Caixa[];
  /** O retângulo que cobre o andar todo. */
  limites: Caixa;
  /** A porta de entrada do prédio (na parede de fora), para o tapete e o letreiro. */
  entrada: PortaNoAndar | null;
  /** Quem está ausente e onde fica no refeitório. */
  naCopa: { pessoa: PessoaNoAndar; lugar: LugarDePe }[];
  /**
   * A área de cada gerência (a sala dela + as salas dos setores que respondem
   * a ela), para a câmera ir até lá. Chave: `g:<chave>` e também o id do
   * gerente, quando ele usa o CONECTA.
   */
  areas: Map<string, Caixa>;
};

/** Metros do 3D por metro da planta. */
const ESCALA = 2.3;
const ENTRE_COLUNAS = 1.95;
const ENTRE_FILAS = 1.8;

/**
 * As gerências (18/10/2026: "sala da gerência do Leandro, Rodrigo e da
 * Aline"). Ficam aqui, com o nome do organograma, porque nem todo gerente usa
 * o CONECTA — a sala existe mesmo assim, com o nome na mesa. Quem entrar no
 * app com esse nome senta ali sozinho.
 */
export const GERENCIAS = [
  {
    chave: "leandro",
    nome: "LEANDRO DLUGOSZ DA SILVA",
    titulo: "Gerência Operacional",
    cor: "#16a34a",
  },
  {
    chave: "rodrigo",
    nome: "RODRIGO DLUGOSZ DA SILVA",
    titulo: "Gerência Financeira",
    cor: "#f97316",
  },
  {
    chave: "aline",
    nome: "ALINE DLUGOSZ DA SILVA",
    titulo: "Gerência Administrativa",
    cor: "#8b5cf6",
  },
] as const;

/** Quem fica no balcão da recepção (continua no setor e com o chefe de sempre). */
export const NA_RECEPCAO = ["TAILINI"] as const;

/** "Érica  Silva" → "ERICA SILVA": para comparar nomes do app com os do organograma. */
export const normalizar = (nome: string) =>
  nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const primeiroNormalizado = (nome: string) => normalizar(nome).split(" ")[0] ?? "";

/**
 * Quem senta na mesa da frente de cada sala: o supervisor com mais gente
 * abaixo dele (gerentes têm sala própria e não entram aqui).
 */
export function escolherGestor<T extends { id: string; role: string; supervisorId?: string }>(
  pessoas: T[],
): T | null {
  const abaixo = (id: string) => pessoas.filter((p) => p.supervisorId === id).length;
  const por = (papel: string) =>
    pessoas.filter((p) => p.role === papel).sort((a, b) => abaixo(b.id) - abaixo(a.id))[0];
  return por("gerente") ?? por("supervisor") ?? null;
}

/* ————————————————— A planta (em metros) ————————————————— */

type Faixa = [number, number];

type SalaDaPlanta = {
  id: string;
  tipo: TipoDeSala;
  titulo: string;
  x: Faixa;
  z: Faixa;
  /** A primeira é a principal. `em`: fração da parede, a partir do canto de cima/esquerda. */
  portas: { lado: Lado; em: number }[];
  cor?: string;
  /** Quem senta aqui: pelos setores e por nome (o nome manda). */
  setores?: string[];
  pessoas?: string[];
  gerencia?: (typeof GERENCIAS)[number]["chave"];
  /** A sala que recebe quem não tem sala própria na planta. */
  resto?: boolean;
  /** Salinha individual: uma mesa por pessoa, sem a mesa vazia do gestor. */
  individual?: boolean;
  /** O nome na mesa da salinha individual enquanto a pessoa não usa o CONECTA. */
  nomeFixo?: string;
  aberta?: boolean;
  /** A porta principal desta sala é a entrada do prédio (dá para fora). */
  entrada?: boolean;
};

const PLANTA: SalaDaPlanta[] = [
  // A fileira de cima, com a porta para o corredor de cima.
  {
    id: "reuniao-1",
    tipo: "reuniao",
    titulo: "Sala de reunião",
    x: [0, 2.65],
    z: [-2.1, 1.1],
    portas: [{ lado: "s", em: 0.84 }],
  },
  {
    id: "gerencia-aline",
    tipo: "gerencia",
    titulo: "Aline",
    gerencia: "aline",
    x: [2.65, 4.4],
    z: [-2.1, 1.1],
    portas: [{ lado: "s", em: 0.75 }],
  },
  // A antiga "Paulo e Contabilidade", dividida ao meio (09/11/2026).
  {
    id: "sala-paulo",
    tipo: "setor",
    titulo: "Paulo",
    pessoas: ["PAULO DE JESUS MACHADO"],
    individual: true,
    nomeFixo: "Paulo",
    x: [4.4, 5.58],
    z: [-2.1, 1.1],
    portas: [{ lado: "s", em: 0.7 }],
  },
  {
    id: "contabil",
    tipo: "setor",
    titulo: "Elisama",
    setores: ["contabil"],
    pessoas: ["ELISAMA"],
    individual: true,
    nomeFixo: "Elisama",
    x: [5.58, 6.75],
    z: [-2.1, 1.1],
    portas: [{ lado: "s", em: 0.7 }],
  },
  {
    id: "controladoria",
    tipo: "setor",
    titulo: "Controladoria",
    setores: ["controladoria"],
    x: [6.75, 9.1],
    z: [-2.1, 1.1],
    portas: [{ lado: "s", em: 0.75 }],
  },
  {
    id: "ti",
    tipo: "setor",
    titulo: "TI",
    setores: ["ti"],
    x: [10.4, 14.0],
    z: [-2.1, 2.45],
    portas: [{ lado: "o", em: 0.55 }],
  },
  // Em cima: refeitório e treinamento do Cultivar, uma sala só, com a porta
  // no fim do corredor que sobe ao lado da TI.
  {
    id: "refeitorio",
    tipo: "refeitorio",
    titulo: "Refeitório · Treinamento Cultivar",
    cor: "#b45309",
    x: [6.75, 14.0],
    z: [-5.3, -2.1],
    portas: [{ lado: "s", em: 0.414 }],
  },
  {
    id: "banheiro",
    tipo: "banheiro",
    titulo: "BWC",
    cor: "#64748b",
    x: [0, 1.6],
    z: [1.1, 2.45],
    portas: [{ lado: "l", em: 0.5 }],
  },
  // O bloco do meio. A porta do Rodrigo é em cima, ao lado do banheiro (09/11/2026).
  {
    id: "gerencia-rodrigo",
    tipo: "gerencia",
    titulo: "Rodrigo",
    gerencia: "rodrigo",
    x: [0, 2.35],
    z: [2.45, 5.6],
    portas: [{ lado: "n", em: 0.84 }],
  },
  // O segundo banheiro, no começo do corredor entre Rodrigo e Frotas.
  {
    id: "banheiro-2",
    tipo: "banheiro",
    titulo: "BWC 2",
    cor: "#64748b",
    x: [0, 1.4],
    z: [5.6, 6.7],
    portas: [{ lado: "l", em: 0.5 }],
  },
  {
    id: "gerencia-leandro",
    tipo: "gerencia",
    titulo: "Leandro",
    gerencia: "leandro",
    x: [2.35, 4.8],
    z: [2.45, 5.6],
    portas: [{ lado: "n", em: 0.3 }],
  },
  {
    id: "msagro",
    tipo: "setor",
    titulo: "MSAgro",
    cor: "#0d9488",
    x: [4.8, 6.55],
    z: [2.45, 5.6],
    portas: [{ lado: "n", em: 0.5 }],
  },
  {
    id: "financeiro",
    tipo: "setor",
    titulo: "Financeiro",
    setores: ["financeiro"],
    x: [6.55, 9.1],
    z: [2.45, 5.6],
    portas: [{ lado: "n", em: 0.75 }],
  },
  // O bloco de baixo, aberto para o corredor estreito.
  {
    id: "frotas",
    tipo: "setor",
    titulo: "Frotas",
    setores: ["frotas"],
    x: [0.6, 3.15],
    z: [6.7, 9.4],
    portas: [{ lado: "n", em: 0.75 }],
  },
  {
    id: "seguranca",
    tipo: "setor",
    titulo: "Segurança",
    setores: ["seguranca"],
    x: [3.15, 5.35],
    z: [6.7, 9.4],
    portas: [{ lado: "n", em: 0.7 }],
  },
  {
    id: "dho",
    tipo: "setor",
    titulo: "DHO e C.A.",
    setores: ["dho"],
    x: [5.35, 7.3],
    z: [6.7, 9.4],
    portas: [{ lado: "n", em: 0.6 }],
  },
  {
    id: "atendimento-2",
    tipo: "atendimento",
    titulo: "Sala de atendimento 2",
    x: [7.3, 9.1],
    z: [6.7, 9.4],
    portas: [{ lado: "n", em: 0.5 }],
  },
  // A coluna da direita, com a porta para o corredor do lado.
  {
    id: "suprimentos",
    tipo: "setor",
    titulo: "Suprimentos",
    setores: ["compras", "suprimentos"],
    x: [10.4, 14.0],
    z: [2.45, 4.9],
    portas: [{ lado: "o", em: 0.5 }],
  },
  {
    id: "geral",
    tipo: "setor",
    titulo: "Geral",
    resto: true,
    cor: "#475569",
    x: [10.4, 14.0],
    z: [4.9, 8.4],
    portas: [{ lado: "o", em: 0.62 }],
  },
  {
    id: "espera",
    tipo: "espera",
    titulo: "Sala de espera",
    cor: "#0f766e",
    aberta: true,
    x: [9.1, 14.0],
    z: [8.4, 11.5],
    portas: [{ lado: "o", em: 0.5 }],
  },
  {
    id: "rh",
    tipo: "setor",
    titulo: "RH",
    setores: ["rh"],
    x: [10.4, 14.0],
    z: [11.5, 16.5],
    portas: [{ lado: "n", em: 0.25 }],
  },
  // A entrada do prédio é a porta da esquerda da recepção (09/11/2026): de
  // fora, cai de frente para o balcão. A da direita dá na sala de espera.
  {
    id: "recepcao",
    tipo: "recepcao",
    titulo: "Recepção",
    cor: "#0f766e",
    entrada: true,
    x: [6.36, 9.1],
    z: [9.4, 12.0],
    portas: [
      { lado: "o", em: 0.5 },
      { lado: "l", em: 0.4 },
    ],
  },
  {
    id: "atendimento-1",
    tipo: "atendimento",
    titulo: "Sala de atendimento",
    x: [6.36, 9.1],
    z: [12.0, 14.5],
    portas: [{ lado: "l", em: 0.6 }],
  },
  {
    id: "reuniao-2",
    tipo: "reuniao",
    titulo: "Sala de reunião 2",
    x: [6.36, 10.4],
    z: [14.5, 17.45],
    portas: [{ lado: "n", em: 0.84 }],
  },
];

/** As passagens (sem parede própria: as paredes são as das salas). */
const CORREDORES: { x: Faixa; z: Faixa }[] = [
  { x: [1.6, 9.1], z: [1.1, 2.45] },
  // O corredor do lado: reto, da porta do refeitório até a sala de espera.
  { x: [9.1, 10.4], z: [-2.1, 8.4] },
  { x: [1.4, 9.1], z: [5.6, 6.7] },
  { x: [9.1, 10.4], z: [11.5, 14.5] },
];

const COR_DO_TIPO: Record<TipoDeSala, string> = {
  setor: "#475569",
  gerencia: "#7c3aed",
  reuniao: "#0369a1",
  atendimento: "#0369a1",
  recepcao: "#0f766e",
  espera: "#0f766e",
  banheiro: "#64748b",
  refeitorio: "#b45309",
};

const GIRO: Record<Lado, number> = { s: 0, n: Math.PI, l: Math.PI / 2, o: -Math.PI / 2 };

/* ————————————————— A montagem ————————————————— */

export function montarAndar(setores: SetorDoAndar[], pessoas: PessoaNoAndar[]): AndarMontado {
  const porId = new Map(pessoas.map((p) => [p.id, p]));
  const porNome = new Map(pessoas.map((p) => [normalizar(p.nome), p]));
  const setorPorId = new Map(setores.map((s) => [s.id, s]));

  // A planta em metros vira mundo, com o centro do andar em (0, 0).
  const todas = [...PLANTA.map((s) => ({ x: s.x, z: s.z })), ...CORREDORES];
  const px0 = Math.min(...todas.map((c) => c.x[0]));
  const px1 = Math.max(...todas.map((c) => c.x[1]));
  const pz0 = Math.min(...todas.map((c) => c.z[0]));
  const pz1 = Math.max(...todas.map((c) => c.z[1]));
  const mx = (v: number) => (v - (px0 + px1) / 2) * ESCALA;
  const mz = (v: number) => (v - (pz0 + pz1) / 2) * ESCALA;

  /* ---- quem senta onde ---- */
  const gerentes = new Map(
    GERENCIAS.map((g) => [g.chave as string, porNome.get(normalizar(g.nome)) ?? null]),
  );
  const naRecepcao = pessoas.filter((p) =>
    NA_RECEPCAO.includes(primeiroNormalizado(p.nome) as never),
  );
  const ocupados = new Set<string>([
    ...[...gerentes.values()].flatMap((p) => (p ? [p.id] : [])),
    ...naRecepcao.map((p) => p.id),
  ]);
  const ocupantes = new Map<string, PessoaNoAndar[]>();
  // Primeiro por nome (o Paulo é "Gestão" no organograma e senta na Contabilidade)…
  for (const s of PLANTA) {
    for (const nome of s.pessoas ?? []) {
      // Nome inteiro casa exato; um nome só ("ELISAMA") casa pelo primeiro nome.
      const p = nome.includes(" ")
        ? porNome.get(normalizar(nome))
        : pessoas.find((x) => primeiroNormalizado(x.nome) === normalizar(nome));
      if (!p || ocupados.has(p.id)) continue;
      ocupados.add(p.id);
      ocupantes.set(s.id, [...(ocupantes.get(s.id) ?? []), p]);
    }
  }
  // …depois pelo setor; quem sobrar vai para a sala do resto (Geral).
  const resto = PLANTA.find((s) => s.resto)!;
  for (const p of pessoas) {
    if (ocupados.has(p.id)) continue;
    const sala = PLANTA.find((s) => s.setores?.includes(p.setor)) ?? resto;
    ocupantes.set(sala.id, [...(ocupantes.get(sala.id) ?? []), p]);
  }

  /* ---- a gerência de cada sala (para "Ver a área") ---- */
  const gerenciaPorNome = new Map(GERENCIAS.map((g) => [normalizar(g.nome), g.chave as string]));
  for (const p of pessoas) {
    if (p.role === "gerente" && !gerenciaPorNome.has(normalizar(p.nome)))
      gerenciaPorNome.set(normalizar(p.nome), p.id);
  }
  /** Sobe a linha de reporte (pelo id ou pelo nome do chefe) até uma gerência. */
  const gerenciaAcima = (inicio: PessoaNoAndar | undefined): string | null => {
    let p = inicio;
    for (let i = 0; p && i < 8; i++) {
      const g = gerenciaPorNome.get(normalizar(p.nome));
      if (g) return g;
      const chefeNome = p.supervisorNome ? normalizar(p.supervisorNome) : "";
      if (chefeNome && gerenciaPorNome.has(chefeNome)) return gerenciaPorNome.get(chefeNome)!;
      const proximo: PessoaNoAndar | undefined =
        (p.supervisorId ? porId.get(p.supervisorId) : undefined) ?? porNome.get(chefeNome);
      if (!proximo || proximo === p) return null;
      p = proximo;
    }
    return null;
  };

  /* ---- as salas ---- */
  const salas: SalaNoAndar[] = PLANTA.map((d) => {
    const x0 = mx(d.x[0]);
    const x1 = mx(d.x[1]);
    const z0 = mz(d.z[0]);
    const z1 = mz(d.z[1]);
    const lado = d.portas[0]!.lado;
    const deLado = lado === "l" || lado === "o";
    const membros = (ocupantes.get(d.id) ?? []).sort((a, b) => a.nome.localeCompare(b.nome));
    const doSetor = d.setores?.length === 1 ? setorPorId.get(d.setores[0]!) : undefined;
    const sala: SalaNoAndar = {
      id: d.id,
      tipo: d.tipo,
      titulo: d.titulo,
      cor: d.cor ?? doSetor?.cor ?? COR_DO_TIPO[d.tipo],
      x0,
      x1,
      z0,
      z1,
      giro: GIRO[lado],
      largura: deLado ? z1 - z0 : x1 - x0,
      fundo: deLado ? x1 - x0 : z1 - z0,
      portas: d.portas.map((p) => {
        const v = p.lado === "l" || p.lado === "o";
        return {
          lado: p.lado,
          x: v ? (p.lado === "l" ? x1 : x0) : x0 + (x1 - x0) * p.em,
          z: v ? z0 + (z1 - z0) * p.em : p.lado === "s" ? z1 : z0,
        };
      }),
      mesas: [],
      gerenteId: null,
      setores: [...new Set([...(d.setores ?? []), ...membros.map((m) => m.setor)])],
      aberta: d.aberta,
    };
    const mundo = paraOMundo((x0 + x1) / 2, (z0 + z1) / 2, sala.giro);
    if (d.gerencia) {
      const g = GERENCIAS.find((x) => x.chave === d.gerencia)!;
      mobiliarGerencia(sala, g, gerentes.get(g.chave) ?? null, mundo);
    } else if (d.tipo === "recepcao") {
      sala.mesas.push({
        ...mundo(-0.9, -0.6, 0),
        gestor: false,
        pessoa: naRecepcao[0] ?? null,
        nomeFixo: naRecepcao[0] ? undefined : "Recepção",
        balcao: true,
      });
    } else if (d.tipo === "setor" && d.individual) {
      sentarSozinhos(sala, membros, d.nomeFixo, mundo);
      sala.gerenteId = maisVotada(
        membros.map((m) => gerenciaAcima(m)).filter((g): g is string => !!g),
      );
    } else if (d.tipo === "setor") {
      const gestor = escolherGestor(membros);
      const equipe = membros.filter((p) => p !== gestor);
      sentarEquipe(sala, gestor, equipe, mundo);
      sala.gerenteId =
        gerenciaAcima(gestor ?? undefined) ??
        maisVotada(membros.map((m) => gerenciaAcima(m)).filter((g): g is string => !!g));
      // A sala que junta vários setores diz quais são, no letreiro.
      const comNome = sala.setores.filter((id) => id !== "sem-setor");
      if (d.resto && comNome.length) {
        sala.subtitulo = comNome.map((id) => setorPorId.get(id)?.nome ?? id).join(" · ");
      }
    }
    return sala;
  });

  /* ---- o refeitório, com lugar para quem está ausente ---- */
  const refeitorio = salas.find((s) => s.tipo === "refeitorio")!;
  const ausentes = pessoas.filter((p) => p.situacao === "ausente");
  /* (19/10/2026: "aumentar o refeitório… mesa maior retangular com bancos e
     eles sentados") Mesas compridas de 6 lugares; de cada 4 pessoas, uma fica
     de pé no balcão do café (até 3). O refeitório agora tem tamanho fixo: cabem
     até 4 mesas, e quem passar disso divide um lugar. */
  const noBalcao = Math.min(3, Math.floor(ausentes.length / 4));
  const cabem = Math.max(1, Math.floor((refeitorio.largura - 2.6) / 3.4)) * 2;
  refeitorio.mesasCompridas = Math.min(
    cabem,
    Math.max(2, Math.ceil((ausentes.length - noBalcao) / 6)),
  );
  const lugaresRef = lugaresDoRefeitorio(refeitorio, refeitorio.mesasCompridas, noBalcao);
  const naCopa = ausentes.map((pessoa, i) => ({
    pessoa,
    lugar: lugaresRef[i % lugaresRef.length]!,
  }));

  /* ---- a área de cada gerência: a sala dela e as dos setores dela ---- */
  const areas = new Map<string, Caixa>();
  for (const g of GERENCIAS) {
    const daArea = salas.filter((s) => s.id === `gerencia-${g.chave}` || s.gerenteId === g.chave);
    if (!daArea.length) continue;
    const area = envolver(daArea);
    areas.set(`g:${g.chave}`, area);
    const p = gerentes.get(g.chave);
    if (p) areas.set(p.id, area);
  }

  const corredores = CORREDORES.map((c) => ({
    x0: mx(c.x[0]),
    x1: mx(c.x[1]),
    z0: mz(c.z[0]),
    z1: mz(c.z[1]),
  }));
  return {
    salas,
    paredes: levantarParedes(salas, corredores),
    corredores,
    limites: { x0: mx(px0), x1: mx(px1), z0: mz(pz0), z1: mz(pz1) },
    entrada: salas[PLANTA.findIndex((d) => d.entrada)]?.portas[0] ?? null,
    naCopa,
    areas,
  };
}

const maisVotada = (votos: string[]): string | null => {
  const n = new Map<string, number>();
  for (const v of votos) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

const envolver = (caixas: Caixa[]): Caixa => ({
  x0: Math.min(...caixas.map((c) => c.x0)),
  x1: Math.max(...caixas.map((c) => c.x1)),
  z0: Math.min(...caixas.map((c) => c.z0)),
  z1: Math.max(...caixas.map((c) => c.z1)),
});

/** Do referencial da sala (porta principal em +z) para o mundo. */
export function paraOMundo(cx: number, cz: number, giro: number) {
  const cos = Math.cos(giro);
  const sin = Math.sin(giro);
  return (lx: number, lz: number, rot: number) => ({
    x: cx + lx * cos + lz * sin,
    z: cz - lx * sin + lz * cos,
    rotY: rot + giro,
  });
}

type Mundo = ReturnType<typeof paraOMundo>;

/* ————————————————— As paredes ————————————————— */

/**
 * As paredes do andar, cada uma uma vez só. Duas salas vizinhas dividem a
 * mesma divisória: desenhada pelas duas, as faces brigavam (o vidro piscava).
 * Então cada lado de sala entra só no trecho que ainda não tem parede. Onde do
 * outro lado não há sala nem corredor, é a parede de fora: cheia, sem vidro.
 */
function levantarParedes(salas: SalaNoAndar[], corredores: Caixa[]): ParedeNoAndar[] {
  const ja = new Map<string, Faixa[]>();
  const saida: ParedeNoAndar[] = [];
  const dentro = (x: number, z: number) =>
    [...salas, ...corredores].some((c) => x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1);
  const portas = salas.flatMap((s) => s.portas);
  const r = (v: number) => Math.round(v * 1000) / 1000;

  for (const s of salas) {
    if (s.aberta) continue;
    // [horizontal?, coordenada fixa, de, até]
    const lados: [boolean, number, number, number][] = [
      [true, s.z0, s.x0, s.x1],
      [true, s.z1, s.x0, s.x1],
      [false, s.x0, s.z0, s.z1],
      [false, s.x1, s.z0, s.z1],
    ];
    for (const [horizontal, fixo, a, b] of lados) {
      const chave = `${horizontal ? "h" : "v"}${r(fixo)}`;
      const tomados = ja.get(chave) ?? [];
      for (const [p, q] of subtrair([a, b], tomados)) {
        tomados.push([p, q]);
        const ponto = (t: number): [number, number] => (horizontal ? [t, fixo] : [fixo, t]);
        // As portas que caem neste trecho; com mais de uma, o trecho é partido entre elas.
        const aqui = portas
          .map((d) =>
            horizontal
              ? Math.abs(d.z - fixo) < 0.01
                ? d.x
                : null
              : Math.abs(d.x - fixo) < 0.01
                ? d.z
                : null,
          )
          .filter((t): t is number => t !== null && t > p + 0.5 && t < q - 0.5)
          .sort((m, n) => m - n);
        const cortes = [p, ...aqui.slice(0, -1).map((t, i) => (t + aqui[i + 1]!) / 2), q];
        for (let i = 0; i < cortes.length - 1; i++) {
          const de = cortes[i]!;
          const ate = cortes[i + 1]!;
          const meio = (de + ate) / 2;
          const [mxp, mzp] = ponto(meio);
          const cheia = horizontal
            ? !dentro(mxp, mzp - 0.3) || !dentro(mxp, mzp + 0.3)
            : !dentro(mxp - 0.3, mzp) || !dentro(mxp + 0.3, mzp);
          const porta = aqui[i];
          saida.push({
            de: ponto(de),
            ate: ponto(ate),
            porta: porta !== undefined && porta > de && porta < ate ? porta - de : undefined,
            cheia,
          });
        }
      }
      ja.set(chave, tomados);
    }
  }
  return saida;
}

/** O que sobra de [a, b] tirando os trechos já tomados. */
function subtrair([a, b]: Faixa, tomados: Faixa[]): Faixa[] {
  let livres: Faixa[] = [[a, b]];
  for (const [p, q] of tomados) {
    livres = livres.flatMap(([x, y]): Faixa[] => {
      if (q <= x + 0.01 || p >= y - 0.01) return [[x, y]];
      const sobra: Faixa[] = [];
      if (p > x + 0.01) sobra.push([x, p]);
      if (q < y - 0.01) sobra.push([q, y]);
      return sobra;
    });
  }
  return livres.filter(([x, y]) => y - x > 0.05);
}

/* ————————————————— Mesas ————————————————— */

/**
 * O gestor no fundo, de frente para a porta; a equipe em fileiras, todos
 * virados para a porta. Quantas colunas e fileiras: o que a sala comporta —
 * e, se a equipe não couber, as mesas se apertam em vez de vazar da sala.
 */
function sentarEquipe(
  sala: SalaNoAndar,
  gestor: PessoaNoAndar | null,
  equipe: PessoaNoAndar[],
  mundo: Mundo,
) {
  const W = sala.largura;
  const D = sala.fundo;
  sala.mesas.push({ ...mundo(0, -D / 2 + 0.95, 0), gestor: true, pessoa: gestor });
  const total = Math.max(equipe.length, 2);
  const zIni = -D / 2 + 2.6;
  const zFim = D / 2 - 1.4;
  const maxColunas = Math.max(1, Math.floor((W - 0.5) / 1.6));
  const maxFilas = Math.max(1, Math.floor((zFim - zIni) / 1.55) + 1);
  let filas = Math.min(maxFilas, Math.ceil(total / maxColunas));
  if (filas * maxColunas < total) filas = Math.ceil(total / maxColunas);
  const colunas = Math.ceil(total / filas);
  const entreColunas = Math.min(ENTRE_COLUNAS, (W - 0.5) / colunas);
  const entreFilas = filas > 1 ? Math.min(ENTRE_FILAS, (zFim - zIni) / (filas - 1)) : 0;
  for (let i = 0; i < total; i++) {
    const fila = Math.floor(i / colunas);
    const nestaFila = Math.min(colunas, total - fila * colunas);
    const col = i - fila * colunas;
    const lx = (col - (nestaFila - 1) / 2) * entreColunas;
    const lz = zIni + fila * entreFilas;
    sala.mesas.push({ ...mundo(lx, lz, 0), gestor: false, pessoa: equipe[i] ?? null });
  }
}

/**
 * A salinha individual: a mesa no fundo, de frente para a porta. Se mais
 * alguém cair nela (pelo setor), ganha uma mesa logo à frente.
 */
function sentarSozinhos(
  sala: SalaNoAndar,
  membros: PessoaNoAndar[],
  nomeFixo: string | undefined,
  mundo: Mundo,
) {
  const D = sala.fundo;
  const lugares = Math.max(1, membros.length);
  const passo = lugares > 1 ? Math.min(1.7, (D - 2.2) / (lugares - 1)) : 0;
  for (let i = 0; i < lugares; i++) {
    const pessoa = membros[i] ?? null;
    sala.mesas.push({
      ...mundo(0, -D / 2 + 1.0 + i * passo, 0),
      gestor: i === 0,
      pessoa,
      nomeFixo: pessoa ? undefined : nomeFixo,
    });
  }
}

function mobiliarGerencia(
  sala: SalaNoAndar,
  g: (typeof GERENCIAS)[number],
  pessoa: PessoaNoAndar | null,
  mundo: Mundo,
) {
  const primeiro = g.nome.trim().split(/\s+/)[0] ?? g.nome;
  const nome = primeiro.charAt(0) + primeiro.slice(1).toLowerCase();
  sala.titulo = `${g.titulo} · ${nome}`;
  sala.cor = g.cor;
  sala.rotulo = nome;
  sala.subtitulo = g.titulo;
  sala.gerenteId = g.chave;
  sala.mesas.push({
    ...mundo(-0.6, -sala.fundo / 2 + 1.0, 0),
    gestor: true,
    pessoa,
    nomeFixo: pessoa ? undefined : nome,
  });
}

/* ————————————————— Refeitório ————————————————— */

/** Mesa comprida do refeitório: comprimento, profundidade e onde ficam os bancos. */
export const MESA_DO_REFEITORIO = { comp: 2.6, prof: 0.85, banco: 0.72 } as const;

/**
 * O centro de cada mesa comprida, no referencial da sala: até 2 mesas, lado a
 * lado numa fileira no meio; mais que isso, duas fileiras.
 */
export function mesasCompridasDoRefeitorio(mesas: number): { x: number; z: number }[] {
  const fileiras = mesas <= 2 ? 1 : 2;
  const porFila = Math.ceil(mesas / fileiras);
  return Array.from({ length: mesas }, (_, i) => {
    const col = fileiras === 1 ? i : Math.floor(i / 2);
    return {
      x: (col - (porFila - 1) / 2) * 3.4 + 0.3,
      z: fileiras === 1 ? 0.75 : i % 2 === 0 ? -0.45 : 1.85,
    };
  });
}

/**
 * Os lugares do refeitório: primeiro `noBalcao` de pé perto do balcão do
 * café; depois os bancos das mesas compridas (3 de cada lado, de frente para
 * a mesa), alternando os lados para a mesa encher por igual.
 */
function lugaresDoRefeitorio(sala: SalaNoAndar, mesas: number, noBalcao: number): LugarDePe[] {
  const cx = (sala.x0 + sala.x1) / 2;
  const cz = (sala.z0 + sala.z1) / 2;
  const mundo = paraOMundo(cx, cz, sala.giro);
  const saida: LugarDePe[] = [];
  for (let i = 0; i < noBalcao; i++) {
    saida.push(mundo(-sala.largura / 2 + 1.3 + i * 0.95, -sala.fundo / 2 + 1.25, 0.25 - i * 0.25));
  }
  const { banco } = MESA_DO_REFEITORIO;
  for (const m of mesasCompridasDoRefeitorio(mesas)) {
    for (const dx of [-0.8, 0, 0.8]) {
      for (const lado of [-1, 1] as const) {
        const l = mundo(m.x + dx, m.z + lado * banco, lado < 0 ? 0 : Math.PI);
        saida.push({ ...l, sentado: true, naMesa: (dx + lado) % 2 === 0 ? "prato" : "caneca" });
      }
    }
  }
  // Quem estiver no balcão vem primeiro; os sentados se espalham pelas mesas.
  const sentados = saida.slice(noBalcao);
  const espalhados: LugarDePe[] = [];
  const porMesa = 6;
  for (let k = 0; k < porMesa; k++)
    for (let t = 0; t < mesas; t++) {
      const l = sentados[t * porMesa + k];
      if (l) espalhados.push(l);
    }
  return [...saida.slice(0, noBalcao), ...espalhados];
}
