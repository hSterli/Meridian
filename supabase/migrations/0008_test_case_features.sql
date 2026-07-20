-- Structured "Feature" field for test cases, distinct from free-form tags:
-- each project maintains its own managed list of feature areas, and every
-- test case must belong to exactly one.

create table test_case_features (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create index test_case_features_project_id_idx on test_case_features(project_id);

alter table test_case_features enable row level security;

create policy "members can view features" on test_case_features
  for select using (private.is_org_member(private.project_org_id(project_id)));
create policy "members can manage features" on test_case_features
  for all using (private.is_org_member(private.project_org_id(project_id)))
  with check (private.is_org_member(private.project_org_id(project_id)));

-- Backfill: give every existing project a default "General" feature and
-- point all of its existing test cases at it, so the column can go NOT NULL
-- without breaking rows that predate this migration.
insert into test_case_features (project_id, name)
select id, 'General' from projects
on conflict (project_id, name) do nothing;

alter table test_cases add column feature_id uuid references test_case_features(id) on delete restrict;

update test_cases tc
set feature_id = tcf.id
from test_case_features tcf
where tcf.project_id = tc.project_id and tcf.name = 'General';

alter table test_cases alter column feature_id set not null;

create index test_cases_feature_id_idx on test_cases(feature_id);
