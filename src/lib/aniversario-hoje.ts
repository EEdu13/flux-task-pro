/*
 * Quem faz aniversário hoje — para o chapeuzinho de festa no avatar
 * (Mural, 14/10/2026).
 *
 * Uma pergunta ao servidor por sessão (e de novo só se o dia virar), feita
 * pelo primeiro avatar que aparecer na tela. Depois disso cada avatar só
 * consulta um conjunto em memória: custa nada por avatar.
 *
 * A chave é o NOME, porque é o que o `UserAvatar` recebe (a foto também é
 * buscada por nome). Comparado sem acento, sem caixa e sem espaço sobrando.
 */

let nomes = new Set<string>();
let ids = new Set<string>();
let diaCarregado = "";
let buscando = false;
let tentarDepoisDe = 0;
let versao = 0;
const ouvintes = new Set<() => void>();

export function normalizarNome(nome: string): string {
  return nome.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
}

/** O dia de hoje no fuso de Brasília (yyyy-mm-dd), igual ao do servidor. */
function hojeNoBrasil(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function avisar() {
  versao += 1;
  for (const f of ouvintes) f();
}

/** Para o `useSyncExternalStore`. */
export function assinarAniversarios(f: () => void): () => void {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}
export function versaoDosAniversarios(): number {
  return versao;
}

/**
 * Garante a lista de hoje. Chamada pelos avatares ao montar: a primeira
 * chamada busca, as outras não fazem nada. Antes do login o servidor recusa —
 * aí tenta de novo 20 s depois.
 */
export function garantirAniversariosDeHoje(): void {
  if (typeof window === "undefined" || buscando) return;
  const hoje = hojeNoBrasil();
  if (diaCarregado === hoje || Date.now() < tentarDepoisDe) return;
  buscando = true;
  void import("@/lib/mural.functions")
    .then(({ aniversariantesDeHoje }) => aniversariantesDeHoje())
    .then((r) => {
      nomes = new Set(r.nomes.map(normalizarNome));
      ids = new Set(r.ids);
      diaCarregado = r.dia || hoje;
      avisar();
    })
    .catch((e: unknown) => {
      // Enfeite: falhar aqui não pode atrapalhar nada; só tenta mais tarde.
      console.warn("[mural] aniversariantes de hoje:", (e as Error)?.message);
      tentarDepoisDe = Date.now() + 20_000;
    })
    .finally(() => {
      buscando = false;
    });
}

/** Faz aniversário hoje? Pelo nome (o que o avatar conhece). */
export function fazAniversarioHoje(nome: string): boolean {
  return nomes.size > 0 && nomes.has(normalizarNome(nome));
}

/** Faz aniversário hoje? Pelo id da pessoa. */
export function fazAniversarioHojeId(id: string): boolean {
  return ids.has(id);
}

/** Quem salvou o próprio aniversário: relê na próxima oportunidade. */
export function recarregarAniversariosDeHoje(): void {
  diaCarregado = "";
  tentarDepoisDe = 0;
  garantirAniversariosDeHoje();
}
