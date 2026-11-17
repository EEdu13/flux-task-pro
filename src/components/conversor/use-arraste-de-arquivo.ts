import { useEffect, useState } from "react";

export type ArrasteDeArquivo = {
  /** Há arquivo do computador sendo arrastado por cima da janela. */
  ativo: boolean;
  /** O MIME de cada item. Pode vir vazio: o Windows não informa tipo para .heic. */
  tipos: string[];
  /** O ponteiro está sobre uma área que já recebe arquivo (chat, grade de criação, arquivos do projeto). */
  sobreArea: boolean;
};

const PARADO: ArrasteDeArquivo = { ativo: false, tipos: [], sobreArea: false };

/** Sem `dragover` por este tempo, o arraste acabou (o arquivo foi solto ou saiu da janela). */
const SILENCIO_MS = 350;

/** Um arraste de dentro da página que ficou sem `dragend` por mais que isto não existe mais. */
const SILENCIO_INTERNO_MS = 1000;

function temArquivo(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
}

/**
 * Percebe um arquivo do Windows arrastado para a janela (04/11/2026) — é o que
 * faz a faixa "Solte aqui para converter" aparecer. Só arquivo de verdade:
 * arrastar tarefa, texto ou link (que levam `text/plain`) não conta.
 *
 * Também não conta o arraste que COMEÇOU dentro da página: no Chromium, puxar
 * uma foto do chat, um avatar ou uma imagem do Mural põe a imagem no arraste
 * como se fosse arquivo (`types` traz "Files"), e a faixa aparecia sem motivo.
 * O `dragstart` só dispara para arraste de dentro, então é ele que marca.
 *
 * A trava do soltar no vazio (o arquivo solto fora de quem o recebe não abre na
 * janela) morava aqui até 12/11/2026. Agora é do app inteiro, montada na raiz:
 * `src/lib/trava-de-soltar.ts`.
 *
 * O `dragover` é ouvido na CAPTURA só para saber que o arraste segue vivo: há
 * cartões (o calendário, o painel de delegar) que param a propagação dele, e
 * sem a captura a faixa sumia e voltava a cada cartão.
 */
export function useArrasteDeArquivo(ligado: boolean): ArrasteDeArquivo {
  const [estado, setEstado] = useState<ArrasteDeArquivo>(PARADO);

  useEffect(() => {
    if (!ligado) return;
    let ultimoSinal = 0;
    let vigia: number | undefined;
    let interno = false;
    let ultimoSinalInterno = 0;

    const encerrar = () => {
      if (vigia !== undefined) window.clearInterval(vigia);
      vigia = undefined;
      setEstado(PARADO);
    };
    /* Rede de segurança: o arquivo solto no vazio ou levado para fora da
       janela nem sempre avisa com `dragleave`. Sem `dragover`, acabou. */
    const vigiar = () => {
      if (vigia !== undefined) return;
      vigia = window.setInterval(() => {
        if (Date.now() - ultimoSinal > SILENCIO_MS) encerrar();
      }, 150);
    };

    const aoComecar = () => {
      interno = true;
      ultimoSinalInterno = Date.now();
    };
    const aoTerminar = () => {
      interno = false;
      encerrar();
    };

    const aoEntrar = (e: DragEvent) => {
      // Elemento tirado da tela no meio do arraste não avisa o `dragend`.
      if (interno && Date.now() - ultimoSinalInterno > SILENCIO_INTERNO_MS) interno = false;
      if (!temArquivo(e) || interno) return;
      ultimoSinal = Date.now();
      const tipos = Array.from(e.dataTransfer?.items ?? [])
        .filter((i) => i.kind === "file")
        .map((i) => i.type);
      setEstado((s) => (s.ativo ? s : { ativo: true, tipos, sobreArea: false }));
      vigiar();
    };

    const aoPassarNaCaptura = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      if (interno) {
        ultimoSinalInterno = Date.now();
        return;
      }
      ultimoSinal = Date.now();
      const alvo = e.target instanceof Element ? e.target : null;
      const sobreArea = !!alvo?.closest("[data-aceita-arquivo]");
      setEstado((s) =>
        s.ativo && s.sobreArea === sobreArea ? s : { ...s, ativo: true, sobreArea },
      );
      vigiar();
    };

    const aoSoltar = () => {
      interno = false;
      encerrar();
    };

    const aoSair = (e: DragEvent) => {
      // Saiu pela borda da janela.
      if (
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight
      ) {
        encerrar();
      }
    };

    window.addEventListener("dragstart", aoComecar, true);
    window.addEventListener("dragenter", aoEntrar, true);
    window.addEventListener("dragover", aoPassarNaCaptura, true);
    window.addEventListener("drop", aoSoltar);
    window.addEventListener("dragleave", aoSair);
    window.addEventListener("dragend", aoTerminar);
    return () => {
      if (vigia !== undefined) window.clearInterval(vigia);
      window.removeEventListener("dragstart", aoComecar, true);
      window.removeEventListener("dragenter", aoEntrar, true);
      window.removeEventListener("dragover", aoPassarNaCaptura, true);
      window.removeEventListener("drop", aoSoltar);
      window.removeEventListener("dragleave", aoSair);
      window.removeEventListener("dragend", aoTerminar);
    };
  }, [ligado]);

  return estado;
}
