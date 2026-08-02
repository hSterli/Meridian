# Public REST API + Webhook Infrastructure — Design

**Date**: 2026-08-03
**Status**: Approved, pending implementation plan
**Context**: Second of seven sequenced V1/Phase-1 (P0) gaps identified by cross-referencing the original source PRD (`~/Downloads/prd-meridian-qa.md`, §7.7: "Public REST API + webhooks available on all paid tiers"). Chosen second, right after custom fields, because it's explicitly foundational — two other queued V1 gaps depend on it: CI-triggered automated run ingestion (§7.3, needs inbound webhook receiving) and two-way issue tracker sync with Jira/GitHub/GitLab (§7.4, needs both outbound API calls and inbound webhook receiving).

## Problem

Meridian has no API-key/token-based authentication mechanism at all today — only cookie-based Supabase Auth sessions for browser requests. No external system (a CI script, a future Jira integration, a customer's own tooling) can authenticate against Meridian programmatically. This blocks the PRD's own P0 requirement and blocks two other already-queued projects.

## Scope decisions

1. **Covers**: API-key authentication, a versioned REST API (read + one write path), and inbound webhook receiving scaffolding. **Does not cover**: Meridian-initiated outbound webhook delivery to third-party URLs (Zapier-style "notify my own endpoint on events") — not required by either downstream project (CI ingestion is inbound-only; issue sync calls out to Jira/GitHub's own APIs directly, which isn't "a webhook" in the outbound-delivery sense). Explicitly deferred, not built.
2. **Key scope: org-scoped**, not project-scoped. Matches the org-wide shape of the app's existing RBAC (owner/admin/member) — one key covers everything the issuing org can see, rather than needing a new per-project permission concept the app doesn't otherwise have.
3. **Key management: owner/admin only**, matching the existing permission level for other security-sensitive org-wide actions (inviting members, changing roles). Members can see that keys exist but can't create or revoke them.
4. **API surface for v1**: read test cases/runs/run-case results, plus one write endpoint — record a result for a test case within a run. Pure read-only was considered and rejected: CI ingestion (the very next queued project) needs to *post results in*, so proving that write path now — rather than bolting it on as a separate follow-up project later — is the point of building this foundation first.

## Authorization architecture

Three approaches were considered:

1. **Service-role client + manual per-route checks** — rejected. Directly contradicts this app's established rule (stated in its own README) against using a service-role client in application code: it would mean re-implementing org-scoping logic separately in every route handler instead of relying on the single, audited enforcement point RLS already provides.
2. **Impersonate the key-creator's user session** — rejected. Ties a key's effective permissions to one specific user's org membership/role at call time (breaks silently if that user leaves the org or is demoted), and adds real per-request latency to mint a session.
3. **Purpose-built SECURITY DEFINER Postgres functions for the API** — **chosen**. Same pattern already used for `get_org_members` (a SECURITY DEFINER RPC because the underlying table isn't directly queryable): a small, explicit set of API-specific functions take an *already-validated* `org_id` as a parameter and enforce scoping inline in SQL, rather than scattering authorization logic across TypeScript route handlers.

## Schema

### `api_keys`

```sql
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
```

The plaintext key is generated server-side (a random token, e.g. `mk_live_<32 random bytes, base62>`), shown to the user **exactly once** at creation time, and never stored — only `key_hash` (SHA-256) is persisted, matching the pattern of every credential-handling system in this app never trusting or storing what it doesn't have to. `revoked_at` is a soft-delete (nullable timestamp), not a row delete, so revoked keys remain visible in the management UI with a "revoked" state rather than disappearing.

### `webhook_events`

```sql
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
```

`org_id` is nullable because at receipt time, before any source-specific parsing exists (that's future projects' job), Meridian may not yet know which org a payload belongs to. This table is pure scaffolding: storage + signature validation only, no processing logic. RLS is intentionally **not** applied here in the same shape as other tables — this table is never read by end users through the normal app; only future source-specific processing code (running with elevated access, to be designed when those projects are built) will consume it. It gets `enable row level security` with zero policies (the same "RLS on, no policies, only a SECURITY DEFINER path can touch it" pattern already used for `rate_limit_buckets`), not left unprotected.

### Authorization functions

```sql
create or replace function validate_api_key(p_key text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_key_hash text;
begin
  v_key_hash := encode(digest(p_key, 'sha256'), 'hex');

  update api_keys
  set last_used_at = now()
  where key_hash = v_key_hash and revoked_at is null
  returning org_id into v_org_id;

  return v_org_id; -- null if not found or revoked
end;
$$;

revoke all on function validate_api_key(text) from public, anon, authenticated;
```

`validate_api_key` is **not** granted to `authenticated` or `anon` — API routes call it via a server-side client using the Supabase service role specifically for this one function (the only sanctioned service-role usage in this project, narrowly scoped to key validation, not general data access — everything after this point flows through the org-scoped API RPCs below, not raw table access).

Per-resource API RPCs follow one shape, parameterized on the validated `org_id`:

```sql
create or replace function api_list_test_cases(p_org_id uuid, p_project_id uuid)
returns setof test_cases
language sql
security definer
set search_path = public
as $$
  select tc.*
  from test_cases tc
  join projects p on p.id = tc.project_id
  where p.id = p_project_id and p.org_id = p_org_id;
$$;

revoke all on function api_list_test_cases(uuid, uuid) from public, anon, authenticated;
```

The same shape covers `api_get_test_case(p_org_id, p_test_case_id)`, `api_list_runs(p_org_id, p_project_id)`, `api_get_run(p_org_id, p_run_id)`, and the one write path, `api_create_run_result(p_org_id, p_run_id, p_test_case_id, p_status, p_notes)` (which additionally verifies the run and test case both resolve to `p_org_id` before inserting into `test_run_cases`, mirroring the read functions' scoping check). None of these functions are granted to `authenticated`/`anon` either — like `validate_api_key`, they're called only from API routes via the narrowly-scoped service-role path, never reachable from a browser session or PostgREST's public schema exposure.

## Request flow

1. Request hits `src/app/api/v1/[resource]/route.ts` (or equivalent) with `Authorization: Bearer <key>`.
2. Route extracts the token, calls `validate_api_key(token)` via a service-role Supabase client scoped to only this call.
3. Null result → `401 Unauthorized`. Non-null → proceed with the resolved `org_id`.
4. Rate limit check (see below) keyed on the resolved key, not `auth.uid()`.
5. Route calls the relevant `api_*` RPC with `org_id` plus whatever path/query params the endpoint takes, and returns the result as JSON.

## Rate limiting

Extends `check_rate_limit()` rather than replacing it: for API requests, the bucket key becomes `api_key:<key_id>:<action>` instead of `auth.uid():<action>`. Same sliding-window mechanics, same non-negotiable rule already established for this function — the bucket key is always derived server-side from the already-validated key/session, never from anything the caller supplies, so one API key can never be used to exhaust another's bucket.

## Where keys get managed

New page: `/settings/api`. Settings currently has Team (real), Organization/Integrations/Billing (all stubs) — this adds a fifth, real row: list of the org's keys (name, created date, last used, revoked state), a "Create key" flow that shows the plaintext token exactly once in a copyable, dismissable panel, and a revoke action per key. Owner/admin only, matching §"Key management" above; members see the page but without create/revoke controls, consistent with how the existing Team page already shows a read-only view to non-admins.

## Explicitly out of scope for this pass

- Outbound webhook delivery (Meridian notifying third-party URLs on events).
- Per-project (as opposed to org-wide) API keys.
- Any source-specific webhook processing logic (CI result parsing, Jira/GitHub payload handling) — `webhook_events` is storage/validation scaffolding only; specific integrations are separate, later projects.
- API documentation/developer portal (a follow-up concern once the surface itself is proven).
- Key scopes/permissions finer than "whatever the org can see" (e.g. read-only keys vs. read-write keys) — every key in this pass can do everything the API supports, including the write endpoint.

## Open items for the implementation plan

- Exact webhook signature validation scheme for the `/api/v1/webhooks/[source]` scaffold — since no specific source is being integrated yet, the plan needs to decide on a generic HMAC-SHA256 validator shape that specific future sources can parameterize (secret key, header name), rather than hardcoding one provider's exact scheme now.
- Exact API versioning convention (`/api/v1/...` path prefix is assumed here; confirm during planning rather than revisiting scope).
- Token format specifics (prefix string, byte length, encoding) — functionally any sufficiently random, sufficiently long token works; pick one convention during planning and apply it consistently.
