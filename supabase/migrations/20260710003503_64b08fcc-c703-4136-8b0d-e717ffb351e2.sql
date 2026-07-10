ALTER TABLE public.room_state ADD COLUMN IF NOT EXISTS pin text;
ALTER TABLE public.room_state ADD COLUMN IF NOT EXISTS active_speakers jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.room_state ADD COLUMN IF NOT EXISTS speakers_updated_at timestamptz;