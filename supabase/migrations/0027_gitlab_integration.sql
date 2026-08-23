-- GitLab integration: two-way issue sync (mirroring Jira/GitHub) plus the
-- connection schema MR feedback needs. See
-- docs/superpowers/specs/2026-08-23-gitlab-integration-design.md.
--
-- GitLab connections are project-scoped exactly like GitHub's — the
-- existing partial unique index (project_id, provider) where project_id is
-- not null, added in 0022_github_integration.sql, already covers a third
-- provider with no index changes needed here.

alter type issue_tracker_provider add value 'gitlab';

alter table issue_tracker_connections
  add column gitlab_instance_url text,
  add column gitlab_project_path text,
  add column gitlab_webhook_token text,
  add column gitlab_webhook_id bigint;

-- Creates a project-scoped GitLab connection and its Vault secret
-- atomically, mirroring create_github_connection exactly.
create or replace function create_gitlab_connection(
  p_project_id uuid,
  p_instance_url text,
  p_project_path text,
  p_token text,
  p_webhook_token text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_secret_id uuid;
  v_connection_id uuid;
begin
  v_org_id := private.project_org_id(p_project_id);

  if v_org_id is null or not private.is_org_admin(v_org_id) then
    raise exception 'Only org admins can connect an issue tracker.';
  end if;

  v_secret_id := vault.create_secret(p_token, 'gitlab_pat_' || p_project_id::text);

  insert into issue_tracker_connections (
    org_id, project_id, provider, gitlab_instance_url, gitlab_project_path,
    vault_secret_id, gitlab_webhook_token, created_by
  )
  values (
    v_org_id, p_project_id, 'gitlab', p_instance_url, p_project_path,
    v_secret_id, p_webhook_token, auth.uid()
  )
  returning id into v_connection_id;

  return v_connection_id;
end;
$$;

grant execute on function create_gitlab_connection(uuid, text, text, text, text) to authenticated;

-- Decrypts and returns a connection's GitLab PAT for a signed-in caller.
-- Same reasoning as get_github_pat: NOT used by the ingest route (no
-- signed-in user in an API-key request) — see
-- api_get_gitlab_pat_for_project below for that path.
create or replace function get_gitlab_pat(p_connection_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_token text;
begin
  select org_id into v_org_id from issue_tracker_connections where id = p_connection_id;

  if v_org_id is null or not private.is_org_member(v_org_id) then
    raise exception 'Not authorized for this connection.';
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets ds
  join issue_tracker_connections c on c.vault_secret_id = ds.id
  where c.id = p_connection_id;

  return v_token;
end;
$$;

grant execute on function get_gitlab_pat(uuid) to authenticated;

-- Disconnects a tracker and cleans up its Vault secret, mirroring
-- delete_github_connection.
create or replace function delete_gitlab_connection(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_secret_id uuid;
begin
  select org_id, vault_secret_id into v_org_id, v_secret_id
  from issue_tracker_connections where id = p_connection_id;

  if v_org_id is null or not private.is_org_admin(v_org_id) then
    raise exception 'Only org admins can disconnect an issue tracker.';
  end if;

  delete from issue_tracker_connections where id = p_connection_id;
  perform vault.delete_secret(v_secret_id);
end;
$$;

grant execute on function delete_gitlab_connection(uuid) to authenticated;

-- MR feedback columns, mirroring pr_number/pr_url from
-- 0023_pr_feedback_ingestion.sql.
alter table test_runs
  add column mr_iid integer,
  add column mr_url text;

-- api_ingest_run_results' return type is changing (an added mr_url
-- column) — Postgres doesn't allow that via CREATE OR REPLACE, so the
-- existing 6-arg version must be dropped first, same as 0023 did to the
-- original 5-arg version.
drop function if exists api_ingest_run_results(uuid, uuid, uuid, text, jsonb, integer);

create or replace function api_ingest_run_results(
  p_org_id uuid,
  p_key_id uuid,
  p_project_id uuid,
  p_run_name text,
  p_results jsonb,
  p_pr_number integer default null,
  p_mr_iid integer default null
)
returns table (run_id uuid, matched integer, auto_created integer, pr_url text, mr_url text)
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
  v_mr_url text;
  v_repo_owner text;
  v_repo_name text;
  v_instance_url text;
  v_project_path text;
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

  if p_pr_number is not null then
    select github_repo_owner, github_repo_name into v_repo_owner, v_repo_name
    from issue_tracker_connections
    where project_id = p_project_id and provider = 'github';

    if v_repo_owner is not null then
      v_pr_url := 'https://github.com/' || v_repo_owner || '/' || v_repo_name || '/pull/' || p_pr_number;
    end if;
  end if;

  -- mr_url is only ever derived from a stored GitLab connection, never
  -- from caller input directly — same reasoning as pr_url above.
  if p_mr_iid is not null then
    select gitlab_instance_url, gitlab_project_path into v_instance_url, v_project_path
    from issue_tracker_connections
    where project_id = p_project_id and provider = 'gitlab';

    if v_project_path is not null then
      v_mr_url := coalesce(v_instance_url, 'https://gitlab.com') || '/' || v_project_path
        || '/-/merge_requests/' || p_mr_iid;
    end if;
  end if;

  insert into test_runs (project_id, name, status, created_by, completed_at, pr_number, pr_url, mr_iid, mr_url)
  values (p_project_id, p_run_name, 'completed', v_creator, now(), p_pr_number, v_pr_url, p_mr_iid, v_mr_url)
  returning id into v_run_id;

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

  return query select v_run_id, v_matched, v_auto_created, v_pr_url, v_mr_url;
end;
$$;

revoke all on function api_ingest_run_results(uuid, uuid, uuid, text, jsonb, integer, integer) from public, anon, authenticated;

-- Lets the ingest route (service-role, no signed-in user) retrieve a
-- project's connected GitLab PAT to post a best-effort MR comment. Mirrors
-- api_get_github_pat_for_project exactly: scoped by an already-validated
-- org_id/project_id pair, never granted to authenticated. Returns zero
-- rows if the project has no GitLab connection (not an error).
create or replace function api_get_gitlab_pat_for_project(p_org_id uuid, p_project_id uuid)
returns table (token text, instance_url text, project_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection_id uuid;
  v_instance_url text;
  v_project_path text;
  v_token text;
begin
  if not exists (select 1 from projects where id = p_project_id and org_id = p_org_id) then
    raise exception 'Project not found in this organization.';
  end if;

  select id, gitlab_instance_url, gitlab_project_path
  into v_connection_id, v_instance_url, v_project_path
  from issue_tracker_connections
  where project_id = p_project_id and provider = 'gitlab';

  if v_connection_id is null then
    return;
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets ds
  join issue_tracker_connections c on c.vault_secret_id = ds.id
  where c.id = v_connection_id;

  return query select v_token, v_instance_url, v_project_path;
end;
$$;

revoke all on function api_get_gitlab_pat_for_project(uuid, uuid) from public, anon, authenticated;
