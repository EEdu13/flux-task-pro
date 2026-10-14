import { COMPROMISSOS_MUDARAM, type Compromisso } from "@/lib/compromisso";
import { listarCompromissos } from "@/lib/compromissos.functions";

/* A leitura da agenda travada do lado da tela, com memória (14/10/2026).
 *
 * O calendário (mês, semana, dia, lista, linhas) e a agenda do dia pedem o
 * mesmo período várias vezes — trocar de visão e voltar, abrir e fechar a
 * agenda. Cada período ("de|ate|equipe") é buscado UMA vez por sessão e fica
 * guardado; travar, mudar ou cancelar esquece tudo (`esquecerCompromissos`),
 * e a próxima leitura vai ao servidor. Nenhuma sondagem: só lê quando alguém
 * mostra o período.
 */

export type LeituraDaAgenda = { ativa: boolean; compromissos: Compromisso[] };

const guardadas = new Map<string, Promise<LeituraDaAgenda>>();

/** Esquece o que foi lido — chame antes de avisar `COMPROMISSOS_MUDARAM`. */
export function esquecerCompromissos(): void {
  guardadas.clear();
}

if (typeof window !== "undefined") {
  // Rede de segurança: quem avisou sem esquecer antes.
  window.addEventListener(COMPROMISSOS_MUDARAM, esquecerCompromissos);
}

/** Os compromissos de um período ("yyyy-MM-dd"), da memória quando já lidos. */
export function lerCompromissos(
  de: string,
  ate: string,
  equipe: boolean,
): Promise<LeituraDaAgenda> {
  const chave = `${de}|${ate}|${equipe ? 1 : 0}`;
  let p = guardadas.get(chave);
  if (!p) {
    p = listarCompromissos({ data: { de, ate, equipe } });
    guardadas.set(chave, p);
    // Falhou: não guarda a falha — a próxima leitura tenta de novo.
    p.catch(() => {
      if (guardadas.get(chave) === p) guardadas.delete(chave);
    });
  }
  return p;
}

/** Avisa que a agenda travada mudou: esquece a memória e quem mostra relê. */
export function avisarQueCompromissosMudaram(): void {
  esquecerCompromissos();
  window.dispatchEvent(new CustomEvent(COMPROMISSOS_MUDARAM));
}

/**
 * Os compromissos de cada dia ("yyyy-MM-dd") no fuso da máquina. O que
 * atravessa a meia-noite aparece nos dois dias.
 */
export function compromissosPorDia(
  compromissos: Compromisso[],
  de: string,
  ate: string,
): Map<string, Compromisso[]> {
  const mapa = new Map<string, Compromisso[]>();
  for (const c of compromissos) {
    const d = new Date(c.inicio);
    d.setHours(0, 0, 0, 0);
    const fim = Date.parse(c.fim);
    for (let i = 0; i < 3 && d.getTime() < fim; i++) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (iso >= de && iso <= ate) {
        const lista = mapa.get(iso);
        if (lista) lista.push(c);
        else mapa.set(iso, [c]);
      }
      d.setDate(d.getDate() + 1);
    }
  }
  for (const lista of mapa.values()) lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
  return mapa;
}
