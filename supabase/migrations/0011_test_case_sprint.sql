-- Optional sprint number on test cases, so the library can be grouped by
-- feature or by sprint. Nullable and unconstrained (unlike Feature, this
-- isn't required) — it's a lightweight tag for grouping, not a full
-- sprint/milestone entity (that's the PRD's Phase 2 "Milestones" feature).

alter table test_cases add column sprint_number integer;
create index test_cases_sprint_number_idx on test_cases(sprint_number);
