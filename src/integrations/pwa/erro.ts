import type {
  FalhaDaEstrutura,
  MotivoDaFalha,
  PessoaDaEquipe,
  VeiculoDaEquipe,
} from "@/lib/estrutura-tipos";

/**
 * O erro da estrutura do dia, com o `motivo` que a tela lê. Atravessa o server
 * function com as próprias propriedades (o seroval copia todas), mas não como
 * instância da classe: a tela decide pelo `motivo`, nunca pelo texto nem por
 * `instanceof` (mesma regra do `AgendadorError`).
 *
 * Sem import de servidor: só tipos, então pode morar fora dos `.server.ts`.
 */
export class ErroDaEstrutura extends Error implements FalhaDaEstrutura {
  /** `lista_mudou`: a lista atual, para a tela se refazer sem outra ida à rede. */
  pessoas?: PessoaDaEquipe[];
  veiculos?: VeiculoDaEquipe[];

  constructor(
    readonly motivo: MotivoDaFalha,
    message: string,
    /** O status HTTP do PWA, quando o erro veio dele. Só para diagnóstico. */
    readonly status = 0,
  ) {
    super(message);
    this.name = "ErroDaEstrutura";
  }
}
