import { useState } from "react";
import { Keyboard } from "lucide-react";
import { toast } from "sonner";
import { useFluxo } from "@/lib/fluxo-store";
import { salvarPreferenciaDoConversor, usePreferenciaDoConversor } from "./preferencia";

/**
 * O interruptor "Abrir o conversor segurando Ctrl" (Configurações → Aparência,
 * 04/11/2026). Ligado por padrão, como pede a especificação. Desligar tira só
 * o atalho do Ctrl: o raio, a barra lateral, o Ctrl+K e o arrastar continuam.
 *
 * Grava na hora; se o banco recusar, o interruptor volta sozinho
 * (`salvarPreferenciaDoConversor` desfaz) e o aviso conta.
 */
export function OpcaoDoCtrl() {
  const { currentUser } = useFluxo();
  const ligado = usePreferenciaDoConversor(currentUser.id);
  const [salvando, setSalvando] = useState(false);

  const alternar = async () => {
    setSalvando(true);
    try {
      await salvarPreferenciaDoConversor(currentUser.id, !ligado);
    } catch {
      toast.error("Não foi possível salvar a preferência");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Keyboard className="h-4 w-4" /> Abrir o conversor segurando Ctrl
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Segure o Ctrl sozinho por um instante, fora de campos de texto, e o conversor de arquivos
          abre. Desligado, ele continua no raio, na barra lateral e no Ctrl+K.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label="Abrir o conversor segurando Ctrl"
        disabled={salvando}
        onClick={() => void alternar()}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition disabled:opacity-60 ${
          ligado ? "bg-primary" : "bg-secondary"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
            ligado ? "left-4" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
