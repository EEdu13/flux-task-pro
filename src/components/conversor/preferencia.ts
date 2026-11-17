import { useEffect, useState } from "react";

/*
 * "Abrir o conversor segurando Ctrl" (04/11/2026) — ligada por padrão.
 *
 * Fica em `gestor.preferencias` (chave "conversor_ctrl", "1" ou "0") para valer
 * em qualquer computador, e numa cópia local para o atalho já nascer certo, sem
 * esperar o servidor responder. Quem troca em Configurações avisa a paleta já
 * montada por um evento, sem recarregar a página.
 *
 * Só o atalho do Ctrl depende disto: o raio, a barra lateral, o Ctrl+K e o
 * arrastar continuam abrindo o conversor com a preferência desligada.
 */

const CHAVE_REMOTA = "conversor_ctrl";
const chaveLocal = (pessoaId: string) => `fluxo:conversor-ctrl:${pessoaId}`;
const EVENTO_MUDOU = "fluxo:conversor-ctrl-mudou";

/** Sobe a cada troca do interruptor; a leitura que começou antes de uma troca é descartada. */
let versaoDeEscrita = 0;

/* localStorage pode não existir (servidor) ou recusar (modo privado, cota):
   na dúvida, vale o que vier do banco — ou o padrão, ligado. */
function lerLocal(pessoaId: string): boolean | null {
  try {
    const v = window.localStorage.getItem(chaveLocal(pessoaId));
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

function gravarLocal(pessoaId: string, ligado: boolean): void {
  try {
    window.localStorage.setItem(chaveLocal(pessoaId), ligado ? "1" : "0");
  } catch {
    /* a cópia local é conveniência; o banco continua valendo */
  }
}

/**
 * A preferência de quem está logado: começa pela cópia local, o banco confirma
 * logo depois, e uma troca feita em Configurações chega na hora pelo evento.
 */
export function usePreferenciaDoConversor(pessoaId: string): boolean {
  const [ligado, setLigado] = useState(true);

  useEffect(() => {
    if (!pessoaId) return;
    const local = lerLocal(pessoaId);
    if (local !== null) setLigado(local);

    let vivo = true;
    const versaoNoInicio = versaoDeEscrita;
    import("@/lib/perfil.functions")
      .then((m) => m.minhasPreferencias())
      .then((p) => {
        /* A pessoa pode ter trocado o interruptor enquanto a leitura voltava:
           a resposta é do banco como estava ANTES, e desfaria a troca na tela. */
        if (!vivo || versaoDeEscrita !== versaoNoInicio) return;
        const v = p[CHAVE_REMOTA];
        if (v === "1" || v === "0") {
          setLigado(v === "1");
          gravarLocal(pessoaId, v === "1");
        }
      })
      .catch(() => {
        /* sem resposta do banco: fica a cópia local, ou o padrão */
      });

    const aoMudar = (e: Event) => {
      const detalhe = (e as CustomEvent<{ pessoaId: string; ligado: boolean }>).detail;
      if (detalhe?.pessoaId === pessoaId) setLigado(detalhe.ligado);
    };
    window.addEventListener(EVENTO_MUDOU, aoMudar);
    return () => {
      vivo = false;
      window.removeEventListener(EVENTO_MUDOU, aoMudar);
    };
  }, [pessoaId]);

  return ligado;
}

/**
 * Grava a escolha (o interruptor em Configurações). A paleta montada passa a
 * obedecer na hora; se o banco recusar, lança — quem chamou desfaz o
 * interruptor e avisa, e a cópia local volta ao valor anterior.
 */
export async function salvarPreferenciaDoConversor(
  pessoaId: string,
  ligado: boolean,
): Promise<void> {
  versaoDeEscrita += 1;
  const antes = lerLocal(pessoaId);
  const avisar = (valor: boolean) =>
    window.dispatchEvent(new CustomEvent(EVENTO_MUDOU, { detail: { pessoaId, ligado: valor } }));
  gravarLocal(pessoaId, ligado);
  avisar(ligado);
  try {
    const { salvarPreferencia } = await import("@/lib/perfil.functions");
    await salvarPreferencia({ data: { chave: CHAVE_REMOTA, valor: ligado ? "1" : "0" } });
  } catch (e) {
    const volta = antes ?? !ligado;
    gravarLocal(pessoaId, volta);
    avisar(volta);
    throw e;
  }
}
