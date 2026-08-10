# GitHub Integration + PR/MR Integrated Feedback — Design

**Date**: 2026-08-10
**Status**: Approved, pending implementation
**Context**: Second of six sequenced projects addressing the remaining "must have" and TestRail-differentiator gaps identified from a competitive feature checklist. Item 1 (CI-triggered run ingestion, task #38) shipped first and is a direct dependency here — PR feedback rides on the same `POST /api/v1/runs/ingest` endpoint it introduced. This project combines two checklist items: the "GitHub/GitLab integration" must-have and the "PR/MR Integrated Feedback" differentiator, since the latter requires the former's connection/auth plumbing to exist first.

## Problem

Meridian has two-way Jira issue sync but no equivalent for GitHub, and no way for a pull request to show test status at all — a tester or reviewer has to leave GitHub and open Meridian to see whether a PR's associated test run passed. TestRail and other competitors surface this directly in the PR.

## Scope decisions

1. **GitHub only, not GitLab or Azure DevOps.** Both are real future needs, but each is effectively a new provider-specific API client on top of shared plumbing (connection table, issue_tracker_links, ingest-endpoint extension) this project builds once. Adding either now would double or triple the API-client surface of a single pass for no gain to the first shippable version. Both become near-mechanical follow-ups once this ships.
2. **"GitHub integration" (must-have) = two-way issue sync, mirroring the existing Jira integration exactly** (connect a repo, create/link GitHub Issues from Meridian issues, status changes flow both ways via an inbound webhook). "PR/MR Integrated Feedback" (differentiator) is a separate capability built on the same connection, not folded into "integration" itself.
3. **Repo scope is per Meridian project, not per org** (unlike Jira, which is one connection per org). A CI run's PR lives in a specific repo tied to a specific codebase — org-wide defaulting would risk wrong-repo mismatches once PR feedback is involved. Connections still live on the existing org-level `/settings/integrations/github` page (admin-only, like Jira) via a project picker in the connect form, rather than introducing a new per-project settings surface — this codebase has no per-project settings tab today and adding one is out of scope.
4. **Auth is a Personal Access Token (fine-grained, repo scope), stored in Supabase Vault** — exactly the Jira pattern (`vault_secret_id` + `security definer` retrieval functions), not a GitHub App/OAuth flow. OAuth app registration and installation-token handling is a materially larger, genuinely new category of infrastructure this codebase has never built; PAT storage is proven and already exists.
5. **The connection's PAT auto-creates the GitHub webhook** (`POST /repos/{owner}/{repo}/hooks`) rather than requiring the admin to paste a URL into GitHub's own settings (Jira's manual pattern, driven by Jira Cloud's own webhook setup being a separate self-service flow). GitHub's API supports registering it directly with the same PAT already being granted repo access, so there's no reason to make the admin do it by hand. If webhook creation fails, the connection is still saved (issue sync still works without it) with a UI warning and retry action — never blocks the whole connect flow.
6. **PR comments, not commit status checks.** A single PR comment (created once, updated in place on re-runs via a hidden HTML marker) summarizing pass/fail/blocked/skipped counts and a link to the Meridian run. Status checks (the Checks API, appearing in the PR's merge-gate area) are a legitimate future enhancement but require more API surface to keep correctly in sync across re-runs; a comment is simpler and still fully visible in the PR conversation.
7. **PR feedback rides on the existing `POST /api/v1/runs/ingest` endpoint** via a new optional `prNumber` field, rather than a separate endpoint — a CI script already posts its results there; attaching a PR number to that same call is the natural integration point, and avoids CI scripts needing to make two calls per run.
8. **Posting the PR comment is best-effort and never fails the ingest itself.** A run is a completed fact regardless of whether Meridian could reach GitHub afterward; the ingest response includes `prCommentPosted: boolean` so a CI script can tell but doesn't have to handle it as an error.
9. **Severity has no GitHub-native equivalent (no priority field), so it's embedded as text in the issue body** (`**Severity:** high`) rather than inventing a label taxonomy — keeps this pass's issue-sync scope matched to Jira's, no new label-management UI/API surface.
10. **GitHub issues are only open/closed — no "in progress" state.** Meridian `open`/`in_progress` → GitHub `open`; Meridian `resolved`/`closed` → GitHub `closed`. Inbound: a `closed` webhook event → Meridian `resolved`; `reopened` → Meridian `open`. This is lossier than Jira's transition-candidate matching, but there's no GitHub-native concept to map the extra Meridian states onto.

## Schema

New migration `supabase/migrations/0022_github_integration.sql`:

- `issue_tracker_provider` enum gains `'github'`: `alter type issue_tracker_provider add value 'github'`
- `issue_tracker_connections` gains four new nullable columns:
  - `project_id uuid references projects(id) on delete cascade` — null for existing Jira rows (org-scoped), always set for new GitHub rows (project-scoped)
  - `github_repo_owner text`
  - `github_repo_name text`
  - `github_webhook_secret text` — random secret used to verify the `X-Hub-Signature-256` HMAC header on inbound webhook deliveries (GitHub's signature-verification model, replacing Jira's opaque-token-in-URL scheme, which GitHub doesn't use)
- The single `unique (org_id, provider)` constraint is replaced with two partial unique indexes:
  - `create unique index issue_tracker_connections_org_provider_idx on issue_tracker_connections(org_id, provider) where project_id is null;` (Jira)
  - `create unique index issue_tracker_connections_project_provider_idx on issue_tracker_connections(project_id, provider) where project_id is not null;` (GitHub)
- `issue_tracker_links` is unchanged — already generic enough (`connection_id`, `external_issue_key`, `external_issue_id`) to hold GitHub issue links alongside Jira ones.
- `test_runs` gains two new nullable columns: `pr_number integer`, `pr_url text` — populated only by CI-triggered ingestion when the CI script reports a PR; null for UI-created runs and non-PR CI runs.

Three new `security definer` functions mirroring the Jira three exactly (`create_github_connection`, `get_github_pat`, `delete_github_connection`), same Vault-secret create/decrypt/delete pattern, same internal `is_org_admin`/`is_org_member` checks — scoped by `project_id` instead of `org_id` where the connection is project-scoped (i.e. `is_org_admin` is still checked via the project's `org_id`, since project-level roles don't exist in this codebase — org roles are what gate admin actions everywhere else too).

## Connect / disconnect flow

**New index page** `src/app/(app)/settings/integrations/page.tsx` — today `/settings/integrations` has no page at all; the main Settings page (`src/app/(app)/settings/page.tsx:45-57`) links straight to `/settings/integrations/jira`, even though its own description text already says "Jira, GitHub, GitLab, Slack, and CI runner connections." Adding a second provider makes a direct link wrong. The new index page lists each provider as a card/row (Jira, GitHub) linking to its own sub-page, same visual pattern as the main Settings page's own card list. **Modify** `src/app/(app)/settings/page.tsx:45-57` so its "Integrations" link points to `/settings/integrations` (the new index) instead of `/settings/integrations/jira` directly.

New page `src/app/(app)/settings/integrations/github/page.tsx`, same admin-only pattern as the Jira page, but listing one row per connected project (a table, not a single connection) with a "Connect another project" form below it. Form fields: project picker (dropdown of the org's projects), repo owner, repo name, PAT (password input).

`connectGithubTracker` Server Action (`src/lib/actions/issue-tracker.ts`, alongside the existing Jira actions):
1. Validate the PAT by calling `GET /repos/{owner}/{repo}` with it — confirms access before anything is saved.
2. Call `create_github_connection` RPC — stores the PAT in Vault, generates a random webhook secret, inserts the connection row (with `project_id` set).
3. Call GitHub's `POST /repos/{owner}/{repo}/hooks` to create the webhook (content-type `application/json`, secret = the generated one, events: `["issues"]` — PR comments are posted *by* Meridian via the ingest flow, not received, so no `pull_request` webhook subscription is needed).
4. If webhook creation fails, the connection is still saved; the UI shows a warning banner ("Issue sync is connected, but automatic status updates from GitHub aren't set up — retry") with a retry action that re-attempts just step 3.

Disconnect (`disconnectGithubTracker`): best-effort `DELETE` of the webhook via GitHub's API (proceeds even if this call fails — an orphaned webhook pointing at a connection that no longer has a valid token is harmless dead weight, not a security issue), then `delete_github_connection` RPC (cleans up the Vault secret, same as Jira's disconnect).

## Issue sync

New `src/lib/github/client.ts`, mirroring `src/lib/jira/client.ts`'s shape:
- `createGithubIssue(connection, title, description, severity)` → `POST /repos/{owner}/{repo}/issues`, severity appended to the body as `**Severity:** {severity}`.
- `updateGithubIssueFields(connection, issueNumber, title, description, severity)` → `PATCH /repos/{owner}/{repo}/issues/{number}`.
- `setGithubIssueState(connection, issueNumber, meridianStatus)` → `PATCH .../issues/{number}` with `state: "open"` or `"closed"` per the mapping in scope decision 10.

`sendIssueToGithub` Server Action, same shape and rate limit as `sendIssueToJira` (30/hour), writes to the same `issue_tracker_links` table with this connection's id.

**Modify existing `updateIssueStatus`** (`src/lib/actions/issues.ts:51-99`) — today it assumes any linked connection is Jira (selects `jira_base_url`/`jira_email`/`jira_project_key` and calls `transitionJiraIssueStatus` unconditionally). It needs to also select `provider`, `github_repo_owner`, `github_repo_name` from the joined `issue_tracker_connections`, and branch: `provider === "jira"` keeps the existing `transitionJiraIssueStatus` call, `provider === "github"` calls `setGithubIssueState` instead (using `get_github_pat` in place of `get_jira_api_token`). Same "Meridian's own save already succeeded regardless" comment and `last_sync_error`/`external_updated_at` bookkeeping applies to both branches unchanged.

New inbound webhook route `src/app/api/v1/webhooks/github/route.ts`, mirroring the Jira webhook route's structure:
1. Read the raw body, verify `X-Hub-Signature-256` against the connection's `github_webhook_secret` using HMAC-SHA256 (the connection is looked up by matching `github_repo_owner`/`github_repo_name` parsed from the payload's `repository` field, then the signature is checked against that connection's secret — unlike Jira, there's no token-bearing URL to look the connection up by first).
2. Store the event in `webhook_events` regardless of signature validity (same audit-trail principle as the existing generic webhook scaffold and the Jira route).
3. On `action: "closed"` or `"reopened"` for an `issues` event, look up the `issue_tracker_links` row by `external_issue_id` + `connection_id`, apply the status mapping from scope decision 10, update the linked Meridian issue.
4. No timestamp-based staleness check like Jira's (GitHub's issue payload doesn't carry a comparable "last updated" field in the same way) — last delivery wins, matching GitHub's own webhook delivery model (at-least-once, but Meridian's write is idempotent regardless of delivery order for a boolean-ish open/closed state).

## PR feedback

`POST /api/v1/runs/ingest` (existing route, `src/app/api/v1/runs/ingest/route.ts`) gains an optional `prNumber` field in the request body. `api_ingest_run_results` gains a matching `p_pr_number integer default null` param:
- If provided, the function stores it on the new run as `pr_number`, and builds `pr_url` server-side from the project's connected GitHub repo (`https://github.com/{owner}/{repo}/pull/{pr_number}`) — never trusted from the request body, always derived from the stored connection so a caller can't forge an arbitrary link.
- If no GitHub connection exists for the project, `pr_number` is still stored (harmless metadata) but `pr_url` stays null and no comment is attempted.

After a successful ingest with a resolved `pr_url`, the route calls `postOrUpdatePrComment(connection, prNumber, runSummary)` in `src/lib/github/client.ts`:
1. `GET /repos/{owner}/{repo}/issues/{prNumber}/comments` (GitHub treats PR comments as issue comments), scan for one whose body contains the hidden marker `<!-- meridian-run:{projectId} -->`.
2. Found → `PATCH` that comment in place (re-running the same CI job against the same PR updates the existing comment rather than spamming a new one each time). Not found → `POST` a new comment.
3. Comment body: run name, pass/fail/blocked/skipped counts, and a link back to `{NEXT_PUBLIC_APP_URL}/projects/{projectId}/runs/{runId}`.

This call is best-effort per scope decision 8: any failure (bad/revoked PAT, renamed repo, GitHub outage) is caught and does not fail the ingest response — the run was already recorded successfully. The response gains a `prCommentPosted: boolean` field.

## Explicitly out of scope

- GitLab and Azure DevOps (deferred, see scope decision 1 — same connection-table pattern, new provider value + API client, once this ships).
- Commit status checks / the Checks API (deferred, see scope decision 6).
- Any label taxonomy for severity (deferred, see scope decision 9).
- Re-ingesting a PR comment update outside of the CI ingestion flow (e.g. no standalone "post a comment" UI action).

## Testing

Same substitution as the CI ingestion project: the request-body validation on the ingest route's new `prNumber` field is pure/unit-testable. The webhook signature verification (`verifyGithubSignature`) is a pure function (HMAC comparison) and unit-testable with a fixed secret/payload/signature triple. Everything that talks to GitHub's actual API (connection validation, issue create/update, webhook create/delete, PR comment post/update) is verified manually against a real (test) GitHub repo, matching how the Jira integration and CI ingestion were both verified — no integration test harness exists yet for external-API-authenticated flows.
