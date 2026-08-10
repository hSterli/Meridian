-- GitHub integration: two-way issue sync (mirroring the Jira integration)
-- plus the connection schema PR/MR feedback needs. See
-- docs/superpowers/specs/2026-08-10-github-integration-pr-feedback-design.md.
--
-- Unlike Jira (one connection per org), a GitHub connection is scoped to a
-- single Meridian project — a PR's repo is tied to a specific codebase, not
-- an org-wide default. project_id stays null on existing Jira rows
-- (org-scoped) and is always set on new GitHub rows (project-scoped); two
-- partial unique indexes replace the old single (org_id, provider)
-- constraint so each scoping rule is enforced independently.

alter type issue_tracker_provider add value 'github';

alter table issue_tracker_connections
  add column project_id uuid references projects(id) on delete cascade,
  add column github_repo_owner text,
  add column github_repo_name text,
  add column github_webhook_secret text,
  add column github_webhook_id bigint;

-- webhook_token is Jira's URL-embedded lookup token. GitHub doesn't use it
-- — inbound GitHub webhooks are looked up by repo owner/name and verified
-- via github_webhook_secret's HMAC signature instead — so it must become
-- nullable for GitHub rows. Its existing unique constraint is untouched:
-- Postgres treats multiple NULLs as distinct, so nullability doesn't
-- weaken the constraint for Jira's rows.
alter table issue_tracker_connections alter column webhook_token drop not null;

alter table issue_tracker_connections drop constraint issue_tracker_connections_org_id_provider_key;

create unique index issue_tracker_connections_org_provider_idx
  on issue_tracker_connections(org_id, provider) where project_id is null;

create unique index issue_tracker_connections_project_provider_idx
  on issue_tracker_connections(project_id, provider) where project_id is not null;

create index issue_tracker_connections_project_id_idx on issue_tracker_connections(project_id);

-- Creates a project-scoped GitHub connection and its Vault secret
-- atomically, mirroring create_jira_connection. org_id is still populated
-- (derived from the project) even though the connection is scoped by
-- project_id, since issue_tracker_connections' existing RLS policies key
-- off org_id for both providers.
create or replace function create_github_connection(
  p_project_id uuid,
  p_repo_owner text,
  p_repo_name text,
  p_token text,
  p_webhook_secret text
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

  v_secret_id := vault.create_secret(p_token, 'github_pat_' || p_project_id::text);

  insert into issue_tracker_connections (
    org_id, project_id, provider, github_repo_owner, github_repo_name,
    vault_secret_id, github_webhook_secret, created_by
  )
  values (
    v_org_id, p_project_id, 'github', p_repo_owner, p_repo_name,
    v_secret_id, p_webhook_secret, auth.uid()
  )
  returning id into v_connection_id;

  return v_connection_id;
end;
$$;

grant execute on function create_github_connection(uuid, text, text, text, text) to authenticated;

-- Decrypts and returns a connection's GitHub PAT for a signed-in caller.
-- Same reasoning as get_jira_api_token: granted to authenticated, with its
-- own is_org_member check since Vault access bypasses RLS. NOT used by the
-- ingest route (no signed-in user in an API-key request) — see
-- api_get_github_pat_for_project in migration 0023 for that path.
create or replace function get_github_pat(p_connection_id uuid)
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

grant execute on function get_github_pat(uuid) to authenticated;

-- Disconnects a tracker and cleans up its Vault secret, mirroring
-- delete_jira_connection.
create or replace function delete_github_connection(p_connection_id uuid)
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

grant execute on function delete_github_connection(uuid) to authenticated;
