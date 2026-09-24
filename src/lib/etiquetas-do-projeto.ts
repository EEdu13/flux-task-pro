/**
 * As etiquetas que toda subtarefa de projeto carrega: "projeto" e o nome do
 * projeto.
 *
 * A regra existia só na linha de criação rápida da tela de projetos, e nada a
 * sustentava depois: uma gravação que mandasse a lista sem elas as apagava, e
 * uma que falhasse no meio deixava metade. O banco mostrava as duas coisas —
 * subtarefa com o nome do projeto e sem "projeto" ao lado de outras completas.
 *
 * Agora quem garante é o servidor, em toda gravação (`salvarTarefa` e
 * `salvarSatelites`). A tela usa a mesma função só para a tarefa nascer com o
 * que o banco vai ter. Arquivo isomórfico: os dois lados importam daqui.
 */

/** O tamanho da coluna `gestor.etiquetas.nome`. Nome maior entra cortado. */
export const TETO_DA_ETIQUETA = 40;

export const ETIQUETA_DE_PROJETO = "projeto";

/** Como toda etiqueta é gravada: sem espaço nas pontas e no tamanho da coluna. */
export const normalizarEtiqueta = (nome: string): string =>
  nome.trim().slice(0, TETO_DA_ETIQUETA).trim();

export function etiquetasDoProjeto(nomeDoProjeto: string): string[] {
  const nome = normalizarEtiqueta(nomeDoProjeto);
  return nome ? [ETIQUETA_DE_PROJETO, nome] : [ETIQUETA_DE_PROJETO];
}

/**
 * Junta listas de etiquetas sem repetir, comparando sem caixa — como o banco.
 *
 * "Projeto" e "projeto" são a MESMA linha em `gestor.etiquetas` (a coluna tem
 * UNIQUE e a collation ignora caixa). Deixar as duas na lista fazia a segunda
 * ligação bater na chave primária de `tarefa_etiquetas`, e a gravação inteira
 * falhava. Fica a primeira grafia que aparecer.
 */
export function juntarEtiquetas(...listas: string[][]): string[] {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const lista of listas) {
    for (const bruta of lista) {
      const nome = normalizarEtiqueta(bruta);
      const chave = nome.toLowerCase();
      if (!nome || vistas.has(chave)) continue;
      vistas.add(chave);
      saida.push(nome);
    }
  }
  return saida;
}
