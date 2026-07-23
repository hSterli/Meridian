-- Optional folders to organize test runs within a project (mirrors the
-- PractiTest "Test Sets" folder concept). Unlike test_case_features,
-- folder_id is nullable: an unfiled run is a normal, fully valid state
-- ("All Runs"), not an error condition.

create table run_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create index run_folders_project_id_idx on run_folders(project_id);

alter table run_folders enable row level security;

create policy "members can view run folders" on run_folders
  for select using (private.is_org_member(private.project_org_id(project_id)));
create policy "members can manage run folders" on run_folders
  for all using (private.is_org_member(private.project_org_id(project_id)))
  with check (private.is_org_member(private.project_org_id(project_id)));

alter table test_runs add column folder_id uuid references run_folders(id) on delete set null;
create index test_runs_folder_id_idx on test_runs(folder_id);
