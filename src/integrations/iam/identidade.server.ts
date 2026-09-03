// Quem está chamando — decidido no SERVIDOR, nunca pelo cliente.
// EXCLUSIVO do servidor.
//
// Antes deste módulo, cada server function recebia o `userId` como parâmetro e
// acreditava nele. Isso não é autenticação: é o cliente dizendo quem ele quer
// ser. Bastava trocar um campo do corpo da requisição para ler o chat de outra
// pessoa, mandar mensagem no nome dela ou entrar numa sala privada.
//
// A identidade certa já estava disponível o tempo todo: o JWT da IAM vive num
// cookie `httpOnly`, que o JavaScript da página não consegue ler nem escrever e
// que o navegador anexa sozinho em toda chamada. Faltava alguém abri-lo.

/**
 * O id de quem está chamando, ou erro.
 *
 * Devolve string porque é assim que o id circula nas tabelas (`from_user_id`,
 * `target_user_id`, `user_id` são NVARCHAR) — a IAM entrega número, e converter
 * aqui, num lugar só, evita que cada chamador lembre de fazer isso.
 *
 * Lança em vez de devolver `null` de propósito. Um retorno nulo convida ao
 * `?? algumCoisa` no chamador, e é exatamente esse "algum coisa" que reabriria
 * a porta. Quem não tem sessão não passa.
 */
export async function usuarioDaSessao(): Promise<string> {
  const { iamHabilitado, iamResolve } = await import("./client.server");
  const { lerSessao } = await import("./session.server");

  // Sem porta dos fundos para o modo de demonstração.
  //
  // Seria fácil devolver aqui o id que o cliente mandou quando IAM_ENABLED=0, e
  // seria exatamente o buraco que este módulo existe para fechar — bastaria
  // alguém subir o sistema com a variável errada. Se a IAM estiver desligada,
  // as telas que dependem de identidade param, e param de forma visível.
  if (!iamHabilitado()) {
    throw new Error("Autenticação indisponível. Entre em contato com a TI.");
  }

  const token = lerSessao();
  if (!token) throw new Error("Sessão expirada. Entre novamente.");

  // O `iamResolve` guarda 60s em memória, então o caminho comum não paga a ida
  // e volta até a Railway. Ele também é quem recusa token vencido ou revogado.
  const { usuarioId } = await iamResolve(token);
  if (!usuarioId) throw new Error("Sessão inválida. Entre novamente.");

  return String(usuarioId);
}

/**
 * O mesmo id, como número.
 *
 * As tabelas do schema `gestor` guardam pessoa em `INT`, e as antigas do `dbo`
 * em `NVARCHAR` — herança do tempo em que os ids eram `u1`, `u2`. Enquanto as
 * duas existirem, existem as duas formas de pedir a mesma coisa, e o nome diz
 * qual é qual em vez de deixar um `Number(...)` solto em cada consulta.
 */
export async function pessoaDaSessao(): Promise<number> {
  const id = Number(await usuarioDaSessao());
  // A IAM sempre entrega número, mas se um dia mudar para login, é aqui que
  // aparece — e melhor aparecer com uma frase do que virar NaN numa consulta.
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Identificação da sessão em formato inesperado.");
  }
  return id;
}

/**
 * O id de outra pessoa, vindo do cliente — o destinatário de uma mensagem, o
 * alvo de uma chamada.
 *
 * Este SIM é legítimo receber de fora: para quem eu mando não é quem eu sou.
 * A validação aqui é de formato, não de identidade — ela só impede que o valor
 * chegue torto na consulta.
 */
export function outroUsuario(valor: unknown): string {
  if (typeof valor !== "string") throw new Error("Usuário inválido");
  const id = valor.trim().slice(0, 80);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Usuário inválido");
  return id;
}
