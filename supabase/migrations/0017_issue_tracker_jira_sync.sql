-- Two-way Jira issue sync, per
-- docs/superpowers/specs/2026-08-03-jira-two-way-issue-sync-design.md.
-- One connection per org (Jira only — GitHub/GitLab are separate, later
-- projects reusing this same shape). The API token is stored in Supabase
-- Vault (reversible encryption), not hashed like api_keys, because this
-- token must be retrievable to call Jira's API on the org's behalf.

create type issue_tracker_provider as enum ('jira');

create table issue_tracker_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  provider issue_tracker_provider not null,
  jira_base_url text not null,
  jira_email text not null,
  jira_project_key text not null,
  vault_secret_id uuid not null,
  webhook_token text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, provider)
);

create index issue_tracker_connections_org_id_idx on issue_tracker_connections(org_id);
create index issue_tracker_connections_webhook_token_idx on issue_tracker_connections(webhook_token);

alter table issue_tracker_connections enable row level security;

create policy "admins can manage tracker connections" on issue_tracker_connections
  for all using (private.is_org_admin(org_id))
  with check (private.is_org_admin(org_id));

create table issue_tracker_links (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade unique,
  connection_id uuid not null references issue_tracker_connections(id) on delete cascade,
  external_issue_key text not null,
  external_issue_id text not null,
  external_updated_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now()
);

create index issue_tracker_links_connection_id_idx on issue_tracker_links(connection_id);
create index issue_tracker_links_external_issue_id_idx on issue_tracker_links(external_issue_id);

alter table issue_tracker_links enable row level security;

create policy "members can view tracker links" on issue_tracker_links
  for select using (
    private.is_org_member(private.project_org_id((select project_id from issues where id = issue_id)))
  );
create policy "members can manage tracker links" on issue_tracker_links
  for all using (
    private.is_org_member(private.project_org_id((select project_id from issues where id = issue_id)))
  )
  with check (
    private.is_org_member(private.project_org_id((select project_id from issues where id = issue_id)))
  );

-- Creates the connection and its Vault secret atomically, avoiding a
-- chicken-and-egg two-step insert. Unlike the API/webhook project's
-- api_* functions (never granted to authenticated, since those serve
-- API-key-authenticated requests with no real auth.uid()), this function
-- IS granted to authenticated — it's called by a real signed-in admin via
-- the normal cookie-based client — but since it touches Vault (which RLS
-- can't gate), it does its own is_org_admin check internally rather than
-- relying on a table policy.
create or replace function create_jira_connection(
  p_org_id uuid,
  p_base_url text,
  p_email text,
  p_token text,
  p_webhook_token text,
  p_project_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
  v_connection_id uuid;
begin
  if not private.is_org_admin(p_org_id) then
    raise exception 'Only org admins can connect an issue tracker.';
  end if;

  v_secret_id := vault.create_secret(p_token, 'jira_api_token_' || p_org_id::text);

  insert into issue_tracker_connections (
    org_id, provider, jira_base_url, jira_email, jira_project_key,
    vault_secret_id, webhook_token, created_by
  )
  values (
    p_org_id, 'jira', p_base_url, p_email, p_project_key,
    v_secret_id, p_webhook_token, auth.uid()
  )
  returning id into v_connection_id;

  return v_connection_id;
end;
$$;

grant execute on function create_jira_connection(uuid, text, text, text, text, text) to authenticated;

-- Decrypts and returns a connection's Jira API token. Same reasoning as
-- create_jira_connection: granted to authenticated, with its own
-- is_org_member check since Vault access bypasses RLS.
create or replace function get_jira_api_token(p_connection_id uuid)
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

grant execute on function get_jira_api_token(uuid) to authenticated;

-- Disconnects a tracker and cleans up its Vault secret rather than
-- leaving it orphaned indefinitely.
create or replace function delete_jira_connection(p_connection_id uuid)
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

grant execute on function delete_jira_connection(uuid) to authenticated;
