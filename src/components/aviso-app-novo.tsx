import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { isTauri } from "@/lib/attachments";

/**
 * Aviso de "app novo" para quem ainda está numa versão SEM o atualizador
 * automático (antes da 0.2.2).
 *
 * Da 0.2.2 em diante o próprio app se atualiza sozinho (ver `lib.rs`,
 * `iniciar_atualizador`) e este aviso não aparece. Para as máquinas que já
 * estão instaladas com a versão antiga não existe caminho automático — o app
 * velho não sabe se atualizar —, então o site, que ele carrega, oferece o
 * instalador num clique. É a última instalação feita à mão (pedido do usuário,
 * 09/10/2026: "imagina o trabalho instalar em mais de 30 máquinas").
 */
const PRIMEIRA_COM_ATUALIZADOR = "0.2.2";
const CHAVE_ADIADO = "fluxo:app-novo-adiado";

function maior(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

export function AvisoDeAppNovo() {
  const [novo, setNovo] = useState<{ versao: string; url: string } | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let vivo = true;
    void (async () => {
      try {
        if (sessionStorage.getItem(CHAVE_ADIADO)) return;
      } catch {
        /* sem sessionStorage: segue mostrando */
      }
      // Versão instalada; se nem isso responder, é app antigo.
      let atual = "0.0.0";
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        atual = await getVersion();
      } catch {
        /* app antigo sem permissão de versão: trata como antigo */
      }
      if (!maior(PRIMEIRA_COM_ATUALIZADOR, atual)) return; // já se atualiza sozinho
      const r = await fetch("/api/public/app/latest").catch(() => null);
      if (!r || r.status !== 200) return;
      const latest = (await r.json()) as {
        version: string;
        platforms?: Record<string, { url: string }>;
      };
      const url = latest.platforms?.["windows-x86_64"]?.url;
      if (vivo && url && maior(latest.version, atual)) setNovo({ versao: latest.version, url });
    })();
    return () => {
      vivo = false;
    };
  }, []);

  if (!novo) return null;

  const adiar = () => {
    try {
      sessionStorage.setItem(CHAVE_ADIADO, "1");
    } catch {
      /* ignora */
    }
    setNovo(null);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[250] w-[22rem] rounded-xl border border-primary/40 bg-card p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Download className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">App novo disponível ({novo.versao})</div>
          <p className="mt-1 text-xs text-muted-foreground">
            A partir desta versão o app <b>se atualiza sozinho</b>. Baixe, abra o arquivo baixado e
            clique em instalar — é a última vez que precisa fazer isso.
          </p>
          <div className="mt-3 flex gap-2">
            <a
              href={novo.url}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
            >
              <Download className="h-3.5 w-3.5" /> Baixar instalador
            </a>
            <button
              type="button"
              onClick={adiar}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
            >
              Depois
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={adiar}
          className="rounded p-1 text-muted-foreground hover:bg-secondary"
          title="Fechar"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
