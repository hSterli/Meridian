-- Recovered from the live project's migration history
-- (supabase_migrations.schema_migrations, version 20260719195730,
-- name "revoke_anon_function_execute"). This is a pre-existing gap in the
-- local migrations directory, not something added this session — the file
-- was simply never committed to this repo even though it was applied live.
--
-- IMPORTANT — this is preserved verbatim as a historical record, not a
-- literal instruction to replay on a fresh database in sequential file
-- order. Chronologically, this migration originally ran right after
-- 0004_lock_down_function_execute.sql and before
-- 0006_private_schema_hardening.sql, when is_org_member/is_org_admin/
-- project_org_id still lived in the `public` schema. 0006 later moved all
-- three into the non-exposed `private` schema. Applied at its current
-- sequential position (after 0024), the three `revoke ... on function
-- is_org_member(uuid) ...` statements below will fail with "function does
-- not exist" against a freshly-applied database, since those functions are
-- private.* by the time this file would run, not public.* — their
-- anon-execute exposure is already closed by the private-schema move
-- itself, making a public-schema revoke on them moot at this position.
-- `get_org_members(uuid)` is unaffected — it's still in `public` today, so
-- that one revoke statement remains both accurate and necessary.
--
-- If reconciling this properly (renumbering the whole sequence to restore
-- true chronological order) ever becomes worth the churn, do it then. Until
-- then, this file exists for completeness/audit parity with the live
-- project, not as a blindly-replayable fresh-install step.

revoke execute on function is_org_member(uuid) from anon;
revoke execute on function is_org_admin(uuid) from anon;
revoke execute on function project_org_id(uuid) from anon;
revoke execute on function get_org_members(uuid) from anon;
