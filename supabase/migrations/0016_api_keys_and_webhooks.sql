-- Public API foundation: org-scoped API keys and a generic inbound webhook
-- receiver, per docs/superpowers/specs/2026-08-03-public-api-webhook-infrastructure-design.md.
-- Authorization for the API is centralized in SECURITY DEFINER functions
-- (mirroring how get_org_members already works) rather than a service-role
-- client with scattered manual checks — see that spec for the full rationale.

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index api_keys_org_id_idx on api_keys(org_id);

alter table api_keys enable row level security;

create policy "admins can view org api keys" on api_keys
  for select using (private.is_org_admin(org_id));
create policy "admins can create api keys" on api_keys
  for insert with check (private.is_org_admin(org_id) and created_by = auth.uid());
create policy "admins can revoke api keys" on api_keys
  for update using (private.is_org_admin(org_id))
  with check (private.is_org_admin(org_id));

-- Inbound webhook scaffolding: storage + signature-validation only. No
-- source-specific parsing logic yet (that's separate, later projects). RLS
-- is enabled with zero policies, the same "on but nobody can touch it
-- directly" pattern already used for rate_limit_buckets — only a
-- SECURITY DEFINER path (added by future integrations) will ever read this.
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  org_id uuid references organizations(id) on delete set null,
  payload jsonb not null,
  signature_valid boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index webhook_events_source_idx on webhook_events(source);
create index webhook_events_org_id_idx on webhook_events(org_id);

alter table webhook_events enable row level security;

-- Resolves a plaintext API key to its (key_id, org_id), updating
-- last_used_at. Returns zero rows if the key doesn't exist or is revoked.
-- Never granted to authenticated/anon — called only via the service-role
-- client from API routes (src/lib/api/auth.ts), after which every other
-- api_* function below takes the resolved org_id as an explicit parameter.
create or replace function validate_api_key(p_key text)
returns table (key_id uuid, org_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key_hash text;
begin
  v_key_hash := encode(digest(p_key, 'sha256'), 'hex');

  return query
    update api_keys
    set last_used_at = now()
    where api_keys.key_hash = v_key_hash and api_keys.revoked_at is null
    returning api_keys.id, api_keys.org_id;
end;
$$;

revoke all on function validate_api_key(text) from public, anon, authenticated;

-- Rate limiting for API-key-authenticated requests. Reuses the existing
-- rate_limit_buckets table from 0007_rate_limiting.sql but with a distinct
-- key namespace ('api:<key_id>:<action>') and an explicit p_key_id
-- parameter instead of deriving identity from auth.uid() (there is no
-- Supabase Auth session for an API-key request). This is safe only because
-- p_key_id is never accepted from an untrusted caller directly — it's
-- always the id validate_api_key already resolved server-side, which is
-- why this function is never granted to authenticated/anon either: if it
-- were, any signed-in user could pass an arbitrary key_id and poison a
-- different API key's bucket.
create or replace function check_api_key_rate_limit(
  p_key_id uuid,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_count integer;
begin
  v_key := 'api:' || p_key_id::text || ':' || p_action;

  insert into rate_limit_buckets (key, count, window_start)
  values (v_key, 1, now())
  on conflict (key) do update
    set count = case
          when rate_limit_buckets.window_start < now() - make_interval(secs => p_window_seconds)
            then 1
          else rate_limit_buckets.count + 1
        end,
        window_start = case
          when rate_limit_buckets.window_start < now() - make_interval(secs => p_window_seconds)
            then now()
          else rate_limit_buckets.window_start
        end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function check_api_key_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;

-- API data-access functions. Each takes an already-validated org_id and
-- enforces scoping inline, so a caller can never read/write another org's
-- data no matter what ids they pass — the org_id itself is never
-- caller-supplied in the route handlers that call these (see Task 8+).

create or replace function api_list_test_cases(p_org_id uuid, p_project_id uuid)
returns setof test_cases
language sql
security definer
set search_path = public
stable
as $$
  select tc.*
  from test_cases tc
  join projects p on p.id = tc.project_id
  where p.id = p_project_id and p.org_id = p_org_id;
$$;

create or replace function api_get_test_case(p_org_id uuid, p_test_case_id uuid)
returns setof test_cases
language sql
security definer
set search_path = public
stable
as $$
  select tc.*
  from test_cases tc
  join projects p on p.id = tc.project_id
  where tc.id = p_test_case_id and p.org_id = p_org_id;
$$;

create or replace function api_list_runs(p_org_id uuid, p_project_id uuid)
returns setof test_runs
language sql
security definer
set search_path = public
stable
as $$
  select r.*
  from test_runs r
  join projects p on p.id = r.project_id
  where p.id = p_project_id and p.org_id = p_org_id;
$$;

create or replace function api_get_run(p_org_id uuid, p_run_id uuid)
returns setof test_runs
language sql
security definer
set search_path = public
stable
as $$
  select r.*
  from test_runs r
  join projects p on p.id = r.project_id
  where r.id = p_run_id and p.org_id = p_org_id;
$$;

-- executed_by is left null: this result was recorded by an external system,
-- not a signed-in human, which is exactly what that nullable column already
-- means (see test_run_cases in 0001_init.sql). No schema change needed here
-- or when CI ingestion (the next queued project) reuses this same function.
create or replace function api_create_run_result(
  p_org_id uuid,
  p_run_id uuid,
  p_test_case_id uuid,
  p_status run_case_status,
  p_notes text default null
)
returns setof test_run_cases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_org_id uuid;
  v_test_case_org_id uuid;
begin
  select p.org_id into v_run_org_id
  from test_runs r join projects p on p.id = r.project_id
  where r.id = p_run_id;

  select p.org_id into v_test_case_org_id
  from test_cases tc join projects p on p.id = tc.project_id
  where tc.id = p_test_case_id;

  if v_run_org_id is null or v_run_org_id <> p_org_id then
    raise exception 'Run not found in this organization.';
  end if;

  if v_test_case_org_id is null or v_test_case_org_id <> p_org_id then
    raise exception 'Test case not found in this organization.';
  end if;

  return query
    insert into test_run_cases (run_id, test_case_id, status, notes, executed_at, order_index)
    values (
      p_run_id,
      p_test_case_id,
      p_status,
      p_notes,
      now(),
      coalesce((select max(order_index) + 1 from test_run_cases where run_id = p_run_id), 0)
    )
    returning *;
end;
$$;

revoke all on function api_list_test_cases(uuid, uuid) from public, anon, authenticated;
revoke all on function api_get_test_case(uuid, uuid) from public, anon, authenticated;
revoke all on function api_list_runs(uuid, uuid) from public, anon, authenticated;
revoke all on function api_get_run(uuid, uuid) from public, anon, authenticated;
revoke all on function api_create_run_result(uuid, uuid, uuid, run_case_status, text) from public, anon, authenticated;
