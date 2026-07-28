-- test_run_cases had an index on run_id but not test_case_id, so "this test
-- case's execution history across all runs" (needed by any future flaky-test
-- or test-detail-history feature) would be a full table scan as data grows.

create index test_run_cases_test_case_id_idx on test_run_cases(test_case_id);
