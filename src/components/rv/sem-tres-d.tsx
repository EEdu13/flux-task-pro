import { Component, type ReactNode } from "react";

/**
 * Proteção de todo desenho 3D do app (20/10/2026).
 *
 * Sem WebGL — computador velho, placa de vídeo bloqueada pela política da
 * empresa, área de trabalho remota — o three.js lança um erro ao criar o
 * <Canvas>, e sem esta caixa o erro subia e derrubava a tela inteira: o
 * Início (o boneco acenando), o chat (a reação de avatar), o Mural. Aqui ele
 * para: some só o boneco, e no lugar fica a `reserva` (nada, por padrão).
 */
export class SemTresD extends Component<
  { reserva?: ReactNode; children: ReactNode },
  { erro: boolean }
> {
  state = { erro: false };

  static getDerivedStateFromError() {
    return { erro: true };
  }

  componentDidCatch(e: unknown) {
    console.warn("[3D] não abriu neste computador:", (e as Error)?.message);
  }

  render() {
    return this.state.erro ? (this.props.reserva ?? null) : this.props.children;
  }
}
