// A lógica de servidor da estrutura do dia. EXCLUSIVO do servidor — carregue dentro
// dos handlers de `estrutura.functions.ts`:
//   const e = await import("@/lib/estrutura.server");
//
// Quem fala com o PWA é `integrations/pwa/cliente.server.ts`; aqui ficam as REGRAS
// do CONECTA: quem pode ver o quê, o que se guarda e por quanto tempo, e a ordem do
// envio. O PWA continua dono da regra de dados (data, hierarquia, duplicidade, folgas).
//
// Uma coisa a saber: o PWA deixa QUALQUER token LER (só o envio confere a equipe,
// 403 — Eduardo, 09/11/2026). Então a única barreira entre um colega de outro setor
// e o CPF de uma equipe é `exigirEquipe`, aqui. Toda leitura por equipe passa por ela
// ANTES de tocar em cache ou em rede, e o CPF que sai daqui para a tela é sempre mascarado.

import { randomInt } from "node:crypto";
import { iamResolve } from "@/integrations/iam/client.server";
import { lerSessao } from "@/integrations/iam/session.server";
import { clienteDoPwa as pwa } from "@/integrations/pwa/cliente.server";
import { ErroDaEstrutura } from "@/integrations/pwa/erro";
import type {
  ColaboradorPwa,
  EquipePwa,
  HierarquiaPwa,
  LinhaDoDiaPwa,
  PessoaPwa,
  VeiculoDoProjetoPwa,
  VeiculoPwa,
} from "@/integrations/pwa/tipos";
import { envioDeVerdade } from "@/integrations/pwa/transporte.server";
import { compartilhado, esquecer } from "@/lib/cache-compartilhado.server";
import {
  diasUteisDaSemana,
  diaValido,
  ehMadrugada,
  hojeEmBrasilia,
  segundaDaSemana,
  somarDias,
} from "@/lib/estrutura-datas";
import {
  ADICIONAR_NA_EQUIPE_LIGADO,
  equipeParticipa,
  ESTRUTURA_LIBERADA,
  LIDERES_SEM_PAPEL_DE_SUPERVISOR,
  PILOTO_DA_ESTRUTURA,
  QUEM_TROCA_DE_EQUIPE,
} from "@/lib/estrutura-liberada";
import {
  estaSemEquipe,
  funcaoDeSupervisor,
  NAO_ESTA_NA_EQUIPE,
  semAcento,
  statusDaPessoa,
  statusDoVeiculo,
  type Candidatos,
  type CandidatoDePessoa,
  type CandidatoDeVeiculo,
  type CobrancaDaEquipe,
  type DiaDaSemana,
  type EquipeDaEstrutura,
  type EquipesDaPessoa,
  type EstruturaDoDia,
  type MarcaDePessoa,
  type MarcaDeVeiculo,
  type PedidoDeAdicao,
  type PedidoDeEnvio,
  type PessoaDaEquipe,
  type ResultadoDaAdicao,
  type ResultadoDoEnvio,
  type SituacaoDoDia,
  type TipoDeCandidato,
  type VeiculoDaEquipe,
} from "@/lib/estrutura-tipos";

const MIN = 60_000;

/* ------------------------------- Acesso ------------------------------- */

const chaveQuemSou = (eu: number) => `estrutura:quem:${eu}`;

/**
 * O papel e o nome da pessoa no PRÓPRIO CONECTA (`gestor.perfis`, acertado a cada login pelo
 * organograma): "gerente", "supervisor" (quem chefia alguém) ou "adm". Guardado 10 minutos. É o que
 * decide se a pessoa pergunta ao PWA as suas equipes: assim só os supervisores geram leitura lá.
 */
async function quemSou(eu: number): Promise<{ papel: string; nome: string }> {
  return compartilhado(chaveQuemSou(eu), 10 * MIN, async () => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("eu", sql.Int, eu)
      .query(`SELECT papel, nome FROM gestor.perfis WHERE pessoa_id = @eu`);
    const l = r.recordset[0] as { papel?: string | null; nome?: string | null } | undefined;
    return {
      papel: (l?.papel ?? "adm").trim().toLowerCase(),
      nome: (l?.nome ?? "").trim(),
    };
  });
}

/** Tem o seletor de equipe (e vê todas as que o PWA devolver)? Só o Eduardo. */
function trocaDeEquipe(eu: number): boolean {
  return QUEM_TROCA_DE_EQUIPE[eu] !== undefined;
}

/**
 * A estrutura está aberta para esta pessoa? Só liberada para todos ou para quem está no piloto, e
 * só para SUPERVISOR (decisão do usuário, 10/11/2026): a gerência não vê
 * a aba (para ela virá outra coisa) e quem não chefia ninguém não aponta. O Eduardo vê sempre. Os
 * líderes de equipe ADM que o CONECTA marca como `adm` (`LIDERES_SEM_PAPEL_DE_SUPERVISOR`, 26/11/2026)
 * também abrem, sem perguntar o papel. É a PRIMEIRA linha de toda função: fechada, nada é lido nem
 * chamado, nem o PWA.
 */
export async function estruturaAbertaPara(eu: number): Promise<boolean> {
  if (!ESTRUTURA_LIBERADA && !PILOTO_DA_ESTRUTURA.pessoas.includes(eu)) return false;
  if (QUEM_TROCA_DE_EQUIPE[eu] !== undefined) return true;
  if (LIDERES_SEM_PAPEL_DE_SUPERVISOR.includes(eu)) return true;
  return (await quemSou(eu)).papel === "supervisor";
}

export async function exigirAberta(eu: number): Promise<void> {
  if (!(await estruturaAbertaPara(eu))) {
    throw new ErroDaEstrutura("fechada", "A estrutura do dia ainda não está aberta para você.");
  }
}

/**
 * Roda `fn` com o token da sessão. Se o PWA recusar o token (401), pergunta à
 * IAM: se ela também recusa, a sessão expirou; se aceita, o problema é de
 * cadastro lá (o PWA não reconheceu o acesso) e a pessoa não deve ser deslogada.
 */
export async function comToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  const token = lerSessao();
  if (!token) throw new ErroDaEstrutura("sem_sessao", "Sessão expirada. Entre novamente.");
  try {
    return await fn(token);
  } catch (e) {
    if (e instanceof ErroDaEstrutura && e.motivo === "acesso_negado") {
      try {
        await iamResolve(token);
      } catch {
        throw new ErroDaEstrutura("sem_sessao", "Sua sessão expirou. Entre novamente.", 401);
      }
    }
    throw e;
  }
}

/* ------------------------------- Equipes ------------------------------- */

const chaveEquipes = (eu: number) => `estrutura:equipes:${eu}`;
const chavePessoas = (equipe: string) => `estrutura:pessoas:${equipe}`;
const chaveSemana = (equipe: string, segunda: string) => `estrutura:semana:${equipe}:${segunda}`;
const chaveDia = (equipe: string, dia: string) => `estrutura:dia:${equipe}:${dia}`;
const chaveCobranca = (eu: number) => `estrutura:cobranca:${eu}`;

/**
 * Por quanto tempo as equipes de uma pessoa ficam guardadas. Longo de propósito (sugestão do usuário,
 * 10/11/2026): quem entra ou sai de equipe é raro, e o menu, o card e o lembrete vivem do que já se
 * sabe. A conferência com o PWA é na hora de APONTAR: abrir a tela e enviar pedem `fresco`, e quem
 * não é mais da equipe sai nesse momento.
 */
const VALIDADE_DAS_EQUIPES = 12 * 60 * MIN;

/** A equipe entra para esta pessoa agora? Fora da estrutura não; antes da liberação, só as do piloto. */
const equipeVale = (codigo: string): boolean =>
  equipeParticipa(codigo) &&
  (ESTRUTURA_LIBERADA || PILOTO_DA_ESTRUTURA.equipes.includes(codigo.trim().toUpperCase()));

/** O que se guarda de `minhas-equipes`: as equipes (vazio se não veio `modoAdm`) e a forma da resposta. */
interface EquipesGuardadas {
  equipes: EquipePwa[];
  resumo: string;
}

/**
 * As equipes da pessoa, do jeito que o PWA diz (`minhas-equipes`), menos as que estão fora da
 * estrutura e, enquanto não está liberada, só as do piloto. Quem não tem o seletor fica só com as
 * equipes que ele mesmo lidera (ver `soAsQueLidera`). `fresco` ignora o que está guardado.
 *
 * Quem tem o seletor (o Eduardo) tem a equipe dele CONFIGURADA (`QUEM_TROCA_DE_EQUIPE`). Se a lista
 * do PWA não a trouxer (veio vazia, sem `modoAdm`, num formato que não lemos, ou deu erro), a tela
 * usa a configurada e diz o que a lista respondeu (pedido do usuário, 18/11/2026: a lista dele volta
 * vazia e não se sabe por quê). Líder, projeto e cliente ficam em branco de propósito: o envio e a
 * cobrança já tiram os dois primeiros do organograma que o PWA devolve com as pessoas da equipe. O
 * resto da tela segue falando com o PWA com o token dele: se o PWA não o aceitar, a tela mostra o erro.
 */
async function equipesComDiagnostico(
  eu: number,
  token: string,
  opcoes: { fresco?: boolean },
): Promise<{ equipes: EquipePwa[]; diagnostico: string | null }> {
  if (opcoes.fresco) esquecer(chaveEquipes(eu));
  const dele = QUEM_TROCA_DE_EQUIPE[eu]?.trim().toUpperCase();
  let guardadas: EquipesGuardadas;
  try {
    guardadas = await compartilhado(
      chaveEquipes(eu),
      VALIDADE_DAS_EQUIPES,
      async (): Promise<EquipesGuardadas> => {
        const r = await pwa.minhasEquipes(token);
        return { equipes: r.modoAdm ? r.equipes : [], resumo: r.resumo };
      },
    );
  } catch (e) {
    /* Só quem tem a equipe configurada segue sem a lista; os outros veem o erro, como sempre. */
    if (!dele || !(e instanceof ErroDaEstrutura)) throw e;
    guardadas = { equipes: [], resumo: `deu erro: ${e.message.replace(/\.+$/, "")}` };
  }
  const valem = guardadas.equipes.filter((e) => equipeVale(e.equipe));
  if (!dele) return { equipes: soAsQueLidera(valem, (await quemSou(eu)).nome), diagnostico: null };
  if (!equipeVale(dele) || valem.some((e) => e.equipe.trim().toUpperCase() === dele)) {
    return { equipes: valem, diagnostico: null };
  }
  return {
    equipes: [{ equipe: dele, lider: "", projeto: "", cliente: "" }, ...valem],
    diagnostico: `A lista de equipes do apontamento não trouxe a ${dele}, então a tela usa a configurada para você. O que a lista respondeu: ${guardadas.resumo}.`,
  };
}

export async function equipesDe(
  eu: number,
  token: string,
  opcoes: { fresco?: boolean } = {},
): Promise<EquipePwa[]> {
  return (await equipesComDiagnostico(eu, token, opcoes)).equipes;
}

/**
 * Quem tem o seletor (o Eduardo) VÊ as outras equipes, mas só envia e altera a dele (decisão do
 * usuário, 18/11/2026): nas outras, a troca de equipe é só para consultar. Vale no envio (que também
 * retira da equipe) e no "Adicionar". Os outros só alcançam a própria equipe (`soAsQueLidera`).
 */
function exigirQuePodeAlterar(eu: number, equipe: string): void {
  const dele = QUEM_TROCA_DE_EQUIPE[eu]?.trim().toUpperCase();
  if (dele && equipe.trim().toUpperCase() !== dele) {
    throw new ErroDaEstrutura(
      "so_consulta",
      `Você pode ver esta equipe, mas só envia e altera a sua (${dele}).`,
    );
  }
}

/**
 * Sem o seletor, a pessoa fica só com a(s) equipe(s) que ela mesma lidera. Normalmente o PWA já
 * devolve só essas (o líder do organograma, ou o escopo de equipe da IAM), e uma equipe só passa
 * direto. A conta pesa para quem tem escopo amplo na IAM e recebe várias: fica a que tem o nome dele
 * como líder, e nenhuma se nenhuma tiver.
 */
function soAsQueLidera(equipes: EquipePwa[], nome: string): EquipePwa[] {
  if (equipes.length <= 1) return equipes;
  const eu = semAcento(nome);
  return eu ? equipes.filter((e) => semAcento(e.lider) === eu) : [];
}

/** Onde a tela abre: a equipe do Eduardo, a que a pessoa lidera, ou a primeira. */
async function equipeInicial(eu: number, equipes: readonly EquipePwa[]): Promise<string> {
  const codigos = equipes.map((e) => e.equipe);
  const dele = QUEM_TROCA_DE_EQUIPE[eu];
  if (dele && codigos.includes(dele)) return dele;
  const nome = semAcento((await quemSou(eu)).nome);
  return equipes.find((e) => nome && semAcento(e.lider) === nome)?.equipe ?? codigos[0] ?? "";
}

/** A equipe é de quem chama? Sem isso, nada por equipe é lido (nem do cache). */
export async function exigirEquipe(
  eu: number,
  token: string,
  equipe: string,
  opcoes: { fresco?: boolean } = {},
): Promise<EquipePwa> {
  const alvo = equipe.trim().toUpperCase();
  const achada = (await equipesDe(eu, token, opcoes)).find(
    (e) => e.equipe.trim().toUpperCase() === alvo,
  );
  if (!achada) throw new ErroDaEstrutura("fora_do_alcance", "Esta equipe não é sua.");
  return achada;
}

/**
 * As equipes de quem chama. `fresco` = a pessoa abriu a tela para apontar: confere com o PWA agora
 * (quem não é mais da equipe sai aqui); sem ele, vale o que está guardado.
 */
export async function minhasEquipes(
  eu: number,
  opcoes: { fresco?: boolean } = {},
): Promise<EquipesDaPessoa> {
  if (!(await estruturaAbertaPara(eu))) {
    return { aberta: false, equipes: [], trocaDeEquipe: false, inicial: "" };
  }
  const { equipes, diagnostico } = await comToken((token) =>
    equipesComDiagnostico(eu, token, opcoes),
  );
  return {
    aberta: true,
    equipes: equipes.map((e) => ({ equipe: e.equipe, projeto: e.projeto, cliente: e.cliente })),
    trocaDeEquipe: trocaDeEquipe(eu),
    inicial: await equipeInicial(eu, equipes),
    ...(diagnostico ? { diagnostico } : {}),
  };
}

/* --------------------------- Pessoas e veículos --------------------------- */

const digitos = (s: string) => s.replace(/\D/g, "");

/** O meio do CPF, o bastante para reconhecer. Vazio se não for um CPF. */
export function mascararCpf(cpf: string): string {
  const d = digitos(cpf);
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : "";
}

const pessoaPublica = (p: PessoaPwa, supervisor: boolean): PessoaDaEquipe => ({
  id: p.id,
  nome: p.nome,
  funcao: p.funcao,
  // O PWA já manda o CPF mascarado (so os 3 ultimos digitos): vale o dele, que revela menos que o nosso.
  cpf: p.externo ? "" : p.cpfMascarado || mascararCpf(p.cpf),
  externo: p.externo,
  tipoExterno: p.tipoExterno,
  supervisor,
});

/**
 * A lista da equipe para a tela. É supervisor quem tem "supervisor" na função, ou quem é o supervisor
 * de alguém da própria equipe (o campo `supervisor` de cada pessoa é o NOME do supervisor dela).
 */
function pessoasPublicas(pessoas: readonly PessoaPwa[]): PessoaDaEquipe[] {
  const supervisoresDaEquipe = new Set(pessoas.map((p) => semAcento(p.supervisor)).filter(Boolean));
  return pessoas.map((p) =>
    pessoaPublica(p, funcaoDeSupervisor(p.funcao) || supervisoresDaEquipe.has(semAcento(p.nome))),
  );
}

/** Projeto, coordenador e supervisor da equipe: o valor que mais aparece nas pessoas (o `user` do POST). */
function hierarquiaDe(pessoas: readonly PessoaPwa[]): HierarquiaPwa {
  const maisComum = (campo: "projeto" | "coordenador" | "supervisor"): string => {
    const cont = new Map<string, number>();
    for (const p of pessoas) if (p[campo]) cont.set(p[campo], (cont.get(p[campo]) ?? 0) + 1);
    return [...cont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  };
  return {
    projeto: maisComum("projeto"),
    coordenador: maisComum("coordenador"),
    supervisor: maisComum("supervisor"),
  };
}

const veiculoPublico = (v: VeiculoPwa): VeiculoDaEquipe => ({
  prefixo: v.prefixo,
  placa: v.placa,
  modelo: v.modelo,
  tipo: v.tipo,
});

/** Guardado 2 minutos por equipe, JÁ mascarado: o CPF inteiro nunca fica em cache. */
export async function pessoasEFrota(
  eu: number,
  equipe: string,
): Promise<{ pessoas: PessoaDaEquipe[]; veiculos: VeiculoDaEquipe[] }> {
  await exigirAberta(eu);
  return comToken(async (token) => {
    const eq = await exigirEquipe(eu, token, equipe);
    return compartilhado(chavePessoas(eq.equipe), 2 * MIN, async () => {
      const [pessoas, veiculos] = await Promise.all([
        pwa.pessoas(token, eq.equipe),
        pwa.veiculos(token, eq.equipe),
      ]);
      return { pessoas: pessoasPublicas(pessoas), veiculos: veiculos.map(veiculoPublico) };
    });
  });
}

/* ------------------------------ A semana ------------------------------ */

function situacaoDoDia(
  dia: string,
  hoje: string,
  enviado: boolean,
  daCobranca: "feito" | "pendente" | "folga" | "naoCobrado" | undefined,
): SituacaoDoDia {
  if (enviado) return "enviado";
  if (dia > hoje) return "futuro";
  if (daCobranca === "folga") return "folga";
  if (daCobranca === "naoCobrado") return "naoCobrado";
  // Feriado sem folga lançada conta como PENDENTE (Eduardo, 09/11/2026).
  return "pendente";
}

/** Segunda a sexta da semana de `dia`. Guardado 1 minuto por equipe e semana. */
export async function semanaDaEquipe(
  eu: number,
  equipe: string,
  dia: string,
): Promise<DiaDaSemana[]> {
  await exigirAberta(eu);
  if (!diaValido(dia)) throw new ErroDaEstrutura("dia_invalido", "Dia inválido.");
  return comToken(async (token) => {
    const eq = await exigirEquipe(eu, token, equipe);
    const dias = diasUteisDaSemana(dia);
    return compartilhado(chaveSemana(eq.equipe, segundaDaSemana(dia)), MIN, async () => {
      const [enviados, cobranca] = await Promise.all([
        pwa.diasEnviados(token, eq.equipe, dias[0]!, dias[4]!),
        // Sem a cobrança a semana ainda vale: só deixa de saber quem estava de folga.
        pwa.cobranca(token, eq).catch(() => null),
      ]);
      const hoje = hojeEmBrasilia();
      return dias.map((d) => ({
        dia: d,
        situacao: situacaoDoDia(d, hoje, enviados.includes(d), cobranca?.dias[d]),
      }));
    });
  });
}

/* ----------------------------- O dia enviado ----------------------------- */

/**
 * Casa as linhas do TICKET do dia com a lista de hoje: o efetivo pelo CPF, o
 * externo (id negativo, sem CPF) pelo nome normalizado. Quem não casa com
 * ninguém (saiu da equipe depois) vai em `foraDaLista`, só para mostrar.
 */
export function casarLinhas(
  linhas: LinhaDoDiaPwa[],
  pessoas: PessoaPwa[],
  veiculos: VeiculoPwa[],
): EstruturaDoDia {
  const porCpf = new Map<string, PessoaPwa>();
  const porNome = new Map<string, PessoaPwa[]>();
  for (const p of pessoas) {
    const d = digitos(p.cpf);
    if (!p.externo && d) porCpf.set(d, p);
    const k = semAcento(p.nome);
    porNome.set(k, [...(porNome.get(k) ?? []), p]);
  }
  const porPrefixo = new Map(veiculos.map((v) => [v.prefixo.trim().toUpperCase(), v]));

  const usados = new Set<number>();
  const marcasP: MarcaDePessoa[] = [];
  const marcasV = new Map<string, MarcaDeVeiculo>();
  const fora: { nome: string; status: string }[] = [];

  for (const l of linhas) {
    if (l.tipo === "veiculo") {
      const status = statusDoVeiculo(l.status) ?? l.status.trim();
      const v = porPrefixo.get(l.prefixo.trim().toUpperCase());
      if (v) marcasV.set(v.prefixo, { prefixo: v.prefixo, status });
      else fora.push({ nome: l.prefixo.trim() || l.nome.trim(), status });
      continue;
    }
    const status = statusDaPessoa(l.status) ?? l.status.trim();
    const d = digitos(l.cpf);
    const p =
      (d ? porCpf.get(d) : undefined) ??
      (porNome.get(semAcento(l.nome)) ?? []).find((c) => !usados.has(c.id));
    if (!p) fora.push({ nome: l.nome.trim(), status });
    else if (!usados.has(p.id)) {
      usados.add(p.id);
      marcasP.push({ id: p.id, status });
    }
  }
  return {
    enviada: linhas.length > 0,
    pessoas: marcasP,
    veiculos: [...marcasV.values()],
    foraDaLista: fora,
  };
}

async function lerDia(token: string, equipe: string, dia: string): Promise<EstruturaDoDia> {
  const [linhas, pessoas, veiculos] = await Promise.all([
    pwa.linhasDoDia(token, equipe, dia),
    pwa.pessoas(token, equipe),
    pwa.veiculos(token, equipe),
  ]);
  return casarLinhas(linhas, pessoas, veiculos);
}

/** A estrutura já enviada para `dia`. Guardada 1 minuto por equipe e dia. */
export async function estruturaDoDia(
  eu: number,
  equipe: string,
  dia: string,
): Promise<EstruturaDoDia> {
  await exigirAberta(eu);
  if (!diaValido(dia)) throw new ErroDaEstrutura("dia_invalido", "Dia inválido.");
  if (dia > hojeEmBrasilia()) {
    throw new ErroDaEstrutura("dia_futuro", "Esse dia ainda não chegou.");
  }
  return comToken(async (token) => {
    const eq = await exigirEquipe(eu, token, equipe);
    return compartilhado(chaveDia(eq.equipe, dia), MIN, () => lerDia(token, eq.equipe, dia));
  });
}

/**
 * O último dia enviado ANTES de `dia`, até 7 dias para trás: o "Repetir último dia"
 * (só preenche a tela, nunca envia). `null` se não houve nenhum.
 */
export async function ultimaEstruturaAntes(
  eu: number,
  equipe: string,
  dia: string,
): Promise<{ dia: string; estrutura: EstruturaDoDia } | null> {
  await exigirAberta(eu);
  if (!diaValido(dia)) throw new ErroDaEstrutura("dia_invalido", "Dia inválido.");
  return comToken(async (token) => {
    const eq = await exigirEquipe(eu, token, equipe);
    const enviados = await pwa.diasEnviados(
      token,
      eq.equipe,
      somarDias(dia, -7),
      somarDias(dia, -1),
    );
    const ultimo = enviados
      .filter((d) => d < dia)
      .sort()
      .pop();
    if (!ultimo) return null;
    return {
      dia: ultimo,
      estrutura: await compartilhado(chaveDia(eq.equipe, ultimo), MIN, () =>
        lerDia(token, eq.equipe, ultimo),
      ),
    };
  });
}

/* ------------------------------- Cobrança ------------------------------- */

/**
 * A situação de HOJE de cada equipe da pessoa (o `scoreDia` do PWA), para o card
 * do Início e o lembrete do Pack. Guardada 4 minutos por pessoa; a tela pergunta
 * a cada 5. Uma equipe cuja cobrança falhou vira "não cobrado": melhor calar do
 * que cobrar de quem pode já ter enviado.
 */
/**
 * Quais equipes o card do Início e o lembrete do Pack cobram (`null` = todas). Cada equipe cobrada são
 * duas chamadas ao PWA a cada 5 minutos, até o dia ficar resolvido.
 * - O Eduardo vê todas as equipes, mas aponta só a dele: só ela é cobrada.
 * As outras voltam "não cobrado", e o card não as desenha; a semana de cada equipe segue sob demanda.
 */
async function equipesCobradas(
  eu: number,
  equipes: readonly EquipePwa[],
): Promise<Set<string> | null> {
  if (QUEM_TROCA_DE_EQUIPE[eu] === undefined) return null;
  return new Set([(await equipeInicial(eu, equipes)).trim().toUpperCase()]);
}

export async function cobrancaDeHoje(eu: number): Promise<CobrancaDaEquipe[]> {
  await exigirAberta(eu);
  return comToken(async (token) => {
    const equipes = await equipesDe(eu, token);
    const soNestas = await equipesCobradas(eu, equipes);
    return compartilhado(chaveCobranca(eu), 4 * MIN, () =>
      Promise.all(
        equipes.map(async (e): Promise<CobrancaDaEquipe> => {
          if (soNestas && !soNestas.has(e.equipe.trim().toUpperCase())) {
            return { equipe: e.equipe, hoje: "naoCobrado" };
          }
          try {
            return { equipe: e.equipe, hoje: (await pwa.cobranca(token, e)).hoje };
          } catch {
            return { equipe: e.equipe, hoje: "naoCobrado" };
          }
        }),
      ),
    );
  });
}

function invalidar(eu: number, equipe: string, dia: string): void {
  esquecer(chaveSemana(equipe, segundaDaSemana(dia)));
  esquecer(chaveDia(equipe, dia));
  esquecer(chaveCobranca(eu));
}

/* -------------------------------- O envio -------------------------------- */

/** Um envio por vez para cada equipe e dia: o segundo clique recebe `envio_em_andamento`. */
const emEnvio = new Set<string>();

/**
 * "L" + milissegundos + 3 letras: o formato do app. SEM o prefixo: o PWA acrescenta `CONECTA-`
 * pela `origem` do corpo (Eduardo, 09/11/2026), e recusa se passar de 50 já com ele.
 */
export function novoLoteId(): string {
  const letras = Array.from({ length: 3 }, () => String.fromCharCode(97 + randomInt(26))).join("");
  return `L${Date.now()}${letras}`;
}

const mesmoConjunto = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * O `ator` que o PWA grava na auditoria ao trocar a equipe de alguém: o nome do líder logado. O
 * `lider` de `minhas-equipes` sai do próprio token, no nome do organograma; se vier vazio, vai
 * "CONECTA".
 */
const atorDe = (eq: EquipePwa): string => eq.lider || "CONECTA";

/**
 * O envio, na ordem. Cada passo recusa com um `motivo` que a tela entende; nada
 * é gravado antes do POST. O navegador manda só as marcas: o CPF, o nome e a
 * classe vêm do PWA, aqui, na hora.
 */
export async function enviar(eu: number, pedido: PedidoDeEnvio): Promise<ResultadoDoEnvio> {
  await exigirAberta(eu);
  exigirQuePodeAlterar(eu, pedido.equipe);

  // 1. O dia. Nunca futuro; antes das 4h só com a confirmação da madrugada.
  const hoje = hojeEmBrasilia();
  if (!diaValido(pedido.dia)) throw new ErroDaEstrutura("dia_invalido", "Dia inválido.");
  if (pedido.dia > hoje) {
    throw new ErroDaEstrutura(
      "dia_futuro",
      "Não dá para enviar a estrutura de um dia que ainda não chegou.",
    );
  }
  if (pedido.dia === hoje && ehMadrugada() && !pedido.confirmacao.madrugada) {
    throw new ErroDaEstrutura("madrugada", "Confirme o envio antes das 4h da manhã.");
  }

  // 2. Um por vez.
  const trava = `${pedido.equipe.trim().toUpperCase()}|${pedido.dia}`;
  if (emEnvio.has(trava)) {
    throw new ErroDaEstrutura("envio_em_andamento", "Esta estrutura já está sendo enviada.");
  }
  emEnvio.add(trava);

  try {
    return await comToken(async (token) => {
      // 3. A equipe é sua? Sem cache: vale mesmo que o PWA também confira.
      const eq = await exigirEquipe(eu, token, pedido.equipe, { fresco: true });

      // 4. A lista fresca do PWA e o dia, de uma vez.
      const [pessoas, veiculos, linhas] = await Promise.all([
        pwa.pessoas(token, eq.equipe),
        pwa.veiculos(token, eq.equipe),
        pwa.linhasDoDia(token, eq.equipe, pedido.dia),
      ]);
      if (pessoas.length === 0 && veiculos.length === 0) {
        throw new ErroDaEstrutura(
          "dado_recusado",
          "A equipe não tem pessoas nem veículos para enviar.",
        );
      }

      // 5. Todos marcados, e só os que existem: os ids e prefixos têm de bater exatamente.
      const porId = new Map(pessoas.map((p) => [p.id, p]));
      const porPrefixo = new Map(veiculos.map((v) => [v.prefixo.trim().toUpperCase(), v]));
      const idsPedidos = pedido.pessoas.map((m) => m.id);
      const prefixosPedidos = pedido.veiculos.map((m) => m.prefixo.trim().toUpperCase());
      if (
        !mesmoConjunto(idsPedidos, [...porId.keys()]) ||
        !mesmoConjunto(prefixosPedidos, [...porPrefixo.keys()])
      ) {
        const e = new ErroDaEstrutura(
          "lista_mudou",
          "A lista da equipe mudou. Confira as marcas e envie de novo.",
        );
        e.pessoas = pessoasPublicas(pessoas);
        e.veiculos = veiculos.map(veiculoPublico);
        throw e;
      }

      // 6. Já enviado: só com a confirmação do reenvio. O PWA preserva o que o PCP, os
      // ajustes e os retroativos lançaram (Eduardo, 09/11/2026): a confirmação é simples.
      if (linhas.length > 0 && !pedido.confirmacao.reenvio) {
        throw new ErroDaEstrutura("ja_enviado", "Este dia já tem estrutura enviada.");
      }

      // 7. Retirada: os marcados NÃO ESTÁ NA EQUIPE têm de ser exatamente os que o popup
      // mostrou. Só o efetivo (id positivo) é movido: para id negativo o PWA responde
      // success e não faz nada. O veículo marcado também sai da equipe e volta para o projeto
      // (Eduardo, 10/11/2026): não fica repetindo na lista todo dia, e quem estiver com ele o puxa.
      const marcadosFora = pedido.pessoas.filter((m) => m.status === NAO_ESTA_NA_EQUIPE);
      const aRetirar = marcadosFora.filter((m) => m.id > 0).map((m) => m.id);
      const veiculosARetirar = pedido.veiculos
        .filter((m) => m.status === NAO_ESTA_NA_EQUIPE)
        .map((m) => m.prefixo.trim().toUpperCase());
      if (
        !mesmoConjunto(aRetirar, pedido.confirmacao.retirados) ||
        !mesmoConjunto(veiculosARetirar, pedido.confirmacao.retiradosVeiculos)
      ) {
        throw new ErroDaEstrutura(
          "retirada_mudou",
          "As retiradas da equipe mudaram. Confirme de novo.",
        );
      }

      // 8. O corpo, com o que o PWA devolveu (nunca o que veio do navegador).
      const entrada = {
        equipe: eq,
        hierarquia: hierarquiaDe(pessoas),
        dia: pedido.dia,
        loteId: novoLoteId(),
        pessoas: pedido.pessoas.map((m) => {
          const p = porId.get(m.id)!;
          return { nome: p.nome, cpf: p.externo ? "" : p.cpf, classe: p.classe, status: m.status };
        }),
        veiculos: pedido.veiculos.map((m) => {
          const v = porPrefixo.get(m.prefixo.trim().toUpperCase())!;
          return { prefixo: v.prefixo, placa: v.placa, classe: v.classe, status: m.status };
        }),
      };
      const externosFora = marcadosFora
        .filter((m) => m.id < 0)
        .map((m) => ({ nome: porId.get(m.id)!.nome, motivo: "externo" as const }));

      // 9. Envio desligado (ou no dev): simulação, nada vai ao PWA.
      if (!envioDeVerdade()) {
        return {
          simulado: true,
          pessoas: entrada.pessoas.length,
          veiculos: entrada.veiculos.length,
          preservados: null,
          retirados: [],
          naoRetirados: externosFora,
        };
      }

      // 10. O POST. Se o tempo esgotar ou o PWA responder 5xx, pode ter gravado: nunca repete
      // sozinho; a tela relê o dia, e o próximo envio pede a confirmação do reenvio se gravou.
      let resposta;
      try {
        resposta = await pwa.enviar(token, entrada);
      } catch (e) {
        if (e instanceof ErroDaEstrutura && e.motivo === "envio_incerto") {
          invalidar(eu, eq.equipe, pedido.dia);
        }
        throw e;
      }

      // 11. Só depois de um POST 2xx, as retiradas, uma por vez. A falha de uma não desfaz o envio.
      const retirados: string[] = [];
      const naoRetirados: ResultadoDoEnvio["naoRetirados"] = [...externosFora];
      for (const id of aRetirar) {
        const nome = porId.get(id)!.nome;
        try {
          await pwa.moverParaSemEquipe(token, id, atorDe(eq));
          retirados.push(nome);
        } catch {
          naoRetirados.push({ nome, motivo: "falha" });
        }
      }

      // Os veículos, do mesmo jeito: a falha de um não desfaz o envio nem os outros.
      let saiuVeiculo = false;
      for (const prefixo of veiculosARetirar) {
        const v = porPrefixo.get(prefixo)!;
        try {
          await pwa.moverVeiculoParaSemEquipe(token, v.id);
          retirados.push(v.prefixo);
          saiuVeiculo = true;
        } catch {
          naoRetirados.push({ nome: v.prefixo, motivo: "falha" });
        }
      }

      // 12. O que estava guardado ficou velho.
      invalidar(eu, eq.equipe, pedido.dia);
      if (retirados.length > 0) {
        esquecer(chavePessoas(eq.equipe)); // a lista da equipe: pessoas e veículos
        esquecer(chavePessoasSemEquipe); // quem saiu já pode ser puxado de volta
        if (saiuVeiculo) esquecer(chaveFrotaSemEquipe(eq.projeto));
      }

      return {
        simulado: false,
        pessoas: entrada.pessoas.length,
        veiculos: entrada.veiculos.length,
        preservados: resposta.preservados,
        retirados,
        naoRetirados,
      };
    });
  } finally {
    emEnvio.delete(trava);
  }
}

/* ------------------------- Puxar para a equipe ------------------------- */

/*
 * Adicionar é o espelho de retirar: a retirada manda a pessoa para SEM_EQUIPE, e aqui se puxa
 * quem está sem equipe para a equipe. O contrato é o que o Eduardo confirmou em 10/11/2026:
 *   • pessoas: `colaboradores/todas-equipes` traz TODO MUNDO, e sem equipe é a equipe vazia ou
 *     SEM_EQUIPE. O PWA não confere quem pode puxar quem (a regra está só no app, e ele vai travar
 *     no servidor depois); aqui vale a do líder comum do app: o MESMO coordenador da equipe, ou
 *     coordenador vazio. E só gente do escritório (classe ADM): gente de campo nunca aparece.
 *     PJ e estagiário nem vêm nessa lista: não são puxados nem retirados;
 *   • veículos: `frota?projeto=` traz a frota ativa do projeto da equipe, e sem equipe é a equipe
 *     vazia ou SEM_EQUIPE. A frota também não confere escopo: o alcance é o projeto da equipe.
 * Só quem está SEM EQUIPE entra por aqui: assim ninguém tira gente da equipe de outro líder, nem
 * com um pedido montado à mão. Os ids vêm da lista que o servidor mesmo montou, e são conferidos
 * de novo, sem cache, no momento de puxar.
 */

const chavePessoasSemEquipe = "estrutura:sem-equipe:pessoas";
const chaveFrotaSemEquipe = (projeto: string) => `estrutura:sem-equipe:frota:${projeto}`;
const chaveAlcance = (equipe: string) => `estrutura:alcance:${equipe}`;
const emMovimento = new Set<string>();

function exigirAdicao(): void {
  if (!ADICIONAR_NA_EQUIPE_LIGADO) {
    throw new ErroDaEstrutura("adicao_desligada", "Adicionar à equipe ainda não está liberado.");
  }
}

interface Alcance {
  coordenador: string;
  projeto: string;
}

/**
 * O coordenador e o projeto da equipe: o coordenador que mais aparece nas pessoas dela, e o projeto
 * de `minhas-equipes` (senão, o das pessoas). Só nomes e códigos, sem CPF: guardado 2 minutos.
 */
async function alcanceDaEquipe(token: string, eq: EquipePwa, fresco: boolean): Promise<Alcance> {
  const ler = async (): Promise<Alcance> => {
    const h = hierarquiaDe(await pwa.pessoas(token, eq.equipe));
    return { coordenador: h.coordenador, projeto: eq.projeto || h.projeto };
  };
  return fresco ? ler() : compartilhado(chaveAlcance(eq.equipe), 2 * MIN, ler);
}

/** A regra do líder comum do app: o mesmo coordenador da equipe, ou coordenador vazio. */
const naCoordenacao = (daPessoa: string, daEquipe: string): boolean =>
  !daPessoa.trim() || (daEquipe.trim() !== "" && semAcento(daPessoa) === semAcento(daEquipe));

/**
 * Quem o líder pode puxar: gente do ESCRITÓRIO (classe ADM) e da coordenação da equipe. A estrutura
 * do CONECTA é só das equipes administrativas da matriz, e gente de campo (COF, OPF, MEC…) nunca
 * aparece para elas (decisão do usuário, 10/11/2026), mesmo que divida o coordenador.
 */
const podePuxar = (c: ColaboradorPwa, alcance: Alcance): boolean =>
  semAcento(c.classe) === "ADM" && naCoordenacao(c.coordenador, alcance.coordenador);

/** Quem está sem equipe na empresa inteira (o filtro do alcance vem depois). Já sem CPF inteiro: guardado 1 minuto. */
async function pessoasSemEquipe(token: string, fresco: boolean): Promise<ColaboradorPwa[]> {
  const ler = async () =>
    (await pwa.todosOsColaboradores(token)).filter((c) => estaSemEquipe(c.equipe));
  return fresco ? ler() : compartilhado(chavePessoasSemEquipe, MIN, ler);
}

/** Os veículos sem equipe do projeto. Sem projeto, nenhum: não há alcance para conferir. */
async function frotaSemEquipe(
  token: string,
  projeto: string,
  fresco: boolean,
): Promise<VeiculoDoProjetoPwa[]> {
  if (!projeto) return [];
  const ler = async () =>
    (await pwa.frotaDoProjeto(token, projeto)).filter((v) => v.id > 0 && estaSemEquipe(v.equipe));
  return fresco ? ler() : compartilhado(chaveFrotaSemEquipe(projeto), MIN, ler);
}

const porNome = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });

const candidatoDePessoa = (c: ColaboradorPwa): CandidatoDePessoa => ({
  id: c.id,
  nome: c.nome,
  funcao: c.funcao,
  cpf: c.cpfMascarado,
});

const candidatoDeVeiculo = (v: VeiculoPwa): CandidatoDeVeiculo => ({
  id: v.id,
  prefixo: v.prefixo,
  placa: v.placa,
  modelo: v.modelo,
  tipo: v.tipo,
});

/** Quem está sem equipe e no alcance de `equipe`, pessoas OU veículos (só o que a janela pediu). */
export async function candidatosParaEquipe(
  eu: number,
  equipe: string,
  tipo: TipoDeCandidato,
): Promise<Candidatos> {
  await exigirAberta(eu);
  exigirAdicao();
  exigirQuePodeAlterar(eu, equipe);
  return comToken(async (token) => {
    const eq = await exigirEquipe(eu, token, equipe);
    const alcance = await alcanceDaEquipe(token, eq, false);
    const base = { pessoas: [], veiculos: [], alcance };
    if (tipo === "pessoas") {
      const livres = await pessoasSemEquipe(token, false);
      return {
        ...base,
        pessoas: livres
          .filter((c) => podePuxar(c, alcance))
          .map(candidatoDePessoa)
          .sort((a, b) => porNome(a.nome, b.nome)),
      };
    }
    const livres = await frotaSemEquipe(token, alcance.projeto, false);
    return {
      ...base,
      veiculos: livres.map(candidatoDeVeiculo).sort((a, b) => porNome(a.prefixo, b.prefixo)),
    };
  });
}

/**
 * Puxa para a equipe quem o líder escolheu. Tudo ou nada na CONFERÊNCIA (se alguém já não
 * está sem equipe, nada é movido e a tela refaz a lista); na hora de mover, a falha de um não
 * desfaz o que já entrou, e volta em `falhas`.
 */
export async function adicionar(eu: number, pedido: PedidoDeAdicao): Promise<ResultadoDaAdicao> {
  await exigirAberta(eu);
  exigirAdicao();
  exigirQuePodeAlterar(eu, pedido.equipe);
  if (pedido.pessoas.length + pedido.veiculos.length === 0) {
    throw new ErroDaEstrutura("dado_recusado", "Escolha quem entra na equipe.");
  }
  return comToken(async (token) => {
    const eq = await exigirEquipe(eu, token, pedido.equipe, { fresco: true });
    const alcance = await alcanceDaEquipe(token, eq, true);

    // O que está sem equipe e no alcance AGORA, sem cache: só entra quem está lá.
    const [pessoasLivres, veiculosLivres] = await Promise.all([
      pedido.pessoas.length > 0 ? pessoasSemEquipe(token, true) : [],
      pedido.veiculos.length > 0 ? frotaSemEquipe(token, alcance.projeto, true) : [],
    ]);
    const pessoas = new Map(
      pessoasLivres.filter((c) => podePuxar(c, alcance)).map((c) => [c.id, c]),
    );
    const veiculos = new Map(veiculosLivres.map((v) => [v.id, v]));
    if (
      pedido.pessoas.some((id) => !pessoas.has(id)) ||
      pedido.veiculos.some((id) => !veiculos.has(id))
    ) {
      esquecer(chavePessoasSemEquipe);
      esquecer(chaveFrotaSemEquipe(alcance.projeto));
      throw new ErroDaEstrutura(
        "candidato_indisponivel",
        "Alguém da lista já não está sem equipe (outra pessoa pode ter puxado antes).",
      );
    }

    // Um movimento por item: o segundo clique no mesmo item espera o primeiro.
    const chaves = [
      ...pedido.pessoas.map((id) => `p${id}`),
      ...pedido.veiculos.map((id) => `v${id}`),
    ];
    if (chaves.some((k) => emMovimento.has(k))) {
      throw new ErroDaEstrutura(
        "envio_em_andamento",
        "Esta pessoa ou veículo já está sendo movido.",
      );
    }
    chaves.forEach((k) => emMovimento.add(k));

    try {
      const resultado: ResultadoDaAdicao = {
        pessoas: [],
        veiculos: [],
        falhas: [],
      };
      const mover = async (nome: string, fazer: () => Promise<void>, ao: () => void) => {
        try {
          await fazer();
          ao();
        } catch (e) {
          // Sem acesso ao PWA ou sessão caída: não adianta tentar os outros.
          if (
            e instanceof ErroDaEstrutura &&
            (e.motivo === "acesso_negado" || e.motivo === "sem_sessao")
          )
            throw e;
          const recusado =
            e instanceof ErroDaEstrutura &&
            (e.motivo === "dado_recusado" || e.motivo === "sem_permissao");
          resultado.falhas.push({ nome, motivo: recusado ? "recusado" : "indisponivel" });
        }
      };
      for (const id of pedido.pessoas) {
        const p = pessoas.get(id)!;
        await mover(
          p.nome,
          () => pwa.adicionarPessoa(token, id, eq.equipe, atorDe(eq)),
          () => resultado.pessoas.push(p.nome),
        );
      }
      for (const id of pedido.veiculos) {
        const v = veiculos.get(id)!;
        await mover(
          v.prefixo,
          () => pwa.adicionarVeiculo(token, id, eq.equipe),
          () => resultado.veiculos.push(v.prefixo),
        );
      }
      // A lista da equipe e o depósito mudaram.
      esquecer(chavePessoas(eq.equipe));
      esquecer(chavePessoasSemEquipe);
      esquecer(chaveFrotaSemEquipe(alcance.projeto));
      return resultado;
    } finally {
      chaves.forEach((k) => emMovimento.delete(k));
    }
  });
}
