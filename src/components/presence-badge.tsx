import { useRoomPresence } from "@/lib/room-presence-context";

export function PresenceBadge({ userId, className }: { userId: string; className?: string }) {
  const { isBusy, busyRoomLabel } = useRoomPresence();
  const busy = isBusy(userId);
  const label = busyRoomLabel(userId);
  return (
    <span
      title={busy ? `Em reunião: ${label}` : "Disponível"}
      className={`inline-block h-2.5 w-2.5 rounded-full ring-2 ring-background ${
        busy ? "bg-red-500 animate-pulse" : "bg-emerald-500"
      } ${className ?? ""}`}
    />
  );
}

export function PresenceLabel({ userId }: { userId: string }) {
  const { isBusy, busyRoomLabel } = useRoomPresence();
  if (!isBusy(userId)) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
      Em reunião
      {busyRoomLabel(userId) ? ` · ${busyRoomLabel(userId)}` : ""}
    </span>
  );
}