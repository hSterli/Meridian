-- Test Suites: a reusable, named set of test cases per project (e.g.
-- "Regression") that can be re-run repeatedly. This decouples "which test
-- cases belong together" (editable at any time — new feature ships, add its
-- cases to the suite) from "a single dated execution" (a test_runs row,
-- which snapshots the suite's membership at the moment it's run so past
-- results don't shift if membership changes later).

create table test_suites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create table test_suite_cases (
  suite_id uuid not null references test_suites(id) on delete cascade,
  test_case_id uuid not null references test_cases(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (suite_id, test_case_id)
);

create index test_suites_project_id_idx on test_suites(project_id);
create index test_suite_cases_suite_id_idx on test_suite_cases(suite_id);

alter table test_runs add column suite_id uuid references test_suites(id) on delete set null;
create index test_runs_suite_id_idx on test_runs(suite_id);

alter table test_suites enable row level security;
alter table test_suite_cases enable row level security;

create policy "members can view suites" on test_suites
  for select using (private.is_org_member(private.project_org_id(project_id)));
create policy "members can create suites" on test_suites
  for insert with check (
    private.is_org_member(private.project_org_id(project_id)) and created_by = auth.uid()
  );
create policy "members can update suites" on test_suites
  for update using (private.is_org_member(private.project_org_id(project_id)));
create policy "members can delete suites" on test_suites
  for delete using (private.is_org_member(private.project_org_id(project_id)));

create policy "members can view suite cases" on test_suite_cases
  for select using (
    private.is_org_member(private.project_org_id((select project_id from test_suites where id = suite_id)))
  );
create policy "members can manage suite cases" on test_suite_cases
  for all using (
    private.is_org_member(private.project_org_id((select project_id from test_suites where id = suite_id)))
  )
  with check (
    private.is_org_member(private.project_org_id((select project_id from test_suites where id = suite_id)))
  );
