import { useFrame } from "@react-three/fiber";
type Tarefa = { id: string; rodar: () => void; cancelada: boolean };
const fila: Tarefa[] = [];
let ultimoFrame = -1;
export function enfileirar(id: string, rodar: () => void): () => void {
  const t: Tarefa = { id, rodar, cancelada: false };
  fila.push(t);
  return () => {
    t.cancelada = true;
  };
}
/** Quantas peças ainda esperam a vez — a fábrica de miniaturas só fotografa com a fila vazia. */
export function tarefasNaFila(): number {
  let n = 0;
  for (const t of fila) if (!t.cancelada) n++;
  return n;
}
/** Todo componente que enfileira chama este hook; a guarda garante 1 tarefa por frame mesmo com N inscritos. */
export function useDrenarFila(): void {
  useFrame((state) => {
    const f = state.gl.info.render.frame;
    if (f === ultimoFrame) return;
    ultimoFrame = f;
    while (fila.length) {
      const t = fila.shift()!;
      if (!t.cancelada) {
        t.rodar();
        break;
      }
    }
  });
}
