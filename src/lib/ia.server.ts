import Anthropic from "@anthropic-ai/sdk";

/**
 * O que as IAs de texto do app têm em comum: o modelo, o erro traduzido e o
 * calendário. Usado pela Tarefa por voz, pela Ata da reunião e pelo Bloco de
 * notas.
 *
 * Sem `@/` nos imports de propósito: assim um script de teste consegue carregar
 * estes arquivos direto no Node, com as chaves reais, sem subir o app inteiro.
 */

export const MODELO_DE_TEXTO = "claude-sonnet-5";

/** Erro com frase para a tela. O `message` técnico fica só no log do servidor. */
export class ErroDaIa extends Error {
  readonly paraTela: string;
  constructor(paraTela: string, tecnico?: string) {
    super(tecnico ?? paraTela);
    this.paraTela = paraTela;
  }
}

/** Erro da API do Claude trocado pela frase da tela. */
export function erroDoClaude(e: unknown, fazendo: string): ErroDaIa {
  if (e instanceof Anthropic.AuthenticationError)
    return new ErroDaIa("A chave do Claude foi recusada.", "anthropic 401");
  if (e instanceof Anthropic.RateLimitError)
    return new ErroDaIa("Muitos pedidos de uma vez. Tente de novo em instantes.", "anthropic 429");
  // Saldo zerado chega como 400 com a explicação na mensagem.
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message))
    return new ErroDaIa("A conta do Claude está sem crédito.", "anthropic 400 credit");
  if (e instanceof Anthropic.APIError) return new ErroDaIa(`Não consegui ${fazendo}.`, `anthropic ${e.status}`);
  return new ErroDaIa(`Não consegui ${fazendo}.`, (e as Error)?.name);
}

const DIAS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

/**
 * Os próximos dias escritos por extenso. Modelo de linguagem erra conta de
 * calendário ("sexta que vem" numa quinta); com a tabela na frente ele só lê.
 */
export function calendario(hoje: string, dias = 21): string {
  const [a, m, d] = hoje.split("-").map(Number) as [number, number, number];
  const linhas: string[] = [];
  for (let i = 0; i < dias; i++) {
    const dia = new Date(Date.UTC(a, m - 1, d + i));
    const iso = dia.toISOString().slice(0, 10);
    const rotulo = i === 0 ? " (hoje)" : i === 1 ? " (amanhã)" : "";
    linhas.push(`${iso} ${DIAS[dia.getUTCDay()]}${rotulo}`);
  }
  return linhas.join("\n");
}

/** Uma pessoa da equipe, como as IAs a enxergam. */
export interface PessoaDoTime {
  id: string;
  nome: string;
  setor?: string;
  cargo?: string;
}

/** A equipe em texto, para o modelo escolher o responsável pelo id. */
export function equipeEmTexto(
  pessoas: PessoaDoTime[],
  euId?: string,
  rotuloEu = "(quem está usando o sistema agora)",
): string {
  return pessoas
    .map((p) => {
      const extra = [p.cargo, p.setor].filter(Boolean).join(" · ");
      const eu = p.id === euId ? ` ${rotuloEu}` : "";
      return `${p.id} | ${p.nome}${extra ? ` | ${extra}` : ""}${eu}`;
    })
    .join("\n");
}
