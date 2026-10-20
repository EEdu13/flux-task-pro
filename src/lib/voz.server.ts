import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";

import { ataDaEntrada, type AtaAoVivo, type FalaDaReuniao } from "./ata-ao-vivo";
import { sectors } from "./fluxo-types";
import { DEPARTMENT_ROOMS } from "./rooms";
import {
  calendario,
  equipeEmTexto,
  ErroDaIa,
  erroDoClaude,
  MODELO_DE_TEXTO,
  type PessoaDoTime,
} from "./ia.server";

export type { PessoaDoTime };

/**
 * Voz, lado do servidor: ouvir e entender. Serve à Tarefa por voz e à Ata da
 * reunião.
 *
 * Duas IAs, uma para cada coisa:
 *   - OpenAI `gpt-4o-transcribe` transforma o áudio de UMA frase em texto. O
 *     Claude não recebe áudio.
 *   - Claude transforma o texto em tarefas (Sonnet 5) ou na ata (Opus 5.5),
 *     validadas contra um esquema.
 *
 * Os dois eram os modelos menores (mini-transcribe e Haiku). Subiram depois de
 * um teste com microfone de notebook em que a transcrição inventou trechos e a
 * interpretação os aceitou como pedido. Custam mais por minuto; a troca de
 * volta é só nestas duas constantes.
 *
 * O áudio vai por frase, não em fluxo contínuo: a tela corta nas pausas e só
 * manda trecho que teve fala. Silêncio não custa nada.
 *
 * Sem `@/` nos imports de propósito: assim um script de teste consegue carregar
 * este arquivo direto no Node, com as chaves reais, sem subir o app inteiro.
 */

export const MODELO_TRANSCRICAO = "gpt-4o-transcribe";
export const MODELO_INTERPRETACAO = MODELO_DE_TEXTO;
/**
 * A ata usa o modelo mais forte (19/10/2026: "está lendo tudo errado,
 * interpretando tudo errado… deixa ela a melhor possível"). Durante a reunião
 * ele roda com esforço baixo, porque é chamado a cada meio minuto; a versão
 * final, que é a que fica guardada, sai com esforço alto e a transcrição inteira.
 */
/** A leitura final, que lê a transcrição inteira e escreve a ata guardada. */
export const MODELO_DA_ATA_FINAL = "claude-haiku-5-5";

/** De onde a reunião é: sem isso a IA chuta o ramo (já saiu "indústria de bebidas"). */
const sobreAEmpresa = () =>
  `A empresa é a Plantsil (antes chamada Larsil), prestadora de serviços florestais no Brasil — silvicultura, plantio, subsolagem, colheita, viveiro, máquinas e frota —, com equipes de campo organizadas por projeto e fazenda. PCP é o planejamento e controle da produção; DHO é o RH. Setores e salas do sistema: ${GLOSSARIO.filter((t) => !["Larsil", "SGL", "Conecta"].includes(t)).join(", ")}. Sistemas internos: Conecta (este app), SGL, Painel PCP.`;

export type Prioridade = "alta" | "media" | "baixa";

/** Uma tarefa como a tela a tem agora. `ref` é o apelido estável dela na conversa. */
export interface TarefaDitada {
  ref: string;
  titulo: string;
  descricao: string;
  responsavelId: string | null;
  /** AAAA-MM-DD */
  prazo: string | null;
  /** HH:MM */
  hora: string | null;
  prioridade: Prioridade;
}

/** O que a IA devolve: `ref` nulo é tarefa nova. */
export type TarefaInterpretada = Omit<TarefaDitada, "ref"> & { ref: string | null };

/* ------------------------------------------------------------------ */
/* Transcrição                                                          */
/* ------------------------------------------------------------------ */

const EXTENSAO: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

/**
 * Frases que os modelos de transcrição "ouvem" em trecho quase mudo. São
 * alucinações conhecidas — vêm das legendas com que eles foram treinados — e
 * virariam tarefa ou linha de ata se passassem. As de `SOZINHAS` só contam
 * quando são o texto inteiro: "obrigado" no meio de uma frase é fala de verdade.
 */
const ALUCINACOES = [/amara\.org/i, /legendas? (pela|por|da) comunidade/i, /inscreva-se no canal/i];
const SOZINHAS = [
  /^obrigad[oa]( por assistir(em)?)?[.!]?$/i,
  /^legendad[oa] por/i,
  /^tchau[,.!]?( tchau)?[.!]?$/i,
  /^até a próxima[.!]?$/i,
  /^(e )?é isso[.!]?$/i,
];

export type ContextoDeFala = "ditado" | "reuniao";

/**
 * As palavras da casa, para a transcrição não tentar adivinhá-las.
 *
 * Nome de empresa e sigla de setor é onde o modelo mais erra: ele nunca ouviu
 * "Larsil" nem "PCP" e troca pelo que soa parecido. A lista sai dos setores e
 * das salas do próprio app, então ela acompanha quando eles mudam.
 */
const GLOSSARIO = [
  ...new Set(
    [
      "Larsil",
      "SGL",
      "Conecta",
      ...sectors.map((s) => s.name),
      ...DEPARTMENT_ROOMS.map((r) => r.label),
    ]
      .map((t) => t.trim())
      // "CONTÁBIL/FISCAL" é maiúscula só na tela; como vocabulário ela atrapalha.
      // Sigla curta (TI, PCP, DHO) continua como é.
      .map((t) =>
        t.length > 4 && t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t,
      )
      // "Sem setor" é rótulo de tela, não palavra que alguém fala.
      .filter((t) => t.length > 2 && !/^sem /i.test(t)),
  ),
];

/**
 * Uma letra que não é do nosso alfabeto: cirílico, bengali, árabe, japonês,
 * qualquer um.
 *
 * O modelo às vezes "ouve" um trecho ruim em outro idioma e devolve a
 * transcrição no alfabeto dele — apareceu russo e bengali numa reunião inteira
 * em português. Texto assim é invenção, não fala: vai fora inteiro.
 *
 * Lê-se "o que não é não-letra e não é latino", ou seja: letra de outro
 * alfabeto. Acento não entra nisso — "é" é letra latina —, e emoji e pontuação
 * não são letras.
 */
const OUTRO_ALFABETO = /[^\P{L}\p{Script=Latin}]/u;

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Tira do texto o eco da dica de vocabulário.
 *
 * O modelo recebe os nomes da equipe como dica, e em trecho com pouca voz ele
 * às vezes devolve a própria dica como se tivesse sido dita — foi o que
 * apareceu na tela: "ditados em português do Brasil. Pessoas da equipe:
 * Eduardo Silva, Elaine Klug, …". Cai fora a frase que é uma lista de nomes da
 * dica (3 ou mais, quase sem outras palavras) ou que repete as palavras dela.
 */
function semEcoDaDica(texto: string, termos: string[]): string {
  const frases = texto.split(/(?<=[.!?:])\s+/);
  const nomesNorm = termos.map(semAcento).filter((n) => n.length > 2);
  const ficam = frases.filter((frase) => {
    const f = semAcento(frase);
    // O rótulo da própria dica ("Nomes:", "Termos:") solto depois do corte.
    if (/^(equipe|participantes|nomes|termos|vocabulario)\s*:?$/.test(f.trim())) return false;
    if (
      /(pessoas|nomes) da equipe|participantes da reuniao|ditados? em portugues|portugues do brasil|pedidos de tarefas|transcricao em portugues/.test(
        f,
      )
    )
      return false;
    const citados = nomesNorm.filter((n) => f.includes(n)).length;
    if (citados < 3) return true;
    let resto = f;
    for (const n of nomesNorm) resto = resto.split(n).join(" ");
    const outrasPalavras = (resto.match(/[a-z0-9]+/g) ?? []).filter(
      (p) => !["e", "a", "o", "da", "de", "do", "equipe", "participantes"].includes(p),
    );
    // "Lucas, Milena e Eduardo vão revisar o contrato" tem nomes E assunto: fica.
    return outrasPalavras.length >= 2;
  });
  return ficam.join(" ").trim();
}

/** Abaixo disto, a frase é palpite do modelo e não fala ouvida. Fala clara fica acima de 0,8. */
const CONFIANCA_MINIMA_DA_FRASE = 0.55;

/**
 * Remonta o texto a partir dos pedaços (tokens) com a confiança de cada um,
 * cortando em frases, e tira as frases de confiança baixa. Devolve null quando
 * a resposta não trouxe os pedaços com texto (aí fica o texto como veio).
 */
function semFrasesIncertas(pedacos: { token?: string; logprob?: number }[]): string | null {
  if (!pedacos.length || pedacos.some((p) => typeof p.token !== "string")) return null;
  const frases: { texto: string; probs: number[] }[] = [];
  let atual = { texto: "", probs: [] as number[] };
  for (const p of pedacos) {
    atual.texto += p.token;
    if (typeof p.logprob === "number") atual.probs.push(p.logprob);
    if (/[.!?…]\s*$/.test(p.token ?? "")) {
      frases.push(atual);
      atual = { texto: "", probs: [] };
    }
  }
  if (atual.texto.trim()) frases.push(atual);

  const ficam = frases.filter((f) => {
    if (OUTRO_ALFABETO.test(f.texto)) {
      console.info("[voz] frase descartada: outro alfabeto");
      return false;
    }
    // Frase de duas ou três palavras tem pouca amostra: a média não diz nada.
    if (f.probs.length < 4) return true;
    const confianca = Math.exp(f.probs.reduce((s, l) => s + l, 0) / f.probs.length);
    if (confianca >= CONFIANCA_MINIMA_DA_FRASE) return true;
    // Só o número vai para o log, nunca o que foi dito.
    console.info(`[voz] frase descartada: confiança ${confianca.toFixed(2)}`);
    return false;
  });
  return ficam
    .map((f) => f.texto)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export async function transcreverTrecho(opcoes: {
  apiKey: string | undefined;
  audio: Uint8Array<ArrayBuffer>;
  mime: string;
  /** Nomes da equipe ou dos participantes: é o que faz "Milena" sair Milena e não "Me lena". */
  nomes: string[];
  contexto?: ContextoDeFala;
  /** Quanto do trecho foi voz, medido na tela. */
  falaMs?: number;
  /** Reunião: o fim do que a MESMA pessoa disse antes. Dá contexto à frase que continua. */
  anterior?: string;
}): Promise<string> {
  if (!opcoes.apiKey) throw new ErroDaIa("A transcrição não está configurada no servidor.");

  const tipo = opcoes.mime.split(";")[0]!.trim().toLowerCase();
  const ext = EXTENSAO[tipo] ?? "webm";

  const form = new FormData();
  form.append("file", new Blob([opcoes.audio], { type: tipo }), `trecho.${ext}`);
  form.append("model", MODELO_TRANSCRICAO);
  form.append("language", "pt");
  form.append("response_format", "json");
  // A confiança de cada pedaço do texto: é o que denuncia texto inventado.
  form.append("include[]", "logprobs");
  // Sem margem para criatividade: aqui ela só produz palavra que ninguém falou.
  form.append("temperature", "0");
  /* A dica carrega o idioma e o vocabulário da casa. A frase do idioma reforça
     o `language=pt` acima, que sozinho não impediu o modelo de devolver trecho
     em outro idioma. O que ele ecoar da dica em trecho quase mudo é removido
     mais abaixo. */
  const termos = [...opcoes.nomes, ...GLOSSARIO];
  const reuniao = opcoes.contexto === "reuniao";
  const anterior = reuniao ? (opcoes.anterior ?? "").trim().slice(-400) : "";
  /* Na reunião, a dica termina com o que a pessoa acabou de dizer: o modelo lê
     a dica como o texto que veio antes, e a frase que continua o raciocínio sai
     com as palavras certas. O eco disso é tirado mais abaixo. */
  const base = (
    reuniao
      ? `Reunião de trabalho em português do Brasil, empresa de serviços florestais. Nomes: ${opcoes.nomes.join(", ")}. Termos: ${GLOSSARIO.join(", ")}.`
      : `Transcrição em português do Brasil. Nomes: ${opcoes.nomes.join(", ")}. Termos: ${GLOSSARIO.join(", ")}.`
  ).slice(0, anterior ? 1000 : 1400);
  form.append("prompt", anterior ? `${base}\n${anterior}` : base);

  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${opcoes.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  if (!r.ok) {
    const corpo = await r.text().catch(() => "");
    // Só o status e o código de erro vão para o log — nunca cabeçalho nem chave.
    const codigo = /"code"\s*:\s*"([^"]+)"/.exec(corpo)?.[1] ?? "";
    if (r.status === 401)
      throw new ErroDaIa("A chave da transcrição foi recusada.", `openai 401 ${codigo}`);
    if (r.status === 429)
      throw new ErroDaIa(
        // A OpenAI usa os dois códigos para conta sem saldo.
        codigo === "insufficient_quota" || codigo === "credit_balance_exhausted"
          ? "A conta da OpenAI (transcrição) está sem crédito."
          : "Muitas transcrições de uma vez. Tente de novo em instantes.",
        `openai 429 ${codigo}`,
      );
    throw new ErroDaIa("Não consegui transcrever esse trecho.", `openai ${r.status} ${codigo}`);
  }

  const resposta = (await r.json()) as {
    text?: string;
    logprobs?: { token?: string; logprob?: number }[];
  };
  let texto = (resposta.text ?? "").trim();
  if (texto.length < 2) return "";
  if (ALUCINACOES.some((re) => re.test(texto)) || SOZINHAS.some((re) => re.test(texto))) {
    console.info("[voz] trecho descartado: frase de legenda");
    return "";
  }
  // Na reunião o trecho é um bloco de ~40 s: a letra de outro alfabeto tira só
  // a frase dela (lá em `semFrasesIncertas`), não o bloco inteiro.
  if (!reuniao && OUTRO_ALFABETO.test(texto)) {
    console.info("[voz] trecho descartado: veio em outro alfabeto");
    return "";
  }

  /* Confiança média baixa: o modelo estava adivinhando. Fala clara fica bem
     acima de 0,8; o corte é baixo de propósito para não perder fala real com
     sotaque ou palavra técnica. */
  const probs = (resposta.logprobs ?? [])
    .map((l) => l.logprob)
    .filter((l): l is number => typeof l === "number");
  if (probs.length >= 3) {
    const confianca = Math.exp(probs.reduce((s, l) => s + l, 0) / probs.length);
    // Na reunião quem decide é a confiança de cada frase, logo abaixo.
    if (!reuniao && confianca < 0.4) {
      console.info(`[voz] trecho descartado: confiança ${confianca.toFixed(2)}`);
      return "";
    }
  }

  /* Frase por frase (19/10/2026). O trecho inteiro pode ter confiança boa e
     ainda assim carregar UMA frase inventada: no teste da ata, "semana passada
     eu levei uma queda de moto" apareceu no meio de uma fala real, e a ata
     registrou um acidente que ninguém contou. A frase que o modelo "chutou"
     tem confiança bem mais baixa que as vizinhas — essa sai, o resto fica. */
  if (reuniao) {
    const filtrado = semFrasesIncertas(resposta.logprobs ?? []);
    if (filtrado !== null) {
      if (filtrado.length < 2) {
        console.info("[voz] trecho descartado: todas as frases incertas");
        return "";
      }
      texto = filtrado;
    }
  }

  texto = semEcoDaDica(texto, termos);
  if (texto.length < 2) {
    console.info("[voz] trecho descartado: eco da dica");
    return "";
  }
  // O modelo devolveu a fala anterior (que foi na dica) como se fosse nova.
  if (anterior && texto.length >= 8 && semAcento(anterior).includes(semAcento(texto))) {
    console.info("[voz] trecho descartado: eco da fala anterior");
    return "";
  }

  /* Texto demais para a voz que houve. Ninguém fala 20 palavras em meio segundo;
     quando isso aparece, o modelo completou o trecho por conta própria. A folga
     é grande: a medida de voz da tela conta só as partes mais altas da fala. */
  if (typeof opcoes.falaMs === "number" && opcoes.falaMs > 0) {
    const palavras = texto.split(/\s+/).filter(Boolean).length;
    if (palavras >= 8 && palavras > (opcoes.falaMs / 1000) * 8 + 4) {
      console.info(`[voz] trecho descartado: ${palavras} palavras em ${opcoes.falaMs} ms de voz`);
      return "";
    }
  }

  return texto;
}

/* ------------------------------------------------------------------ */
/* Interpretação                                                        */
/* ------------------------------------------------------------------ */

const INSTRUCOES = `Você organiza pedidos de tarefas ditados em voz, em português do Brasil, dentro do sistema de tarefas de uma empresa. A fala chega transcrita, frase a frase, enquanto a pessoa ainda está falando.

Seu trabalho é manter a lista de tarefas atualizada:
- Cada pedido distinto vira uma tarefa. Uma frase pode ter vários pedidos, e um pedido pode continuar na frase seguinte.
- A pessoa corrige o que disse ("não, essa é para a Milena", "muda o prazo da segunda para amanhã", "tira a última"). Aplique a correção na tarefa existente em vez de criar outra, e remova da lista o que ela mandar tirar.
- A lista atual é a verdade: o que não está nela foi descartado pela pessoa e só volta se o trecho NOVO pedir de novo. Crie tarefas só a partir do trecho novo; a fala anterior serve apenas para entender referências.
- Devolva SEMPRE a lista completa, com o "ref" de cada tarefa existente mantido e ref null nas novas.

Campos:
- titulo: curto e acionável, começando por um verbo no infinitivo ("Revisar relatório de fretes de setembro"). Sem o nome do responsável nem o prazo.
- descricao: o que mais foi dito sobre como fazer. Frase curta; string vazia se não houver.
- responsavel_id: o id da pessoa da equipe a quem o pedido foi dirigido. "Para mim", "eu vou", "me lembra" = a pessoa que está ditando. Se o nome não corresponder com segurança a ninguém da lista, use null — não chute entre homônimos.
- prazo: data AAAA-MM-DD resolvida pelo calendário fornecido; null se nenhum prazo foi dito. "Sexta" é a próxima sexta a partir de hoje; "sexta que vem" é a da semana seguinte. "Fim do mês" é o último dia do mês; "início da semana que vem" é a próxima segunda-feira; "daqui a dois dias" conta a partir de hoje. Se a data dita já passou, use a próxima ocorrência dela.
- hora: HH:MM só se um horário foi dito ("até as 15h" = "15:00", "meio-dia" = "12:00", "fim do dia" não é horário); senão null.
- prioridade: "alta" para urgente/prioridade alta/"pra ontem"; "baixa" quando disserem que não tem pressa; senão "media".

Escrevendo o título e a descrição:
- Número, código, nota fiscal, placa, valor e nome de arquivo ou sistema vão como foram ditos, sem arredondar nem "consertar" ("nota 12.345", "R$ 1.200", "planilha de fretes").
- Escreva números por algarismo ("15 notas", e não "quinze notas"), menos quando fizer parte do nome de algo.
- Não repita no título o que já está nos campos: nada de "para a Milena" nem "até sexta".
- Nada de inventar detalhe que não foi dito para deixar a tarefa mais completa. Descrição vazia é melhor que descrição imaginada.

Ignore o que não for pedido de tarefa: cumprimentos, hesitações ("é…", "então", "deixa eu ver"), conversa paralela e comentários soltos.

Sobre a transcrição:
- Tudo foi dito em português do Brasil, e você escreve só em português do Brasil. Trecho que aparecer em outro idioma é erro da transcrição: ignore, nunca traduza nem repita.
- O texto vem de transcrição automática do microfone e pode ter erros: palavras trocadas por outras de som parecido, nomes escritos de outro jeito, pontuação fora do lugar, palavra cortada no começo ou no fim da frase. Entenda pelo sentido e pelos nomes da equipe, e escreva título e descrição corrigidos, com a palavra inteira.
- Microfone distante, ruído do ambiente ou outra pessoa falando perto geram trechos soltos, sem sentido, fora do assunto ou que são só uma lista de nomes. Não crie nem altere tarefa por causa deles.
- Na dúvida se algo é mesmo um pedido, não crie a tarefa: é melhor a pessoa repetir do que revisar uma tarefa inventada.`;

const RespostaSchema = z.object({
  tarefas: z.array(
    z.object({
      ref: z.string().nullable(),
      titulo: z.string(),
      descricao: z.string(),
      responsavel_id: z.string().nullable(),
      prazo: z.string().nullable(),
      hora: z.string().nullable(),
      prioridade: z.enum(["alta", "media", "baixa"]),
    }),
  ),
});

export async function interpretarDitado(opcoes: {
  apiKey: string | undefined;
  trechoNovo: string;
  falaAnterior: string;
  tarefas: TarefaDitada[];
  pessoas: PessoaDoTime[];
  quemDita: string;
  hoje: string;
}): Promise<{ tarefas: TarefaInterpretada[]; tokens: { entrada: number; saida: number } }> {
  if (!opcoes.apiKey) throw new ErroDaIa("A interpretação não está configurada no servidor.");

  const client = new Anthropic({ apiKey: opcoes.apiKey, timeout: 45_000, maxRetries: 1 });

  const equipe = equipeEmTexto(opcoes.pessoas, opcoes.quemDita, "(quem está ditando)");

  const atuais = opcoes.tarefas.map((t) => ({
    ref: t.ref,
    titulo: t.titulo,
    descricao: t.descricao,
    responsavel_id: t.responsavelId,
    prazo: t.prazo,
    hora: t.hora,
    prioridade: t.prioridade,
  }));

  const pedido = `<calendario>
${calendario(opcoes.hoje)}
</calendario>

<equipe formato="id | nome | cargo · setor">
${equipe}
</equipe>

<tarefas_atuais>
${JSON.stringify(atuais)}
</tarefas_atuais>

<fala_anterior>
${opcoes.falaAnterior || "(nenhuma)"}
</fala_anterior>

<trecho_novo>
${opcoes.trechoNovo}
</trecho_novo>`;

  let resposta;
  try {
    resposta = await client.messages.parse({
      model: MODELO_INTERPRETACAO,
      max_tokens: 4096,
      system: INSTRUCOES,
      messages: [{ role: "user", content: pedido }],
      output_config: { format: zodOutputFormat(RespostaSchema) },
    });
  } catch (e) {
    throw erroDoClaude(e, "organizar esse trecho");
  }

  const bruto = resposta.parsed_output;
  if (!bruto) {
    throw new ErroDaIa(
      "Não consegui organizar esse trecho.",
      `anthropic stop=${resposta.stop_reason}`,
    );
  }

  /* O esquema garante a forma; o conteúdo ainda é conferido. Id de pessoa que
     não existe, data torta ou ref inventado viram null — melhor um campo em
     branco para a pessoa preencher do que uma tarefa para alguém que não é. */
  const ids = new Set(opcoes.pessoas.map((p) => p.id));
  const refs = new Set(opcoes.tarefas.map((t) => t.ref));
  const vistos = new Set<string>();
  const tarefas: TarefaInterpretada[] = [];
  for (const t of bruto.tarefas.slice(0, 40)) {
    const titulo = t.titulo.trim().slice(0, 200);
    if (!titulo) continue;
    const ref = t.ref && refs.has(t.ref) && !vistos.has(t.ref) ? t.ref : null;
    if (ref) vistos.add(ref);
    tarefas.push({
      ref,
      titulo,
      descricao: t.descricao.trim().slice(0, 1000),
      responsavelId: t.responsavel_id && ids.has(t.responsavel_id) ? t.responsavel_id : null,
      prazo: t.prazo && /^\d{4}-\d{2}-\d{2}$/.test(t.prazo) ? t.prazo : null,
      hora: t.hora && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.hora) ? t.hora : null,
      prioridade: t.prioridade,
    });
  }

  return {
    tarefas,
    tokens: { entrada: resposta.usage.input_tokens, saida: resposta.usage.output_tokens },
  };
}

/* ------------------------------------------------------------------ */
/* Ata da reunião                                                       */
/* ------------------------------------------------------------------ */

/** O que vale para as duas redações: a ao vivo e a final. */
const SOBRE_AS_FALAS = `Sobre as falas:
- A reunião é em português do Brasil e a ata é escrita só em português do Brasil. Fala que aparecer em outro idioma é erro da transcrição: ignore, nunca traduza nem repita.
- Vêm de transcrição automática, cada pessoa pelo seu microfone, cortadas nas pausas — uma ideia pode estar dividida em várias falas seguidas da mesma pessoa. Podem ter palavras trocadas por outras de som parecido, nomes escritos errado, sigla mal ouvida e palavra cortada no começo ou no fim. Entenda pelo sentido, pelo assunto da reunião, pelo ramo da empresa e pelos nomes dos participantes, e escreva certo e por extenso na ata.
- Quando uma palavra não fizer sentido no contexto, procure a de som parecido que faz ("talão" num assunto de fazenda pode ser "talhão"). Se mesmo assim o trecho não fizer sentido, deixe-o fora — não monte uma interpretação a partir dele.
- O nome antes dos dois-pontos é de quem falou. Uma pessoa citada dentro da fala ("o Lucas vai ver isso") não é quem falou.
- Trechos sem sentido, soltos ou fora do assunto (ruído, eco, conversa paralela) devem ser ignorados.
- Nunca registre o que não foi dito com clareza. Não invente responsável, prazo, número nem decisão.
- Conversa social e de conexão ("bom dia", "tá me ouvindo?", "deixa eu compartilhar a tela", "caiu a internet") não entra.
- O chat da reunião, quando houver, também é fala: links, números e combinados escritos ali entram na ata.

Escrevendo:
- Escreva em terceira pessoa, citando as pessoas pelo nome ("Lucas explicou que…"), com o nome escrito como na lista de participantes.
- Seja concreto: número, valor, data, nome de fazenda, projeto, equipe, máquina, sistema e documento vão como foram ditos. Um ponto que diz "foram discutidos os números" sem dizer quais não serve.
- Registre o porquê quando ele foi dito: o motivo de uma decisão importa tanto quanto a decisão.`;

const CAMPOS_DA_ATA = `Campos:
- resumo: de 2 a 5 frases sobre o que a reunião tratou e o que saiu dela. Objetivo, sem floreio.
- assuntos: os temas discutidos, na ordem em que surgiram. Cada um com título curto e pontos com o que importa: fatos, números, argumentos, problemas, quem trouxe o quê. Junte no mesmo assunto o que for do mesmo tema, mesmo que volte mais tarde na reunião.
- decisoes: só o que foi decidido de fato ("vamos fazer assim", "ficou definido", concordância clara). Proposta ou ideia sem acordo não é decisão.
- proximos_passos: ações combinadas, começando por verbo no infinitivo. responsavel é o nome de quem ficou com a ação, escrito como na lista de participantes; null se ninguém foi citado. prazo como foi dito ("sexta-feira", "até dia 20"); null se não foi dito.
- pontos_de_atencao: riscos, bloqueios, dependências e preocupações levantadas.
Lista vazia quando não houver nada para o campo.`;

export const instrucoesDaAtaFinal =
  () => `Você é o redator da ata de uma reunião de trabalho, em português do Brasil. A reunião terminou. Você recebe a transcrição INTEIRA, fala por fala, com a hora e o nome de quem falou, e escreve a ata definitiva — é ela que fica guardada e que as pessoas vão consultar depois.

${sobreAEmpresa()}

Como trabalhar:
- Leia a transcrição toda antes de escrever. Ela é a fonte da verdade.
- Você também recebe o rascunho escrito durante a reunião, que viu a conversa em pedaços. Use-o só como ponto de partida: corrija o que estiver errado, complete o que faltou e tire o que a transcrição não sustenta.
- Cubra a reunião do começo ao fim. Reunião longa tem muitos assuntos: nenhum assunto real pode ficar de fora, nem os do final.
- Se a mesma coisa foi dita de jeitos diferentes ao longo da reunião, vale a última versão combinada.
- Se a transcrição for curta ou quase só ruído, escreva uma ata curta e honesta — nunca encha com o que não foi dito.

${CAMPOS_DA_ATA}

${SOBRE_AS_FALAS}`;

const AtaSchema = z.object({
  resumo: z.string(),
  assuntos: z.array(z.object({ titulo: z.string(), pontos: z.array(z.string()) })),
  decisoes: z.array(z.string()),
  proximos_passos: z.array(
    z.object({
      acao: z.string(),
      responsavel: z.string().nullable(),
      prazo: z.string().nullable(),
    }),
  ),
  pontos_de_atencao: z.array(z.string()),
});

const linhasDeFala = (falas: Pick<FalaDaReuniao, "hora" | "quem" | "texto">[]) =>
  falas.map((f) => `[${f.hora}] ${f.quem}: ${f.texto}`).join("\n");

const ataParaOModelo = (a: AtaAoVivo) => ({
  resumo: a.resumo,
  assuntos: a.assuntos,
  decisoes: a.decisoes,
  proximos_passos: a.proximosPassos,
  pontos_de_atencao: a.pontosDeAtencao,
});

const ataDoModelo = (bruto: z.infer<typeof AtaSchema>): AtaAoVivo =>
  // Passa pelo mesmo conferidor de quem recebe a ata pela sala: tetos e itens vazios.
  ataDaEntrada({
    resumo: bruto.resumo,
    assuntos: bruto.assuntos,
    decisoes: bruto.decisoes,
    proximosPassos: bruto.proximos_passos,
    pontosDeAtencao: bruto.pontos_de_atencao,
  });

/**
 * A redação final: a transcrição inteira, do primeiro ao último minuto, numa
 * leitura só. A ata ao vivo vê a conversa em pedaços (as falas novas e um
 * pouco de contexto) e erra o que só se entende olhando o todo — assunto que
 * volta, correção dita meia hora depois, termo que só faz sentido com o resto.
 *
 * Vai por streaming: reunião longa é muito texto para ler e para escrever, e
 * uma chamada comum estouraria o tempo.
 */
export async function redigirAtaFinal(opcoes: {
  apiKey: string | undefined;
  titulo: string;
  data: string;
  participantes: string[];
  rascunho: AtaAoVivo;
  falas: Pick<FalaDaReuniao, "hora" | "quem" | "texto">[];
  chat: Pick<FalaDaReuniao, "hora" | "quem" | "texto">[];
  /** Para comparar modelos num teste; na tela vale `MODELO_DA_ATA_FINAL`. */
  modelo?: string;
}): Promise<{ ata: AtaAoVivo; tokens: { entrada: number; saida: number } }> {
  if (!opcoes.apiKey) throw new ErroDaIa("A redação da ata não está configurada no servidor.");

  const client = new Anthropic({ apiKey: opcoes.apiKey, timeout: 600_000, maxRetries: 1 });

  const pedido = `<reuniao titulo=${JSON.stringify(opcoes.titulo)} data="${opcoes.data}">
<participantes>
${opcoes.participantes.join(", ") || "(não identificados)"}
</participantes>

<transcricao>
${linhasDeFala(opcoes.falas) || "(nenhuma fala)"}
</transcricao>

<chat>
${linhasDeFala(opcoes.chat) || "(nenhuma mensagem)"}
</chat>

<rascunho_ao_vivo>
${JSON.stringify(ataParaOModelo(opcoes.rascunho))}
</rascunho_ao_vivo>
</reuniao>

Escreva a ata definitiva desta reunião.`;

  let resposta;
  try {
    const fluxo = client.messages.stream({
      model: opcoes.modelo ?? MODELO_DA_ATA_FINAL,
      max_tokens: 64000,
      system: instrucoesDaAtaFinal(),
      messages: [{ role: "user", content: pedido }],
      output_config: { format: zodOutputFormat(AtaSchema), effort: "high" },
    });
    resposta = await fluxo.finalMessage();
  } catch (e) {
    throw erroDoClaude(e, "escrever a ata final");
  }

  const texto = resposta.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  let bruto: z.infer<typeof AtaSchema> | null = null;
  try {
    const r = AtaSchema.safeParse(JSON.parse(texto));
    if (r.success) bruto = r.data;
  } catch {
    /* JSON cortado ou recusa: cai no erro abaixo */
  }
  if (!bruto) {
    throw new ErroDaIa(
      "Não consegui escrever a ata final.",
      `anthropic stop=${resposta.stop_reason}`,
    );
  }

  return {
    ata: ataDoModelo(bruto),
    tokens: { entrada: resposta.usage.input_tokens, saida: resposta.usage.output_tokens },
  };
}

/** Reserva da leitura final: se o Claude falhar (fora do ar, sem crédito), a ata sai pelo GPT. */
export const MODELO_DA_ATA_RESERVA = "gpt-5.4-mini";

const ATA_EM_JSON_SCHEMA = (() => {
  const str = { type: "string" };
  const lista = { type: "array", items: str };
  return {
    type: "object",
    additionalProperties: false,
    required: ["resumo", "assuntos", "decisoes", "proximos_passos", "pontos_de_atencao"],
    properties: {
      resumo: str,
      assuntos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["titulo", "pontos"],
          properties: { titulo: str, pontos: lista },
        },
      },
      decisoes: lista,
      proximos_passos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["acao", "responsavel", "prazo"],
          properties: {
            acao: str,
            responsavel: { type: ["string", "null"] },
            prazo: { type: ["string", "null"] },
          },
        },
      },
      pontos_de_atencao: lista,
    },
  };
})();

/** A mesma leitura final de `redigirAtaFinal`, pela OpenAI (Responses API, saída em JSON Schema). */
export async function redigirAtaFinalComGpt(opcoes: {
  apiKey: string | undefined;
  titulo: string;
  data: string;
  participantes: string[];
  falas: Pick<FalaDaReuniao, "hora" | "quem" | "texto">[];
  chat: Pick<FalaDaReuniao, "hora" | "quem" | "texto">[];
}): Promise<{ ata: AtaAoVivo; tokens: { entrada: number; saida: number } }> {
  if (!opcoes.apiKey) throw new ErroDaIa("A redação da ata não está configurada no servidor.");
  const pedido = `<reuniao titulo=${JSON.stringify(opcoes.titulo)} data="${opcoes.data}">
<participantes>
${opcoes.participantes.join(", ") || "(não identificados)"}
</participantes>

<transcricao>
${linhasDeFala(opcoes.falas) || "(nenhuma fala)"}
</transcricao>

<chat>
${linhasDeFala(opcoes.chat) || "(nenhuma mensagem)"}
</chat>
</reuniao>

Escreva a ata definitiva desta reunião.`;

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${opcoes.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODELO_DA_ATA_RESERVA,
      instructions: instrucoesDaAtaFinal(),
      input: pedido,
      reasoning: { effort: "medium" },
      text: {
        format: { type: "json_schema", name: "ata", strict: true, schema: ATA_EM_JSON_SCHEMA },
      },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const corpo = (await r.json().catch(() => null)) as {
    output?: { content?: { type?: string; text?: string }[] }[];
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { code?: string };
  } | null;
  if (!r.ok || !corpo) {
    throw new ErroDaIa(
      "Não consegui escrever a ata.",
      `openai ${r.status} ${corpo?.error?.code ?? ""}`,
    );
  }
  const texto = (corpo.output ?? [])
    .flatMap((o) => o.content ?? [])
    .find((c) => c.type === "output_text")?.text;
  let bruto: z.infer<typeof AtaSchema> | null = null;
  try {
    const p = AtaSchema.safeParse(JSON.parse(texto ?? ""));
    if (p.success) bruto = p.data;
  } catch {
    /* resposta cortada: cai no erro abaixo */
  }
  if (!bruto) throw new ErroDaIa("Não consegui escrever a ata.", "openai ata sem JSON válido");
  return {
    ata: ataDoModelo(bruto),
    tokens: { entrada: corpo.usage?.input_tokens ?? 0, saida: corpo.usage?.output_tokens ?? 0 },
  };
}
