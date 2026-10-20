/**
 * O avatar 3D de cada pessoa na sala de Realidade Virtual — estilo blocos
 * (tipo Roblox), montado por ela mesma, com catálogo grande de rosto,
 * cabelo, chapéu, barba, roupa, calçado e acessório (protótipo, 08/10/2026).
 *
 * Fica nas preferências (`gestor.preferencias`, chave "avatar3d"). A coluna
 * guarda 400 caracteres, e o JSON com os nomes dos campos estourava — por
 * isso grava-se compacto: "v2|valor|valor|…" na ordem de `CAMPOS`. Dentro da
 * sala ele não passa pelo banco: vai pelo canal de dados da chamada (LiveKit).
 */

import { op, type Opcao } from "@/lib/avatar-op";
import {
  EXTRAS_BARBA,
  EXTRAS_DETALHE,
  EXTRAS_EXPRESSAO,
  EXTRAS_OCULOS,
} from "@/lib/avatar-catalogo/rosto";
import { EXTRAS_CABELO, EXTRAS_CHAPEU } from "@/lib/avatar-catalogo/cabeca";
import {
  COM_ESTAMPA_EXTRAS,
  EXTRAS_ESTAMPA,
  EXTRAS_ROUPA,
  ROUPA_INTEIRA_EXTRAS,
  ROUPAS_FEMININAS_CIMA,
  ROUPAS_MASCULINAS_CIMA,
} from "@/lib/avatar-catalogo/cima";
import {
  EXTRAS_CALCA,
  EXTRAS_SAPATO,
  ROUPAS_FEMININAS_BAIXO,
  ROUPAS_MASCULINAS_BAIXO,
} from "@/lib/avatar-catalogo/baixo";
import { EXTRAS_ACESSORIO, EXTRAS_CORPO } from "@/lib/avatar-catalogo/extras";

export const OPCOES = {
  corpo: [
    ...op(
      ["classico", "Clássico"],
      ["esguio", "Esguio"],
      ["forte", "Forte"],
      ["baixinho", "Baixinho"],
    ),
    // Novas opções: ver `avatar-catalogo/` (16/10/2026).
    ...EXTRAS_CORPO,
  ],
  expressao: [
    ...op(
      ["sorriso", "Sorriso"],
      ["sorrisao", "Sorrisão"],
      ["serio", "Sério"],
      ["piscadinha", "Piscadinha"],
      ["surpreso", "Surpreso"],
      ["bravo", "Bravo"],
      ["apaixonado", "Apaixonado"],
      ["estrelado", "Estrelado"],
      ["timido", "Tímido"],
      ["descolado", "Descolado"],
      ["sono", "Com sono"],
      ["gargalhada", "Gargalhada"],
      ["lingua", "Língua de fora"],
      ["confiante", "Confiante"],
      ["fofo", "Fofo"],
      // Rostos glam femininos, maquiados (16/10/2026) — desenhados em rv/rosto-glam.ts.
      ["glamSorriso", "Glam sorrindo"],
      ["glamBeicinho", "Glam boca carnuda"],
      ["glamPiscadinha", "Glam piscadinha"],
      ["glamSerena", "Glam serena"],
    ),
    // Novas opções: ver `avatar-catalogo/` (16/10/2026).
    ...EXTRAS_EXPRESSAO,
  ],
  detalhe: [
    ...op(
      ["nenhum", "Nenhum"],
      ["sardas", "Sardas"],
      ["bochechas", "Bochechas"],
      ["pinta", "Pinta"],
      ["maquiagem", "Cílios e batom"],
    ),
    // Novas opções: ver `avatar-catalogo/` (16/10/2026).
    ...EXTRAS_DETALHE,
  ],
  cabelo: [
    ...op(
      ["social", "Social"],
      ["topete", "Topete"],
      ["anime", "Anime espetado"],
      ["baguncado", "Bagunçado"],
      ["emo", "Franja emo"],
      ["wolfcut", "Wolf cut"],
      ["moicano", "Moicano"],
      ["cacheadoCurto", "Cacheado curto"],
      ["afro", "Black power"],
      ["dreads", "Dreads"],
      ["raspado", "Raspado"],
      ["careca", "Careca"],
      ["chanel", "Chanel"],
      ["longo", "Longo liso"],
      ["franjaLonga", "Longo com franja"],
      ["ondulado", "Longo ondulado"],
      ["cacheado", "Longo cacheado"],
      ["rabo", "Rabo de cavalo"],
      ["raboAlto", "Rabo alto"],
      ["coque", "Coque"],
      ["coqueDuplo", "Dois coques"],
      ["chiquinha", "Maria-chiquinha"],
      ["trancas", "Tranças"],
      ["longoMechas", "Longo com luzes na frente"],
      ["longoEscorrido", "Longo escorrido"],
      ["chiquinhaAlta", "Chiquinhas longas"],
      ["longoRepicado", "Longo repicado ondulado"],
      ["raboFranja", "Rabo alto com franja"],
      ["coqueSolto", "Coque alto com mechas soltas"],
      ["longoFlor", "Longo com flor"],
      ["repicadoChiquinhas", "Repicado com chiquinhas"],
      ["longoTrancinhas", "Longo com trancinhas"],
      ["trancasBaixas", "Tranças baixas com franja"],
      ["trancasBoxer", "Tranças boxeadoras"],
      ["trancaLateral", "Trança de lado"],
      ["trancaEspinha", "Trança espinha de peixe"],
    ),
    // Novas opções: ver `avatar-catalogo/` (16/10/2026).
    ...EXTRAS_CABELO,
  ],
  chapeu: [
    ...op(
      ["nenhum", "Nenhum"],
      ["bone", "Boné"],
      ["boneTras", "Boné virado"],
      ["gorro", "Gorro"],
      ["chapeu", "Chapéu"],
      ["capacete", "Capacete EPI"],
      ["cartola", "Cartola"],
      ["fone", "Fone"],
      ["coroa", "Coroa"],
      ["laco", "Laço"],
      ["tiara", "Tiara"],
      ["flores", "Coroa de flores"],
      ["oculosNaCabeca", "Óculos na cabeça"],
      ["orelhas", "Orelhinhas de gato"],
    ),
    // Novas opções: ver `avatar-catalogo/` (16/10/2026).
    ...EXTRAS_CHAPEU,
  ],
  barba: [
    ...op(
      ["nenhuma", "Sem barba"],
      ["rala", "Rala"],
      ["bigode", "Bigode"],
      ["bigodao", "Bigodão"],
      ["cavanhaque", "Cavanhaque"],
      ["barbicha", "Cavanhaque + bigode"],
      ["cheia", "Cheia"],
      ["lenhador", "Lenhador"],
      ["costeleta", "Costeleta"],
    ),
    // Novas opções: ver `avatar-catalogo/` (16/10/2026).
    ...EXTRAS_BARBA,
  ],
  oculos: [
    ...op(
      ["nenhum", "Sem óculos"],
      ["redondo", "Redondo"],
      ["quadrado", "Quadrado"],
      ["escuro", "Escuro"],
      ["aviador", "Aviador"],
    ),
    // Novas opções: ver `avatar-catalogo/` (16/10/2026).
    ...EXTRAS_OCULOS,
  ],
  roupa: [
    ...op(
      ["camiseta", "Camiseta"],
      ["regata", "Regata"],
      ["polo", "Polo"],
      ["camisa", "Camisa"],
      ["social", "Social + gravata"],
      ["xadrez", "Xadrez"],
      ["listrada", "Listrada"],
      ["moletom", "Moletom"],
      ["jaqueta", "Jaqueta"],
      ["terno", "Terno"],
      ["colete", "Colete + gravata"],
      ["sueter", "Suéter"],
      ["jaleco", "Jaleco"],
      ["epi", "Colete EPI"],
      // —— femininas (13/10/2026): só acrescentar no fim ——
      ["blusa", "Blusa soltinha"],
      ["cropped", "Cropped"],
      ["alcinha", "Blusa de alcinha"],
      ["ciganinha", "Ciganinha"],
      ["babado", "Blusa com babado e laço"],
      ["cardiga", "Cardigã"],
      ["vestido", "Vestido rodado"],
      ["vestidoLongo", "Vestido longo"],
      ["macacao", "Macacão"],
    ),
    // Novas opções: ver `avatar-catalogo/` (16/10/2026).
    ...EXTRAS_ROUPA,
  ],
  estampa: [
    ...op(
      ["nenhuma", "Nenhuma"],
      ["coracao", "Coração"],
      ["raio", "Raio"],
      ["estrela", "Estrela"],
      ["smile", "Smile"],
      ["arvore", "Árvore"],
      ["dez", "Número 10"],
    ),
    // Novas opções: ver `avatar-catalogo/` (16/10/2026).
    ...EXTRAS_ESTAMPA,
  ],
  calca: [
    ...op(
      ["jeans", "Jeans"],
      ["social", "Social"],
      ["cargo", "Cargo"],
      ["jogger", "Moletom"],
      ["bermuda", "Bermuda"],
      ["saia", "Saia"],
      // —— femininas (13/10/2026): só acrescentar no fim ——
      ["saiaRodada", "Saia rodada"],
      ["saiaLapis", "Saia lápis"],
      ["legging", "Legging"],
      ["short", "Shortinho"],
      ["pantalona", "Pantalona"],
      ["saiaJeans", "Saia jeans"],
    ),
    // Novas opções: ver `avatar-catalogo/` (16/10/2026).
    ...EXTRAS_CALCA,
  ],
  sapato: [
    ...op(
      ["tenis", "Tênis"],
      ["social", "Social"],
      ["bota", "Bota"],
      ["chinelo", "Chinelo"],
      // —— femininos (13/10/2026): só acrescentar no fim ——
      ["sapatilha", "Sapatilha"],
      ["salto", "Salto alto"],
      ["sandalia", "Sandália"],
      ["botaCano", "Bota cano alto"],
    ),
    // Novas opções: ver `avatar-catalogo/` (16/10/2026).
    ...EXTRAS_SAPATO,
  ],
  /** Luzes no cabelo, na `corMechas`: onde elas aparecem. */
  mechas: op(
    ["nenhuma", "Sem mechas"],
    ["frente", "Mechas na frente"],
    ["pontas", "Pontas coloridas"],
    ["luzes", "Luzes espalhadas"],
  ),
  acessorio: [
    ...op(
      ["nenhum", "Nenhum"],
      ["colar", "Colar"],
      ["cracha", "Crachá"],
      ["relogio", "Relógio"],
      ["mochila", "Mochila"],
      ["foneNoPescoco", "Fone no pescoço"],
    ),
    // Novas opções: ver `avatar-catalogo/` (16/10/2026).
    ...EXTRAS_ACESSORIO,
  ],
};

/**
 * Peças femininas (parte de cima, de baixo e calçado — os valores não se
 * repetem entre as três listas, menos "social", que é masculino nas três).
 * O editor usa para separar o catálogo; o que não está aqui nem em
 * `ROUPAS_MASCULINAS` é unissex.
 */
export const ROUPAS_FEMININAS: ReadonlySet<string> = new Set([
  ...ROUPAS_FEMININAS_CIMA,
  ...ROUPAS_FEMININAS_BAIXO,
  "blusa",
  "cropped",
  "alcinha",
  "ciganinha",
  "babado",
  "vestido",
  "vestidoLongo",
  "macacao",
  "saia",
  "saiaRodada",
  "saiaLapis",
  "legging",
  "short",
  "pantalona",
  "saiaJeans",
  "sapatilha",
  "salto",
  "sandalia",
  "botaCano",
]);

/**
 * Peças claramente masculinas. ATENÇÃO: "social" é valor da roupa (camisa +
 * gravata), da calça e do sapato ao mesmo tempo — vale para as três.
 */
export const ROUPAS_MASCULINAS: ReadonlySet<string> = new Set([
  "social",
  "terno",
  "colete",
  ...ROUPAS_MASCULINAS_CIMA,
  ...ROUPAS_MASCULINAS_BAIXO,
]);

/**
 * Partes de cima que vestem o corpo inteiro (vestidos, macacão): com elas a
 * `calca` guardada é ignorada no desenho (as pernas saem da própria peça) e
 * o editor esconde a "Parte de baixo".
 */
export const ROUPA_INTEIRA: ReadonlySet<string> = new Set([
  "vestido",
  "vestidoLongo",
  "macacao",
  ...ROUPA_INTEIRA_EXTRAS,
]);

/** Partes de cima que aceitam estampa no peito (o editor mostra o seletor só nelas). */
export const COM_ESTAMPA: ReadonlySet<string> = new Set([
  ...COM_ESTAMPA_EXTRAS,
  "camiseta",
  "regata",
  "listrada",
  "moletom",
  "sueter",
  "blusa",
  "cropped",
  "alcinha",
]);

type V<K extends keyof typeof OPCOES> = (typeof OPCOES)[K][number]["v"];

export type AvatarConfig = {
  pele: string;
  corpo: V<"corpo">;
  expressao: V<"expressao">;
  olhos: string;
  detalhe: V<"detalhe">;
  cabelo: V<"cabelo">;
  corCabelo: string;
  chapeu: V<"chapeu">;
  corChapeu: string;
  barba: V<"barba">;
  oculos: V<"oculos">;
  roupa: V<"roupa">;
  corRoupa: string;
  estampa: V<"estampa">;
  calca: V<"calca">;
  corCalca: string;
  sapato: V<"sapato">;
  corSapato: string;
  acessorio: V<"acessorio">;
  mechas: V<"mechas">;
  corMechas: string;
  /** Segunda cor da roupa: detalhes, listras, xadrez, forro, cadarço… */
  corRoupa2: string;
};

/** O primeiro é o amarelo clássico dos bonecos de bloco. */
export const TONS_DE_PELE = [
  "#f5cd30",
  "#fbe0cf",
  "#f6d3b8",
  "#eebd94",
  "#d9a27a",
  "#bb7d55",
  "#8d5a3b",
  "#5e3a26",
  "#3d2518",
  "#9bd4f5",
  "#b6f0a8",
];
export const CORES_DE_OLHOS = ["#4a2c1a", "#2563eb", "#15803d", "#111111", "#b7791f", "#7c3aed"];
export const CORES_DE_CABELO = [
  "#1f1712",
  "#4a2f1d",
  "#7b4a26",
  "#b9783f",
  "#e3c27a",
  "#f5f5f4",
  "#9a9a9a",
  "#c0392b",
  "#ec4899",
  "#2563eb",
  "#16a34a",
  "#7c3aed",
];
export const CORES_DE_ROUPA = [
  "#1f2937",
  "#111827",
  "#f8fafc",
  "#1f3a5f",
  "#2563eb",
  "#0e7490",
  "#2e7d5b",
  "#65a30d",
  "#7a2e3b",
  "#dc2626",
  "#ea580c",
  "#c47f17",
  "#facc15",
  "#5b3f8c",
  "#db2777",
  "#78716c",
];
export const CORES_DE_CALCA = [
  "#1e3a8a",
  "#3b5998",
  "#6b8cbe",
  "#2b2f3a",
  "#111827",
  "#4b5563",
  "#6b4f2a",
  "#d6c7a1",
  "#9ca3af",
  "#7a2e3b",
  "#2e7d5b",
];
export const CORES_DE_SAPATO = [
  "#111827",
  "#f8fafc",
  "#7c2d12",
  "#a16207",
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#facc15",
];
export const CORES_DE_MECHAS = [
  "#f5deb3",
  "#fde68a",
  "#f8fafc",
  "#f9a8d4",
  "#ec4899",
  "#a78bfa",
  "#60a5fa",
  "#34d399",
  "#f87171",
  "#fb923c",
];
export const CORES_DE_CHAPEU = [
  "#facc15",
  "#f8fafc",
  "#111827",
  "#dc2626",
  "#2563eb",
  "#16a34a",
  "#ea580c",
  "#7a2e3b",
  "#d6c7a1",
];

export const AVATAR_PADRAO: AvatarConfig = {
  pele: TONS_DE_PELE[3]!,
  corpo: "classico",
  expressao: "sorriso",
  olhos: CORES_DE_OLHOS[0]!,
  detalhe: "nenhum",
  cabelo: "baguncado",
  corCabelo: CORES_DE_CABELO[1]!,
  chapeu: "nenhum",
  corChapeu: CORES_DE_CHAPEU[0]!,
  barba: "nenhuma",
  oculos: "nenhum",
  roupa: "moletom",
  corRoupa: CORES_DE_ROUPA[0]!,
  estampa: "nenhuma",
  calca: "jeans",
  corCalca: CORES_DE_CALCA[0]!,
  sapato: "tenis",
  corSapato: CORES_DE_SAPATO[1]!,
  acessorio: "nenhum",
  mechas: "nenhuma",
  corMechas: CORES_DE_MECHAS[0]!,
  corRoupa2: "#f8fafc",
};

/**
 * O avatar "em branco" (17/10/2026: "criar avatares zerados padrões pra
 * todos… para que nessa próxima atualização eles venham e façam as edições").
 * Quem ainda não montou o seu aparece com este — no Início, no Mural, nas
 * reações — e o provador começa dele. NÃO é gravado no banco: é o que a tela
 * mostra enquanto a pessoa não salvar o dela.
 *
 * Como o boneco padrão do Roblox: camiseta branca, calça cinza, tênis branco,
 * cabelo curto, sem acessório.
 */
export const AVATAR_EM_BRANCO: AvatarConfig = {
  ...AVATAR_PADRAO,
  expressao: "sorriso",
  cabelo: "social",
  corCabelo: "#3b2a20",
  roupa: "camiseta",
  corRoupa: "#f8fafc",
  corRoupa2: "#e2e8f0",
  estampa: "nenhuma",
  calca: "jeans",
  corCalca: "#94a3b8",
  sapato: "tenis",
  corSapato: "#f8fafc",
  acessorio: "nenhum",
  chapeu: "nenhum",
  oculos: "nenhum",
  barba: "nenhuma",
  detalhe: "nenhum",
  mechas: "nenhuma",
};

/** A ordem dos campos no formato compacto. NUNCA reordenar — só acrescentar no fim. */
const CAMPOS = [
  "pele",
  "corpo",
  "expressao",
  "olhos",
  "detalhe",
  "cabelo",
  "corCabelo",
  "chapeu",
  "corChapeu",
  "barba",
  "oculos",
  "roupa",
  "corRoupa",
  "estampa",
  "calca",
  "corCalca",
  "sapato",
  "corSapato",
  "acessorio",
  "mechas",
  "corMechas",
  "corRoupa2",
] as const satisfies readonly (keyof AvatarConfig)[];

const LISTA_DE: Partial<Record<keyof AvatarConfig, Opcao<string>[]>> = {
  corpo: OPCOES.corpo,
  expressao: OPCOES.expressao,
  detalhe: OPCOES.detalhe,
  cabelo: OPCOES.cabelo,
  chapeu: OPCOES.chapeu,
  barba: OPCOES.barba,
  oculos: OPCOES.oculos,
  roupa: OPCOES.roupa,
  estampa: OPCOES.estampa,
  calca: OPCOES.calca,
  sapato: OPCOES.sapato,
  acessorio: OPCOES.acessorio,
  mechas: OPCOES.mechas,
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Lê um avatar vindo de fora (preferência ou mensagem da sala), sempre válido. */
export function lerAvatar(bruto: unknown): AvatarConfig | null {
  let v: Record<string, unknown> | null = null;
  if (typeof bruto === "string" && bruto.startsWith("v2|")) {
    const partes = bruto.split("|").slice(1);
    v = Object.fromEntries(CAMPOS.map((c, i) => [c, partes[i]]));
  } else {
    try {
      v =
        typeof bruto === "string"
          ? (JSON.parse(bruto) as Record<string, unknown>)
          : (bruto as Record<string, unknown>);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const saida = { ...AVATAR_PADRAO } as Record<string, string>;
  for (const campo of CAMPOS) {
    const valor = v[campo];
    const lista = LISTA_DE[campo];
    if (lista) {
      if (lista.some((o) => o.v === valor)) saida[campo] = valor as string;
    } else if (typeof valor === "string" && HEX.test(valor)) {
      saida[campo] = valor;
    }
  }
  return saida as AvatarConfig;
}

/** O formato compacto que vai para o banco. */
export function compactarAvatar(a: AvatarConfig): string {
  return ["v2", ...CAMPOS.map((c) => a[c])].join("|");
}

/** O meu avatar salvo, ou `null` se ainda não montei. */
export async function carregarMeuAvatar(): Promise<AvatarConfig | null> {
  const { minhasPreferencias } = await import("@/lib/perfil.functions");
  const p = await minhasPreferencias();
  return p.avatar3d ? lerAvatar(p.avatar3d) : null;
}

export async function salvarMeuAvatar(a: AvatarConfig): Promise<void> {
  const { salvarPreferencia } = await import("@/lib/perfil.functions");
  await salvarPreferencia({ data: { chave: "avatar3d", valor: compactarAvatar(a) } });
}

/**
 * O avatar salvo de OUTRA pessoa, ou `null` se ela ainda não montou (reações
 * do avatar, 17/10/2026). Guarda por 2 minutos: um "bravo" seguido de um
 * beijo não precisa ir ao servidor duas vezes.
 */
const avataresDeOutros = new Map<string, { em: number; avatar: AvatarConfig | null }>();
export async function carregarAvatarDe(pessoa: string): Promise<AvatarConfig | null> {
  return carregarAvataresDe([pessoa]).then((m) => m.get(pessoa) ?? null);
}

/* Os pedidos de vários cartões (Mural) no mesmo instante viram UMA ida ao
   servidor: junta os ids por 30 ms e pede todos de uma vez. */
let lote: { ids: Set<string>; pronto: Promise<void> } | null = null;

/**
 * Os avatares salvos de várias pessoas (`null` = ainda não montou), com a
 * mesma guarda de 2 minutos de `carregarAvatarDe`.
 */
export async function carregarAvataresDe(
  pessoas: string[],
): Promise<Map<string, AvatarConfig | null>> {
  const faltam = pessoas.filter((p) => {
    const g = avataresDeOutros.get(p);
    return !g || Date.now() - g.em >= 120_000;
  });
  if (faltam.length) {
    if (!lote) {
      const ids = new Set<string>();
      const pronto = new Promise<void>((r) => setTimeout(r, 30)).then(async () => {
        lote = null;
        const { avataresDasPessoas } = await import("@/lib/perfil.functions");
        // O servidor responde até 100 por vez: o escritório inteiro vai em partes.
        const todos = [...ids];
        for (let i = 0; i < todos.length; i += 100) {
          const parte = todos.slice(i, i + 100);
          const r = await avataresDasPessoas({ data: { ids: parte } });
          for (const id of parte) {
            const bruto = r.avatares[id];
            avataresDeOutros.set(id, { em: Date.now(), avatar: bruto ? lerAvatar(bruto) : null });
          }
        }
      });
      lote = { ids, pronto };
    }
    faltam.forEach((p) => lote!.ids.add(p));
    await lote.pronto;
  }
  return new Map(pessoas.map((p) => [p, avataresDeOutros.get(p)?.avatar ?? null]));
}
