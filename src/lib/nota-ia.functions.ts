import { createServerFn } from "@tanstack/react-start";
import { comSessao, semIdentidade } from "@/integrations/iam/funcao-com-sessao";
import type { PessoaDoTime } from "@/lib/ia.server";
import type { Prioridade, TarefaSugerida } from "@/lib/nota-ia.server";

export type { TarefaSugerida, Prioridade };

/* A porta do "Sugerir tarefas com IA" do Bloco de notas. O trabalho mora em
   `nota-ia.server.ts`; aqui ficam sessão, entrada com teto e limite por pessoa.
   A chave do Claude é lida só aqui dentro e nunca chega ao navegador. */

/** Uma nota inteira cabe com folga; acima disso é colagem de documento. */
const MAX_NOTA = 12_000;

/** Freio de emergência: ninguém precisa analisar a mesma nota 60 vezes por hora. */
const LIMITE_POR_HORA = 60;
const usos = new Map<number, number[]>();

type Entrada = {
  titulo: string;
  conteudo: string;
  pessoas: PessoaDoTime[];
  quemEscreve: string;
  hoje: string;
};

const texto = (v: unknown, teto: number) => (typeof v === "string" ? v.trim().slice(0, teto) : "");

export const sugerirTarefasDaNota = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade(
      (e: {
        titulo?: string;
        conteudo: string;
        pessoas?: PessoaDoTime[];
        quemEscreve?: string;
        hoje: string;
      }): Entrada => {
        const conteudo = texto(e?.conteudo, MAX_NOTA);
        if (!conteudo) throw new Error("A nota está vazia");
        const hoje = texto(e?.hoje, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje)) throw new Error("Data de hoje inválida");
        return {
          titulo: texto(e?.titulo, 120) || "Nota",
          conteudo,
          pessoas: Array.isArray(e?.pessoas)
            ? e.pessoas.slice(0, 400).flatMap((p) => {
                const id = texto(p?.id, 40);
                const nome = texto(p?.nome, 120);
                if (!/^[A-Za-z0-9_-]+$/.test(id) || !nome) return [];
                return [{ id, nome, setor: texto(p?.setor, 60), cargo: texto(p?.cargo, 80) }];
              })
            : [],
          quemEscreve: texto(e?.quemEscreve, 40),
          hoje,
        };
      },
    ),
  )
  .handler(
    comSessao(async (eu, d: Entrada): Promise<{ tarefas: TarefaSugerida[] }> => {
      const agora = Date.now();
      const recentes = (usos.get(eu) ?? []).filter((t) => agora - t < 3_600_000);
      if (recentes.length >= LIMITE_POR_HORA) {
        throw new Error("Muitas análises de nota nesta hora. Tente mais tarde.");
      }
      recentes.push(agora);
      usos.set(eu, recentes);

      const { ErroDaIa } = await import("@/lib/ia.server");
      try {
        const { sugerirTarefasDaNota: analisar } = await import("@/lib/nota-ia.server");
        const r = await analisar({ apiKey: process.env.CLAUDE_API_KEY, ...d });
        // Tokens no log para acompanhar o custo; o conteúdo da nota não.
        console.info(
          `[nota] sugestão para ${eu}: ${r.tokens.entrada} in / ${r.tokens.saida} out, ${r.tarefas.length} tarefa(s)`,
        );
        return { tarefas: r.tarefas };
      } catch (e) {
        if (e instanceof ErroDaIa) {
          console.error(`[nota] sugestão falhou para ${eu}: ${e.message}`);
          throw new Error(e.paraTela);
        }
        throw e;
      }
    }),
  );
