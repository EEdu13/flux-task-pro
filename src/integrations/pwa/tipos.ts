import type { SituacaoDoDia } from "@/lib/estrutura-tipos";

/**
 * O que o cliente do PWA devolve, JÁ ADAPTADO: nomes e tipos do CONECTA, nada de
 * campo do PWA. Só `adaptadores.server.ts` conhece os campos de lá (os nomes
 * vieram do teste de leitura de 09/11/2026). Estes tipos são de SERVIDOR:
 * carregam o CPF inteiro, que nunca vai para a tela.
 */

export interface EquipePwa {
  equipe: string;
  /** O nome do líder NO ORGANOGRAMA: a cobrança do ADM exige exatamente ele. */
  lider: string;
  projeto: string;
  cliente: string;
}

export interface MinhasEquipesPwa {
  modoAdm: boolean;
  equipes: EquipePwa[];
  /**
   * A FORMA da resposta numa linha (chaves, `modoAdm`, quantos itens, campos do 1º item e os códigos
   * das equipes; nenhum nome nem CPF), para o diagnóstico do piloto (18/11/2026).
   */
  resumo: string;
}

export interface PessoaPwa {
  /** Negativo = PJ ou estagiário (COLABORADORES_EXTERNOS), sem CPF. */
  id: number;
  nome: string;
  funcao: string;
  /** Como o PWA devolveu (só dígitos); vazio no externo. NUNCA vai para a tela. */
  cpf: string;
  /** O `cpfMasked` do PWA ("******999", só os 3 últimos dígitos); vazio no externo. */
  cpfMascarado: string;
  /** A classe que o PWA espera de volta no POST: ADM, PJ ou ESTAGIARIO. */
  classe: string;
  externo: boolean;
  /** "PJ" ou "ESTAGIARIO"; vazio no efetivo. */
  tipoExterno: string;
  projeto: string;
  coordenador: string;
  supervisor: string;
}

export interface VeiculoPwa {
  /** O id da frota: é o que a chamada de puxar para a equipe leva. */
  id: number;
  prefixo: string;
  placa: string;
  modelo: string;
  /** O agrupamento da tela. No PWA é a própria `classe` (AUTOMOVEL, CAMINHONETE LEVE…). */
  tipo: string;
  classe: string;
}

/**
 * Uma linha de `colaboradores/todas-equipes`: todo mundo de COLABORADORES, com a equipe. Só efetivo
 * (PJ e estagiário não vêm) e só o CPF mascarado: a rota não traz o inteiro.
 */
export interface ColaboradorPwa {
  id: number;
  nome: string;
  funcao: string;
  cpfMascarado: string;
  /** "ADM" = escritório; as outras (COF, OPF, MEC…) são de campo. */
  classe: string;
  /** Vazio ou "SEM_EQUIPE" = sem equipe (`estaSemEquipe`). */
  equipe: string;
  coordenador: string;
}

/** Um veículo de `frota?projeto=`: o mesmo da equipe, mais a equipe em que está (vazio ou SEM_EQUIPE = sem equipe). */
export interface VeiculoDoProjetoPwa extends VeiculoPwa {
  equipe: string;
}

/** Uma linha do TICKET do dia: de uma pessoa ou de um veículo. */
export interface LinhaDoDiaPwa {
  tipo: "pessoa" | "veiculo";
  nome: string;
  /** Vazio no externo. */
  cpf: string;
  prefixo: string;
  /** Como o PWA devolveu (minúsculas na leitura): o canônico sai de `statusDaPessoa` e `statusDoVeiculo`. */
  status: string;
}

export interface CobrancaPwa {
  /** A situação de cada dia útil do mês que a cobrança cobre (AAAA-MM-DD). `feito` = existe TICKET no dia. */
  dias: Record<string, "feito" | "pendente" | "folga" | "naoCobrado">;
  /** A situação de HOJE, a que o card e o lembrete leem (o `scoreDia` do PWA). */
  hoje: SituacaoDoDia;
}

/** Projeto, coordenador e supervisor da equipe: o `user` do POST. */
export interface HierarquiaPwa {
  projeto: string;
  coordenador: string;
  supervisor: string;
}

/** Tudo o que o servidor decidiu para um envio; o adaptador monta o corpo que o PWA entende. */
export interface EntradaDoEnvio {
  equipe: EquipePwa;
  hierarquia: HierarquiaPwa;
  /** O dia do envio (`data`). O PWA apaga e grava ESTE dia; o `hojeCelular` nunca vai (Eduardo, 09/11/2026). */
  dia: string;
  /** `L` + milissegundos + 3 letras, SEM prefixo: o PWA acrescenta `CONECTA-` pela `origem`. */
  loteId: string;
  pessoas: { nome: string; cpf: string; classe: string; status: string }[];
  veiculos: { prefixo: string; placa: string; classe: string; status: string }[];
}

export interface RespostaDoEnvio {
  /** Lançamentos do PCP, ajustes e retroativos que o PWA manteve no reenvio; `null` se a resposta não disse. */
  preservados: number | null;
}

/** As operações do PWA que a Parte A usa. A implementação é `cliente.server.ts`. */
export interface ClienteDoPwa {
  minhasEquipes(token: string): Promise<MinhasEquipesPwa>;
  pessoas(token: string, equipe: string): Promise<PessoaPwa[]>;
  veiculos(token: string, equipe: string): Promise<VeiculoPwa[]>;
  /** Os dias (AAAA-MM-DD) de `de` a `ate` que já têm estrutura enviada. Aceita janela maior que 5 dias. */
  diasEnviados(token: string, equipe: string, de: string, ate: string): Promise<string[]>;
  linhasDoDia(token: string, equipe: string, dia: string): Promise<LinhaDoDiaPwa[]>;
  cobranca(token: string, equipe: EquipePwa): Promise<CobrancaPwa>;
  enviar(token: string, entrada: EntradaDoEnvio): Promise<RespostaDoEnvio>;
  /**
   * Todo mundo de COLABORADORES, com a equipe (`colaboradores/todas-equipes`). O PWA NÃO filtra
   * por líder: quem chama aplica o alcance (o mesmo coordenador, ou nenhum).
   */
  todosOsColaboradores(token: string): Promise<ColaboradorPwa[]>;
  /** A frota ativa do projeto, com a equipe de cada veículo (`frota?projeto=`). Também sem filtro de alcance. */
  frotaDoProjeto(token: string, projeto: string): Promise<VeiculoDoProjetoPwa[]>;
  /**
   * Só para quem tem id positivo: para id negativo o PWA responde success e não faz nada.
   * `ator` = o nome do líder logado, que o PWA grava na auditoria.
   */
  moverParaSemEquipe(token: string, id: number, ator: string): Promise<void>;
  /**
   * Tira o veículo da equipe: ele volta para o projeto, sem equipe (`PUT frota/:id/equipe`, Eduardo,
   * 10/11/2026). Como a frota não grava quem mexeu, não há `ator` nem `acao`.
   */
  moverVeiculoParaSemEquipe(token: string, id: number): Promise<void>;
  /** Puxa a pessoa para a equipe (`PUT colaboradores/:id/equipe`, acao "ajuste-puxar"). Só id positivo. */
  adicionarPessoa(token: string, id: number, equipe: string, ator: string): Promise<void>;
  /** Puxa o veículo para a equipe (`PUT frota/:id/equipe`). A frota não grava quem mexeu. */
  adicionarVeiculo(token: string, id: number, equipe: string): Promise<void>;
}
