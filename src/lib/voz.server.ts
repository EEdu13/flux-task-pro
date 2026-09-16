import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";

import {
  ataDaEntrada,
  type AtaAoVivo,
  type FalaDaReuniao,
} from "./ata-ao-vivo";
import { sectors } from "./fluxo-types";
import { DEPARTMENT_ROOMS } from "./rooms";

/**
 * Voz, lado do servidor: ouvir e entender. Serve à Tarefa por voz e à Ata da
 * reunião.
 *
 * Duas IAs, uma para cada coisa:
 *   - OpenAI `gpt-4o-transcribe` transforma o áudio de UMA frase em texto. O
 *     Claude não recebe áudio.
 *   - Claude Sonnet 5 transforma o texto em tarefas, ou na ata, validadas contra
 *     um esquema.
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
export const MODELO_INTERPRETACAO = "claude-sonnet-5";

export type Prioridade = "alta" | "media" | "baixa";

export interface PessoaDoTime {
  id: string;
  nome: string;
  setor?: string;
  cargo?: string;
}

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

/** Erro com frase para a tela. O `message` técnico fica só no log do servidor. */
export class ErroDeVoz extends Error {
  readonly paraTela: string;
  constructor(paraTela: string, tecnico?: string) {
    super(tecnico ?? paraTela);
    this.paraTela = paraTela;
  }
}

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
    ["Larsil", "SGL", "Conecta", ...sectors.map((s) => s.name), ...DEPARTMENT_ROOMS.map((r) => r.label)]
      .map((t) => t.trim())
      // "CONTÁBIL/FISCAL" é maiúscula só na tela; como vocabulário ela atrapalha.
      // Sigla curta (TI, PCP, DHO) continua como é.
      .map((t) => (t.length > 4 && t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t))
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

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

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

export async function transcreverTrecho(opcoes: {
  apiKey: string | undefined;
  audio: Uint8Array<ArrayBuffer>;
  mime: string;
  /** Nomes da equipe ou dos participantes: é o que faz "Milena" sair Milena e não "Me lena". */
  nomes: string[];
  contexto?: ContextoDeFala;
  /** Quanto do trecho foi voz, medido na tela. */
  falaMs?: number;
}): Promise<string> {
  if (!opcoes.apiKey) throw new ErroDeVoz("A transcrição não está configurada no servidor.");

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
  form.append(
    "prompt",
    `Transcrição em português do Brasil. Nomes: ${opcoes.nomes.join(", ")}. Termos: ${GLOSSARIO.join(", ")}.`.slice(
      0,
      1400,
    ),
  );

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
      throw new ErroDeVoz("A chave da transcrição foi recusada.", `openai 401 ${codigo}`);
    if (r.status === 429)
      throw new ErroDeVoz(
        // A OpenAI usa os dois códigos para conta sem saldo.
        codigo === "insufficient_quota" || codigo === "credit_balance_exhausted"
          ? "A conta da OpenAI (transcrição) está sem crédito."
          : "Muitas transcrições de uma vez. Tente de novo em instantes.",
        `openai 429 ${codigo}`,
      );
    throw new ErroDeVoz("Não consegui transcrever esse trecho.", `openai ${r.status} ${codigo}`);
  }

  const resposta = (await r.json()) as {
    text?: string;
    logprobs?: { logprob?: number }[];
  };
  let texto = (resposta.text ?? "").trim();
  if (texto.length < 2) return "";
  if (ALUCINACOES.some((re) => re.test(texto)) || SOZINHAS.some((re) => re.test(texto))) {
    console.info("[voz] trecho descartado: frase de legenda");
    return "";
  }
  if (OUTRO_ALFABETO.test(texto)) {
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
    if (confianca < 0.4) {
      console.info(`[voz] trecho descartado: confiança ${confianca.toFixed(2)}`);
      return "";
    }
  }

  texto = semEcoDaDica(texto, termos);
  if (texto.length < 2) {
    console.info("[voz] trecho descartado: eco da dica");
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

const DIAS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

/**
 * Os próximos dias escritos por extenso. Modelo pequeno erra conta de
 * calendário ("sexta que vem" numa quinta); com a tabela na frente ele só lê.
 */
function calendario(hoje: string): string {
  const [a, m, d] = hoje.split("-").map(Number) as [number, number, number];
  const linhas: string[] = [];
  for (let i = 0; i < 21; i++) {
    const dia = new Date(Date.UTC(a, m - 1, d + i));
    const iso = dia.toISOString().slice(0, 10);
    const rotulo = i === 0 ? " (hoje)" : i === 1 ? " (amanhã)" : "";
    linhas.push(`${iso} ${DIAS[dia.getUTCDay()]}${rotulo}`);
  }
  return linhas.join("\n");
}

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

/** Erro da API do Claude trocado pela frase da tela. */
function erroDoClaude(e: unknown, fazendo: string): ErroDeVoz {
  if (e instanceof Anthropic.AuthenticationError)
    return new ErroDeVoz("A chave do Claude foi recusada.", "anthropic 401");
  if (e instanceof Anthropic.RateLimitError)
    return new ErroDeVoz("Muitos pedidos de uma vez. Tente de novo em instantes.", "anthropic 429");
  // Saldo zerado chega como 400 com a explicação na mensagem.
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message))
    return new ErroDeVoz("A conta do Claude está sem crédito.", "anthropic 400 credit");
  if (e instanceof Anthropic.APIError)
    return new ErroDeVoz(`Não consegui ${fazendo}.`, `anthropic ${e.status}`);
  return new ErroDeVoz(`Não consegui ${fazendo}.`, (e as Error)?.name);
}

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
  if (!opcoes.apiKey) throw new ErroDeVoz("A interpretação não está configurada no servidor.");

  const client = new Anthropic({ apiKey: opcoes.apiKey, timeout: 45_000, maxRetries: 1 });

  const equipe = opcoes.pessoas
    .map((p) => {
      const extra = [p.cargo, p.setor].filter(Boolean).join(" · ");
      const eu = p.id === opcoes.quemDita ? " (quem está ditando)" : "";
      return `${p.id} | ${p.nome}${extra ? ` | ${extra}` : ""}${eu}`;
    })
    .join("\n");

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
    throw new ErroDeVoz(
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

const INSTRUCOES_DA_ATA = `Você é o redator da ata de uma reunião de trabalho de uma empresa brasileira, em português do Brasil. A reunião está acontecendo agora: as falas chegam transcritas aos poucos, com a hora e o nome de quem falou, e você mantém a ata atualizada enquanto as pessoas conversam.

Você recebe a ata como está e as falas novas. Devolva a ata completa, atualizada:
- Incorpore o que as falas novas trazem e mantenha o que já estava. Reescreva um item só quando uma fala nova corrigir, completar ou mudar o que foi dito ("na verdade o prazo é dia 20").
- As falas anteriores servem só de contexto para entender as novas; elas já estão na ata.

Campos:
- resumo: de 2 a 4 frases sobre o que a reunião tratou até agora. Objetivo, sem floreio.
- assuntos: os temas discutidos, na ordem em que surgiram. Cada um com título curto e pontos curtos com o que importa: fatos, números, argumentos, quem trouxe o quê. Junte no mesmo assunto o que for do mesmo tema.
- decisoes: só o que foi decidido de fato ("vamos fazer assim", "ficou definido", concordância clara). Proposta ou ideia sem acordo não é decisão.
- proximos_passos: ações combinadas, começando por verbo no infinitivo. responsavel é o nome de quem ficou com a ação, escrito como na lista de participantes; null se ninguém foi citado. prazo como foi dito ("sexta-feira", "até dia 20"); null se não foi dito.
- pontos_de_atencao: riscos, bloqueios, dependências e preocupações levantadas.
Lista vazia quando não houver nada para o campo.

Sobre as falas:
- A reunião é em português do Brasil e a ata é escrita só em português do Brasil. Fala que aparecer em outro idioma é erro da transcrição: ignore, nunca traduza nem repita.
- Vêm de transcrição automática, cada pessoa pelo seu microfone. Podem ter palavras trocadas por outras de som parecido, nomes escritos errado e palavra cortada no começo ou no fim da frase: entenda pelo sentido, pelo assunto da reunião e pelos nomes dos participantes, e escreva certo e por extenso na ata.
- Trechos sem sentido, soltos ou fora do assunto (ruído, eco, conversa paralela) devem ser ignorados.
- Nunca registre o que não foi dito com clareza. Não invente responsável, prazo, número nem decisão.
- Conversa social e de conexão ("bom dia", "tá me ouvindo?", "deixa eu compartilhar a tela") não entra.
- Escreva em terceira pessoa, citando as pessoas pelo nome ("Lucas explicou que…").`;

const AtaSchema = z.object({
  resumo: z.string(),
  assuntos: z.array(z.object({ titulo: z.string(), pontos: z.array(z.string()) })),
  decisoes: z.array(z.string()),
  proximos_passos: z.array(
    z.object({ acao: z.string(), responsavel: z.string().nullable(), prazo: z.string().nullable() }),
  ),
  pontos_de_atencao: z.array(z.string()),
});

const linhasDeFala = (falas: Pick<FalaDaReuniao, "hora" | "quem" | "texto">[]) =>
  falas.map((f) => `[${f.hora}] ${f.quem}: ${f.texto}`).join("\n");

export async function atualizarAta(opcoes: {
  apiKey: string | undefined;
  titulo: string;
  data: string;
  participantes: string[];
  ata: AtaAoVivo;
  anteriores: Pick<FalaDaReuniao, "hora" | "quem" | "texto">[];
  novas: Pick<FalaDaReuniao, "hora" | "quem" | "texto">[];
  chat: Pick<FalaDaReuniao, "hora" | "quem" | "texto">[];
}): Promise<{ ata: AtaAoVivo; tokens: { entrada: number; saida: number } }> {
  if (!opcoes.apiKey) throw new ErroDeVoz("A redação da ata não está configurada no servidor.");

  const client = new Anthropic({ apiKey: opcoes.apiKey, timeout: 90_000, maxRetries: 1 });

  const atual = {
    resumo: opcoes.ata.resumo,
    assuntos: opcoes.ata.assuntos,
    decisoes: opcoes.ata.decisoes,
    proximos_passos: opcoes.ata.proximosPassos,
    pontos_de_atencao: opcoes.ata.pontosDeAtencao,
  };

  const pedido = `<reuniao titulo=${JSON.stringify(opcoes.titulo)} data="${opcoes.data}">
<participantes>
${opcoes.participantes.join(", ") || "(não identificados)"}
</participantes>

<ata_atual>
${JSON.stringify(atual)}
</ata_atual>

<falas_anteriores>
${linhasDeFala(opcoes.anteriores) || "(nenhuma)"}
</falas_anteriores>

<falas_novas>
${linhasDeFala(opcoes.novas) || "(nenhuma)"}
</falas_novas>

<chat_novo>
${linhasDeFala(opcoes.chat) || "(nenhuma mensagem)"}
</chat_novo>
</reuniao>`;

  let resposta;
  try {
    resposta = await client.messages.parse({
      model: MODELO_INTERPRETACAO,
      max_tokens: 8000,
      system: INSTRUCOES_DA_ATA,
      messages: [{ role: "user", content: pedido }],
      output_config: { format: zodOutputFormat(AtaSchema) },
    });
  } catch (e) {
    throw erroDoClaude(e, "escrever a ata");
  }

  const bruto = resposta.parsed_output;
  if (!bruto) {
    throw new ErroDeVoz("Não consegui escrever a ata.", `anthropic stop=${resposta.stop_reason}`);
  }

  return {
    // Passa pelo mesmo conferidor de quem recebe a ata pela sala: tetos e itens vazios.
    ata: ataDaEntrada({
      resumo: bruto.resumo,
      assuntos: bruto.assuntos,
      decisoes: bruto.decisoes,
      proximosPassos: bruto.proximos_passos,
      pontosDeAtencao: bruto.pontos_de_atencao,
    }),
    tokens: { entrada: resposta.usage.input_tokens, saida: resposta.usage.output_tokens },
  };
}
