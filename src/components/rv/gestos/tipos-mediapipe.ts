/*
 * tipos-mediapipe.ts — tipos MÍNIMOS da conversa página ↔ worker de gestos.
 *
 * Por que locais: o @mediapipe/tasks-vision não está no package.json (vem da CDN dentro do
 * worker), então não dá para importar os tipos do pacote. Só o que atravessa o postMessage é
 * descrito aqui; o objeto do MediaPipe em si nunca sai do worker.
 */
import type { MaoDetectada, Ponto } from "@/lib/rv-gestos-heuristica";
import type { UrlsDoMediapipe } from "./urls-mediapipe";

export type DelegateMp = "GPU" | "CPU";

/** Página → worker. */
export type MensagemParaWorker =
  | { tipo: "iniciar"; urls: UrlsDoMediapipe }
  /** O ImageBitmap é TRANSFERIDO (o worker fecha). comMao = rodar também o GestureRecognizer. */
  | { tipo: "quadro"; bmp: ImageBitmap; t: number; comMao: boolean }
  | { tipo: "parar" };

/** Worker → página. */
export type MensagemDoWorker =
  | { tipo: "pronto"; delegate: DelegateMp }
  | {
      tipo: "resultado";
      t: number;
      /** ms gastos no detect (pose + mãos, se rodou). */
      ms: number;
      /** Só o detect do corpo (sem o reconhecedor de mãos). */
      msPose?: number;
      /** 33 pontos da pessoa principal, ou null. */
      pose: Ponto[] | null;
      /** Só quando o GestureRecognizer rodou neste quadro (undefined = não rodou). */
      maos?: MaoDetectada[];
      /** Nome do gesto de cada mão ("Thumb_Up"…), para diagnóstico. */
      gestosDeMao?: (string | null)[];
      /** O quadro falhou (o laço segue; muitos seguidos viram erro). */
      falha?: string;
    }
  | { tipo: "erro"; mensagem: string }
  /** Problema não fatal (ex.: o reconhecedor de mãos não carregou; o corpo segue). */
  | { tipo: "aviso"; mensagem: string };
