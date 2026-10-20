/*
 * A planta do ANDAR inteiro (18/10/2026: "uma visão global de todos os
 * setores… ir dando zoom e entrando nas salas por cima… e os gerentes, uma
 * sala deles próxima com todas as outras"). Funções puras.
 *
 * Como um andar de escritório de verdade: um corredor comprido no meio e as
 * salas dos dois lados, com a porta para o corredor. Cada GERENTE tem a sua
 * sala, e as salas dos setores que respondem a ele ficam coladas nela (nas
 * duas fileiras, frente a frente). O refeitório fecha o corredor.
 *
 *   ┌─────────┬──────────┬───────┬───────┬──────────┬───────────┬───────────┐
 *   │RECEPÇÃO │ GERÊNCIA │ setor │ setor │ GERÊNCIA │ DIRETORIA │REFEITÓRIO │
 *   │ (aberta)├──────────┴───────┴───────┴──────────┴───────────┴───────────┤
 *   │                           corredor                                   │
 *   ├─────────┬─────────┬────────────┬───────────┬───────────┬─────────────┤
 *   │REUNIÃO 1│  setor  │   setor    │   setor   │ REUNIÃO 2 │             │
 *   └─────────┴─────────┴────────────┴───────────┴───────────┴─────────────┘
 *
 * (18/10/2026) Recepção e a primeira sala de reunião na entrada; depois as
 * gerências (Leandro, Rodrigo, Aline) cada uma com os seus setores; a
 * diretoria e a segunda sala de reunião no fundo, antes do refeitório.
 *
 * Coordenadas: x ao longo do corredor, z para os lados (fileira de cima com
 * z < 0). Dentro de uma sala, o referencial LOCAL tem a porta em +z.
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

export type TipoDeSala = "setor" | "gerencia" | "diretoria" | "reuniao" | "recepcao" | "refeitorio";

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
  /** A fileira: em cima a porta fica em +z, embaixo em −z. */
  fileira: "cima" | "baixo";
  /** Centro da porta, no eixo x (mundo). */
  portaX: number;
  mesas: MesaNoAndar[];
  /** A gerência desta área (a chave de `GERENCIAS`, ou o id do gerente). */
  gerenteId: string | null;
  /** Só no refeitório: quantas mesas compridas (com bancos). */
  mesasCompridas?: number;
  /** Sem divisória para o corredor (a recepção é aberta). */
  aberta?: boolean;
  /** A etiqueta de longe: linha de cima (no lugar do título) e de baixo (no lugar da contagem). */
  rotulo?: string;
  subtitulo?: string;
};

export type AndarMontado = {
  salas: SalaNoAndar[];
  corredor: { x0: number; x1: number; z0: number; z1: number };
  /** Quem está ausente e onde fica de pé no refeitório. */
  naCopa: { pessoa: PessoaNoAndar; lugar: LugarDePe }[];
  /**
   * A área de cada gerência (a sala dela + os setores que respondem a ela),
   * para a câmera ir até lá. Chave: `g:<chave>` e também o id do gerente,
   * quando ele usa o CONECTA.
   */
  areas: Map<string, { x0: number; x1: number; z0: number; z1: number }>;
};

export const PROFUNDIDADE_DA_SALA = 6.2;
export const LARGURA_DO_CORREDOR = 2.6;
const ENTRE_COLUNAS = 1.95;
const LARGURA_DA_GERENCIA = 4.6;

/**
 * As gerências do andar (18/10/2026: "sala da gerência do Leandro, Rodrigo e
 * da Aline"). Ficam aqui, com o nome do organograma, porque nem todo gerente
 * usa o CONECTA — a sala existe mesmo assim, com o nome na mesa. Quem entrar
 * no app com esse nome senta ali sozinho.
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

/**
 * A diretoria (18/10/2026: "uma sala de diretoria para os 2, Ericleia e
 * Marcos"). Pelo primeiro nome — e só quem é gerente ou tem "diretor" no
 * cargo, para não puxar os Marcos do campo.
 */
export const DIRETORES = ["ERICLEIA", "MARCOS"] as const;

/** Quem fica no balcão da recepção (continua no setor e com o chefe de sempre). */
export const NA_RECEPCAO = ["TAILINI"] as const;

/** "Érica  Silva" → "ERICA SILVA": para comparar nomes do app com os do organograma. */
export const normalizar = (nome: string) =>
  nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const primeiroNormalizado = (nome: string) => normalizar(nome).split(" ")[0] ?? "";

/**
 * Quem senta na mesa da frente de cada setor: o supervisor com mais gente do
 * setor abaixo dele (gerentes e diretores têm sala própria e não entram aqui).
 */
export function escolherGestor<T extends { id: string; role: string; supervisorId?: string }>(
  pessoas: T[],
): T | null {
  const abaixo = (id: string) => pessoas.filter((p) => p.supervisorId === id).length;
  const por = (papel: string) =>
    pessoas.filter((p) => p.role === papel).sort((a, b) => abaixo(b.id) - abaixo(a.id))[0];
  return por("gerente") ?? por("supervisor") ?? null;
}

export function montarAndar(setores: SetorDoAndar[], pessoas: PessoaNoAndar[]): AndarMontado {
  const porId = new Map(pessoas.map((p) => [p.id, p]));
  const porNome = new Map(pessoas.map((p) => [normalizar(p.nome), p]));

  /* ---- as gerências: as do organograma + quem mais for gerente no app ---- */
  type Gerencia = {
    chave: string;
    titulo: string;
    nome: string;
    cor: string;
    pessoa: PessoaNoAndar | null;
  };
  const gerencias: Gerencia[] = GERENCIAS.map((g) => ({
    chave: g.chave,
    titulo: g.titulo,
    nome: g.nome,
    cor: g.cor,
    pessoa: porNome.get(normalizar(g.nome)) ?? null,
  }));
  for (const p of pessoas) {
    if (p.role !== "gerente" || gerencias.some((g) => g.pessoa?.id === p.id)) continue;
    const ehDiretor = DIRETORES.includes(primeiroNormalizado(p.nome) as never);
    if (ehDiretor) continue;
    gerencias.push({ chave: p.id, titulo: "Gerência", nome: p.nome, cor: "#7c3aed", pessoa: p });
  }
  const gerenciaPorNome = new Map(gerencias.map((g) => [normalizar(g.nome), g.chave]));

  const diretores = DIRETORES.map((primeiro) => ({
    primeiro,
    pessoa:
      pessoas.find(
        (p) =>
          primeiroNormalizado(p.nome) === primeiro &&
          (p.role === "gerente" || /DIRET/.test(normalizar(p.cargo))),
      ) ?? null,
  }));
  const naRecepcao = pessoas.filter((p) =>
    NA_RECEPCAO.includes(primeiroNormalizado(p.nome) as never),
  );
  const foraDosSetores = new Set<string>([
    ...gerencias.flatMap((g) => (g.pessoa ? [g.pessoa.id] : [])),
    ...diretores.flatMap((d) => (d.pessoa ? [d.pessoa.id] : [])),
    ...naRecepcao.map((p) => p.id),
  ]);

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

  /* ---- os setores, cada um com o seu gestor e a gerência a quem responde ---- */
  type Bloco = {
    setor: SetorDoAndar;
    gestor: PessoaNoAndar | null;
    equipe: PessoaNoAndar[];
    gerenteId: string | null;
  };
  const blocos: Bloco[] = [];
  for (const s of setores) {
    const membros = pessoas
      .filter((p) => p.setor === s.id && !foraDosSetores.has(p.id))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    if (!membros.length) continue;
    const gestor = escolherGestor(membros);
    const equipe = membros.filter((p) => p !== gestor);
    // A gerência do setor: pela linha de quem senta na frente; sem ela, a mais
    // votada entre os membros.
    let gerenteId = gerenciaAcima(gestor ?? undefined);
    if (!gerenteId) {
      const votos = new Map<string, number>();
      for (const m of membros) {
        const g = gerenciaAcima(m);
        if (g) votos.set(g, (votos.get(g) ?? 0) + 1);
      }
      gerenteId = [...votos].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }
    blocos.push({ setor: s, gestor, equipe, gerenteId });
  }

  /* ---- distribuição ---- */
  const salas: SalaNoAndar[] = [];
  const cursor = { cima: 0, baixo: 0 };
  const areas = new Map<string, { x0: number; x1: number; z0: number; z1: number }>();
  const zCima = -LARGURA_DO_CORREDOR / 2 - PROFUNDIDADE_DA_SALA / 2;
  const zBaixo = LARGURA_DO_CORREDOR / 2 + PROFUNDIDADE_DA_SALA / 2;

  const por = (
    fileira: "cima" | "baixo",
    largura: number,
    montar: (cx: number, cz: number, fileira: "cima" | "baixo") => SalaNoAndar,
  ) => {
    const x0 = cursor[fileira];
    cursor[fileira] += largura;
    salas.push(montar(x0 + largura / 2, fileira === "cima" ? zCima : zBaixo, fileira));
  };
  const maisCurta = (): "cima" | "baixo" => (cursor.cima < cursor.baixo ? "cima" : "baixo");
  const alinhar = () => {
    cursor.cima = cursor.baixo = Math.max(cursor.cima, cursor.baixo);
    return cursor.cima;
  };

  // 1) A entrada: a recepção (aberta para o corredor) e a primeira sala de reunião.
  por("cima", 6.2, (cx, cz, f) => salaDaRecepcao(naRecepcao[0] ?? null, cx, cz, f));
  por("baixo", 6.2, (cx, cz, f) => salaDeReuniao("reuniao-1", "Sala de reunião 1", cx, cz, f));

  // 2) Cada gerência com os setores dela, frente a frente no corredor.
  const grupos: { gerencia: Gerencia | null; blocos: Bloco[] }[] = gerencias.map((g) => ({
    gerencia: g,
    blocos: blocos.filter((b) => b.gerenteId === g.chave),
  }));
  const semGerencia = blocos.filter(
    (b) => !b.gerenteId || !gerencias.some((g) => g.chave === b.gerenteId),
  );
  if (semGerencia.length) grupos.push({ gerencia: null, blocos: semGerencia });
  for (const grupo of grupos) {
    const inicio = alinhar();
    const g = grupo.gerencia;
    if (g) por("cima", LARGURA_DA_GERENCIA, (cx, cz, f) => salaDaGerencia(g, cx, cz, f));
    for (const b of grupo.blocos) {
      const largura = larguraDoSetor(b.equipe.length);
      por(maisCurta(), largura, (cx, cz, f) => salaDoSetor(b, cx, cz, f, largura));
    }
    if (g) {
      const area = {
        x0: inicio,
        x1: Math.max(cursor.cima, cursor.baixo),
        z0: -LARGURA_DO_CORREDOR / 2 - PROFUNDIDADE_DA_SALA,
        z1: LARGURA_DO_CORREDOR / 2 + PROFUNDIDADE_DA_SALA,
      };
      areas.set(`g:${g.chave}`, area);
      if (g.pessoa) areas.set(g.pessoa.id, area);
    }
  }

  // 3) A diretoria e a segunda sala de reunião, juntas, no fundo do andar.
  alinhar();
  por("cima", 7.2, (cx, cz, f) => salaDaDiretoria(diretores, cx, cz, f));
  por("baixo", 6.2, (cx, cz, f) => salaDeReuniao("reuniao-2", "Sala de reunião 2", cx, cz, f));

  // 4) O refeitório fecha o corredor, com lugar para quem está ausente.
  const ausentes = pessoas.filter((p) => p.situacao === "ausente");
  /* (19/10/2026: "aumentar o refeitório… mesa maior retangular com bancos e
     eles sentados") Mesas compridas de 6 lugares, duas fileiras; de cada 4
     pessoas, uma fica de pé no balcão do café (até 3). */
  const noBalcao = Math.min(3, Math.floor(ausentes.length / 4));
  const mesasDoRefeitorio = Math.max(2, Math.ceil((ausentes.length - noBalcao) / 6));
  const larguraRef = Math.max(8.5, Math.ceil(mesasDoRefeitorio / 2) * 3.4 + 2.6);
  let lugaresRef: LugarDePe[] = [];
  por(maisCurta(), larguraRef, (cx, cz, f) => {
    const sala = salaVazia(
      "refeitorio",
      "refeitorio",
      "Refeitório",
      "#b45309",
      cx,
      cz,
      f,
      larguraRef,
      null,
    );
    lugaresRef = lugaresDoRefeitorio(sala, mesasDoRefeitorio, noBalcao);
    sala.mesasCompridas = mesasDoRefeitorio;
    return sala;
  });
  const naCopa = ausentes.map((pessoa, i) => ({
    pessoa,
    lugar: lugaresRef[i % lugaresRef.length]!,
  }));

  // Centraliza o andar em x = 0.
  const comprimento = Math.max(cursor.cima, cursor.baixo);
  const dx = -comprimento / 2;
  for (const s of salas) {
    s.x0 += dx;
    s.x1 += dx;
    s.portaX += dx;
    for (const m of s.mesas) m.x += dx;
  }
  for (const c of naCopa) c.lugar = { ...c.lugar, x: c.lugar.x + dx };
  for (const [k, a] of areas) areas.set(k, { ...a, x0: a.x0 + dx, x1: a.x1 + dx });

  return {
    salas,
    corredor: {
      x0: dx - 0.2,
      x1: comprimento + dx + 0.2,
      z0: -LARGURA_DO_CORREDOR / 2,
      z1: LARGURA_DO_CORREDOR / 2,
    },
    naCopa,
    areas,
  };
}

/* ————————————————— As salas ————————————————— */

function larguraDoSetor(equipe: number) {
  const colunas = Math.max(2, Math.ceil(equipe / 2));
  return Math.max(4.6, colunas * ENTRE_COLUNAS + 0.9);
}

/** Do referencial da sala (porta em +z) para o mundo. */
export function paraOMundo(cx: number, cz: number, fileira: "cima" | "baixo") {
  const vira = fileira === "baixo";
  return (lx: number, lz: number, rot: number) => ({
    x: vira ? cx - lx : cx + lx,
    z: vira ? cz - lz : cz + lz,
    rotY: vira ? rot + Math.PI : rot,
  });
}

function salaVazia(
  id: string,
  tipo: TipoDeSala,
  titulo: string,
  cor: string,
  cx: number,
  cz: number,
  fileira: "cima" | "baixo",
  largura: number,
  gerenteId: string | null,
): SalaNoAndar {
  const vira = fileira === "baixo";
  return {
    id,
    tipo,
    titulo,
    cor,
    x0: cx - largura / 2,
    x1: cx + largura / 2,
    z0: cz - PROFUNDIDADE_DA_SALA / 2,
    z1: cz + PROFUNDIDADE_DA_SALA / 2,
    fileira,
    // a porta fica perto do canto, como nas salas da foto
    portaX: vira ? cx - (largura / 2 - 0.85) : cx + (largura / 2 - 0.85),
    mesas: [],
    gerenteId,
  };
}

function salaDoSetor(
  b: {
    setor: SetorDoAndar;
    gestor: PessoaNoAndar | null;
    equipe: PessoaNoAndar[];
    gerenteId: string | null;
  },
  cx: number,
  cz: number,
  fileira: "cima" | "baixo",
  largura: number,
): SalaNoAndar {
  const sala = salaVazia(
    b.setor.id,
    "setor",
    b.setor.nome,
    b.setor.cor,
    cx,
    cz,
    fileira,
    largura,
    b.gerenteId,
  );
  const mundo = paraOMundo(cx, cz, fileira);
  const D = PROFUNDIDADE_DA_SALA;
  // O gestor no fundo, de frente para a porta; a equipe em duas fileiras.
  sala.mesas.push({ ...mundo(0, -D / 2 + 0.95, 0), gestor: true, pessoa: b.gestor });
  const colunas = Math.max(2, Math.ceil(b.equipe.length / 2));
  const total = Math.max(b.equipe.length, 2);
  for (let i = 0; i < total; i++) {
    const fila = i < colunas ? 0 : 1;
    const col = fila === 0 ? i : i - colunas;
    const lx = (col - (colunas - 1) / 2) * ENTRE_COLUNAS;
    const lz = fila === 0 ? -0.55 : 1.25;
    sala.mesas.push({ ...mundo(lx, lz, 0), gestor: false, pessoa: b.equipe[i] ?? null });
  }
  return sala;
}

function salaDaGerencia(
  g: { chave: string; titulo: string; nome: string; cor: string; pessoa: PessoaNoAndar | null },
  cx: number,
  cz: number,
  fileira: "cima" | "baixo",
): SalaNoAndar {
  const primeiro = g.nome.trim().split(/\s+/)[0] ?? g.nome;
  const nome = primeiro.charAt(0) + primeiro.slice(1).toLowerCase();
  const sala = salaVazia(
    `gerencia-${g.chave}`,
    "gerencia",
    `${g.titulo} · ${nome}`,
    g.cor,
    cx,
    cz,
    fileira,
    LARGURA_DA_GERENCIA,
    g.chave,
  );
  sala.rotulo = nome;
  sala.subtitulo = g.titulo;
  const mundo = paraOMundo(cx, cz, fileira);
  sala.mesas.push({
    ...mundo(-0.6, -PROFUNDIDADE_DA_SALA / 2 + 1.0, 0),
    gestor: true,
    pessoa: g.pessoa,
    nomeFixo: g.pessoa ? undefined : nome,
  });
  return sala;
}

/** A diretoria: duas mesas executivas lado a lado no fundo, uma para cada diretor. */
function salaDaDiretoria(
  diretores: { primeiro: string; pessoa: PessoaNoAndar | null }[],
  cx: number,
  cz: number,
  fileira: "cima" | "baixo",
): SalaNoAndar {
  const sala = salaVazia(
    "diretoria",
    "diretoria",
    "Diretoria",
    "#0f172a",
    cx,
    cz,
    fileira,
    7.2,
    null,
  );
  const mundo = paraOMundo(cx, cz, fileira);
  sala.subtitulo = diretores
    .map((d) => d.primeiro.charAt(0) + d.primeiro.slice(1).toLowerCase())
    .join(" e ");
  diretores.forEach((d, i) => {
    const nome = d.primeiro.charAt(0) + d.primeiro.slice(1).toLowerCase();
    sala.mesas.push({
      ...mundo(i === 0 ? -1.7 : 1.7, -PROFUNDIDADE_DA_SALA / 2 + 1.05, 0),
      gestor: true,
      pessoa: d.pessoa,
      nomeFixo: d.pessoa ? undefined : nome,
    });
  });
  return sala;
}

/** Sala de reunião: só a mobília (mesa comprida, cadeiras, TV) — ninguém mora nela. */
function salaDeReuniao(
  id: string,
  titulo: string,
  cx: number,
  cz: number,
  fileira: "cima" | "baixo",
) {
  return salaVazia(id, "reuniao", titulo, "#0369a1", cx, cz, fileira, 6.2, null);
}

/**
 * A recepção, na entrada do andar: aberta para o corredor, com o balcão alto
 * de frente para quem chega e o sofá de espera.
 */
function salaDaRecepcao(
  pessoa: PessoaNoAndar | null,
  cx: number,
  cz: number,
  fileira: "cima" | "baixo",
) {
  const sala = salaVazia("recepcao", "recepcao", "Recepção", "#0f766e", cx, cz, fileira, 6.2, null);
  sala.aberta = true;
  const mundo = paraOMundo(cx, cz, fileira);
  sala.mesas.push({
    ...mundo(-0.9, -0.6, 0),
    gestor: false,
    pessoa,
    nomeFixo: pessoa ? undefined : "Recepção",
    balcao: true,
  });
  return sala;
}

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
  const largura = sala.x1 - sala.x0;
  const mundo = paraOMundo(cx, cz, sala.fileira);
  const saida: LugarDePe[] = [];
  for (let i = 0; i < noBalcao; i++) {
    saida.push(
      mundo(-largura / 2 + 1.3 + i * 0.95, -PROFUNDIDADE_DA_SALA / 2 + 1.25, 0.25 - i * 0.25),
    );
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
