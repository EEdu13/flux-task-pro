import { Component, type ReactNode } from "react";
import { ehFalhaDeCarregamento, MENSAGEM_DE_ATUALIZACAO } from "./falha-de-carregamento";
import { BOTAO_CONTORNO, BOTAO_PRINCIPAL } from "./visual";

type Props = { aoVoltar: () => void; children: ReactNode };
type Estado = { erro: unknown };

/**
 * Segura o erro das telas do conversor carregadas sob demanda (05/11/2026).
 *
 * Sem isto, o `import()` de uma tela que falha — depois de um deploy, o
 * arquivo antigo dá 404 — lançava durante o desenho e o primeiro limite de erro
 * acima era o da raiz do app: a tela inteira virava "Esta página não carregou",
 * e o `React.lazy` guarda a falha, então o clique seguinte derrubava de novo.
 * Aqui a falha fica dentro do conversor, com a frase certa e a saída: voltar à
 * roda, ou recarregar a página.
 */
export class LimiteDeErro extends Component<Props, Estado> {
  state: Estado = { erro: null };

  static getDerivedStateFromError(erro: unknown): Estado {
    return { erro };
  }

  componentDidCatch(erro: unknown) {
    console.warn("[conversor] a tela não carregou", erro);
  }

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;
    return (
      <div className="py-8 text-center" role="alert">
        <p className="mx-auto max-w-sm text-sm text-red-300">
          {ehFalhaDeCarregamento(erro)
            ? MENSAGEM_DE_ATUALIZACAO
            : "Não foi possível abrir esta tela. Tente de novo."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={this.props.aoVoltar} className={BOTAO_CONTORNO}>
            Voltar
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={BOTAO_PRINCIPAL}
          >
            Recarregar a página
          </button>
        </div>
      </div>
    );
  }
}
