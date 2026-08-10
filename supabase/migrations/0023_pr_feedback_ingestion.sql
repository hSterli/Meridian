-- Extends CI-triggered run ingestion with optional PR/MR association: a CI
-- script can now report which pull request a run belongs to, so
-- src/app/api/v1/runs/ingest/route.ts can post a best-effort PR comment
-- summarizing the results. See
-- docs/superpowers/specs/2026-08-10-github-integration-pr-feedback-design.md.

alter table test_runs
  add column pr_number integer,
  add column pr_url text;

-- The function's return type is changing (an added pr_url column), which
-- Postgres doesn't allow via CREATE OR REPLACE — the old function must be
-- dropped first.
drop function if exists api_ingest_run_results(uuid, uuid, uuid, text, jsonb);

create or replace function api_ingest_run_results(
  p_org_id uuid,
  p_key_id uuid,
  p_project_id uuid,
  p_run_name text,
  p_results jsonb,
  p_pr_number integer default null
)
returns table (run_id uuid, matched integer, auto_created integer, pr_url text)
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
  v_pr_url text;
  v_repo_owner text;
  v_repo_name text;
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

  -- pr_url is only ever derived from a stored GitHub connection, never
  -- from caller input directly — a request can supply a PR number, but the
  -- repo half of the link always comes from what the project is actually
  -- connected to, so a caller can't forge an arbitrary link.
  if p_pr_number is not null then
    select github_repo_owner, github_repo_name into v_repo_owner, v_repo_name
    from issue_tracker_connections
    where project_id = p_project_id and provider = 'github';

    if v_repo_owner is not null then
      v_pr_url := 'https://github.com/' || v_repo_owner || '/' || v_repo_name || '/pull/' || p_pr_number;
    end if;
  end if;

  insert into test_runs (project_id, name, status, created_by, completed_at, pr_number, pr_url)
  values (p_project_id, p_run_name, 'completed', v_creator, now(), p_pr_number, v_pr_url)
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

  return query select v_run_id, v_matched, v_auto_created, v_pr_url;
end;
$$;

revoke all on function api_ingest_run_results(uuid, uuid, uuid, text, jsonb, integer) from public, anon, authenticated;

-- Lets the ingest route (service-role, no signed-in user — same reasoning
-- as api_ingest_run_results above) retrieve a project's connected GitHub
-- PAT to post a best-effort PR comment. Unlike get_github_pat (which
-- checks is_org_member via auth.uid(), for user-session callers), this is
-- scoped by an already-validated org_id/project_id pair the same way every
-- other api_* function is, and is never granted to authenticated — only
-- reachable via the service-role client. Returns zero rows if the project
-- has no GitHub connection (not an error — PR comments are optional).
create or replace function api_get_github_pat_for_project(p_org_id uuid, p_project_id uuid)
returns table (token text, repo_owner text, repo_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection_id uuid;
  v_repo_owner text;
  v_repo_name text;
  v_token text;
begin
  if not exists (select 1 from projects where id = p_project_id and org_id = p_org_id) then
    raise exception 'Project not found in this organization.';
  end if;

  select id, github_repo_owner, github_repo_name
  into v_connection_id, v_repo_owner, v_repo_name
  from issue_tracker_connections
  where project_id = p_project_id and provider = 'github';

  if v_connection_id is null then
    return;
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets ds
  join issue_tracker_connections c on c.vault_secret_id = ds.id
  where c.id = v_connection_id;

  return query select v_token, v_repo_owner, v_repo_name;
end;
$$;

revoke all on function api_get_github_pat_for_project(uuid, uuid) from public, anon, authenticated;
