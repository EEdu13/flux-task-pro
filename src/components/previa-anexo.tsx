import { useEffect, useState } from "react";
import { Download, ExternalLink, FileText, Loader2, X } from "lucide-react";
import { useEscFecha } from "@/hooks/use-esc-fecha";
import { TravaScroll } from "@/components/trava-scroll";
import {
  EVENTO_PREVIA,
  abrirNoPrograma,
  blobDoAnexo,
  downloadAttachment,
  formatBytes,
  isTauri,
  type AnexoParaPrevia,
} from "@/lib/attachments";

/**
 * A prévia do anexo, dentro do app — pedido do usuário, 09/10/2026: abrir
 * direto no programa do Windows piscava janelas de terminal e tirava a pessoa
 * da tela. Agora o clique mostra o arquivo aqui e a pessoa decide se baixa.
 *
 * Imagem, PDF e texto aparecem na prévia. Planilha, Word e afins não têm como
 * ser desenhados no navegador: aparece o cartão do arquivo com "Baixar" (e,
 * no app de mesa, "Abrir no programa").
 *
 * Montada uma vez na raiz; qualquer tela chama `openAttachment(a)`.
 */

type Tipo = "imagem" | "pdf" | "texto" | "outro";

const EXT_TEXTO = /\.(txt|csv|md|json|log|xml)$/i;

function tipoDe(nome: string, mime: string): Tipo {
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(nome)) return "imagem";
  if (mime === "application/pdf" || /\.pdf$/i.test(nome)) return "pdf";
  if (mime.startsWith("text/") || EXT_TEXTO.test(nome)) return "texto";
  return "outro";
}

/** Texto acima disso fica cortado na prévia: é para bater o olho, não ler 5 MB. */
const MAX_TEXTO = 200_000;

export function PreviaDoAnexoHost() {
  const [anexo, setAnexo] = useState<AnexoParaPrevia | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [texto, setTexto] = useState<string | null>(null);
  const [tipo, setTipo] = useState<Tipo>("outro");
  const [tamanho, setTamanho] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    const abrir = (e: Event) => setAnexo((e as CustomEvent<AnexoParaPrevia>).detail);
    window.addEventListener(EVENTO_PREVIA, abrir);
    return () => window.removeEventListener(EVENTO_PREVIA, abrir);
  }, []);

  // Busca os bytes uma vez por anexo aberto; o endereço local some ao fechar.
  useEffect(() => {
    if (!anexo) return;
    let vivo = true;
    let criado: string | null = null;
    setUrl(null);
    setTexto(null);
    setErro(null);
    setCarregando(true);
    void (async () => {
      try {
        const blob = await blobDoAnexo(anexo.dataUrl);
        if (!vivo) return;
        const t = tipoDe(anexo.name, anexo.type || blob.type || "");
        setTipo(t);
        setTamanho(anexo.size ?? blob.size);
        if (t === "texto") {
          const bruto = await blob.text();
          if (vivo) setTexto(bruto.length > MAX_TEXTO ? bruto.slice(0, MAX_TEXTO) + "\n…" : bruto);
        } else if (t !== "outro") {
          // PDF precisa do tipo certo no blob, senão o leitor embutido não abre.
          const certo =
            t === "pdf" && blob.type !== "application/pdf"
              ? new Blob([blob], { type: "application/pdf" })
              : blob;
          criado = URL.createObjectURL(certo);
          if (vivo) setUrl(criado);
        }
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : "Não foi possível carregar o anexo.");
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
      if (criado) URL.revokeObjectURL(criado);
    };
  }, [anexo]);

  const fechar = () => setAnexo(null);
  useEscFecha(!!anexo, fechar);
  if (!anexo) return null;

  const app = isTauri();
  const ext = anexo.name.includes(".") ? anexo.name.split(".").pop()!.toUpperCase() : "ARQUIVO";

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={fechar}
    >
      <TravaScroll />
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{anexo.name}</div>
            {tamanho != null && (
              <div className="text-[11px] text-muted-foreground">{formatBytes(tamanho)}</div>
            )}
          </div>
          {app && (
            <button
              type="button"
              onClick={() => abrirNoPrograma(anexo)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
              title="Abrir no programa padrão do Windows"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Abrir no programa
            </button>
          )}
          <button
            type="button"
            onClick={() => downloadAttachment(anexo)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
          >
            <Download className="h-3.5 w-3.5" /> Baixar
          </button>
          <button
            type="button"
            onClick={fechar}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Fechar (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-[320px] flex-1 items-center justify-center overflow-auto bg-secondary/40">
          {carregando ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : erro ? (
            <div className="max-w-sm p-6 text-center text-sm text-muted-foreground">{erro}</div>
          ) : tipo === "imagem" && url ? (
            <img src={url} alt={anexo.name} className="max-h-[80vh] max-w-full object-contain" />
          ) : tipo === "pdf" && url ? (
            <iframe src={url} title={anexo.name} className="h-[80vh] w-full border-0 bg-white" />
          ) : tipo === "texto" && texto != null ? (
            <pre className="h-[80vh] w-full overflow-auto whitespace-pre-wrap p-4 font-mono text-xs">
              {texto}
            </pre>
          ) : (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <div className="flex h-20 w-16 items-center justify-center rounded-lg border border-border bg-card text-xs font-bold text-muted-foreground shadow-sm">
                {ext}
              </div>
              <div className="text-sm font-medium">{anexo.name}</div>
              <p className="max-w-sm text-xs text-muted-foreground">
                Este tipo de arquivo não tem pré-visualização aqui.{" "}
                {app
                  ? "Baixe ou abra no programa para ver."
                  : "Baixe para abrir no seu computador."}
              </p>
              <button
                type="button"
                onClick={() => downloadAttachment(anexo)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:brightness-110"
              >
                <Download className="h-3.5 w-3.5" /> Baixar arquivo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
