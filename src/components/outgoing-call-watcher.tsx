import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { PhoneOff, PhoneMissed } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { listOutgoingRoomCallUpdates } from "@/lib/livekit-token.functions";

/**
 * Poll caller-side call statuses so the caller learns when the target
 * declined or missed the call — otherwise the caller keeps thinking it's
 * still ringing.
 */
export function OutgoingCallWatcher() {
  const { currentUser, users } = useFluxo();
  const seenRef = useRef<Set<string>>(new Set());
  const sinceRef = useRef<string>(new Date().toISOString());

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await listOutgoingRoomCallUpdates({
          data: { sinceIso: sinceRef.current },
        });
        if (cancelled) return;
        for (const c of res.calls) {
          if (seenRef.current.has(c.id)) continue;
          seenRef.current.add(c.id);
          const target = users.find((u) => u.id === c.target_user_id);
          const name = target?.name ?? "A pessoa";
          if (c.status === "declined") {
            toast(`${name} recusou a chamada`, {
              icon: <PhoneOff className="h-4 w-4 text-destructive" />,
              description: `Sala ${c.room_label ?? c.room_name}`,
            });
          } else if (c.status === "missed") {
            toast(`${name} não atendeu`, {
              icon: <PhoneMissed className="h-4 w-4 text-amber-500" />,
              description: `Sala ${c.room_label ?? c.room_name} — sem resposta`,
            });
          }
        }
      } catch {
        /* ignore transient errors */
      }
    }
    poll();
    // 1,5s — mesmo ritmo da sondagem de chamadas recebidas, para quem ligou
    // saber rápido que foi recusado.
    const id = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [currentUser.id, users]);

  return null;
}