import { useCallback, useEffect, useRef, useState } from "react";
import { RoomEvent, type Room } from "livekit-client";
import { ClipboardList, Download, Loader2, Printer, RefreshCw, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useEscFecha } from "@/hooks/use-esc-fecha";
import { TravaScroll } from "@/components/trava-scroll";
import type { RelatorioDePresenca, ReuniaoResumo } from "@/lib/presenca-reuniao.functions";

/*
 * Presença nas reuniões — a parte da tela (pedido do usuário, 10/10/2026).
 * O registro é feito pelo servidor; ver `presenca-reuniao.functions.ts`.
 */

const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fmtData = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
export const duracao = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}min` : `${Math.max(1, m)} min`;
};
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Sinal de presença de quem está na chamada: ao entrar, quando alguém entra ou
 * sai (com uma folguinha para juntar vários eventos) e a cada minuto. O
 * convidado por link não manda — não tem sessão —, mas aparece no relatório
 * mesmo assim, porque quem grava é o servidor olhando o LiveKit.
 */
export function usePresencaNaReuniao(
  room: Room,
  sala: string,
  titulo: string,
  ligado: boolean,
): { reuniaoId: string | null; souCriador: boolean } {
  const [estado, setEstado] = useState<{ reuniaoId: string | null; souCriador: boolean }>({
    reuniaoId: null,
    souCriador: false,
  });
  useEffect(() => {
    if (!ligado) return;
    let vivo = true;
    let espera: number | undefined;
    const mandar = async () => {
      try {
        const { sinalDaReuniao } = await import("@/lib/presenca-reuniao.functions");
        const r = await sinalDaReuniao({ data: { sala, titulo } });
        if (vivo && r.reuniaoId) setEstado({ reuniaoId: r.reuniaoId, souCriador: r.souCriador });
      } catch (e) {
        // Presença é registro, não pode atrapalhar a chamada: só anota.
        console.warn("[presença] sinal não foi:", (e as Error)?.message);
      }
    };
    const logo = () => {
      window.clearTimeout(espera);
      espera = window.setTimeout(() => void mandar(), 3000);
    };
    // Primeiro sinal com um pequeno atraso: o LiveKit precisa ver a entrada.
    espera = window.setTimeout(() => void mandar(), 2500);
    const intervalo = window.setInterval(() => void mandar(), 60_000);
    room.on(RoomEvent.ParticipantConnected, logo);
    room.on(RoomEvent.ParticipantDisconnected, logo);
    return () => {
      vivo = false;
      window.clearTimeout(espera);
      window.clearInterval(intervalo);
      room.off(RoomEvent.ParticipantConnected, logo);
      room.off(RoomEvent.ParticipantDisconnected, logo);
    };
  }, [room, sala, titulo, ligado]);
  return estado;
}

/** Imprime (ou salva em PDF) o relatório numa folha limpa, sem o resto do app. */
export function imprimirRelatorio(rel: RelatorioDePresenca) {
  const r = rel.reuniao;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Presença — ${esc(r.titulo)}</title>
<style>body{font:13px/1.45 Arial,sans-serif;color:#111;margin:28px}h1{font-size:18px;margin:0 0 4px}
.mut{color:#555}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
th{background:#f3f4f6;font-size:12px}.rodape{margin-top:18px;font-size:11px;color:#777}</style></head><body>
<h1>Relatório de presença</h1>
<div><b>${esc(r.titulo)}</b> <span class="mut">(sala ${esc(r.sala)})</span></div>
<div class="mut">Aberta por ${esc(r.criador)} · ${fmtData(r.inicio)} das ${fmtHora(r.inicio)} às ${fmtHora(r.fim)}${r.aberta ? " (em andamento)" : ""} · ${rel.linhas.length} participante(s)</div>
<table><thead><tr><th>#</th><th>Nome</th><th>Tipo</th><th>Entrou</th><th>Saiu</th><th>Tempo</th><th>Entradas</th></tr></thead><tbody>
${rel.linhas
  .map(
    (l, i) =>
      `<tr><td>${i + 1}</td><td>${esc(l.nome)}</td><td>${l.convidado ? "Convidado" : "Colaborador"}</td><td>${fmtHora(l.primeiraEntrada)}</td><td>${
        l.presenteAgora ? "na sala" : fmtHora(l.ultimaSaida)
      }</td><td>${duracao(l.segundos)}</td><td>${l.entradas}</td></tr>`,
  )
  .join("")}
</tbody></table>
<div class="rodape">Emitido pelo SGL - CONECTA em ${new Date().toLocaleString("pt-BR")}</div></body></html>`;
  // Um iframe escondido: imprime só a folha, e funciona também no app de mesa.
  const quadro = document.createElement("iframe");
  quadro.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  quadro.srcdoc = html;
  quadro.onload = () => {
    quadro.contentWindow?.focus();
    quadro.contentWindow?.print();
    window.setTimeout(() => quadro.remove(), 60_000);
  };
  document.body.appendChild(quadro);
}

/** Baixa a planilha pelo servidor (o download comum funciona também no app de mesa). */
export function baixarPlanilha(id: string, nome: string) {
  const a = document.createElement("a");
  a.href = `/api/presencas/${id}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast.success("Baixando o relatório de presença", {
    description: `${nome} — o arquivo vai para a pasta Downloads (abre no Excel).`,
  });
}

/** A tabela do relatório, com os botões de emitir. `aoVivo`: atualiza sozinha. */
export function RelatorioDePresencaView({ id, aoVivo = false }: { id: string; aoVivo?: boolean }) {
  const [rel, setRel] = useState<RelatorioDePresenca | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { relatorioDaReuniao } = await import("@/lib/presenca-reuniao.functions");
      setRel(await relatorioDaReuniao({ data: { id } }));
      setErro(null);
    } catch (e) {
      setErro((e as Error)?.message ?? "Não foi possível carregar o relatório.");
    } finally {
      setCarregando(false);
    }
  }, [id]);
  useEffect(() => {
    void carregar();
    if (!aoVivo) return;
    const t = window.setInterval(() => void carregar(), 20_000);
    return () => window.clearInterval(t);
  }, [carregar, aoVivo]);

  if (erro) return <div className="p-6 text-center text-sm text-muted-foreground">{erro}</div>;
  if (!rel)
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  const r = rel.reuniao;
  const total = rel.linhas.reduce((n, l) => n + l.segundos, 0);
  /* A duração é do início ao fim da reunião (19/10/2026: "o tempo somado não
     é 7h, cálculo tá errado"). O antigo "tempo somado" juntava o tempo de
     cada participante — 15 pessoas × ~30 min dava 7h — e ficou só como
     detalhe, com o nome certo: horas-pessoa. */
  const duracaoDaReuniao = Math.max(
    0,
    Math.round((new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 1000),
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold">{r.titulo}</div>
          <div className="text-xs text-muted-foreground">
            {fmtData(r.inicio)} · {fmtHora(r.inicio)} às {fmtHora(r.fim)}
            {r.aberta && (
              <span className="ml-1 font-semibold text-emerald-600">· em andamento</span>
            )}{" "}
            · aberta por {r.criador}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void carregar()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-secondary"
            title="Atualizar"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => imprimirRelatorio(rel)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
          >
            <Printer className="h-3.5 w-3.5" /> Imprimir / PDF
          </button>
          <button
            type="button"
            onClick={() => baixarPlanilha(r.id, r.titulo)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
          >
            <Download className="h-3.5 w-3.5" /> Emitir planilha
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { rotulo: "Participantes", valor: String(rel.linhas.length) },
          {
            rotulo: "Na sala agora",
            valor: String(rel.linhas.filter((l) => l.presenteAgora).length),
          },
          {
            rotulo: r.aberta ? "Duração até agora" : "Duração da reunião",
            valor: duracaoDaReuniao ? duracao(duracaoDaReuniao) : "—",
            detalhe: total ? `${duracao(total)} somando o tempo de todos` : undefined,
          },
        ].map((c) => (
          <div key={c.rotulo} className="rounded-lg border border-border bg-background p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {c.rotulo}
            </div>
            <div className="text-lg font-bold">{c.valor}</div>
            {"detalhe" in c && c.detalhe && (
              <div className="text-[10px] text-muted-foreground">{c.detalhe}</div>
            )}
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-secondary/60 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Entrou</th>
              <th className="px-3 py-2">Saiu</th>
              <th className="px-3 py-2">Tempo</th>
              <th className="px-3 py-2 text-right">Entradas</th>
            </tr>
          </thead>
          <tbody>
            {rel.linhas.map((l) => (
              <tr key={l.identidade} className="border-t border-border">
                <td className="px-3 py-2">
                  <span className="font-medium">{l.nome}</span>
                  {l.convidado && (
                    <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                      convidado
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{fmtHora(l.primeiraEntrada)}</td>
                <td className="px-3 py-2">
                  {l.presenteAgora ? (
                    <span className="font-semibold text-emerald-600">na sala</span>
                  ) : (
                    fmtHora(l.ultimaSaida)
                  )}
                </td>
                <td className="px-3 py-2">{duracao(l.segundos)}</td>
                <td className="px-3 py-2 text-right">{l.entradas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Horários com precisão de cerca de 1 minuto. Sair e voltar soma só o tempo dentro da sala.
      </p>
    </div>
  );
}

/** A janela do relatório durante a chamada (botão "Presenças"). */
export function JanelaDePresenca({ id, onClose }: { id: string; onClose: () => void }) {
  useEscFecha(true, onClose);
  return (
    <div
      className="fixed inset-0 z-[400] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <TravaScroll />
      <div
        className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          <h3 className="flex-1 text-sm font-semibold">Relatório de presença</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <RelatorioDePresencaView id={id} aoVivo />
        <p className="mt-3 text-[11px] text-muted-foreground">
          Fica salvo para você em <b>Atas &amp; Planos → Presenças</b>, mesmo depois que a reunião
          acabar.
        </p>
      </div>
    </div>
  );
}

/** A aba "Presenças" de Atas & Planos: as reuniões que você abriu, e o relatório de cada uma. */
export function PresencasDasReunioes() {
  const [lista, setLista] = useState<ReuniaoResumo[] | null>(null);
  const [gerente, setGerente] = useState(false);
  const [todas, setTodas] = useState(false);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const primeira = useRef(true);

  useEffect(() => {
    let vivo = true;
    import("@/lib/presenca-reuniao.functions")
      .then((m) => m.minhasReunioes({ data: { todas } }))
      .then((r) => {
        if (!vivo) return;
        setLista(r.reunioes);
        setGerente(r.gerente);
        setErro(null);
        if (primeira.current && r.reunioes[0]) setSelecionada(r.reunioes[0].id);
        primeira.current = false;
      })
      .catch((e) => vivo && setErro((e as Error)?.message ?? "Não foi possível carregar."));
    return () => {
      vivo = false;
    };
  }, [todas]);

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <div className="flex flex-col rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border p-3 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span className="flex-1">
            {lista ? `${lista.length} reunião(ões)` : "carregando…"} ·{" "}
            {todas ? "todas (gerência)" : "que você abriu"}
          </span>
          {gerente && (
            <button
              type="button"
              onClick={() => setTodas((v) => !v)}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] hover:border-primary/50"
            >
              {todas ? "Só as minhas" : "Ver todas"}
            </button>
          )}
        </div>
        <div className="max-h-[70vh] flex-1 overflow-y-auto">
          {erro ? (
            <div className="p-6 text-center text-sm text-muted-foreground">{erro}</div>
          ) : lista && lista.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-40" />
              Nenhuma reunião registrada ainda. Ao abrir uma sala, a presença de todos fica salva
              aqui.
            </div>
          ) : (
            lista?.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelecionada(r.id)}
                className={`flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-3 py-2.5 text-left transition hover:bg-muted/60 ${
                  selecionada === r.id ? "bg-muted/80" : ""
                }`}
              >
                <div className="flex w-full items-center gap-2">
                  <ClipboardList className="h-3.5 w-3.5 text-primary" />
                  <span className="flex-1 truncate text-sm font-semibold">{r.titulo}</span>
                  {r.aberta && (
                    <span className="rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-semibold text-emerald-600">
                      ao vivo
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {fmtData(r.inicio)} · {fmtHora(r.inicio)}–{fmtHora(r.fim)} · {r.participantes}{" "}
                  pessoa(s)
                  {todas && r.criador ? ` · ${r.criador}` : ""}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        {selecionada ? (
          <RelatorioDePresencaView
            key={selecionada}
            id={selecionada}
            aoVivo={!!lista?.find((r) => r.id === selecionada)?.aberta}
          />
        ) : (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Escolha uma reunião ao lado.
          </div>
        )}
      </div>
    </div>
  );
}
