/** Uma opção do catálogo do avatar: o valor gravado e o rótulo da tela. */
export type Opcao<T extends string> = { v: T; rotulo: string };

/** Monta uma lista de opções guardando os valores como tipos literais. */
export const op = <T extends string>(...pares: [T, string][]): Opcao<T>[] =>
  pares.map(([v, rotulo]) => ({ v, rotulo }));
