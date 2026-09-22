/**
 * Quanto você ouve cada pessoa nas chamadas — não o que ela manda, só o que
 * chega no seu alto-falante. `RemoteParticipant.setVolume()` já existe pronto
 * no LiveKit para isso; o que faltava era lembrar a escolha.
 *
 * Guardado por PESSOA, não por sala nem por chamada: se você sempre acha que
 * o Fulano fala baixo, o ajuste feito hoje já vale na reunião de amanhã, sem
 * precisar repetir o clique direito toda vez.
 *
 * A identidade do LiveKit é "<id>-<nome>" (ver `identity` em
 * `salas.$roomName.tsx`); a chave usada aqui é só o `<id>`, igual ao que o
 * servidor já faz em `setRoomPrivacy` para reconhecer quem é quem. Convidado
 * por link tem identidade `guest-<sorteio>` — cai todo mundo na mesma chave
 * "guest", então ajustar UM convidado afeta o próximo também. É uma imprecisão
 * aceita: convidado é visita de uma vez, não alguém que se ajusta com o tempo.
 */

const CHAVE = "fluxo:volume-por-pessoa";
/** 100% — o volume normal, sem ajuste. Não vale a pena gravar linha para isto. */
const PADRAO = 1;

function pessoaDaIdentidade(identity: string): string {
  return identity.split("-")[0] || identity;
}

function ler(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CHAVE);
    if (!raw) return {};
    const obj: unknown = JSON.parse(raw);
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return {};
    return obj as Record<string, number>;
  } catch {
    return {};
  }
}

/** O volume guardado para esta pessoa, ou 1 (100%) se nunca foi ajustado. */
export function volumeGuardado(identity: string): number {
  const v = ler()[pessoaDaIdentidade(identity)];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : PADRAO;
}

/** Grava a escolha. Voltar para 100% apaga a linha, em vez de guardar o óbvio. */
export function guardarVolume(identity: string, volume: number): void {
  if (typeof window === "undefined") return;
  const chave = pessoaDaIdentidade(identity);
  const mapa = ler();
  if (volume === PADRAO) delete mapa[chave];
  else mapa[chave] = volume;
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(mapa));
  } catch {
    // Sem armazenamento: o ajuste ainda vale para o resto desta ligação —
    // quem chamou já aplicou o volume no participante antes de tentar gravar.
  }
}
