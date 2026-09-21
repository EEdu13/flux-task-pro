/* O histórico da tarefa — o que a aba Timeline mostra — é escrito AQUI, no
 * servidor, e só aqui.
 *
 * Até então o navegador montava as linhas e mandava algumas para o banco. Mais
 * da metade não ia: arrastar entre colunas, concluir, checklist, anexo, pack
 * transferido e a própria criação viviam só na memória de quem fez, e sumiam na
 * próxima vez que a tarefa era aberta — que é quando o histórico do banco entra
 * no lugar do local. Parecia registro apagado.
 *
 * Agora quem grava é quem conhece o fato: `salvarTarefa` compara o antes e o
 * depois da linha (status, responsável, prazo, criação, conclusão),
 * `salvarSatelites` compara o checklist e as menções, e o anexo registra a si
 * mesmo ao entrar e ao sair. O autor é sempre a sessão.
 *
 * Nome de pessoa não é congelado no texto: vai como `{pessoa:<id>}` e a tela
 * troca pelo nome atual na hora de desenhar. É o mesmo cuidado das
 * notificações — o nome mora na IAM, e gravá-lo aqui faria a Timeline mostrar
 * para sempre o nome que a pessoa tinha no dia.
 */

/** Os tipos que o CHECK de `gestor.historico_da_tarefa` aceita. */
export type TipoDeHistorico =
  | "criada"
  | "status"
  | "atribuicao"
  | "comentario"
  | "checklist"
  | "editada"
  | "concluida"
  | "mencao";

export type LinhaDeHistorico = { tipo: TipoDeHistorico; texto: string };

/** Marca de pessoa dentro do texto. A tela resolve; ver `task-dialog.tsx`. */
export const pessoaNoTexto = (id: number): string => `{pessoa:${id}}`;

/** O tamanho da coluna `texto`. */
const TETO_DO_TEXTO = 500;

/**
 * Até quantas linhas por tipo de mudança antes de resumir numa só. Colar uma
 * lista de doze itens no painel é UMA ação, e doze linhas "adicionou" soterrariam
 * o resto da Timeline.
 */
const LINHAS_POR_MUDANCA = 5;

type ItemDeChecklist = { texto: string; feito: boolean };

/**
 * O que mudou no checklist entre a lista gravada e a que chegou.
 *
 * O checklist é regravado inteiro (apaga e reinsere), então o id do item muda a
 * cada gravação e não serve para parear. O pareamento é pelo texto, em duas
 * passadas: primeiro o que casa em texto E estado (não mudou), depois o que
 * casa só no texto (foi marcado ou desmarcado). Numa passada só, dois
 * "Conferir" — um feito, outro não — trocados de lugar virariam um "marcou" e
 * um "desmarcou" que ninguém fez. Texto editado sai como o que é na lista: um
 * item saiu e outro entrou.
 */
export function mudancasNoChecklist(
  antes: ItemDeChecklist[],
  depois: ItemDeChecklist[],
): LinhaDeHistorico[] {
  const livres = antes.map((a) => ({ ...a, pareado: false }));
  const parDe: ((typeof livres)[number] | undefined)[] = depois.map(() => undefined);
  const parear = (mesmoEstado: boolean) =>
    depois.forEach((d, k) => {
      if (parDe[k]) return;
      const par = livres.find(
        (a) => !a.pareado && a.texto === d.texto && (!mesmoEstado || a.feito === d.feito),
      );
      if (par) {
        par.pareado = true;
        parDe[k] = par;
      }
    });
  parear(true);
  parear(false);

  const adicionados: string[] = [];
  const marcados: string[] = [];
  const desmarcados: string[] = [];
  depois.forEach((d, k) => {
    const par = parDe[k];
    if (!par) adicionados.push(d.texto);
    else if (!par.feito && d.feito) marcados.push(d.texto);
    else if (par.feito && !d.feito) desmarcados.push(d.texto);
  });
  const removidos = livres.filter((a) => !a.pareado).map((a) => a.texto);

  const linhas = (
    itens: string[],
    umItem: (t: string) => string,
    resumo: (n: number) => string,
  ): LinhaDeHistorico[] =>
    itens.length > LINHAS_POR_MUDANCA
      ? [{ tipo: "checklist", texto: resumo(itens.length) }]
      : itens.map((t) => ({ tipo: "checklist", texto: umItem(t) }));

  return [
    ...linhas(
      adicionados,
      (t) => `adicionou "${t}" ao checklist`,
      (n) => `adicionou ${n} itens ao checklist`,
    ),
    ...linhas(
      marcados,
      (t) => `marcou "${t}" como feito`,
      (n) => `marcou ${n} itens como feitos`,
    ),
    ...linhas(
      desmarcados,
      (t) => `desmarcou "${t}"`,
      (n) => `desmarcou ${n} itens`,
    ),
    ...linhas(
      removidos,
      (t) => `removeu "${t}" do checklist`,
      (n) => `removeu ${n} itens do checklist`,
    ),
  ];
}

/**
 * Grava as linhas, uma por comando e na ordem dada.
 *
 * Falha em silêncio, só com aviso no log: é registro de apoio. Perder uma linha
 * de histórico não pode transformar em erro a gravação do checklist ou o envio
 * do anexo, que já aconteceram quando isto roda.
 */
export async function registrarNoHistorico(
  tarefaId: string,
  autorId: number,
  linhas: LinhaDeHistorico[],
): Promise<void> {
  if (!linhas.length) return;
  try {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    for (const l of linhas) {
      await pool
        .request()
        .input("t", sql.UniqueIdentifier, tarefaId)
        .input("autor", sql.Int, autorId)
        .input("tipo", sql.NVarChar, l.tipo)
        .input("texto", sql.NVarChar, l.texto.slice(0, TETO_DO_TEXTO))
        .query(
          `INSERT INTO gestor.historico_da_tarefa (tarefa_id, autor_id, tipo, texto)
           VALUES (@t, @autor, @tipo, @texto)`,
        );
    }
  } catch (e) {
    console.warn("[historico] linha não gravou:", (e as Error)?.message);
  }
}
