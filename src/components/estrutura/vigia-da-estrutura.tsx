import { useEffect } from "react";
import {
  carregarCobranca,
  carregarEquipes,
  estadoDaEstrutura,
  situacaoDeHoje,
  useEstrutura,
  type EstadoDaEstrutura,
} from "@/lib/estrutura-cliente";

/*
 * A vigia da estrutura do dia: montada uma vez em `GlobaisDoApp`, sobrevive à
 * navegação (o card do Início, o lembrete do Pack e o menu só LEEM a memória
 * de `estrutura-cliente.ts`; ninguém além desta vigia busca por conta própria).
 *
 * - Só liga para quem tem permissão e equipe: sem isso, não pergunta nada.
 * - Lê a cobrança a cada 5 minutos, e relê ao voltar para a aba (se já passou
 *   o intervalo). Com a janela escondida, não pergunta.
 * - PARA NO DIA quando todas as equipes estão resolvidas (enviado, folga ou
 *   não cobrado): não há o que cobrar até a virada, e a virada do dia deixa a
 *   leitura de hoje inválida, então ela recomeça sozinha.
 * - Nenhum intervalo existente do app muda: este é novo.
 */

const INTERVALO_MS = 5 * 60_000;

function resolvidoHoje(e: EstadoDaEstrutura): boolean {
  if (e.equipes.length === 0) return true;
  return e.equipes.every((q) => {
    const s = situacaoDeHoje(e, q.equipe);
    return s === "enviado" || s === "folga" || s === "naoCobrado";
  });
}

export function VigiaDaEstrutura() {
  const estado = useEstrutura();
  const ligada = estado.pronto && estado.aberta && estado.equipes.length > 0;

  // As equipes: uma vez ao montar (o servidor guarda 10 min, a aba guarda um dia).
  useEffect(() => {
    void carregarEquipes();
  }, []);

  // A cobrança.
  useEffect(() => {
    if (!ligada) return;
    let ultima = 0;
    const ler = (): void => {
      if (document.visibilityState === "hidden") return;
      // O estado de agora, não o da montagem: a vigia não se refaz a cada leitura.
      if (resolvidoHoje(estadoDaEstrutura())) return;
      ultima = Date.now();
      void carregarCobranca();
    };
    ler();
    const timer = window.setInterval(ler, INTERVALO_MS);
    const aoVoltar = (): void => {
      if (document.visibilityState === "visible" && Date.now() - ultima >= INTERVALO_MS) ler();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [ligada]);

  return null;
}
