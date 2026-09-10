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

import {
  editarMensagem,
  enviarMensagem,
  escaparMd,
  removerTeclado,
  responderCallback,
} from "./client.server";
import { desvincular, pessoaPorTelegram, vincularPorContato } from "./contas.server";
import type { AtualizacaoClassificada, TecladoEmLinha } from "./types";

/** Endereço do sistema, para os links de "abrir no Fluxo". */
function urlDoApp(): string {
  return (process.env.APP_URL ?? "https://gestor-larsil.up.railway.app").replace(/\/+$/, "");
}

/* --------------------------- Consultas --------------------------- */

interface TarefaResumo {
  id: string;
  titulo: string;
  prazo: Date;
  situacao: string;
  prioridade: string;
  responsavel: string | null;
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
 * `CAST(... AS date)` dos dois lados em "atrasadas": o prazo é DATETIMEOFFSET e
 * comparar com o instante atual marcaria como atrasada uma tarefa que vence
 * hoje às 9h, depois das 9h. O que a pessoa quer ver é o DIA, não o horário.
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
    onde: "situacao<>'concluida' AND CAST(prazo AS date) < CAST(SYSDATETIMEOFFSET() AS date)",
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
  const req = pool.request().input("eu", sql.Int, pessoaId).input("id", sql.UniqueIdentifier, tarefaId);
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

function dia(d: Date): string {
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function atrasoEmDias(prazo: Date): number {
  const p = new Date(prazo);
  p.setHours(0, 0, 0, 0);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((hoje.getTime() - p.getTime()) / 86_400_000);
}

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
    `_Comandos:_ /andamento, /atrasadas, /abertas, /equipe, /sair`,
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
        { text: `${t.prioridade === "media" ? "•" : ""}🟡 Média`, callback_data: `p:media:${t.id}` },
        { text: `${t.prioridade === "baixa" ? "•" : ""}⚪ Baixa`, callback_data: `p:baixa:${t.id}` },
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
        return await aoReceberTexto(a.deId, a.chatId, a.privado);
      case "ignorada":
        return;
    }
  } catch (e) {
    console.error("[telegram] falha ao tratar:", (e as Error)?.message);
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

async function aoReceberComando(
  deId: number,
  chatId: number,
  privado: boolean,
  comando: string,
) {
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

/** Texto solto não vira tarefa (ainda). Responder o menu é melhor que silêncio. */
async function aoReceberTexto(deId: number, chatId: number, privado: boolean) {
  const conta = await pessoaPorTelegram(deId);
  if (!conta) {
    await enviarMensagem(chatId, privado ? CONVITE : SO_NO_PRIVADO, {
      teclado: privado ? PEDIR_CONTATO : undefined,
    });
    return;
  }
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
    await enviarMensagem(
      chatId,
      "Não há mais ninguém no seu setor para acompanhar por aqui\\.",
      { teclado: VOLTAR_AO_MENU },
    );
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
