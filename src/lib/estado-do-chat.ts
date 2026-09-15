/**
 * Os status que a pessoa escolhe no chat.
 *
 * "Offline" não está aqui de propósito: ninguém escolhe ficar offline — é o que
 * a presença conclui quando o app para de bater o heartbeat. O status escolhido
 * só aparece para os outros enquanto a pessoa está online.
 */
export const ESTADOS = ["disponivel", "ocupado", "ausente"] as const;
export type EstadoDoChat = (typeof ESTADOS)[number];

/** O que a tela mostra de cada status — inclusive quem está offline. */
export type SituacaoNoChat = EstadoDoChat | "offline";

export const INFO_DO_ESTADO: Record<
  SituacaoNoChat,
  { rotulo: string; descricao: string; ponto: string; texto: string }
> = {
  disponivel: {
    rotulo: "Disponível",
    descricao: "Mensagens chegam com som e aviso normalmente.",
    ponto: "bg-success",
    texto: "text-success",
  },
  ocupado: {
    rotulo: "Ocupado",
    descricao: "Mensagens chegam sem som. Os outros veem que você está concentrado.",
    ponto: "bg-destructive",
    texto: "text-destructive",
  },
  ausente: {
    rotulo: "Ausente",
    descricao:
      "Longe do computador por um tempo. Mensagens continuam com som. No app de desktop, entra sozinho após 5 minutos sem mexer no computador.",
    ponto: "bg-warning",
    texto: "text-warning",
  },
  offline: {
    rotulo: "Offline",
    descricao: "Com o app fechado.",
    ponto: "bg-muted-foreground/40",
    texto: "text-muted-foreground",
  },
};

/** Valor vindo do banco ou da rede → status válido. Sem status conta como disponível. */
export function paraEstado(v: unknown): EstadoDoChat {
  return (ESTADOS as readonly string[]).includes(v as string) ? (v as EstadoDoChat) : "disponivel";
}
