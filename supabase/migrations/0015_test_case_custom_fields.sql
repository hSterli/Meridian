-- Custom field DEFINITIONS, project-scoped, mirroring test_case_features'
-- structure and RLS treatment exactly. Field VALUES live in the existing
-- test_cases.custom_fields jsonb column (present since 0001_init.sql, never
-- used until now), keyed by this table's id — not name — so renaming a
-- field later doesn't orphan already-stored values.

create type test_case_custom_field_type as enum ('text', 'number', 'select');

create table test_case_custom_fields (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  field_type test_case_custom_field_type not null,
  options jsonb not null default '[]', -- string[], only meaningful when field_type = 'select'
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create index test_case_custom_fields_project_id_idx on test_case_custom_fields(project_id);

alter table test_case_custom_fields enable row level security;

create policy "members can view custom fields" on test_case_custom_fields
  for select using (private.is_org_member(private.project_org_id(project_id)));
create policy "members can manage custom fields" on test_case_custom_fields
  for all using (private.is_org_member(private.project_org_id(project_id)))
  with check (private.is_org_member(private.project_org_id(project_id)));
