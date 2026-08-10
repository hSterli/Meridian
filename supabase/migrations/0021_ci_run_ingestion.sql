-- CI-triggered run ingestion: lets a CI pipeline report an entire test
-- run's results in one call, without a human pre-creating the run. See
-- docs/superpowers/specs/2026-08-09-ci-triggered-run-ingestion-design.md.
--
-- p_key_id is the API key making the request (already resolved by
-- validate_api_key in the route handler, never caller-supplied) — its
-- created_by is what test_runs.created_by / test_cases.created_by get set
-- to, since both are NOT NULL and there's no signed-in human (auth.uid())
-- in an API-key-authenticated request.
create or replace function api_ingest_run_results(
  p_org_id uuid,
  p_key_id uuid,
  p_project_id uuid,
  p_run_name text,
  p_results jsonb
)
returns table (run_id uuid, matched integer, auto_created integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid;
  v_run_id uuid;
  v_feature_id uuid;
  v_result jsonb;
  v_test_case_id uuid;
  v_matched integer := 0;
  v_auto_created integer := 0;
begin
  if not exists (select 1 from projects where id = p_project_id and org_id = p_org_id) then
    raise exception 'Project not found in this organization.';
  end if;

  select ak.created_by into v_creator
  from api_keys ak
  where ak.id = p_key_id and ak.org_id = p_org_id;

  if v_creator is null then
    raise exception 'API key not found in this organization.';
  end if;

  insert into test_runs (project_id, name, status, created_by, completed_at)
  values (p_project_id, p_run_name, 'completed', v_creator, now())
  returning id into v_run_id;

  -- Get-or-create the "CI Imported" feature. This is safe to do atomically
  -- with ON CONFLICT (unlike the equivalent TypeScript upsertFeature helper
  -- in src/lib/actions/test-cases.ts, which needs a manual
  -- select-insert-reselect-on-23505 dance specifically because it's split
  -- across multiple round-trips from a client) since this whole function
  -- runs as one statement-level transaction.
  insert into test_case_features (project_id, name)
  values (p_project_id, 'CI Imported')
  on conflict (project_id, name) do nothing;

  select id into v_feature_id
  from test_case_features
  where project_id = p_project_id and name = 'CI Imported';

  for v_result in select * from jsonb_array_elements(p_results)
  loop
    select id into v_test_case_id
    from test_cases
    where project_id = p_project_id and title = (v_result->>'title');

    if v_test_case_id is null then
      insert into test_cases (project_id, title, feature_id, created_by, status)
      values (p_project_id, v_result->>'title', v_feature_id, v_creator, 'draft')
      returning id into v_test_case_id;
      v_auto_created := v_auto_created + 1;
    else
      v_matched := v_matched + 1;
    end if;

    insert into test_run_cases (run_id, test_case_id, status, notes, executed_at, order_index)
    values (
      v_run_id,
      v_test_case_id,
      (v_result->>'status')::run_case_status,
      v_result->>'notes',
      now(),
      coalesce((select max(order_index) + 1 from test_run_cases where test_run_cases.run_id = v_run_id), 0)
    );
  end loop;

  return query select v_run_id, v_matched, v_auto_created;
end;
$$;

revoke all on function api_ingest_run_results(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
