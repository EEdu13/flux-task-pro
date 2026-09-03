import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, Database, HardDrive } from "lucide-react";

/**
 * Conferência do que sobrou no navegador, sem importar nada.
 *
 * Ao remover o dado falso, a chave do estado passou de `fluxo.state.v2` para
 * `v3`. Isso zerou a tela de todo mundo — inclusive o trabalho real que
 * houvesse. O `v2` não foi apagado: continua aqui, apenas sem ninguém lendo.
 *
 * Esta tela existe para responder uma pergunta antes de decidir o que fazer com
 * ele: TEM alguma coisa ali? Ela só conta e mostra. Não importa, não apaga, não
 * grava nada — de propósito, porque decidir com número na mão é diferente de
 * decidir no escuro, e porque a importação de verdade precisa saber para qual
 * pessoa cada linha vai.
 *
 * Vale enquanto ninguém limpar os dados do navegador. Depois disso não há volta.
 */
export const Route = createFileRoute("/conferir-dados-antigos")({
  head: () => ({
    meta: [{ title: "Dados antigos · Fluxo" }],
  }),
  component: ConferirDadosAntigos,
});

/** Todas as chaves que o Fluxo já usou para guardar estado. */
const CHAVES = [
  { chave: "fluxo.state.v2", rotulo: "Estado anterior (v2)", antiga: true },
  { chave: "fluxo.state.v3", rotulo: "Estado atual (v3)", antiga: false },
];

type Contagem = { rotulo: string; quantidade: number; detalhe?: string };

type Achado = {
  chave: string;
  rotulo: string;
  antiga: boolean;
  existe: boolean;
  tamanhoKb: number;
  contagens: Contagem[];
  erro?: string;
};

/** Conta o que interessa dentro do estado salvo, sem interpretar demais. */
function analisar(bruto: string): { contagens: Contagem[]; erro?: string } {
  let dados: Record<string, unknown>;
  try {
    dados = JSON.parse(bruto) as Record<string, unknown>;
  } catch {
    return { contagens: [], erro: "O conteúdo não é um JSON válido." };
  }

  const lista = (campo: string): unknown[] =>
    Array.isArray(dados[campo]) ? (dados[campo] as unknown[]) : [];

  const tarefas = lista("tasks");
  const pessoas = lista("users");

  /* Quantas tarefas foram delegadas para outra pessoa é o número mais
     revelador desta tela: é exatamente o trabalho que nunca chegou em
     ninguém, porque o dado não saía do navegador. */
  const dono = typeof dados.currentUserId === "string" ? dados.currentUserId : "";
  const delegadas = tarefas.filter((t) => {
    const tarefa = t as { assigneeId?: string };
    return typeof tarefa.assigneeId === "string" && tarefa.assigneeId !== dono;
  }).length;

  const concluidas = tarefas.filter((t) => (t as { status?: string }).status === "concluida")
    .length;

  return {
    contagens: [
      { rotulo: "Tarefas", quantidade: tarefas.length, detalhe: `${concluidas} concluídas` },
      {
        rotulo: "Delegadas a outra pessoa",
        quantidade: delegadas,
        detalhe: delegadas ? "nunca chegaram em ninguém" : undefined,
      },
      { rotulo: "Projetos", quantidade: lista("projects").length },
      { rotulo: "Atas", quantidade: lista("minutes").length },
      { rotulo: "Metas", quantidade: lista("metas").length },
      { rotulo: "Conclusões registradas", quantidade: lista("completions").length },
      { rotulo: "Modelos de pack", quantidade: lista("packTemplates").length },
      { rotulo: "Pessoas conhecidas", quantidade: pessoas.length },
    ],
  };
}

function ConferirDadosAntigos() {
  const [achados, setAchados] = useState<Achado[] | null>(null);

  useEffect(() => {
    // No servidor não existe localStorage; a leitura tem que esperar a montagem.
    const lidos: Achado[] = CHAVES.map(({ chave, rotulo, antiga }) => {
      let bruto: string | null = null;
      try {
        bruto = localStorage.getItem(chave);
      } catch {
        return {
          chave,
          rotulo,
          antiga,
          existe: false,
          tamanhoKb: 0,
          contagens: [],
          erro: "O navegador não deixou ler o armazenamento.",
        };
      }
      if (!bruto) {
        return { chave, rotulo, antiga, existe: false, tamanhoKb: 0, contagens: [] };
      }
      const { contagens, erro } = analisar(bruto);
      return {
        chave,
        rotulo,
        antiga,
        existe: true,
        // Cada caractere UTF-16 ocupa 2 bytes no localStorage.
        tamanhoKb: Math.round((bruto.length * 2) / 1024),
        contagens,
        erro,
      };
    });
    setAchados(lidos);
  }, []);

  const antigo = achados?.find((a) => a.antiga);
  const temConteudo = !!antigo?.existe && antigo.contagens.some((c) => c.quantidade > 0);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <HardDrive className="h-3.5 w-3.5" />
          Conferência
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">O que ficou neste computador</h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Quando o dado de demonstração saiu, o Fluxo passou a usar uma chave nova de
          armazenamento. O conteúdo anterior continua guardado aqui, sem ser lido. Esta
          tela só conta o que existe — ela não importa, não apaga e não grava nada.
        </p>
      </header>

      {achados === null ? (
        <p className="text-sm text-muted-foreground">Lendo o armazenamento…</p>
      ) : (
        <>
          {temConteudo && (
            <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="flex flex-col gap-1.5 text-sm">
                <strong className="font-semibold">Há conteúdo guardado aqui.</strong>
                <span className="text-muted-foreground">
                  Não limpe os dados do navegador nem desinstale o aplicativo neste
                  computador até decidirmos o que fazer com isto. Depois disso não há como
                  recuperar.
                </span>
              </div>
            </div>
          )}

          {achados.map((a) => (
            <section key={a.chave} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  {a.rotulo}
                </h2>
                <code className="text-xs text-muted-foreground">
                  {a.chave}
                  {a.existe ? ` · ${a.tamanhoKb} KB` : ""}
                </code>
              </div>

              {a.erro ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  {a.erro}
                </p>
              ) : !a.existe ? (
                <p className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
                  Nada guardado sob esta chave neste computador.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <tbody>
                      {a.contagens.map((c) => (
                        <tr key={c.rotulo} className="border-b border-border last:border-b-0">
                          <td className="px-4 py-2.5">{c.rotulo}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {c.detalhe ?? ""}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-mono tabular-nums ${
                              c.quantidade > 0 ? "font-semibold" : "text-muted-foreground"
                            }`}
                          >
                            {c.quantidade}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}

          <footer className="border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">
            {temConteudo ? (
              <>
                Com esses números dá para decidir: se for pouco, começamos limpo no banco;
                se houver trabalho de verdade, vale escrever a importação. Mande esta tela
                para quem estiver conduzindo a migração.
              </>
            ) : (
              <>
                Nada relevante guardado aqui. Neste computador, a migração pode começar do
                zero sem perder nada. Vale conferir nas outras máquinas antes de concluir.
              </>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
