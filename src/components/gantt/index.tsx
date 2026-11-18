import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { ehFalhaDeCarregamento } from "@/components/conversor/falha-de-carregamento";
import type { GanttConectaProps } from "./gantt-conecta";

/**
 * A porta do Gantt (17/11/2026). O SVAR e o CSS dele pesam, e só quem abre a aba
 * precisa deles: o componente vem por `import()`, só no navegador (o SVAR mede a
 * tela, e o servidor não tem tela).
 */
const GanttConecta = lazy(() => import("./gantt-conecta"));

const MENSAGEM_DE_ATUALIZACAO =
  "O CONECTA foi atualizado enquanto estava aberto. Recarregue a página (Ctrl+R) para ver o Gantt.";

/**
 * Segura o erro do Gantt aqui dentro, como o conversor faz (05/11/2026): depois
 * de um deploy com a aba aberta, o arquivo antigo do Gantt dá 404, e sem este
 * limite a tela inteira cairia no erro da raiz.
 */
class LimiteDoGantt extends Component<{ children: ReactNode }, { erro: unknown }> {
  state = { erro: null as unknown };

  static getDerivedStateFromError(erro: unknown) {
    return { erro };
  }

  componentDidCatch(erro: unknown) {
    console.warn("[gantt] não carregou", erro);
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
        role="alert"
      >
        <p className="max-w-sm text-sm text-muted-foreground">
          {ehFalhaDeCarregamento(this.state.erro)
            ? MENSAGEM_DE_ATUALIZACAO
            : "Não foi possível mostrar o Gantt. Recarregue a página para tentar de novo."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
        >
          Recarregar a página
        </button>
      </div>
    );
  }
}

function Carregando() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Abrindo o Gantt…
    </div>
  );
}

export function GanttDoProjeto(props: GanttConectaProps) {
  /* Só depois de montar: no servidor (SSR) a aba desenha o "Abrindo". */
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  return (
    <LimiteDoGantt>
      {montado ? (
        <Suspense fallback={<Carregando />}>
          <GanttConecta {...props} />
        </Suspense>
      ) : (
        <Carregando />
      )}
    </LimiteDoGantt>
  );
}
