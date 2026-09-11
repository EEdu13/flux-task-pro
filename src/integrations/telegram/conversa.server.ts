// O que o bot faz. EXCLUSIVO do servidor.
//
// Regra que atravessa o arquivo inteiro: NENHUMA ação aceita um id de pessoa
// vindo da mensagem. Quem é a pessoa sai sempre de `pessoaPorTelegram`, que lê
// o vínculo gravado. Um `callback_data` é texto que o Telegram devolve como
// recebeu — e ele viaja pelo aparelho de quem apertou, então tratá-lo como
// prova de identidade seria o mesmo buraco de confiar no userId do cliente.
//
// O que o `callback_data` PODE carregar é o alvo (qual tarefa, qual pessoa da
// equipe). Aí a permissão é conferida de novo, no banco, a cada toque: ver
// `podeMexer`.

// `editarMensagem` saiu daqui: estava importado e nunca usado.
import { enviarMensagem, escaparMd, removerTeclado, responderCallback } from "./client.server";
import { desvincular, pessoaPorTelegram, vincularPorContato } from "./contas.server";
/* `hojeEmBrasilia` e `fimDoDiaBr` saíram: eram do prazo por botão em linha, que
   virou etapa de texto. Quem monta a data agora é o `lerPrazo`, que já entende
   "hoje" e "amanhã" — os dois atalhos que restaram, como botões de texto. */
import {
  atrasoEmDiasBr,
  criarTarefa,
  dataBr,
  diaBr,
  HOJE_BR,
  lerPrazo,
  possiveisResponsaveis,
  setoresComPessoas,
  type Prioridade,
} from "./tarefas.server";
import type { AtualizacaoClassificada, TecladoDeResposta, TecladoEmLinha } from "./types";

/** Endereço do sistema, para os links de "abrir no Fluxo". */
function urlDoApp(): string {
  return (process.env.APP_URL ?? "https://gestor-larsil.up.railway.app").replace(/\/+$/, "");
}

/* --------------------------- Consultas --------------------------- */

/* Campo `responsavel` removido: estava declarado, nenhum SELECT o trazia e nada
   o lia. Tipo que promete coluna inexistente é pior que tipo faltando — ele
   convida a usar `undefined` achando que é `null` do banco. Sem ele, o resumo
   do dia (`LinhaDoDia`) também passa a caber aqui sem conversão. */
interface TarefaResumo {
  id: string;
  titulo: string;
  prazo: Date;
  situacao: string;
  prioridade: string;
}

/**
 * O MESMO recorte de `listarTarefas`, reescrito aqui porque aquela é uma server
 * function presa à sessão da IAM — que no Telegram não existe.
 *
 * Reescrever regra de permissão em dois lugares é dívida, e está anotada como
 * tal: o dia em que o filtro do app mudar e este não, o bot mostra o que a tela
 * não mostra. O caminho de saída é extrair o filtro para um módulo que os dois
 * importam; não foi feito agora para não mexer na consulta que serve o app
 * inteiro no mesmo passo que estreia o bot.
 */
function filtroPorPapel(papel: string, setor: string | null): string {
  return papel === "gerente"
    ? "1=1"
    : setor
      ? "(setor=@setor OR responsavel_id=@eu OR criado_por=@eu)"
      : "(responsavel_id=@eu OR criado_por=@eu)";
}

async function perfilDe(pessoaId: number) {
  const { papelEsetor } = await import("@/lib/perfil.functions");
  return papelEsetor(pessoaId);
}

/**
 * Os três recortes das minhas tarefas.
 *
 * `onde` é literal NOSSO, nunca texto de mensagem — por isso pode ser
 * interpolado na consulta. Mesma regra do `filtroPorPapel` acima.
 *
 * O que a pessoa quer ver é o DIA, não o horário — e o dia é o de BRASÍLIA. A
 * comparação era `CAST(prazo AS date)` contra `CAST(SYSDATETIMEOFFSET() AS
 * date)`, os dois em UTC, e isso errava o dia inteiro: o prazo é gravado às
 * 23:59 de Brasília, que em UTC já é 02:59 do dia seguinte. Medido no cadastro
 * atual, no mesmo instante, "vence hoje" dava 3 tarefas pelo UTC e 12 pelo
 * horário de Brasília. Ver `dataBr` em `tarefas.server.ts`.
 */
type Recorte = "andamento" | "atrasadas" | "abertas";

const RECORTES: Record<Recorte, { titulo: string; vazio: string; onde: string }> = {
  andamento: {
    titulo: "*Em andamento*",
    vazio: "Nada em andamento agora\\.",
    onde: "situacao='andamento'",
  },
  atrasadas: {
    titulo: "*Atrasadas*",
    vazio: "Nada atrasado\\. 👏",
    onde: `situacao<>'concluida' AND ${dataBr("prazo")} < ${HOJE_BR}`,
  },
  abertas: {
    titulo: "*Em aberto*",
    vazio: "Nenhuma tarefa em aberto\\. 👏",
    onde: "situacao<>'concluida'",
  },
};

/** Minhas tarefas em um dos recortes acima. */
async function minhasTarefas(pessoaId: number, recorte: Recorte) {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("eu", sql.Int, pessoaId)
    .query(
      `SELECT TOP 20 id, titulo, prazo, situacao, prioridade
         FROM gestor.tarefas
        WHERE responsavel_id=@eu
          AND arquivada_em IS NULL
          AND ${RECORTES[recorte].onde}
        ORDER BY prazo, ordem`,
    );
  return r.recordset as TarefaResumo[];
}

/** Pessoas que eu posso acompanhar: o meu setor (gerência vê todos). */
async function pessoasDoMeuEscopo(pessoaId: number) {
  const { papel, setor } = await perfilDe(pessoaId);
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const req = pool.request().input("eu", sql.Int, pessoaId);
  let onde = "p.nome IS NOT NULL AND p.pessoa_id <> @eu";
  if (papel !== "gerente") {
    if (!setor) return [];
    req.input("setor", sql.NVarChar, setor);
    onde += " AND p.setor=@setor";
  }
  const r = await req.query(
    `SELECT TOP 30 p.pessoa_id, p.nome,
            (SELECT COUNT(*) FROM gestor.tarefas t
              WHERE t.responsavel_id=p.pessoa_id
                AND t.arquivada_em IS NULL
                AND t.situacao <> 'concluida') AS abertas
       FROM gestor.perfis p
      WHERE ${onde}
      ORDER BY p.nome`,
  );
  return r.recordset as { pessoa_id: number; nome: string; abertas: number }[];
}

/** Tarefas abertas de alguém — só se o solicitante puder enxergá-las. */
async function tarefasDe(solicitante: number, alvo: number) {
  const { papel, setor } = await perfilDe(solicitante);
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const filtro = filtroPorPapel(papel, setor);
  const req = pool.request().input("eu", sql.Int, solicitante).input("alvo", sql.Int, alvo);
  if (filtro.includes("@setor")) req.input("setor", sql.NVarChar, setor);
  const r = await req.query(
    `SELECT TOP 15 id, titulo, prazo, situacao, prioridade
       FROM gestor.tarefas
      WHERE responsavel_id=@alvo
        AND arquivada_em IS NULL
        AND situacao <> 'concluida'
        AND ${filtro}
      ORDER BY prazo, ordem`,
  );
  return r.recordset as TarefaResumo[];
}

/**
 * Esta pessoa pode mexer nesta tarefa?
 *
 * Conferido no banco a cada toque de botão, e não guardado de quando a lista
 * foi montada: entre ver a lista e apertar o botão pode ter passado meia hora,
 * e nesse meio a pessoa pode ter mudado de setor ou a tarefa de responsável.
 * O botão continua na tela do Telegram para sempre — a permissão, não.
 */
/* O id vem do botão, que viaja pelo aparelho de quem apertou — então ele é
   texto de fora, não um GUID só porque nós o escrevemos lá. Sem esta peneira,
   qualquer coisa que não converta para UNIQUEIDENTIFIER derruba a consulta, o
   erro morre no log e o botão fica rodando meio minuto na tela da pessoa. */
const EH_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function podeMexer(pessoaId: number, tarefaId: string): Promise<TarefaResumo | null> {
  if (!EH_GUID.test(tarefaId)) return null;
  const { papel, setor } = await perfilDe(pessoaId);
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const filtro = filtroPorPapel(papel, setor);
  const req = pool
    .request()
    .input("eu", sql.Int, pessoaId)
    .input("id", sql.UniqueIdentifier, tarefaId);
  if (filtro.includes("@setor")) req.input("setor", sql.NVarChar, setor);
  const r = await req.query(
    `SELECT TOP 1 id, titulo, prazo, situacao, prioridade
       FROM gestor.tarefas
      WHERE id=@id AND arquivada_em IS NULL AND ${filtro}`,
  );
  return (r.recordset[0] as TarefaResumo | undefined) ?? null;
}

async function trocarPrioridade(tarefaId: string, prioridade: string) {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.UniqueIdentifier, tarefaId)
    .input("p", sql.NVarChar, prioridade)
    .query(`UPDATE gestor.tarefas SET prioridade=@p WHERE id=@id`);
}

/* --------------------------- Apresentação --------------------------- */

const EMOJI_PRIORIDADE: Record<string, string> = { alta: "🔴", media: "🟡", baixa: "⚪" };
const NOME_PRIORIDADE: Record<string, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

/* `dia` e `atrasoEmDias` moraram aqui e liam o relógio do processo, que na
   Railway é UTC. Como o prazo é gravado às 02:59Z do dia seguinte, os dois
   erravam: a data saía um dia à frente e o atraso, um dia a menos. Mudaram para
   `tarefas.server.ts`, com fuso explícito. */
const dia = diaBr;
const atrasoEmDias = atrasoEmDiasBr;

function linhaDaTarefa(t: TarefaResumo): string {
  const atraso = atrasoEmDias(t.prazo);
  const marca = atraso > 0 ? ` \\| ⚠️ ${atraso}d de atraso` : "";
  return `${EMOJI_PRIORIDADE[t.prioridade] ?? "⚪"} *${escaparMd(t.titulo)}*\n   ${escaparMd(dia(t.prazo))}${marca}`;
}

const MENU: TecladoEmLinha = {
  inline_keyboard: [
    [
      { text: "▶️ Em andamento", callback_data: "m:and" },
      { text: "⚠️ Atrasadas", callback_data: "m:atras" },
    ],
    [
      { text: "📋 Em aberto", callback_data: "m:abertas" },
      { text: "👥 Equipe", callback_data: "m:equipe" },
    ],
    [{ text: "➕ Nova tarefa", callback_data: "m:nova" }],
  ],
};

/**
 * O teclado de quem JÁ escolheu: só o caminho de volta.
 *
 * Antes, toda resposta vinha com o MENU inteiro embaixo — inclusive as de lista
 * vazia. O efeito na conversa é uma pilha de menus idênticos, um por toque, e
 * some a noção de onde a pessoa está: não dá para distinguir "este menu é a
 * resposta ao que eu apertei" de "este é o menu do começo". Um botão de voltar
 * diz as duas coisas: acabou aqui, e o caminho é este.
 */
function voltarPara(destino: string, texto = "‹ Voltar"): TecladoEmLinha {
  return { inline_keyboard: [[{ text: texto, callback_data: destino }]] };
}

const VOLTAR_AO_MENU = voltarPara("m:menu", "‹ Voltar ao menu");

function textoMenu(nome: string): string {
  const primeiro = nome.split(" ")[0] ?? nome;
  return [
    `Olá, *${escaparMd(primeiro)}*\\.`,
    "",
    "O que você quer ver?",
    "",
    `_Comandos:_ /nova, /andamento, /atrasadas, /abertas, /equipe, /sair`,
  ].join("\n");
}

/**
 * Lista de tarefas com um botão por tarefa, para abrir os detalhes.
 *
 * `destinoVoltar` existe porque voltar nem sempre é o menu: da lista de alguém
 * da equipe, o passo atrás natural é a lista de pessoas, não o começo. Jogar
 * tudo no menu obrigaria a refazer Equipe › pessoa a cada tarefa conferida.
 */
function listaComBotoes(
  tarefas: TarefaResumo[],
  prefixo: string,
  destinoVoltar: string,
): TecladoEmLinha {
  return {
    inline_keyboard: [
      ...tarefas.slice(0, 8).map((t) => [
        {
          // Título encurtado: o botão tem largura de tela de celular, e
          // `callback_data` tem 64 BYTES no total — o id já come 36.
          text: `${EMOJI_PRIORIDADE[t.prioridade] ?? "⚪"} ${t.titulo.slice(0, 28)}`,
          callback_data: `${prefixo}${t.id}`,
        },
      ]),
      [{ text: "‹ Voltar", callback_data: destinoVoltar }],
    ],
  };
}

function tecladoDaTarefa(t: TarefaResumo): TecladoEmLinha {
  return {
    inline_keyboard: [
      [
        { text: `${t.prioridade === "alta" ? "•" : ""}🔴 Alta`, callback_data: `p:alta:${t.id}` },
        {
          text: `${t.prioridade === "media" ? "•" : ""}🟡 Média`,
          callback_data: `p:media:${t.id}`,
        },
        {
          text: `${t.prioridade === "baixa" ? "•" : ""}⚪ Baixa`,
          callback_data: `p:baixa:${t.id}`,
        },
      ],
      /* O detalhe não sabe de onde veio — o `callback_data` tem 64 bytes e o id
         da tarefa já ocupa 36, então guardar a origem ali sairia caro para o
         que economiza. Do detalhe, o menu é o destino honesto. */
      [{ text: "‹ Voltar ao menu", callback_data: "m:menu" }],
    ],
  };
}

function textoDaTarefa(t: TarefaResumo): string {
  const atraso = atrasoEmDias(t.prazo);
  return [
    `*${escaparMd(t.titulo)}*`,
    "",
    `Prazo: ${escaparMd(dia(t.prazo))}${atraso > 0 ? escaparMd(` (${atraso} dias de atraso)`) : ""}`,
    `Situação: ${escaparMd(t.situacao)}`,
    `Prioridade: ${EMOJI_PRIORIDADE[t.prioridade] ?? "⚪"} ${escaparMd(NOME_PRIORIDADE[t.prioridade] ?? t.prioridade)}`,
    "",
    "_Toque para mudar a prioridade:_",
  ].join("\n");
}

/* ----------------------- Nova tarefa ----------------------- */

/**
 * O rascunho de quem está criando uma tarefa, entre uma mensagem e a próxima.
 *
 * Vive NA MEMÓRIA do processo, e a escolha é deliberada. Um rascunho dura o
 * minuto que a pessoa leva para responder quatro perguntas; gravá-lo criaria uma
 * tabela cujo conteúdo é lixo dez minutos depois, e uma migração no banco de
 * produção para guardar coisa que ninguém quer de volta.
 *
 * O preço: um deploy no meio do preenchimento perde o rascunho, e a pessoa
 * recomeça. É a MESMA aposta que `jaProcessado` já faz com os update_id — este
 * projeto roda numa instância só. O dia em que rodar em duas, os dois pontos
 * precisam de banco juntos, e a nota fica aqui para esse dia.
 *
 * A chave é o id do Telegram de quem escreve, não o chat: a pessoa é a mesma no
 * privado e no grupo, e um rascunho por pessoa é o que evita duas conversas
 * paralelas escrevendo na mesma tarefa.
 */
/**
 * A ordem é RESPONSÁVEL primeiro, e isso é escolha, não acaso.
 *
 * Perguntar para quem só no fim obriga a pessoa a escrever título, descrição e
 * prazo sem saber de quem ela está falando — e um título que faz sentido para si
 * mesmo ("ver o retorno do fornecedor") raramente é o que se escreve para
 * outro. Decidido o dono, o resto sai no tom certo da primeira vez.
 */
type Etapa = "setor" | "responsavel" | "titulo" | "descricao" | "prazo" | "prioridade";

interface Rascunho {
  etapa: Etapa;
  chatId: number;
  /** Escolhido nas duas primeiras etapas; as seguintes já sabem de quem é. */
  responsavelId: number;
  responsavelNome: string;
  paraMim: boolean;
  titulo: string;
  descricao: string | null;
  prazo: Date | null;
  em: number;
}

const rascunhos = new Map<number, Rascunho>();

/** Meia hora. Rascunho esquecido não pode reaparecer no dia seguinte. */
const VALIDADE_RASCUNHO_MS = 30 * 60 * 1000;

function rascunhoDe(deId: number): Rascunho | null {
  const r = rascunhos.get(deId);
  if (!r) return null;
  if (Date.now() - r.em > VALIDADE_RASCUNHO_MS) {
    rascunhos.delete(deId);
    return null;
  }
  return r;
}

/**
 * Os teclados das etapas de TEXTO do /nova.
 *
 * São teclados de baixo (`TecladoDeResposta`), não botões em linha, e a troca
 * resolve a queixa de quem testou: com botão em linha, a pergunta do bot aparece
 * com um "Cancelar" embaixo e NADA indicando que a resposta é digitada — a
 * pessoa procura o botão que responde e não acha.
 *
 * O `input_field_placeholder` põe a dica dentro do campo de digitação, que é o
 * campo que estava faltando. E o "Cancelar" vem para cá porque uma mensagem tem
 * um `reply_markup` só: ou este teclado, ou o de linha.
 *
 * Os atalhos (Hoje, Amanhã, Pular) são botões de TEXTO: tocar manda o rótulo
 * como mensagem comum, então quem já lê "hoje" digitado lê o toque sem nenhum
 * tratamento novo. Foi o que permitiu apagar os callbacks `np:`.
 */
const CANCELAR_TEXTO = "✕ Cancelar";
const PULAR_TEXTO = "Pular";

/** Os dois botões que fecham a criação, oferecidos junto com a confirmação. */
const CRIAR_OUTRA_TEXTO = "➕ Criar nova";
const INICIO_TEXTO = "🏠 Início";

const PRIORIDADES: { rotulo: string; valor: Prioridade }[] = [
  { rotulo: "🔴 Alta", valor: "alta" },
  { rotulo: "🟡 Média", valor: "media" },
  { rotulo: "⚪ Baixa", valor: "baixa" },
];

/** Lê a prioridade do rótulo tocado ou do que a pessoa digitou. */
function lerPrioridade(texto: string): Prioridade | null {
  const t = texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (t.includes("alta")) return "alta";
  if (t.includes("media")) return "media";
  if (t.includes("baixa")) return "baixa";
  return null;
}

function tecladoDeEtapa(dica: string, atalhos: string[] = []): TecladoDeResposta {
  return {
    keyboard: [
      ...(atalhos.length > 0 ? [atalhos.map((text) => ({ text }))] : []),
      [{ text: CANCELAR_TEXTO }],
    ],
    resize_keyboard: true,
    input_field_placeholder: dica,
  };
}

async function comecarNova(deId: number, chatId: number, privado: boolean) {
  const conta = await pessoaPorTelegram(deId);
  if (!conta) return;

  rascunhos.set(deId, {
    etapa: "setor",
    chatId,
    responsavelId: conta.pessoaId,
    responsavelNome: "",
    paraMim: true,
    titulo: "",
    descricao: null,
    prazo: null,
    em: Date.now(),
  });

  /* Em grupo funciona, mas com uma pegadinha do Telegram que vale avisar: com o
     modo privacidade ligado (o padrão), o bot só recebe comandos e RESPOSTAS às
     mensagens dele. Texto solto não chega — foi o que fez a primeira tentativa
     do teste em grupo cair no vazio. Tocar nos botões já manda como resposta;
     digitar exige usar o Responder. */
  if (!privado) {
    await enviarMensagem(
      chatId,
      "Aqui no grupo, *responda* às minhas mensagens \\(toque em Responder\\) — senão o Telegram não me entrega o que você digitar\\.",
    );
  }

  await perguntarSetor(chatId, conta.pessoaId);
}

/** Nome bonito do setor. O id é o slug de `setorParaId`; o rótulo vem daqui. */
async function nomeDoSetor(id: string): Promise<string> {
  const { sectors } = await import("@/lib/fluxo-types");
  return sectors.find((s) => s.id === id)?.name ?? id;
}

/**
 * Primeira etapa: o setor de quem vai receber.
 *
 * "Para mim" fica em cima e pula o setor inteiro, porque é de longe o caso mais
 * comum — obrigar quem cria para si mesmo a achar o próprio setor primeiro seria
 * cobrar dois toques do caminho mais usado para melhorar o mais raro.
 */
async function perguntarSetor(chatId: number, eu: number) {
  const setores = await setoresComPessoas();
  const linhas = await Promise.all(
    setores.map(async (s) => [
      { text: `${await nomeDoSetor(s.setor)} (${s.pessoas})`, callback_data: `ns:${s.setor}` },
    ]),
  );
  await enviarMensagem(chatId, "*Nova tarefa*\n\nPara quem é\\?", {
    teclado: {
      inline_keyboard: [
        [{ text: "🙋 Para mim", callback_data: `nv:${eu}` }],
        ...linhas,
        [{ text: CANCELAR_TEXTO, callback_data: "nx" }],
      ],
    },
  });
}

/**
 * Segunda etapa: a pessoa, dentro do setor escolhido.
 *
 * O "‹ Outro setor" no fim existe para o toque errado, que num teclado de
 * celular acontece o tempo todo. Sem ele a saída seria cancelar e recomeçar — e
 * quem tocou no setor errado ainda não escreveu nada, então não há o que
 * preservar, mas há a irritação de refazer.
 */
async function perguntarPessoaDoSetor(chatId: number, setor: string) {
  const pessoas = (await possiveisResponsaveis()).filter(
    (p) => (p.setor?.trim() || "sem-setor") === setor,
  );
  await enviarMensagem(chatId, `Setor: *${escaparMd(await nomeDoSetor(setor))}*\n\nQuem\\?`, {
    teclado: {
      inline_keyboard: [
        ...pessoas
          .slice(0, 20)
          .map((p) => [
            { text: p.nome.split(" ").slice(0, 3).join(" "), callback_data: `nv:${p.pessoa_id}` },
          ]),
        [{ text: "‹ Outro setor", callback_data: "ns:volta" }],
        [{ text: CANCELAR_TEXTO, callback_data: "nx" }],
      ],
    },
  });
}

/**
 * Fecha a escolha do responsável e abre a etapa do título.
 *
 * O alvo veio de um botão, que viaja pelo aparelho de quem apertou — então é
 * palpite até prova em contrário. A lista de quem esta pessoa pode escolher é
 * recalculada AQUI, e recalculada DE NOVO na hora de gravar: entre escolher o
 * nome e terminar de escrever podem passar minutos, e nesse meio a pessoa pode
 * ter mudado de setor.
 */
async function escolherResponsavel(deId: number, chatId: number, alvoId: number): Promise<boolean> {
  const r = rascunhoDe(deId);
  // "setor" também aceita, porque o "Para mim" pula a escolha de setor.
  if (!r || (r.etapa !== "setor" && r.etapa !== "responsavel")) return false;

  const conta = await pessoaPorTelegram(deId);
  if (!conta) return false;
  const alvo = (await possiveisResponsaveis()).find((p) => p.pessoa_id === alvoId);
  if (!alvo) return false;

  r.responsavelId = alvoId;
  r.responsavelNome = alvo.nome;
  r.paraMim = alvoId === conta.pessoaId;
  r.etapa = "titulo";
  r.em = Date.now();

  await enviarMensagem(chatId, `${cabecalhoDe(r)}\n\nQual é o título\\?`, {
    teclado: tecladoDeEtapa("Título da tarefa"),
  });
  return true;
}

/** O "Para: Fulano" que encabeça as etapas seguintes, lembrando de quem é. */
function cabecalhoDe(r: Rascunho): string {
  return `Para: *${escaparMd(r.paraMim ? "você" : r.responsavelNome)}*`;
}

/** Cada resposta de texto avança uma etapa. Devolve false se não havia rascunho. */
async function avancarNova(deId: number, chatId: number, texto: string): Promise<boolean> {
  const r = rascunhoDe(deId);
  if (!r) return false;
  r.em = Date.now();

  /* Os atalhos chegam como texto comum, porque é isso que um botão do teclado
     de baixo manda. Reconhecê-los aqui é o que dispensa um callback para cada
     um — e faz o botão Cancelar valer em qualquer etapa, sem repetição. */
  if (texto.trim() === CANCELAR_TEXTO) {
    rascunhos.delete(deId);
    await removerTeclado(chatId, "Criação cancelada\\.");
    return true;
  }

  if (r.etapa === "setor" || r.etapa === "responsavel") {
    // As duas primeiras etapas são só botão em linha — texto não avança nada.
    await enviarMensagem(chatId, "Escolha nos botões acima para quem é a tarefa\\.");
    return true;
  }

  if (r.etapa === "titulo") {
    const titulo = texto.trim().slice(0, 200);
    if (!titulo) {
      await enviarMensagem(chatId, "O título não pode ser vazio\\. Como se chama a tarefa\\?", {
        teclado: tecladoDeEtapa("Título da tarefa"),
      });
      return true;
    }
    r.titulo = titulo;
    r.etapa = "descricao";
    await enviarMensagem(
      chatId,
      `${cabecalhoDe(r)}\n*${escaparMd(titulo)}*\n\nAlguma descrição\\?`,
      { teclado: tecladoDeEtapa("Descrição (opcional)", [PULAR_TEXTO]) },
    );
    return true;
  }

  if (r.etapa === "descricao") {
    const t = texto.trim();
    r.descricao = t === PULAR_TEXTO ? null : t.slice(0, 2000) || null;
    r.etapa = "prazo";
    await perguntarPrazo(chatId);
    return true;
  }

  if (r.etapa === "prazo") {
    const prazo = lerPrazo(texto);
    if (!prazo) {
      await enviarMensagem(
        chatId,
        "Não entendi a data\\. Tente `hoje`, `amanhã`, `20/09` ou `20/09/2026`\\.",
        { teclado: tecladoDeEtapa("hoje, amanhã ou 20/09", ["Hoje", "Amanhã"]) },
      );
      return true;
    }
    r.prazo = prazo;
    r.etapa = "prioridade";
    await enviarMensagem(chatId, `Prazo: *${escaparMd(diaBr(prazo))}*\n\nQual a prioridade\\?`, {
      teclado: tecladoDeEtapa(
        "toque na prioridade",
        PRIORIDADES.map((p) => p.rotulo),
      ),
    });
    return true;
  }

  // Prioridade é a última etapa: entendida, a tarefa nasce.
  const prioridade = lerPrioridade(texto);
  if (!prioridade) {
    await enviarMensagem(chatId, "Toque em Alta, Média ou Baixa\\.", {
      teclado: tecladoDeEtapa(
        "toque na prioridade",
        PRIORIDADES.map((p) => p.rotulo),
      ),
    });
    return true;
  }
  await concluirNova(deId, chatId, prioridade);
  return true;
}

/* Esta mensagem era `_Aceito_ \`hoje\`_,_ ... _._` e derrubava o fluxo inteiro:
   o ponto dentro do último `_._` é reservado no MarkdownV2 e estava sem escape,
   então o Telegram RECUSAVA a mensagem. Como o erro morria no `try` do `tratar`,
   o que a pessoa via era o bot emudecer no meio da criação.

   Reescrita sem itálico picotado. Formatação que só enfeita não vale um ponto de
   falha — e a lista de exemplos já estava em `code`, que é o que ajuda a ler. */
async function perguntarPrazo(chatId: number) {
  await enviarMensagem(
    chatId,
    "Para quando\\?\n\nAceito `hoje`, `amanhã`, `20/09` ou `20/09/2026`",
    {
      teclado: tecladoDeEtapa("hoje, amanhã ou 20/09", ["Hoje", "Amanhã"]),
    },
  );
}

/** Última etapa: grava a tarefa e avisa quem recebeu. */
async function concluirNova(deId: number, chatId: number, prioridade: Prioridade): Promise<void> {
  const r = rascunhoDe(deId);
  if (!r || !r.titulo || !r.prazo) return;
  const prazo = r.prazo;

  const conta = await pessoaPorTelegram(deId);
  if (!conta) return;

  /* A pessoa é reconferida AGORA, e não só quando o nome foi escolhido. Entre
     um momento e outro ela escreveu título, descrição, prazo e prioridade — e
     nesse meio o alvo pode ter saído do sistema. */
  const alvo = (await possiveisResponsaveis()).find((p) => p.pessoa_id === r.responsavelId);
  if (!alvo) {
    rascunhos.delete(deId);
    await removerTeclado(
      chatId,
      "Essa pessoa não está mais disponível\\. Mande /nova para recomeçar\\.",
    );
    return;
  }

  await criarTarefa({
    titulo: r.titulo,
    descricao: r.descricao,
    prazo,
    prioridade,
    responsavelId: r.responsavelId,
    criadoPor: conta.pessoaId,
  });
  const { titulo, paraMim, responsavelId } = r;
  rascunhos.delete(deId);

  /* Os dois botões do fim vêm no teclado de baixo, e não em linha, por um
     motivo que só aparece na prática: as etapas de texto deixaram um teclado
     aberto ocupando a tela, e ele não sai sozinho. Uma mensagem carrega um
     `reply_markup` só — então ou eu removo o teclado e fico sem botões, ou
     SUBSTITUO o teclado por estes dois. Substituir resolve as duas coisas numa
     mensagem só. Eles chegam como texto, tratados em `aoReceberTexto`. */
  await enviarMensagem(
    chatId,
    [
      "✅ *Tarefa criada*",
      "",
      `*${escaparMd(titulo)}*`,
      `Prazo: ${escaparMd(diaBr(prazo))}`,
      `Prioridade: ${escaparMd(PRIORIDADES.find((p) => p.valor === prioridade)?.rotulo ?? prioridade)}`,
      `Responsável: ${escaparMd(paraMim ? "você" : alvo.nome)}`,
    ].join("\n"),
    {
      teclado: {
        keyboard: [[{ text: CRIAR_OUTRA_TEXTO }], [{ text: INICIO_TEXTO }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    },
  );

  /* Quem recebeu fica sabendo pelo Telegram, se tiver vínculo. É o primeiro
     uso de `avisarPessoa`, que existia sem ninguém chamar. Silencioso quando
     não há vínculo: quem não conectou não vira erro de quem criou. */
  if (!paraMim) {
    void avisarPessoa(responsavelId, "Nova tarefa para você", `${titulo}\nPrazo: ${diaBr(prazo)}`);
  }
}

/* --------------------------- Despacho --------------------------- */

const PEDIR_CONTATO = {
  keyboard: [[{ text: "📱 Confirmar quem eu sou", request_contact: true as const }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

const CONVITE = [
  "Este é o bot do *SGL \\- CONECTA*\\.",
  "",
  "Para eu saber quem é você, toque no botão abaixo\\. O Telegram me envia o seu telefone e eu procuro no sistema — nada é digitado, e eu não vejo a sua agenda\\.",
].join("\n");

/**
 * A recusa de identificar alguém fora do privado.
 *
 * O vínculo se faz com o botão "compartilhar contato", que é teclado de
 * resposta — num grupo ele aparece para todo mundo, e quem tocar manda o
 * próprio telefone com o grupo inteiro olhando. Não é o tipo de coisa que se
 * resolve avisando: some o botão.
 *
 * Esta trava vale MESMO com `TELEGRAM_PERMITIR_GRUPOS` ligado. O que aquela
 * variável libera é o bot responder em grupo a quem já é conhecido; ela não
 * libera transformar um grupo em balcão de cadastro.
 */
const SO_NO_PRIVADO = [
  "Não te reconheço ainda, e isso não dá para resolver aqui no grupo\\.",
  "",
  "Abra uma conversa comigo no privado e mande /start — a identificação pede o seu telefone, e ele não deve passar por um grupo\\.",
].join("\n");

/**
 * Ponto único de entrada. Nunca lança: quem chama devolve 200 de qualquer
 * jeito (o Telegram reenvia o que não recebe 200, e reenvio vira ação
 * duplicada), então o erro morre aqui, no log.
 */
export async function tratar(a: AtualizacaoClassificada): Promise<void> {
  try {
    switch (a.tipo) {
      case "contato":
        return await aoReceberContato(a.deId, a.chatId, a.privado, a.contato);
      case "comando":
        return await aoReceberComando(a.deId, a.chatId, a.privado, a.comando);
      case "callback":
        return await aoReceberBotao(a.deId, a.chatId, a.callbackId, a.data);
      case "texto":
        return await aoReceberTexto(a.deId, a.chatId, a.privado, a.texto);
      case "ignorada":
        return;
    }
  } catch (e) {
    console.error("[telegram] falha ao tratar:", (e as Error)?.message);
    /* O erro não pode virar SILÊNCIO, e essa lição custou caro: um ponto sem
       escape na pergunta do prazo fazia o Telegram recusar a mensagem, o erro
       morria nesta linha e o bot simplesmente parava de responder no meio da
       criação. Quem estava do outro lado não tinha como distinguir isso de "o
       bot ignorou o que eu escrevi".

       A mensagem de socorro não leva NADA variável: se o que quebrou foi a
       formatação de um texto nosso, repetir o mesmo tipo de texto quebraria de
       novo. E ela própria pode falhar (chat bloqueado, Telegram fora) — daí o
       `catch` vazio, que aqui é o fim da linha de verdade. */
    const chatId = "chatId" in a ? a.chatId : null;
    if (chatId !== null) {
      try {
        await enviarMensagem(
          chatId,
          "Algo falhou aqui do meu lado\\. Mande /start para recomeçar\\.",
        );
      } catch {
        /* sem mais o que fazer */
      }
    }
  }
}

async function aoReceberContato(
  deId: number,
  chatId: number,
  privado: boolean,
  contato: Parameters<typeof vincularPorContato>[2],
) {
  /* Contato compartilhado em grupo não vincula, mesmo com grupos liberados.
     Além do telefone ficar à vista, o `chat_id` gravado seria o do GRUPO — e é
     nele que `avisarPessoa` mandaria, depois, todo aviso pessoal do sistema. */
  if (!privado) {
    await enviarMensagem(chatId, SO_NO_PRIVADO);
    return;
  }
  const r = await vincularPorContato(deId, chatId, contato);
  if (!r.ok) {
    const recado =
      r.motivo === "contato_de_terceiro"
        ? "Esse contato é de outra pessoa\\. Toque no botão para enviar o *seu* — não encaminhe o cartão de ninguém\\."
        : r.motivo === "sem_conta_telegram"
          ? "Esse contato não tem conta no Telegram, então não dá para confirmar que é você\\."
          : "Não encontrei esse telefone no sistema\\. Confira o número cadastrado em *Configurações › Contato* e tente de novo\\.";
    await enviarMensagem(chatId, recado, { teclado: PEDIR_CONTATO });
    return;
  }
  await removerTeclado(
    chatId,
    r.jaEra
      ? `Pronto, *${escaparMd(r.nome.split(" ")[0] ?? r.nome)}* — vínculo atualizado para esta conta\\.`
      : `Encontrei você, *${escaparMd(r.nome.split(" ")[0] ?? r.nome)}*\\.`,
  );
  await enviarMensagem(chatId, textoMenu(r.nome), { teclado: MENU });
}

async function aoReceberComando(deId: number, chatId: number, privado: boolean, comando: string) {
  const conta = await pessoaPorTelegram(deId);

  if (comando === "/sair") {
    const tinha = await desvincular(deId);
    await enviarMensagem(
      chatId,
      tinha
        ? "Vínculo desfeito\\. Não vou mais te mandar nada por aqui\\. Para voltar, mande /start\\."
        : "Esta conta já não estava vinculada\\.",
    );
    return;
  }

  if (!conta) {
    await enviarMensagem(chatId, privado ? CONVITE : SO_NO_PRIVADO, {
      // O teclado de contato só no privado — ver `SO_NO_PRIVADO`.
      teclado: privado ? PEDIR_CONTATO : undefined,
    });
    return;
  }

  /* Os comandos do rascunho vêm ANTES do resto: `/pular` e `/cancelar` só
     querem dizer algo no meio de uma criação, e fora dela caem no menu como
     qualquer comando desconhecido. */
  if (comando === "/nova" || comando === "/nova_tarefa") {
    return await comecarNova(deId, chatId, privado);
  }
  if (comando === "/cancelar") {
    const tinha = rascunhos.delete(deId);
    await enviarMensagem(
      chatId,
      tinha ? "Criação cancelada\\." : "Não havia nada em andamento\\.",
      { teclado: VOLTAR_AO_MENU },
    );
    return;
  }
  if (comando === "/pular") {
    const r = rascunhoDe(deId);
    if (r?.etapa === "descricao") {
      r.descricao = null;
      r.etapa = "prazo";
      r.em = Date.now();
      return await perguntarPrazo(chatId);
    }
    await enviarMensagem(chatId, "Não há nada para pular agora\\.", { teclado: VOLTAR_AO_MENU });
    return;
  }

  switch (comando) {
    case "/andamento":
      return await mandarMinhas(conta.pessoaId, chatId, "andamento");
    case "/atrasadas":
      return await mandarMinhas(conta.pessoaId, chatId, "atrasadas");
    case "/abertas":
    case "/tarefas":
      return await mandarMinhas(conta.pessoaId, chatId, "abertas");
    case "/equipe":
      return await mandarEquipe(conta.pessoaId, chatId);
    default: {
      const { nome } = await nomeDe(conta.pessoaId);
      await enviarMensagem(chatId, textoMenu(nome), { teclado: MENU });
    }
  }
}

/**
 * Texto solto.
 *
 * Com uma criação em andamento, ele É a resposta da etapa — essa checagem vem
 * primeiro, senão o título da tarefa seria respondido com o menu. Fora disso,
 * texto ainda não vira tarefa sozinho, e o menu é melhor que silêncio.
 */
async function aoReceberTexto(deId: number, chatId: number, privado: boolean, texto: string) {
  const conta = await pessoaPorTelegram(deId);
  if (!conta) {
    await enviarMensagem(chatId, privado ? CONVITE : SO_NO_PRIVADO, {
      teclado: privado ? PEDIR_CONTATO : undefined,
    });
    return;
  }
  /* Os dois botões oferecidos junto com a confirmação. Vêm ANTES do rascunho
     porque naquele momento não existe rascunho nenhum — a tarefa já nasceu. */
  const t = texto.trim();
  if (t === CRIAR_OUTRA_TEXTO) return await comecarNova(deId, chatId, privado);
  if (t === INICIO_TEXTO) {
    const { nome } = await nomeDe(conta.pessoaId);
    await removerTeclado(chatId, textoMenu(nome));
    await enviarMensagem(chatId, "O que você quer ver\\?", { teclado: MENU });
    return;
  }

  if (await avancarNova(deId, chatId, texto)) return;
  const { nome } = await nomeDe(conta.pessoaId);
  await enviarMensagem(chatId, textoMenu(nome), { teclado: MENU });
}

async function nomeDe(pessoaId: number): Promise<{ nome: string }> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("p", sql.Int, pessoaId)
    .query(`SELECT nome FROM gestor.perfis WHERE pessoa_id=@p`);
  return { nome: (r.recordset[0] as { nome: string } | undefined)?.nome ?? "" };
}

async function mandarMinhas(pessoaId: number, chatId: number, recorte: Recorte) {
  const { titulo, vazio } = RECORTES[recorte];
  const lista = await minhasTarefas(pessoaId, recorte);
  if (lista.length === 0) {
    await enviarMensagem(chatId, vazio, { teclado: VOLTAR_AO_MENU });
    return;
  }
  const corpo = lista.map(linhaDaTarefa).join("\n\n");
  await enviarMensagem(chatId, `${titulo}\n\n${corpo}`, {
    teclado: listaComBotoes(lista, "t:", "m:menu"),
  });
}

async function mandarEquipe(pessoaId: number, chatId: number) {
  const pessoas = await pessoasDoMeuEscopo(pessoaId);
  if (pessoas.length === 0) {
    await enviarMensagem(chatId, "Não há mais ninguém no seu setor para acompanhar por aqui\\.", {
      teclado: VOLTAR_AO_MENU,
    });
    return;
  }
  await enviarMensagem(chatId, "*Equipe* — escolha quem você quer ver:", {
    teclado: {
      inline_keyboard: [
        ...pessoas.slice(0, 12).map((p) => [
          {
            text: `${p.nome.split(" ").slice(0, 2).join(" ")} (${p.abertas})`,
            callback_data: `e:${p.pessoa_id}`,
          },
        ]),
        [{ text: "‹ Voltar ao menu", callback_data: "m:menu" }],
      ],
    },
  });
}

async function aoReceberBotao(
  deId: number,
  chatId: number | null,
  callbackId: string,
  data: string,
): Promise<void> {
  const conta = await pessoaPorTelegram(deId);
  if (!conta || chatId === null) {
    // Sem vínculo ou sem chat não há o que responder de útil — mas o toque
    // precisa ser reconhecido, senão o botão fica girando por 30 segundos.
    await responderCallback(callbackId, "Mande /start para começar.");
    return;
  }

  if (data === "m:menu") {
    const { nome } = await nomeDe(conta.pessoaId);
    await responderCallback(callbackId);
    await enviarMensagem(chatId, textoMenu(nome), { teclado: MENU });
    return;
  }
  const RECORTE_DO_BOTAO: Record<string, Recorte> = {
    "m:and": "andamento",
    "m:atras": "atrasadas",
    "m:abertas": "abertas",
  };
  const recorte = RECORTE_DO_BOTAO[data];
  if (recorte) {
    await responderCallback(callbackId);
    await mandarMinhas(conta.pessoaId, chatId, recorte);
    return;
  }
  if (data === "m:equipe") {
    await responderCallback(callbackId);
    await mandarEquipe(conta.pessoaId, chatId);
    return;
  }

  /* ---- Criação de tarefa ---- */

  if (data === "m:nova") {
    await responderCallback(callbackId);
    /* O botão só existe em mensagem que o bot mandou, e no grupo isso também
       acontece — daí a checagem de privado continuar valendo aqui. */
    await comecarNova(deId, chatId, true);
    return;
  }
  if (data === "nx") {
    rascunhos.delete(deId);
    await responderCallback(callbackId, "Cancelado.");
    await enviarMensagem(chatId, "Criação cancelada\\.", { teclado: VOLTAR_AO_MENU });
    return;
  }
  /* `np:` era o prazo por botão em linha, antes de o prazo virar etapa de texto
     com teclado de baixo. Não é mais produzido, e o tratamento fica só porque
     botão em linha NÃO EXPIRA: as mensagens já enviadas seguem no histórico da
     pessoa para sempre, e um toque sem tratamento deixa o relógio girando meio
     minuto na tela dela. Responder "não está mais aberta" é o fim honesto. */
  if (data === "np:hoje" || data === "np:amanha") {
    await responderCallback(callbackId, "Esta criação não está mais aberta.", true);
    return;
  }

  /* ns:<setor> — escolha do setor; ns:volta — recomeça a escolha.
     O "volta" existe porque num teclado de celular o toque errado é rotina, e
     sem ele a saída seria cancelar e refazer. */
  if (data.startsWith("ns:")) {
    const r = rascunhoDe(deId);
    if (!r || (r.etapa !== "setor" && r.etapa !== "responsavel")) {
      await responderCallback(callbackId, "Esta criação não está mais aberta.", true);
      return;
    }
    const alvo = data.slice(3);
    r.em = Date.now();
    await responderCallback(callbackId);
    if (alvo === "volta") {
      r.etapa = "setor";
      await perguntarSetor(chatId, conta.pessoaId);
      return;
    }
    r.etapa = "responsavel";
    await perguntarPessoaDoSetor(chatId, alvo);
    return;
  }

  // nv:<pessoaId> — a pessoa escolhida, direto ("Para mim") ou via setor.
  if (data.startsWith("nv:")) {
    const alvo = Number(data.slice(3));
    if (!Number.isInteger(alvo)) {
      await responderCallback(callbackId, "Pedido inválido.");
      return;
    }
    if (await escolherResponsavel(deId, chatId, alvo)) {
      await responderCallback(callbackId);
      return;
    }
    /* Rascunho expirado, perdido num deploy, ou alvo fora do alcance de quem
       apertou. Os três terminam igual para quem está olhando: não deu, e o
       caminho é recomeçar. */
    await responderCallback(callbackId, "Esta criação não está mais aberta.", true);
    await enviarMensagem(chatId, "A criação expirou\\. Mande /nova para recomeçar\\.", {
      teclado: VOLTAR_AO_MENU,
    });
    return;
  }

  // e:<pessoaId> — tarefas de alguém da equipe
  if (data.startsWith("e:")) {
    const alvo = Number(data.slice(2));
    if (!Number.isInteger(alvo)) {
      await responderCallback(callbackId, "Pedido inválido.");
      return;
    }
    /* O alvo veio do botão, então é palpite até prova em contrário: só entra
       quem está na lista que ESTA pessoa pode ver, recalculada agora. */
    const permitidos = await pessoasDoMeuEscopo(conta.pessoaId);
    if (!permitidos.some((p) => p.pessoa_id === alvo)) {
      await responderCallback(callbackId, "Você não acompanha essa pessoa.", true);
      return;
    }
    const lista = await tarefasDe(conta.pessoaId, alvo);
    await responderCallback(callbackId);
    const nome = permitidos.find((p) => p.pessoa_id === alvo)?.nome ?? "";
    if (lista.length === 0) {
      await enviarMensagem(chatId, `*${escaparMd(nome)}* não tem tarefas abertas\\.`, {
        // Volta para a lista de pessoas: quem está conferindo a equipe quer o
        // próximo nome, não recomeçar do menu.
        teclado: voltarPara("m:equipe", "‹ Voltar à equipe"),
      });
      return;
    }
    await enviarMensagem(
      chatId,
      `*${escaparMd(nome)}*\n\n${lista.map(linhaDaTarefa).join("\n\n")}`,
      { teclado: listaComBotoes(lista, "t:", "m:equipe") },
    );
    return;
  }

  // t:<tarefaId> — detalhe
  if (data.startsWith("t:")) {
    const id = data.slice(2);
    const t = await podeMexer(conta.pessoaId, id);
    if (!t) {
      await responderCallback(callbackId, "Essa tarefa não está mais disponível para você.", true);
      return;
    }
    await responderCallback(callbackId);
    await enviarMensagem(chatId, textoDaTarefa(t), { teclado: tecladoDaTarefa(t) });
    return;
  }

  // p:<prioridade>:<tarefaId> — troca a prioridade
  if (data.startsWith("p:")) {
    const [, prioridade, ...resto] = data.split(":");
    const id = resto.join(":");
    if (!prioridade || !NOME_PRIORIDADE[prioridade]) {
      await responderCallback(callbackId, "Prioridade inválida.");
      return;
    }
    const t = await podeMexer(conta.pessoaId, id);
    if (!t) {
      await responderCallback(callbackId, "Você não pode alterar essa tarefa.", true);
      return;
    }
    if (t.prioridade === prioridade) {
      await responderCallback(callbackId, `Já estava em ${NOME_PRIORIDADE[prioridade]}.`);
      return;
    }
    await trocarPrioridade(id, prioridade);
    await responderCallback(callbackId, `Prioridade: ${NOME_PRIORIDADE[prioridade]}`);
    const atualizada = { ...t, prioridade };
    await enviarMensagem(chatId, textoDaTarefa(atualizada), {
      teclado: tecladoDaTarefa(atualizada),
      silencioso: true,
    });
    return;
  }

  await responderCallback(callbackId);
}

/* -------------------- Resumo das 7h -------------------- */

/**
 * Manda para cada pessoa vinculada o dia dela: o que vence hoje e o que ficou
 * para trás. Chamado pela rota `/api/public/telegram-diario`, uma vez por dia.
 *
 * Quem não tem nada NÃO recebe nada. Um "bom dia, você não tem tarefas" toda
 * manhã é a forma mais rápida de ensinar as pessoas a ignorar o bot — e no dia
 * em que houver algo, a mensagem já terá virado ruído que ninguém abre.
 *
 * Uma falha de envio não derruba as outras: cada pessoa é uma tentativa
 * isolada. O contrário faria o primeiro chat bloqueado cancelar o resumo de
 * todo mundo que vinha depois na lista.
 */
export async function enviarResumoDoDia(): Promise<{
  enviados: number;
  pulados: number;
  falhas: number;
}> {
  const { pessoasComTelegram, tarefasDoDia } = await import("./tarefas.server");
  const pessoas = await pessoasComTelegram();

  let enviados = 0;
  let pulados = 0;
  let falhas = 0;

  for (const p of pessoas) {
    try {
      const lista = await tarefasDoDia(p.pessoaId);
      if (lista.length === 0) {
        pulados += 1;
        continue;
      }

      const atrasadas = lista.filter((t) => t.atraso > 0);
      const deHoje = lista.filter((t) => t.atraso <= 0);

      const partes = [`☀️ *Bom dia, ${escaparMd(p.nome.split(" ")[0] ?? p.nome)}*`, ""];
      if (deHoje.length > 0) {
        partes.push(`*Para hoje \\(${deHoje.length}\\)*`, "");
        partes.push(deHoje.map(linhaDaTarefa).join("\n\n"));
      }
      if (atrasadas.length > 0) {
        if (deHoje.length > 0) partes.push("");
        partes.push(`*Atrasadas \\(${atrasadas.length}\\)*`, "");
        partes.push(atrasadas.map(linhaDaTarefa).join("\n\n"));
      }

      await enviarMensagem(p.chatId, partes.join("\n"), {
        teclado: listaComBotoes(lista, "t:", "m:menu"),
      });
      enviados += 1;
    } catch (e) {
      falhas += 1;
      // Sem o conteúdo da mensagem no log: o resumo é a agenda da pessoa.
      console.warn(`[telegram-diario] falhou para pessoa ${p.pessoaId}:`, (e as Error)?.message);
    }
  }

  return { enviados, pulados, falhas };
}

/* -------------------- Aviso empurrado pelo sistema -------------------- */

/**
 * Manda um aviso para uma pessoa, se ela tiver Telegram vinculado.
 *
 * Silencioso quando não há vínculo: quem não conectou o Telegram não deve virar
 * erro no fluxo de quem criou a tarefa. O retorno diz se foi, para quem quiser
 * registrar.
 */
export async function avisarPessoa(
  pessoaId: number,
  titulo: string,
  corpo: string,
): Promise<boolean> {
  try {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("p", sql.Int, pessoaId)
      .query(`SELECT chat_id FROM gestor.telegram_contas WHERE pessoa_id=@p`);
    const linha = r.recordset[0] as { chat_id: string | number } | undefined;
    if (!linha) return false;
    await enviarMensagem(
      Number(linha.chat_id),
      `*${escaparMd(titulo)}*\n\n${escaparMd(corpo)}\n\n[Abrir no sistema](${urlDoApp()})`,
    );
    return true;
  } catch (e) {
    console.warn("[telegram] aviso não enviado:", (e as Error)?.message);
    return false;
  }
}
