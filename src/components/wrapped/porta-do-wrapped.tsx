import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { MEU_MES_LIBERADO } from "@/lib/meu-mes-liberado";
import { AnimatePresence } from "framer-motion";
import { useFluxo } from "@/lib/fluxo-store";

/*
 * A porta do "Wrapped do mês" (pedido do usuário, 19/10/2026): o resumo do
 * mês ANTERIOR, como o Spotify Wrapped.
 *
 * Quando abre sozinho: do dia 1º às 06:30 de Brasília até o fim do dia 7, na
 * primeira vez que a pessoa abre o app. Visto, grava `wrapped_visto` =
 * "AAAA-MM" em gestor.preferencias (e uma cópia local, para não piscar
 * esperando o banco) e não abre de novo sozinho — nem em outro computador.
 * 06:30 e não meia-noite: quem conclui tarefa de madrugada no último dia
 * ainda entra na conta, e o resumo chega junto com o começo do expediente.
 *
 * Também abre:
 *   - por `abrirWrapped()`, de qualquer lugar (como `abrirAgradecer`);
 *   - com `?wrapped=1` na URL, na hora, com o mês anterior — para testar fora
 *     da janela do dia 1º. Esse modo não grava o "já vi".
 *
 * Este arquivo é leve de propósito: fica montado no app inteiro. As telas
 * (framer-motion, os números) e o boneco (three.js) só baixam quando abre.
 */

const TelasDoWrapped = lazy(() => import("@/components/wrapped/wrapped-telas"));

const EVENTO_ABRIR = "fluxo:wrapped";
/** Brasília é UTC−3 o ano inteiro (sem horário de verão desde 2019). */
const BRASILIA_MS = 3 * 3600_000;
/** A partir de quando o Wrapped do mês sai: 06:30 do dia 1º. */
const LIBERA_MINUTOS = 6 * 60 + 30;
/** Até que dia do mês ele ainda abre sozinho. */
const ULTIMO_DIA_AUTOMATICO = 7;

const chaveLocal = (pessoaId: string) => `fluxo:wrapped:${pessoaId}`;

/** O mês anterior ao de agora, no calendário de Brasília ("AAAA-MM"). */
export function mesAnteriorEmBrasilia(agora = new Date()): string {
  const br = new Date(agora.getTime() - BRASILIA_MS);
  const d = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** O mês que deve abrir sozinho agora, ou null fora da janela (dia 1º 06:30 → dia 7). */
function mesDaJanelaAutomatica(agora = new Date()): string | null {
  const br = new Date(agora.getTime() - BRASILIA_MS);
  const dia = br.getUTCDate();
  if (dia > ULTIMO_DIA_AUTOMATICO) return null;
  if (dia === 1 && br.getUTCHours() * 60 + br.getUTCMinutes() < LIBERA_MINUTOS) return null;
  return mesAnteriorEmBrasilia(agora);
}

/** Abre o Wrapped de qualquer lugar do app (sem mês = o mês anterior). */
export function abrirWrapped(mes?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ mes?: string }>(EVENTO_ABRIR, { detail: { mes } }));
}

/** Montada uma vez, na raiz (GlobaisDoApp). */
export function PortaDoWrapped() {
  const { currentUser, isAuthenticated } = useFluxo();
  const [mes, setMes] = useState<string | null>(null);

  // Aberto à mão (botão, paleta…).
  useEffect(() => {
    const abrir = (e: Event) => {
      const pedido = (e as CustomEvent<{ mes?: string }>).detail?.mes;
      setMes(pedido && /^\d{4}-\d{2}$/.test(pedido) ? pedido : mesAnteriorEmBrasilia());
    };
    window.addEventListener(EVENTO_ABRIR, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR, abrir);
  }, []);

  // Sozinho: o parâmetro de teste, ou a janela do começo do mês.
  useEffect(() => {
    if (!isAuthenticated || !currentUser.id) return;
    let vivo = true;
    let timer: number | undefined;

    if (new URLSearchParams(window.location.search).get("wrapped") === "1") {
      timer = window.setTimeout(() => vivo && setMes(mesAnteriorEmBrasilia()), 600);
      return () => {
        vivo = false;
        window.clearTimeout(timer);
      };
    }

    // Antes do lançamento não abre sozinho (o `?wrapped=1` acima continua valendo).
    if (!MEU_MES_LIBERADO) return;
    const doMes = mesDaJanelaAutomatica();
    if (!doMes) return;
    try {
      if (localStorage.getItem(chaveLocal(currentUser.id)) === doMes) return;
    } catch {
      /* sem armazenamento local: o banco decide */
    }
    const pessoa = currentUser.id;
    import("@/lib/perfil.functions")
      .then((m) => m.minhasPreferencias())
      .then((p) => {
        if (!vivo) return;
        if (p.wrapped_visto === doMes) {
          guardarLocal(pessoa, doMes);
          return;
        }
        // Um respiro depois do login, para não brigar com a tela entrando.
        timer = window.setTimeout(() => {
          if (!vivo) return;
          setMes(doMes);
          marcarComoVisto(pessoa, doMes);
        }, 2000);
      })
      .catch((e: unknown) => console.warn("wrapped: não deu para ler as preferências", e));
    return () => {
      vivo = false;
      window.clearTimeout(timer);
    };
  }, [isAuthenticated, currentUser.id]);

  const fechar = useCallback(() => setMes(null), []);

  return (
    <Suspense fallback={null}>
      <AnimatePresence>
        {mes && <TelasDoWrapped key={mes} mes={mes} aoFechar={fechar} />}
      </AnimatePresence>
    </Suspense>
  );
}

function guardarLocal(pessoaId: string, mes: string) {
  try {
    localStorage.setItem(chaveLocal(pessoaId), mes);
  } catch {
    /* sem armazenamento local: o banco guarda */
  }
}

/* Marca na hora em que abre, e não ao fechar: quem recarrega a página no meio
   não ganha o Wrapped de novo sozinho (e ainda pode abrir à mão). */
function marcarComoVisto(pessoaId: string, mes: string) {
  guardarLocal(pessoaId, mes);
  void import("@/lib/perfil.functions")
    .then((m) => m.salvarPreferencia({ data: { chave: "wrapped_visto", valor: mes } }))
    .catch((e: unknown) => console.warn("wrapped: não deu para gravar o 'já vi'", e));
}
