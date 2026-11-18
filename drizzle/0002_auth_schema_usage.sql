-- Próba nadania roli authenticated USAGE na schemacie auth (pg_session_jwt).
-- Na Neon NIE MA EFEKTU: schemat auth należy do cloud_admin, a neondb_owner nie ma GRANT OPTION –
-- Postgres zgłasza tylko ostrzeżenie "no privileges were granted for "auth"".
-- Migracja została już zastosowana na produkcji, więc zostaje w historii; właściwe rozwiązanie to
-- funkcja app.current_user_id() z migracji 0003.
GRANT USAGE ON SCHEMA auth TO authenticated;
