import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";

import {
  calendario,
  equipeEmTexto,
  ErroDaIa,
  erroDoClaude,
  MODELO_DE_TEXTO,
  type PessoaDoTime,
} from "./ia.server";

/**
 * "Sugerir tarefas com IA" do Bloco de notas, lado do servidor.
 *
 * A nota é o rascunho de quem escreveu — recado de reunião, lista de pendências,
 * ideia solta. O Claude lê e devolve as tarefas que dá para tirar dali, cada uma
 * com o trecho da nota que a originou. Nada é criado aqui: a tela mostra a lista
 * para a pessoa conferir responsável e prazo antes de gerar.
 *
 * Isto rodava pela Lovable, com uma chave que não existe mais — por isso o botão
 * só dava erro. Agora usa o mesmo Claude da Tarefa por voz e da Ata.
 */

export type Prioridade = "alta" | "media" | "baixa";

export interface TarefaSugerida {
  titulo: string;
  descricao: string;
  responsavelId: string | null;
  /** AAAA-MM-DD; null quando a nota não disse quando. */
  prazo: string | null;
  prioridade: Prioridade;
  /** O pedaço da nota que virou esta tarefa, para a pessoa conferir de onde veio. */
  origem: string;
}

const INSTRUCOES = `Você lê a anotação de uma pessoa, dentro do sistema de tarefas de uma empresa brasileira, e tira dela as tarefas que existem ali. Tudo é em português do Brasil, e você escreve só em português do Brasil.

A nota é rascunho: recado de reunião, lista de pendências, ideia jogada no papel. Pode estar sem pontuação, em tópicos, com abreviação e com coisa que não é tarefa.

O que vira tarefa:
- Só o que é uma ação a fazer. Anotação de fato ("cliente ligou"), lembrete de informação ("senha do portal é X") e ideia sem ação não viram tarefa.
- Cada ação distinta é uma tarefa. Não junte duas coisas diferentes numa só, nem quebre uma ação em pedaços.
- Item que a nota marca como feito (riscado, "ok", "concluído", "[x]") fica de fora.
- No máximo 12 tarefas, as mais importantes primeiro.

Campos:
- titulo: curto e acionável, começando por verbo no infinitivo ("Enviar a proposta para o cliente"). Sem o nome do responsável e sem o prazo.
- descricao: o que a nota diz sobre como fazer, em uma frase. String vazia quando a nota não disser mais nada.
- responsavel_id: o id da pessoa da equipe a quem a nota atribui a ação. Se a nota não disser de quem é, use null — quem escreveu vai escolher na tela. Não chute entre nomes parecidos.
- prazo: data AAAA-MM-DD resolvida pelo calendário fornecido, só se a nota disser um prazo ("até sexta", "dia 20", "amanhã"). Sem prazo escrito, null: não invente data.
- prioridade: "alta" para o que a nota marca como urgente ou com prazo apertado; "baixa" para ideia e melhoria sem pressa; senão "media".
- origem: o trecho da nota, copiado como está (até 120 caracteres), que deu origem a esta tarefa.

Nunca invente informação que não está na nota. Se não houver nada acionável, devolva a lista vazia.`;

const Resposta = z.object({
  tarefas: z.array(
    z.object({
      titulo: z.string(),
      descricao: z.string(),
      responsavel_id: z.string().nullable(),
      prazo: z.string().nullable(),
      prioridade: z.enum(["alta", "media", "baixa"]),
      origem: z.string(),
    }),
  ),
});

export async function sugerirTarefasDaNota(opcoes: {
  apiKey: string | undefined;
  titulo: string;
  conteudo: string;
  pessoas: PessoaDoTime[];
  quemEscreve: string;
  hoje: string;
}): Promise<{ tarefas: TarefaSugerida[]; tokens: { entrada: number; saida: number } }> {
  if (!opcoes.apiKey) throw new ErroDaIa("A sugestão de tarefas não está configurada no servidor.");

  const client = new Anthropic({ apiKey: opcoes.apiKey, timeout: 60_000, maxRetries: 1 });

  const pedido = `<calendario>
${calendario(opcoes.hoje)}
</calendario>

<equipe formato="id | nome | cargo · setor">
${equipeEmTexto(opcoes.pessoas, opcoes.quemEscreve, "(quem escreveu a nota)")}
</equipe>

<nota titulo=${JSON.stringify(opcoes.titulo)}>
${opcoes.conteudo}
</nota>`;

  let resposta;
  try {
    resposta = await client.messages.parse({
      model: MODELO_DE_TEXTO,
      max_tokens: 4096,
      system: INSTRUCOES,
      messages: [{ role: "user", content: pedido }],
      output_config: { format: zodOutputFormat(Resposta) },
    });
  } catch (e) {
    throw erroDoClaude(e, "ler esta nota");
  }

  const bruto = resposta.parsed_output;
  if (!bruto) {
    throw new ErroDaIa("Não consegui ler esta nota.", `anthropic stop=${resposta.stop_reason}`);
  }

  /* O esquema garante a forma; o conteúdo ainda é conferido. Id de pessoa que
     não existe e data torta viram null — na tela a pessoa escolhe, e é melhor
     um campo em branco do que uma tarefa para alguém que não é. */
  const ids = new Set(opcoes.pessoas.map((p) => p.id));
  const tarefas: TarefaSugerida[] = [];
  for (const t of bruto.tarefas.slice(0, 12)) {
    const titulo = t.titulo.trim().slice(0, 200);
    if (!titulo) continue;
    tarefas.push({
      titulo,
      descricao: t.descricao.trim().slice(0, 1000),
      responsavelId: t.responsavel_id && ids.has(t.responsavel_id) ? t.responsavel_id : null,
      prazo: t.prazo && /^\d{4}-\d{2}-\d{2}$/.test(t.prazo) ? t.prazo : null,
      prioridade: t.prioridade,
      origem: t.origem.trim().slice(0, 160),
    });
  }

  return {
    tarefas,
    tokens: { entrada: resposta.usage.input_tokens, saida: resposta.usage.output_tokens },
  };
}
