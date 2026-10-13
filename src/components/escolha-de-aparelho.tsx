import { useState } from "react";
import { useMediaDeviceSelect } from "@livekit/components-react";
import type { Room } from "livekit-client";
import { Check, ChevronUp, Mic, Speaker, Video } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { gravarMicrofonePreferido } from "@/lib/microfone-preferido";

/**
 * A setinha ao lado do microfone e da câmera, como no Teams: mostra qual
 * aparelho está em uso e deixa trocar sem sair da chamada (pedido do usuário,
 * 12/10/2026: "fico perdido, não sei qual mic ou câmera tá usando").
 *
 * No do microfone vêm também os alto-falantes, quando o navegador deixa
 * escolher a saída. A escolha vira a preferência da prévia da chamada
 * (`fluxo:precall-prefs`), então vale para as próximas reuniões — e o
 * microfone, também para a Tarefa por voz.
 */

const PREFS = "fluxo:precall-prefs";
function gravarCameraPreferida(id: string) {
  try {
    const atual = JSON.parse(window.localStorage.getItem(PREFS) ?? "{}") as Record<string, unknown>;
    window.localStorage.setItem(PREFS, JSON.stringify({ ...atual, camDeviceId: id }));
  } catch {
    /* sem armazenamento: vale só nesta chamada */
  }
}

/** "Padrão - Microfone (Realtek)" → "Microfone (Realtek)", marcado como padrão. */
function rotulo(d: MediaDeviceInfo, i: number, tipo: string): { nome: string; padrao: boolean } {
  const bruto = d.label || `${tipo} ${i + 1}`;
  const padrao = d.deviceId === "default" || /^(padrão|default)\s*-\s*/i.test(bruto);
  return {
    nome: bruto.replace(/^(padrão|default|comunicações|communications)\s*-\s*/i, ""),
    padrao,
  };
}

function Lista({
  titulo,
  Icone,
  kind,
  room,
  aoEscolher,
}: {
  titulo: string;
  Icone: typeof Mic;
  kind: MediaDeviceKind;
  room: Room;
  aoEscolher?: (id: string) => void;
}) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind, room });
  // "communications" é uma cópia do Windows de outro aparelho da lista: só confunde.
  const lista = devices.filter((d) => d.deviceId !== "communications");
  if (lista.length === 0) return null;
  const ativo = activeDeviceId || "default";
  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icone className="h-3 w-3" /> {titulo}
      </div>
      {lista.map((d, i) => {
        const { nome, padrao } = rotulo(d, i, titulo);
        const marcado = d.deviceId === ativo;
        return (
          <button
            key={d.deviceId || i}
            type="button"
            onClick={() => {
              void setActiveMediaDevice(d.deviceId)
                .then(() => {
                  aoEscolher?.(d.deviceId);
                  toast.success(`${titulo}: ${nome}`);
                })
                .catch((e: unknown) =>
                  toast.error(`Não deu para trocar o ${titulo.toLowerCase()}`, {
                    description: e instanceof Error ? e.message : undefined,
                  }),
                );
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-secondary ${
              marcado ? "font-semibold text-foreground" : "text-muted-foreground"
            }`}
          >
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              {marcado && <Check className="h-3.5 w-3.5 text-primary" />}
            </span>
            <span className="min-w-0 flex-1 truncate" title={nome}>
              {nome}
            </span>
            {padrao && (
              <span className="shrink-0 rounded bg-secondary px-1 text-[9px] text-muted-foreground">
                padrão
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const podeEscolherSaida =
  typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

export function EscolhaDeAparelho({ tipo, room }: { tipo: "audio" | "video"; room: Room }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={tipo === "audio" ? "Escolher microfone e alto-falante" : "Escolher câmera"}
          aria-label={tipo === "audio" ? "Escolher microfone e alto-falante" : "Escolher câmera"}
          className="-ml-1.5 flex h-9 w-5 items-center justify-center rounded-r-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="z-[460] w-72 rounded-xl p-1.5">
        {/* Só monta as listas aberto: pedir a lista de aparelhos tem custo. */}
        {aberto &&
          (tipo === "audio" ? (
            <>
              <Lista
                titulo="Microfone"
                Icone={Mic}
                kind="audioinput"
                room={room}
                aoEscolher={(id) => gravarMicrofonePreferido(id)}
              />
              {podeEscolherSaida && (
                <div className="border-t border-border">
                  <Lista titulo="Alto-falante" Icone={Speaker} kind="audiooutput" room={room} />
                </div>
              )}
            </>
          ) : (
            <Lista
              titulo="Câmera"
              Icone={Video}
              kind="videoinput"
              room={room}
              aoEscolher={gravarCameraPreferida}
            />
          ))}
      </PopoverContent>
    </Popover>
  );
}
