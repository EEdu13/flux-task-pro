import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CalendarDays, Lock, MapPin, Video } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { UserAvatar } from "@/components/user-avatar";
import { flashTitle } from "@/components/attention-overlay";
import { desktopBringToFront } from "@/lib/desktop";
import { nomeCurto } from "@/lib/nome-curto";
import { rotuloDaSala } from "@/lib/rooms";
import {
  ehAlertaDeCompromisso,
  faixaDeHorario,
  horaCurta,
  type Compromisso,
} from "@/lib/compromisso";
import { detalharCompromisso } from "@/lib/compromissos.functions";
import type { Notification as Aviso } from "@/lib/fluxo-types";

/* O cartão de "sua agenda começa em X min" (pedido do usuário, 14/10/2026):
 * "30 e 10 min antes o CONECTA vem pra primeiro plano e mostra um card
 * avisando que ela tem uma agenda às xx horas com xxxx, com o avatar/foto e o
 * assunto. Inclusive avisa quem criou."
 *
 * Não há sondagem própria. O aviso nasce no servidor durante a leitura da
 * sineta que o app já faz a cada minuto (`entregarAlertasDeCompromisso`), e
 * chega aqui como uma notificação nova do tipo 'compromisso' com o título
 * "Agenda em …" (`ehAlertaDeCompromisso`). O som e a notificação do Windows
 * seguem o caminho de todo aviso (ver `FluxoLayout`); aqui só se traz a janela
 * para frente e se desenha o cartão. Os detalhes (pessoas, sala) vêm de UMA
 * leitura do compromisso, só quando o aviso chega.
 *
 * Montado uma vez, na raiz (`GlobaisDoApp`), para sobreviver à troca de página.
 */

/** Aviso mais velho que isto não vira cartão — é de antes, já passou da hora. */
const VALIDADE_MS = 15 * 60_000;

type Cartao = { aviso: Aviso; compromisso: Compromisso | null };

export function AlertaDeCompromisso() {
  const { notifications, currentUser, users, markNotifRead } = useFluxo();
  const navigate = useNavigate();
  const [fila, setFila] = useState<Cartao[]>([]);
  const vistos = useRef<Set<string>>(new Set());
  /* Não cancela a leitura quando a sineta muda de novo (o "Ok" de outro aviso,
     a próxima volta do relógio): o id já foi anotado em `vistos`, e cancelar
     perderia o cartão. Só não mexe no estado depois de desmontar. */
  const montado = useRef(true);
  useEffect(
    () => () => {
      montado.current = false;
    },
    [],
  );

  useEffect(() => {
    const agora = Date.now();
    const novos = notifications.filter(
      (n) =>
        n.userId === currentUser.id &&
        !n.read &&
        ehAlertaDeCompromisso(n) &&
        !vistos.current.has(n.id) &&
        agora - Date.parse(n.at) < VALIDADE_MS,
    );
    for (const n of notifications) if (ehAlertaDeCompromisso(n)) vistos.current.add(n.id);
    if (novos.length === 0) return;

    void Promise.all(
      novos.map(async (aviso): Promise<Cartao> => {
        if (!aviso.compromissoId) return { aviso, compromisso: null };
        try {
          const r = await detalharCompromisso({ data: { id: aviso.compromissoId } });
          return { aviso, compromisso: r.compromisso };
        } catch {
          return { aviso, compromisso: null };
        }
      }),
    ).then((cartoes) => {
      if (!montado.current) return;
      setFila((f) => [...f, ...cartoes]);
      const primeiro = cartoes[0]!;
      flashTitle(
        `⏰ ${primeiro.compromisso ? primeiro.compromisso.assunto : primeiro.aviso.title}`,
      );
      /* Puxa a janela para frente (app de desktop) por mais tempo que a
         cutucada: é um cartão para ler e decidir. No navegador, só tenta focar. */
      void desktopBringToFront(8000);
      try {
        window.focus();
      } catch {
        /* ignore */
      }
    });
  }, [notifications, currentUser.id]);

  /* O "em X minutos" anda enquanto o cartão está aberto. */
  const [, setTique] = useState(0);
  useEffect(() => {
    if (fila.length === 0) return;
    const id = window.setInterval(() => setTique((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, [fila.length]);

  const atual = fila[0];
  if (!atual) return null;
  const { aviso, compromisso: c } = atual;

  const fechar = () => {
    markNotifRead(aviso.id);
    setFila((f) => f.slice(1));
  };

  const euCriei = c ? c.criadoPor === currentUser.id : !aviso.fromUserId;
  const criador = c ? users.find((u) => u.id === c.criadoPor) : undefined;
  /* "com quem": os outros — participantes e quem criou, menos eu. */
  const comQuem = c
    ? [...new Set([c.criadoPor, ...c.participantes])]
        .filter((id) => id !== currentUser.id)
        .map((id) => users.find((u) => u.id === id))
        .filter((u): u is NonNullable<typeof u> => !!u)
    : [];
  const nomes = comQuem.map((u) => nomeCurto(u.name).toUpperCase());
  const listaDeNomes =
    nomes.length <= 3
      ? nomes.join(", ")
      : `${nomes.slice(0, 3).join(", ")} e mais ${nomes.length - 3}`;

  const minutos = c
    ? Math.max(0, Math.ceil((Date.parse(c.inicio) - Date.now()) / 60_000))
    : Number(/(\d+)\s*min/.exec(aviso.title)?.[1] ?? NaN);
  const quando = c ? horaCurta(c.inicio) : (/(\d{2}:\d{2})/.exec(aviso.title)?.[1] ?? "");
  const emQuanto = !Number.isFinite(minutos)
    ? "Em breve"
    : minutos <= 0
      ? "Começando agora"
      : `Em ${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;
  const assunto = c?.assunto ?? aviso.desc;
  const sala = c?.sala ?? aviso.roomName ?? null;

  return (
    // z-455: acima dos diálogos (420) e do foco (440), abaixo do "chamar
    // atenção" (460), que é pointer-events-none e não disputa o clique.
    <div className="fixed inset-0 z-[455] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alerta-compromisso-titulo"
        className="fluxo-attn-pop w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2 bg-gradient-to-r from-primary to-primary/70 px-5 py-3 text-primary-foreground">
          <Lock className="h-4 w-4" />
          <span className="text-xs font-bold uppercase tracking-[0.18em]">
            {emQuanto}
            {quando && ` · ${quando}`}
          </span>
          {fila.length > 1 && (
            <span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">
              +{fila.length - 1}
            </span>
          )}
        </div>

        <div className="space-y-3 px-5 py-4">
          <div>
            <h2
              id="alerta-compromisso-titulo"
              className="font-display text-xl font-semibold leading-snug text-balance"
            >
              {assunto}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {euCriei
                ? nomes.length > 0
                  ? `Sua agenda com ${listaDeNomes} começa ${minutos > 0 ? `em ${minutos} min` : "agora"}.`
                  : `Sua agenda começa ${minutos > 0 ? `em ${minutos} min` : "agora"}.`
                : `Você tem uma agenda às ${quando}${nomes.length > 0 ? ` com ${listaDeNomes}` : ""}.`}
            </p>
          </div>

          {comQuem.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {comQuem.slice(0, 8).map((u) => (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 py-0.5 pl-0.5 pr-2 text-xs"
                >
                  <UserAvatar nome={u.name} iniciais={u.avatar} className="h-7 w-7 text-[10px]" />
                  {nomeCurto(u.name)}
                </span>
              ))}
              {comQuem.length > 8 && (
                <span className="text-xs text-muted-foreground">+{comQuem.length - 8}</span>
              )}
            </div>
          )}

          <div className="space-y-1 text-xs text-muted-foreground">
            {c && (
              <div className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" /> {faixaDeHorario(c)}
              </div>
            )}
            {c?.local && (
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> {c.local}
              </div>
            )}
            {sala && (
              <div className="flex items-center gap-1.5">
                <Video className="h-3.5 w-3.5" /> {rotuloDaSala(sala)}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              {criador && (
                <UserAvatar
                  nome={criador.name}
                  iniciais={criador.avatar}
                  className="h-4 w-4 text-[7px]"
                />
              )}
              Criada por {euCriei ? "você" : criador ? nomeCurto(criador.name) : "—"}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-secondary/40 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              fechar();
              navigate({
                to: "/calendario",
                search: aviso.compromissoId ? { compromisso: aviso.compromissoId } : {},
              });
            }}
            className="mr-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted"
          >
            <CalendarDays className="h-3.5 w-3.5" /> Abrir no calendário
          </button>
          {sala && (
            <button
              type="button"
              onClick={() => {
                fechar();
                navigate({ to: "/salas/$roomName", params: { roomName: sala } });
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/10"
            >
              <Video className="h-3.5 w-3.5" /> Entrar na sala
            </button>
          )}
          <button
            type="button"
            autoFocus
            onClick={fechar}
            className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition hover:brightness-110"
          >
            Ok
          </button>
        </div>
      </div>
    </div>
  );
}
