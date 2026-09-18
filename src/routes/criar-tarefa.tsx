import { createFileRoute } from "@tanstack/react-router";
import { FluxoLayout } from "@/components/fluxo-layout";
import { InlineTaskCreator } from "@/components/inline-task-creator";

export const Route = createFileRoute("/criar-tarefa")({
  head: () => ({
    meta: [
      { title: "Criar tarefa — Fluxo" },
      {
        name: "description",
        content:
          "Planilha de criação: uma linha por tarefa, com prazo, responsável, prioridade e anexos.",
      },
    ],
  }),
  component: CriarTarefaPage,
});

/*
 * Aba dedicada da planilha de criação.
 *
 * Antes isto só existia dentro de um modal, e lá a tabela nunca cabia: o cartão
 * tinha teto de altura e de largura, então as colunas viviam espremidas com
 * barra de rolagem horizontal. Aqui a grade ocupa a mesma largura das outras
 * abas e cresce para baixo com a página.
 *
 * A rota não desenha cabeçalho nenhum de propósito: quem traz o título, a
 * contagem e o botão de criar é o próprio `InlineTaskCreator` em modo página,
 * numa faixa só que gruda no topo. Dois cabeçalhos — um da rota e um da grade —
 * era justamente a moldura repetida que esta tela tinha a mais.
 *
 * O modal continua existindo, aberto pelo "+ Nova" da barra de cima — é o
 * caminho de quem quer uma tarefa só, sem sair da tela em que está.
 */
function CriarTarefaPage() {
  return (
    <FluxoLayout title="Criar tarefa" breadcrumb="Execução">
      {/* Mesmo teto das outras abas (relatórios, equipe, início): a área já é o
          que sobra ao lado da barra lateral, então recolher a barra devolve a
          largura para a tabela sozinho. */}
      <div className="mx-auto w-full max-w-[2200px]">
        <InlineTaskCreator emPagina />
      </div>
    </FluxoLayout>
  );
}
