# Weekly Status Report (Reports Module, Part 1) — Design

**Date**: 2026-08-04
**Status**: Approved, pending implementation plan
**Context**: First of a five-part decomposition of an externally-sourced dev spec (`~/Downloads/SQA_WEEKLY_REPORT_DEV_SPEC.md`, a real sample weekly report from a major project — "FDA APS Upgrade," an internal banking platform). That source spec describes a Summary Dashboard, Test Execution breakdown, Defect Log, Risks & Blockers tracker, and Action Items tracker as one bundled application with its own (non-Meridian) suggested tech stack. This design covers only the first two pieces — Summary Dashboard + Test Execution — built Meridian-native on top of existing data. The remaining three (Defect Log view, Risks & Blockers, Action Items) are separate future projects, each getting their own spec/plan cycle. This also becomes the first real content in Meridian's "Reports" area — task-tracked this session as "V1/P0 gap: reporting depth," previously scoped down to "team velocity + custom report builder," which this doesn't replace — it's additional scope discovered from a real user need, sequenced ahead of the previously-planned reporting work.

## Problem

The source project currently produces its weekly SQA status report by hand in Excel: manually tallying test execution counts, defect counts, and writing up a RAG status and highlights, once a week. There's no connection to Meridian's actual data — someone re-types numbers Meridian already has. Also, once a report has gone out to stakeholders, there's no way to know later exactly what was reported at the time versus what the numbers say now (defects get closed, execution continues).

## Scope decisions

1. **Single project per report**, not a multi-project rollup. Matches how every other Meridian feature is scoped (test cases, runs, issues) and matches the source spec's own sample, which is one project ("FDA APS Upgrade") even though that project internally spans several functional areas (retail front office, business front office, back office, online/mobile banking).
2. **Manual RAG status, not auto-computed.** The sample data shows "At Risk" driven by a holistic judgment (89% pass rate is fine on its own, but two modules at 0% executed made the week risky) — not something a simple pass-rate threshold would reliably reproduce. Building a scoring heuristic nobody asked for risks being wrong and undermining trust in the report. The SQA analyst sets it directly, same as they do today.
3. **"Module / Test Area" reuses Meridian's existing Feature grouping on test cases**, not a new entity. The source spec's modules (FDA Premium, FDA Direct, Business Banking, etc.) are exactly the kind of sub-area that Features already model within a single project — confirmed against the real domain context (FDA APS Upgrade is one Meridian project internally organized into these functional areas).
4. **Live dashboard + explicit, repeatable, non-destructive snapshots** — not a single "draft → finalize → locked" lifecycle, and not a pure live-query-only report. The live dashboard always reflects current data and is never locked. A "Capture this week's report" action creates a permanent snapshot record; taking another snapshot (e.g. an ad-hoc Wednesday re-share, then another Friday) never overwrites or replaces a prior one — every capture is independent. This is the only way to give a report that's been shared externally a stable, trustworthy historical record while still letting the live view update constantly.
5. **Snapshots are partially editable after capture**: the editorial fields (RAG status, highlights) can be corrected in place (e.g. fixing a typo) without spawning a new snapshot. The computed numbers (pass rate, execution counts, defect counts, the daily and per-Feature breakdowns) are frozen permanently at capture time and never editable — editing history's actual numbers would defeat the reason snapshots exist. If the underlying numbers were genuinely wrong, that calls for a new snapshot, not rewriting an old one.
6. **"Planned" execution counts are manual input**, not derived. Meridian has no concept of a forecast/target execution count — this is inherently a planning number a human sets, not something derivable from existing data. It's cheap to build (one number field per day) and it's what drives the variance highlighting the source spec treats as one of its more useful signals.
7. **No charts, no PDF export, no full Defect Log table in this pass.** Tables with color-coded variance (which the source spec explicitly wants) cover the same signal at a fraction of the build cost — Meridian has no charting library today, and none of the numbers currently derivable justify adding one yet. The source spec's own phasing agrees: "Phase 1: Basic layout and static data display" before "Phase 4: Export, sharing, and historical tracking." The two specific defect counts that belong on THIS summary (open defects, critical/high open) come straight from the existing `issues` table; the full filterable/sortable Defect Log table is deferred to the next sub-project.

## Data model

Three new tables, all project-scoped, all following the existing RLS pattern (`private.is_org_member(private.project_org_id(project_id))` for read/write — same access level as test cases and issues, not admin-gated, since this is working content produced by whoever's running QA, not an org-level setting).

```sql
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
-- rag_status/highlights may be corrected in place after capture.
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
```

The `update` policy on `weekly_report_snapshots` is intentionally not column-restricted at the RLS layer (Postgres RLS can't easily enforce "only these two columns are updatable" without a trigger) — the Server Action layer is what actually prevents `metrics`/`daily_planned`/`week_ending` from being touched on update, by only ever including `rag_status` and `highlights` in its update payload. A malicious direct API call could theoretically bypass the Server Action, but that's true of every other write-scoped table in this app and isn't a new risk introduced here — worth a targeted follow-up (a `BEFORE UPDATE` trigger rejecting changes to the frozen columns) if this ever needs hardening, not required for this pass.

`metrics` jsonb shape (frozen at capture time):

```json
{
  "totalTestCases": 216,
  "executed": 118,
  "percentComplete": 0.546,
  "passRate": 0.89,
  "openDefects": 11,
  "criticalHighOpen": 1,
  "dailyExecution": [
    { "date": "2026-07-28", "planned": 32, "actual": 29, "passed": 28, "failed": 1, "blocked": 3 }
  ],
  "moduleBreakdown": [
    { "feature": "FDA Premium", "total": 107, "executed": 96, "passed": 80, "failed": 3, "blocked": 13 }
  ]
}
```

`daily_planned` jsonb shape (a copy of that week's `weekly_report_daily_plans` rows at capture time, kept separately from `metrics.dailyExecution` only so the raw planned-count input is preserved independent of how it's later rendered):

```json
{ "2026-07-28": 32, "2026-07-29": 31 }
```

## Server Actions

New file `src/lib/actions/weekly-reports.ts`:

- `updateWeeklyReportDraft(projectId, formData)` — upserts `weekly_report_drafts` (rag_status, highlights). Rate-limited like other content-mutation actions.
- `updateDailyPlan(projectId, date, plannedCount)` — upserts a single `weekly_report_daily_plans` row.
- `computeWeeklyReportMetrics(projectId, weekStart, weekEnd)` — a plain (non-Server-Action) exported function, not a mutation, callable from Server Components: queries `test_cases`/`test_run_cases` (grouped by Feature, and by execution date within the week) and `issues` (open count, critical/high-open count) and returns the same shape as the `metrics` jsonb above. This is the one function whose output both the live page and the snapshot-capture action need to produce identically, so it's written once and called from both places rather than duplicated.
- `captureWeeklyReportSnapshot(projectId, weekEnding)` — calls `computeWeeklyReportMetrics`, reads the current draft and current daily plans, inserts a new `weekly_report_snapshots` row with all of it frozen in. Never touches `weekly_report_drafts` or `weekly_report_daily_plans` — those keep running live into the next week untouched.
- `updateSnapshotEditorialFields(snapshotId, ragStatus, highlights)` — the one allowed post-capture edit; explicitly only ever sets these two columns.

## UI

- New "Reports" tab in `ProjectTabs` (`src/components/layout/project-tabs.tsx`), alongside Test Cases/Suites/Runs/Issues.
- `src/app/(app)/projects/[projectId]/reports/page.tsx` — the live dashboard: project info, RAG status + highlights (editable, backed by `weekly_report_drafts`), key metrics table, daily execution table (Mon-Fri, editable planned column, computed actual/passed/failed/blocked/%complete, variance color-coded green/red against planned), Feature/module breakdown table (color-coded status dot per Feature, matching the RAG palette), and a "Capture this week's report" button.
- `src/app/(app)/projects/[projectId]/reports/history/page.tsx` — every snapshot for the project, grouped by `week_ending`, most recent per week shown as "current," older same-week snapshots listed underneath with their capture timestamp.
- `src/app/(app)/projects/[projectId]/reports/history/[snapshotId]/page.tsx` — a single frozen snapshot: same layout as the live dashboard but every number comes from the snapshot's `metrics`/`daily_planned` jsonb instead of a live query, with RAG status and highlights editable in place (calling `updateSnapshotEditorialFields`).
- Color palette matches the source spec's RAG convention (`#EF4444` red / `#F59E0B` amber / `#10B981` green) — introduced as new Tailwind-safe utility classes if Meridian's existing design tokens don't already cover this exact set; check `src/app/globals.css` or the existing design-token setup before adding new colors, since amber/red/green likely already exist for status badges elsewhere (e.g. issue severity, run case status).

## Testing

Fits the automated-test-suite infrastructure already mid-build this session:

- **Unit**: `computeWeeklyReportMetrics`'s aggregation logic — if the Feature-grouping and date-bucketing math is extracted into a pure function separate from the Supabase query itself (recommended: query raw rows, then run a pure function over them), that pure function gets unit tests covering an empty week, a week with no executions, and correct percentage/variance math.
- **Integration**: RLS-as-a-real-user check that a snapshot's frozen `metrics` truly doesn't change when the underlying `issues`/`test_run_cases` data changes after capture (capture a snapshot, mutate the source data, re-fetch the snapshot, assert unchanged) — this is the single most important behavior this feature exists to guarantee, so it gets a dedicated test.
- **e2e**: not included in the currently-planned golden-path spec; a future addition.

## Explicitly out of scope (future sub-projects)

- Full filterable/sortable Defect Log table (reuses existing `issues` data, but needs its own view/filter UI).
- Risks & Blockers tracker (net-new entity, no existing Meridian table).
- Action Items / Next Steps tracker (net-new entity, no existing Meridian table).
- Charts (bar/pie/line visualizations).
- PDF export, email sharing.
- Auto-computed RAG suggestions.
- Multi-project rollup reports.
