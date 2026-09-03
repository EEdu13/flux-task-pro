/**
 * Contrato da IAM Larsil (ver INTEGRACAO.md do projeto iam_larsil).
 *
 * Regra de ouro do contrato: só falamos com a IAM por HTTP. Nunca lemos as
 * tabelas `IAM_*` direto — elas estão visíveis no mesmo Azure SQL que usamos,
 * e é justamente por isso que vale repetir aqui.
 *
 * Este arquivo é isomórfico (tipos e constantes puras). O que fala com a rede
 * mora em `client.server.ts`, e o cookie em `session.server.ts`.
 */

/** Código do sistema no registro da IAM. Usado no /registry/sync e no /auth/acesso. */
export const SISTEMA_CODIGO = "FLUXO";

/** Prefixo de toda permissão nossa. Telas seguem `fluxo.tela:<rota>`. */
export const SISTEMA_NAMESPACE = "fluxo";

export type IamEscopoTipo = "GLOBAL" | "COORDENADOR" | "SUPERVISOR" | "EQUIPE" | "PROJETO";

export interface IamEscopo {
  tipo: IamEscopoTipo;
  valor: string;
}

/** O bloco `usuario` que vem do POST /api/auth/login. */
export interface IamUsuario {
  id: number;
  login: string;
  nome: string;
  cpf: string | null;
  admin: boolean;
  email: string | null;
  telefone: string | null;
  papeis: string[];
  permissoes: string[];
  escopos: IamEscopo[];
  global: boolean;
}

/** O que devolvemos ao navegador depois do login. Repare: sem o token. */
export interface IamSessao {
  usuario: IamUsuario;
  senhaProvisoria: boolean;
  /** Sem telefone o WhatsApp morre calado — o front pede confirmação uma vez. */
  precisaTelefone: boolean;
}

export type IamFalhaMotivo = "credenciais" | "inativo" | "indisponivel" | "inesperado";

export class IamError extends Error {
  constructor(
    message: string,
    readonly motivo: IamFalhaMotivo,
    readonly status = 0,
  ) {
    super(message);
    this.name = "IamError";
  }
}

/**
 * Papéis da IAM → papel interno do Fluxo.
 *
 * Cuidado ao mexer aqui: no Fluxo, `role` faz DOIS trabalhos — define permissão
 * (quem aparece em `visibleUsersForAssign()`) e vira cargo exibido, com direito
 * a coroa em Contatos. Então promover alguém "só para dar acesso" faz o app
 * anunciar essa pessoa como chefe.
 *
 * Por isso só papéis que são de fato hierárquicos entram. `TI` e `PCP` são
 * funcionais, não níveis de chefia — quem precisa de acesso amplo para dar
 * suporte deve ganhar isso por permissão, não por cargo falso.
 *
 * Na dúvida cai em "adm", o menos privilegiado.
 */
export function papeisParaRole(papeis: string[], admin: boolean): "gerente" | "supervisor" | "adm" {
  void admin; // ser admin DA IAM não é o mesmo que ser gerente NA empresa
  const norm = papeis.map((p) => p.toUpperCase());
  if (norm.some((p) => p === "GERENCIA" || p === "GERENTE" || p === "DIRETORIA")) {
    return "gerente";
  }
  if (norm.some((p) => p === "COORDENADOR" || p === "SUPERVISOR")) return "supervisor";
  return "adm";
}

/** Iniciais para o avatar, usadas como fallback quando a foto da IAM dá 404. */
export function iniciaisDoNome(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "??";
  if (partes.length === 1) return partes[0]!.slice(0, 2).toUpperCase();
  return (partes[0]![0]! + partes[partes.length - 1]![0]!).toUpperCase();
}
