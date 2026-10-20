/*
 * sala-ao-vivo.tsx — a tela da sala conectada: palco 3D, barra, sobreposições, painel e popups.
 *
 * UI pura sobre o useSalaAoVivo: nenhum estado de rede mora aqui, só o que é da TELA (painel
 * aberto, popup aberto, dica). Mapa das sobreposições, pensado para nada cobrir a mesa:
 *   - topo esquerdo: fila de mãos;           - topo direito: selo "IA ouvindo você";
 *   - acima da barra, centro: avisos;         - acima da barra, esquerda: "Seus cards";
 *   - acima da barra, direita: prévia da câmera (só para gestos, nunca transmitida).
 * Teclas: M (microfone) e L (mão) — ignoradas quando se está digitando ou com um popup aberto.
 *
 * Toda sobreposição opaca sobre o palco leva `data-rv-obstaculo`: o Projetor da sala lê esses
 * retângulos e os balões das cabeças desviam deles (a fila de mãos tapava o balão da Júlia).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Camera,
  CameraOff,
  Hand,
  Loader2,
  LogOut,
  Maximize2,
  Mic,
  MicOff,
  MonitorUp,
  PanelRight,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sala3D } from "../sala-3d";
import { BandejaDeCards } from "../voz/bandeja-de-cards";
import { AvisoCardsIA } from "../voz/aviso-de-privacidade";
import { cardsIaJaAceito } from "../voz/preferencia-cards-ia";
import { FilaDeMaos } from "../gestos/fila-de-maos";
import { AvisosDeGesto } from "../gestos/avisos-de-gesto";
import { PreviaDaCamera } from "../gestos/previa-da-camera";
import { AvisoDeCamera } from "../gestos/aviso-de-camera";
import { usePreviaDaCamera } from "../gestos/use-previa-da-camera";
import { ESTADOS_COM_AVISO_DE_CAMERA, TEXTO_DO_ESTADO } from "../gestos/use-gestos";
import type { SalaAoVivo as Sala } from "./use-sala-ao-vivo";
import { CabecalhoRv } from "./cabecalho";
import { PainelLateral, type AbaDoPainel } from "./painel-lateral";
import { AnelDoMicrofone } from "./anel-do-microfone";
import { VerTela } from "./ver-tela";

const CHAVE_DICA = "rv:dica-vista";
const DICA_MS = 6_000;
/**
 * Acima disto o painel começa aberto. Era 1500: num monitor 1920 o painel abria sozinho, o palco
 * ficava com proporção ~1,4 e quem sentava nas laterais saía do quadro. Agora só em telas muito
 * largas (sobra palco de ~1,9 mesmo com o painel); nas outras ele abre pelo botão "Painel".
 */
const LARGURA_PAINEL_ABERTO = 2200;

function lerDicaVista(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_DICA) === "1";
  } catch {
    return true; // sem armazenamento: melhor não insistir com a dica toda vez
  }
}
function marcarDicaVista() {
  try {
    window.localStorage.setItem(CHAVE_DICA, "1");
  } catch {
    /* só deixa de lembrar */
  }
}

/** Há um popup (Dialog do Radix) aberto: atalho não pode mexer no mic "por trás" dele. */
const comPopupAberto = () =>
  typeof document !== "undefined" &&
  !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]');

const digitando = (alvo: EventTarget | null) => {
  const el = alvo as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

export function SalaAoVivo({
  sala,
  aoEditarAvatar,
  nomeDaSala = "Sala de reunião",
}: {
  sala: Sala;
  aoEditarAvatar: () => void;
  nomeDaSala?: string;
}) {
  const palcoRef = useRef<HTMLDivElement>(null);
  const [painel, setPainel] = useState(
    () => typeof window !== "undefined" && window.innerWidth > LARGURA_PAINEL_ABERTO,
  );
  const [aba, setAba] = useState<AbaDoPainel>("participantes");
  const [vendoTela, setVendoTela] = useState(false);
  const [sairAberto, setSairAberto] = useState(false);
  const [avisoCardsAberto, setAvisoCardsAberto] = useState(false);
  const [avisoCameraAberto, setAvisoCameraAberto] = useState(false);
  const [dica, setDica] = useState(() => !lerDicaVista());

  const { cards, gestos } = sala;
  const previa = usePreviaDaCamera(gestos.ligado);

  /* Dica de navegação só na primeira visita; some em 6 s ou na 1ª interação. */
  useEffect(() => {
    if (!dica) return;
    marcarDicaVista();
    const id = window.setTimeout(() => setDica(false), DICA_MS);
    return () => window.clearTimeout(id);
  }, [dica]);

  /*
   * Câmera negada/ocupada/ausente: explica num popup próprio. Uma vez por LIGAÇÃO dos gestos:
   * com a câmera ocupada o hook tenta sozinho a cada 10 s (passa por "pedindo" e volta a
   * "ocupada"), e o popup reabria a cada volta mesmo depois do "Agora não". Só desligar os
   * gestos ou clicar em "Tentar de novo" rearma o aviso.
   */
  const estadoCamera = gestos.estado;
  const avisoCameraDispensado = useRef(false);
  useEffect(() => {
    if (!gestos.ligado) avisoCameraDispensado.current = false;
  }, [gestos.ligado]);
  useEffect(() => {
    if (ESTADOS_COM_AVISO_DE_CAMERA.includes(estadoCamera) && !avisoCameraDispensado.current)
      setAvisoCameraAberto(true);
  }, [estadoCamera]);
  const dispensarAvisoCamera = useCallback(() => {
    avisoCameraDispensado.current = true;
    setAvisoCameraAberto(false);
  }, []);
  const { tentarDeNovo: tentarCameraDeNovo } = gestos;
  const tentarCameraPeloAviso = useCallback(() => {
    avisoCameraDispensado.current = false;
    setAvisoCameraAberto(false);
    tentarCameraDeNovo();
  }, [tentarCameraDeNovo]);

  /* Sem vídeo no telão, não há o que ampliar. */
  useEffect(() => {
    if (!sala.telao) setVendoTela(false);
  }, [sala.telao]);

  const { alternarMic } = sala;
  const { alternarMao } = gestos;
  const popupAberto = sairAberto || avisoCardsAberto || avisoCameraAberto;
  useEffect(() => {
    // Com popup aberto nem registra: M/L mudariam o mic/mão por trás do modal, sem retorno.
    if (popupAberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || digitando(e.target)) return;
      if (comPopupAberto()) return;
      const k = e.key.toLowerCase();
      if (k === "m") {
        e.preventDefault();
        void alternarMic();
      } else if (k === "l") {
        e.preventDefault();
        alternarMao();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [alternarMic, alternarMao, popupAberto]);

  const telaCheia = useCallback(() => {
    const el = palcoRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen?.().catch(() => {});
  }, []);

  const clicarCards = () => {
    if (cards.ligado) cards.alternar(false);
    else if (cardsIaJaAceito()) cards.alternar(true);
    else setAvisoCardsAberto(true);
  };

  const abrirCards = useCallback(() => {
    setAba("cards");
    setPainel(true);
  }, []);
  const verTela = useCallback(() => setVendoTela(true), []);
  const interagiu = useCallback(() => setDica(false), []);

  const carregandoGestos =
    gestos.ligado && ["pedindo", "carregando", "aquecendo"].includes(gestos.estado);
  const tituloGestos =
    TEXTO_DO_ESTADO[gestos.ligado ? gestos.estado : "desligado"] +
    (gestos.ligado && gestos.estado === "ativo" && gestos.delegate
      ? ` · ${gestos.delegate} · ${Math.round(gestos.qps)} qps`
      : "");

  return (
    <div className="flex flex-col">
      <CabecalhoRv
        quantos={sala.pessoas.length}
        aoTelaCheia={telaCheia}
        aoAvatar={aoEditarAvatar}
      />
      <div
        ref={palcoRef}
        data-rv-palco=""
        className="flex h-[calc(100dvh-7rem)] min-h-[420px] overflow-hidden rounded-2xl border border-border bg-[#1b1410]"
      >
        <div className="relative min-w-0 flex-1">
          <Sala3D
            pessoas={sala.pessoas}
            telao={sala.telao?.video ?? null}
            quemCompartilha={sala.telao?.quem}
            mural={sala.mural}
            nomeDaSala={nomeDaSala}
            aoInteragir={interagiu}
            aoVerTela={verTela}
            aoAbrirCards={abrirCards}
          />

          {/* Topo esquerdo: a fila de mãos. */}
          <div className="pointer-events-none absolute left-3 top-3 z-10" data-rv-obstaculo="">
            <FilaDeMaos
              itens={sala.filaDeMaos}
              souCondutor={sala.conduzo}
              aoAbaixarMinha={gestos.alternarMao}
              aoAbaixar={(id) => gestos.abaixarDeOutro(id, "abaixar")}
              aoDarAVez={(id) => gestos.abaixarDeOutro(id, "vez")}
            />
          </div>

          {/* Topo direito: o selo da IA (todos veem o chip; aqui eu vejo o estado). */}
          <SeloDosCards
            ligado={cards.ligado}
            estado={cards.estado}
            motivo={cards.motivo}
            aoTentarDeNovo={cards.tentarDeNovo}
          />

          {dica && (
            <div
              className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-lg bg-black/55 px-3 py-1.5 text-[12px] text-white"
              data-rv-obstaculo=""
            >
              Arraste para olhar · role para aproximar
            </div>
          )}

          {/* Acima da barra: avisos (centro), meus cards (esquerda), prévia da câmera (direita). */}
          <div
            className="pointer-events-none absolute bottom-[84px] left-1/2 z-10 -translate-x-1/2"
            data-rv-obstaculo=""
          >
            <AvisosDeGesto avisos={sala.avisos} />
          </div>
          <div className="absolute bottom-[84px] left-3 z-10 max-w-[280px]" data-rv-obstaculo="">
            <BandejaDeCards itens={cards.bandeja} aoApagar={sala.apagarCard} />
          </div>
          {gestos.ligado && (
            <div className="absolute bottom-[84px] right-3 z-10" data-rv-obstaculo="">
              {previa.aberta ? (
                <PreviaDaCamera
                  video={gestos.video}
                  pontos={gestos.ultimosPontos}
                  estado={gestos.estado}
                  delegate={gestos.delegate}
                  qps={gestos.qps}
                  aoRecalibrar={gestos.recalibrar}
                  aoFechar={previa.fechar}
                  dica={previa.dica}
                />
              ) : (
                <button
                  type="button"
                  onClick={previa.abrir}
                  className="cursor-pointer rounded-lg bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-black/80"
                  title="Ver a prévia da câmera (só para gestos, não transmitida)"
                >
                  📷 Prévia
                </button>
              )}
            </div>
          )}

          {/* A barra de controles. */}
          <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-black/50 to-transparent px-2 pb-3 pt-6">
            <div className="flex items-center gap-1.5 rounded-2xl border border-white/15 bg-black/55 p-1.5 text-white shadow-2xl backdrop-blur">
              <BotaoDaBarra
                rotulo={sala.semMicrofone ? "Sem mic" : sala.micLigado ? "Microfone" : "Mudo"}
                titulo={sala.micLigado ? "Fechar o microfone (M)" : "Abrir o microfone (M)"}
                cor={sala.micLigado ? "#166534" : sala.semMicrofone ? "#4b5563" : "#dc2626"}
                onClick={() => void sala.alternarMic()}
                extra={
                  <AnelDoMicrofone
                    room={sala.room}
                    contexto={sala.contextoDeAudio}
                    ligado={sala.micLigado}
                    versao={sala.versaoDasTrilhas}
                  />
                }
              >
                {sala.micLigado ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              </BotaoDaBarra>
              <BotaoDaBarra
                rotulo={sala.telao?.meu ? "Parar" : "Compartilhar"}
                titulo={sala.telao?.meu ? "Parar de compartilhar" : "Compartilhar a tela no telão"}
                ativo={!!sala.telao?.meu}
                onClick={() => void sala.alternarTela()}
              >
                <MonitorUp className="h-5 w-5" />
              </BotaoDaBarra>
              {sala.telao && (
                <BotaoDaBarra
                  rotulo="Ver tela"
                  titulo="Ver a tela compartilhada grande (ou duplo clique no telão)"
                  onClick={verTela}
                >
                  <Maximize2 className="h-5 w-5" />
                </BotaoDaBarra>
              )}
              <BotaoDaBarra
                rotulo={gestos.minhaMao ? "Abaixar" : "Mão"}
                titulo={gestos.minhaMao ? "Abaixar a mão (L)" : "Levantar a mão ✋ (L)"}
                cor={gestos.minhaMao ? "#d97706" : undefined}
                onClick={gestos.alternarMao}
              >
                <Hand className="h-5 w-5" />
              </BotaoDaBarra>
              <BotaoDaBarra
                rotulo="Gestos"
                titulo={tituloGestos}
                ativo={gestos.ligado}
                onClick={() => gestos.alternar()}
                extra={
                  gestos.ligado && gestos.estado === "ativo" ? (
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-black/60" />
                  ) : null
                }
              >
                {carregandoGestos ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : gestos.ligado && gestos.estado === "negado" ? (
                  <CameraOff className="h-5 w-5 text-red-300" />
                ) : (
                  <Camera className="h-5 w-5" />
                )}
              </BotaoDaBarra>
              <BotaoDaBarra
                rotulo="Cards IA"
                titulo={
                  cards.ligado
                    ? "Desligar os cards por IA"
                    : "Cards por IA: o que você fala vira card para todos"
                }
                cor={cards.ligado ? "#7c3aed" : undefined}
                onClick={clicarCards}
              >
                <Sparkles className="h-5 w-5" />
              </BotaoDaBarra>
              <BotaoDaBarra
                rotulo="Painel"
                titulo={painel ? "Fechar o painel" : "Participantes e cards"}
                ativo={painel}
                onClick={() => setPainel((p) => !p)}
              >
                <PanelRight className="h-5 w-5" />
              </BotaoDaBarra>
              <span className="mx-0.5 h-8 w-px bg-white/20" />
              <BotaoDaBarra
                rotulo="Sair"
                titulo="Sair da sala"
                cor="#dc2626"
                onClick={() => setSairAberto(true)}
              >
                <LogOut className="h-5 w-5" />
              </BotaoDaBarra>
            </div>
          </div>

          {vendoTela && sala.telao && (
            <VerTela
              video={sala.telao.video}
              quem={sala.telao.quem}
              aoVoltar={() => setVendoTela(false)}
            />
          )}
        </div>

        {painel && (
          <PainelLateral
            aba={aba}
            aoMudarAba={setAba}
            aoFechar={() => setPainel(false)}
            pessoas={sala.pessoas}
            mural={sala.mural}
            meuId={sala.meuId}
            conduzo={sala.conduzo}
            aoAbaixar={(id) => gestos.abaixarDeOutro(id, "abaixar")}
            aoApagarCard={sala.apagarCard}
          />
        )}
      </div>

      <AvisoCardsIA
        aberto={avisoCardsAberto}
        aoAceitar={() => {
          setAvisoCardsAberto(false);
          cards.alternar(true);
        }}
        aoCancelar={() => setAvisoCardsAberto(false)}
      />
      <AvisoDeCamera
        estado={gestos.estado}
        aberto={avisoCameraAberto}
        aoFechar={dispensarAvisoCamera}
        aoTentarDeNovo={tentarCameraPeloAviso}
      />
      <Dialog open={sairAberto} onOpenChange={setSairAberto}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sair da sala?</DialogTitle>
            <DialogDescription>
              Você sai da reunião. Os cards que você publicou continuam no mural dos outros.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSairAberto(false)}>
              Ficar
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-500"
              onClick={() => {
                setSairAberto(false);
                sala.sair();
              }}
            >
              Sair
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "IA ouvindo você" (roxo) / "Cards pausados: …" — só para mim; os outros veem o chip IA. */
function SeloDosCards({
  ligado,
  estado,
  motivo,
  aoTentarDeNovo,
}: {
  ligado: boolean;
  estado: Sala["cards"]["estado"];
  motivo: string | null;
  aoTentarDeNovo: () => void;
}) {
  if (!ligado || estado === "desligado") return null;
  const base =
    "absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold shadow-lg";
  if (estado === "erro")
    return (
      <div className={`${base} bg-[#1f2937] text-white`} role="status" data-rv-obstaculo="">
        Cards pausados: {motivo ?? "erro"}
        {!/reinicie o servidor/i.test(motivo ?? "") && (
          <button
            type="button"
            onClick={aoTentarDeNovo}
            className="cursor-pointer rounded-full bg-white/15 px-2 py-0.5 hover:bg-white/25"
          >
            Tentar de novo
          </button>
        )}
      </div>
    );
  if (estado === "pausado" || estado === "sem-suporte")
    return (
      <div className={`${base} bg-[#1f2937] text-white`} role="status" data-rv-obstaculo="">
        Cards pausados: {motivo ?? "pausa"}
      </div>
    );
  return (
    <div className={`${base} bg-[#7c3aed] text-white`} role="status" data-rv-obstaculo="">
      <span
        className={`h-2 w-2 rounded-full ${estado === "mudo" ? "bg-white/50" : "animate-pulse bg-white"}`}
      />
      {estado === "mudo"
        ? "IA em pausa: você está mudo"
        : estado === "pensando"
          ? "IA pensando…"
          : "IA ouvindo você"}
    </div>
  );
}

function BotaoDaBarra({
  children,
  rotulo,
  titulo,
  onClick,
  cor,
  ativo = false,
  extra,
}: {
  children: ReactNode;
  rotulo: string;
  titulo: string;
  onClick: () => void;
  /** Fundo sólido (mic, mão, cards, sair); sem cor = neutro. */
  cor?: string;
  ativo?: boolean;
  extra?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      aria-pressed={ativo || undefined}
      style={cor ? { backgroundColor: cor } : undefined}
      className={`relative flex h-[52px] min-w-[52px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 transition hover:brightness-110 ${
        cor ? "" : ativo ? "bg-white/25 hover:bg-white/35" : "bg-white/10 hover:bg-white/20"
      }`}
    >
      {extra}
      {children}
      <span className="text-[11px] leading-none">{rotulo}</span>
    </button>
  );
}
