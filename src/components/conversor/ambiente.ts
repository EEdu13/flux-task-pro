import { useSyncExternalStore } from "react";
import { isTauri } from "@/lib/attachments";

/*
 * Onde o conversor está rodando (11/11/2026). Os blocos do Office (`soNoApp`) usam o
 * Word, o Excel e o PowerPoint instalados, por um comando do app de mesa que só existe
 * a partir de `PRIMEIRA_VERSAO_COM_OFFICE`. O mesmo site atende o navegador e todas as
 * versões do app, então a roda precisa saber qual é a desta aba:
 *
 * - "navegador": sem o app — os blocos do Office ficam apagados ("Só no app de mesa");
 * - "app-antigo": o app de mesa de antes do comando ("Atualize o app de mesa");
 * - "app": o app de mesa com o comando.
 *
 * A versão chega depois (o `getVersion` é assíncrono). Até lá o app conta como antigo, e
 * o bloco do Office acende quando a resposta vem.
 */

export const PRIMEIRA_VERSAO_COM_OFFICE = "0.2.3";

export type AmbienteDoConversor = "navegador" | "app-antigo" | "app";

/** "0.2.10" é pelo menos "0.2.3"? Número a número, como no aviso de app novo. */
export function versaoPeloMenos(versao: string, minima: string): boolean {
  const a = versao.split(".").map(Number);
  const b = minima.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

let ambiente: AmbienteDoConversor | null = null;
const ouvintes = new Set<() => void>();

/** Descobre uma vez por aba; as próximas chamadas devolvem o que já se sabe. */
function descobrir(): AmbienteDoConversor {
  if (ambiente) return ambiente;
  if (typeof window === "undefined" || !isTauri()) {
    ambiente = "navegador";
    return ambiente;
  }
  ambiente = "app-antigo";
  void import("@tauri-apps/api/app")
    .then(({ getVersion }) => getVersion())
    .then((versao) => {
      if (!versaoPeloMenos(versao, PRIMEIRA_VERSAO_COM_OFFICE)) return;
      ambiente = "app";
      ouvintes.forEach((f) => f());
    })
    .catch(() => {
      /* sem resposta da versão: segue como app antigo */
    });
  return ambiente;
}

/** O ambiente agora, fora do React (o `receber` do conversor confere de novo). */
export function ambienteDoConversor(): AmbienteDoConversor {
  return descobrir();
}

export function useAmbienteDoConversor(): AmbienteDoConversor {
  return useSyncExternalStore(
    (f) => {
      ouvintes.add(f);
      return () => void ouvintes.delete(f);
    },
    descobrir,
    () => "navegador",
  );
}
