-- Bootstrapping an org hits a chicken-and-egg RLS problem: the "members can
-- view their orgs" SELECT policy requires an organization_members row, which
-- can't exist until after the org itself is created. Since PostgREST's
-- `Prefer: return=representation` (used by `.insert().select()`) re-SELECTs
-- the row it just inserted, that re-SELECT fails RLS even though the INSERT
-- itself was fine — reported generically as "violates row-level security
-- policy". The fix: create the org and the owner's membership atomically in
-- one SECURITY DEFINER function, so no intermediate state is ever queried
-- through the normal RLS-gated path.

create or replace function create_organization_with_owner(org_name text, org_slug text)
returns organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org organizations;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into organizations (name, slug, created_by)
  values (org_name, org_slug, auth.uid())
  returning * into v_org;

  insert into organization_members (org_id, user_id, role)
  values (v_org.id, auth.uid(), 'owner');

  return v_org;
end;
$$;

revoke execute on function create_organization_with_owner(text, text) from public;
revoke execute on function create_organization_with_owner(text, text) from anon;
grant execute on function create_organization_with_owner(text, text) to authenticated;
