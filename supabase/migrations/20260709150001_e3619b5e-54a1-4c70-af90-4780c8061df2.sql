CREATE TABLE public.room_call_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  room_name TEXT NOT NULL,
  room_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'accepted', 'declined', 'missed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at TIMESTAMPTZ
);

GRANT ALL ON public.room_call_events TO service_role;

ALTER TABLE public.room_call_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX room_call_events_target_status_created_idx
  ON public.room_call_events (target_user_id, status, created_at DESC);

CREATE INDEX room_call_events_caller_created_idx
  ON public.room_call_events (caller_user_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.room_call_events;