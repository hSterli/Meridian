# Two-Way Jira Issue Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Note for this repo**: neither named sub-skill is installed here — execute via a fresh general-purpose subagent per task, with the orchestrator reviewing each task's actual diff before dispatching the next (same approach used for the two prior plans this session).

**Goal:** Let an org connect a Jira Cloud project, push a Meridian issue to Jira on demand, keep status in sync both ways, and record sync failures visibly instead of silently.

**Architecture:** One `issue_tracker_connections` row per org holds the Jira base URL, account email, and a reference to the actual API token stored in Supabase Vault (reversible encryption, unlike Meridian's own hashed `api_keys`, because this token must be retrievable to call Jira's API). `issue_tracker_links` maps a Meridian issue to a Jira issue key/id. Meridian→Jira calls go straight to Jira's REST API from Server Actions (create on "Send to Jira", status-transition on status change). Jira→Meridian arrives via a **dedicated** webhook route (`/api/v1/webhooks/jira`, not the generic HMAC-signed `[source]` scaffold — Jira Cloud doesn't support HMAC signing, only a static URL, so this route validates a per-connection token embedded in the webhook URL's query string instead) that still logs into the shared `webhook_events` table for a consistent audit trail.

**Tech Stack:** Next.js 16 Route Handlers + Server Actions, Supabase (Postgres/RLS/Vault), TypeScript, native `fetch` for Jira's REST API v3. This repo has no automated test runner — every task substitutes `npx tsc --noEmit` / `npx eslint <file>` / a final `npm run build` + Supabase advisors check, the same substitution used in both prior plans this session.

**Known repo quirk to watch for:** every `Write` tool call in this project has a history of appending a stray literal `</content>` line at the end of the file. After every `Write` call below, run `tail -3 <file>` to check for it and strip it with `sed -i '' -e '/^<\/content>$/d' <file>` if present, before moving on.

**Two gaps the approved design left implicit, resolved here (not scope creep — necessary to make the design buildable):**
1. **Which Jira project do created issues go into?** The design describes one connection per org but never says which Jira project new issues are created under. Resolved: `issue_tracker_connections` gets a `jira_project_key` column (e.g. `PROJ`) — one Jira project per org connection for this pass, matching the design's other "narrower first version" choices (fixed issue type "Task", fixed severity↔priority map).
2. **How does the webhook route know which org/connection a Jira webhook belongs to?** Resolved: `issue_tracker_connections` gets a `webhook_token` column (unique, generated at connection time, shown in the setup UI as part of the webhook URL to paste into Jira: `.../api/v1/webhooks/jira?token=<token>`). The route looks up the connection by this token — it doubles as both the URL discriminator and the request's authenticity check.

---

### Task 1: Migration — `issue_tracker_connections`, `issue_tracker_links`, and Vault-backed token functions

**Files:**
- Create: `supabase/migrations/0017_issue_tracker_jira_sync.sql`

- [x] **Step 1: Write the migration**

```sql
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
```

- [x] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`, `name: "issue_tracker_jira_sync"`, and the SQL above as `query`.

- [x] **Step 3: Verify**

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select relname, relrowsecurity from pg_class where relname in ('issue_tracker_connections', 'issue_tracker_links');
select proname from pg_proc where proname in ('create_jira_connection', 'get_jira_api_token', 'delete_jira_connection');
```

Expected: two rows for the first query, both `relrowsecurity = true`; three rows for the second.

Also sanity-check Vault is reachable:

```sql
select vault.create_secret('test-value', 'plan-verification-test');
```

Expected: succeeds, returns a UUID. (No need to clean this up — it's a throwaway verification secret with no `issue_tracker_connections` row referencing it.)

- [x] **Step 4: Run the security advisor check**

Use the Supabase MCP `get_advisors` tool with `type: "security"` against `ucnfcsosbdgknmzyuqbw`. Expected: the same baseline as before (`rate_limit_buckets`/`webhook_events` RLS-no-policy INFOs, three pre-existing SECURITY DEFINER WARNs, leaked-password-protection WARN) — **plus new, expected** warnings that `create_jira_connection`, `get_jira_api_token`, and `delete_jira_connection` are "signed-in users can execute" SECURITY DEFINER functions. Unlike Task 1 of the prior API/webhook plan, **this is expected and correct here**, not a hard stop — these three functions are deliberately granted to `authenticated` because they serve real logged-in admin/member users, not API-key requests, and each does its own internal `is_org_admin`/`is_org_member` check precisely because it bypasses RLS via Vault access.

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/0017_issue_tracker_jira_sync.sql
git commit -m "Add issue_tracker_connections/links and Vault-backed Jira token functions"
```

**Post-Task-1 fix (found during execution, not anticipated by this plan):** the advisor check also surfaced `anon_security_definer_function_executable` warnings for all three new functions — 0017 granted `authenticated` but never explicitly revoked the default `PUBLIC` execute grant, leaving `anon` with access too. Functionally inert (each function's internal `is_org_admin`/`is_org_member` check fails closed when `auth.uid()` is null), but fixed anyway via a follow-up `0018_lock_down_jira_functions.sql` migration (`revoke all ... from public, anon` before re-granting to `authenticated`), matching this codebase's established defense-in-depth convention (see `0004_lock_down_function_execute.sql`). Re-ran `get_advisors` afterward and confirmed the `anon_*` warnings are gone, leaving only the expected `authenticated_*` ones. Committed as `dd9601e`.

---

### Task 2: Regenerate and merge TypeScript types

**Files:**
- Modify: `src/lib/types/database.ts`

- [x] **Step 1: Regenerate types**

Use the Supabase MCP `generate_typescript_types` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`.

- [x] **Step 2: Hand-merge the two new table types and the enum**

Following the exact process used in the two prior plans this session (do not blindly overwrite — preserve the hand-written convenience aliases at the bottom of the file): add `issue_tracker_connections` and `issue_tracker_links` to the `Tables` block (alphabetical position: both sort before `issues`), add `issue_tracker_provider: "jira"` to the `Enums` block and to `Constants`, and add the three new function entries (`create_jira_connection`, `get_jira_api_token`, `delete_jira_connection`) to the `Functions` block. Compare against the real `generate_typescript_types` output rather than hand-guessing exact shapes — the prior plan's Task 2 found the generator alphabetizes `Functions` entries and their `Args` keys, and adds `SetofOptions` for `setof`-returning functions; apply the same fidelity here.

**Found during execution:** `delete_jira_connection` returns `void` in SQL but the real generator types that as `Returns: undefined`, not `Returns: void` — matched the real output. Also, the live generator now emits a `SetofOptions` block for the pre-existing `create_organization_with_owner` function (`isOneToOne: true, isSetofReturn: false`, since it returns a single row) that the previously-committed file was missing; added it for fidelity with the real output even though it's outside this task's stated table/enum/function additions.

- [x] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

- [x] **Step 4: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "Regenerate types for issue_tracker_connections, issue_tracker_links"
```

---

### Task 3: Jira REST API client

**Files:**
- Create: `src/lib/jira/client.ts`

- [x] **Step 1: Write the client**

```ts
import "server-only";

export interface JiraConnectionCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

const PRIORITY_MAP: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Highest",
};

// Jira workflow status names vary per project/workflow, so this tries a
// short list of common candidate names per Meridian status rather than
// assuming one exact name. If none match, the caller surfaces an error
// instead of guessing wrong — see transitionJiraIssueStatus below.
const STATUS_TRANSITION_CANDIDATES: Record<string, string[]> = {
  open: ["To Do", "Open", "Backlog"],
  in_progress: ["In Progress", "In Review"],
  resolved: ["Done", "Resolved"],
  closed: ["Done", "Closed"],
};

function authHeader(email: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
}

// Jira Cloud's REST API v3 requires descriptions in Atlassian Document
// Format (a structured JSON doc format), not plain text.
function toADF(text: string) {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: text || " " }] }],
  };
}

export async function createJiraIssue(
  connection: JiraConnectionCredentials,
  title: string,
  description: string,
  severity: string
): Promise<{ key: string; id: string } | { error: string }> {
  const response = await fetch(`${connection.baseUrl}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: authHeader(connection.email, connection.apiToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        project: { key: connection.projectKey },
        summary: title,
        description: toADF(description),
        issuetype: { name: "Task" },
        priority: { name: PRIORITY_MAP[severity] ?? "Medium" },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { error: `Jira create failed (${response.status}): ${body}` };
  }

  const data = (await response.json()) as { key: string; id: string };
  return { key: data.key, id: data.id };
}

export async function updateJiraIssueFields(
  connection: JiraConnectionCredentials,
  issueKey: string,
  title: string,
  description: string,
  severity: string
): Promise<{ error?: string }> {
  const response = await fetch(`${connection.baseUrl}/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    headers: {
      Authorization: authHeader(connection.email, connection.apiToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        summary: title,
        description: toADF(description),
        priority: { name: PRIORITY_MAP[severity] ?? "Medium" },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { error: `Jira update failed (${response.status}): ${body}` };
  }

  return {};
}

export async function transitionJiraIssueStatus(
  connection: JiraConnectionCredentials,
  issueKey: string,
  meridianStatus: string
): Promise<{ error?: string }> {
  const candidates = STATUS_TRANSITION_CANDIDATES[meridianStatus] ?? [];

  const transitionsResponse = await fetch(
    `${connection.baseUrl}/rest/api/3/issue/${issueKey}/transitions`,
    { headers: { Authorization: authHeader(connection.email, connection.apiToken) } }
  );

  if (!transitionsResponse.ok) {
    const body = await transitionsResponse.text();
    return { error: `Could not fetch Jira transitions (${transitionsResponse.status}): ${body}` };
  }

  const { transitions } = (await transitionsResponse.json()) as {
    transitions: { id: string; to: { name: string } }[];
  };

  const match = transitions.find((t) =>
    candidates.some((c) => c.toLowerCase() === t.to.name.toLowerCase())
  );

  if (!match) {
    return {
      error: `No matching Jira transition found for status "${meridianStatus}" (tried: ${candidates.join(", ")}).`,
    };
  }

  const applyResponse = await fetch(
    `${connection.baseUrl}/rest/api/3/issue/${issueKey}/transitions`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(connection.email, connection.apiToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transition: { id: match.id } }),
    }
  );

  if (!applyResponse.ok) {
    const body = await applyResponse.text();
    return { error: `Jira transition failed (${applyResponse.status}): ${body}` };
  }

  return {};
}
```

- [x] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/jira/client.ts`
Expected: no output.

- [x] **Step 3: Commit**

```bash
git add src/lib/jira/client.ts
git commit -m "Add Jira REST API client (create/update issue, status transitions)"
```

---

### Task 4: Server Actions for connecting/disconnecting Jira and sending an issue

**Files:**
- Create: `src/lib/actions/issue-tracker.ts`

- [x] **Step 1: Write the actions**

```ts
"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import { createJiraIssue } from "@/lib/jira/client";
import type { ActionState } from "@/lib/actions/auth";

export interface JiraConnectionActionState extends ActionState {
  webhookUrl?: string;
}

export async function connectJiraTracker(
  orgId: string,
  _prevState: JiraConnectionActionState,
  formData: FormData
): Promise<JiraConnectionActionState> {
  const baseUrl = String(formData.get("baseUrl") ?? "").trim().replace(/\/$/, "");
  const email = String(formData.get("email") ?? "").trim();
  const apiToken = String(formData.get("apiToken") ?? "").trim();
  const projectKey = String(formData.get("projectKey") ?? "").trim();

  if (!baseUrl || !email || !apiToken || !projectKey) {
    return { error: "All fields are required." };
  }

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can connect an issue tracker." };
  }

  const limitError = await rateLimit("connect_issue_tracker", 10, 3600);
  if (limitError) return { error: limitError };

  const webhookToken = randomBytes(24).toString("base64url");
  const supabase = await createClient();

  const { data: connectionId, error } = await supabase.rpc("create_jira_connection", {
    p_org_id: orgId,
    p_base_url: baseUrl,
    p_email: email,
    p_token: apiToken,
    p_webhook_token: webhookToken,
    p_project_key: projectKey,
  });

  if (error || !connectionId) return { error: error?.message ?? "Could not save connection." };

  revalidatePath("/settings/integrations/jira");
  return {
    webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/v1/webhooks/jira?token=${webhookToken}`,
  };
}

export async function disconnectJiraTracker(connectionId: string) {
  const supabase = await createClient();
  await supabase.rpc("delete_jira_connection", { p_connection_id: connectionId });
  revalidatePath("/settings/integrations/jira");
}

export async function sendIssueToJira(
  projectId: string,
  issueId: string,
  connectionId: string,
  _prevState: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("send_issue_to_jira", 30, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const { data: connection } = await supabase
    .from("issue_tracker_connections")
    .select("jira_base_url, jira_email, jira_project_key")
    .eq("id", connectionId)
    .single();
  if (!connection) return { error: "Connection not found." };

  const { data: apiToken } = await supabase.rpc("get_jira_api_token", {
    p_connection_id: connectionId,
  });
  if (!apiToken) return { error: "Could not retrieve Jira credentials." };

  const { data: issue } = await supabase
    .from("issues")
    .select("title, description, severity")
    .eq("id", issueId)
    .single();
  if (!issue) return { error: "Issue not found." };

  const result = await createJiraIssue(
    {
      baseUrl: connection.jira_base_url,
      email: connection.jira_email,
      apiToken,
      projectKey: connection.jira_project_key,
    },
    issue.title,
    issue.description ?? "",
    issue.severity
  );

  if ("error" in result) return { error: result.error };

  const { error: linkError } = await supabase.from("issue_tracker_links").insert({
    issue_id: issueId,
    connection_id: connectionId,
    external_issue_key: result.key,
    external_issue_id: result.id,
    external_updated_at: new Date().toISOString(),
  });

  if (linkError) return { error: linkError.message };

  revalidatePath(`/projects/${projectId}/issues/${issueId}`);
  return {};
}
```

Note: `disconnectJiraTracker` doesn't take an `orgId` parameter (unlike the plan's earlier drafts of similar actions) — `delete_jira_connection` already does its own `is_org_admin` check internally against the connection's own `org_id`, so there's nothing left for the caller to additionally scope by.

- [x] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/issue-tracker.ts`
Expected: no output.

- [x] **Step 3: Commit**

```bash
git add src/lib/actions/issue-tracker.ts
git commit -m "Add Server Actions for Jira connection management and sending issues"
```

---

### Task 5: Wire Jira status sync into `updateIssueStatus`

**Files:**
- Modify: `src/lib/actions/issues.ts`

- [x] **Step 1: Add the import**

Change:
```ts
import { rateLimit } from "@/lib/rate-limit";
import type { IssueSeverity, IssueStatus } from "@/lib/types/database";
```
to:
```ts
import { rateLimit } from "@/lib/rate-limit";
import { transitionJiraIssueStatus } from "@/lib/jira/client";
import type { IssueSeverity, IssueStatus } from "@/lib/types/database";
```

- [x] **Step 2: Extend `updateIssueStatus`**

Change:
```ts
export async function updateIssueStatus(projectId: string, issueId: string, status: IssueStatus) {
  const supabase = await createClient();
  await supabase
    .from("issues")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", issueId);
  revalidatePath(`/projects/${projectId}/issues/${issueId}`);
  revalidatePath(`/projects/${projectId}/issues`);
}
```
to:
```ts
export async function updateIssueStatus(projectId: string, issueId: string, status: IssueStatus) {
  const supabase = await createClient();
  await supabase
    .from("issues")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", issueId);

  // If this issue is linked to Jira, push the status change there too.
  // Meridian's own save above already succeeded regardless of what
  // happens next — a Jira-side failure is recorded, not allowed to fail
  // the Meridian update.
  const { data: link } = await supabase
    .from("issue_tracker_links")
    .select(
      "id, external_issue_key, connection_id, issue_tracker_connections(jira_base_url, jira_email, jira_project_key)"
    )
    .eq("issue_id", issueId)
    .maybeSingle();

  if (link) {
    const connection = Array.isArray(link.issue_tracker_connections)
      ? link.issue_tracker_connections[0]
      : link.issue_tracker_connections;

    if (connection) {
      const { data: apiToken } = await supabase.rpc("get_jira_api_token", {
        p_connection_id: link.connection_id,
      });

      if (apiToken) {
        const result = await transitionJiraIssueStatus(
          {
            baseUrl: connection.jira_base_url,
            email: connection.jira_email,
            apiToken,
            projectKey: connection.jira_project_key,
          },
          link.external_issue_key,
          status
        );

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

This is the only Meridian-side mutation that needs to trigger an outbound Jira sync — `createIssue` deliberately doesn't push to Jira automatically (linking is opt-in via "Send to Jira" on an existing issue, built in Task 4/7), and there's no generic "edit issue title/description" action in this app yet to also wire up.

- [x] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/issues.ts`
Expected: no output.

- [x] **Step 4: Commit**

```bash
git add src/lib/actions/issues.ts
git commit -m "Push status changes to a linked Jira issue"
```

---

### Task 6: Dedicated Jira webhook receiver

**Files:**
- Create: `src/app/api/v1/webhooks/jira/route.ts`

- [x] **Step 1: Write the route**

```ts
import { createServiceClient } from "@/lib/supabase/service";

// Jira's own workflow status names vary per project, so incoming webhook
// status names are matched case-insensitively against this fixed set of
// common defaults. A name that doesn't match anything here is simply not
// applied — better than guessing wrong.
const STATUS_FROM_JIRA: Record<string, string> = {
  "to do": "open",
  open: "open",
  backlog: "open",
  "in progress": "in_progress",
  "in review": "in_progress",
  done: "resolved",
  resolved: "resolved",
  closed: "closed",
};

interface JiraWebhookPayload {
  issue?: {
    id: string;
    key: string;
    fields?: {
      status?: { name: string };
      updated?: string;
    };
  };
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const rawBody = await request.text();

  const supabase = createServiceClient();

  const { data: connection } = token
    ? await supabase
        .from("issue_tracker_connections")
        .select("id, org_id")
        .eq("webhook_token", token)
        .maybeSingle()
    : { data: null };

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  // Stored regardless of validity, same audit-trail principle as the
  // generic webhook scaffold — an invalid token still leaves a record.
  await supabase.from("webhook_events").insert({
    source: "jira",
    org_id: connection?.org_id ?? null,
    payload: payload as never,
    signature_valid: Boolean(connection),
  });

  if (!connection) {
    return Response.json({ error: "Invalid webhook token." }, { status: 401 });
  }

  const jiraPayload = payload as JiraWebhookPayload;
  const externalIssueId = jiraPayload.issue?.id;
  if (!externalIssueId) {
    return Response.json({ status: "ignored" });
  }

  const { data: link } = await supabase
    .from("issue_tracker_links")
    .select("id, issue_id, external_updated_at")
    .eq("external_issue_id", externalIssueId)
    .eq("connection_id", connection.id)
    .maybeSingle();

  if (!link) {
    return Response.json({ status: "ignored" });
  }

  const jiraUpdatedAt = jiraPayload.issue?.fields?.updated
    ? new Date(jiraPayload.issue.fields.updated)
    : null;
  const lastSyncedAt = link.external_updated_at ? new Date(link.external_updated_at) : null;

  // Last-write-wins: if Jira's own reported update time is not newer than
  // what we last synced, this is a stale/duplicate delivery — ignore it.
  if (jiraUpdatedAt && lastSyncedAt && jiraUpdatedAt.getTime() <= lastSyncedAt.getTime()) {
    return Response.json({ status: "stale, ignored" });
  }

  const jiraStatusName = jiraPayload.issue?.fields?.status?.name?.toLowerCase();
  const mappedStatus = jiraStatusName ? STATUS_FROM_JIRA[jiraStatusName] : undefined;

  if (mappedStatus) {
    await supabase
      .from("issues")
      .update({ status: mappedStatus, updated_at: new Date().toISOString() })
      .eq("id", link.issue_id);
  }

  await supabase
    .from("issue_tracker_links")
    .update({
      external_updated_at: jiraUpdatedAt?.toISOString() ?? new Date().toISOString(),
    })
    .eq("id", link.id);

  return Response.json({ status: "received" });
}
```

- [x] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/api/v1/webhooks/jira/route.ts"`
Expected: no output.

- [x] **Step 3: Commit**

```bash
git add "src/app/api/v1/webhooks/jira/route.ts"
git commit -m "Add dedicated Jira webhook receiver"
```

---

### Task 7: Jira connection settings UI

**Files:**
- Create: `src/components/settings/jira-connection-manager.tsx`
- Create: `src/app/(app)/settings/integrations/jira/page.tsx`

- [x] **Step 1: Write the manager component**

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { JiraConnectionActionState } from "@/lib/actions/issue-tracker";

export interface JiraConnectionRow {
  id: string;
  jira_base_url: string;
  jira_email: string;
  jira_project_key: string;
}

export function JiraConnectionManager({
  connection,
  isAdmin,
  connectAction,
  disconnectAction,
}: {
  connection: JiraConnectionRow | null;
  isAdmin: boolean;
  connectAction: (
    prevState: JiraConnectionActionState,
    formData: FormData
  ) => Promise<JiraConnectionActionState>;
  disconnectAction: () => void;
}) {
  const [state, formAction, isPending] = useActionState<JiraConnectionActionState, FormData>(
    connectAction,
    {}
  );

  if (connection) {
    return (
      <Card className="p-4">
        <p className="text-sm font-medium text-ink-primary">Connected to {connection.jira_base_url}</p>
        <p className="text-xs text-ink-tertiary">
          Project {connection.jira_project_key} · {connection.jira_email}
        </p>
        {isAdmin && (
          <button
            type="button"
            onClick={() => disconnectAction()}
            className="mt-2 text-xs font-medium text-fail hover:underline"
          >
            Disconnect
          </button>
        )}
      </Card>
    );
  }

  if (!isAdmin) {
    return <Card className="p-4 text-sm text-ink-tertiary">No Jira connection configured.</Card>;
  }

  if (state.webhookUrl) {
    return (
      <Card className="border-primary/30 bg-meridian-soft/40 p-4">
        <p className="text-sm font-semibold text-ink-primary">Connected! One more step:</p>
        <p className="mt-1 text-sm text-ink-secondary">
          In Jira, go to Settings → System → WebHooks and add this URL, filtered to Issue
          created/updated events:
        </p>
        <code className="mt-2 block break-all rounded-md bg-white px-3 py-2 text-xs">
          {state.webhookUrl}
        </code>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <form action={formAction} className="space-y-3">
        <div>
          <Label htmlFor="baseUrl">Jira URL</Label>
          <Input id="baseUrl" name="baseUrl" required placeholder="https://yourcompany.atlassian.net" />
        </div>
        <div>
          <Label htmlFor="email">Account email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div>
          <Label htmlFor="apiToken">API token</Label>
          <Input id="apiToken" name="apiToken" type="password" required />
        </div>
        <div>
          <Label htmlFor="projectKey">Jira project key</Label>
          <Input id="projectKey" name="projectKey" required placeholder="PROJ" />
        </div>
        {state.error && <p className="text-xs text-fail">{state.error}</p>}
        <Button type="submit" disabled={isPending}>
          {isPending ? "Connecting…" : "Connect Jira"}
        </Button>
      </form>
    </Card>
  );
}
```

- [x] **Step 2: Write the page**

```tsx
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { JiraConnectionManager } from "@/components/settings/jira-connection-manager";
import { connectJiraTracker, disconnectJiraTracker } from "@/lib/actions/issue-tracker";

export default async function JiraIntegrationPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const isAdmin = ctx.activeRole === "owner" || ctx.activeRole === "admin";
  const supabase = await createClient();

  const { data: connection } = await supabase
    .from("issue_tracker_connections")
    .select("id, jira_base_url, jira_email, jira_project_key")
    .eq("org_id", ctx.activeOrgId)
    .eq("provider", "jira")
    .maybeSingle();

  const connectAction = connectJiraTracker.bind(null, ctx.activeOrgId);
  const disconnectAction = connection
    ? disconnectJiraTracker.bind(null, connection.id)
    : async () => {};

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PageHeader title="Jira" description="Two-way sync between Meridian issues and Jira." />
      <JiraConnectionManager
        connection={connection ?? null}
        isAdmin={isAdmin}
        connectAction={connectAction}
        disconnectAction={disconnectAction}
      />
    </div>
  );
}
```

- [x] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/settings/jira-connection-manager.tsx "src/app/(app)/settings/integrations/jira/page.tsx"`
Expected: no output.

- [x] **Step 4: Commit**

```bash
git add src/components/settings/jira-connection-manager.tsx "src/app/(app)/settings/integrations/jira/page.tsx"
git commit -m "Add Jira connection settings page"
```

---

### Task 8: Make "Integrations" a real link in Settings

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`

- [x] **Step 1: Move "Integrations" out of the stub array into a real link**

Change:
```tsx
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
          {
            icon: Building2,
            title: "Organization",
            description: "Name, slug, and workspace-wide defaults.",
          },
          {
            icon: Plug,
            title: "Integrations",
            description: "Jira, GitHub, GitLab, Slack, and CI runner connections.",
          },
          {
            icon: CreditCard,
            title: "Billing",
            description: "Plan, seats, and payment details.",
          },
        ].map((s) => (
```
to:
```tsx
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

        <Link
          href="/settings/integrations/jira"
          className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-paper-surface"
        >
          <div className="rounded-lg bg-meridian-soft p-2 text-primary">
            <Plug size={18} />
          </div>
          <div className="flex-1">
            <p className="font-ui-label font-semibold text-ink-primary">Integrations</p>
            <p className="text-sm text-ink-secondary">Connect Jira to sync issues two-way.</p>
          </div>
          <ChevronRight size={18} className="text-ink-tertiary" />
        </Link>

        {[
          {
            icon: Building2,
            title: "Organization",
            description: "Name, slug, and workspace-wide defaults.",
          },
          {
            icon: CreditCard,
            title: "Billing",
            description: "Plan, seats, and payment details.",
          },
        ].map((s) => (
```

(`Plug` is already imported at the top of this file from the stub-array days — no import change needed, just check it's still used after this edit, which it is.)

- [x] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/(app)/settings/page.tsx"`
Expected: no output — specifically confirm no "unused import" warning for `Plug` (it's still used in the new Link).

- [x] **Step 3: Commit**

```bash
git add "src/app/(app)/settings/page.tsx"
git commit -m "Make Integrations a real link to Jira settings"
```

---

### Task 9: "Send to Jira" and sync status on the issue detail page

**Files:**
- Modify: `src/app/(app)/projects/[projectId]/issues/[issueId]/page.tsx`

- [ ] **Step 1: Fetch the org's Jira connection and this issue's link**

Change:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { updateIssueStatus, deleteIssue } from "@/lib/actions/issues";
import type { IssueStatus } from "@/lib/types/database";

const STATUSES: IssueStatus[] = ["open", "in_progress", "resolved", "closed"];

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; issueId: string }>;
}) {
  const { projectId, issueId } = await params;
  const supabase = await createClient();

  const { data: issue } = await supabase
    .from("issues")
    .select("*, test_cases(id, title)")
    .eq("id", issueId)
    .single();

  if (!issue) notFound();

  const deleteAction = deleteIssue.bind(null, projectId, issueId);
```
to:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { updateIssueStatus, deleteIssue } from "@/lib/actions/issues";
import { sendIssueToJira } from "@/lib/actions/issue-tracker";
import { SendToJiraForm } from "@/components/issues/send-to-jira-form";
import type { IssueStatus } from "@/lib/types/database";

const STATUSES: IssueStatus[] = ["open", "in_progress", "resolved", "closed"];

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; issueId: string }>;
}) {
  const { projectId, issueId } = await params;
  const supabase = await createClient();

  const { data: issue } = await supabase
    .from("issues")
    .select("*, test_cases(id, title)")
    .eq("id", issueId)
    .single();

  if (!issue) notFound();

  const { data: project } = await supabase
    .from("projects")
    .select("org_id")
    .eq("id", projectId)
    .single();

  const { data: connection } = project
    ? await supabase
        .from("issue_tracker_connections")
        .select("id, jira_base_url")
        .eq("org_id", project.org_id)
        .eq("provider", "jira")
        .maybeSingle()
    : { data: null };

  const { data: link } = await supabase
    .from("issue_tracker_links")
    .select("external_issue_key, last_sync_error")
    .eq("issue_id", issueId)
    .maybeSingle();

  const deleteAction = deleteIssue.bind(null, projectId, issueId);
  const sendToJiraAction = connection
    ? sendIssueToJira.bind(null, projectId, issueId, connection.id)
    : null;
```

- [ ] **Step 2: Render the Jira status/action block**

Insert a new block right after the "Linked test case" paragraph and before the "Status" heading:

Change:
```tsx
        {issue.test_cases && (
          <p className="mb-4 text-sm text-ink-tertiary">
            Linked test case:{" "}
            <Link
              href={`/projects/${projectId}/test-cases/${issue.test_cases.id}`}
              className="font-medium text-primary"
            >
              {issue.test_cases.title}
            </Link>
          </p>
        )}

        <div className="mb-2 text-sm font-medium text-ink-secondary">Status</div>
```
to:
```tsx
        {issue.test_cases && (
          <p className="mb-4 text-sm text-ink-tertiary">
            Linked test case:{" "}
            <Link
              href={`/projects/${projectId}/test-cases/${issue.test_cases.id}`}
              className="font-medium text-primary"
            >
              {issue.test_cases.title}
            </Link>
          </p>
        )}

        {link ? (
          <p className="mb-4 text-sm text-ink-tertiary">
            Synced to Jira:{" "}
            <a
              href={`${connection?.jira_base_url}/browse/${link.external_issue_key}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary"
            >
              {link.external_issue_key}
            </a>
            {link.last_sync_error && (
              <span className="ml-2 text-fail">Last sync failed: {link.last_sync_error}</span>
            )}
          </p>
        ) : (
          sendToJiraAction && <SendToJiraForm action={sendToJiraAction} />
        )}

        <div className="mb-2 text-sm font-medium text-ink-secondary">Status</div>
```

- [ ] **Step 3: Write the small client component `SendToJiraForm`**

A separate tiny client component is needed because `useActionState` requires a Client Component, but the issue detail page itself is a Server Component.

Create `src/components/issues/send-to-jira-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/actions/auth";

export function SendToJiraForm({
  action,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="mb-4">
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Sending…" : "Send to Jira"}
      </Button>
      {state.error && <p className="mt-1 text-xs text-fail">{state.error}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/issues/send-to-jira-form.tsx "src/app/(app)/projects/[projectId]/issues/[issueId]/page.tsx"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/components/issues/send-to-jira-form.tsx "src/app/(app)/projects/[projectId]/issues/[issueId]/page.tsx"
git commit -m "Add Send to Jira action and sync status to the issue detail page"
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/build-status.md`

- [ ] **Step 1: Update README**

Read the current migration table (don't assume the last row's number — it has drifted from plan expectations in both prior plans) and add a row for `0017_issue_tracker_jira_sync.sql`. Add a bullet under "What's implemented" for two-way Jira issue sync. Update the "Explicitly deferred" list: remove/narrow "Jira/GitHub/GitLab two-way issue sync" to reflect that Jira specifically now works, with GitHub/GitLab still deferred.

- [ ] **Step 2: Update `docs/build-status.md`**

Add a "Two-way Jira issue sync" subsection under "1. Shipped and working" (mirroring the style of the existing "Public API & webhooks" subsection added by the prior project). In "§3. Explicitly deferred," narrow the "Jira/GitHub/GitLab two-way issue sync" bullet the same way as README — Jira is done, GitHub/GitLab remain.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/build-status.md
git commit -m "Document two-way Jira issue sync"
```

---

### Task 11: Full verification pass

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 2: Lint the whole repo**

Run: `npx eslint .`
Expected: no output.

- [ ] **Step 3: Production build**

Check for and kill any leftover `next-server` process on port 3000 first (`lsof -i :3000 -sTCP:LISTEN -t`, confirm with `ps -p <pid> -o pid,command`, then kill).

Run: `npm run build`
Expected: `✓ Compiled successfully`, with `/settings/integrations/jira` and `/api/v1/webhooks/jira` listed among the routes.

- [ ] **Step 4: Supabase security advisor check**

Use the Supabase MCP `get_advisors` tool with `type: "security"` against `ucnfcsosbdgknmzyuqbw`. Expected: the baseline confirmed in Task 1 Step 4 (including the three *expected* new SECURITY DEFINER warnings for the Jira connection functions) — nothing beyond that.

- [ ] **Step 5: Browser smoke test**

`preview_start` with `{name: "meridian-dev"}`, navigate to `/settings/integrations/jira`. Expected: clean redirect to `/login`, no console errors, no server errors in `preview_logs`. Stop the preview server and kill any leftover `next-server` process afterward.

- [ ] **Step 6: Write out manual testing instructions**

This needs a real Jira Cloud site to test against, which only the user has. Produce (in the final report, not a file) instructions along these lines:

```
Before testing, you need:
- A Jira Cloud site you can create issues in.
- An API token from https://id.atlassian.com/manage-profile/security/api-tokens.
- Your Jira project's key (visible in Jira issue keys, e.g. "PROJ" in "PROJ-123").

1. Log in to Meridian, go to Settings > Integrations, click through to Jira.
2. Fill in your Jira URL (https://yourcompany.atlassian.net), account email,
   API token, and project key. Click "Connect Jira."
3. Copy the webhook URL shown. In Jira: Settings (gear icon) > System >
   WebHooks > Create a WebHook. Paste the URL, name it anything, and check
   "Issue: created" and "Issue: updated" under events. Save.
4. In Meridian, open any existing issue (or create one) and click
   "Send to Jira." Confirm a new issue appears in your Jira project, and
   the Meridian issue now shows "Synced to Jira: PROJ-XXX" with a working
   link.
5. Change the Meridian issue's status (e.g. to "In Progress"). Refresh the
   Jira issue — its status should have transitioned to match (exact Jira
   status name depends on your project's workflow; if nothing happens,
   check the Meridian issue page for a "Last sync failed" message, which
   means your workflow's status names didn't match the built-in candidate
   list in src/lib/jira/client.ts's STATUS_TRANSITION_CANDIDATES).
6. In Jira, change the issue's status yourself. Within a few seconds
   (Jira's webhook delivery isn't instant), refresh the Meridian issue —
   its status should update to match, via the inbound webhook.
7. Query webhook_events via Supabase SQL editor or MCP execute_sql
   (select * from webhook_events where source = 'jira' order by
   received_at desc limit 5;) to see the raw payloads that arrived.
```

- [ ] **Step 7: Final commit if any verification step required fixes**

If any step required a code fix, commit it now describing what was fixed. If everything passed clean, there's nothing to commit — the tree should already be clean from Task 10.
