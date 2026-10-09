/* Quem acabou de trocar a foto (Configurações) precisa vê-la na hora, em todo
   rosto da tela — o navegador guardaria a antiga por até 1h. Cada troca soma
   um carimbo ao endereço daquele nome, e todos os avatares dele recarregam. */
const carimbos = new Map<string, number>();
const ouvintes = new Set<() => void>();
export function fotoTrocada(nome: string) {
  carimbos.set(nome.trim().toUpperCase(), Date.now());
  ouvintes.forEach((f) => f());
}
export const assinarFotos = (f: () => void) => {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
};

export const carimboDaFoto = (nome: string) => carimbos.get(nome.trim().toUpperCase()) ?? 0;
