# GitHub Integration + PR/MR Integrated Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Note for this repo**: neither named sub-skill is installed here — execute via a fresh general-purpose subagent per task, with the orchestrator reviewing each task's actual diff before dispatching the next (same approach used for every prior plan this session).

**Goal:** Two-way GitHub issue sync (mirroring the existing Jira integration, but scoped per Meridian project) plus best-effort PR/MR comment feedback riding on the already-shipped CI ingestion endpoint.

**Architecture:** Extend `issue_tracker_connections` with a `github` provider and a nullable `project_id` (Jira stays org-scoped, GitHub is project-scoped), reusing the same Vault-secret + `security definer` function pattern Jira established. `POST /api/v1/runs/ingest` gains an optional `prNumber` that, after a successful ingest, triggers a best-effort find-and-update PR comment via a new `src/lib/github/client.ts`.

**Tech Stack:** Next.js 16 Server Actions/Route Handlers, Supabase (Postgres/Vault/RLS), TypeScript, Tailwind v4, Vitest (for the two genuinely pure/testable pieces: HMAC signature verification and ingest request validation).

**Known repo quirk to watch for:** every `Write` tool call in this project has a history of appending a stray literal `</content>` line at the end of the file. After every `Write` call below, run `tail -3 <file>` to check for it and strip it with `sed -i '' -e '/^<\/content>$/d' <file>` if present, before moving on.

**Test infrastructure note:** unit tests run via `npm test` (Vitest, `src/**/*.test.ts`, project name `unit`). No integration test harness exists yet for external-API-authenticated flows (GitHub API calls, webhook deliveries) — those are verified manually against a real GitHub repo, matching how the Jira integration and CI ingestion were both verified. Everything else uses the same `npx tsc --noEmit` / `npx eslint` substitution every prior plan in this repo has used.

**Supabase project ref for MCP tools:** `ucnfcsosbdgknmzyuqbw` (same live project used by every prior migration this session).

---

### Task 1: Migration — GitHub connection schema

**Files:**
- Create: `supabase/migrations/0022_github_integration.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0022_github_integration.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration to the live project**

Use the Supabase MCP `apply_migration` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`, `name: "github_integration"`, and the SQL above as `query`.

- [ ] **Step 3: Verify the schema changes**

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select column_name, is_nullable, data_type
from information_schema.columns
where table_name = 'issue_tracker_connections'
order by column_name;
```

Expected: includes `project_id` (uuid, nullable), `github_repo_owner`/`github_repo_name`/`github_webhook_secret` (text, nullable), `github_webhook_id` (bigint, nullable), and `webhook_token` now shows `is_nullable = 'YES'`.

```sql
select indexname from pg_indexes where tablename = 'issue_tracker_connections';
```

Expected: includes `issue_tracker_connections_org_provider_idx` and `issue_tracker_connections_project_provider_idx` (new), no more `issue_tracker_connections_org_id_provider_key`.

```sql
select unnest(enum_range(null::issue_tracker_provider))::text as value;
```

Expected: two rows, `jira` and `github`.

- [ ] **Step 4: Run the security advisor check**

Use the Supabase MCP `get_advisors` tool with `type: "security"` against `ucnfcsosbdgknmzyuqbw`. Expected: the same pre-existing, already-reviewed items as before this migration (rate_limit_buckets RLS-no-policy, SECURITY DEFINER warnings, leaked-password-protection) — the three new SECURITY DEFINER functions will show up in the same flagged category the Jira three already do, which is expected and previously accepted.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0022_github_integration.sql
git commit -m "Add GitHub connection schema: project-scoped issue_tracker_connections + create/get/delete functions"
```

---

### Task 2: Migration — PR support in CI ingestion

**Files:**
- Create: `supabase/migrations/0023_pr_feedback_ingestion.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0023_pr_feedback_ingestion.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration to the live project**

Use the Supabase MCP `apply_migration` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`, `name: "pr_feedback_ingestion"`, and the SQL above as `query`.

- [ ] **Step 3: Verify by calling the function directly**

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw` to confirm the new signature works end to end, using the same seeded demo project used to verify every prior `api_*` function this session (org "TEST QA", `project_id = 3c89de27-9337-47ac-9061-95742b7ae10b`, `org_id = 404fdb0b-b740-4e64-b78f-a4d606481adc`). First find a valid API key id for that org:

```sql
select id from api_keys where org_id = '404fdb0b-b740-4e64-b78f-a4d606481adc' limit 1;
```

If no key exists, create one via the app's Settings > API Keys UI first, or skip live verification and note it for Task 13's manual pass. Then, with that key id substituted in:

```sql
select * from api_ingest_run_results(
  '404fdb0b-b740-4e64-b78f-a4d606481adc'::uuid,
  '<api_key_id>'::uuid,
  '3c89de27-9337-47ac-9061-95742b7ae10b'::uuid,
  'Plan verification: PR ingestion',
  '[{"title": "PR ingestion smoke test", "status": "passed"}]'::jsonb,
  42
);
```

Expected: one row, `matched`/`auto_created` reflecting whether a test case titled "PR ingestion smoke test" already existed, and `pr_url` is `null` (no GitHub connection exists for this project yet — that's correct, confirms the function doesn't error when there's no connection to derive a URL from).

```sql
select * from api_get_github_pat_for_project(
  '404fdb0b-b740-4e64-b78f-a4d606481adc'::uuid,
  '3c89de27-9337-47ac-9061-95742b7ae10b'::uuid
);
```

Expected: zero rows (no GitHub connection exists yet) — confirms the "return zero rows, don't error" behavior.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0023_pr_feedback_ingestion.sql
git commit -m "Extend CI ingestion with optional PR association + a service-role GitHub PAT lookup for PR comments"
```

---

### Task 3: Regenerate TypeScript types

**Files:**
- Modify: `src/lib/types/database.ts`

- [ ] **Step 1: Regenerate types from the live schema**

Use the Supabase MCP `generate_typescript_types` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`.

- [ ] **Step 2: Patch the `issue_tracker_connections` type block**

Find the existing block (around lines 63-109) and replace it with:

```ts
      issue_tracker_connections: {
        Row: {
          created_at: string
          created_by: string
          github_repo_name: string | null
          github_repo_owner: string | null
          github_webhook_id: number | null
          github_webhook_secret: string | null
          id: string
          jira_base_url: string
          jira_email: string
          jira_project_key: string
          org_id: string
          project_id: string | null
          provider: Database["public"]["Enums"]["issue_tracker_provider"]
          vault_secret_id: string
          webhook_token: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          github_repo_name?: string | null
          github_repo_owner?: string | null
          github_webhook_id?: number | null
          github_webhook_secret?: string | null
          id?: string
          jira_base_url: string
          jira_email: string
          jira_project_key: string
          org_id: string
          project_id?: string | null
          provider: Database["public"]["Enums"]["issue_tracker_provider"]
          vault_secret_id: string
          webhook_token?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          github_repo_name?: string | null
          github_repo_owner?: string | null
          github_webhook_id?: number | null
          github_webhook_secret?: string | null
          id?: string
          jira_base_url?: string
          jira_email?: string
          jira_project_key?: string
          org_id?: string
          project_id?: string | null
          provider?: Database["public"]["Enums"]["issue_tracker_provider"]
          vault_secret_id?: string
          webhook_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "issue_tracker_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_tracker_connections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 3: Patch the `test_runs` type block**

Find the existing block (around lines 733-790) and replace `Row`/`Insert`/`Update` with:

```ts
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          folder_id: string | null
          id: string
          name: string
          pr_number: number | null
          pr_url: string | null
          project_id: string
          status: Database["public"]["Enums"]["run_status"]
          suite_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          folder_id?: string | null
          id?: string
          name: string
          pr_number?: number | null
          pr_url?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["run_status"]
          suite_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          folder_id?: string | null
          id?: string
          name?: string
          pr_number?: number | null
          pr_url?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["run_status"]
          suite_id?: string | null
        }
```

(Leave the `Relationships` array below it unchanged.)

- [ ] **Step 4: Patch the `Functions` block**

Add `api_get_github_pat_for_project` immediately before `api_get_test_case`:

```ts
      api_get_github_pat_for_project: {
        Args: { p_org_id: string; p_project_id: string }
        Returns: {
          repo_name: string
          repo_owner: string
          token: string
        }[]
      }
```

Replace the existing `api_ingest_run_results` block with:

```ts
      api_ingest_run_results: {
        Args: {
          p_key_id: string
          p_org_id: string
          p_pr_number?: number
          p_project_id: string
          p_results: Json
          p_run_name: string
        }
        Returns: {
          auto_created: number
          matched: number
          pr_url: string | null
          run_id: string
        }[]
      }
```

Add `create_github_connection` immediately before `create_jira_connection`:

```ts
      create_github_connection: {
        Args: {
          p_project_id: string
          p_repo_name: string
          p_repo_owner: string
          p_token: string
          p_webhook_secret: string
        }
        Returns: string
      }
```

Add `delete_github_connection` immediately before `delete_jira_connection`:

```ts
      delete_github_connection: {
        Args: { p_connection_id: string }
        Returns: undefined
      }
```

Add `get_github_pat` immediately before `get_jira_api_token`:

```ts
      get_github_pat: { Args: { p_connection_id: string }; Returns: string }
```

- [ ] **Step 5: Patch the `Enums` block**

Find `issue_tracker_provider: "jira"` (around line 1212) and change to:

```ts
      issue_tracker_provider: "jira" | "github"
```

Find the matching `issue_tracker_provider: ["jira"],` further down (in the `Constants` export near the bottom of the file) and change to:

```ts
      issue_tracker_provider: ["jira", "github"],
```

- [ ] **Step 6: Verify the types compile**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "Regenerate types for GitHub connections, PR ingestion, and the new github_* functions"
```

---

### Task 4: GitHub API client

**Files:**
- Create: `src/lib/github/client.ts`
- Test: `src/lib/github/client.test.ts`

- [ ] **Step 1: Write the failing test for `verifyGithubSignature`**

Create `src/lib/github/client.test.ts`:

```ts
import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifyGithubSignature } from "./client";

function sign(payload: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

describe("verifyGithubSignature", () => {
  it("returns true for a valid signature", () => {
    const payload = JSON.stringify({ action: "closed" });
    const secret = "test-secret";
    expect(verifyGithubSignature(payload, sign(payload, secret), secret)).toBe(true);
  });

  it("returns false for a signature computed with the wrong secret", () => {
    const payload = JSON.stringify({ action: "closed" });
    expect(verifyGithubSignature(payload, sign(payload, "wrong-secret"), "test-secret")).toBe(
      false
    );
  });

  it("returns false when the payload doesn't match the signature", () => {
    const secret = "test-secret";
    const signature = sign(JSON.stringify({ action: "closed" }), secret);
    expect(
      verifyGithubSignature(JSON.stringify({ action: "reopened" }), signature, secret)
    ).toBe(false);
  });

  it("returns false when the signature header is missing", () => {
    expect(verifyGithubSignature("{}", null, "test-secret")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit src/lib/github/client.test.ts`
Expected: FAIL — `src/lib/github/client.ts` doesn't exist yet.

- [ ] **Step 3: Write `src/lib/github/client.ts`**

```ts
import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

export interface GithubConnectionCredentials {
  repoOwner: string;
  repoName: string;
  token: string;
}

const GITHUB_API = "https://api.github.com";

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

export async function verifyGithubRepoAccess(
  connection: GithubConnectionCredentials
): Promise<{ ok: true } | { error: string }> {
  const response = await fetch(`${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}`, {
    headers: githubHeaders(connection.token),
  });

  if (!response.ok) {
    const body = await response.text();
    return { error: `Could not access repo (${response.status}): ${body}` };
  }

  return { ok: true };
}

export async function createGithubIssue(
  connection: GithubConnectionCredentials,
  title: string,
  description: string,
  severity: string
): Promise<{ number: number; id: string } | { error: string }> {
  const response = await fetch(
    `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/issues`,
    {
      method: "POST",
      headers: githubHeaders(connection.token),
      body: JSON.stringify({
        title,
        body: `${description || "(no description)"}\n\n**Severity:** ${severity}`,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitHub issue create failed (${response.status}): ${body}` };
  }

  const data = (await response.json()) as { number: number; id: number };
  return { number: data.number, id: String(data.id) };
}

export async function updateGithubIssueFields(
  connection: GithubConnectionCredentials,
  issueNumber: number,
  title: string,
  description: string,
  severity: string
): Promise<{ error?: string }> {
  const response = await fetch(
    `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/issues/${issueNumber}`,
    {
      method: "PATCH",
      headers: githubHeaders(connection.token),
      body: JSON.stringify({
        title,
        body: `${description || "(no description)"}\n\n**Severity:** ${severity}`,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitHub issue update failed (${response.status}): ${body}` };
  }

  return {};
}

// GitHub issues only have open/closed states — no equivalent of Meridian's
// "in progress". open/in_progress both map to GitHub "open";
// resolved/closed both map to GitHub "closed".
const GITHUB_STATE_FOR_STATUS: Record<string, "open" | "closed"> = {
  open: "open",
  in_progress: "open",
  resolved: "closed",
  closed: "closed",
};

export async function setGithubIssueState(
  connection: GithubConnectionCredentials,
  issueNumber: number,
  meridianStatus: string
): Promise<{ error?: string }> {
  const state = GITHUB_STATE_FOR_STATUS[meridianStatus];
  if (!state) return { error: `No GitHub state mapping for status "${meridianStatus}".` };

  const response = await fetch(
    `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/issues/${issueNumber}`,
    {
      method: "PATCH",
      headers: githubHeaders(connection.token),
      body: JSON.stringify({ state }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitHub issue state update failed (${response.status}): ${body}` };
  }

  return {};
}

export async function createGithubWebhook(
  connection: GithubConnectionCredentials,
  callbackUrl: string,
  secret: string
): Promise<{ hookId: number } | { error: string }> {
  const response = await fetch(
    `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/hooks`,
    {
      method: "POST",
      headers: githubHeaders(connection.token),
      body: JSON.stringify({
        name: "web",
        active: true,
        events: ["issues"],
        config: { url: callbackUrl, content_type: "json", secret },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitHub webhook create failed (${response.status}): ${body}` };
  }

  const data = (await response.json()) as { id: number };
  return { hookId: data.id };
}

export async function deleteGithubWebhook(
  connection: GithubConnectionCredentials,
  hookId: number
): Promise<{ ok: true } | { error: string }> {
  const response = await fetch(
    `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/hooks/${hookId}`,
    { method: "DELETE", headers: githubHeaders(connection.token) }
  );

  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    return { error: `GitHub webhook delete failed (${response.status}): ${body}` };
  }

  return { ok: true };
}

function prCommentMarker(projectId: string): string {
  return `<!-- meridian-run:${projectId} -->`;
}

export interface PrRunSummary {
  projectId: string;
  runName: string;
  runUrl: string;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
}

function prCommentBody(summary: PrRunSummary): string {
  return [
    prCommentMarker(summary.projectId),
    `**Meridian: ${summary.runName}**`,
    "",
    `✅ ${summary.passed} passed · ❌ ${summary.failed} failed · 🚫 ${summary.blocked} blocked · ⏭️ ${summary.skipped} skipped`,
    "",
    `[View full run in Meridian](${summary.runUrl})`,
  ].join("\n");
}

// Finds an existing comment on the PR carrying this project's hidden
// marker and updates it in place; otherwise posts a new one. Keeps a
// re-run of the same CI job against the same PR from spamming a fresh
// comment every time.
export async function postOrUpdatePrComment(
  connection: GithubConnectionCredentials,
  prNumber: number,
  summary: PrRunSummary
): Promise<{ ok: true } | { error: string }> {
  const marker = prCommentMarker(summary.projectId);
  const body = prCommentBody(summary);

  const listResponse = await fetch(
    `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/issues/${prNumber}/comments`,
    { headers: githubHeaders(connection.token) }
  );

  if (!listResponse.ok) {
    const text = await listResponse.text();
    return { error: `Could not list PR comments (${listResponse.status}): ${text}` };
  }

  const comments = (await listResponse.json()) as { id: number; body: string }[];
  const existing = comments.find((c) => c.body.includes(marker));

  const response = existing
    ? await fetch(
        `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/issues/comments/${existing.id}`,
        { method: "PATCH", headers: githubHeaders(connection.token), body: JSON.stringify({ body }) }
      )
    : await fetch(
        `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/issues/${prNumber}/comments`,
        { method: "POST", headers: githubHeaders(connection.token), body: JSON.stringify({ body }) }
      );

  if (!response.ok) {
    const text = await response.text();
    return { error: `Could not post PR comment (${response.status}): ${text}` };
  }

  return { ok: true };
}

// Pure — verifies GitHub's HMAC-SHA256 webhook signature
// (X-Hub-Signature-256 header) against the connection's stored secret.
// Uses a constant-time comparison to avoid leaking timing information.
export function verifyGithubSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);

  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
```

- [ ] **Step 4: Check for the stray `</content>` line**

Run: `tail -3 src/lib/github/client.ts`
If the last line is a literal `</content>`, strip it: `sed -i '' -e '/^<\/content>$/d' src/lib/github/client.ts`

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project unit src/lib/github/client.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/github/client.ts src/lib/github/client.test.ts`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/github/client.ts src/lib/github/client.test.ts
git commit -m "Add GitHub API client: issue sync, webhook management, PR comments, signature verification"
```

---

### Task 5: Ingest request validation (extracted for testability)

**Files:**
- Create: `src/lib/validation/ingest-request.ts`
- Test: `src/lib/validation/ingest-request.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/validation/ingest-request.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateIngestRequestBody } from "./ingest-request";

describe("validateIngestRequestBody", () => {
  const validBody = {
    projectId: "proj-1",
    runName: "CI: main",
    results: [{ title: "test one", status: "passed" }],
  };

  it("accepts a valid body with no prNumber", () => {
    const result = validateIngestRequestBody(validBody);
    expect("data" in result).toBe(true);
  });

  it("accepts a valid body with a positive integer prNumber", () => {
    const result = validateIngestRequestBody({ ...validBody, prNumber: 42 });
    expect("data" in result).toBe(true);
    if ("data" in result) expect(result.data.prNumber).toBe(42);
  });

  it("rejects a non-integer prNumber", () => {
    const result = validateIngestRequestBody({ ...validBody, prNumber: 4.5 });
    expect(result).toEqual({ error: "prNumber must be a positive integer." });
  });

  it("rejects a zero or negative prNumber", () => {
    const result = validateIngestRequestBody({ ...validBody, prNumber: 0 });
    expect(result).toEqual({ error: "prNumber must be a positive integer." });
  });

  it("rejects a missing projectId", () => {
    const { projectId: _projectId, ...rest } = validBody;
    expect(validateIngestRequestBody(rest)).toEqual({ error: "projectId is required." });
  });

  it("rejects an empty results array", () => {
    expect(validateIngestRequestBody({ ...validBody, results: [] })).toEqual({
      error: "results must be a non-empty array.",
    });
  });

  it("rejects a result with an invalid status", () => {
    const result = validateIngestRequestBody({
      ...validBody,
      results: [{ title: "x", status: "unknown" }],
    });
    expect("error" in result).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit src/lib/validation/ingest-request.test.ts`
Expected: FAIL — `src/lib/validation/ingest-request.ts` doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/validation/ingest-request.ts`:

```ts
export const VALID_RESULT_STATUSES = ["passed", "failed", "blocked", "skipped"] as const;

export interface IngestResultInput {
  title?: string;
  status?: string;
  notes?: string;
}

export interface ValidatedIngestRequest {
  projectId: string;
  runName: string;
  results: IngestResultInput[];
  prNumber?: number;
}

export function validateIngestRequestBody(
  body: unknown
): { data: ValidatedIngestRequest } | { error: string } {
  const { projectId, runName, results, prNumber } = (body ?? {}) as {
    projectId?: string;
    runName?: string;
    results?: IngestResultInput[];
    prNumber?: unknown;
  };

  if (!projectId) return { error: "projectId is required." };
  if (!runName) return { error: "runName is required." };
  if (!Array.isArray(results) || results.length === 0) {
    return { error: "results must be a non-empty array." };
  }

  for (const r of results) {
    if (!r.title) return { error: "Each result requires a title." };
    if (!r.status || !(VALID_RESULT_STATUSES as readonly string[]).includes(r.status)) {
      return {
        error: `Each result's status must be one of: ${VALID_RESULT_STATUSES.join(", ")}`,
      };
    }
  }

  if (prNumber !== undefined) {
    if (typeof prNumber !== "number" || !Number.isInteger(prNumber) || prNumber <= 0) {
      return { error: "prNumber must be a positive integer." };
    }
  }

  return {
    data: {
      projectId,
      runName,
      results,
      prNumber: typeof prNumber === "number" ? prNumber : undefined,
    },
  };
}
```

- [ ] **Step 4: Check for the stray `</content>` line**

Run: `tail -3 src/lib/validation/ingest-request.ts`
Strip with `sed -i '' -e '/^<\/content>$/d' src/lib/validation/ingest-request.ts` if present.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project unit src/lib/validation/ingest-request.test.ts`
Expected: 7 passed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validation/ingest-request.ts src/lib/validation/ingest-request.test.ts
git commit -m "Extract ingest request validation as a pure, unit-tested module"
```

---

### Task 6: Wire PR feedback into the ingest route

**Files:**
- Modify: `src/app/api/v1/runs/ingest/route.ts`

- [ ] **Step 1: Replace the route's full contents**

Replace all of `src/app/api/v1/runs/ingest/route.ts` with:

```ts
import { authenticateApiRequest } from "@/lib/api/auth";
import { rateLimitApiKey } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/types/database";
import { validateIngestRequestBody, type IngestResultInput } from "@/lib/validation/ingest-request";
import { postOrUpdatePrComment } from "@/lib/github/client";

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof Response) return auth;

  const limitError = await rateLimitApiKey(auth.keyId, "api_ingest_run_results", 20, 3600);
  if (limitError) return Response.json({ error: limitError }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validation = validateIngestRequestBody(body);
  if ("error" in validation) {
    return Response.json({ error: validation.error }, { status: 400 });
  }
  const { projectId, runName, results, prNumber } = validation.data;

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("api_ingest_run_results", {
    p_org_id: auth.orgId,
    p_key_id: auth.keyId,
    p_project_id: projectId,
    p_run_name: runName,
    p_results: results as unknown as Json,
    p_pr_number: prNumber ?? null,
  });

  if (error) return Response.json({ error: error.message }, { status: 400 });
  const row = data?.[0];

  let prCommentPosted = false;
  if (row?.pr_url && prNumber && row.run_id) {
    prCommentPosted = await tryPostPrComment({
      orgId: auth.orgId,
      projectId,
      prNumber,
      runId: row.run_id,
      runName,
      results,
    });
  }

  return Response.json(
    {
      data: {
        runId: row?.run_id,
        matched: row?.matched,
        autoCreated: row?.auto_created,
        prCommentPosted,
      },
    },
    { status: 201 }
  );
}

// Best-effort: any failure here (bad/revoked PAT, renamed repo, GitHub
// outage) is caught and never fails the ingest response — the run was
// already recorded successfully by the time this runs.
async function tryPostPrComment(args: {
  orgId: string;
  projectId: string;
  prNumber: number;
  runId: string;
  runName: string;
  results: IngestResultInput[];
}): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase.rpc("api_get_github_pat_for_project", {
      p_org_id: args.orgId,
      p_project_id: args.projectId,
    });
    const row = data?.[0];
    if (!row?.token || !row.repo_owner || !row.repo_name) return false;

    const counts = { passed: 0, failed: 0, blocked: 0, skipped: 0 };
    for (const r of args.results) {
      if (r.status && r.status in counts) {
        counts[r.status as keyof typeof counts] += 1;
      }
    }

    const runUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/projects/${args.projectId}/runs/${args.runId}`;

    const result = await postOrUpdatePrComment(
      { repoOwner: row.repo_owner, repoName: row.repo_name, token: row.token },
      args.prNumber,
      {
        projectId: args.projectId,
        runName: args.runName,
        runUrl,
        passed: counts.passed,
        failed: counts.failed,
        blocked: counts.blocked,
        skipped: counts.skipped,
      }
    );

    return "ok" in result;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Type-check, lint, and re-run existing tests**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/app/api/v1/runs/ingest/route.ts`
Expected: no output.

Run: `npm test`
Expected: all existing unit tests still pass (this task adds no new pure logic beyond what Task 5 already tests).

- [ ] **Step 3: Verify the route still builds**

Run: `npm run build`
Expected: production build succeeds, `/api/v1/runs/ingest` still appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/runs/ingest/route.ts
git commit -m "Wire optional PR association + best-effort PR comment posting into the ingest route"
```

---

### Task 7: GitHub Server Actions

**Files:**
- Modify: `src/lib/actions/issue-tracker.ts`

- [ ] **Step 1: Add the GitHub imports**

At the top of `src/lib/actions/issue-tracker.ts`, change:

```ts
import { createJiraIssue } from "@/lib/jira/client";
```

to:

```ts
import { createJiraIssue } from "@/lib/jira/client";
import {
  createGithubIssue,
  createGithubWebhook,
  deleteGithubWebhook,
  verifyGithubRepoAccess,
} from "@/lib/github/client";
```

- [ ] **Step 2: Add the GitHub actions**

Append to the end of `src/lib/actions/issue-tracker.ts`:

```ts

export interface GithubConnectionActionState extends ActionState {
  webhookWarning?: string;
}

export async function connectGithubTracker(
  _prevState: GithubConnectionActionState,
  formData: FormData
): Promise<GithubConnectionActionState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const repoOwner = String(formData.get("repoOwner") ?? "").trim();
  const repoName = String(formData.get("repoName") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();

  if (!projectId || !repoOwner || !repoName || !token) {
    return { error: "All fields are required." };
  }

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can connect an issue tracker." };
  }

  const limitError = await rateLimit("connect_issue_tracker", 10, 3600);
  if (limitError) return { error: limitError };

  const access = await verifyGithubRepoAccess({ repoOwner, repoName, token });
  if ("error" in access) return { error: access.error };

  const webhookSecret = randomBytes(24).toString("base64url");
  const supabase = await createClient();

  const { data: connectionId, error } = await supabase.rpc("create_github_connection", {
    p_project_id: projectId,
    p_repo_owner: repoOwner,
    p_repo_name: repoName,
    p_token: token,
    p_webhook_secret: webhookSecret,
  });

  if (error || !connectionId) return { error: error?.message ?? "Could not save connection." };

  revalidatePath("/settings/integrations/github");

  const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/v1/webhooks/github`;
  const webhook = await createGithubWebhook({ repoOwner, repoName, token }, callbackUrl, webhookSecret);

  if ("error" in webhook) {
    return {
      webhookWarning:
        "Issue sync is connected, but automatic status updates from GitHub aren't set up yet — disconnect and reconnect to retry.",
    };
  }

  await supabase
    .from("issue_tracker_connections")
    .update({ github_webhook_id: webhook.hookId })
    .eq("id", connectionId);

  return {};
}

export async function disconnectGithubTracker(
  connectionId: string,
  repoOwner: string,
  repoName: string,
  webhookId: number | null
) {
  const supabase = await createClient();

  if (webhookId) {
    const { data: token } = await supabase.rpc("get_github_pat", { p_connection_id: connectionId });
    if (token) {
      await deleteGithubWebhook({ repoOwner, repoName, token }, webhookId);
    }
  }

  await supabase.rpc("delete_github_connection", { p_connection_id: connectionId });
  revalidatePath("/settings/integrations/github");
}

export async function sendIssueToGithub(
  projectId: string,
  issueId: string,
  connectionId: string,
  _prevState: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("send_issue_to_github", 30, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const { data: connection } = await supabase
    .from("issue_tracker_connections")
    .select("github_repo_owner, github_repo_name")
    .eq("id", connectionId)
    .single();
  if (!connection) return { error: "Connection not found." };
  if (!connection.github_repo_owner || !connection.github_repo_name) {
    return { error: "This connection is missing repo information." };
  }

  const { data: token } = await supabase.rpc("get_github_pat", { p_connection_id: connectionId });
  if (!token) return { error: "Could not retrieve GitHub credentials." };

  const { data: issue } = await supabase
    .from("issues")
    .select("title, description, severity")
    .eq("id", issueId)
    .single();
  if (!issue) return { error: "Issue not found." };

  const result = await createGithubIssue(
    { repoOwner: connection.github_repo_owner, repoName: connection.github_repo_name, token },
    issue.title,
    issue.description ?? "",
    issue.severity
  );

  if ("error" in result) return { error: result.error };

  const { error: linkError } = await supabase.from("issue_tracker_links").insert({
    issue_id: issueId,
    connection_id: connectionId,
    external_issue_key: String(result.number),
    external_issue_id: result.id,
    external_updated_at: new Date().toISOString(),
  });

  if (linkError) return { error: linkError.message };

  revalidatePath(`/projects/${projectId}/issues/${issueId}`);
  return {};
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/issue-tracker.ts`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/issue-tracker.ts
git commit -m "Add connectGithubTracker/disconnectGithubTracker/sendIssueToGithub Server Actions"
```

---

### Task 8: Branch outbound issue-status push on provider

**Files:**
- Modify: `src/lib/actions/issues.ts:8` (import) and `:51-105` (`updateIssueStatus`)

- [ ] **Step 1: Update the import**

Change:

```ts
import { transitionJiraIssueStatus } from "@/lib/jira/client";
```

to:

```ts
import { transitionJiraIssueStatus } from "@/lib/jira/client";
import { setGithubIssueState } from "@/lib/github/client";
```

- [ ] **Step 2: Replace `updateIssueStatus`**

Replace the whole function (currently lines 51-105) with:

```ts
export async function updateIssueStatus(projectId: string, issueId: string, status: IssueStatus) {
  const supabase = await createClient();
  await supabase
    .from("issues")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", issueId);

  // If this issue is linked to an external tracker, push the status
  // change there too. Meridian's own save above already succeeded
  // regardless of what happens next — a tracker-side failure is recorded,
  // not allowed to fail the Meridian update.
  const { data: link } = await supabase
    .from("issue_tracker_links")
    .select(
      "id, external_issue_key, connection_id, issue_tracker_connections(provider, jira_base_url, jira_email, jira_project_key, github_repo_owner, github_repo_name)"
    )
    .eq("issue_id", issueId)
    .maybeSingle();

  if (link) {
    const connection = Array.isArray(link.issue_tracker_connections)
      ? link.issue_tracker_connections[0]
      : link.issue_tracker_connections;

    if (connection) {
      let result: { error?: string } | undefined;

      if (connection.provider === "jira") {
        const { data: apiToken } = await supabase.rpc("get_jira_api_token", {
          p_connection_id: link.connection_id,
        });

        if (apiToken) {
          result = await transitionJiraIssueStatus(
            {
              baseUrl: connection.jira_base_url,
              email: connection.jira_email,
              apiToken,
              projectKey: connection.jira_project_key,
            },
            link.external_issue_key,
            status
          );
        }
      } else if (connection.provider === "github") {
        const { data: token } = await supabase.rpc("get_github_pat", {
          p_connection_id: link.connection_id,
        });

        if (token && connection.github_repo_owner && connection.github_repo_name) {
          result = await setGithubIssueState(
            {
              repoOwner: connection.github_repo_owner,
              repoName: connection.github_repo_name,
              token,
            },
            Number(link.external_issue_key),
            status
          );
        }
      }

      if (result) {
        await supabase
          .from("issue_tracker_links")
          .update({
            last_sync_error: result.error ?? null,
            external_updated_at: new Date().toISOString(),
          })
          .eq("id", link.id);
      }
    }
  }

  revalidatePath(`/projects/${projectId}/issues/${issueId}`);
  revalidatePath(`/projects/${projectId}/issues`);
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/issues.ts`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/issues.ts
git commit -m "Branch outbound issue-status push on connection provider (Jira or GitHub)"
```

---

### Task 9: Integrations index page

**Files:**
- Create: `src/app/(app)/settings/integrations/page.tsx`
- Modify: `src/app/(app)/settings/page.tsx:45-57`

- [ ] **Step 1: Write the index page**

Create `src/app/(app)/settings/integrations/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getUserContext } from "@/lib/org-context";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";

const PROVIDERS = [
  { segment: "jira", label: "Jira", description: "Two-way sync between Meridian issues and Jira." },
  {
    segment: "github",
    label: "GitHub",
    description: "Two-way issue sync and PR/MR test-result feedback, per project.",
  },
];

export default async function IntegrationsIndexPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PageHeader title="Integrations" description="Connect external issue trackers and CI tools." />
      <Card className="divide-y divide-border-light">
        {PROVIDERS.map((provider) => (
          <Link
            key={provider.segment}
            href={`/settings/integrations/${provider.segment}`}
            className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-paper-surface"
          >
            <div className="flex-1">
              <p className="font-ui-label font-semibold text-ink-primary">{provider.label}</p>
              <p className="text-sm text-ink-secondary">{provider.description}</p>
            </div>
            <ChevronRight size={18} className="text-ink-tertiary" />
          </Link>
        ))}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 "src/app/(app)/settings/integrations/page.tsx"`
Strip with `sed -i '' -e '/^<\/content>$/d' "src/app/(app)/settings/integrations/page.tsx"` if present.

- [ ] **Step 3: Point the main Settings page at the index instead of Jira directly**

In `src/app/(app)/settings/page.tsx`, change:

```tsx
        <Link
          href="/settings/integrations/jira"
          className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-paper-surface"
        >
```

to:

```tsx
        <Link
          href="/settings/integrations"
          className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-paper-surface"
        >
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/(app)/settings/integrations/page.tsx" "src/app/(app)/settings/page.tsx"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/settings/integrations/page.tsx" "src/app/(app)/settings/page.tsx"
git commit -m "Add an integrations index page; point Settings at it instead of Jira directly"
```

---

### Task 10: GitHub connection manager UI

**Files:**
- Create: `src/components/settings/github-connection-manager.tsx`
- Create: `src/app/(app)/settings/integrations/github/page.tsx`

- [ ] **Step 1: Write the connection manager component**

Create `src/components/settings/github-connection-manager.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { GithubConnectionActionState } from "@/lib/actions/issue-tracker";

export interface GithubConnectionRow {
  id: string;
  project_id: string | null;
  github_repo_owner: string | null;
  github_repo_name: string | null;
  github_webhook_id: number | null;
  projects: { name: string } | { name: string }[] | null;
}

export interface GithubProjectOption {
  id: string;
  name: string;
}

export function GithubConnectionManager({
  connections,
  projects,
  isAdmin,
  connectAction,
  disconnectAction,
}: {
  connections: GithubConnectionRow[];
  projects: GithubProjectOption[];
  isAdmin: boolean;
  connectAction: (
    prevState: GithubConnectionActionState,
    formData: FormData
  ) => Promise<GithubConnectionActionState>;
  disconnectAction: (
    connectionId: string,
    repoOwner: string,
    repoName: string,
    webhookId: number | null
  ) => void;
}) {
  const [state, formAction, isPending] = useActionState<GithubConnectionActionState, FormData>(
    connectAction,
    {}
  );

  const connectedProjectIds = new Set(connections.map((c) => c.project_id));
  const availableProjects = projects.filter((p) => !connectedProjectIds.has(p.id));

  return (
    <div className="space-y-4">
      {connections.length > 0 && (
        <Card className="divide-y divide-border-light">
          {connections.map((connection) => {
            const projectName = Array.isArray(connection.projects)
              ? connection.projects[0]?.name
              : connection.projects?.name;
            return (
              <div key={connection.id} className="p-4">
                <p className="text-sm font-medium text-ink-primary">
                  {projectName ?? "Unknown project"} → {connection.github_repo_owner}/
                  {connection.github_repo_name}
                </p>
                {!connection.github_webhook_id && (
                  <p className="mt-1 text-xs text-fail">
                    Automatic status updates from GitHub aren&apos;t set up — disconnect and
                    reconnect to retry.
                  </p>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() =>
                      disconnectAction(
                        connection.id,
                        connection.github_repo_owner ?? "",
                        connection.github_repo_name ?? "",
                        connection.github_webhook_id
                      )
                    }
                    className="mt-2 text-xs font-medium text-fail hover:underline"
                  >
                    Disconnect
                  </button>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {!isAdmin && connections.length === 0 && (
        <Card className="p-4 text-sm text-ink-tertiary">No GitHub connections configured.</Card>
      )}

      {isAdmin && availableProjects.length > 0 && (
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold text-ink-primary">Connect a project</p>
          <form action={formAction} className="space-y-3">
            <div>
              <Label htmlFor="projectId">Project</Label>
              <Select id="projectId" name="projectId" required defaultValue="">
                <option value="" disabled>
                  Select a project
                </option>
                {availableProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="repoOwner">Repo owner</Label>
              <Input id="repoOwner" name="repoOwner" required placeholder="your-org" />
            </div>
            <div>
              <Label htmlFor="repoName">Repo name</Label>
              <Input id="repoName" name="repoName" required placeholder="your-repo" />
            </div>
            <div>
              <Label htmlFor="token">Personal access token</Label>
              <Input id="token" name="token" type="password" required />
            </div>
            {state.error && <p className="text-xs text-fail">{state.error}</p>}
            {state.webhookWarning && <p className="text-xs text-fail">{state.webhookWarning}</p>}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Connecting…" : "Connect GitHub"}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 src/components/settings/github-connection-manager.tsx`
Strip if present.

- [ ] **Step 3: Write the page**

Create `src/app/(app)/settings/integrations/github/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { GithubConnectionManager } from "@/components/settings/github-connection-manager";
import { connectGithubTracker, disconnectGithubTracker } from "@/lib/actions/issue-tracker";

export default async function GithubIntegrationPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const isAdmin = ctx.activeRole === "owner" || ctx.activeRole === "admin";
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("org_id", ctx.activeOrgId)
    .order("name");

  const { data: connections } = await supabase
    .from("issue_tracker_connections")
    .select("id, project_id, github_repo_owner, github_repo_name, github_webhook_id, projects(name)")
    .eq("org_id", ctx.activeOrgId)
    .eq("provider", "github");

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PageHeader title="GitHub" description="Two-way issue sync and PR/MR feedback, per project." />
      <GithubConnectionManager
        connections={connections ?? []}
        projects={projects ?? []}
        isAdmin={isAdmin}
        connectAction={connectGithubTracker}
        disconnectAction={disconnectGithubTracker}
      />
    </div>
  );
}
```

- [ ] **Step 4: Check for the stray `</content>` line**

Run: `tail -3 "src/app/(app)/settings/integrations/github/page.tsx"`
Strip if present.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/settings/github-connection-manager.tsx "src/app/(app)/settings/integrations/github/page.tsx"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/github-connection-manager.tsx "src/app/(app)/settings/integrations/github/page.tsx"
git commit -m "Add GitHub connection manager UI (project picker, multi-row connection list)"
```

---

### Task 11: Inbound GitHub webhook route

**Files:**
- Create: `src/app/api/v1/webhooks/github/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/v1/webhooks/github/route.ts`:

```ts
import { createServiceClient } from "@/lib/supabase/service";
import { verifyGithubSignature } from "@/lib/github/client";
import type { IssueStatus } from "@/lib/types/database";

const STATUS_FROM_GITHUB_ACTION: Record<string, IssueStatus> = {
  closed: "resolved",
  reopened: "open",
};

interface GithubIssuesWebhookPayload {
  action?: string;
  issue?: { id: number; number: number };
  repository?: { name: string; owner: { login: string } };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const githubPayload = payload as GithubIssuesWebhookPayload;
  const repoOwner = githubPayload.repository?.owner?.login;
  const repoName = githubPayload.repository?.name;

  const supabase = createServiceClient();

  const { data: connection } =
    repoOwner && repoName
      ? await supabase
          .from("issue_tracker_connections")
          .select("id, org_id, github_webhook_secret")
          .eq("provider", "github")
          .eq("github_repo_owner", repoOwner)
          .eq("github_repo_name", repoName)
          .maybeSingle()
      : { data: null };

  const signatureValid = Boolean(
    connection?.github_webhook_secret &&
      verifyGithubSignature(rawBody, signature, connection.github_webhook_secret)
  );

  // Stored regardless of validity, same audit-trail principle as the
  // generic webhook scaffold and the Jira webhook route.
  await supabase.from("webhook_events").insert({
    source: "github",
    org_id: connection?.org_id ?? null,
    payload: payload as never,
    signature_valid: signatureValid,
  });

  if (!connection || !signatureValid) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  const externalIssueId = githubPayload.issue?.id;
  if (!externalIssueId) {
    return Response.json({ status: "ignored" });
  }

  const { data: link } = await supabase
    .from("issue_tracker_links")
    .select("id, issue_id")
    .eq("external_issue_id", String(externalIssueId))
    .eq("connection_id", connection.id)
    .maybeSingle();

  if (!link) {
    return Response.json({ status: "ignored" });
  }

  const mappedStatus = githubPayload.action
    ? STATUS_FROM_GITHUB_ACTION[githubPayload.action]
    : undefined;

  if (mappedStatus) {
    await supabase
      .from("issues")
      .update({ status: mappedStatus, updated_at: new Date().toISOString() })
      .eq("id", link.issue_id);
  }

  await supabase
    .from("issue_tracker_links")
    .update({ external_updated_at: new Date().toISOString() })
    .eq("id", link.id);

  return Response.json({ status: "received" });
}
```

- [ ] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 src/app/api/v1/webhooks/github/route.ts`
Strip if present.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/app/api/v1/webhooks/github/route.ts`
Expected: no output.

- [ ] **Step 4: Verify it builds and appears in the route list**

Run: `npm run build`
Expected: `ƒ /api/v1/webhooks/github` appears in the route list.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/webhooks/github/route.ts
git commit -m "Add inbound GitHub webhook route with HMAC signature verification"
```

---

### Task 12: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a GitHub bullet to "What's implemented"**

In `README.md`, immediately after the existing Jira bullet (currently: `- **Two-way Jira issue sync**: ...`), add:

```markdown
- **Two-way GitHub issue sync + PR/MR feedback**: one GitHub connection per project (Settings > Integrations > GitHub, admin-managed, PAT stored in Supabase Vault), scoped per project rather than per org since a PR's repo is tied to a specific codebase; the webhook is auto-created via GitHub's API on connect. Send a Meridian issue to GitHub and it creates a linked GitHub issue, status changes on the Meridian side push an open/closed update to GitHub, and GitHub-side close/reopen events flow back in via a per-repo inbound webhook (`/api/v1/webhooks/github`). CI-triggered runs can additionally include a PR number (see "CI Integration" below) to get a pass/fail summary posted as a PR comment.
```

- [ ] **Step 2: Document the `prNumber` field in the CI Integration section**

In the "CI Integration" section's request body example, change:

```json
{
  "projectId": "your-meridian-project-id",
  "runName": "CI: main @ ${CI_COMMIT_SHORT_SHA}",
  "results": [
    { "title": "test name matching a Meridian test case", "status": "passed" },
    { "title": "another test", "status": "failed", "notes": "why it failed" }
  ]
}
```

to:

```json
{
  "projectId": "your-meridian-project-id",
  "runName": "CI: main @ ${CI_COMMIT_SHORT_SHA}",
  "prNumber": 42,
  "results": [
    { "title": "test name matching a Meridian test case", "status": "passed" },
    { "title": "another test", "status": "failed", "notes": "why it failed" }
  ]
}
```

Immediately below that code block, add:

```markdown
`prNumber` is optional. If the project has a connected GitHub repo (Settings > Integrations > GitHub), Meridian posts (or updates, on a re-run) a comment on that pull request summarizing the pass/fail/blocked/skipped counts with a link back to the run. This never fails the ingest itself — a GitHub-side failure (bad token, renamed repo) is silently skipped, reflected only in the response's `prCommentPosted` field.
```

And change the response example from:

```json
{ "data": { "runId": "uuid", "matched": 8, "autoCreated": 2 } }
```

to:

```json
{ "data": { "runId": "uuid", "matched": 8, "autoCreated": 2, "prCommentPosted": true } }
```

- [ ] **Step 3: Update the "Explicitly deferred" list**

Change:

```markdown
- GitHub/GitLab two-way issue sync (Jira now works — see "What's implemented" above)
```

to:

```markdown
- GitLab two-way issue sync, and GitLab MR feedback (Jira and GitHub now work — see "What's implemented" above)
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document GitHub integration and PR/MR feedback (prNumber field, response shape)"
```

---

### Task 13: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated verification suite**

```bash
npx tsc --noEmit
```
Expected: no output.

```bash
git ls-files '*.ts' '*.tsx' | xargs npx eslint
```
Expected: no new errors/warnings beyond the one pre-existing accepted warning in `src/lib/actions/issue-tracker.ts` (from before this plan — `_prevState`/`_formData` unused-vars in an unrelated function).

```bash
npm test
```
Expected: all unit tests pass, including the new `src/lib/github/client.test.ts` (4 tests) and `src/lib/validation/ingest-request.test.ts` (7 tests).

```bash
npm run build
```
Expected: production build succeeds; `/api/v1/webhooks/github` and `/settings/integrations` and `/settings/integrations/github` all appear in the route list.

```bash
git status --short
```
Expected: clean.

- [ ] **Step 2: Manual verification against a real GitHub repo**

This step needs a real GitHub personal access token and a disposable/test repo — neither is available to an automated agent by default. If you have both:
1. Go to Settings > Integrations > GitHub, connect a test project to the test repo with a fine-grained PAT (repo scope).
2. Confirm the connection appears with no webhook warning (i.e. `github_webhook_id` got set) — check the repo's own Settings > Webhooks page on github.com to confirm Meridian's webhook is listed.
3. Create an issue in that Meridian project, use "Send to GitHub" (wherever the issue detail page surfaces `sendIssueToGithub` — check `src/app/(app)/projects/[projectId]/issues/[issueId]/page.tsx` for how the equivalent Jira action is wired in, and mirror it if a GitHub button isn't already there from this plan's tasks). Confirm the issue appears on GitHub.
4. Change the Meridian issue's status to "resolved". Confirm the GitHub issue closes.
5. Close the GitHub issue manually (or reopen it) from github.com. Confirm the webhook delivers and the Meridian issue's status updates within a few seconds.
6. Call `POST /api/v1/runs/ingest` with a `prNumber` pointing at a real open PR in the test repo. Confirm a comment appears on the PR. Call it again with the same `prNumber` and different results — confirm the same comment updates in place rather than a second comment appearing.

If you don't have a test GitHub repo/token available, **stop and tell the user this step was skipped** rather than marking it done — do not claim this was verified when it wasn't.

- [ ] **Step 3: Confirm the design spec is fully addressed**

Re-read `docs/superpowers/specs/2026-08-10-github-integration-pr-feedback-design.md`'s 10 scope decisions and confirm each is reflected in what was built:
1. GitHub only (Task 4-11 — no GitLab/Azure code anywhere).
2. GitHub integration = issue sync, PR feedback is separate (Task 7's `sendIssueToGithub`/Task 8's outbound push vs. Task 6's ingest-route PR comment — two distinct code paths).
3. Project-scoped, not org-scoped (Task 1's `project_id` column + partial unique indexes).
4. PAT auth, Vault-stored (Task 1's `create_github_connection`/`get_github_pat`).
5. Auto-created webhook (Task 7's `connectGithubTracker` calling `createGithubWebhook`).
6. PR comments, not status checks (Task 4's `postOrUpdatePrComment` — no Checks API calls anywhere).
7. Rides on the existing ingest endpoint (Task 6 — no new endpoint).
8. Best-effort, never fails ingest (Task 6's `tryPostPrComment` try/catch returning boolean).
9. Severity in issue body text, no labels (Task 4's `createGithubIssue`/`updateGithubIssueFields`).
10. Open/closed-only status mapping both directions (Task 4's `GITHUB_STATE_FOR_STATUS` and Task 11's `STATUS_FROM_GITHUB_ACTION`).

No gaps expected; this step is a final sanity check, not new work.

- [ ] **Step 4: Commit the plan checkbox updates**

```bash
git add docs/superpowers/plans/2026-08-10-github-integration-pr-feedback.md
git commit -m "docs: mark GitHub integration + PR feedback plan complete"
```
