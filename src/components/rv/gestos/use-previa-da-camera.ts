/*
 * use-previa-da-camera.ts — quando a prévia da câmera dos gestos aparece.
 *
 * Na PRIMEIRA vez que os gestos ligam (rv:gestos-primeira) a prévia abre sozinha por 5 s com a
 * dica de enquadramento — sem ombros e espaço acima da cabeça a mão levantada não é vista.
 * Depois só abre se a pessoa quiser, e a escolha é lembrada (rv:gestos-previa).
 * localStorage sempre em try/catch: modo privado ou armazenamento bloqueado não quebra a sala.
 */
import { useCallback, useEffect, useState } from "react";

const CHAVE_PRIMEIRA = "rv:gestos-primeira";
const CHAVE_PREVIA = "rv:gestos-previa";
const DICA_DA_PRIMEIRA = "Afaste-se até aparecerem os ombros e espaço acima da cabeça";
const PRIMEIRA_ABERTA_MS = 5_000;

function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}
function gravar(chave: string, valor: string): void {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    // Armazenamento bloqueado (modo privado): a preferência só não é lembrada.
  }
}

/** Abre/fecha a prévia com a regra da primeira vez e a preferência lembrada. */
export function usePreviaDaCamera(gestosLigados: boolean): {
  aberta: boolean;
  dica: string | undefined;
  abrir: () => void;
  fechar: () => void;
  alternar: () => void;
} {
  const [aberta, setAberta] = useState(false);
  const [dica, setDica] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!gestosLigados) {
      setAberta(false);
      setDica(undefined);
      return;
    }
    if (!ler(CHAVE_PRIMEIRA)) {
      gravar(CHAVE_PRIMEIRA, "1");
      setAberta(true);
      setDica(DICA_DA_PRIMEIRA);
      const id = setTimeout(() => {
        setDica(undefined);
        setAberta(ler(CHAVE_PREVIA) === "1");
      }, PRIMEIRA_ABERTA_MS);
      return () => clearTimeout(id);
    }
    setAberta(ler(CHAVE_PREVIA) === "1");
  }, [gestosLigados]);

  const abrir = useCallback(() => {
    gravar(CHAVE_PREVIA, "1");
    setAberta(true);
  }, []);
  const fechar = useCallback(() => {
    gravar(CHAVE_PREVIA, "0");
    setAberta(false);
    setDica(undefined);
  }, []);
  const alternar = useCallback(() => {
    setAberta((a) => {
      gravar(CHAVE_PREVIA, a ? "0" : "1");
      return !a;
    });
    setDica(undefined);
  }, []);
  return { aberta, dica, abrir, fechar, alternar };
}
