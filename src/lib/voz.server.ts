import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";

/**
 * Tarefa por voz, lado do servidor: ouvir e entender.
 *
 * Duas IAs, uma para cada coisa que faz bem e barato:
 *   - OpenAI `gpt-4o-mini-transcribe` transforma o áudio de UMA frase em texto
 *     (~US$ 0,003 por minuto de fala). O Claude não recebe áudio.
 *   - Claude Haiku 4.5 transforma o texto em tarefas estruturadas, validadas
 *     contra um esquema (~US$ 0,004 por ditado de 2 minutos).
 *
 * O áudio vai por frase, não em fluxo contínuo: a tela corta nas pausas e só
 * manda trecho que teve fala. Silêncio não custa nada — na transcrição ao vivo
 * (US$ 0,017/min) a conexão cobraria cada segundo aberto.
 *
 * Sem `@/` nos imports de propósito: assim um script de teste consegue carregar
 * este arquivo direto no Node, com as chaves reais, sem subir o app inteiro.
 */

export const MODELO_TRANSCRICAO = "gpt-4o-mini-transcribe";
export const MODELO_INTERPRETACAO = "claude-haiku-4-5";

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
 * virariam tarefa se passassem.
 */
const ALUCINACOES = [/amara\.org/i, /^obrigad[oa] por assistir/i, /^legendas? (pela|por)/i];

export async function transcreverTrecho(opcoes: {
  apiKey: string | undefined;
  audio: Uint8Array<ArrayBuffer>;
  mime: string;
  /** Nomes da equipe: é o que faz "Milena" sair Milena e não "Me lena". */
  nomes: string[];
}): Promise<string> {
  if (!opcoes.apiKey) throw new ErroDeVoz("A transcrição não está configurada no servidor.");

  const tipo = opcoes.mime.split(";")[0]!.trim().toLowerCase();
  const ext = EXTENSAO[tipo] ?? "webm";

  const form = new FormData();
  form.append("file", new Blob([opcoes.audio], { type: tipo }), `trecho.${ext}`);
  form.append("model", MODELO_TRANSCRICAO);
  form.append("language", "pt");
  form.append("response_format", "json");
  // A dica é curta de propósito: é contexto de vocabulário, não instrução.
  const dica = `Pedidos de tarefas ditados em português do Brasil. Pessoas da equipe: ${opcoes.nomes.join(", ")}.`;
  form.append("prompt", dica.slice(0, 900));

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
        codigo === "insufficient_quota"
          ? "A conta da transcrição está sem crédito."
          : "Muitas transcrições de uma vez. Tente de novo em instantes.",
        `openai 429 ${codigo}`,
      );
    throw new ErroDeVoz("Não consegui transcrever esse trecho.", `openai ${r.status} ${codigo}`);
  }

  const { text } = (await r.json()) as { text?: string };
  const texto = (text ?? "").trim();
  if (texto.length < 2 || ALUCINACOES.some((re) => re.test(texto))) return "";
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
- prazo: data AAAA-MM-DD resolvida pelo calendário fornecido; null se nenhum prazo foi dito. "Sexta" é a próxima sexta a partir de hoje; "sexta que vem" é a da semana seguinte.
- hora: HH:MM só se um horário foi dito ("até as 15h" = "15:00"); senão null.
- prioridade: "alta" para urgente/prioridade alta/"pra ontem"; "baixa" quando disserem que não tem pressa; senão "media".

Ignore o que não for pedido de tarefa (cumprimentos, hesitações, comentários soltos).`;

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
    if (e instanceof Anthropic.AuthenticationError)
      throw new ErroDeVoz("A chave da interpretação foi recusada.", "anthropic 401");
    if (e instanceof Anthropic.RateLimitError)
      throw new ErroDeVoz(
        "Muitos pedidos de uma vez. Tente de novo em instantes.",
        "anthropic 429",
      );
    if (e instanceof Anthropic.APIError)
      throw new ErroDeVoz("Não consegui organizar esse trecho.", `anthropic ${e.status}`);
    throw new ErroDeVoz("Não consegui organizar esse trecho.", (e as Error)?.name);
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
