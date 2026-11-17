import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { confirmar } from "@/components/confirm-dialog";
import { seguirApesarDaAssinatura } from "./avisos";
import { useFluxo } from "@/lib/fluxo-store";
import { EVENTO_ABRIR_CONVERSOR, abrirConversor } from "./abrir";
import { ambienteDoConversor } from "./ambiente";
import {
  aceitaArquivo,
  aceitaNoArraste,
  acceptDoSeletor,
  blocosDaPaleta,
  LIMITE_LOCAL_BYTES,
  oQueAceita,
  porQueNaoServe,
} from "./blocos";
import { entregar } from "./entregar";
import { escolherArquivos } from "./escolher-arquivos";
import { ehFalhaDeCarregamento, MENSAGEM_DE_ATUALIZACAO } from "./falha-de-carregamento";
import { FaixaDeArraste } from "./faixa-de-arraste";
import { PaletaDeConversao } from "./paleta-de-conversao";
import { usePreferenciaDoConversor } from "./preferencia";
import {
  ErroDeConversao,
  type Bloco,
  type IdDoBloco,
  type OpcoesDoBloco,
  type Realce,
  type TelaDaPaleta,
  type Trabalho,
} from "./tipos";
import { useArrasteDeArquivo } from "./use-arraste-de-arquivo";
import { useCtrlSegurado } from "./use-ctrl-segurado";

type Trabalhos = Partial<Record<IdDoBloco, Trabalho>>;

/** Fechar a paleta limpa os erros, mas o que está convertendo segue até o fim. */
function soOsQueRodam(t: Trabalhos): Trabalhos {
  return Object.fromEntries(
    Object.entries(t).filter(([, v]) => v?.estado === "rodando"),
  ) as Trabalhos;
}

/**
 * O conversor de arquivos (Parte B, fase 1a — 04/11/2026). Montado UMA vez,
 * em `globais-do-app.tsx`; daqui saem a faixa do arrastar e a paleta.
 *
 * Abre de cinco jeitos: segurando o Ctrl (se a preferência estiver ligada),
 * pelo raio das ações rápidas, pela barra lateral, pelo Ctrl+K — os três pelo
 * evento de `abrir.ts` — e arrastando um arquivo do Windows para a janela: um
 * círculo aparece no meio da tela, e passar o arquivo por ele abre a roda.
 *
 * A conversão não depende da paleta aberta: fechar no meio não cancela, e o
 * resultado chega no aviso. Erro com a paleta aberta aparece no bloco; com ela
 * fechada, num aviso.
 */
export function Conversor() {
  const { currentUser } = useFluxo();
  const ctrlLigado = usePreferenciaDoConversor(currentUser.id);
  const blocos = useMemo(() => blocosDaPaleta(), []);
  const [aberto, setAberto] = useState(false);
  const [tela, setTela] = useState<TelaDaPaleta>({ tipo: "blocos" });
  const [pendentes, setPendentes] = useState<File[]>([]);
  const [trabalhos, setTrabalhos] = useState<Trabalhos>({});
  const arraste = useArrasteDeArquivo(true);

  /* Lidos quando uma conversão termina — o que já aconteceu depois do desenho
     que a começou. */
  const abertoRef = useRef(aberto);
  const trabalhosRef = useRef(trabalhos);
  const telaRef = useRef(tela);
  const pendentesRef = useRef(pendentes);
  useEffect(() => {
    abertoRef.current = aberto;
  }, [aberto]);
  useEffect(() => {
    trabalhosRef.current = trabalhos;
  }, [trabalhos]);
  useEffect(() => {
    telaRef.current = tela;
  }, [tela]);
  useEffect(() => {
    pendentesRef.current = pendentes;
  }, [pendentes]);
  /* A "sessão" da paleta: sobe a cada vez que ela abre. Uma conversão só fecha
     a paleta se for a mesma que a viu começar — senão, quem abriu a paleta
     DEPOIS de uma conversão iniciada pela faixa perderia o que estava fazendo
     (a lista que ordenava, as páginas que marcou) quando ela terminasse. */
  const sessao = useRef(0);
  useEffect(() => {
    if (aberto) sessao.current += 1;
  }, [aberto]);
  const controles = useRef(new Map<IdDoBloco, AbortController>());
  /** Já terminaram de calcular e estão sendo entregues (zip, gravação): cancelar não adianta mais. */
  const entregando = useRef(new Set<IdDoBloco>());

  const abrir = useCallback(() => {
    // Com o Editor de PDF aberto, voltar à roda jogaria fora o que está sendo editado.
    if (document.querySelector("[data-editor-pdf]")) return;
    setTela({ tipo: "blocos" });
    setAberto(true);
  }, []);

  const fechar = useCallback(() => {
    setAberto(false);
    setTela({ tipo: "blocos" });
    setPendentes([]);
    setTrabalhos(soOsQueRodam);
  }, []);

  /* ---- Não perder o que a pessoa já escolheu (12/11/2026) ----
     Na tela intermediária, a ordem dos arquivos, as páginas marcadas e os giros dão trabalho:
     fechar (Esc, clicar fora, o X) ou voltar à roda pergunta antes de jogar isso fora. */
  const etapaSuja = useRef(false);
  useEffect(() => {
    if (tela.tipo !== "etapa") etapaSuja.current = false;
  }, [tela]);
  const aoSujarEtapa = useCallback((sujo: boolean) => {
    etapaSuja.current = sujo;
  }, []);
  const podeDescartarEtapa = useCallback(async () => {
    if (telaRef.current.tipo !== "etapa" || !etapaSuja.current) return true;
    return confirmar({
      titulo: "Descartar o que você escolheu?",
      descricao:
        "A ordem dos arquivos, as páginas marcadas e os giros desta tela se perdem, e nada é convertido.",
      confirmar: "Descartar",
      cancelar: "Continuar aqui",
      perigo: true,
    });
  }, []);
  const fecharComCuidado = useCallback(async () => {
    if (await podeDescartarEtapa()) fechar();
  }, [podeDescartarEtapa, fechar]);
  const voltarComCuidado = useCallback(async () => {
    if (await podeDescartarEtapa()) setTela({ tipo: "blocos" });
  }, [podeDescartarEtapa]);

  /* Com uma conversão rodando, fechar a aba (ou F5) perderia o resultado: o navegador pergunta. */
  const rodando = Object.values(trabalhos).some((t) => t?.estado === "rodando");
  useEffect(() => {
    if (!rodando) return;
    const perguntar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", perguntar);
    return () => window.removeEventListener("beforeunload", perguntar);
  }, [rodando]);

  useEffect(() => {
    window.addEventListener(EVENTO_ABRIR_CONVERSOR, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_CONVERSOR, abrir);
  }, [abrir]);

  useCtrlSegurado(abrir, ctrlLigado && !aberto);

  const mudarTrabalho = (id: IdDoBloco, novo: Trabalho | undefined) =>
    setTrabalhos((t) => {
      const n = { ...t };
      if (novo) n[id] = novo;
      else delete n[id];
      return n;
    });

  const falhar = (bloco: Bloco, mensagem: string) => {
    /* No bloco só quando dá para ver: a roda na tela. Numa etapa (ordenar,
       páginas…) ou com a paleta fechada, o erro iria para um bloco que a pessoa
       não está vendo — e fechar a paleta o apagaria sem ela ter lido. */
    if (abertoRef.current && telaRef.current.tipo === "blocos") {
      mudarTrabalho(bloco.id, { estado: "erro", progresso: 0, erro: mensagem });
      return;
    }
    toast.error(bloco.rotulo, {
      description: mensagem,
      action: { label: "Abrir o conversor", onClick: abrirConversor },
    });
  };

  const executar = async (bloco: Bloco, arquivos: File[], opcoes: OpcoesDoBloco) => {
    const controle = new AbortController();
    controles.current.set(bloco.id, controle);
    /* Esta execução ainda é a do bloco? Cancelar e começar de novo no mesmo
       bloco deixa a antiga rodando até o próximo ponto de parada, e ela não
       pode mexer no andamento, no erro nem na entrega da nova. */
    const aindaEhMinha = () => controles.current.get(bloco.id) === controle;
    // A paleta que viu esta conversão começar; -1 = ela começou com a paleta fechada.
    const sessaoDoInicio = abertoRef.current ? sessao.current : -1;
    mudarTrabalho(bloco.id, { estado: "rodando", progresso: 0 });
    setTela({ tipo: "blocos" });
    try {
      const resultado = await bloco.executar(arquivos, opcoes, {
        sinal: controle.signal,
        progresso: (fracao) => {
          if (!aindaEhMinha()) return;
          setTrabalhos((t) => {
            const atual = t[bloco.id];
            if (atual?.estado !== "rodando") return t;
            const p = Math.min(1, Math.max(atual.progresso, fracao));
            return p === atual.progresso ? t : { ...t, [bloco.id]: { ...atual, progresso: p } };
          });
        },
      });
      if (controle.signal.aborted || !aindaEhMinha()) return;
      entregando.current.add(bloco.id);
      try {
        await entregar(resultado);
      } finally {
        entregando.current.delete(bloco.id);
      }
      mudarTrabalho(bloco.id, undefined);
      /* "Fecha ao terminar a conversão" (especificação) — se nada mais estiver
         rodando e a pessoa não estiver no meio de outra coisa nesta paleta. */
      const outros = Object.entries(trabalhosRef.current).some(
        ([id, t]) => id !== bloco.id && t?.estado === "rodando",
      );
      const livre = telaRef.current.tipo === "blocos" && pendentesRef.current.length === 0;
      if (abertoRef.current && sessao.current === sessaoDoInicio && livre && !outros) fechar();
    } catch (e) {
      // A execução cancelada (e talvez já substituída por outra) não mexe no estado.
      if (!aindaEhMinha()) return;
      mudarTrabalho(bloco.id, undefined);
      if (controle.signal.aborted) return;
      console.warn("[conversor]", bloco.id, e);
      falhar(
        bloco,
        e instanceof ErroDeConversao
          ? e.message
          : ehFalhaDeCarregamento(e)
            ? MENSAGEM_DE_ATUALIZACAO
            : "Não foi possível converter este arquivo. Tente de novo.",
      );
    } finally {
      if (aindaEhMinha()) controles.current.delete(bloco.id);
    }
  };

  const cancelar = (bloco: Bloco) => {
    if (entregando.current.has(bloco.id)) {
      toast.info("Já está terminando — o arquivo chega em instantes.");
      return;
    }
    controles.current.get(bloco.id)?.abort();
    controles.current.delete(bloco.id); // a execução cancelada deixa de ser "a do bloco"
    mudarTrabalho(bloco.id, undefined);
    toast("Conversão cancelada.");
  };

  /** Arquivos chegando a um bloco: confere tudo antes de converter (ou de abrir a etapa). */
  const receber = async (bloco: Bloco, arquivos: File[]) => {
    if (arquivos.length === 0) return;
    if (trabalhosRef.current[bloco.id]?.estado === "rodando") {
      toast.info(`“${bloco.rotulo}” ainda está convertendo. Espere terminar.`);
      return;
    }
    // A roda já não deixa soltar nem clicar num bloco que não serve aqui; isto é a rede de segurança.
    const motivo = porQueNaoServe(bloco, ambienteDoConversor());
    if (motivo) {
      falhar(bloco, motivo.frase);
      return;
    }
    const aceitos = arquivos.filter((a) => aceitaArquivo(bloco, a));
    if (aceitos.length === 0) {
      falhar(bloco, `Este bloco aceita: ${oQueAceita(bloco)}.`);
      return;
    }
    const fora = arquivos.length - aceitos.length;
    if (fora > 0) {
      toast.warning(
        `${fora === 1 ? "Um arquivo ficou" : `${fora} arquivos ficaram`} de fora: “${bloco.rotulo}” aceita ${oQueAceita(bloco)}.`,
      );
    }
    if (!bloco.varios && aceitos.length > 1) {
      falhar(bloco, "Este bloco converte um arquivo por vez.");
      return;
    }
    if (bloco.maximo && aceitos.length > bloco.maximo) {
      falhar(bloco, `No máximo ${bloco.maximo} arquivos de uma vez.`);
      return;
    }
    const grande = aceitos.find((a) => a.size > LIMITE_LOCAL_BYTES);
    if (grande) {
      falhar(bloco, `“${grande.name}” passa de 200 MB, o limite da conversão no computador.`);
      return;
    }
    /* PDF com assinatura digital (12/11/2026): o PDF novo sai sem ela valer. A pessoa decide
       antes — o original continua assinado e intacto. */
    if (!(await seguirApesarDaAssinatura(bloco, aceitos))) return;
    mudarTrabalho(bloco.id, undefined); // tira o erro da tentativa anterior
    setPendentes([]);
    if (bloco.etapa !== "nenhuma") {
      setTela({ tipo: "etapa", blocoId: bloco.id, arquivos: aceitos });
      setAberto(true);
      return;
    }
    void executar(bloco, aceitos, {});
  };

  /** Clique no bloco: usa o que foi solto na faixa, ou abre as pastas. */
  const escolher = (bloco: Bloco) => {
    if (pendentes.length > 0) {
      void receber(bloco, pendentes);
      return;
    }
    void escolherArquivos(acceptDoSeletor(bloco), !!bloco.varios).then((arquivos) =>
      receber(bloco, arquivos),
    );
  };

  const realceDe = (bloco: Bloco): Realce => {
    // O bloco que não serve aqui nunca acende para o arquivo: apaga, como o que não aceita o tipo.
    if ((arraste.ativo || pendentes.length > 0) && porQueNaoServe(bloco, ambienteDoConversor())) {
      return "nao";
    }
    if (arraste.ativo) return aceitaNoArraste(bloco, arraste.tipos);
    if (pendentes.length > 0) {
      const servem =
        pendentes.every((f) => aceitaArquivo(bloco, f)) &&
        (bloco.varios || pendentes.length === 1) &&
        (!bloco.maximo || pendentes.length <= bloco.maximo);
      return servem ? "sim" : "nao";
    }
    return null;
  };

  /** Arquivo solto fora dos blocos (na faixa ou no vazio da paleta): fica esperando a pessoa escolher o bloco. */
  const guardarPendentes = (arquivos: File[]) => {
    if (arquivos.length === 0) return;
    setPendentes(arquivos);
    setTela({ tipo: "blocos" });
    setAberto(true);
  };

  return (
    <>
      {/* O círculo do arrastar (09/11/2026): com o arquivo por cima, abre a roda, e o arquivo
          segue na mão para ser solto num bloco — os blocos acendem pelo tipo dele. */}
      <FaixaDeArraste
        visivel={arraste.ativo && !aberto}
        sobreArea={arraste.sobreArea}
        aoAbrirRoda={abrir}
        aoSoltarNaFaixa={guardarPendentes}
      />
      <PaletaDeConversao
        aberto={aberto}
        aoFechar={() => void fecharComCuidado()}
        aoSujarEtapa={aoSujarEtapa}
        tela={tela}
        blocos={blocos}
        realceDe={realceDe}
        trabalhos={trabalhos}
        pendentes={pendentes}
        aoEscolher={escolher}
        aoSoltar={receber}
        aoCancelar={cancelar}
        aoDescartarPendentes={() => setPendentes([])}
        aoReceberArquivos={guardarPendentes}
        aoTrocarArquivos={(arquivos) => {
          // Mexeu na lista (ordem, mais um, menos um): agora há o que perder ao fechar.
          etapaSuja.current = arquivos.length > 0;
          setTela((t) =>
            t.tipo !== "etapa"
              ? t
              : arquivos.length === 0
                ? { tipo: "blocos" }
                : { ...t, arquivos },
          );
        }}
        aoVoltar={() => void voltarComCuidado()}
        aoConverter={(bloco, arquivos, opcoes) => void executar(bloco, arquivos, opcoes)}
      />
    </>
  );
}
