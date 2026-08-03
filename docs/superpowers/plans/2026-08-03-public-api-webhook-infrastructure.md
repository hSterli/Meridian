# Public REST API + Webhook Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Note for this repo**: neither named sub-skill is actually installed here (confirmed during the prior custom-fields plan) — execute via a fresh general-purpose subagent per task instead, with the orchestrator reviewing each task's actual diff before dispatching the next.

**Goal:** Let external systems authenticate against Meridian with an API key and call a versioned REST API to read test cases/runs/results and record a run result, plus receive generic signed inbound webhooks — the foundation the next two queued projects (CI-triggered run ingestion, two-way issue sync) both depend on.

**Architecture:** Org-scoped API keys (hashed, shown once) validated by a SECURITY DEFINER Postgres function that resolves a key to `(key_id, org_id)`. A small set of purpose-built SECURITY DEFINER `api_*` RPCs take that already-validated `org_id` as a parameter and enforce scoping inline in SQL — centralizing authorization the same way `get_org_members` already does, instead of a service-role client with scattered manual checks. Next.js Route Handlers under `src/app/api/v1/` call these RPCs via a new service-role Supabase client (used *only* for this narrow purpose). A generic `webhooks/[source]` receiver validates an HMAC signature and stores the raw payload for later, source-specific processing (not built in this pass).

**Tech Stack:** Next.js 16 Route Handlers, Supabase (Postgres/RLS/SECURITY DEFINER functions), TypeScript, Node's built-in `crypto`. This repo has no automated test runner configured — every task substitutes `npx tsc --noEmit` / `npx eslint <file>` / a final `npm run build` + Supabase advisors check for the write-test/run-test/pass loop, the same substitution used in the prior custom-fields plan (`docs/superpowers/plans/2026-07-26-custom-fields-on-test-cases.md`).

**Known repo quirk to watch for:** every `Write` tool call in this project has a history of appending a stray literal `</content>` line at the end of the file. After every `Write` call below, run `tail -3 <file>` to check for it and strip it with `sed -i '' -e '/^<\/content>$/d' <file>` if present, before moving on.

---

### Task 1: Migration — `api_keys`, `webhook_events`, and all SQL functions

**Files:**
- Create: `supabase/migrations/0016_api_keys_and_webhooks.sql`

- [x] **Step 1: Write the migration**

```sql
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
```

- [x] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`, `name: "api_keys_and_webhooks"`, and the SQL above as `query`.

- [x] **Step 3: Verify the tables and functions exist**

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select relname, relrowsecurity from pg_class where relname in ('api_keys', 'webhook_events');
select proname from pg_proc where proname in (
  'validate_api_key', 'check_api_key_rate_limit', 'api_list_test_cases',
  'api_get_test_case', 'api_list_runs', 'api_get_run', 'api_create_run_result'
);
```

Expected: two rows for the first query, both `relrowsecurity = true`; seven rows for the second query.

- [x] **Step 4: Run the security advisor check**

Use the Supabase MCP `get_advisors` tool with `type: "security"` against `ucnfcsosbdgknmzyuqbw`. Expected: the same known pre-existing items as before (`rate_limit_buckets` RLS-no-policy, SECURITY DEFINER warnings for `check_rate_limit`/`create_organization_with_owner`/`get_org_members`, leaked-password-protection) — plus new, *expected* "signed-in users can execute" warnings only if any of the new functions were accidentally left grantable to `authenticated`. If any of `validate_api_key`, `check_api_key_rate_limit`, `api_list_test_cases`, `api_get_test_case`, `api_list_runs`, `api_get_run`, or `api_create_run_result` show up in that warning category, the `revoke` statements in Step 1 need fixing before continuing — this is a hard stop, not a note-and-continue.

Also expected: a new `rls_enabled_no_policy` INFO item for `webhook_events`, matching the same pattern already accepted for `rate_limit_buckets` (RLS on, no policies, intentional).

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/0016_api_keys_and_webhooks.sql
git commit -m "Add api_keys, webhook_events, and API authorization functions"
```

---

### Task 2: Regenerate and merge TypeScript types

**Files:**
- Modify: `src/lib/types/database.ts`

- [x] **Step 1: Regenerate types from the live schema**

Use the Supabase MCP `generate_typescript_types` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`.

- [x] **Step 2: Add the two new table types**

In the `Tables` block, insert `api_keys` alphabetically (after `Enums`'s sibling `and` before... — concretely, insert immediately before the existing `issues` entry, since `api_keys` sorts first alphabetically among current table keys):

```ts
      api_keys: {
        Row: {
          created_at: string
          created_by: string
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          org_id: string
          revoked_at: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          key_hash: string
          last_used_at?: string | null
          name: string
          org_id: string
          revoked_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          org_id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
```

Insert `webhook_events` alphabetically as well — it sorts after `test_suites` and before nothing else (it's the last table alphabetically among current keys, so add it as the final entry in the `Tables` block, right after `test_suites`):

```ts
      webhook_events: {
        Row: {
          id: string
          org_id: string | null
          payload: Json
          processed_at: string | null
          received_at: string
          signature_valid: boolean
          source: string
        }
        Insert: {
          id?: string
          org_id?: string | null
          payload: Json
          processed_at?: string | null
          received_at?: string
          signature_valid: boolean
          source: string
        }
        Update: {
          id?: string
          org_id?: string | null
          payload?: Json
          processed_at?: string | null
          received_at?: string
          signature_valid?: boolean
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [x] **Step 3: Add the seven new function entries to the `Functions` block**

Add these entries to `Database["public"]["Functions"]`, alongside the existing `check_rate_limit`/`create_organization_with_owner`/`get_org_members` entries (alphabetical placement isn't load-bearing here since this block isn't sorted the same way `Tables` is in the existing file — add them in the order below, after the three existing entries):

```ts
      validate_api_key: {
        Args: { p_key: string }
        Returns: {
          key_id: string
          org_id: string
        }[]
      }
      check_api_key_rate_limit: {
        Args: {
          p_key_id: string
          p_action: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      api_list_test_cases: {
        Args: { p_org_id: string; p_project_id: string }
        Returns: {
          assigned_to: string | null
          automation_script_ref: string | null
          automation_status: Database["public"]["Enums"]["test_case_automation_status"]
          created_at: string
          created_by: string
          custom_fields: Json
          feature_id: string
          id: string
          preconditions: string | null
          priority: Database["public"]["Enums"]["test_case_priority"]
          project_id: string
          reference_link: string | null
          sprint_number: number | null
          status: Database["public"]["Enums"]["test_case_status"]
          steps: Json
          title: string
          updated_at: string
          version: number
        }[]
      }
      api_get_test_case: {
        Args: { p_org_id: string; p_test_case_id: string }
        Returns: {
          assigned_to: string | null
          automation_script_ref: string | null
          automation_status: Database["public"]["Enums"]["test_case_automation_status"]
          created_at: string
          created_by: string
          custom_fields: Json
          feature_id: string
          id: string
          preconditions: string | null
          priority: Database["public"]["Enums"]["test_case_priority"]
          project_id: string
          reference_link: string | null
          sprint_number: number | null
          status: Database["public"]["Enums"]["test_case_status"]
          steps: Json
          title: string
          updated_at: string
          version: number
        }[]
      }
      api_list_runs: {
        Args: { p_org_id: string; p_project_id: string }
        Returns: {
          completed_at: string | null
          created_at: string
          created_by: string
          folder_id: string | null
          id: string
          name: string
          project_id: string
          status: Database["public"]["Enums"]["run_status"]
          suite_id: string | null
        }[]
      }
      api_get_run: {
        Args: { p_org_id: string; p_run_id: string }
        Returns: {
          completed_at: string | null
          created_at: string
          created_by: string
          folder_id: string | null
          id: string
          name: string
          project_id: string
          status: Database["public"]["Enums"]["run_status"]
          suite_id: string | null
        }[]
      }
      api_create_run_result: {
        Args: {
          p_org_id: string
          p_run_id: string
          p_test_case_id: string
          p_status: Database["public"]["Enums"]["run_case_status"]
          p_notes?: string
        }
        Returns: {
          executed_at: string | null
          executed_by: string | null
          id: string
          notes: string | null
          order_index: number
          run_id: string
          status: Database["public"]["Enums"]["run_case_status"]
          test_case_id: string
        }[]
      }
```

**Important**: the actual `generate_typescript_types` output from Step 1 is the source of truth — the blocks above are a careful hand-prediction of what it should produce (matching the exact `Row` shapes of `test_cases`/`test_runs`/`test_run_cases` as they exist after the custom-fields project, and the `Returns: {...}[]`-vs-`Returns: {...}` + `SetofOptions` pattern already visible in this file's existing `get_org_members`/`create_organization_with_owner` entries). Compare the real tool output against what's written here before committing — if the generator emits a `SetofOptions` block for the `setof <table>`-returning functions (`api_list_test_cases`, `api_get_test_case`, `api_list_runs`, `api_get_run`, `api_create_run_result`) the way it already does for `create_organization_with_owner`, include it (e.g. `SetofOptions: { from: "*", to: "test_cases", isOneToOne: false, isSetofReturn: true }`) rather than dropping it, since removing metadata the generator actually produces isn't the point of hand-merging — the point is preserving the hand-written convenience aliases at the bottom of the file that a raw overwrite would destroy.

- [x] **Step 4: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [x] **Step 5: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "Regenerate types for api_keys, webhook_events, and API functions"
```

---

### Task 3: Service-role Supabase client

**Files:**
- Create: `src/lib/supabase/service.ts`

- [ ] **Step 1: Write the client factory**

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * Service-role client for API routes only. Unlike src/lib/supabase/server.ts
 * (cookie-based, used by every Server Component/Action for browser
 * sessions), this has no session and bypasses RLS entirely — it exists
 * solely to call validate_api_key and the api_* RPCs, which each enforce
 * their own org-scoping explicitly. Never use this to query tables
 * directly; if a table needs direct access from an API route, that's a
 * sign a new api_* function is needed, not a reason to reach for this.
 */
export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
```

- [ ] **Step 2: Add the new required env var**

Read the current contents of `.env.local.example`, then append (it currently has just `NEXT_PUBLIC_SUPABASE_URL=` and `NEXT_PUBLIC_SUPABASE_ANON_KEY=`):

```
SUPABASE_SERVICE_ROLE_KEY=
WEBHOOK_SHARED_SECRET=
```

(`WEBHOOK_SHARED_SECRET` is added here even though it's used starting Task 7, so both new env vars land in one place — avoids a second partial edit to this file later.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output. (This won't catch a missing runtime env var — that's a Task 14 concern, covered in the manual testing instructions.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/service.ts .env.local.example
git commit -m "Add service-role Supabase client for API routes"
```

---

### Task 4: API authentication helper

**Files:**
- Create: `src/lib/api/auth.ts`

- [ ] **Step 1: Write the helper**

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export interface ApiAuthContext {
  keyId: string;
  orgId: string;
}

/**
 * Extracts and validates the Authorization: Bearer <key> header on an
 * incoming API request. Returns the resolved (keyId, orgId) on success, or
 * a ready-to-return 401 Response on failure — callers should check
 * `instanceof Response` and return it directly rather than inspecting it.
 */
export async function authenticateApiRequest(
  request: Request
): Promise<ApiAuthContext | Response> {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return Response.json(
      { error: "Missing or invalid Authorization header." },
      { status: 401 }
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("validate_api_key", { p_key: match[1] });

  if (error || !data || data.length === 0) {
    return Response.json({ error: "Invalid or revoked API key." }, { status: 401 });
  }

  return { keyId: data[0].key_id, orgId: data[0].org_id };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/api/auth.ts`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/auth.ts
git commit -m "Add API key authentication helper for API routes"
```

---

### Task 5: Rate-limit helper for API keys

**Files:**
- Modify: `src/lib/rate-limit.ts`

- [ ] **Step 1: Add the new exported function**

Append to the end of `src/lib/rate-limit.ts` (after the existing `rateLimit` function), and add the new import at the top:

Change:
```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
```
to:
```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
```

Then append at the end of the file:

```ts

/**
 * Same idea as rateLimit(), but for API-key-authenticated requests, which
 * have no Supabase Auth session to derive an identity from. keyId must
 * always be the id an already-successful authenticateApiRequest() call
 * resolved — never a caller-supplied value — for the same reason rateLimit()
 * never accepts a caller-supplied key: see check_api_key_rate_limit's
 * comment in supabase/migrations/0016_api_keys_and_webhooks.sql.
 */
export async function rateLimitApiKey(
  keyId: string,
  action: string,
  limit: number,
  windowSeconds: number
): Promise<string | null> {
  const supabase = createServiceClient();
  const { data: allowed, error } = await supabase.rpc("check_api_key_rate_limit", {
    p_key_id: keyId,
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) return null;
  if (!allowed) {
    return "You're doing that too often — please wait a bit and try again.";
  }
  return null;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/rate-limit.ts`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/rate-limit.ts
git commit -m "Add rate limiting for API-key-authenticated requests"
```

---

### Task 6: `GET /api/v1/test-cases` and `GET /api/v1/test-cases/[id]`

**Files:**
- Create: `src/app/api/v1/test-cases/route.ts`
- Create: `src/app/api/v1/test-cases/[id]/route.ts`

- [ ] **Step 1: Write the list endpoint**

```ts
import { authenticateApiRequest } from "@/lib/api/auth";
import { rateLimitApiKey } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof Response) return auth;

  const limitError = await rateLimitApiKey(auth.keyId, "api_list_test_cases", 300, 60);
  if (limitError) return Response.json({ error: limitError }, { status: 429 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return Response.json({ error: "projectId query param is required." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("api_list_test_cases", {
    p_org_id: auth.orgId,
    p_project_id: projectId,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}
```

- [ ] **Step 2: Write the single-resource endpoint**

```ts
import { authenticateApiRequest } from "@/lib/api/auth";
import { rateLimitApiKey } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof Response) return auth;

  const limitError = await rateLimitApiKey(auth.keyId, "api_get_test_case", 300, 60);
  if (limitError) return Response.json({ error: limitError }, { status: 429 });

  const { id } = await context.params;
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("api_get_test_case", {
    p_org_id: auth.orgId,
    p_test_case_id: id,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return Response.json({ error: "Test case not found." }, { status: 404 });
  }
  return Response.json({ data: data[0] });
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/app/api/v1/test-cases/route.ts "src/app/api/v1/test-cases/[id]/route.ts"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/test-cases
git commit -m "Add GET /api/v1/test-cases and GET /api/v1/test-cases/:id"
```

---

### Task 7: `GET /api/v1/runs` and `GET /api/v1/runs/[id]`

**Files:**
- Create: `src/app/api/v1/runs/route.ts`
- Create: `src/app/api/v1/runs/[id]/route.ts`

- [ ] **Step 1: Write the list endpoint**

```ts
import { authenticateApiRequest } from "@/lib/api/auth";
import { rateLimitApiKey } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof Response) return auth;

  const limitError = await rateLimitApiKey(auth.keyId, "api_list_runs", 300, 60);
  if (limitError) return Response.json({ error: limitError }, { status: 429 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return Response.json({ error: "projectId query param is required." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("api_list_runs", {
    p_org_id: auth.orgId,
    p_project_id: projectId,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}
```

- [ ] **Step 2: Write the single-resource endpoint**

```ts
import { authenticateApiRequest } from "@/lib/api/auth";
import { rateLimitApiKey } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof Response) return auth;

  const limitError = await rateLimitApiKey(auth.keyId, "api_get_run", 300, 60);
  if (limitError) return Response.json({ error: limitError }, { status: 429 });

  const { id } = await context.params;
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("api_get_run", {
    p_org_id: auth.orgId,
    p_run_id: id,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return Response.json({ error: "Run not found." }, { status: 404 });
  }
  return Response.json({ data: data[0] });
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/app/api/v1/runs/route.ts "src/app/api/v1/runs/[id]/route.ts"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/runs/route.ts "src/app/api/v1/runs/[id]/route.ts"
git commit -m "Add GET /api/v1/runs and GET /api/v1/runs/:id"
```

---

### Task 8: `POST /api/v1/runs/[id]/results`

**Files:**
- Create: `src/app/api/v1/runs/[id]/results/route.ts`

- [ ] **Step 1: Write the endpoint**

```ts
import { authenticateApiRequest } from "@/lib/api/auth";
import { rateLimitApiKey } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

const VALID_STATUSES = ["pending", "passed", "failed", "blocked", "skipped"] as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof Response) return auth;

  const limitError = await rateLimitApiKey(auth.keyId, "api_create_run_result", 300, 300);
  if (limitError) return Response.json({ error: limitError }, { status: 429 });

  const { id: runId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { testCaseId, status, notes } = (body ?? {}) as {
    testCaseId?: string;
    status?: string;
    notes?: string;
  };

  if (!testCaseId) {
    return Response.json({ error: "testCaseId is required." }, { status: 400 });
  }
  if (!status || !(VALID_STATUSES as readonly string[]).includes(status)) {
    return Response.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("api_create_run_result", {
    p_org_id: auth.orgId,
    p_run_id: runId,
    p_test_case_id: testCaseId,
    p_status: status as (typeof VALID_STATUSES)[number],
    p_notes: notes ?? undefined,
  });

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ data: data?.[0] }, { status: 201 });
}
```

Validating `status` against `VALID_STATUSES` before calling the RPC avoids surfacing a raw Postgres enum-cast error to API consumers, and the RPC's own "Run not found"/"Test case not found" exceptions (raised when the ids don't resolve to `p_org_id`) come back as `error.message` with a 400, not a 500 — they're caller mistakes (wrong id, wrong org's key), not server failures.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/api/v1/runs/[id]/results/route.ts"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/v1/runs/[id]/results/route.ts"
git commit -m "Add POST /api/v1/runs/:id/results"
```

---

### Task 9: Webhook signature validator + generic receiver

**Files:**
- Create: `src/lib/api/webhook-signature.ts`
- Create: `src/app/api/v1/webhooks/[source]/route.ts`

- [ ] **Step 1: Write the signature validator**

```ts
import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Generic HMAC-SHA256 webhook signature check. Source-specific integrations
 * (CI ingestion, Jira/GitHub sync — separate, later projects) will each
 * bring their own secret storage and possibly their own signature scheme;
 * this is the shared-secret placeholder that proves the receive-and-store
 * pipeline end-to-end for this pass. Uses a constant-time comparison so
 * response timing can't be used to guess the correct signature byte by byte.
 */
export function isValidWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;

  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");

  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
```

- [ ] **Step 2: Write the receiver route**

```ts
import { isValidWebhookSignature } from "@/lib/api/webhook-signature";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(
  request: Request,
  context: { params: Promise<{ source: string }> }
) {
  const { source } = await context.params;
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-webhook-signature");
  const secret = process.env.WEBHOOK_SHARED_SECRET ?? "";

  const signatureValid = isValidWebhookSignature(rawBody, signatureHeader, secret);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const supabase = createServiceClient();
  await supabase.from("webhook_events").insert({
    source,
    payload: payload as never,
    signature_valid: signatureValid,
  });

  if (!signatureValid) {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  return Response.json({ status: "received" });
}
```

Every event is stored regardless of signature validity — invalid attempts are auditable in `webhook_events`, not silently dropped — but a bad signature still returns 401 to the caller after being recorded.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/api/webhook-signature.ts "src/app/api/v1/webhooks/[source]/route.ts"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/webhook-signature.ts "src/app/api/v1/webhooks/[source]/route.ts"
git commit -m "Add generic signed inbound webhook receiver"
```

---

### Task 10: Server Actions for API key management

**Files:**
- Create: `src/lib/actions/api-keys.ts`

- [ ] **Step 1: Write the actions**

```ts
"use server";

import { randomBytes, createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";

export interface ApiKeyActionState {
  error?: string;
  plaintextKey?: string;
}

function generateApiKey(): { plaintext: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const plaintext = `mk_live_${raw}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

export async function createApiKey(
  orgId: string,
  _prevState: ApiKeyActionState,
  formData: FormData
): Promise<ApiKeyActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Key name is required." };

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can create API keys." };
  }

  const limitError = await rateLimit("create_api_key", 10, 3600);
  if (limitError) return { error: limitError };

  const { plaintext, hash } = generateApiKey();
  const supabase = await createClient();

  const { error } = await supabase.from("api_keys").insert({
    org_id: orgId,
    name,
    key_hash: hash,
    created_by: ctx.userId,
  });

  if (error) return { error: error.message };

  revalidatePath("/settings/api");
  return { plaintextKey: plaintext };
}

export async function revokeApiKey(orgId: string, keyId: string) {
  const supabase = await createClient();
  await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId);
  revalidatePath("/settings/api");
}
```

Note: this uses the normal cookie-based `createClient()`, not the service-role client — `api_keys`' own RLS policies (`is_org_admin(org_id)`, written in Task 1) are the real enforcement here, the same way every other admin-only action in this app already works. The `ctx.activeRole` check above is a fast, friendly early exit, not the security boundary — consistent with how `members/page.tsx`'s `isAdmin` check works today.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/api-keys.ts`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/api-keys.ts
git commit -m "Add Server Actions for API key creation and revocation"
```

---

### Task 11: Settings → API Keys page

**Files:**
- Create: `src/components/settings/api-key-manager.tsx`
- Create: `src/app/(app)/settings/api/page.tsx`

- [ ] **Step 1: Write the manager component**

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ApiKeyActionState } from "@/lib/actions/api-keys";

export interface ApiKeyRow {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export function ApiKeyManager({
  keys,
  isAdmin,
  createAction,
  revokeAction,
}: {
  keys: ApiKeyRow[];
  isAdmin: boolean;
  createAction: (prevState: ApiKeyActionState, formData: FormData) => Promise<ApiKeyActionState>;
  revokeAction: (keyId: string) => void;
}) {
  const [state, formAction, isPending] = useActionState<ApiKeyActionState, FormData>(
    createAction,
    {}
  );

  return (
    <div className="space-y-6">
      {state.plaintextKey && (
        <Card className="border-primary/30 bg-meridian-soft/40 p-4">
          <p className="text-sm font-semibold text-ink-primary">
            Copy this key now — it won&apos;t be shown again.
          </p>
          <code className="mt-2 block break-all rounded-md bg-white px-3 py-2 text-xs">
            {state.plaintextKey}
          </code>
        </Card>
      )}

      <Card className="divide-y divide-border-light">
        {keys.length === 0 && (
          <p className="p-4 text-sm text-ink-tertiary">No API keys yet.</p>
        )}
        {keys.map((k) => (
          <div key={k.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink-primary">{k.name}</p>
              <p className="text-xs text-ink-tertiary">
                Created {new Date(k.created_at).toLocaleDateString()}
                {k.last_used_at
                  ? ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}`
                  : " · Never used"}
                {k.revoked_at ? " · Revoked" : ""}
              </p>
            </div>
            {isAdmin && !k.revoked_at && (
              <button
                type="button"
                onClick={() => revokeAction(k.id)}
                className="text-xs font-medium text-fail hover:underline"
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </Card>

      {isAdmin && (
        <form action={formAction} className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="name">New key name</Label>
            <Input id="name" name="name" required placeholder="e.g. CI pipeline" />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating…" : "Create key"}
          </Button>
        </form>
      )}
      {state.error && <p className="text-xs text-fail">{state.error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Write the page**

```tsx
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { ApiKeyManager } from "@/components/settings/api-key-manager";
import { createApiKey, revokeApiKey } from "@/lib/actions/api-keys";

export default async function ApiSettingsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const isAdmin = ctx.activeRole === "owner" || ctx.activeRole === "admin";
  const supabase = await createClient();

  const { data: keys } = await supabase
    .from("api_keys")
    .select("id, name, created_at, last_used_at, revoked_at")
    .eq("org_id", ctx.activeOrgId)
    .order("created_at", { ascending: false });

  const createAction = createApiKey.bind(null, ctx.activeOrgId);
  const revokeAction = revokeApiKey.bind(null, ctx.activeOrgId);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PageHeader
        title="API Keys"
        description="Use these to authenticate requests to the Meridian API."
      />
      <ApiKeyManager
        keys={keys ?? []}
        isAdmin={isAdmin}
        createAction={createAction}
        revokeAction={revokeAction}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/settings/api-key-manager.tsx "src/app/(app)/settings/api/page.tsx"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/api-key-manager.tsx "src/app/(app)/settings/api/page.tsx"
git commit -m "Add Settings > API Keys page"
```

---

### Task 12: Link the API Keys page from Settings

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`

- [ ] **Step 1: Add the icon import and a new real row**

Change:
```tsx
import { Users, Building2, Plug, CreditCard, ChevronRight } from "lucide-react";
```
to:
```tsx
import { Users, Key, Building2, Plug, CreditCard, ChevronRight } from "lucide-react";
```

Then, immediately after the existing "Team" `<Link>` block and before the stub-array `<Card>` children, insert a second real row:

```tsx
        <Link
          href="/settings/members"
          className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-paper-surface"
        >
          <div className="rounded-lg bg-meridian-soft p-2 text-primary">
            <Users size={18} />
          </div>
          <div className="flex-1">
            <p className="font-ui-label font-semibold text-ink-primary">Team</p>
            <p className="text-sm text-ink-secondary">Manage members, roles, and invites.</p>
          </div>
          <ChevronRight size={18} className="text-ink-tertiary" />
        </Link>

        <Link
          href="/settings/api"
          className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-paper-surface"
        >
          <div className="rounded-lg bg-meridian-soft p-2 text-primary">
            <Key size={18} />
          </div>
          <div className="flex-1">
            <p className="font-ui-label font-semibold text-ink-primary">API Keys</p>
            <p className="text-sm text-ink-secondary">Create and revoke keys for the public API.</p>
          </div>
          <ChevronRight size={18} className="text-ink-tertiary" />
        </Link>

        {[
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/settings/page.tsx
git commit -m "Link API Keys page from Settings"
```

---

### Task 13: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/build-status.md`

- [ ] **Step 1: Update README**

Read the current migration table in `README.md` and add a row after the last-listed migration (check what that actually is — don't assume a number, the table has drifted from the plan's expectations before):

```
| `0016_api_keys_and_webhooks.sql` | `api_keys` (org-scoped, owner/admin-managed, hashed tokens shown once) and `webhook_events` (generic inbound webhook scaffolding); `validate_api_key`/`check_api_key_rate_limit`/`api_*` SECURITY DEFINER functions centralize API authorization instead of a service-role client with scattered checks |
```

Add a new bullet under "What's implemented," and a new subsection near "Rate limiting" documenting that API requests get their own bucket namespace. Also add to the "Explicitly deferred" list: "Outbound webhook delivery (Meridian-initiated notifications to third-party URLs)" and "Source-specific webhook processing (CI results, Jira/GitHub payloads) — the receiving/signature scaffold exists, specific integrations are separate future projects."

- [ ] **Step 2: Update `docs/build-status.md`**

Add a new subsection under "1. Shipped and working" for the public API (mirroring the style of the existing "Test case management" subsection), and remove/update anything in "Built but not real yet" or "Explicitly deferred" that referenced "no API exists" if such wording is present (check current content rather than assuming).

- [ ] **Step 3: Commit**

```bash
git add README.md docs/build-status.md
git commit -m "Document the public API and webhook infrastructure"
```

---

### Task 14: Full verification pass + manual testing instructions

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 2: Lint the whole repo**

Run: `npx eslint .`
Expected: no output.

- [ ] **Step 3: Production build**

Check for a leftover `next-server` process first: `lsof -i :3000 -sTCP:LISTEN -t`. If a PID is returned, confirm with `ps -p <pid> -o pid,command` that it's a Meridian `next-server`, then kill it.

Then run: `npm run build`
Expected: `✓ Compiled successfully`, with all new routes listed — `/api/v1/test-cases`, `/api/v1/test-cases/[id]`, `/api/v1/runs`, `/api/v1/runs/[id]`, `/api/v1/runs/[id]/results`, `/api/v1/webhooks/[source]`, `/settings/api`.

- [ ] **Step 4: Supabase security advisor check**

Use the Supabase MCP `get_advisors` tool with `type: "security"` against `ucnfcsosbdgknmzyuqbw`. Expected: the same baseline items as Task 1 Step 4 confirmed — nothing new since then.

- [ ] **Step 5: Browser smoke test (unauthenticated routes only)**

Use `preview_start` with `{name: "meridian-dev"}`, navigate to `/settings/api`. Expected: clean redirect to `/login`, no console errors, no server errors in `preview_logs` — this is the limit of what can be verified without logging in (credentials are never entered on the user's behalf). Stop the preview server and kill any leftover `next-server` process afterward.

- [ ] **Step 6: Write out manual API testing instructions for the user**

This project's API can't be fully exercised without a real, signed-in-created API key — something only the user can produce, since it requires logging into the app. Produce (in the final report to the user, not as a file) a concrete sequence like:

```bash
# 1. Log in at http://localhost:3000/login, go to Settings > API Keys,
#    click "Create key", name it anything, and copy the plaintext key
#    shown (starts with mk_live_) — it's only shown once.

export MERIDIAN_API_KEY="mk_live_..."
export PROJECT_ID="<a project id, visible in the URL when viewing that project in the app>"

# 2. List test cases for a project
curl -s http://localhost:3000/api/v1/test-cases?projectId=$PROJECT_ID \
  -H "Authorization: Bearer $MERIDIAN_API_KEY" | jq

# 3. Get a single test case (use an id from step 2's output)
curl -s http://localhost:3000/api/v1/test-cases/<test-case-id> \
  -H "Authorization: Bearer $MERIDIAN_API_KEY" | jq

# 4. List runs for the same project
curl -s http://localhost:3000/api/v1/runs?projectId=$PROJECT_ID \
  -H "Authorization: Bearer $MERIDIAN_API_KEY" | jq

# 5. Record a result on a run (use a run id from step 4, a test case id from step 2)
curl -s -X POST http://localhost:3000/api/v1/runs/<run-id>/results \
  -H "Authorization: Bearer $MERIDIAN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"testCaseId": "<test-case-id>", "status": "passed", "notes": "via API"}' | jq

# 6. Confirm it shows up: re-run step 4, or open the run in the browser.

# 7. Negative test — no key at all should 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v1/test-cases?projectId=$PROJECT_ID
# Expected: 401

# 8. Negative test — revoke the key in Settings > API Keys, then repeat step 2
# Expected: 401 ("Invalid or revoked API key.")

# 9. Webhook scaffold (no real source integrated yet, so this just proves
#    the receive/validate/store pipeline):
export WEBHOOK_SECRET="<value you set for WEBHOOK_SHARED_SECRET in .env.local>"
BODY='{"test": "payload"}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')
curl -s -X POST http://localhost:3000/api/v1/webhooks/test-source \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIG" \
  -d "$BODY"
# Expected: {"status":"received"}
# Then check the row landed: query webhook_events via the Supabase SQL editor
# or MCP execute_sql — select * from webhook_events order by received_at desc limit 1;
```

Also remind the user in that report: `SUPABASE_SERVICE_ROLE_KEY` must be set in their local `.env.local` before any of this works (it's not something this plan can fill in — it's a real secret from Supabase Dashboard → Project Settings → API → `service_role` key), and `WEBHOOK_SHARED_SECRET` can be any string they choose for local testing.

- [ ] **Step 7: Final commit if any verification step required fixes**

If any step above required a code fix, commit it now with a message describing what was fixed. If everything passed clean, there's nothing to commit — the tree should already be clean from Task 13.
