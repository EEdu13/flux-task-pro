/*
 * ver-tela.tsx — a tela compartilhada em 2D, grande, por cima da sala.
 *
 * Por que: no telão 3D a tela fica pequena e em perspectiva — dá para ver QUE alguém
 * compartilhou, não para ler uma planilha. Aqui é outro <video> com o MESMO MediaStream do
 * compartilhamento (nada novo na rede), com a sala desfocada atrás e "Voltar à sala" (ou Esc).
 */
import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";

export function VerTela({
  video,
  quem,
  aoVoltar,
}: {
  video: HTMLVideoElement;
  quem: string;
  aoVoltar: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = video.srcObject;
    void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [video]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoVoltar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoVoltar]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black/55 p-4 backdrop-blur-md">
      <div className="mb-2 flex items-center gap-3 text-white">
        <button
          type="button"
          onClick={aoVoltar}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar à sala
        </button>
        <span className="text-sm text-white/80">Tela de {quem} · Esc para voltar</span>
      </div>
      <video
        ref={ref}
        muted
        playsInline
        className="min-h-0 w-full flex-1 rounded-xl bg-black object-contain shadow-2xl"
      />
    </div>
  );
}
