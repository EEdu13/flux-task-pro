import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  FileText,
  ImagePlus,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import type { CompletionEntry, Project, Task, User } from "@/lib/fluxo-types";
import {
  downloadAttachment,
  filesToAttachments,
  formatBytes,
  isImage,
  openAttachment,
  MAX_ATT_BYTES,
} from "@/lib/attachments";
import { forecastProject, riskExplanation, riskLabels, type RiskLevel } from "@/lib/project-forecast";
import { useFluxo } from "@/lib/fluxo-store";

const riskBadge: Record<RiskLevel, string> = {
  concluido: "bg-primary/15 text-primary",
  no_prazo: "bg-success/15 text-success",
  atencao: "bg-warning/15 text-warning",
  atrasado: "bg-destructive/15 text-destructive",
  parado: "bg-muted text-muted-foreground",
  sem_prazo: "bg-muted text-muted-foreground",
};

/**
 * Painel de acompanhamento em tempo real de um projeto: leitura de risco,
 * progresso e a galeria de evidências (telas, comprovantes) que qualquer
 * pessoa do projeto pode alimentar.
 */
export function ProjectFilesModal({
  project,
  tasks,
  completions,
  users,
  onClose,
  onOpenFull,
}: {
  project: Project;
  tasks: Task[];
  completions: CompletionEntry[];
  users: User[];
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const { currentUser, addProjectAttachments, removeProjectAttachment } = useFluxo();
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const forecast = forecastProject(project, tasks, completions);
  const attachments = [...(project.attachments ?? [])].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
  const images = attachments.filter((a) => isImage(a.type));
  const files = attachments.filter((a) => !isImage(a.type));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleFiles = async (list: FileList | File[]) => {
    setBusy(true);
    try {
      const { ok, rejected } = await filesToAttachments(list, currentUser.id);
      if (ok.length) {
        addProjectAttachments(project.id, ok);
        toast.success(`${ok.length} arquivo(s) anexado(s)`, { description: project.name });
      }
      if (rejected.length) {
        toast.error("Alguns arquivos passaram do limite", {
          description: `${rejected.join(", ")} — máx. ${formatBytes(MAX_ATT_BYTES)} por arquivo.`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative border-b border-border">
          <div className="h-1.5 w-full" style={{ background: project.color ?? "var(--color-primary)" }} />
          <div className="flex items-start justify-between gap-3 px-6 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-lg font-semibold">{project.name}</h3>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${riskBadge[forecast.risk]}`}
                >
                  {riskLabels[forecast.risk]}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{riskExplanation(forecast)}</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* Progresso */}
          <div className="flex items-center gap-2 px-6 pb-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full"
                style={{ width: `${forecast.progressPct}%`, background: project.color ?? "var(--color-primary)" }}
              />
            </div>
            <span className="text-[11px] font-semibold tabular text-muted-foreground">
              {forecast.done}/{forecast.total} · {forecast.progressPct}%
            </span>
          </div>
        </div>

        {/* Corpo com scroll */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {/* Zona de upload */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
              dragOver ? "border-primary bg-primary/5" : "border-border bg-secondary/30"
            }`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Upload className="h-5 w-5" />
            </span>
            <div className="text-sm font-medium">Arraste fotos e arquivos aqui</div>
            <div className="text-[11px] text-muted-foreground">
              Telas, comprovantes, evidências — todo mundo do projeto acompanha.
            </div>
            <button
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {busy ? "Enviando…" : "Escolher arquivos"}
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {/* Galeria de imagens */}
          {images.length > 0 && (
            <div className="mt-5">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Fotos ({images.length})
              </h4>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {images.map((a) => {
                  const author = users.find((u) => u.id === a.userId);
                  return (
                    <div
                      key={a.id}
                      className="group relative overflow-hidden rounded-lg border border-border bg-background"
                    >
                      <button
                        type="button"
                        onClick={() => openAttachment(a)}
                        className="block aspect-video w-full"
                        title="Abrir imagem"
                      >
                        <img src={a.dataUrl} alt={a.name} className="h-full w-full object-cover" />
                      </button>
                      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-medium">{a.name}</div>
                          <div className="truncate text-[9px] text-muted-foreground">
                            {author?.name.split(" ")[0] ?? "—"} ·{" "}
                            {new Date(a.at).toLocaleDateString("pt-BR")}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center">
                          <button
                            onClick={() => downloadAttachment(a)}
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                            title="Baixar"
                          >
                            <Download className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => removeProjectAttachment(project.id, a.id)}
                            className="rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                            title="Remover"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Outros arquivos */}
          {files.length > 0 && (
            <div className="mt-5">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Arquivos ({files.length})
              </h4>
              <ul className="grid gap-2">
                {files.map((a) => {
                  const author = users.find((u) => u.id === a.userId);
                  return (
                    <li
                      key={a.id}
                      className="group flex items-center gap-2 rounded-md border border-border bg-background/60 p-2 text-xs"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-secondary">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{a.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatBytes(a.size)} · {author?.name.split(" ")[0] ?? "—"}
                        </div>
                      </div>
                      <button
                        onClick={() => downloadAttachment(a)}
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                        title="Baixar"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => removeProjectAttachment(project.id, a.id)}
                        className="rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                        title="Remover"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {attachments.length === 0 && (
            <p className="mt-4 text-center text-[11px] text-muted-foreground">
              Nenhuma evidência ainda. Suba a primeira foto acima.
            </p>
          )}
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-between gap-2 border-t border-border bg-secondary/30 px-6 py-3">
          <span className="text-[11px] text-muted-foreground">
            {attachments.length} anexo(s) neste projeto
          </span>
          <button
            onClick={onOpenFull}
            className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
          >
            Abrir projeto completo
          </button>
        </div>
      </div>
    </div>
  );
}
