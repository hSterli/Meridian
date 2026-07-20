-- Security hardening: is_org_member/is_org_admin/project_org_id are internal
-- RLS helpers, security-definer, and only meant to be evaluated as part of a
-- policy expression. Because they live in the `public` schema they are also
-- directly callable by any authenticated user via /rest/v1/rpc/<fn>, and
-- project_org_id in particular discloses the org_id of ANY project id
-- (including ones the caller has no access to) since it bypasses RLS by
-- design. Moving them to a `private` schema (not in Supabase's exposed
-- PostgREST schema list) removes the direct-RPC attack surface while RLS
-- policy evaluation — which resolves functions by schema search_path, not
-- through the REST layer — keeps working unchanged with the same grants.

create schema if not exists private;

create or replace function private.is_org_member(check_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organization_members
    where org_id = check_org_id and user_id = auth.uid()
  );
$$;

create or replace function private.is_org_admin(check_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organization_members
    where org_id = check_org_id and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

create or replace function private.project_org_id(check_project_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select org_id from projects where id = check_project_id;
$$;

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.is_org_admin(uuid) from public, anon;
revoke all on function private.project_org_id(uuid) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.is_org_admin(uuid) to authenticated;
grant execute on function private.project_org_id(uuid) to authenticated;

-- Repoint every policy at the private-schema versions.

alter policy "members can view their orgs" on organizations
  using (private.is_org_member(id));
alter policy "admins can update their orgs" on organizations
  using (private.is_org_admin(id));

alter policy "members can view org membership" on organization_members
  using (private.is_org_member(org_id));
alter policy "admins can manage membership" on organization_members
  using (private.is_org_admin(org_id)) with check (private.is_org_admin(org_id));

alter policy "members can view projects" on projects
  using (private.is_org_member(org_id));
alter policy "members can create projects" on projects
  with check (private.is_org_member(org_id) and created_by = auth.uid());
alter policy "admins can update projects" on projects
  using (private.is_org_admin(org_id));
alter policy "admins can delete projects" on projects
  using (private.is_org_admin(org_id));

alter policy "members can view tags" on test_case_tags
  using (private.is_org_member(private.project_org_id(project_id)));
alter policy "members can manage tags" on test_case_tags
  using (private.is_org_member(private.project_org_id(project_id)))
  with check (private.is_org_member(private.project_org_id(project_id)));

alter policy "members can view test cases" on test_cases
  using (private.is_org_member(private.project_org_id(project_id)));
alter policy "members can create test cases" on test_cases
  with check (private.is_org_member(private.project_org_id(project_id)) and created_by = auth.uid());
alter policy "members can update test cases" on test_cases
  using (private.is_org_member(private.project_org_id(project_id)));
alter policy "members can delete test cases" on test_cases
  using (private.is_org_member(private.project_org_id(project_id)));

alter policy "members can view tag links" on test_case_tag_links
  using (
    private.is_org_member(private.project_org_id((select project_id from test_cases where id = test_case_id)))
  );
alter policy "members can manage tag links" on test_case_tag_links
  using (
    private.is_org_member(private.project_org_id((select project_id from test_cases where id = test_case_id)))
  )
  with check (
    private.is_org_member(private.project_org_id((select project_id from test_cases where id = test_case_id)))
  );

alter policy "members can view test case versions" on test_case_versions
  using (
    private.is_org_member(private.project_org_id((select project_id from test_cases where id = test_case_id)))
  );
alter policy "members can create test case versions" on test_case_versions
  with check (
    private.is_org_member(private.project_org_id((select project_id from test_cases where id = test_case_id)))
    and changed_by = auth.uid()
  );

alter policy "members can view runs" on test_runs
  using (private.is_org_member(private.project_org_id(project_id)));
alter policy "members can create runs" on test_runs
  with check (private.is_org_member(private.project_org_id(project_id)) and created_by = auth.uid());
alter policy "members can update runs" on test_runs
  using (private.is_org_member(private.project_org_id(project_id)));
alter policy "members can delete runs" on test_runs
  using (private.is_org_member(private.project_org_id(project_id)));

alter policy "members can view run cases" on test_run_cases
  using (
    private.is_org_member(private.project_org_id((select project_id from test_runs where id = run_id)))
  );
alter policy "members can manage run cases" on test_run_cases
  using (
    private.is_org_member(private.project_org_id((select project_id from test_runs where id = run_id)))
  )
  with check (
    private.is_org_member(private.project_org_id((select project_id from test_runs where id = run_id)))
  );

alter policy "members can view issues" on issues
  using (private.is_org_member(private.project_org_id(project_id)));
alter policy "members can create issues" on issues
  with check (private.is_org_member(private.project_org_id(project_id)) and created_by = auth.uid());
alter policy "members can update issues" on issues
  using (private.is_org_member(private.project_org_id(project_id)));
alter policy "members can delete issues" on issues
  using (private.is_org_member(private.project_org_id(project_id)));

alter policy "admins can view invites" on organization_invites
  using (private.is_org_admin(org_id));
alter policy "admins can create invites" on organization_invites
  with check (private.is_org_admin(org_id) and invited_by = auth.uid());
alter policy "admins can delete invites" on organization_invites
  using (private.is_org_admin(org_id));

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
    and private.is_org_member(check_org_id)
  order by m.created_at;
$$;

-- Nothing references the old public functions anymore; drop them so the
-- direct-RPC surface is actually gone rather than just unused.
drop function if exists public.is_org_member(uuid);
drop function if exists public.is_org_admin(uuid);
drop function if exists public.project_org_id(uuid);
