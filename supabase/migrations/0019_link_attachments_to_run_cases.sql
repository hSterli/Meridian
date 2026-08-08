-- Lets testers attach screenshots to a specific run execution while still
-- surfacing them on the test case's own Attachments panel. run_case_id is
-- additive metadata only — RLS stays keyed off test_case_id exactly as
-- before, since a run_case always belongs to the same test_case anyway.

alter table test_case_attachments
  add column run_case_id uuid references test_run_cases(id) on delete set null;

create index test_case_attachments_run_case_id_idx on test_case_attachments(run_case_id);
