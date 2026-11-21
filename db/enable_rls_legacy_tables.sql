-- Turn on row-level security for the original VitaSense tables.
--
-- Only the VitaSense API reads and writes these tables, and it connects with the service-role key,
-- which bypasses RLS. With RLS on and no policies, the public anon / authenticated keys can no
-- longer read or change anything here (Supabase advisor 0013 "RLS disabled in public").
-- The vs_* tables from vitasense_hosted_storage.sql already have RLS on.
--
-- Applied to the hosted project on 2026-11-20. Safe to run again.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_life_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_medical_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_food_body_relationship ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_emotional_wellness ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_personal_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_user_health_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatbot_conversation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_fitness_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_environment_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_device_behavior_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_calendar_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_user_memory_logs ENABLE ROW LEVEL SECURITY;
