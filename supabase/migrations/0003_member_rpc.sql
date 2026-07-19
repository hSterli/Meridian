-- organization_members has no email column (it references auth.users, which
-- isn't exposed via the PostgREST API). This RPC lets the settings page list
-- a team's members with their email, gated by org membership.

create or replace function get_org_members(check_org_id uuid)
returns table (user_id uuid, email text, role org_role, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select m.user_id, u.email, m.role, m.created_at
  from organization_members m
  join auth.users u on u.id = m.user_id
  where m.org_id = check_org_id
    and is_org_member(check_org_id)
  order by m.created_at;
$$;
