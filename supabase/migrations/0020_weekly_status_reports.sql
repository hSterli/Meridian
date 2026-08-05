-- Weekly Status Report: a live, always-current dashboard per project, plus
-- a non-destructive snapshot mechanism so a report that's been shared
-- externally has a trustworthy historical record. See
-- docs/superpowers/specs/2026-08-04-weekly-status-report-design.md.

create type report_rag_status as enum ('red', 'amber', 'green');

-- The single, always-current editorial state for a project's weekly report.
-- Overwritten in place as the analyst edits through the week — no history
-- needed here, since snapshots are what preserve history.
create table weekly_report_drafts (
  project_id uuid primary key references projects(id) on delete cascade,
  rag_status report_rag_status not null default 'green',
  highlights text not null default '',
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table weekly_report_drafts enable row level security;

create policy "members can view weekly report drafts" on weekly_report_drafts
  for select using (private.is_org_member(private.project_org_id(project_id)));
create policy "members can upsert weekly report drafts" on weekly_report_drafts
  for insert with check (private.is_org_member(private.project_org_id(project_id)));
create policy "members can update weekly report drafts" on weekly_report_drafts
  for update using (private.is_org_member(private.project_org_id(project_id)));

-- Planned execution count per calendar date. Persists independently of any
-- snapshot; old dates just become historical once the week moves on.
create table weekly_report_daily_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  plan_date date not null,
  planned_count integer not null default 0,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (project_id, plan_date)
);

create index weekly_report_daily_plans_project_id_idx on weekly_report_daily_plans(project_id);

alter table weekly_report_daily_plans enable row level security;

create policy "members can view daily plans" on weekly_report_daily_plans
  for select using (private.is_org_member(private.project_org_id(project_id)));
create policy "members can upsert daily plans" on weekly_report_daily_plans
  for insert with check (private.is_org_member(private.project_org_id(project_id)));
create policy "members can update daily plans" on weekly_report_daily_plans
  for update using (private.is_org_member(private.project_org_id(project_id)));

-- Permanent, append-only captures. metrics/daily_planned are frozen forever;
-- rag_status/highlights may be corrected in place after capture (enforced
-- at the Server Action layer, not RLS — see uploadAttachment-style comment
-- in the Server Actions task below).
create table weekly_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  week_ending date not null,
  rag_status report_rag_status not null,
  highlights text not null,
  metrics jsonb not null,
  daily_planned jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index weekly_report_snapshots_project_id_idx on weekly_report_snapshots(project_id);
create index weekly_report_snapshots_project_week_idx on weekly_report_snapshots(project_id, week_ending);

alter table weekly_report_snapshots enable row level security;

create policy "members can view snapshots" on weekly_report_snapshots
  for select using (private.is_org_member(private.project_org_id(project_id)));
create policy "members can create snapshots" on weekly_report_snapshots
  for insert with check (private.is_org_member(private.project_org_id(project_id)));
create policy "members can edit snapshot editorial fields" on weekly_report_snapshots
  for update using (private.is_org_member(private.project_org_id(project_id)));
