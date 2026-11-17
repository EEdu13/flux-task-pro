/**
 * O contrato da estrutura do dia: o que a tela e o servidor trocam entre si.
 *
 * Nada do PWA vaza para cá (nomes de campo, formato de data, `LOTE_ID`): quem
 * conhece o PWA é só `integrations/pwa/adaptadores.server.ts`. E nada de CPF
 * inteiro: a tela recebe o CPF MASCARADO, e o corpo do envio é montado no
 * servidor com o CPF que o próprio PWA devolveu.
 */

/* ------------------------------- Status ------------------------------- */

export const NAO_ESTA_NA_EQUIPE = "NÃO ESTÁ NA EQUIPE";

/** Texto idêntico ao do PWA e do banco: maiúsculas, acentos, sem emoji (spec 04/11 e Eduardo 05/11). */
export const STATUS_PESSOA = [
  "ADM",
  "FALTA",
  "FÉRIAS",
  "FOLGA",
  "ATESTADO",
  NAO_ESTA_NA_EQUIPE,
] as const;

export const STATUS_VEICULO = [
  "À DISPOSIÇÃO",
  "APOIO",
  "OFICINA",
  "À VENDA",
  "SEM ATIVIDADE",
  NAO_ESTA_NA_EQUIPE,
] as const;

export type StatusPessoa = (typeof STATUS_PESSOA)[number];
export type StatusVeiculo = (typeof STATUS_VEICULO)[number];

/** Sem acento, sem caixa e com os espaços aparados: "à disposição" e "A DISPOSICAO" comparam iguais. */
export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

const canonico = <T extends string>(lista: readonly T[], texto: string): T | null => {
  const alvo = semAcento(texto);
  return lista.find((s) => semAcento(s) === alvo) ?? null;
};

/** O PWA lê o status em minúsculas ("férias") e grava em MAIÚSCULAS: aqui vira a constante, ou `null` se não é da lista. */
export const statusDaPessoa = (texto: string): StatusPessoa | null =>
  canonico(STATUS_PESSOA, texto);
export const statusDoVeiculo = (texto: string): StatusVeiculo | null =>
  canonico(STATUS_VEICULO, texto);

/* ------------------------- O que a tela lê do PWA ------------------------- */

export interface EquipeDaEstrutura {
  equipe: string;
  projeto: string;
  cliente: string;
}

/** As equipes de quem chama, e como a tela as mostra. */
export interface EquipesDaPessoa {
  /** `false` = a estrutura não é para esta pessoa: sem menu, sem card, sem lembrete. */
  aberta: boolean;
  equipes: EquipeDaEstrutura[];
  /** Tem o seletor de equipe? Só o Eduardo (usuário global). */
  trocaDeEquipe: boolean;
  /** A equipe em que a tela abre: a da própria pessoa. Vazio = sem equipe. */
  inicial: string;
}

export interface PessoaDaEquipe {
  /** Negativo = PJ ou estagiário (vem de COLABORADORES_EXTERNOS, sem CPF). */
  id: number;
  nome: string;
  funcao: string;
  /** Mascarado ("***.456.789-**"); vazio para externo. */
  cpf: string;
  externo: boolean;
  /** "PJ" ou "ESTAGIARIO"; vazio no efetivo. */
  tipoExterno: string;
  /** Supervisor: a função tem "supervisor", ou é o supervisor de alguém da própria equipe. A tela dá destaque. */
  supervisor: boolean;
}

/** A função tem "supervisor", em qualquer caixa e com ou sem acento: a "tag" de supervisor do cadastro. */
export const funcaoDeSupervisor = (funcao: string): boolean =>
  semAcento(funcao).includes("SUPERVISOR");

export interface VeiculoDaEquipe {
  prefixo: string;
  placa: string;
  modelo: string;
  /** O agrupamento da tela (CRV_ESPECIE_TIPO). */
  tipo: string;
}

export type SituacaoDoDia = "enviado" | "pendente" | "folga" | "naoCobrado" | "futuro";

export interface DiaDaSemana {
  /** AAAA-MM-DD */
  dia: string;
  situacao: SituacaoDoDia;
}

export interface MarcaDePessoa {
  id: number;
  status: string;
}

export interface MarcaDeVeiculo {
  prefixo: string;
  status: string;
}

/** A estrutura já enviada para um dia, casada com a lista de hoje. */
export interface EstruturaDoDia {
  enviada: boolean;
  pessoas: MarcaDePessoa[];
  veiculos: MarcaDeVeiculo[];
  /** Linhas do dia que não casam com ninguém da lista de hoje (saiu da equipe depois). Só para mostrar. */
  foraDaLista: { nome: string; status: string }[];
}

export interface CobrancaDaEquipe {
  equipe: string;
  /** A situação de HOJE; é o que o card do Início e o lembrete do Pack leem. */
  hoje: SituacaoDoDia;
}

/* ------------------------------- O envio ------------------------------- */

export interface PedidoDeEnvio {
  equipe: string;
  dia: string;
  pessoas: MarcaDePessoa[];
  veiculos: MarcaDeVeiculo[];
  confirmacao: {
    /** A pessoa confirmou o envio antes das 4h. */
    madrugada: boolean;
    /** A pessoa confirmou que a estrutura já enviada será substituída. */
    reenvio: boolean;
    /** Os ids que o popup de retirada mostrou: têm de ser exatamente os marcados NÃO ESTÁ NA EQUIPE. */
    retirados: number[];
    /** O mesmo para os veículos, pelo prefixo em maiúsculas: o veículo marcado NÃO ESTÁ NA EQUIPE também sai da equipe. */
    retiradosVeiculos: string[];
  };
}

export interface ResultadoDoEnvio {
  /** `true` = nada foi enviado ao PWA (envio desligado, ou o dev, que nunca envia). */
  simulado: boolean;
  pessoas: number;
  veiculos: number;
  /** Lançamentos do PCP, ajustes e retroativos que o PWA manteve no reenvio (resposta do POST). */
  preservados: number | null;
  /** Nomes das pessoas e prefixos dos veículos movidos para SEM EQUIPE. */
  retirados: string[];
  /** `nome` é o nome da pessoa ou o prefixo do veículo. O motivo "externo" só existe para pessoa. */
  naoRetirados: { nome: string; motivo: "externo" | "falha" }[];
}

/* ---------------------- Puxar para a equipe (adicionar) ---------------------- */

/**
 * O "depósito" do PWA: para onde vai quem sai da equipe (a retirada) e de onde se puxa
 * quem entra. Adicionar é o espelho de retirar: sai de `SEM_EQUIPE` e entra na equipe.
 */
export const SEM_EQUIPE = "SEM_EQUIPE";

/** No PWA, sem equipe é a equipe VAZIA ou "SEM_EQUIPE", nas pessoas e na frota (Eduardo, 10/11/2026). */
export function estaSemEquipe(equipe: string): boolean {
  const e = equipe
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, "_");
  return e === "" || e === SEM_EQUIPE;
}

export type TipoDeCandidato = "pessoas" | "veiculos";

/**
 * Quem está sem equipe e pode ser puxado. Só efetivo: PJ e estagiário (id negativo) nem vêm
 * na lista do PWA, e o PUT com id negativo não faz nada.
 */
export interface CandidatoDePessoa {
  id: number;
  nome: string;
  funcao: string;
  /** Mascarado, como na lista da equipe. */
  cpf: string;
}

export interface CandidatoDeVeiculo {
  id: number;
  prefixo: string;
  placa: string;
  modelo: string;
  tipo: string;
}

export interface Candidatos {
  /** Só a lista pedida vem preenchida; a outra vem vazia. */
  pessoas: CandidatoDePessoa[];
  veiculos: CandidatoDeVeiculo[];
  /**
   * O alcance que filtrou a lista, para a tela dizer de onde ela vem. Pessoas: as da coordenação
   * da equipe e as sem coordenador. Veículos: os do projeto da equipe. Vazio = não se sabe.
   */
  alcance: { coordenador: string; projeto: string };
}

/** Os ids são os das listas de candidatos; o servidor confere de novo que ainda estão sem equipe e no alcance. */
export interface PedidoDeAdicao {
  equipe: string;
  pessoas: number[];
  veiculos: number[];
}

export interface ResultadoDaAdicao {
  /** Nomes que entraram na equipe. */
  pessoas: string[];
  /** Prefixos que entraram na equipe. */
  veiculos: string[];
  /** O que o PWA não aceitou ou não respondeu: nada foi desfeito, o resto entrou. */
  falhas: { nome: string; motivo: "recusado" | "indisponivel" }[];
}

/* -------------------------------- Falhas -------------------------------- */

/**
 * O que a tela decide pelo `motivo`, nunca pelo texto (mesma regra do
 * Agendador). O erro atravessa o servidor com as próprias propriedades, mas não
 * como instância da classe: a leitura é pela forma do objeto.
 */
export type MotivoDaFalha =
  | "fechada" // a estrutura não está aberta para esta pessoa
  | "sem_sessao"
  | "fora_do_alcance" // a equipe não é da pessoa
  | "indisponivel" // PWA fora do ar, rota que não existe, 5xx ou rede
  | "acesso_negado" // o PWA recusou o token com a sessão da IAM válida
  | "sem_permissao" // 403 do PWA: a equipe não está no alcance do login
  | "dia_invalido"
  | "dia_futuro"
  | "madrugada"
  | "lista_mudou" // ids ou prefixos não batem com a lista atual do PWA
  | "ja_enviado" // o dia já tem estrutura e o reenvio não foi confirmado
  | "retirada_mudou"
  | "envio_em_andamento"
  | "dia_virou" // 409 do PWA (o CONECTA não manda o `hojeCelular`, então só se o PWA passar a exigir)
  | "dado_recusado" // 400/422 do PWA, com a mensagem dele
  | "envio_incerto" // tempo esgotado ou 5xx no POST: pode ter gravado
  | "adicao_desligada" // puxar para a equipe ainda não está liberado
  | "candidato_indisponivel" // já não está sem equipe (alguém puxou antes) ou está fora do alcance
  | "inesperado";

export interface FalhaDaEstrutura {
  motivo?: MotivoDaFalha;
  message?: string;
  /** `lista_mudou`: a lista atual, para a tela se refazer sem outra ida à rede. */
  pessoas?: PessoaDaEquipe[];
  veiculos?: VeiculoDaEquipe[];
}

/** Quem acabou de enviar avisa a tela inteira: o card e o lembrete ficam verdes na hora. */
export const EVENTO_ESTRUTURA_ENVIADA = "fluxo:estrutura-enviada";
