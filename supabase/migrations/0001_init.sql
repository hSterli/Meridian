-- Meridian QA — initial schema (Phase 1 MVP)
-- Orgs -> Members -> Projects -> Test Cases / Runs / Issues, all RLS-scoped by org membership.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type org_role as enum ('owner', 'admin', 'member');
create type test_case_priority as enum ('low', 'medium', 'high', 'critical');
create type test_case_status as enum ('active', 'draft', 'deprecated');
create type run_status as enum ('planned', 'in_progress', 'completed');
create type run_case_status as enum ('pending', 'passed', 'failed', 'blocked', 'skipped');
create type issue_status as enum ('open', 'in_progress', 'resolved', 'closed');
create type issue_severity as enum ('low', 'medium', 'high', 'critical');

-- ---------------------------------------------------------------------------
-- Organizations & membership
-- ---------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table organization_members (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index organization_members_user_id_idx on organization_members(user_id);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  key text not null,
  template text not null default 'blank', -- 'web' | 'mobile' | 'api' | 'blank'
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, key)
);

-- ---------------------------------------------------------------------------
-- Test cases
-- ---------------------------------------------------------------------------
create table test_case_tags (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  color text not null default '#6366f1',
  unique (project_id, name)
);

create table test_cases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  preconditions text,
  steps jsonb not null default '[]', -- [{ step: string, expected: string }]
  priority test_case_priority not null default 'medium',
  status test_case_status not null default 'active',
  custom_fields jsonb not null default '{}',
  version integer not null default 1,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index test_cases_project_id_idx on test_cases(project_id);

create table test_case_tag_links (
  test_case_id uuid not null references test_cases(id) on delete cascade,
  tag_id uuid not null references test_case_tags(id) on delete cascade,
  primary key (test_case_id, tag_id)
);

create table test_case_versions (
  id uuid primary key default gen_random_uuid(),
  test_case_id uuid not null references test_cases(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);

create index test_case_versions_test_case_id_idx on test_case_versions(test_case_id);

-- ---------------------------------------------------------------------------
-- Test runs & execution
-- ---------------------------------------------------------------------------
create table test_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  status run_status not null default 'planned',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index test_runs_project_id_idx on test_runs(project_id);

create table test_run_cases (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references test_runs(id) on delete cascade,
  test_case_id uuid not null references test_cases(id) on delete restrict,
  order_index integer not null default 0,
  status run_case_status not null default 'pending',
  notes text,
  executed_by uuid references auth.users(id),
  executed_at timestamptz,
  unique (run_id, test_case_id)
);

create index test_run_cases_run_id_idx on test_run_cases(run_id);

-- ---------------------------------------------------------------------------
-- Issues (native lightweight tracker)
-- ---------------------------------------------------------------------------
create table issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text,
  status issue_status not null default 'open',
  severity issue_severity not null default 'medium',
  linked_test_case_id uuid references test_cases(id) on delete set null,
  linked_run_case_id uuid references test_run_cases(id) on delete set null,
  assignee_id uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index issues_project_id_idx on issues(project_id);

-- ---------------------------------------------------------------------------
-- Helper functions for RLS
-- ---------------------------------------------------------------------------
create or replace function is_org_member(check_org_id uuid)
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

create or replace function is_org_admin(check_org_id uuid)
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

create or replace function project_org_id(check_project_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select org_id from projects where id = check_project_id;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table projects enable row level security;
alter table test_case_tags enable row level security;
alter table test_cases enable row level security;
alter table test_case_tag_links enable row level security;
alter table test_case_versions enable row level security;
alter table test_runs enable row level security;
alter table test_run_cases enable row level security;
alter table issues enable row level security;

-- organizations
create policy "members can view their orgs" on organizations
  for select using (is_org_member(id));
create policy "authenticated users can create orgs" on organizations
  for insert with check (auth.uid() = created_by);
create policy "admins can update their orgs" on organizations
  for update using (is_org_admin(id));

-- organization_members
create policy "members can view org membership" on organization_members
  for select using (is_org_member(org_id));
create policy "admins can manage membership" on organization_members
  for all using (is_org_admin(org_id)) with check (is_org_admin(org_id));
-- Scoped tightly: a user may only self-insert as 'owner', and only for an org
-- they themselves just created. This is what powers the onboarding wizard's
-- "create org, then add myself as owner" step without opening up membership
-- of arbitrary orgs to arbitrary users.
create policy "org creator can self-insert as owner" on organization_members
  for insert with check (
    user_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1 from organizations
      where organizations.id = organization_members.org_id
        and organizations.created_by = auth.uid()
    )
  );

-- projects
create policy "members can view projects" on projects
  for select using (is_org_member(org_id));
create policy "members can create projects" on projects
  for insert with check (is_org_member(org_id) and created_by = auth.uid());
create policy "admins can update projects" on projects
  for update using (is_org_admin(org_id));
create policy "admins can delete projects" on projects
  for delete using (is_org_admin(org_id));

-- test_case_tags
create policy "members can view tags" on test_case_tags
  for select using (is_org_member(project_org_id(project_id)));
create policy "members can manage tags" on test_case_tags
  for all using (is_org_member(project_org_id(project_id)))
  with check (is_org_member(project_org_id(project_id)));

-- test_cases
create policy "members can view test cases" on test_cases
  for select using (is_org_member(project_org_id(project_id)));
create policy "members can create test cases" on test_cases
  for insert with check (is_org_member(project_org_id(project_id)) and created_by = auth.uid());
create policy "members can update test cases" on test_cases
  for update using (is_org_member(project_org_id(project_id)));
create policy "members can delete test cases" on test_cases
  for delete using (is_org_member(project_org_id(project_id)));

-- test_case_tag_links
create policy "members can view tag links" on test_case_tag_links
  for select using (
    is_org_member(project_org_id((select project_id from test_cases where id = test_case_id)))
  );
create policy "members can manage tag links" on test_case_tag_links
  for all using (
    is_org_member(project_org_id((select project_id from test_cases where id = test_case_id)))
  )
  with check (
    is_org_member(project_org_id((select project_id from test_cases where id = test_case_id)))
  );

-- test_case_versions
create policy "members can view test case versions" on test_case_versions
  for select using (
    is_org_member(project_org_id((select project_id from test_cases where id = test_case_id)))
  );
create policy "members can create test case versions" on test_case_versions
  for insert with check (
    is_org_member(project_org_id((select project_id from test_cases where id = test_case_id)))
    and changed_by = auth.uid()
  );

-- test_runs
create policy "members can view runs" on test_runs
  for select using (is_org_member(project_org_id(project_id)));
create policy "members can create runs" on test_runs
  for insert with check (is_org_member(project_org_id(project_id)) and created_by = auth.uid());
create policy "members can update runs" on test_runs
  for update using (is_org_member(project_org_id(project_id)));
create policy "members can delete runs" on test_runs
  for delete using (is_org_member(project_org_id(project_id)));

-- test_run_cases
create policy "members can view run cases" on test_run_cases
  for select using (
    is_org_member(project_org_id((select project_id from test_runs where id = run_id)))
  );
create policy "members can manage run cases" on test_run_cases
  for all using (
    is_org_member(project_org_id((select project_id from test_runs where id = run_id)))
  )
  with check (
    is_org_member(project_org_id((select project_id from test_runs where id = run_id)))
  );

-- issues
create policy "members can view issues" on issues
  for select using (is_org_member(project_org_id(project_id)));
create policy "members can create issues" on issues
  for insert with check (is_org_member(project_org_id(project_id)) and created_by = auth.uid());
create policy "members can update issues" on issues
  for update using (is_org_member(project_org_id(project_id)));
create policy "members can delete issues" on issues
  for delete using (is_org_member(project_org_id(project_id)));
