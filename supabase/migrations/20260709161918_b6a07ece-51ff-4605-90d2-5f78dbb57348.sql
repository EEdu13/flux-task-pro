
CREATE TABLE public.room_state (
  room_name TEXT PRIMARY KEY,
  is_private BOOLEAN NOT NULL DEFAULT false,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.room_state TO service_role;
ALTER TABLE public.room_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "room_state backend only" ON public.room_state FOR ALL TO public USING (false) WITH CHECK (false);

CREATE TABLE public.room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_name, user_id)
);
CREATE INDEX room_members_room_idx ON public.room_members(room_name);
GRANT ALL ON public.room_members TO service_role;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "room_members backend only" ON public.room_members FOR ALL TO public USING (false) WITH CHECK (false);

CREATE TABLE public.room_knocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_name TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  handled_by TEXT,
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX room_knocks_room_status_idx ON public.room_knocks(room_name, status);
CREATE INDEX room_knocks_requester_idx ON public.room_knocks(requester_user_id, status);
GRANT ALL ON public.room_knocks TO service_role;
ALTER TABLE public.room_knocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "room_knocks backend only" ON public.room_knocks FOR ALL TO public USING (false) WITH CHECK (false);
