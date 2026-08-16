# Slack Integration (CI Run-Completion Notifications) — Design

**Date**: 2026-08-17
**Status**: Approved, pending implementation
**Context**: Third integration project after Jira (two-way issue sync) and GitHub (two-way issue sync + PR/MR feedback). Unlike both of those, Slack has no issue-tracking concept — this project is purely outbound notifications, riding on the same CI-ingestion hook GitHub's PR feedback already established.

## Problem

A CI-ingested test run completing (`POST /api/v1/runs/ingest`) is currently silent outside of Meridian and, if a GitHub connection exists, a PR comment. Teams that live in Slack have no way to know a run finished without opening Meridian or the PR. `settings/page.tsx`'s own Integrations description ("Jira, GitHub, GitLab, Slack, and CI runner connections") has referenced Slack as a planned integration since the GitHub project.

## Scope decisions

1. **Trigger: CI-ingested run completion only**, inside `POST /api/v1/runs/ingest`, mirroring GitHub's PR-feedback hook exactly. Not manual Test Runner completion, not issue creation/status changes. Smallest possible scope for a first pass — both of those are separate, later trigger points that would need their own scope decisions about noise/frequency.
2. **Auth: bot token via `chat.postMessage`** (`xoxb-...`, `chat:write` scope only), stored in Supabase Vault — the same paste-a-secret UX as Jira's API token / GitHub's PAT, not an Incoming Webhook URL and not a full OAuth "Add to Slack" install flow. Keeps the credential model consistent across all three integrations (one Vault-backed `security definer` function trio) and avoids building Slack app OAuth infrastructure this codebase has never needed before.
3. **New purpose-built table, `slack_connections`, not a reuse of `issue_tracker_connections`.** Slack is not an issue tracker — there's no inbound issue sync, no `webhook_token`, no `jira_*`/`github_*` columns that would apply. Folding it into `issue_tracker_connections` would mean a wider table of mostly-null-for-Slack columns and an `issue_tracker_provider` enum value that lies about what the row actually does. A dedicated table matches this codebase's existing preference for one table per real concern (e.g. `test_runs` vs `test_run_cases`).
4. **Project-scoped, one connection per project** (`unique (project_id)`), not org-scoped. The only trigger is CI-ingested run completion, which is inherently resolved to one project per ingest call (via the API key's org + the request's `projectId`) — there's no cross-project fan-out need that would justify org-scoping the way Jira is.
5. **Channel identified by Slack channel ID (`C0123456789`), not by name.** Resolving a human-friendly name to an ID requires a read scope (`channels:read`/`groups:read`) beyond the locked-in `chat:write`-only auth model (decision 2). The admin copies the channel ID from Slack (right-click channel → View channel details) — same one-field-of-friction trade Jira's `projectKey` and GitHub's `repoOwner`/`repoName` already make.
6. **Connection validation posts a real confirmation message to the channel** (`✅ Meridian is now connected to this channel...`) rather than calling a read-only "does this channel exist" endpoint. This needs only `chat:write` (matching decision 2 exactly, no extra scope), doubles as the connect flow's access check (surfaces the single most common Slack integration mistake — bot token valid but bot not yet invited to the channel — as an actionable error before saving), and gives the admin visible proof the connection works, mirroring the value GitHub's auto-created webhook check provides.
7. **Every completed run posts a new Slack message; no find-and-update-in-place.** GitHub's PR comment updates in place because a PR is a single bounded conversation where a repeated comment would be spam. A Slack channel is a running timeline by nature — a fresh message per run reads as a normal chronological log, not as spam. This also keeps the schema to the minimal shape (no message `ts` needs to be stored/looked up for a later edit).
8. **Posting the Slack message is best-effort and never fails the ingest itself**, exactly like GitHub's PR comment. The ingest response gains a `slackNotified: boolean` field alongside the existing `prCommentPosted`.
9. **No inbound route of any kind.** No Slack slash commands, no interactivity/actions endpoint, no Events API subscription. This is intentionally outbound-only for this pass.
10. **No new `SLACK_`-style global env var.** Confirmed via `.env.local.example`: neither Jira nor GitHub introduced a global app-level credential — both are fully user-supplied per connection via the UI, stored in Vault. Slack follows the same model exactly.

## Schema

New migration `supabase/migrations/0024_slack_integration.sql`:

- New table `slack_connections`: `id, org_id, project_id (unique), channel_id, vault_secret_id, created_by, created_at`. `org_id` is stored redundantly (derived from the project at connect time), matching `issue_tracker_connections`' pattern of keying RLS off a stored `org_id` column rather than a `private.project_org_id(project_id)` subquery on every row check.
- RLS: a single `"admins can manage slack connections"` `for all` policy using `private.is_org_admin(org_id)` — matches `issue_tracker_connections`'s actual policy exactly (single admin-only policy, not admin-manage + member-view). Regular members get access only through `get_slack_bot_token`'s own `is_org_member` check inside a `security definer` function, never direct table SELECT — same asymmetry Jira/GitHub already establish.
- Three `security definer` functions mirroring the Jira/GitHub trio exactly: `create_slack_connection(p_project_id, p_channel_id, p_bot_token)`, `get_slack_bot_token(p_connection_id)`, `delete_slack_connection(p_connection_id)`. Same Vault-secret create/decrypt/delete pattern, same internal `is_org_admin`/`is_org_member` checks (via `private.project_org_id`/stored `org_id`).
- A fourth function, `api_get_slack_bot_token_for_project(p_org_id, p_project_id)`, mirroring `api_get_github_pat_for_project` exactly: service-role-only (never granted to `authenticated`), returns zero rows if no connection exists (not an error), used by the ingest route.
- Unlike Jira's two-migration history (`0017` create → `0018` lock down the accidentally-public execute grant), this migration applies the explicit `revoke all ... from public, anon` / `grant execute ... to authenticated` from the start (the `0004`/`0018` convention), since that gap is already a known, previously-fixed lesson in this codebase — no reason to reintroduce it and fix it in a follow-up.

## Connect / disconnect flow

New Server Actions in `src/lib/actions/slack.ts`, mirroring `connectGithubTracker`/`disconnectGithubTracker`'s shape exactly:

`connectSlackNotifications`:
1. Validate `projectId`, `channelId`, `botToken` are all present.
2. `getUserContext()` — require owner/admin role (same gate as Jira/GitHub connect actions).
3. `rateLimit("connect_slack", 10, 3600)`.
4. `verifySlackBotAccess(botToken, channelId)` — calls Slack's `auth.test` to confirm the token is valid, then posts a real confirmation message to the channel via `chat.postMessage` (scope decision 6). Any failure (invalid token, bot not in channel, wrong workspace) returns before anything is saved.
5. `create_slack_connection` RPC — stores the token in Vault, inserts the row.
6. `revalidatePath("/settings/integrations/slack")`.

`disconnectSlackNotifications(connectionId)`: calls `delete_slack_connection` RPC (cleans up the Vault secret), revalidates the page. No external cleanup call needed (unlike GitHub's webhook `DELETE`) — there's nothing registered on Slack's side to tear down.

## Notification flow

New `src/lib/slack/client.ts`, `"server-only"`, plain-`fetch`-based, mirroring `src/lib/github/client.ts`'s return-union shape (`{ ok: true }` / `{ error: string }`, never throws):
- `verifySlackBotAccess(botToken, channelId)` — `auth.test` then a confirmation `chat.postMessage`.
- `postSlackMessage(connection, text)` — `chat.postMessage`.
- `formatRunNotification(summary)` — pure function building the Slack `mrkdwn` message text (run name, pass/fail/blocked/skipped counts, a link to the run), directly analogous to `prCommentBody` in the GitHub client. Unit-testable without hitting Slack's API.

`POST /api/v1/runs/ingest` (`src/app/api/v1/runs/ingest/route.ts`) gains a new best-effort step after a successful ingest, structurally identical to `tryPostPrComment`: `trySendSlackNotification()`, wrapped in try/catch, looks up the project's Slack connection via `api_get_slack_bot_token_for_project`, builds the same counts already assembled for the PR comment (factored into a shared `countResultsByStatus` helper to avoid computing them twice in one request), and posts via `postSlackMessage`. Contributes `slackNotified: boolean` to the response. Never changes the response status; never fails the ingest.

Slack's Web API returns HTTP 200 even for auth/permission failures — the real signal is the JSON body's `ok` boolean and `error` code (per Slack's own API docs). Every client function checks that field, not `response.ok`.

## Explicitly out of scope

- Slack slash commands, interactivity/actions, or any Events API subscription (scope decision 9) — outbound-only for this pass, no inbound webhook route.
- Triggering on manual Test Runner completion or on issue creation/status change (scope decision 1) — CI-ingested run completion only.
- Incoming Webhook URL auth model (scope decision 2) — bot token only.
- A full "Add to Slack" OAuth install flow — bot token is pasted manually, same as Jira's API token / GitHub's PAT.
- Multiple Slack connections / multiple channels per project — one connection per project, enforced by `unique (project_id)`.
- Resolving/searching channel names — channel ID only (scope decision 5).
- Editing/updating a previously-posted message on re-run (scope decision 7) — GitHub's PR-comment marker/update trick has no Slack equivalent in this pass.
- Rich Block Kit message layouts — plain `mrkdwn` text, matching the plainness of GitHub's PR comment body.

## Open items

- If a future pass wants channel *name* display (nicer UI than a raw ID), it will need the `channels:read`/`groups:read` scopes added to the connect instructions — deliberately deferred per scope decision 5.
- If Slack rate-limits `chat.postMessage` under heavy CI load, `trySendSlackNotification`'s try/catch already swallows that as a silent `slackNotified: false` — no retry/backoff is implemented in this pass, matching GitHub's PR comment treatment of its own failures.

## Testing

`formatRunNotification` is pure and unit-testable (fixed input → fixed string), matching how `verifyGithubSignature` is tested in the GitHub project. Everything that talks to Slack's actual API (`auth.test`, `chat.postMessage`) is verified manually against a real (test) Slack app/workspace, matching how Jira and GitHub were both verified — no integration test harness exists yet for external-API-authenticated flows.
