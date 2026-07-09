CREATE POLICY "Room call events are backend only"
ON public.room_call_events
FOR ALL
USING (false)
WITH CHECK (false);