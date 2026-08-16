# Slack Integration Implementation Plan

> **For agentic workers:** execute via a fresh general-purpose subagent per task, with the orchestrator reviewing each task's actual diff before dispatching the next (same approach used for the GitHub integration plan).

**Goal:** Best-effort Slack notification posted to a connected channel whenever a CI-ingested test run completes via `POST /api/v1/runs/ingest`.

**Architecture:** New `slack_connections` table (project-scoped, one per project), same Vault-secret + `security definer` function pattern as Jira/GitHub. `POST /api/v1/runs/ingest` gains a `trySendSlackNotification()` step, structurally identical to the existing `tryPostPrComment()`, run unconditionally after a successful ingest (not gated on any new request field).

**Tech Stack:** Next.js 16 Server Actions/Route Handlers, Supabase (Postgres/Vault/RLS), TypeScript, Tailwind v4, Vitest.

**Supabase project ref for MCP tools:** `ucnfcsosbdgknmzyuqbw`.

**Known repo quirk to watch for:** check `tail -3 <file>` after every file write for a stray literal `</content>` line; strip with `sed -i '' -e '/^<\/content>$/d' <file>` if present.

---

### Task 1: Migration — Slack connection schema

**Files:**
- Create: `supabase/migrations/0024_slack_integration.sql`

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply the migration to the live project**

Use the Supabase MCP `apply_migration` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`, `name: "slack_integration"`, and the SQL above as `query`. Note: this assigns its own timestamp-based version on the live project (matching the existing local-vs-live numbering drift already present for `revoke_anon_function_execute` — not something to reconcile here).

- [ ] **Step 3: Verify the schema changes**

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select column_name, is_nullable, data_type
from information_schema.columns
where table_name = 'slack_connections'
order by column_name;
```
Expected: `channel_id` (text, NO), `created_at` (timestamptz, NO), `created_by` (uuid, NO), `id` (uuid, NO), `org_id` (uuid, NO), `project_id` (uuid, NO), `vault_secret_id` (uuid, NO).

```sql
select conname from pg_constraint where conrelid = 'slack_connections'::regclass;
```
Expected: includes a unique constraint on `project_id` (e.g. `slack_connections_project_id_key`).

```sql
select proname from pg_proc
where proname in ('create_slack_connection', 'get_slack_bot_token', 'delete_slack_connection', 'api_get_slack_bot_token_for_project');
```
Expected: 4 rows.

- [ ] **Step 4: Run the security advisor check**

Use the Supabase MCP `get_advisors` tool with `type: "security"` against `ucnfcsosbdgknmzyuqbw`. Expected: same pre-existing accepted items as before (rate_limit_buckets RLS-no-policy, SECURITY DEFINER warnings, leaked-password-protection), plus the four new SECURITY DEFINER functions showing up in the same already-accepted flagged category the Jira/GitHub ones do.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0024_slack_integration.sql
git commit -m "Add Slack connection schema: project-scoped slack_connections + create/get/delete functions + service-role token lookup"
```

---

### Task 2: Regenerate TypeScript types

**Files:**
- Modify: `src/lib/types/database.ts`

- [ ] **Step 1: Regenerate types from the live schema**

Use the Supabase MCP `generate_typescript_types` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`.

- [ ] **Step 2: Confirm the new `slack_connections` block exists**

The regenerated file should contain a `slack_connections` table block plus a `Functions` block containing `create_slack_connection`, `get_slack_bot_token`, `delete_slack_connection`, `api_get_slack_bot_token_for_project` with signatures matching Task 1's SQL. If the generator's output differs from expectations, trust the generator's actual output.

- [ ] **Step 3: Re-add hand-written convenience aliases**

Per README's "After schema changes, regenerate types" note, re-add any hand-written convenience type aliases (`OrgRole`, `TestStep`, etc.) at the bottom of the file if the regeneration step dropped them.

- [ ] **Step 4: Verify the types compile**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "Regenerate types for slack_connections and the new slack_* functions"
```

---

### Task 3: Slack API client

**Files:**
- Create: `src/lib/slack/client.ts`
- Test: `src/lib/slack/client.test.ts`

- [ ] **Step 1: Write the failing test for `formatRunNotification`**

Create `src/lib/slack/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatRunNotification } from "./client";

describe("formatRunNotification", () => {
  it("formats a run summary as Slack mrkdwn", () => {
    const text = formatRunNotification({
      runName: "CI: main @ abc123",
      runUrl: "https://app.meridianqa.dev/projects/p1/runs/r1",
      passed: 8,
      failed: 1,
      blocked: 0,
      skipped: 2,
    });

    expect(text).toContain("*Meridian: CI: main @ abc123*");
    expect(text).toContain("✅ 8 passed · ❌ 1 failed · 🚫 0 blocked · ⏭️ 2 skipped");
    expect(text).toContain(
      "<https://app.meridianqa.dev/projects/p1/runs/r1|View full run in Meridian>"
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit src/lib/slack/client.test.ts`
Expected: FAIL — `src/lib/slack/client.ts` doesn't exist yet.

- [ ] **Step 3: Write `src/lib/slack/client.ts`**

```ts
import "server-only";

export interface SlackConnectionCredentials {
  botToken: string;
  channelId: string;
}

const SLACK_API = "https://slack.com/api";

function slackHeaders(botToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${botToken}`,
    "Content-Type": "application/json; charset=utf-8",
  };
}

// Slack's Web API returns HTTP 200 even for auth/permission failures — the
// real success/failure signal is the `ok` boolean in the JSON body plus an
// `error` code string (https://api.slack.com/web#responses). Every helper
// below checks that field, not response.ok.
interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

export async function postSlackMessage(
  connection: SlackConnectionCredentials,
  text: string
): Promise<{ ok: true } | { error: string }> {
  const response = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: slackHeaders(connection.botToken),
    body: JSON.stringify({ channel: connection.channelId, text }),
  });

  const data = (await response.json()) as SlackApiResponse;
  if (!data.ok) {
    return { error: `Slack message post failed: ${data.error ?? "unknown error"}` };
  }

  return { ok: true };
}

// Validates a bot token and channel access with only the chat:write scope:
// auth.test confirms the token itself is valid, then a real confirmation
// message is posted to the channel (rather than a read-only lookup, which
// would need channels:read/groups:read — scopes outside this integration's
// locked-in chat:write-only auth model). This also surfaces the most common
// Slack integration mistake (valid token, bot not yet invited to the
// channel) as an actionable error before the connection is saved.
export async function verifySlackBotAccess(
  botToken: string,
  channelId: string
): Promise<{ ok: true } | { error: string }> {
  const authResponse = await fetch(`${SLACK_API}/auth.test`, {
    method: "POST",
    headers: slackHeaders(botToken),
  });
  const authData = (await authResponse.json()) as SlackApiResponse;
  if (!authData.ok) {
    return { error: `Slack token is invalid (${authData.error ?? "unknown error"}).` };
  }

  const messageResult = await postSlackMessage(
    { botToken, channelId },
    "✅ Meridian is now connected to this channel. Test run notifications will be posted here."
  );
  if ("error" in messageResult) {
    return {
      error: `Token is valid, but could not post to channel "${channelId}": ${messageResult.error}. Make sure the bot has been invited to the channel (/invite @your-bot-name).`,
    };
  }

  return { ok: true };
}

export interface RunNotificationSummary {
  runName: string;
  runUrl: string;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
}

// Pure — builds the notification text, unit-testable without hitting
// Slack's API. Directly analogous to prCommentBody in
// src/lib/github/client.ts, using Slack's mrkdwn syntax instead of GitHub's
// Markdown (*bold* instead of **bold**, <url|text> instead of [text](url)).
export function formatRunNotification(summary: RunNotificationSummary): string {
  return [
    `*Meridian: ${summary.runName}*`,
    `✅ ${summary.passed} passed · ❌ ${summary.failed} failed · 🚫 ${summary.blocked} blocked · ⏭️ ${summary.skipped} skipped`,
    `<${summary.runUrl}|View full run in Meridian>`,
  ].join("\n");
}
```

- [ ] **Step 4: Check for the stray `</content>` line**

Run: `tail -3 src/lib/slack/client.ts`
Strip with `sed -i '' -e '/^<\/content>$/d' src/lib/slack/client.ts` if present.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project unit src/lib/slack/client.test.ts`
Expected: 1 passed.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/slack/client.ts src/lib/slack/client.test.ts`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/slack/client.ts src/lib/slack/client.test.ts
git commit -m "Add Slack API client: chat.postMessage, bot access verification, run notification formatting"
```

---

### Task 4: Slack Server Actions

**Files:**
- Create: `src/lib/actions/slack.ts`

- [ ] **Step 1: Write the actions file**

Create `src/lib/actions/slack.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import { verifySlackBotAccess } from "@/lib/slack/client";
import type { ActionState } from "@/lib/actions/auth";

export async function connectSlackNotifications(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const channelId = String(formData.get("channelId") ?? "").trim();
  const botToken = String(formData.get("botToken") ?? "").trim();

  if (!projectId || !channelId || !botToken) {
    return { error: "All fields are required." };
  }

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can connect Slack notifications." };
  }

  const limitError = await rateLimit("connect_slack", 10, 3600);
  if (limitError) return { error: limitError };

  const access = await verifySlackBotAccess(botToken, channelId);
  if ("error" in access) return { error: access.error };

  const supabase = await createClient();

  const { data: connectionId, error } = await supabase.rpc("create_slack_connection", {
    p_project_id: projectId,
    p_channel_id: channelId,
    p_bot_token: botToken,
  });

  if (error || !connectionId) return { error: error?.message ?? "Could not save connection." };

  revalidatePath("/settings/integrations/slack");
  return {};
}

export async function disconnectSlackNotifications(connectionId: string) {
  const supabase = await createClient();
  await supabase.rpc("delete_slack_connection", { p_connection_id: connectionId });
  revalidatePath("/settings/integrations/slack");
}
```

- [ ] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 src/lib/actions/slack.ts`
Strip if present.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/slack.ts`
Expected: at most 1 accepted `_prevState`-unused-vars-style warning — same class as `sendIssueToJira`/`sendIssueToGithub`'s accepted `_prevState`/`_formData` pair — `connectSlackNotifications` needs the exact `(prevState, formData)` signature to be callable via `useActionState`, and this repo's eslint config has no `argsIgnorePattern` for underscore-prefixed args.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/slack.ts
git commit -m "Add connectSlackNotifications/disconnectSlackNotifications Server Actions"
```

---

### Task 5: Wire the Slack notification into the ingest route

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
import { postSlackMessage, formatRunNotification } from "@/lib/slack/client";

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
    p_pr_number: prNumber,
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

  let slackNotified = false;
  if (row?.run_id) {
    slackNotified = await trySendSlackNotification({
      orgId: auth.orgId,
      projectId,
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
        slackNotified,
      },
    },
    { status: 201 }
  );
}

// Shared by both best-effort notification paths below so the counts aren't
// computed twice per request.
function countResultsByStatus(results: IngestResultInput[]) {
  const counts = { passed: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const r of results) {
    if (r.status && r.status in counts) {
      counts[r.status as keyof typeof counts] += 1;
    }
  }
  return counts;
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

    const counts = countResultsByStatus(args.results);
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

// Best-effort, same pattern as tryPostPrComment: any failure (no
// connection, revoked bot token, channel access revoked, Slack outage) is
// caught and never fails the ingest response — the run was already
// recorded successfully by the time this runs. Unlike tryPostPrComment,
// this runs unconditionally after every successful ingest (not gated on a
// prNumber) — Slack notification is scoped to "a CI run completed", not to
// "a run associated with a PR".
async function trySendSlackNotification(args: {
  orgId: string;
  projectId: string;
  runId: string;
  runName: string;
  results: IngestResultInput[];
}): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase.rpc("api_get_slack_bot_token_for_project", {
      p_org_id: args.orgId,
      p_project_id: args.projectId,
    });
    const row = data?.[0];
    if (!row?.token || !row.channel_id) return false;

    const counts = countResultsByStatus(args.results);
    const runUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/projects/${args.projectId}/runs/${args.runId}`;

    const result = await postSlackMessage(
      { botToken: row.token, channelId: row.channel_id },
      formatRunNotification({
        runName: args.runName,
        runUrl,
        passed: counts.passed,
        failed: counts.failed,
        blocked: counts.blocked,
        skipped: counts.skipped,
      })
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
Expected: all existing unit tests still pass, plus the new `src/lib/slack/client.test.ts` (1 test).

- [ ] **Step 3: Verify the route still builds**

Run: `npm run build`
Expected: production build succeeds, `/api/v1/runs/ingest` still appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/runs/ingest/route.ts
git commit -m "Post a best-effort Slack notification on every CI-ingested run completion"
```

---

### Task 6: Slack connection manager UI

**Files:**
- Create: `src/components/settings/slack-connection-manager.tsx`
- Create: `src/app/(app)/settings/integrations/slack/page.tsx`

- [ ] **Step 1: Write the connection manager component**

Create `src/components/settings/slack-connection-manager.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ActionState } from "@/lib/actions/auth";

export interface SlackConnectionRow {
  id: string;
  project_id: string;
  channel_id: string;
  projects: { name: string } | { name: string }[] | null;
}

export interface SlackProjectOption {
  id: string;
  name: string;
}

export function SlackConnectionManager({
  connections,
  projects,
  isAdmin,
  connectAction,
  disconnectAction,
}: {
  connections: SlackConnectionRow[];
  projects: SlackProjectOption[];
  isAdmin: boolean;
  connectAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  disconnectAction: (connectionId: string) => void;
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(connectAction, {});

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
                  {projectName ?? "Unknown project"} → #{connection.channel_id}
                </p>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => disconnectAction(connection.id)}
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
        <Card className="p-4 text-sm text-ink-tertiary">No Slack connections configured.</Card>
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
              <Label htmlFor="channelId">Channel ID</Label>
              <Input id="channelId" name="channelId" required placeholder="C0123456789" />
            </div>
            <div>
              <Label htmlFor="botToken">Bot token</Label>
              <Input id="botToken" name="botToken" type="password" required placeholder="xoxb-..." />
            </div>
            {state.error && <p className="text-xs text-fail">{state.error}</p>}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Connecting…" : "Connect Slack"}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 src/components/settings/slack-connection-manager.tsx`
Strip if present.

- [ ] **Step 3: Write the page**

Create `src/app/(app)/settings/integrations/slack/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { SlackConnectionManager } from "@/components/settings/slack-connection-manager";
import { connectSlackNotifications, disconnectSlackNotifications } from "@/lib/actions/slack";

export default async function SlackIntegrationPage() {
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
    .from("slack_connections")
    .select("id, project_id, channel_id, projects(name)")
    .eq("org_id", ctx.activeOrgId);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PageHeader
        title="Slack"
        description="Post a message to a channel when a CI-ingested test run completes."
      />
      <SlackConnectionManager
        connections={connections ?? []}
        projects={projects ?? []}
        isAdmin={isAdmin}
        connectAction={connectSlackNotifications}
        disconnectAction={disconnectSlackNotifications}
      />
    </div>
  );
}
```

- [ ] **Step 4: Check for the stray `</content>` line**

Run: `tail -3 "src/app/(app)/settings/integrations/slack/page.tsx"`
Strip if present.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/settings/slack-connection-manager.tsx "src/app/(app)/settings/integrations/slack/page.tsx"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/slack-connection-manager.tsx "src/app/(app)/settings/integrations/slack/page.tsx"
git commit -m "Add Slack connection manager UI (project picker, connection list)"
```

---

### Task 7: Add Slack to the integrations index page

**Files:**
- Modify: `src/app/(app)/settings/integrations/page.tsx`

- [ ] **Step 1: Add the Slack entry to `PROVIDERS`**

In `src/app/(app)/settings/integrations/page.tsx`, add a `slack` entry (`{ segment: "slack", label: "Slack", description: "Post a message when a CI-ingested test run completes." }`) to the existing `PROVIDERS` array, which currently has only `jira` and `github`.

No other change is needed on this page — `settings/page.tsx`'s "Integrations" card already links to `/settings/integrations` (not directly to Jira), and its description text ("Jira, GitHub, GitLab, Slack, and CI runner connections") already references Slack from the GitHub project — both confirmed unchanged by reading the file.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/(app)/settings/integrations/page.tsx"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/settings/integrations/page.tsx"
git commit -m "Add Slack to the integrations index page"
```

---

### Task 8: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a Slack bullet to "What's implemented"**

Immediately after the existing GitHub bullet, add a bullet describing: one Slack connection per project (Settings > Integrations > Slack, admin-managed, bot token stored in Supabase Vault, `chat:write` scope only); every CI-ingested run completion posts a best-effort message to the connected channel summarizing pass/fail/blocked/skipped counts with a link back to the run; connecting posts a real confirmation message to the channel, validating access end to end.

- [ ] **Step 2: Document `slackNotified` in the CI Integration response example**

Add `"slackNotified": true` to the existing example JSON response alongside `prCommentPosted`. Immediately below the existing `prNumber` paragraph, add a note that independently of `prNumber`, if the project has a connected Slack channel, Meridian posts a message there summarizing the same counts on every run this endpoint ingests, and that like the GitHub PR comment, this never fails the ingest itself.

- [ ] **Step 3: Add a migrations table row**

Immediately after the `0023_pr_feedback_ingestion.sql` row, add a row for `0024_slack_integration.sql` describing `slack_connections` and the four new functions.

- [ ] **Step 4: Add a note to "Explicitly deferred"**

Add: Slack slash commands/interactivity, and any Slack trigger beyond CI-ingested run completion (manual Test Runner completion, issue creation/status change) — outbound-only for this pass.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Document the Slack integration (connection setup, slackNotified field, deferred scope)"
```

---

### Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated verification suite**

```bash
npx tsc --noEmit
```
Expected: no output.

```bash
git ls-files '*.ts' '*.tsx' | xargs npx eslint
```
Expected: no new errors; only the pre-existing accepted `_prevState`/`_formData`-style unused-vars warnings in `src/lib/actions/issue-tracker.ts` plus one new one in `src/lib/actions/slack.ts` (Task 4), all from the same unavoidable `useActionState` signature requirement.

```bash
npm test
```
Expected: all unit tests pass, including the new `src/lib/slack/client.test.ts` (1 test).

```bash
npm run build
```
Expected: production build succeeds; `/settings/integrations/slack` appears in the route list alongside the existing routes.

```bash
git status --short
```
Expected: clean.

- [ ] **Step 2: Confirm the migration applied live**

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select count(*) from slack_connections;
```
Expected: succeeds (table exists), `0` rows (nothing connected yet).

```sql
select routine_name from information_schema.routines
where routine_name in ('create_slack_connection', 'get_slack_bot_token', 'delete_slack_connection', 'api_get_slack_bot_token_for_project');
```
Expected: 4 rows.

- [ ] **Step 3: Manual end-to-end test against a real Slack workspace**

This needs a real Slack app/bot token and a test channel — not available to an automated agent by default. If available:
1. Create a Slack app at api.slack.com/apps (from scratch), add the `chat:write` bot token scope under OAuth & Permissions, install it to a test workspace, copy the Bot User OAuth Token (`xoxb-...`).
2. Create/pick a test channel, invite the bot to it (`/invite @your-bot-name`), copy the channel ID (right-click the channel → View channel details → copy Channel ID at the bottom, or from the channel's URL).
3. Go to Settings > Integrations > Slack in Meridian, connect a test project with that channel ID and bot token. Confirm the connect form succeeds and a "✅ Meridian is now connected..." message appears in the Slack channel.
4. Get a Meridian API key for that project's org (Settings > API Keys) and `POST` to `/api/v1/runs/ingest` with a real API key, a valid `projectId`, and a `results` array; confirm the response includes `"slackNotified": true`, and a new message summarizing the counts with a link back to the run appears in the Slack channel.
5. Disconnect via Settings > Integrations > Slack, repeat step 4, and confirm the response now has `"slackNotified": false` and no new message appears (proving the best-effort path degrades silently rather than erroring).

If no test Slack workspace/token is available, **stop and tell the user this step was skipped** rather than marking it done.

- [ ] **Step 4: Confirm the design spec is fully addressed**

Re-read `docs/superpowers/specs/2026-08-17-slack-integration-design.md`'s 10 scope decisions and confirm each is reflected in the shipped code (see the checklist in the implementation plan's Context, or re-derive it directly from the spec).

- [ ] **Step 5: Commit the plan checkbox updates**

```bash
git add docs/superpowers/plans/2026-08-17-slack-integration.md
git commit -m "docs: mark Slack integration plan complete"
```
