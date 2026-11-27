import { useEffect, useState } from "react";
import type { RecenteDoMural } from "@/lib/mural.functions";

/*
 * Quantos posts novos o Mural tem para mim — o número no item "Mural" do menu
 * lateral (27/11/2026). Pedido do usuário: "um indicador de atividade no Mural
 * para indicar novas postagens para motivar o pessoal a visualizar ele".
 *
 * Novo = post de OUTRA pessoa (ou automático) publicado depois do meu "visto
 * até". Abrir a página do Mural marca tudo o que existe como visto.
 *
 *   - os posts recentes vêm de `recentesDoMural`, a mesma lista para todos,
 *     guardada 1 min no servidor; a tela pergunta a cada 2 min e ao voltar
 *     para a janela;
 *   - o "visto até" fica neste computador (localStorage, por pessoa) e no
 *     banco (preferência `mural_visto`), lido uma vez por sessão: quem viu no
 *     notebook não vê o número de novo no computador do escritório. Vale o
 *     mais novo dos dois;
 *   - quem nunca abriu o Mural (sem "visto" em lugar nenhum) vê os posts dos
 *     últimos 3 dias como novos — um convite, sem jogar duas semanas de uma vez.
 *
 * O menu é montado de novo a cada troca de página, por isso a lista e o
 * "visto" do banco ficam guardados aqui fora, no módulo.
 */

const INTERVALO_MS = 2 * 60_000;
const SEM_REGISTRO_MS = 3 * 86_400_000;
const EVENTO = "fluxo:mural-visto";
const chaveLocal = (eu: string) => `fluxo:mural-visto:${eu}`;

const isoValido = (v: unknown): string | null =>
  typeof v === "string" && v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;
/** O mais novo de dois ISO (UTC, mesmo formato: a comparação de texto vale). */
const maisNovo = (a: string | null, b: string | null): string | null =>
  !a ? b : !b ? a : a > b ? a : b;

let guardados: { valor: RecenteDoMural[]; em: number } | null = null;
let buscando: Promise<RecenteDoMural[]> | null = null;

function buscarRecentes(forcar: boolean): Promise<RecenteDoMural[]> {
  if (!forcar && guardados && Date.now() - guardados.em < INTERVALO_MS) {
    return Promise.resolve(guardados.valor);
  }
  if (buscando) return buscando;
  buscando = import("@/lib/mural.functions")
    .then((m) => m.recentesDoMural())
    .then((r) => {
      guardados = { valor: r.recentes, em: Date.now() };
      return r.recentes;
    })
    .finally(() => {
      buscando = null;
    });
  return buscando;
}

/** O "visto até" do banco, uma leitura por pessoa por sessão. */
const vistoNoBanco = new Map<string, Promise<string | null>>();
function lerVistoDoBanco(eu: string): Promise<string | null> {
  let p = vistoNoBanco.get(eu);
  if (!p) {
    p = import("@/lib/perfil.functions")
      .then((m) => m.minhasPreferencias())
      .then((pref) => isoValido(pref.mural_visto))
      .catch(() => null);
    vistoNoBanco.set(eu, p);
  }
  return p;
}

function lerLocal(eu: string): string | null {
  try {
    return isoValido(localStorage.getItem(chaveLocal(eu)));
  } catch {
    return null;
  }
}

/** Marca como visto até `quando`: neste computador, no banco e nas outras abas. */
function marcarVisto(eu: string, quando: string) {
  try {
    localStorage.setItem(chaveLocal(eu), quando);
  } catch {
    /* sem armazenamento: fica o do banco */
  }
  vistoNoBanco.set(eu, Promise.resolve(quando));
  window.dispatchEvent(new Event(EVENTO));
  void import("@/lib/perfil.functions")
    .then((m) => m.salvarPreferencia({ data: { chave: "mural_visto", valor: quando } }))
    .catch(() => {
      /* fica o local; a próxima visita ao Mural tenta de novo */
    });
}

/**
 * @param eu      quem está logado ("" enquanto não há ninguém: devolve 0)
 * @param noMural se a página aberta é o Mural (aí tudo vira visto)
 * @returns quantos posts novos há para mostrar no menu
 */
export function useNovidadesDoMural(eu: string, noMural: boolean): number {
  const [recentes, setRecentes] = useState<RecenteDoMural[]>(() => guardados?.valor ?? []);
  const [visto, setVisto] = useState<string | null>(null);
  /** Já se sabe o "visto" do banco (antes disso, nada de número). */
  const [sabeOVisto, setSabeOVisto] = useState(false);

  // O "visto até": daqui e do banco; e as mudanças de outras abas.
  useEffect(() => {
    if (!eu) return;
    let vivo = true;
    setVisto(lerLocal(eu));
    setSabeOVisto(false);
    void lerVistoDoBanco(eu).then((v) => {
      if (!vivo) return;
      setVisto((atual) => maisNovo(atual, v));
      setSabeOVisto(true);
    });
    const aoMudar = () => setVisto((atual) => maisNovo(atual, lerLocal(eu)));
    window.addEventListener(EVENTO, aoMudar);
    window.addEventListener("storage", aoMudar);
    return () => {
      vivo = false;
      window.removeEventListener(EVENTO, aoMudar);
      window.removeEventListener("storage", aoMudar);
    };
  }, [eu]);

  // Os posts recentes: ao montar (se o guardado venceu), a cada 2 min e ao
  // voltar para a janela.
  useEffect(() => {
    if (!eu) return;
    let vivo = true;
    const buscar = (forcar: boolean) =>
      void buscarRecentes(forcar)
        .then((r) => {
          if (vivo) setRecentes(r);
        })
        .catch(() => {
          /* sem rede ou mural fora do ar: fica o último número */
        });
    buscar(false);
    const relogio = window.setInterval(() => buscar(true), INTERVALO_MS);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") buscar(false);
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      vivo = false;
      window.clearInterval(relogio);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [eu]);

  // Na página do Mural, o que existe até agora vira visto. Só grava quando há
  // algo depois do "visto" atual: ficar parado no Mural não escreve no banco.
  const ultimo = recentes[0]?.em ?? null;
  useEffect(() => {
    if (!eu || !noMural || !sabeOVisto) return;
    if (visto && (!ultimo || visto >= ultimo)) return;
    const quando = maisNovo(new Date().toISOString(), ultimo)!;
    setVisto(quando);
    marcarVisto(eu, quando);
  }, [eu, noMural, sabeOVisto, visto, ultimo]);

  if (!eu || !sabeOVisto || noMural) return 0;
  const desde = visto ?? new Date(Date.now() - SEM_REGISTRO_MS).toISOString();
  return recentes.filter((r) => r.autorId !== eu && r.em > desde).length;
}
