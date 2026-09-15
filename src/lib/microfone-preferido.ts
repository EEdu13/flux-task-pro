import { useEffect, useState } from "react";

/**
 * O microfone que a pessoa escolheu, um só para o app inteiro.
 *
 * Mora nas preferências da prévia da chamada (`pre-call.tsx`), que já guardava
 * a escolha. Assim quem escolheu o headset para as reuniões também dita tarefas
 * pelo headset — e trocar na Tarefa por voz vale para a próxima reunião.
 *
 * Existe porque o padrão do Windows costuma ser o microfone do notebook: com o
 * headset no ouvido, a voz chegava pelo microfone de longe, junto com teclado e
 * conversa da sala, e a transcrição saía com trechos inventados.
 */

const CHAVE = "fluxo:precall-prefs";

function lerPrefs(): Record<string, unknown> {
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    const v = bruto ? (JSON.parse(bruto) as unknown) : null;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function lerMicrofonePreferido(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const id = lerPrefs().micDeviceId;
  return typeof id === "string" && id ? id : undefined;
}

export function gravarMicrofonePreferido(id: string | undefined): void {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify({ ...lerPrefs(), micDeviceId: id }));
  } catch {
    /* sem armazenamento, a escolha vale só enquanto a tela está aberta */
  }
}

/**
 * Os microfones ligados agora. Os nomes só vêm depois que o microfone foi
 * liberado uma vez — por isso a lista é refeita quando `refazerQuando` muda
 * (o microfone acabou de abrir) e quando um aparelho entra ou sai.
 */
export function useMicrofonesDisponiveis(refazerQuando: unknown): MediaDeviceInfo[] {
  const [lista, setLista] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const dispositivos = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!dispositivos?.enumerateDevices) return;
    let cancelado = false;
    const listar = () =>
      dispositivos
        .enumerateDevices()
        .then((todos) => {
          if (cancelado) return;
          // "default" e "communications" são apelidos do Windows para um aparelho da lista.
          setLista(
            todos.filter(
              (d) =>
                d.kind === "audioinput" &&
                d.deviceId &&
                d.deviceId !== "default" &&
                d.deviceId !== "communications",
            ),
          );
        })
        .catch(() => {});
    void listar();
    dispositivos.addEventListener("devicechange", listar);
    return () => {
      cancelado = true;
      dispositivos.removeEventListener("devicechange", listar);
    };
  }, [refazerQuando]);
  return lista;
}
