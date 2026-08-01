-- Fixes a real bug introduced by 20260730100100: `CREATE OR REPLACE
-- FUNCTION create_client(...)`/`update_client(...)` with 6 new trailing
-- parameters did NOT replace the original 13-parameter functions --
-- Postgres only treats CREATE OR REPLACE as a true replacement when the
-- parameter list is identical; a different parameter count creates a
-- SECOND, ADDITIONAL overload instead. This left two functions named
-- create_client (and two named update_client) in the database
-- simultaneously, which broke every existing caller that invokes them by
-- named JSON parameters without the new address fields -- PostgREST's
-- overload resolution became ambiguous, and the OLD 13-param overload
-- (the one every pre-existing call actually matches) never received the
-- `grant execute ... to authenticated` the new 19-param one needed.
--
-- Found by tests/rls/quick-create-client.test.ts regressing after
-- 20260730100100 was applied. Fixed by dropping the old-signature
-- overloads outright (forward migration, per this project's own
-- "never edit an applied migration" convention) and re-granting execute
-- on the current (19-param) signature.

drop function if exists public.create_client(uuid, text, text, text, text, text, text, text, text, text, boolean, text, text);
drop function if exists public.update_client(uuid, text, text, text, text, text, text, text, text, text, boolean, text, text);

grant execute on function public.create_client(uuid, text, text, text, text, text, text, text, text, text, boolean, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.update_client(uuid, text, text, text, text, text, text, text, text, text, boolean, text, text, text, text, text, text, text, text) to authenticated;
