export interface DepartmentRoom {
  name: string;
  label: string;
  desc: string;
  sector?: string;
}

/**
 * `name` é IDENTIFICADOR, não texto de tela: ele vira o nome da sala no LiveKit
 * e o pedaço da URL em `/salas/$roomName`. Só o `label` aparece para a pessoa.
 *
 * Daí duas regras que não são estilo:
 *
 * 1. Sem acento, sem barra, sem espaço. "CONTÁBIL/FISCAL" na URL viraria
 *    `/salas/contabil/fiscal` — outra rota, que não existe.
 *
 * 2. SEM HÍFEN. O hífen já tem dono: `salas.$roomName.tsx` monta o rótulo com
 *    `roomName.split("-")`, tratando o que vem antes como o departamento e o
 *    que vem depois como o número da sala. Um `contabil-fiscal` seria lido como
 *    "departamento contabil, Sala fiscal".
 *
 * O `sector` casa com `perfis.setor`, que é o slug de `setorParaId()`. Para
 * "CONTÁBIL/FISCAL" aquela função tira a barra e devolve `contabilfiscal` —
 * por isso o id aqui é esse, e não um inventado: no dia em que a IAM passar a
 * ter o setor, os dois lados já se encontram.
 */
export const DEPARTMENT_ROOMS: DepartmentRoom[] = [
  { name: "diretoria", label: "Diretoria", desc: "Sala da diretoria", sector: "diretoria" },
  { name: "financeiro", label: "Financeiro", desc: "Sala do time financeiro", sector: "financeiro" },
  { name: "controladoria", label: "Controladoria", desc: "Sala da controladoria", sector: "controladoria" },
  {
    name: "contabilfiscal",
    label: "CONTÁBIL/FISCAL",
    desc: "Sala do time contábil e fiscal",
    sector: "contabilfiscal",
  },
  { name: "ti", label: "TI", desc: "Sala de Tecnologia da Informação", sector: "ti" },
  { name: "rh", label: "RH", desc: "Sala de Recursos Humanos", sector: "rh" },
  { name: "dho", label: "DHO", desc: "Desenvolvimento Humano e Organizacional", sector: "dho" },
  { name: "pcp", label: "PCP", desc: "Planejamento e Controle da Produção", sector: "pcp" },
  { name: "suprimentos", label: "Suprimentos", desc: "Sala de suprimentos e compras", sector: "suprimentos" },
];