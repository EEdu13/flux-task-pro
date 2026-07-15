ALTER PUBLICATION supabase_realtime ADD TABLE public.room_knocks;
ALTER TABLE public.room_knocks REPLICA IDENTITY FULL;