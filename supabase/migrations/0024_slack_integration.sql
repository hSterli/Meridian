-- Slack integration: outbound-only run-completion notifications posted via
-- chat.postMessage when a CI-ingested run finishes
-- (POST /api/v1/runs/ingest). See
-- docs/superpowers/specs/2026-08-17-slack-integration-design.md.
--
-- Deliberately NOT added to issue_tracker_connections: Slack isn't an issue
-- tracker (no inbound issue sync, no webhook_token/jira_*/github_* columns
-- apply) — a purpose-built table avoids a wide table of mostly-null-for-
-- Slack columns.
--
-- Project-scoped (like GitHub, not org-scoped like Jira): the only trigger
-- is CI-ingested run completion, which resolves to exactly one project per
-- ingest call — no cross-project notification need to justify org-scoping.

create table slack_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade unique,
  channel_id text not null,
  vault_secret_id uuid not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index slack_connections_org_id_idx on slack_connections(org_id);

-- No separate project_id index: the table's own unique constraint on
-- project_id already creates one.

alter table slack_connections enable row level security;

-- Single admin-only policy, matching issue_tracker_connections' actual
-- shape exactly (not admin-manage + member-view) — regular members get
-- access only through get_slack_bot_token's own is_org_member check below,
-- never direct table SELECT.
create policy "admins can manage slack connections" on slack_connections
  for all using (private.is_org_admin(org_id))
  with check (private.is_org_admin(org_id));

-- Creates the connection and its Vault secret atomically, mirroring
-- create_github_connection. org_id is derived from the project and stored
-- redundantly, same reasoning as issue_tracker_connections.
create or replace function create_slack_connection(
  p_project_id uuid,
  p_channel_id text,
  p_bot_token text
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
    raise exception 'Only org admins can connect Slack notifications.';
  end if;

  v_secret_id := vault.create_secret(p_bot_token, 'slack_bot_token_' || p_project_id::text);

  insert into slack_connections (org_id, project_id, channel_id, vault_secret_id, created_by)
  values (v_org_id, p_project_id, p_channel_id, v_secret_id, auth.uid())
  returning id into v_connection_id;

  return v_connection_id;
end;
$$;

-- Decrypts and returns a connection's Slack bot token for a signed-in
-- caller. Granted to authenticated with its own is_org_member check (Vault
-- access bypasses RLS). NOT used by the ingest route (no signed-in user in
-- an API-key request) — see api_get_slack_bot_token_for_project below.
create or replace function get_slack_bot_token(p_connection_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_token text;
begin
  select org_id into v_org_id from slack_connections where id = p_connection_id;

  if v_org_id is null or not private.is_org_member(v_org_id) then
    raise exception 'Not authorized for this connection.';
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets ds
  join slack_connections c on c.vault_secret_id = ds.id
  where c.id = p_connection_id;

  return v_token;
end;
$$;

-- Disconnects and cleans up the Vault secret, mirroring delete_github_connection.
create or replace function delete_slack_connection(p_connection_id uuid)
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
  from slack_connections where id = p_connection_id;

  if v_org_id is null or not private.is_org_admin(v_org_id) then
    raise exception 'Only org admins can disconnect Slack notifications.';
  end if;

  delete from slack_connections where id = p_connection_id;
  perform vault.delete_secret(v_secret_id);
end;
$$;

-- Explicit lockdown from the start (the 0004/0018 convention), rather than
-- relying on the default PUBLIC execute grant and fixing it in a later
-- migration the way Jira's 0017->0018 history had to.
revoke all on function create_slack_connection(uuid, text, text) from public, anon;
revoke all on function get_slack_bot_token(uuid) from public, anon;
revoke all on function delete_slack_connection(uuid) from public, anon;

grant execute on function create_slack_connection(uuid, text, text) to authenticated;
grant execute on function get_slack_bot_token(uuid) to authenticated;
grant execute on function delete_slack_connection(uuid) to authenticated;

-- Lets the ingest route (service-role, no signed-in user) retrieve a
-- project's connected Slack bot token + channel to post a best-effort
-- run-completion notification. Mirrors api_get_github_pat_for_project
-- exactly: scoped by an already-validated org_id/project_id pair, never
-- granted to authenticated — only reachable via the service-role client.
-- Returns zero rows if the project has no Slack connection (not an error).
create or replace function api_get_slack_bot_token_for_project(p_org_id uuid, p_project_id uuid)
returns table (token text, channel_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection_id uuid;
  v_channel_id text;
  v_token text;
begin
  if not exists (select 1 from projects where id = p_project_id and org_id = p_org_id) then
    raise exception 'Project not found in this organization.';
  end if;

  select id, channel_id into v_connection_id, v_channel_id
  from slack_connections
  where project_id = p_project_id;

  if v_connection_id is null then
    return;
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets ds
  join slack_connections c on c.vault_secret_id = ds.id
  where c.id = v_connection_id;

  return query select v_token, v_channel_id;
end;
$$;

revoke all on function api_get_slack_bot_token_for_project(uuid, uuid) from public, anon, authenticated;
