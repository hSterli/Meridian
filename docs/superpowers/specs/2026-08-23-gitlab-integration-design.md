# GitLab Integration + MR Feedback — Design

**Date**: 2026-08-23
**Status**: Approved, pending implementation
**Context**: Explicitly flagged as a near-mechanical follow-up in the original GitHub integration spec's own scope decision 1 ("Both are real future needs... Both become near-mechanical follow-ups once this ships"). This project mirrors `docs/superpowers/specs/2026-08-10-github-integration-pr-feedback-design.md` closely — same bundling (issue sync + MR feedback in one pass, matching that spec's own scope decision 2), same connection/schema pattern, same PAT-in-Vault auth model. Deltas from GitHub are called out explicitly; everything else should be read as "same as GitHub."

## Problem

Meridian has two-way issue sync for Jira and GitHub, but nothing for GitLab, and no way for a GitLab merge request to show test status without leaving Meridian — the exact gap the GitHub project closed for GitHub repos.

## Scope decisions

1. **GitLab only — full parity with the GitHub project's bundled scope (issue sync + MR feedback), not issue-sync-only.** Confirmed with the user directly: ship both capabilities in this one pass rather than deferring MR feedback as a second project, since GitHub's own project already established that bundling as the norm for this codebase.
2. **Self-hosted instances are supported, not just gitlab.com.** This is the one genuine product delta from GitHub (which hardcoded `api.github.com`). GitLab is commonly self-hosted, and hardcoding `gitlab.com` would exclude a meaningful share of real GitLab users. The connect form gets an instance-URL field, defaulting to `https://gitlab.com` when left blank — the same pattern Jira's connect form already uses for `jira_base_url`, not a new UI concept for this codebase.
3. **Project identified by a single `gitlab_project_path` field, not split owner+repo columns like GitHub's.** GitLab's namespace model nests arbitrarily (`group/project`, `group/subgroup/project`, ...) — it doesn't cleanly decompose into exactly two parts the way GitHub's flat `owner/repo` does. A single path field (URL-encoded when building API paths, per GitLab's own convention) avoids modeling a nesting depth this codebase has no other reason to represent.
4. **Auth is a Personal Access Token stored in Supabase Vault** — identical to GitHub's model (scope decision 4 there), not a GitLab OAuth app. Same reasoning applies unchanged: OAuth app registration is materially larger infrastructure this codebase doesn't have, PAT storage is already proven twice over.
5. **Webhook auth is a static token compared by simple equality (`X-Gitlab-Token` header), not HMAC.** This is GitLab's actual webhook security model — it has no signature-over-payload mechanism analogous to GitHub's `X-Hub-Signature-256`. The token is generated the same way GitHub's webhook secret is (random, stored on the connection row), just verified differently: direct string comparison instead of HMAC-SHA256. Closer in spirit to Jira's opaque-token model than to GitHub's cryptographic one, but for GitLab this is simply how their webhooks work, not a scope choice.
6. **The connection's PAT auto-creates the GitLab webhook** (`POST /projects/:id/hooks`), same as GitHub — no manual URL-pasting step. Same non-blocking failure handling: if webhook creation fails, the connection is still saved with a warning + retry action.
7. **MR comments, not pipeline/status checks.** A single MR note (GitLab's term for a comment), created once and updated in place on re-runs via the same hidden-marker technique GitHub's PR comments use. GitLab does have a native external-status-check-style API (commit statuses), but adopting it is the same "more API surface to keep in sync" trade-off GitHub's spec already declined in its own scope decision 6.
8. **MR feedback rides on the existing `POST /api/v1/runs/ingest` endpoint** via a new optional `mrIid` field (GitLab's term for a merge request's project-scoped number, analogous to `prNumber`) — not a new endpoint, not reusing the `prNumber` field name itself (GitHub and GitLab are different connections on the same project; a single run could in principle report against either, so the field names stay provider-distinct rather than overloading one name for two different meanings).
9. **Posting the MR comment is best-effort, exactly like GitHub's PR comment** (scope decision 8 there) — never fails the ingest itself. Response gains `mrCommentPosted: boolean` alongside the existing `prCommentPosted`.
10. **Severity embedded as text in the issue body**, same as GitHub (scope decision 9 there) — GitLab issues have labels, but building label-taxonomy management is the same out-of-scope expansion GitHub's spec already declined.
11. **GitLab issues are only `opened`/`closed`** — same lossy binary mapping as GitHub (scope decision 10 there): Meridian `open`/`in_progress` → GitLab `opened`; `resolved`/`closed` → GitLab `closed`. Inbound: a `close` action → Meridian `resolved`; `reopen` → Meridian `open`.

## Schema

New migration `supabase/migrations/0026_gitlab_integration.sql`:

- `issue_tracker_provider` enum gains `'gitlab'`: `alter type issue_tracker_provider add value 'gitlab'`
- `issue_tracker_connections` gains three new nullable columns:
  - `gitlab_instance_url text` — e.g. `https://gitlab.com` or a self-hosted instance's base URL, no trailing slash
  - `gitlab_project_path text` — e.g. `my-group/my-project` or `my-group/my-subgroup/my-project`
  - `gitlab_webhook_token text` — the static secret compared against inbound `X-Gitlab-Token` headers (GitLab's equivalent of `github_webhook_secret`, verified differently per scope decision 5)
- The existing two partial unique indexes (`(org_id, provider) where project_id is null` for Jira, `(project_id, provider) where project_id is not null` for GitHub) already generalize to a third provider with no schema change — GitLab rows are project-scoped exactly like GitHub's, so they're covered by the existing second index without modification.
- Three new `security definer` functions mirroring the GitHub/Jira six exactly: `create_gitlab_connection`, `get_gitlab_pat`, `delete_gitlab_connection` — same Vault-secret pattern, same `is_org_admin`/`is_org_member` checks scoped via the project's `org_id`.
- `test_runs` gains two new nullable columns: `mr_iid integer`, `mr_url text` — same shape and purpose as the existing `pr_number`/`pr_url` pair GitHub's project added, populated only by CI-triggered ingestion when the CI script reports a GitLab merge request.

## Connect / disconnect flow

New page `src/app/(app)/settings/integrations/gitlab/page.tsx`, added as a third row on `src/app/(app)/settings/integrations/page.tsx`'s provider list, same admin-only per-project-connection-table pattern as the GitHub page. Form fields: project picker, instance URL (optional, defaults to `https://gitlab.com`), project path, PAT.

`connectGitlabTracker` Server Action (`src/lib/actions/issue-tracker.ts`, alongside Jira/GitHub):
1. Validate the PAT by calling `GET {instanceUrl}/api/v4/projects/{urlEncodedPath}` with `PRIVATE-TOKEN: {pat}` — confirms access before anything is saved.
2. Call `create_gitlab_connection` RPC — stores the PAT in Vault, generates a random webhook token, inserts the connection row.
3. Call `POST {instanceUrl}/api/v4/projects/{urlEncodedPath}/hooks` to create the webhook (`token` = the generated webhook token, `issues_events: true`, `merge_requests_events: true` — GitLab's webhook config declares event types as boolean flags on the same request, unlike GitHub's `events: [...]` array).
4. Same non-blocking failure handling as GitHub: connection saves regardless, UI shows a retry action if webhook creation failed.

Disconnect (`disconnectGitlabTracker`): best-effort webhook `DELETE`, then `delete_gitlab_connection` RPC — same shape as GitHub's disconnect.

## Issue sync

New `src/lib/gitlab/client.ts`, mirroring `src/lib/github/client.ts`'s shape (return-union `{ ok }`/`{ error }`, never throws, `"server-only"`):
- `verifyGitlabProjectAccess(connection)` → `GET /api/v4/projects/{path}`.
- `createGitlabIssue(connection, title, description, severity)` → `POST /api/v4/projects/{path}/issues`, severity appended to `description` as `**Severity:** {severity}`.
- `updateGitlabIssueFields(connection, issueIid, title, description, severity)` → `PUT /api/v4/projects/{path}/issues/{issue_iid}`.
- `setGitlabIssueState(connection, issueIid, meridianStatus)` → `PUT .../issues/{issue_iid}` with `state_event: "close"` or `"reopen"` (GitLab uses a state *event* — an action to perform — rather than GitHub's direct `state: "open"|"closed"` field).
- All requests use `PRIVATE-TOKEN: {pat}` instead of `Authorization: Bearer {token}`.
- Project paths are URL-encoded (`encodeURIComponent`) when interpolated into request URLs, per GitLab API convention (`group/project` → `group%2Fproject`).

`sendIssueToGitlab` Server Action, same shape and rate limit (30/hour) as `sendIssueToJira`/`sendIssueToGithub`, writes to the same `issue_tracker_links` table.

**Modify existing `updateIssueStatus`** (`src/lib/actions/issues.ts`) — currently branches `provider === "jira"` / `provider === "github"`. Gains a third branch: select `gitlab_instance_url`, `gitlab_project_path` from the joined connection, `provider === "gitlab"` calls `setGitlabIssueState` using `get_gitlab_pat` in place of `get_github_pat`. Same bookkeeping (`last_sync_error`, `external_updated_at`) applies unchanged to all three branches.

New inbound webhook route `src/app/api/v1/webhooks/gitlab/route.ts`, mirroring the GitHub route's structure:
1. Read the raw body, verify the `X-Gitlab-Token` header equals the connection's `gitlab_webhook_token` (direct string comparison — no HMAC, per scope decision 5). The connection is looked up by matching `gitlab_project_path` parsed from the payload's `project.path_with_namespace` field.
2. Store the event in `webhook_events` regardless of token validity (same audit-trail principle as the Jira/GitHub routes).
3. On an `issue` event with `object_attributes.action` of `"close"` or `"reopen"`, look up `issue_tracker_links` by `external_issue_id` + `connection_id`, apply the mapping from scope decision 11, update the linked Meridian issue.
4. No timestamp-based staleness check, same as GitHub's route and for the same reason — last delivery wins.

## MR feedback

`POST /api/v1/runs/ingest` gains an optional `mrIid` field. `api_ingest_run_results` gains a matching `p_mr_iid integer default null` param:
- If provided, stored on the run as `mr_iid` (new nullable `test_runs` column, alongside the existing `pr_number`/`pr_url`), and `mr_url` is built server-side from the project's connected GitLab instance/project path — never trusted from the request body.
- If no GitLab connection exists for the project, `mr_iid` is still stored but `mr_url` stays null and no comment is attempted.

After a successful ingest with a resolved `mr_url`, the route calls `postOrUpdateMrComment(connection, mrIid, runSummary)` in `src/lib/gitlab/client.ts`:
1. `GET /api/v4/projects/{path}/merge_requests/{mr_iid}/notes`, scan for one containing the hidden marker `<!-- meridian-run:{projectId} -->`.
2. Found → `PUT` that note in place. Not found → `POST` a new note.
3. Note body: run name, pass/fail/blocked/skipped counts, link back to the Meridian run — same content shape as the GitHub PR comment.

Best-effort, same as GitHub's PR comment (scope decision 9): never fails the ingest. Response gains `mrCommentPosted: boolean`.

## Explicitly out of scope

- Azure DevOps (still deferred — same connection-table pattern would apply, a future project of its own).
- Commit status checks / GitLab's native pipeline-status API (deferred, mirrors GitHub's scope decision 6 reasoning).
- Label taxonomy for severity (deferred, mirrors GitHub's scope decision 9 reasoning).
- OAuth app / GitLab App auth flow (deferred, mirrors GitHub's scope decision 4 reasoning) — PAT only.
- A standalone "post an MR comment" UI action outside the CI ingestion flow.

## Testing

Same substitution as GitHub: the ingest route's new `mrIid` field validation is pure/unit-testable. The webhook token check is a straightforward string comparison — worth a unit test (`verifyGitlabWebhookToken`) covering match/mismatch/missing-header, even though it's simpler than GitHub's HMAC verification. Everything that talks to GitLab's actual API (connection validation, issue create/update, webhook create/delete, MR note post/update) is verified manually against a real (test) GitLab project — no integration test harness exists yet for external-API-authenticated flows, same as every other integration in this codebase.
