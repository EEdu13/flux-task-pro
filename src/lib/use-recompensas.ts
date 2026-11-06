import { useEffect, useState } from "react";

/* Recompensas: a tela só pergunta UMA vez por sessão se quem está logado é o
   dono do teste (ver `recompensas.functions.ts`). A resposta fica aqui na
   memória — nada no localStorage, para não deixar rastro no computador de
   ninguém. A fechadura de verdade é o servidor: esta pergunta só decide se a
   aba e o botão aparecem. */

let resposta: Promise<boolean> | null = null;

export function perguntarSeSouDono(): Promise<boolean> {
  if (!resposta) {
    resposta = import("@/lib/recompensas.functions")
      .then(({ souDonoDasRecompensas }) => souDonoDasRecompensas())
      .then((r) => !!r?.ok)
      .catch(() => {
        resposta = null; // tenta de novo na próxima vez
        return false;
      });
  }
  return resposta;
}

export function useSouDonoDasRecompensas(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let vivo = true;
    void perguntarSeSouDono().then((v) => vivo && setOk(v));
    return () => {
      vivo = false;
    };
  }, []);
  return ok;
}

export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
