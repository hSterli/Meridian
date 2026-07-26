-- Test case ownership/automation metadata: a real assignee distinct from
-- the creator (ownership can be reassigned later), automation status, and
-- an optional external reference link (e.g. a Jira ticket).

create type test_case_automation_status as enum ('manual_only', 'to_be_automated', 'automated');

alter table test_cases
  add column assigned_to uuid references auth.users(id) on delete set null,
  add column automation_status test_case_automation_status not null default 'manual_only',
  add column automation_script_ref text,
  add column reference_link text;

create index test_cases_assigned_to_idx on test_cases(assigned_to);
