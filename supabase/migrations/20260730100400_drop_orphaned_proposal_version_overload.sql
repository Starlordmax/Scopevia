-- Hygiene follow-up to 20260730100300's discovery: 20260730100200 added a
-- 4th parameter to create_initial_proposal_version() the same way
-- (CREATE OR REPLACE with a different arg count), leaving an orphaned
-- 3-parameter overload in the database alongside the new 4-parameter one.
-- This one never caused a functional bug -- the function is internal-only
-- (never called via PostgREST/RPC) and its single call site
-- (create_proposal_direct()) already always passes all 4 arguments
-- positionally, which Postgres resolves unambiguously by argument count
-- -- but leaving a dead, orphaned overload around is exactly the kind of
-- thing that caused the REAL bug fixed in 20260730100300. Dropped here
-- for the same reason: one function, one signature, no ambiguity.

drop function if exists public.create_initial_proposal_version(uuid, uuid, uuid);
