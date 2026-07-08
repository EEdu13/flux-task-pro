import { FileText, Image as ImageIcon, X, Download } from "lucide-react";
import type { Attachment } from "@/lib/fluxo-types";
import { formatBytes, isImage } from "@/lib/attachments";

export function AttachmentList({
  items,
  onRemove,
  compact = false,
}: {
  items: Attachment[];
  onRemove?: (id: string) => void;
  compact?: boolean;
}) {
  if (!items.length) return null;
  return (
    <ul className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-2"}`}>
      {items.map((a) => (
        <li
          key={a.id}
          className="group flex items-center gap-2 rounded-md border border-border bg-background/60 p-2 text-xs"
        >
          {isImage(a.type) ? (
            <a href={a.dataUrl} target="_blank" rel="noreferrer" className="shrink-0">
              <img
                src={a.dataUrl}
                alt={a.name}
                className="h-10 w-10 rounded object-cover"
              />
            </a>
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-secondary">
              <FileText className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{a.name}</div>
            <div className="text-[10px] text-muted-foreground">{formatBytes(a.size)}</div>
          </div>
          <a
            href={a.dataUrl}
            download={a.name}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Baixar"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
          {onRemove && (
            <button
              onClick={() => onRemove(a.id)}
              className="rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
              title="Remover"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AttachmentBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
      <ImageIcon className="h-2.5 w-2.5" />
      {count}
    </span>
  );
}