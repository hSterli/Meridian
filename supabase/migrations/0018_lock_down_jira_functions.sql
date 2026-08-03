-- 0017 granted create_jira_connection/get_jira_api_token/delete_jira_connection
-- to authenticated but never explicitly revoked the default PUBLIC execute
-- grant new functions get, leaving them callable by anon too (caught by
-- get_advisors after applying 0017). Functionally safe today since each
-- function's internal is_org_admin/is_org_member check fails closed when
-- auth.uid() is null (anon), but this codebase has consistently closed this
-- exact class of gap defensively rather than relying on it (see
-- 0004_lock_down_function_execute.sql) — do the same here.

revoke all on function create_jira_connection(uuid, text, text, text, text, text) from public, anon;
revoke all on function get_jira_api_token(uuid) from public, anon;
revoke all on function delete_jira_connection(uuid) from public, anon;

grant execute on function create_jira_connection(uuid, text, text, text, text, text) to authenticated;
grant execute on function get_jira_api_token(uuid) to authenticated;
grant execute on function delete_jira_connection(uuid) to authenticated;
