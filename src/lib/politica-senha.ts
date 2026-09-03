/**
 * Política de senha do Fluxo — fonte única.
 *
 * A regra vive aqui, e não dentro da tela, porque ela é cobrada em dois
 * lugares: o formulário de primeiro acesso (mostrando os itens ao vivo) e o
 * validator da server function, que é o portão de verdade — sem ele, quem
 * chamar a função direto passaria com qualquer senha. Duas cópias da mesma
 * regra viram duas regras diferentes na primeira alteração.
 */

export const MIN_SENHA = 12;

export type RequisitoSenha = {
  id: string;
  rotulo: string;
  ok: boolean;
};

/**
 * \p{L} e não [a-z]: nomes e senhas com acento são comuns em português, e um
 * "ç" ou "ã" é letra tanto quanto um "c". O símbolo é definido por exclusão
 * (nem letra, nem dígito, nem espaço) para não precisar listar teclado por
 * teclado — assim "£" ou "§" também contam.
 */
export function avaliarSenha(senha: string): RequisitoSenha[] {
  return [
    { id: "tamanho", rotulo: `Pelo menos ${MIN_SENHA} caracteres`, ok: senha.length >= MIN_SENHA },
    { id: "letra", rotulo: "Uma letra", ok: /\p{L}/u.test(senha) },
    { id: "numero", rotulo: "Um número", ok: /\d/.test(senha) },
    { id: "simbolo", rotulo: "Um símbolo (!, @, #, $…)", ok: /[^\p{L}\d\s]/u.test(senha) },
  ];
}

export function senhaValida(senha: string): boolean {
  return avaliarSenha(senha).every((r) => r.ok);
}

/** Mensagem única para quem só precisa saber se passou ou não (servidor, submit). */
export function erroSenha(senha: string): string | null {
  const faltando = avaliarSenha(senha).filter((r) => !r.ok);
  if (!faltando.length) return null;
  return `A senha ainda precisa de: ${faltando.map((r) => r.rotulo.toLowerCase()).join(", ")}.`;
}
