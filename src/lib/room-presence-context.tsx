import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEPARTMENT_ROOMS } from "@/lib/rooms";
import { listSectorRooms } from "@/lib/livekit-token.functions";

interface BusyInfo {
  roomName: string;
  roomLabel: string;
}

interface RoomPresenceValue {
  busyByUser: Record<string, BusyInfo>;
  speakersByRoom: Record<string, string[]>;
  isBusy(userId: string): boolean;
  busyRoomLabel(userId: string): string | null;
  refresh(): void;
}

const Ctx = createContext<RoomPresenceValue | null>(null);

export function RoomPresenceProvider({ children }: { children: ReactNode }) {
  const [busyByUser, setBusyByUser] = useState<Record<string, BusyInfo>>({});
  const [speakersByRoom, setSpeakersByRoom] = useState<Record<string, string[]>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const sectors = DEPARTMENT_ROOMS.map((r) => r.name);
        const res = await listSectorRooms({ data: { sectors } });
        if (cancelled) return;
        const busy: Record<string, BusyInfo> = {};
        const speakers: Record<string, string[]> = {};
        for (const [sector, list] of Object.entries(res.bySector)) {
          const label = DEPARTMENT_ROOMS.find((d) => d.name === sector)?.label ?? sector;
          for (const room of list) {
            const parts = room.name.split("-");
            const n = parts.length > 1 ? Number(parts[1]) : 1;
            const roomLabel = `${label} · Sala ${isNaN(n) ? 1 : n}`;
            if (Array.isArray(room.activeSpeakers)) {
              speakers[room.name] = room.activeSpeakers as string[];
            }
            for (const p of room.participants) {
              const uid = (p.identity || "").split("-")[0];
              if (uid) busy[uid] = { roomName: room.name, roomLabel };
            }
          }
        }
        setBusyByUser(busy);
        setSpeakersByRoom(speakers);
      } catch {
        /* keep last */
      }
    }
    poll();
    const id = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tick]);

  const value: RoomPresenceValue = {
    busyByUser,
    speakersByRoom,
    isBusy: (uid) => !!busyByUser[uid],
    busyRoomLabel: (uid) => busyByUser[uid]?.roomLabel ?? null,
    refresh: () => setTick((t) => t + 1),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRoomPresence() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRoomPresence must be used within RoomPresenceProvider");
  return v;
}