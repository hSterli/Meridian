-- Helper functions are meant to be used internally within RLS policies
-- (is_org_member, is_org_admin, project_org_id) or called only by signed-in
-- members (get_org_members). Revoke the default PUBLIC execute grant so
-- anonymous callers can't invoke them directly via /rest/v1/rpc/*, while
-- keeping them usable inside policy evaluation and by authenticated users.

revoke execute on function is_org_member(uuid) from public;
revoke execute on function is_org_admin(uuid) from public;
revoke execute on function project_org_id(uuid) from public;
revoke execute on function get_org_members(uuid) from public;

grant execute on function is_org_member(uuid) to authenticated;
grant execute on function is_org_admin(uuid) to authenticated;
grant execute on function project_org_id(uuid) to authenticated;
grant execute on function get_org_members(uuid) to authenticated;

-- Supabase applies its own default-privilege grant to `anon` for new functions
-- in the public schema, separate from the PUBLIC grant above — revoke it
-- explicitly too, or anon retains EXECUTE despite the revoke from public.
revoke execute on function is_org_member(uuid) from anon;
revoke execute on function is_org_admin(uuid) from anon;
revoke execute on function project_org_id(uuid) from anon;
revoke execute on function get_org_members(uuid) from anon;
