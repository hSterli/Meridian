# GitLab Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two-way GitLab issue sync (mirroring Jira/GitHub) plus best-effort MR comment feedback on CI-ingested runs, for self-hosted or gitlab.com projects.

**Architecture:** A third `issue_tracker_connections` provider, mirroring GitHub's project-scoped pattern exactly (same partial unique index already covers it, no schema change needed there). New `src/lib/gitlab/client.ts` mirrors `src/lib/github/client.ts`'s shape 1:1, with three real deltas: `PRIVATE-TOKEN` auth header instead of `Authorization: Bearer`, a single `gitlab_project_path` field instead of split owner/repo, and simple-string-equality webhook verification (`X-Gitlab-Token`) instead of HMAC. `POST /api/v1/runs/ingest` gains a parallel `mrIid`/`mrCommentPosted` path alongside the existing `prNumber`/`prCommentPosted` one.

**Tech Stack:** Next.js 16 App Router (Server Components/Actions, Route Handlers), Supabase (Postgres/Vault/RLS), TypeScript, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-gitlab-integration-design.md` — read it first; every task below cites the scope decision it implements.

**Supabase project ref for MCP tools:** `ucnfcsosbdgknmzyuqbw`.

---

## Known repo quirk

Check `tail -3 <file>` after every file write for a stray literal `</content>` line; strip with `sed -i '' -e '/^<\/content>$/d' <file>` if present.

## Environment notes

- **git**: works via `/Library/Developer/CommandLineTools/usr/bin/git` — prepend to `PATH` before any git command.
- **Node/npm/npx**: now available at `/Users/heathersterling/.local/node-v24.19.0/bin` — prepend to `PATH` before any node/npm command. Run every `Verify` step for real this time; don't skip and note as unavailable.

---

### Task 1: Migration — GitLab connection schema + MR columns

**Files:**
- Create: `supabase/migrations/0027_gitlab_integration.sql`

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply the migration to the live project**

Use the Supabase MCP `apply_migration` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`, `name: "gitlab_integration"`, and the SQL above as `query`.

- [ ] **Step 3: Verify the schema changes**

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select column_name from information_schema.columns
where table_name = 'issue_tracker_connections' and column_name like 'gitlab%';
```
Expected: `gitlab_instance_url`, `gitlab_project_path`, `gitlab_webhook_token`, `gitlab_webhook_id`.

```sql
select column_name from information_schema.columns
where table_name = 'test_runs' and column_name in ('mr_iid', 'mr_url');
```
Expected: 2 rows.

```sql
select proname from pg_proc
where proname in ('create_gitlab_connection', 'get_gitlab_pat', 'delete_gitlab_connection', 'api_get_gitlab_pat_for_project');
```
Expected: 4 rows.

```sql
select enumlabel from pg_enum e join pg_type t on e.enumtypid = t.oid where t.typname = 'issue_tracker_provider';
```
Expected: `jira`, `github`, `gitlab`.

- [ ] **Step 4: Run the security advisor check**

Use the Supabase MCP `get_advisors` tool with `type: "security"` against `ucnfcsosbdgknmzyuqbw`. Expected: `create_gitlab_connection`/`get_gitlab_pat`/`delete_gitlab_connection` show up in the same already-accepted "authenticated can execute SECURITY DEFINER" category as their Jira/GitHub/Slack equivalents; `api_get_gitlab_pat_for_project` does not appear at all (correctly locked to service-role only). No new unexpected findings.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0027_gitlab_integration.sql
git commit -m "Add GitLab connection schema + MR feedback columns/functions"
```

---

### Task 2: Regenerate TypeScript types

**Files:**
- Modify: `src/lib/types/database.ts`

- [ ] **Step 1: Regenerate types from the live schema**

Use the Supabase MCP `generate_typescript_types` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`.

- [ ] **Step 2: Write the regenerated content, preserving hand-written aliases**

Write the generator's output to `src/lib/types/database.ts`, keeping the file's existing header comment and the "App-level convenience aliases" section at the bottom (`OrgRole`, `TestCasePriority`, etc., plus the `TestStep` interface) exactly as they are today — the generator only produces the `Database` type and its derived helper types above that section.

- [ ] **Step 3: Verify the types compile**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "Regenerate types for GitLab connection columns and functions"
```

---

### Task 3: GitLab API client

**Files:**
- Create: `src/lib/gitlab/client.ts`
- Test: `src/lib/gitlab/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/gitlab/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { verifyGitlabWebhookToken } from "./client";

describe("verifyGitlabWebhookToken", () => {
  it("returns true when the header matches the stored token", () => {
    expect(verifyGitlabWebhookToken("secret-123", "secret-123")).toBe(true);
  });

  it("returns false when the header doesn't match", () => {
    expect(verifyGitlabWebhookToken("wrong", "secret-123")).toBe(false);
  });

  it("returns false when the header is missing", () => {
    expect(verifyGitlabWebhookToken(null, "secret-123")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit src/lib/gitlab/client.test.ts`
Expected: FAIL — `src/lib/gitlab/client.ts` doesn't exist yet.

- [ ] **Step 3: Write `src/lib/gitlab/client.ts`**

```ts
import "server-only";

export interface GitlabConnectionCredentials {
  instanceUrl: string;
  projectPath: string;
  token: string;
}

function gitlabApiBase(instanceUrl: string): string {
  return `${instanceUrl.replace(/\/$/, "")}/api/v4`;
}

function encodedPath(projectPath: string): string {
  return encodeURIComponent(projectPath);
}

function gitlabHeaders(token: string): Record<string, string> {
  return {
    "PRIVATE-TOKEN": token,
    "Content-Type": "application/json",
  };
}

export async function verifyGitlabProjectAccess(
  connection: GitlabConnectionCredentials
): Promise<{ ok: true } | { error: string }> {
  const response = await fetch(
    `${gitlabApiBase(connection.instanceUrl)}/projects/${encodedPath(connection.projectPath)}`,
    { headers: gitlabHeaders(connection.token) }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `Could not access project (${response.status}): ${body}` };
  }

  return { ok: true };
}

export async function createGitlabIssue(
  connection: GitlabConnectionCredentials,
  title: string,
  description: string,
  severity: string
): Promise<{ iid: number; id: string } | { error: string }> {
  const response = await fetch(
    `${gitlabApiBase(connection.instanceUrl)}/projects/${encodedPath(connection.projectPath)}/issues`,
    {
      method: "POST",
      headers: gitlabHeaders(connection.token),
      body: JSON.stringify({
        title,
        description: `${description || "(no description)"}\n\n**Severity:** ${severity}`,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitLab issue create failed (${response.status}): ${body}` };
  }

  const data = (await response.json()) as { iid: number; id: number };
  return { iid: data.iid, id: String(data.id) };
}

export async function updateGitlabIssueFields(
  connection: GitlabConnectionCredentials,
  issueIid: number,
  title: string,
  description: string,
  severity: string
): Promise<{ error?: string }> {
  const response = await fetch(
    `${gitlabApiBase(connection.instanceUrl)}/projects/${encodedPath(connection.projectPath)}/issues/${issueIid}`,
    {
      method: "PUT",
      headers: gitlabHeaders(connection.token),
      body: JSON.stringify({
        title,
        description: `${description || "(no description)"}\n\n**Severity:** ${severity}`,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitLab issue update failed (${response.status}): ${body}` };
  }

  return {};
}

// GitLab issues only have opened/closed states — same lossy mapping as
// GitHub's. GitLab's API takes a state *event* (an action to perform: close
// or reopen) rather than the target state directly.
const GITLAB_STATE_EVENT_FOR_STATUS: Record<string, "close" | "reopen"> = {
  open: "reopen",
  in_progress: "reopen",
  resolved: "close",
  closed: "close",
};

export async function setGitlabIssueState(
  connection: GitlabConnectionCredentials,
  issueIid: number,
  meridianStatus: string
): Promise<{ error?: string }> {
  const stateEvent = GITLAB_STATE_EVENT_FOR_STATUS[meridianStatus];
  if (!stateEvent) return { error: `No GitLab state mapping for status "${meridianStatus}".` };

  const response = await fetch(
    `${gitlabApiBase(connection.instanceUrl)}/projects/${encodedPath(connection.projectPath)}/issues/${issueIid}`,
    {
      method: "PUT",
      headers: gitlabHeaders(connection.token),
      body: JSON.stringify({ state_event: stateEvent }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitLab issue state update failed (${response.status}): ${body}` };
  }

  return {};
}

export async function createGitlabWebhook(
  connection: GitlabConnectionCredentials,
  callbackUrl: string,
  token: string
): Promise<{ hookId: number } | { error: string }> {
  const response = await fetch(
    `${gitlabApiBase(connection.instanceUrl)}/projects/${encodedPath(connection.projectPath)}/hooks`,
    {
      method: "POST",
      headers: gitlabHeaders(connection.token),
      body: JSON.stringify({
        url: callbackUrl,
        token,
        issues_events: true,
        merge_requests_events: true,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitLab webhook create failed (${response.status}): ${body}` };
  }

  const data = (await response.json()) as { id: number };
  return { hookId: data.id };
}

export async function deleteGitlabWebhook(
  connection: GitlabConnectionCredentials,
  hookId: number
): Promise<{ ok: true } | { error: string }> {
  const response = await fetch(
    `${gitlabApiBase(connection.instanceUrl)}/projects/${encodedPath(connection.projectPath)}/hooks/${hookId}`,
    { method: "DELETE", headers: gitlabHeaders(connection.token) }
  );

  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    return { error: `GitLab webhook delete failed (${response.status}): ${body}` };
  }

  return { ok: true };
}

function mrCommentMarker(projectId: string): string {
  return `<!-- meridian-run:${projectId} -->`;
}

export interface MrRunSummary {
  projectId: string;
  runName: string;
  runUrl: string;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
}

function mrCommentBody(summary: MrRunSummary): string {
  return [
    mrCommentMarker(summary.projectId),
    `**Meridian: ${summary.runName}**`,
    "",
    `✅ ${summary.passed} passed · ❌ ${summary.failed} failed · 🚫 ${summary.blocked} blocked · ⏭️ ${summary.skipped} skipped`,
    "",
    `[View full run in Meridian](${summary.runUrl})`,
  ].join("\n");
}

// Finds an existing note on the MR carrying this project's hidden marker
// and updates it in place; otherwise posts a new one. Same idempotency
// trick as GitHub's postOrUpdatePrComment.
export async function postOrUpdateMrComment(
  connection: GitlabConnectionCredentials,
  mrIid: number,
  summary: MrRunSummary
): Promise<{ ok: true } | { error: string }> {
  const marker = mrCommentMarker(summary.projectId);
  const body = mrCommentBody(summary);
  const base = `${gitlabApiBase(connection.instanceUrl)}/projects/${encodedPath(connection.projectPath)}/merge_requests/${mrIid}/notes`;

  const listResponse = await fetch(base, { headers: gitlabHeaders(connection.token) });

  if (!listResponse.ok) {
    const text = await listResponse.text();
    return { error: `Could not list MR notes (${listResponse.status}): ${text}` };
  }

  const notes = (await listResponse.json()) as { id: number; body: string }[];
  const existing = notes.find((n) => n.body.includes(marker));

  const response = existing
    ? await fetch(`${base}/${existing.id}`, {
        method: "PUT",
        headers: gitlabHeaders(connection.token),
        body: JSON.stringify({ body }),
      })
    : await fetch(base, {
        method: "POST",
        headers: gitlabHeaders(connection.token),
        body: JSON.stringify({ body }),
      });

  if (!response.ok) {
    const text = await response.text();
    return { error: `Could not post MR note (${response.status}): ${text}` };
  }

  return { ok: true };
}

// Pure — GitLab's webhook auth model is a static token sent back verbatim
// in X-Gitlab-Token, compared directly (no HMAC-over-payload the way
// GitHub's X-Hub-Signature-256 works — this is GitLab's actual mechanism,
// not a simplified stand-in for it).
export function verifyGitlabWebhookToken(
  headerValue: string | null,
  storedToken: string
): boolean {
  if (!headerValue) return false;
  return headerValue === storedToken;
}
```

- [ ] **Step 4: Check for the stray `</content>` line**

Run: `tail -3 src/lib/gitlab/client.ts`
Strip with `sed -i '' -e '/^<\/content>$/d' src/lib/gitlab/client.ts` if present. Repeat for the test file.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project unit src/lib/gitlab/client.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/gitlab/client.ts src/lib/gitlab/client.test.ts`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/gitlab/client.ts src/lib/gitlab/client.test.ts
git commit -m "Add GitLab API client: issue sync, webhook management, MR comment feedback"
```

---

### Task 4: Server Actions

**Files:**
- Modify: `src/lib/actions/issue-tracker.ts`

- [ ] **Step 1: Add the GitLab imports**

Add to the existing import block:

```ts
import {
  createGitlabIssue,
  createGitlabWebhook,
  deleteGitlabWebhook,
  verifyGitlabProjectAccess,
} from "@/lib/gitlab/client";
```

- [ ] **Step 2: Append the GitLab Server Actions**

Add to the end of `src/lib/actions/issue-tracker.ts`:

```ts
export interface GitlabConnectionActionState extends ActionState {
  webhookWarning?: string;
}

export async function connectGitlabTracker(
  _prevState: GitlabConnectionActionState,
  formData: FormData
): Promise<GitlabConnectionActionState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const instanceUrl = (String(formData.get("instanceUrl") ?? "").trim() || "https://gitlab.com").replace(
    /\/$/,
    ""
  );
  const projectPath = String(formData.get("projectPath") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();

  if (!projectId || !projectPath || !token) {
    return { error: "Project, project path, and token are required." };
  }

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can connect an issue tracker." };
  }

  const limitError = await rateLimit("connect_issue_tracker", 10, 3600);
  if (limitError) return { error: limitError };

  const access = await verifyGitlabProjectAccess({ instanceUrl, projectPath, token });
  if ("error" in access) return { error: access.error };

  const webhookToken = randomBytes(24).toString("base64url");
  const supabase = await createClient();

  const { data: connectionId, error } = await supabase.rpc("create_gitlab_connection", {
    p_project_id: projectId,
    p_instance_url: instanceUrl,
    p_project_path: projectPath,
    p_token: token,
    p_webhook_token: webhookToken,
  });

  if (error || !connectionId) return { error: error?.message ?? "Could not save connection." };

  revalidatePath("/settings/integrations/gitlab");

  const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/v1/webhooks/gitlab`;
  const webhook = await createGitlabWebhook({ instanceUrl, projectPath, token }, callbackUrl, webhookToken);

  if ("error" in webhook) {
    return {
      webhookWarning:
        "Issue sync is connected, but automatic status updates from GitLab aren't set up yet — disconnect and reconnect to retry.",
    };
  }

  await supabase
    .from("issue_tracker_connections")
    .update({ gitlab_webhook_id: webhook.hookId })
    .eq("id", connectionId);

  return {};
}

export async function disconnectGitlabTracker(
  connectionId: string,
  instanceUrl: string,
  projectPath: string,
  webhookId: number | null
) {
  const supabase = await createClient();

  if (webhookId) {
    const { data: token } = await supabase.rpc("get_gitlab_pat", { p_connection_id: connectionId });
    if (token) {
      await deleteGitlabWebhook({ instanceUrl, projectPath, token }, webhookId);
    }
  }

  await supabase.rpc("delete_gitlab_connection", { p_connection_id: connectionId });
  revalidatePath("/settings/integrations/gitlab");
}

export async function sendIssueToGitlab(
  projectId: string,
  issueId: string,
  connectionId: string,
  _prevState: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("send_issue_to_gitlab", 30, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const { data: connection } = await supabase
    .from("issue_tracker_connections")
    .select("gitlab_instance_url, gitlab_project_path")
    .eq("id", connectionId)
    .single();
  if (!connection) return { error: "Connection not found." };
  if (!connection.gitlab_instance_url || !connection.gitlab_project_path) {
    return { error: "This connection is missing project information." };
  }

  const { data: token } = await supabase.rpc("get_gitlab_pat", { p_connection_id: connectionId });
  if (!token) return { error: "Could not retrieve GitLab credentials." };

  const { data: issue } = await supabase
    .from("issues")
    .select("title, description, severity")
    .eq("id", issueId)
    .single();
  if (!issue) return { error: "Issue not found." };

  const result = await createGitlabIssue(
    { instanceUrl: connection.gitlab_instance_url, projectPath: connection.gitlab_project_path, token },
    issue.title,
    issue.description ?? "",
    issue.severity
  );

  if ("error" in result) return { error: result.error };

  const { error: linkError } = await supabase.from("issue_tracker_links").insert({
    issue_id: issueId,
    connection_id: connectionId,
    external_issue_key: String(result.iid),
    external_issue_id: result.id,
    external_updated_at: new Date().toISOString(),
  });

  if (linkError) return { error: linkError.message };

  revalidatePath(`/projects/${projectId}/issues/${issueId}`);
  return {};
}
```

- [ ] **Step 3: Check for the stray `</content>` line**

Run: `tail -3 src/lib/actions/issue-tracker.ts`
Strip if present.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/issue-tracker.ts`
Expected: at most the same class of pre-existing accepted `_prevState`/`_formData` unused-vars warnings already present for the Jira/GitHub actions, plus one new matching pair for `sendIssueToGitlab`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/issue-tracker.ts
git commit -m "Add connectGitlabTracker/disconnectGitlabTracker/sendIssueToGitlab Server Actions"
```

---

### Task 5: Extend `updateIssueStatus` with a GitLab branch

**Files:**
- Modify: `src/lib/actions/issues.ts`

- [ ] **Step 1: Add the GitLab import**

Add alongside the existing `transitionJiraIssueStatus`/`setGithubIssueState` imports at the top of the file:

```ts
import { setGitlabIssueState } from "@/lib/gitlab/client";
```

- [ ] **Step 2: Extend the joined-connection select and add the third branch**

In `updateIssueStatus`, change the select string from:

```ts
      "id, external_issue_key, connection_id, issue_tracker_connections(provider, jira_base_url, jira_email, jira_project_key, github_repo_owner, github_repo_name)"
```

to:

```ts
      "id, external_issue_key, connection_id, issue_tracker_connections(provider, jira_base_url, jira_email, jira_project_key, github_repo_owner, github_repo_name, gitlab_instance_url, gitlab_project_path)"
```

Then add a third `else if` branch immediately after the existing `else if (connection.provider === "github") { ... }` block (matching its exact shape):

```ts
      } else if (connection.provider === "gitlab") {
        const { data: token } = await supabase.rpc("get_gitlab_pat", {
          p_connection_id: link.connection_id,
        });

        if (token && connection.gitlab_instance_url && connection.gitlab_project_path) {
          result = await setGitlabIssueState(
            {
              instanceUrl: connection.gitlab_instance_url,
              projectPath: connection.gitlab_project_path,
              token,
            },
            Number(link.external_issue_key),
            status
          );
        }
      }
```

Read the full existing `if (connection.provider === "jira") { ... } else if (connection.provider === "github") { ... }` block first to confirm exact indentation and the closing-brace structure your new branch needs to slot into — don't guess the surrounding syntax.

- [ ] **Step 3: Check for the stray `</content>` line**

Run: `tail -3 src/lib/actions/issues.ts`
Strip if present.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/issues.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/issues.ts
git commit -m "Branch outbound issue-status push on connection provider (add GitLab)"
```

---

### Task 6: Inbound GitLab webhook route

**Files:**
- Create: `src/app/api/v1/webhooks/gitlab/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { createServiceClient } from "@/lib/supabase/service";
import { verifyGitlabWebhookToken } from "@/lib/gitlab/client";
import type { IssueStatus } from "@/lib/types/database";

const STATUS_FROM_GITLAB_ACTION: Record<string, IssueStatus> = {
  close: "resolved",
  reopen: "open",
};

interface GitlabIssueWebhookPayload {
  object_kind?: string;
  object_attributes?: { action?: string; iid?: number; id?: number };
  project?: { path_with_namespace?: string };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const tokenHeader = request.headers.get("x-gitlab-token");

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const gitlabPayload = payload as GitlabIssueWebhookPayload;
  const projectPath = gitlabPayload.project?.path_with_namespace;

  const supabase = createServiceClient();

  const { data: connection } = projectPath
    ? await supabase
        .from("issue_tracker_connections")
        .select("id, org_id, gitlab_webhook_token")
        .eq("provider", "gitlab")
        .eq("gitlab_project_path", projectPath)
        .maybeSingle()
    : { data: null };

  const tokenValid = Boolean(
    connection?.gitlab_webhook_token &&
      verifyGitlabWebhookToken(tokenHeader, connection.gitlab_webhook_token)
  );

  // Stored regardless of validity, same audit-trail principle as the
  // Jira/GitHub webhook routes.
  await supabase.from("webhook_events").insert({
    source: "gitlab",
    org_id: connection?.org_id ?? null,
    payload: payload as never,
    signature_valid: tokenValid,
  });

  if (!connection || !tokenValid) {
    return Response.json({ error: "Invalid webhook token." }, { status: 401 });
  }

  if (gitlabPayload.object_kind !== "issue") {
    return Response.json({ status: "ignored" });
  }

  const externalIssueId = gitlabPayload.object_attributes?.id;
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

  const mappedStatus = gitlabPayload.object_attributes?.action
    ? STATUS_FROM_GITLAB_ACTION[gitlabPayload.object_attributes.action]
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

Run: `tail -3 src/app/api/v1/webhooks/gitlab/route.ts`
Strip if present.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/app/api/v1/webhooks/gitlab/route.ts`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/webhooks/gitlab/route.ts
git commit -m "Add inbound GitLab webhook route (token verification, issue status sync)"
```

---

### Task 7: GitLab connection manager UI

**Files:**
- Create: `src/components/settings/gitlab-connection-manager.tsx`
- Create: `src/app/(app)/settings/integrations/gitlab/page.tsx`

- [ ] **Step 1: Write the connection manager component**

Create `src/components/settings/gitlab-connection-manager.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { GitlabConnectionActionState } from "@/lib/actions/issue-tracker";

export interface GitlabConnectionRow {
  id: string;
  project_id: string | null;
  gitlab_instance_url: string | null;
  gitlab_project_path: string | null;
  gitlab_webhook_id: number | null;
  projects: { name: string } | { name: string }[] | null;
}

export interface GitlabProjectOption {
  id: string;
  name: string;
}

export function GitlabConnectionManager({
  connections,
  projects,
  isAdmin,
  connectAction,
  disconnectAction,
}: {
  connections: GitlabConnectionRow[];
  projects: GitlabProjectOption[];
  isAdmin: boolean;
  connectAction: (
    prevState: GitlabConnectionActionState,
    formData: FormData
  ) => Promise<GitlabConnectionActionState>;
  disconnectAction: (
    connectionId: string,
    instanceUrl: string,
    projectPath: string,
    webhookId: number | null
  ) => void;
}) {
  const [state, formAction, isPending] = useActionState<GitlabConnectionActionState, FormData>(
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
                  {projectName ?? "Unknown project"} → {connection.gitlab_instance_url}/
                  {connection.gitlab_project_path}
                </p>
                {!connection.gitlab_webhook_id && (
                  <p className="mt-1 text-xs text-fail">
                    Automatic status updates from GitLab aren&apos;t set up — disconnect and
                    reconnect to retry.
                  </p>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() =>
                      disconnectAction(
                        connection.id,
                        connection.gitlab_instance_url ?? "",
                        connection.gitlab_project_path ?? "",
                        connection.gitlab_webhook_id
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
        <Card className="p-4 text-sm text-ink-tertiary">No GitLab connections configured.</Card>
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
              <Label htmlFor="instanceUrl">GitLab instance URL</Label>
              <Input id="instanceUrl" name="instanceUrl" placeholder="https://gitlab.com" />
            </div>
            <div>
              <Label htmlFor="projectPath">Project path</Label>
              <Input id="projectPath" name="projectPath" required placeholder="group/project" />
            </div>
            <div>
              <Label htmlFor="token">Personal access token</Label>
              <Input id="token" name="token" type="password" required />
            </div>
            {state.error && <p className="text-xs text-fail">{state.error}</p>}
            {state.webhookWarning && <p className="text-xs text-fail">{state.webhookWarning}</p>}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Connecting…" : "Connect GitLab"}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 src/components/settings/gitlab-connection-manager.tsx`
Strip if present.

- [ ] **Step 3: Write the page**

Create `src/app/(app)/settings/integrations/gitlab/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { GitlabConnectionManager } from "@/components/settings/gitlab-connection-manager";
import { connectGitlabTracker, disconnectGitlabTracker } from "@/lib/actions/issue-tracker";

export default async function GitlabIntegrationPage() {
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
    .select(
      "id, project_id, gitlab_instance_url, gitlab_project_path, gitlab_webhook_id, projects(name)"
    )
    .eq("org_id", ctx.activeOrgId)
    .eq("provider", "gitlab");

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PageHeader title="GitLab" description="Two-way issue sync and MR test-result feedback, per project." />
      <GitlabConnectionManager
        connections={connections ?? []}
        projects={projects ?? []}
        isAdmin={isAdmin}
        connectAction={connectGitlabTracker}
        disconnectAction={disconnectGitlabTracker}
      />
    </div>
  );
}
```

- [ ] **Step 4: Check for the stray `</content>` line**

Run: `tail -3 "src/app/(app)/settings/integrations/gitlab/page.tsx"`
Strip if present.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/settings/gitlab-connection-manager.tsx "src/app/(app)/settings/integrations/gitlab/page.tsx"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/gitlab-connection-manager.tsx "src/app/(app)/settings/integrations/gitlab/page.tsx"
git commit -m "Add GitLab connection manager UI"
```

---

### Task 8: Add GitLab to the integrations index page

**Files:**
- Modify: `src/app/(app)/settings/integrations/page.tsx`

- [ ] **Step 1: Add the GitLab entry to `PROVIDERS`**

Add a fourth entry to the existing `PROVIDERS` array (currently `jira`, `github`, `slack`):

```ts
  {
    segment: "gitlab",
    label: "GitLab",
    description: "Two-way issue sync and MR test-result feedback, per project.",
  },
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/(app)/settings/integrations/page.tsx"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/settings/integrations/page.tsx"
git commit -m "Add GitLab to the integrations index page"
```

---

### Task 9: Wire MR feedback into the CI ingest route

**Files:**
- Modify: `src/lib/validation/ingest-request.ts`
- Modify: `src/app/api/v1/runs/ingest/route.ts`

- [ ] **Step 1: Add `mrIid` to the validation module**

In `src/lib/validation/ingest-request.ts`, add `mrIid?: number;` to the `ValidatedIngestRequest` interface, add `mrIid?: unknown;` to the destructured body type, and add validation + pass-through mirroring the existing `prNumber` handling exactly:

```ts
export interface ValidatedIngestRequest {
  projectId: string;
  runName: string;
  results: IngestResultInput[];
  prNumber?: number;
  mrIid?: number;
}

export function validateIngestRequestBody(
  body: unknown
): { data: ValidatedIngestRequest } | { error: string } {
  const { projectId, runName, results, prNumber, mrIid } = (body ?? {}) as {
    projectId?: string;
    runName?: string;
    results?: IngestResultInput[];
    prNumber?: unknown;
    mrIid?: unknown;
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

  if (mrIid !== undefined) {
    if (typeof mrIid !== "number" || !Number.isInteger(mrIid) || mrIid <= 0) {
      return { error: "mrIid must be a positive integer." };
    }
  }

  return {
    data: {
      projectId,
      runName,
      results,
      prNumber: typeof prNumber === "number" ? prNumber : undefined,
      mrIid: typeof mrIid === "number" ? mrIid : undefined,
    },
  };
}
```

- [ ] **Step 2: Wire the RPC call and add `trySendMrComment`**

In `src/app/api/v1/runs/ingest/route.ts`:

Add to the imports:

```ts
import { postOrUpdateMrComment } from "@/lib/gitlab/client";
```

Change the destructuring `const { projectId, runName, results, prNumber } = validation.data;` to:

```ts
  const { projectId, runName, results, prNumber, mrIid } = validation.data;
```

Change the `api_ingest_run_results` RPC call to include `p_mr_iid: mrIid`:

```ts
  const { data, error } = await supabase.rpc("api_ingest_run_results", {
    p_org_id: auth.orgId,
    p_key_id: auth.keyId,
    p_project_id: projectId,
    p_run_name: runName,
    p_results: results as unknown as Json,
    p_pr_number: prNumber,
    p_mr_iid: mrIid,
  });
```

Add a `mrCommentPosted` block immediately after the existing `prCommentPosted` block, following the exact same shape:

```ts
  let mrCommentPosted = false;
  if (row?.mr_url && mrIid && row.run_id) {
    mrCommentPosted = await tryPostMrComment({
      orgId: auth.orgId,
      projectId,
      mrIid,
      runId: row.run_id,
      runName,
      results,
    });
  }
```

Add `mrCommentPosted` to the response JSON, alongside `prCommentPosted`/`slackNotified`:

```ts
  return Response.json(
    {
      data: {
        runId: row?.run_id,
        matched: row?.matched,
        autoCreated: row?.auto_created,
        prCommentPosted,
        mrCommentPosted,
        slackNotified,
      },
    },
    { status: 201 }
  );
```

Add `tryPostMrComment` as a new function at the end of the file, mirroring `tryPostPrComment` exactly:

```ts
// Best-effort, same pattern as tryPostPrComment: any failure (bad/revoked
// PAT, renamed project, GitLab outage) is caught and never fails the
// ingest response.
async function tryPostMrComment(args: {
  orgId: string;
  projectId: string;
  mrIid: number;
  runId: string;
  runName: string;
  results: IngestResultInput[];
}): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase.rpc("api_get_gitlab_pat_for_project", {
      p_org_id: args.orgId,
      p_project_id: args.projectId,
    });
    const row = data?.[0];
    if (!row?.token || !row.instance_url || !row.project_path) return false;

    const counts = countResultsByStatus(args.results);
    const runUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/projects/${args.projectId}/runs/${args.runId}`;

    const result = await postOrUpdateMrComment(
      { instanceUrl: row.instance_url, projectPath: row.project_path, token: row.token },
      args.mrIid,
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

- [ ] **Step 3: Check for the stray `</content>` line**

Run: `tail -3 src/app/api/v1/runs/ingest/route.ts`
Strip if present. Repeat for `src/lib/validation/ingest-request.ts`.

- [ ] **Step 4: Type-check, lint, and re-run existing tests**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/app/api/v1/runs/ingest/route.ts src/lib/validation/ingest-request.ts`
Expected: no output.

Run: `npm test`
Expected: all existing tests pass, plus the new `src/lib/gitlab/client.test.ts` (3 tests). Check whether `src/lib/validation/ingest-request.test.ts` exists and covers `prNumber`-shaped validation — if so, add a mirrored `mrIid` case or two following its existing style; if it doesn't test `prNumber` at all today, no new test is required here (matching existing coverage, not exceeding it).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/runs/ingest/route.ts src/lib/validation/ingest-request.ts
git commit -m "Post a best-effort GitLab MR comment on CI-ingested runs with an mrIid"
```

---

### Task 10: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a GitLab bullet to "What's implemented"**

Add immediately after the existing GitHub bullet, mirroring its structure: one GitLab connection per project, admin-managed, PAT in Vault, self-hosted-instance support via an optional instance URL (defaulting to gitlab.com), webhook auto-created via GitLab's API on connect, two-way issue sync, and MR comment feedback riding on `POST /api/v1/runs/ingest`'s new `mrIid` field.

- [ ] **Step 2: Update the CI Integration section**

Add `"mrIid": 7` to the example request body (alongside the existing `"prNumber": 42`), add `"mrCommentPosted": true` to the example response JSON, and add a paragraph mirroring the existing `prNumber` paragraph: if the project has a connected GitLab project, Meridian posts (or updates, on a re-run) a note on that merge request — same best-effort semantics, reflected only in `mrCommentPosted`.

- [ ] **Step 3: Add a migrations table row**

Add a row for `0027_gitlab_integration.sql` immediately after the `0025_revoke_anon_function_execute.sql` row, describing the GitLab connection columns/functions and the `mr_iid`/`mr_url` columns on `test_runs`, mirroring the existing `0024_slack_integration.sql` row's style.

- [ ] **Step 4: Update "Explicitly deferred"**

Remove or update the existing "GitLab two-way issue sync, and GitLab MR feedback" bullet (added when the GitHub project shipped) to reflect that this is now done — either delete that line entirely, or change it to name only Azure DevOps as still deferred, matching whatever the current exact wording of that bullet is (read it first).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Document the GitLab integration (connection setup, mrIid/mrCommentPosted, self-hosted support)"
```

---

### Task 11: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated verification suite**

```bash
npx tsc --noEmit
```
Expected: no output.

```bash
npx eslint .
```
Expected: no errors; only the same pre-existing accepted `_prevState`/`_formData`-style unused-vars warnings already present before this project, plus the new matching pair from `sendIssueToGitlab`.

```bash
npm test
```
Expected: all tests pass, including the new `src/lib/gitlab/client.test.ts` (3 tests).

```bash
npm run build
```
Expected: production build succeeds; `/settings/integrations/gitlab` and `/api/v1/webhooks/gitlab` both appear in the route list.

```bash
git status --short
```
Expected: clean.

- [ ] **Step 2: Confirm the migration applied live and matches**

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select count(*) from issue_tracker_connections where provider = 'gitlab';
```
Expected: succeeds, `0` rows (nothing connected yet).

- [ ] **Step 3: Manual end-to-end test against a real GitLab project**

Needs a real GitLab account (gitlab.com or self-hosted), a test project, and a PAT with `api` scope. Requires Node for the dev server.

1. Go to Settings > Integrations > GitLab, connect a test project (instance URL, project path, PAT).
2. Create a Meridian issue, send it to GitLab via the issue detail page's "Send to GitLab" form (mirrors the existing Jira/GitHub send forms — confirm one was added if the UI has a generic pattern for this, or note if this plan didn't explicitly add a GitLab send-to form component and needs one following `send-to-jira-form.tsx`/`send-to-github-form.tsx`'s pattern before this step is testable).
3. Change the Meridian issue's status; confirm it pushes to GitLab.
4. Close/reopen the issue on GitLab's side; confirm the inbound webhook updates Meridian.
5. Get a Meridian API key and `POST` to `/api/v1/runs/ingest` with an `mrIid` for a real merge request in the test project; confirm `mrCommentPosted: true` and a note appears on the MR.

If no test GitLab account/project is available, **stop and tell the user this step was skipped** rather than marking it done.

- [ ] **Step 4: Confirm the design spec is fully addressed**

Re-read `docs/superpowers/specs/2026-08-23-gitlab-integration-design.md`'s 11 scope decisions and confirm each is reflected in the shipped code (data source/full-scope bundling, self-hosted instance support, single project-path field, PAT-in-Vault auth, webhook auto-creation, MR comments not status checks, `mrIid` on the existing ingest endpoint, best-effort MR posting, severity-as-text, opened/closed state mapping).

- [ ] **Step 5: Commit the plan checkbox updates**

```bash
git add docs/superpowers/plans/2026-08-23-gitlab-integration.md
git commit -m "docs: mark GitLab integration plan complete"
```
