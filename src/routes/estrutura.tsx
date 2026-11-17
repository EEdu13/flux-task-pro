import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TelaDaEstrutura } from "@/components/estrutura/tela-da-estrutura";

/* A estrutura do dia (Parte A, spec de 04/11/2026). Escondida: só abre para quem tem
   equipe e permissão (ver `estrutura-liberada.ts`); quem não tem volta para o Início.
   `?equipe=` e `?dia=` (AAAA-MM-DD) dizem o que está aberto, e o card do Início e o
   lembrete do Pack já levam para a equipe certa. */
export const Route = createFileRoute("/estrutura")({
  validateSearch: (s: Record<string, unknown>): { equipe?: string; dia?: string } => ({
    ...(typeof s.equipe === "string" && /^[0-9A-Za-z]{2,16}$/.test(s.equipe)
      ? { equipe: s.equipe.toUpperCase() }
      : {}),
    ...(typeof s.dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.dia) ? { dia: s.dia } : {}),
  }),
  head: () => ({ meta: [{ title: "Estrutura do dia · SGL - CONECTA" }] }),
  component: EstruturaPage,
});

function EstruturaPage() {
  const { equipe, dia } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <TelaDaEstrutura
      equipePedida={equipe}
      diaPedido={dia}
      aoMudarBusca={(busca) => void navigate({ to: "/estrutura", search: busca, replace: true })}
    />
  );
}
