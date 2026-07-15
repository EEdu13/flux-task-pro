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

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card p-6">
      <div className="text-center">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Antes de entrar</div>
        <div className="mt-1 text-lg font-semibold">{roomLabel}</div>
      </div>
      <div className="w-full max-w-xl">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Título da reunião <span className="text-destructive">*</span>
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex.: Alinhamento semanal do Comercial"
          maxLength={120}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Esse título vai identificar a ata em <b>Atas &amp; Planos</b>. Você pode renomear depois.
        </p>
      </div>
      <label className="flex w-full max-w-xl cursor-pointer items-start gap-2 rounded-md border border-border bg-background/50 p-3">
        <input
          type="checkbox"
          checked={autoMinute}
          onChange={(e) => setAutoMinute(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-primary"
        />
        <span className="flex-1 text-xs">
          <span className="flex items-center gap-1 font-semibold">
            <FileText className="h-3.5 w-3.5 text-primary" />
            Iniciar ata automática (transcrição ao vivo)
          </span>
          <span className="mt-0.5 block text-muted-foreground">
            A IA vai gravar as falas em texto para gerar a ata da reunião ao final. Recomendado para
            reuniões da diretoria.
          </span>
        </span>
      </label>
      {forcePrivate ? (
        <div className="flex w-full max-w-xl items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span className="flex-1 text-xs">
            <span className="flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400">
              Sala restrita — sempre privada
            </span>
            <span className="mt-0.5 block text-muted-foreground">
              A sala da Diretoria é sempre privada. Novos participantes só entram com aprovação de
              quem já está dentro.
            </span>
          </span>
        </div>
      ) : (
        <label className="flex w-full max-w-xl cursor-pointer items-start gap-2 rounded-md border border-border bg-background/50 p-3">
          <input
            type="checkbox"
            checked={makePrivate}
            onChange={(e) => setMakePrivate(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span className="flex-1 text-xs">
            <span className="flex items-center gap-1 font-semibold">
              <Lock className="h-3.5 w-3.5 text-amber-500" />
              Entrar como sala privada
            </span>
            <span className="mt-0.5 block text-muted-foreground">
              Ninguém entra sem sua aprovação. Você pode abrir/trancar depois pelo botão no topo da
              sala.
            </span>
          </span>
        </label>
      )}
      <div className="relative aspect-video w-full max-w-xl overflow-hidden rounded-lg border border-border bg-black">
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
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60">
            <VideoOff className="h-8 w-8" />
            <span className="text-xs">Câmera desligada</span>
          </div>
        )}
        <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-medium text-white">
          {prefs.micOn ? <Mic className="h-3 w-3 text-emerald-400" /> : <MicOff className="h-3 w-3 text-red-400" />}
          Mic {prefs.micOn ? "ligado" : "desligado"}
        </div>
      </div>

      {err && (
        <div className="max-w-xl rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">
          {err}
        </div>
      )}

      <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPrefs((p) => ({ ...p, micOn: !p.micOn }))}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium ${
              prefs.micOn
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                : "border-destructive/50 bg-destructive/10 text-destructive"
            }`}
          >
            {prefs.micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
            {prefs.micOn ? "Mic on" : "Mic off"}
          </button>
          {devices.mics.length > 0 && (
            <select
              value={prefs.micDeviceId ?? ""}
              onChange={(e) => setPrefs((p) => ({ ...p, micDeviceId: e.target.value || undefined }))}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-2 text-xs"
            >
              <option value="">Padrão do sistema</option>
              {devices.mics.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microfone ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPrefs((p) => ({ ...p, camOn: !p.camOn }))}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium ${
              prefs.camOn
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                : "border-destructive/50 bg-destructive/10 text-destructive"
            }`}
          >
            {prefs.camOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
            {prefs.camOn ? "Câmera on" : "Câmera off"}
          </button>
          {devices.cams.length > 0 && (
            <select
              value={prefs.camDeviceId ?? ""}
              onChange={(e) => setPrefs((p) => ({ ...p, camDeviceId: e.target.value || undefined }))}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-2 text-xs"
            >
              <option value="">Padrão do sistema</option>
              {devices.cams.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Câmera ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-secondary px-4 py-2 text-sm hover:bg-secondary/70"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => {
            // Release preview stream before joining — LiveKit re-acquires.
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
          }}
          disabled={!title.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-50"
        >
          Entrar na sala
        </button>
      </div>
    </div>
  );
}

export function readPreCallPrefs(): Prefs {
  return loadPrefs();
}