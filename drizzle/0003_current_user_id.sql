-- Identyfikator zalogowanego użytkownika dla polityk RLS i domyślnej wartości user_id.
--
-- auth.user_id() (pg_session_jwt) zwraca claim `sub` zweryfikowanego JWT Neon Auth, ale schemat auth należy
-- do cloud_admin i rola authenticated nie ma do niego USAGE (nie da się go nadać – patrz 0002). Funkcja
-- SECURITY DEFINER należy do właściciela bazy, który ma dostęp do auth, i zwraca WYŁĄCZNIE `sub` bieżącej
-- sesji – nie przyjmuje argumentów i nie czyta żadnych danych.
-- Schemat app nie jest wystawiony przez Data API (eksponowany jest tylko public), więc funkcja nie jest
-- dostępna jako RPC.
CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $$ SELECT auth.user_id() $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.current_user_id() FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_id() TO authenticated;
