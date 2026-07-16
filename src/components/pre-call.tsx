import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, Loader2, FileText, Lock } from "lucide-react";

const PREF_KEY = "fluxo:precall-prefs";

interface Prefs {
  micOn: boolean;
  camOn: boolean;
  micDeviceId?: string;
  camDeviceId?: string;
}

function loadPrefs(): Prefs {
  if (typeof window === "undefined") return { micOn: true, camOn: true };
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (raw) return { micOn: true, camOn: true, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { micOn: true, camOn: true };
}

function savePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export interface PreCallResult {
  micOn: boolean;
  camOn: boolean;
  micDeviceId?: string;
  camDeviceId?: string;
  title: string;
  autoMinute: boolean;
  makePrivate: boolean;
}

export function PreCall({
  roomLabel,
  onEnter,
  onCancel,
  alreadyPrivate,
  forcePrivate,
}: {
  roomLabel: string;
  onEnter: (r: PreCallResult) => void;
  onCancel: () => void;
  alreadyPrivate?: boolean;
  forcePrivate?: boolean;
}) {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [title, setTitle] = useState<string>(roomLabel);
  const [autoMinute, setAutoMinute] = useState<boolean>(true);
  const [makePrivate, setMakePrivate] = useState<boolean>(forcePrivate || !!alreadyPrivate);
  const [devices, setDevices] = useState<{ mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[] }>({
    mics: [],
    cams: [],
  });
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const constraints = useMemo(
    () => ({
      audio: prefs.micOn
        ? prefs.micDeviceId
          ? { deviceId: { exact: prefs.micDeviceId } }
          : true
        : false,
      video: prefs.camOn
        ? prefs.camDeviceId
          ? { deviceId: { exact: prefs.camDeviceId }, width: 640, height: 360 }
          : { width: 640, height: 360 }
        : false,
    }),
    [prefs.micOn, prefs.camOn, prefs.micDeviceId, prefs.camDeviceId],
  );

  // Acquire stream
  useEffect(() => {
    let cancelled = false;
    let localStream: MediaStream | null = null;
    (async () => {
      setErr(null);
      setLoading(true);
      try {
        if (!prefs.micOn && !prefs.camOn) {
          setStream(null);
          setLoading(false);
          return;
        }
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          localStream.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(localStream);
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Não foi possível acessar mic/câmera");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
    };
  }, [constraints, prefs.micOn, prefs.camOn]);

  // Enumerate devices (needs at least one permission grant to show labels)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setDevices({
          mics: list.filter((d) => d.kind === "audioinput"),
          cams: list.filter((d) => d.kind === "videoinput"),
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stream]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => savePrefs(prefs), [prefs]);

  const submit = () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    onEnter({
      micOn: prefs.micOn,
      camOn: prefs.camOn,
      micDeviceId: prefs.micDeviceId,
      camDeviceId: prefs.camDeviceId,
      title: title.trim() || roomLabel,
      autoMinute,
      makePrivate: forcePrivate || makePrivate,
    });
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-center p-4">
      <div className="w-full overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-gradient-to-r from-secondary/40 via-card to-card px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Video className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Sala de reunião
              </div>
              <div className="text-base font-semibold leading-tight">{roomLabel}</div>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-[11px] text-muted-foreground sm:inline-flex">
            <span className={`h-1.5 w-1.5 rounded-full ${loading ? "bg-amber-400 animate-pulse" : err ? "bg-red-500" : "bg-emerald-500"}`} />
            {loading ? "Preparando dispositivos" : err ? "Verifique permissões" : "Pronto para entrar"}
          </div>
        </div>

        {/* Body */}
        <div className="grid gap-0 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* Left: video preview + device controls */}
          <div className="flex flex-col gap-3 border-b border-border p-5 md:border-b-0 md:border-r">
            <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-neutral-950 shadow-inner ring-1 ring-white/5">
              {loading ? (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Iniciando câmera…
                </div>
              ) : prefs.camOn && stream ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover [transform:scaleX(-1)]"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
                  <div className="rounded-full bg-white/5 p-4">
                    <VideoOff className="h-8 w-8" />
                  </div>
                  <span className="text-xs">Câmera desligada</span>
                </div>
              )}

              {/* Floating status chip */}
              <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Prévia
              </div>

              {/* Floating device controls */}
              <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setPrefs((p) => ({ ...p, micOn: !p.micOn }))}
                  title={prefs.micOn ? "Desligar microfone" : "Ligar microfone"}
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-lg backdrop-blur-sm transition ${
                    prefs.micOn
                      ? "border-white/20 bg-white/10 text-white hover:bg-white/20"
                      : "border-red-500/60 bg-red-500/90 text-white hover:bg-red-500"
                  }`}
                >
                  {prefs.micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setPrefs((p) => ({ ...p, camOn: !p.camOn }))}
                  title={prefs.camOn ? "Desligar câmera" : "Ligar câmera"}
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-lg backdrop-blur-sm transition ${
                    prefs.camOn
                      ? "border-white/20 bg-white/10 text-white hover:bg-white/20"
                      : "border-red-500/60 bg-red-500/90 text-white hover:bg-red-500"
                  }`}
                >
                  {prefs.camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Device selectors */}
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Mic className="h-3 w-3" /> Microfone
                </span>
                <select
                  value={prefs.micDeviceId ?? ""}
                  onChange={(e) => setPrefs((p) => ({ ...p, micDeviceId: e.target.value || undefined }))}
                  disabled={!prefs.micOn}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none transition focus:border-primary disabled:opacity-50"
                >
                  <option value="">Padrão do sistema</option>
                  {devices.mics.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microfone ${d.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Video className="h-3 w-3" /> Câmera
                </span>
                <select
                  value={prefs.camDeviceId ?? ""}
                  onChange={(e) => setPrefs((p) => ({ ...p, camDeviceId: e.target.value || undefined }))}
                  disabled={!prefs.camOn}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none transition focus:border-primary disabled:opacity-50"
                >
                  <option value="">Padrão do sistema</option>
                  {devices.cams.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Câmera ${d.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {err && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {err}
              </div>
            )}
          </div>

          {/* Right: meeting details */}
          <div className="flex flex-col gap-4 p-5">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Título da reunião <span className="text-destructive">*</span>
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Alinhamento semanal do Comercial"
                maxLength={120}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Identifica a ata em <b>Atas &amp; Planos</b>. Você pode renomear depois.
              </p>
            </div>

            <div className="space-y-2">
              <label className="group flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-background/60 p-3 transition hover:border-primary/40 hover:bg-primary/5">
                <input
                  type="checkbox"
                  checked={autoMinute}
                  onChange={(e) => setAutoMinute(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span className="flex-1 text-xs">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <FileText className="h-3.5 w-3.5 text-primary" />
                    Ata automática (transcrição ao vivo)
                  </span>
                  <span className="mt-0.5 block leading-relaxed text-muted-foreground">
                    A IA grava as falas em texto para gerar a ata ao final da reunião.
                  </span>
                </span>
              </label>

              {forcePrivate ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <span className="flex-1 text-xs">
                    <span className="block font-semibold text-amber-700 dark:text-amber-400">
                      Sala restrita — sempre privada
                    </span>
                    <span className="mt-0.5 block leading-relaxed text-muted-foreground">
                      A sala da Diretoria só admite novos participantes com aprovação de quem já está dentro.
                    </span>
                  </span>
                </div>
              ) : (
                <label className="group flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-background/60 p-3 transition hover:border-primary/40 hover:bg-primary/5">
                  <input
                    type="checkbox"
                    checked={makePrivate}
                    onChange={(e) => setMakePrivate(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span className="flex-1 text-xs">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Lock className="h-3.5 w-3.5 text-amber-500" />
                      Entrar como sala privada
                    </span>
                    <span className="mt-0.5 block leading-relaxed text-muted-foreground">
                      Ninguém entra sem sua aprovação. Você pode abrir/trancar depois pelo topo da sala.
                    </span>
                  </span>
                </label>
              )}
            </div>

            {/* Actions */}
            <div className="mt-auto flex items-center justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!title.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:opacity-50"
              >
                <Video className="h-4 w-4" />
                Entrar na sala
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function readPreCallPrefs(): Prefs {
  return loadPrefs();
}