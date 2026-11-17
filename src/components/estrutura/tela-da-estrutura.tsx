import { useEffect, useRef, useState } from "react";
import { Navigate } from "@tanstack/react-router";
import { ClipboardList, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { confirmar } from "@/components/confirm-dialog";
import { FluxoLayout } from "@/components/fluxo-layout";
import { AdicionarNaEquipe, type TipoDeAdicao } from "@/components/estrutura/adicionar-na-equipe";
import { BarraDaSemana } from "@/components/estrutura/barra-da-semana";
import { BarraDeAcoes } from "@/components/estrutura/barra-de-acoes";
import { CartaoDeErro, Esqueleto, SeletorDeEquipe } from "@/components/estrutura/blocos-da-tela";
import { ListaDePessoas, ListaDeVeiculos } from "@/components/estrutura/listas";
import {
  aSeremRetirados,
  idDoLogado,
  marcarPessoa,
  marcarVeiculo,
  marcasDaEstrutura,
  paraEnvio,
  podarMarcas,
  quantosFaltam,
  repetirDe,
  SEM_MARCAS,
  todosAdm,
  type Marcas,
} from "@/components/estrutura/marcas";
import {
  mensagemDaFalha,
  listaDeNomes,
  popupDaMadrugada,
  popupDaRetirada,
  popupDoReenvio,
} from "@/components/estrutura/mensagens";
import { avisarEnvio, carregarEquipes, motivoDaFalha, useEstrutura } from "@/lib/estrutura-cliente";
import { ADICIONAR_NA_EQUIPE_LIGADO, ENVIO_REAL_LIGADO } from "@/lib/estrutura-liberada";
import {
  dataPorExtenso,
  diaDaSemana,
  diaValido,
  ehMadrugada,
  hojeEmBrasilia,
  segundaDaSemana,
  somarDias,
} from "@/lib/estrutura-datas";
import type {
  DiaDaSemana,
  EstruturaDoDia,
  FalhaDaEstrutura,
  PessoaDaEquipe,
  VeiculoDaEquipe,
} from "@/lib/estrutura-tipos";
import { useFluxo } from "@/lib/fluxo-store";

/*
 * A tela da estrutura do dia (Parte A, spec de 04/11/2026).
 *
 * A equipe e o dia moram na URL (`?equipe=&dia=`): a tela só os LÊ, e quem
 * escolhe outro chama `aoMudarBusca`. O resto é o que o servidor devolve; as
 * marcas em edição moram aqui, e um rascunho delas fica guardado por equipe e
 * dia enquanto o app está aberto (trocar de dia ou de tela não perde o que
 * foi marcado). Dia já enviado abre em LEITURA; "Reenviar / corrigir" volta
 * para a edição com as marcas do dia.
 */

/** Rascunhos das marcas por equipe e dia, só na memória da aba. */
const RASCUNHOS = new Map<string, Marcas>();
const chaveDoRascunho = (equipe: string, dia: string) => `${equipe}|${dia}`;

/** O dia aberto: o pedido na URL, se valer; senão hoje (fim de semana abre na sexta). */
function diaAberto(pedido: string | undefined, hoje: string): string {
  if (pedido && diaValido(pedido) && pedido <= hoje) return pedido;
  const d = diaDaSemana(hoje);
  return d === 6 ? somarDias(hoje, -1) : d === 0 ? somarDias(hoje, -2) : hoje;
}

interface Lista {
  pessoas: PessoaDaEquipe[];
  veiculos: VeiculoDaEquipe[];
}

export function TelaDaEstrutura({
  equipePedida,
  diaPedido,
  aoMudarBusca,
}: {
  equipePedida?: string;
  diaPedido?: string;
  aoMudarBusca: (busca: { equipe: string; dia: string }) => void;
}) {
  const est = useEstrutura();
  const { currentUser } = useFluxo();
  const hoje = hojeEmBrasilia();
  // A equipe pedida (o card do Início manda a dele); sem pedido, a da própria pessoa.
  const equipe =
    est.equipes.find((e) => e.equipe === equipePedida)?.equipe ??
    est.equipes.find((e) => e.equipe === est.inicial)?.equipe ??
    est.equipes[0]?.equipe ??
    "";
  const dia = diaAberto(diaPedido, hoje);
  const segunda = segundaDaSemana(dia);

  const [lista, setLista] = useState<Lista | null>(null);
  const [semana, setSemana] = useState<DiaDaSemana[] | null>(null);
  const [doDia, setDoDia] = useState<EstruturaDoDia | null>(null);
  const [marcas, setMarcas] = useState<Marcas>(SEM_MARCAS);
  /** Para quem (equipe e dia) `marcas` vale: sem isso, trocar de dia gravaria as marcas do dia antigo no rascunho do novo. */
  const [chaveDasMarcas, setChaveDasMarcas] = useState("");
  const [antes, setAntes] = useState<Marcas | null>(null);
  const [estavaP, setEstavaP] = useState<Record<number, string>>({});
  const [estavaV, setEstavaV] = useState<Record<string, string>>({});
  const [editando, setEditando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [repetindo, setRepetindo] = useState(false);
  const [recarga, setRecarga] = useState(0);
  /** Qual janela de "Adicionar à equipe" está aberta: pessoas, veículos ou nenhuma. */
  const [adicionando, setAdicionando] = useState<TipoDeAdicao | null>(null);
  /** As marcas de agora: quem espera a rede (o "Repetir último dia") não pode usar as de antes da espera. */
  const marcasRef = useRef(marcas);
  useEffect(() => {
    marcasRef.current = marcas;
  }, [marcas]);

  // As equipes: ao abrir a tela, pede o que há de mais novo (o menu vive do que a aba já tinha).
  useEffect(() => {
    void carregarEquipes(true);
  }, []);

  // A lista da equipe e o que foi enviado neste dia.
  useEffect(() => {
    if (!equipe) return;
    let vivo = true;
    setErro(null);
    setLista(null);
    setDoDia(null);
    void (async () => {
      try {
        const { pessoasEFrotaDaEquipe, estruturaDoDia } = await import("@/lib/estrutura.functions");
        const [l, d] = await Promise.all([
          pessoasEFrotaDaEquipe({ data: { equipe } }),
          estruturaDoDia({ data: { equipe, dia } }),
        ]);
        if (!vivo) return;
        setLista({ pessoas: l.pessoas, veiculos: l.veiculos });
        setDoDia(d);
        setAntes(null);
        if (d.enviada) {
          // Dia enviado: leitura, com o que foi guardado.
          const r = marcasDaEstrutura(d, l.pessoas, l.veiculos);
          setMarcas(r.marcas);
          setEstavaP(r.estavaP);
          setEstavaV(r.estavaV);
          setEditando(false);
        } else {
          // Dia aberto: o rascunho, ou quem está logado começando como ADM.
          const rascunho = RASCUNHOS.get(chaveDoRascunho(equipe, dia));
          const meuId = idDoLogado(l.pessoas, currentUser.name);
          setMarcas(
            rascunho
              ? podarMarcas(rascunho, l.pessoas, l.veiculos)
              : meuId === null
                ? SEM_MARCAS
                : marcarPessoa(SEM_MARCAS, meuId, "ADM"),
          );
          setEstavaP({});
          setEstavaV({});
          setEditando(true);
        }
        setChaveDasMarcas(chaveDoRascunho(equipe, dia));
      } catch (e) {
        if (vivo) setErro(mensagemDaFalha(e));
      }
    })();
    return () => {
      vivo = false;
    };
  }, [equipe, dia, recarga, currentUser.name]);

  // A barra da semana.
  useEffect(() => {
    if (!equipe) return;
    let vivo = true;
    setSemana(null);
    void import("@/lib/estrutura.functions")
      .then(({ semanaDaEquipe }) => semanaDaEquipe({ data: { equipe, dia: segunda } }))
      .then((r) => vivo && setSemana(r.dias))
      .catch(() => vivo && setSemana([])); // sem a barra, a tela ainda funciona
    return () => {
      vivo = false;
    };
  }, [equipe, segunda, recarga]);

  // O rascunho: só de dia aberto, e só para a equipe e o dia a que as marcas pertencem.
  useEffect(() => {
    if (editando && lista && !doDia?.enviada && chaveDasMarcas === chaveDoRascunho(equipe, dia)) {
      RASCUNHOS.set(chaveDasMarcas, marcas);
    }
  }, [marcas, editando, lista, doDia, chaveDasMarcas, equipe, dia]);

  /* -------------------------------- Ações -------------------------------- */

  const marcarP = (id: number, status: string) => {
    setAntes(null);
    setMarcas((m) => marcarPessoa(m, id, status));
  };
  const marcarV = (prefixo: string, status: string) => {
    setAntes(null);
    setMarcas((m) => marcarVeiculo(m, prefixo, status));
  };

  const aoTodosAdm = () => {
    if (!lista) return;
    setAntes(marcas);
    setMarcas(todosAdm(marcas, lista.pessoas));
  };

  const aoDesfazer = () => {
    if (!antes) return;
    setMarcas(antes);
    setAntes(null);
  };

  /** "Repetir último dia": só PREENCHE a tela (até 7 dias para trás), nunca envia. */
  const aoRepetir = async () => {
    if (!lista || repetindo) return;
    setRepetindo(true);
    try {
      const { ultimaEstruturaDaEquipe } = await import("@/lib/estrutura.functions");
      const { achada } = await ultimaEstruturaDaEquipe({ data: { equipe, dia } });
      if (!achada) {
        toast.info("Nenhuma estrutura nos últimos 7 dias.");
        return;
      }
      const atuais = marcasRef.current;
      const r = repetirDe(atuais, achada.estrutura, lista.pessoas, lista.veiculos);
      if (r.preenchidos === 0) {
        toast.info(
          `A estrutura de ${dataPorExtenso(achada.dia)} não trouxe nada novo para preencher.`,
        );
        return;
      }
      setAntes(atuais);
      setMarcas(r.marcas);
      toast.success(`Preenchido com a estrutura de ${dataPorExtenso(achada.dia)}`, {
        description: "Confira as marcas e envie. Nada foi enviado ainda.",
      });
    } catch (e) {
      toast.error(mensagemDaFalha(e));
    } finally {
      setRepetindo(false);
    }
  };

  /**
   * O envio, com os três avisos na ordem: madrugada, reenvio e retirada. Cada
   * um só aparece se vale para este envio, e recusar qualquer um para tudo.
   */
  const aoEnviar = async () => {
    if (!lista || enviando) return;
    const envio = paraEnvio(marcas, lista.pessoas, lista.veiculos);
    if (!envio) return;
    const confirmacao = {
      madrugada: false,
      reenvio: false,
      retirados: [] as number[],
      retiradosVeiculos: [] as string[],
    };

    if (dia === hoje && ehMadrugada()) {
      if (!(await confirmar(popupDaMadrugada(dia)))) return;
      confirmacao.madrugada = true;
    }
    if (doDia?.enviada) {
      if (!(await confirmar(popupDoReenvio(dia)))) return;
      confirmacao.reenvio = true;
    }
    const { efetivos, veiculos: veiculosFora } = aSeremRetirados(
      marcas,
      lista.pessoas,
      lista.veiculos,
    );
    if (efetivos.length > 0 || veiculosFora.length > 0) {
      const nomes = efetivos.map((p) => p.nome);
      const prefixos = veiculosFora.map((v) => v.prefixo);
      if (!(await confirmar(popupDaRetirada(nomes, prefixos)))) return;
      confirmacao.retirados = efetivos.map((p) => p.id);
      confirmacao.retiradosVeiculos = veiculosFora.map((v) => v.prefixo.trim().toUpperCase());
    }

    setEnviando(true);
    try {
      const { enviarEstrutura } = await import("@/lib/estrutura.functions");
      const r = await enviarEstrutura({ data: { equipe, dia, ...envio, confirmacao } });
      const partes = [`${r.pessoas} pessoas`, `${r.veiculos} veículos`];
      if (r.preservados) partes.push(`${r.preservados} lançamentos do PCP e ajustes preservados`);
      if (r.simulado) {
        toast.success("Simulação concluída", {
          description: `Nada foi enviado ao sistema de apontamento (${partes.join(", ")}).`,
        });
      } else {
        RASCUNHOS.delete(chaveDoRascunho(equipe, dia));
        toast.success("Estrutura enviada", { description: partes.join(", ") });
      }
      if (r.retirados.length > 0) {
        toast.info(`${listaDeNomes(r.retirados)}: retirado(s) da equipe`);
      }
      const externos = r.naoRetirados.filter((x) => x.motivo === "externo").map((x) => x.nome);
      if (externos.length > 0) {
        toast.warning(`${listaDeNomes(externos)} continua(m) na lista`, {
          description:
            "O status foi gravado, mas PJ e estagiário não saem da equipe por aqui: isso muda no cadastro de externos, pela TI.",
          duration: 12_000,
        });
      }
      const falhas = r.naoRetirados.filter((x) => x.motivo === "falha").map((x) => x.nome);
      if (falhas.length > 0) {
        toast.error(`${listaDeNomes(falhas)} continua(m) na equipe`, {
          description: "O envio foi feito, mas a retirada falhou. Retire pelo app de campo.",
          duration: 15_000,
        });
      }
      avisarEnvio(equipe, dia);
      setRecarga((x) => x + 1);
    } catch (e) {
      const motivo = motivoDaFalha(e);
      if (motivo === "lista_mudou") {
        const f = e as FalhaDaEstrutura;
        if (f.pessoas && f.veiculos) {
          setLista({ pessoas: f.pessoas, veiculos: f.veiculos });
          setMarcas((m) => podarMarcas(m, f.pessoas!, f.veiculos!));
        }
      }
      // O que está na tela pode estar velho: relê o dia.
      if (motivo === "ja_enviado" || motivo === "envio_incerto" || motivo === "dia_virou") {
        setRecarga((x) => x + 1);
      }
      // A equipe deixou de ser da pessoa (o envio confere com o PWA na hora): ela sai daqui agora.
      if (motivo === "fora_do_alcance") void carregarEquipes(true);
      toast.error(mensagemDaFalha(e), { duration: 12_000 });
    } finally {
      setEnviando(false);
    }
  };

  /* -------------------------------- Tela -------------------------------- */

  // Sem estrutura para esta pessoa: volta ao Início, mas só depois de saber (no primeiro
  // render ainda não perguntamos nada) e se não foi um erro de rede (aí a tela mostra o erro).
  if (est.pronto && !est.erro && (!est.aberta || est.equipes.length === 0)) {
    return <Navigate to="/" replace />;
  }

  const faltam = lista ? quantosFaltam(marcas, lista.pessoas, lista.veiculos) : 0;
  const equipeVazia = lista !== null && lista.pessoas.length === 0 && lista.veiculos.length === 0;
  /** Puxar quem está sem equipe: só em edição, e só liberado. */
  const podeAdicionar = editando && ADICIONAR_NA_EQUIPE_LIGADO;
  const meuId = lista ? idDoLogado(lista.pessoas, currentUser.name) : null;
  const enviada = doDia?.enviada === true;
  /** Sem conseguir ler as equipes (rede, PWA fora do ar) a tela mostra o erro, e não um esqueleto eterno. */
  const erroDeEquipes =
    est.pronto && est.equipes.length === 0 && est.erro
      ? mensagemDaFalha({ motivo: est.erro })
      : null;
  const mudarBusca = (e: string, d: string) => aoMudarBusca({ equipe: e, dia: d });
  const andarSemana = (passo: -1 | 1) => {
    const alvo = somarDias(dia, passo * 7);
    mudarBusca(equipe, alvo > hoje ? diaAberto(undefined, hoje) : alvo);
  };

  return (
    <FluxoLayout title="Estrutura do dia">
      <div className="mx-auto flex w-full max-w-[2200px] flex-col gap-5 py-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <ClipboardList className="h-5 w-5 text-primary" aria-hidden />
              Estrutura do dia
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Marque cada pessoa e cada veículo da equipe. Só envia com tudo marcado.
            </p>
          </div>
          {equipe && (
            <SeletorDeEquipe
              // O seletor é só de quem troca de equipe (o Eduardo); os outros veem o código da sua.
              equipes={
                est.trocaDeEquipe ? est.equipes : est.equipes.filter((e) => e.equipe === equipe)
              }
              valor={equipe}
              aoMudar={(e) => mudarBusca(e, dia)}
            />
          )}
        </div>

        <BarraDaSemana
          dias={semana}
          diaSelecionado={dia}
          hoje={hoje}
          aoEscolherDia={(d) => mudarBusca(equipe, d)}
          aoMudarSemana={andarSemana}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold capitalize">
            {dataPorExtenso(dia)}
            {dia === hoje && (
              <span className="ml-2 text-xs font-normal normal-case text-muted-foreground">
                hoje
              </span>
            )}
          </h2>
          {enviada && !editando && (
            <button
              type="button"
              onClick={() => {
                setAntes(null);
                setEditando(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Reenviar / corrigir
            </button>
          )}
        </div>

        {enviada && !editando && (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            Estrutura enviada. Você está vendo o que foi guardado para este dia.
          </p>
        )}
        {enviada && editando && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-900 dark:text-amber-200">
            <span>Corrigindo a estrutura já enviada: o envio anterior será substituído.</span>
            <button
              type="button"
              onClick={() => setRecarga((x) => x + 1)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold hover:bg-amber-500/20"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Cancelar correção
            </button>
          </div>
        )}

        {erro || erroDeEquipes ? (
          <CartaoDeErro
            mensagem={(erro ?? erroDeEquipes)!}
            aoTentarDeNovo={() => (erro ? setRecarga((x) => x + 1) : void carregarEquipes(true))}
          />
        ) : !lista ? (
          <Esqueleto />
        ) : equipeVazia && !podeAdicionar ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Esta equipe não tem pessoas nem veículos cadastrados no sistema de apontamento.
          </p>
        ) : (
          <>
            {equipeVazia && (
              <p className="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
                Esta equipe ainda não tem ninguém no sistema de apontamento. Adicione pessoas ou
                veículos que estejam sem equipe.
              </p>
            )}
            <ListaDePessoas
              pessoas={lista.pessoas}
              marcas={marcas}
              editando={editando}
              estava={estavaP}
              euId={meuId}
              aoMarcar={marcarP}
              aoAdicionar={podeAdicionar ? () => setAdicionando("pessoas") : undefined}
            />
            <ListaDeVeiculos
              veiculos={lista.veiculos}
              marcas={marcas}
              editando={editando}
              estava={estavaV}
              aoMarcar={marcarV}
              aoAdicionar={podeAdicionar ? () => setAdicionando("veiculos") : undefined}
            />
            {!editando && doDia && doDia.foraDaLista.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Também constavam neste dia, mas não estão mais na equipe:{" "}
                {doDia.foraDaLista.map((x) => `${x.nome} (${x.status})`).join(", ")}.
              </p>
            )}
          </>
        )}

        {lista && !equipeVazia && editando && (
          <BarraDeAcoes
            faltam={faltam}
            podeDesfazer={antes !== null}
            enviando={enviando}
            repetindo={repetindo}
            simulacao={!ENVIO_REAL_LIGADO || import.meta.env.DEV}
            reenvio={enviada}
            aoTodosAdm={aoTodosAdm}
            aoRepetir={() => void aoRepetir()}
            aoDesfazer={aoDesfazer}
            aoEnviar={() => void aoEnviar()}
          />
        )}

        <AdicionarNaEquipe
          tipo={adicionando}
          equipe={equipe}
          aoFechar={() => setAdicionando(null)}
          aoAdicionado={() => setRecarga((x) => x + 1)}
        />
      </div>
    </FluxoLayout>
  );
}
