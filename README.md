# Meridian QA

A test-management SaaS positioned as a lighter, cheaper alternative to PractiTest for mid-market teams: fast onboarding, cross-project reporting that doesn't require manual setup, and no "call sales" wall for core features. See the source PRD for full product context.

This is the **Phase 1 MVP** build — the P0 scope from the PRD's roadmap. Scope decisions and what's deferred are listed at the bottom.

## Stack

- **Next.js 16** (App Router, TypeScript, Turbopack) + **Tailwind CSS 4**
- **Supabase**: Postgres, Auth (email/password), and RLS for multi-tenancy — no separate backend
- Live project: `meridian-qa` (`ucnfcsosbdgknmzyuqbw`) in the Sterling LLC. Supabase org, free tier

## Local setup

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase URL + anon key (see below)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll land on `/login`; sign up, then the onboarding wizard creates your team and first project.

### Environment variables

`.env.local` needs:

```
NEXT_PUBLIC_SUPABASE_URL=https://ucnfcsosbdgknmzyuqbw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

Get these from the Supabase dashboard → Project Settings → API, or ask whoever set up the project. To point at a **different** Supabase project instead, create one and run the migrations below against it.

### Database schema

All schema is in `supabase/migrations/`, applied in order:

| Migration | What it does |
|---|---|
| `0001_init.sql` | Core schema: orgs, members, projects, test cases, runs, issues, RLS policies |
| `0002_invites.sql` | Team invite-by-email flow |
| `0003_member_rpc.sql` | `get_org_members` RPC (lists a team with email, since `auth.users` isn't in the exposed API) |
| `0004_lock_down_function_execute.sql` | Revokes public/anon EXECUTE on internal RLS helper functions |
| `0005_create_org_rpc.sql` | `create_organization_with_owner` RPC — see note below |
| `0006_private_schema_hardening.sql` | Moves `is_org_member`/`is_org_admin`/`project_org_id` into a non-exposed `private` schema so they can't be called directly via `/rest/v1/rpc/*` (they're SECURITY DEFINER and were previously callable by any authenticated user; `project_org_id` in particular would disclose the org_id of any project id) |
| `0007_rate_limiting.sql` | `check_rate_limit(action, limit, window_seconds)` — a per-user sliding-window limiter backed by a `rate_limit_buckets` table, keyed by `auth.uid()` server-side so a caller can only ever exhaust their own bucket |
| `0008_test_case_features.sql` | `test_case_features` — a required, structured "Feature" field per test case (distinct from free-form tags), managed per project; backfills existing test cases to a default "General" feature before making the column NOT NULL |
| `0009_run_folders.sql` | `run_folders` — optional folders to organize test runs within a project; `test_runs.folder_id` is nullable (an unfiled run is a normal state, not required like Feature) |
| `0010_test_suites.sql` | `test_suites` + `test_suite_cases` — a reusable, named set of test cases (e.g. "Regression") that can be re-run repeatedly; `test_runs.suite_id` links each execution back to the suite that spawned it, snapshotting membership at run time so past results don't shift when the suite's membership changes later |
| `0011_test_case_sprint.sql` | `test_cases.sprint_number` — optional, nullable integer so the library can be grouped by sprint as well as by feature; not a full sprint/milestone entity (that's the PRD's Phase 2 scope) |
| `0012_test_case_ownership_automation.sql` | `test_cases.assigned_to` (a real owner, distinct from `created_by` and reassignable), `automation_status` (manual only / to be automated / automated) + `automation_script_ref`, and an optional `reference_link` (e.g. a Jira ticket URL) |
| `0013_test_case_attachments.sql` | `test_case_attachments` table + a private `test-case-attachments` Storage bucket for real file uploads on a test case; objects are stored at `${projectId}/${testCaseId}/${filename}` so Storage RLS can gate access purely from the path via `storage.foldername()`, with no join needed |
| `0014_test_run_cases_test_case_id_index.sql` | Adds an index on `test_run_cases.test_case_id` (previously only indexed by `run_id`), fixing a full-table scan for "this test case's execution history across all runs" |
| `0015_test_case_custom_fields.sql` | `test_case_custom_fields` — per-project custom field definitions (text/number/select); values stored id-keyed in the pre-existing `test_cases.custom_fields` jsonb column |
| `0016_api_keys_and_webhooks.sql` | `api_keys` (org-scoped, owner/admin-managed, hashed tokens shown once) and `webhook_events` (generic inbound webhook scaffolding); `validate_api_key`/`check_api_key_rate_limit`/`api_*` SECURITY DEFINER functions centralize API authorization instead of a service-role client with scattered checks |
| `0017_issue_tracker_jira_sync.sql` | `issue_tracker_connections` (one Jira connection per org, API token stored in Supabase Vault, not hashed, since it must be retrievable to call Jira's API) and `issue_tracker_links` (maps a Meridian issue to its external Jira key/id); `create_jira_connection`/`get_jira_api_token`/`delete_jira_connection` SECURITY DEFINER functions do their own admin/member checks since Vault access bypasses RLS |
| `0018_lock_down_jira_functions.sql` | Fixes 0017's Jira connection functions being left callable by `anon`/`public` via the default execute grant (same class of gap `0004` closed for the RLS helpers) — revokes and re-grants to `authenticated` only |

Apply them via the Supabase SQL editor, the Supabase CLI (`supabase db push`), or the Supabase MCP tools, in filename order, against a fresh project.

After schema changes, regenerate types:
```bash
npx supabase gen types typescript --project-id <project-id> > src/lib/types/database.ts
```
(then re-add the hand-written convenience aliases at the bottom of that file — `OrgRole`, `TestStep`, etc.)

**Why org creation goes through an RPC, not a plain insert:** creating an org hits a chicken-and-egg RLS problem — the policy that lets you *see* an org requires org membership, which can't exist until *after* the org row does. `supabase-js`'s `.insert().select()` re-selects the row it just inserted (via `Prefer: return=representation`), and that re-select fails RLS even though the insert itself succeeded — reported as a generic "violates row-level security policy" error with no indication that INSERT actually worked. `create_organization_with_owner` creates the org and the owner's membership atomically in one `SECURITY DEFINER` function, so no intermediate state is ever queried through the normal RLS-gated path. If you add other multi-step "create X, then immediately need to read X back" bootstrap flows, use the same pattern rather than chaining `.insert().select()`.

## What's implemented (Phase 1 MVP / P0)

- **Onboarding**: guided signup → create team → create first project from a starter template (web/mobile/API/blank), with seeded sample test cases
- **Test case management**: CRUD, a required structured Feature field (project-managed list, pick-existing-or-add-new from the form), an optional sprint number, free-form tags, priority/status, version history, dynamic filters (including by feature), pill-style tag filtering, CSV import/export, and grouping the library by feature or by sprint
- **Custom fields**: project-managed text/number/select fields on test cases, shown as list badges, select-type fields filterable, and fully round-tripped through CSV import/export
- **Test case ownership & automation tracking**: an assignable owner (separate from the creator), automation status (manual only / to be automated / automated) with an optional script reference, an optional external reference link, real file attachments (upload/download/delete via private Storage), native drag-and-drop step reordering, and optionally adding a new test case straight into an existing suite at creation time
- **Test Cases list**: stable per-project display IDs (`{PROJECT_KEY}-{n}`), an owner avatar and last-execution-result column per row (most recent result across any run the case has appeared in), and a Suites sidebar filter
- **Test execution**: run creation from a test-case picker with optional folder/suite assignment, keyboard-driven execution UI (P/F/B/S shortcuts, arrow-key navigation), notes per result, and "Add test cases" to append more cases to an already-created run
- **Runs list**: sortable table (name, status, instances, last updated), a per-run segmented pass/fail/blocked/skipped status bar, folder sidebar for organizing runs, multi-select with bulk delete/move-to-folder
- **Suites**: a reusable, named set of test cases (e.g. "Regression") you can re-run on demand — "Run now" snapshots current membership into a fresh run; the suite tracks last-run date and pass rate plus full run history, and membership can be edited anytime (add a new feature's test cases without touching past results)
- **Issue tracking**: native lightweight tracker, linkable to a test case and/or a specific run result, status workflow (open → in progress → resolved → closed)
- **Cross-project dashboard**: stat tiles, recent-run pass/fail trend, flaky-test tracker (tests with both a pass and a fail in history), coverage by project, filterable to a single project via `?project=` (dropdown in the page header)
- **RBAC**: owner/admin/member roles, invite-by-email (auto-joins on next login/onboarding if the email matches a pending invite), role changes, member removal
- **Public REST API**: versioned `/api/v1` endpoints (list/get test cases, list/get runs, record a run result) authenticated via a `Bearer` API key instead of a Supabase Auth session; org-scoped, admin-managed key issuance/revocation from Settings > API Keys (plaintext key shown once, at creation); plus a generic signed inbound webhook receiver (`/api/v1/webhooks/[source]`) that validates and stores events for future source-specific processing
- **Two-way Jira issue sync**: one Jira connection per org (Settings > Integrations > Jira), API token stored in Supabase Vault; send a Meridian issue to Jira and it creates a linked Jira issue, status changes on the Meridian side push a transition attempt to Jira, and Jira-side changes flow back in via a per-connection inbound webhook (`/api/v1/webhooks/jira`)
- Weekly Status Report per project — live dashboard (RAG status, key metrics, daily execution with planned/variance, module breakdown) plus a non-destructive snapshot history for sharing a stable point-in-time record with stakeholders.

## Design system

Visual design follows the "Paper/Ink" mockups (`dash.html`, `testcasecode.html`, `testrunnercode.html`) — the full color/font token set lives in `src/app/globals.css` as a Tailwind v4 `@theme` block (e.g. `bg-primary`, `text-ink-primary`, `bg-paper-surface`, `font-headline-lg`). Fonts (Archivo, Fraunces, IBM Plex Mono) are self-hosted via `next/font/google`, not loaded from a CDN. Shared primitives (`src/components/ui/*`) and layout chrome (sidebar, page header, project tabs) all use these tokens, so any new page automatically inherits the look.

## Rate limiting

- **Login/signup**: covered by Supabase Auth's own built-in per-IP rate limits (Dashboard → Authentication → Rate Limits) — this runs ahead of application code and can't be bypassed by it, so it isn't reimplemented here.
- **Authenticated writes** (invites, test case creation, CSV import, run creation, run-case execution, org creation): gated by `rateLimit()` in `src/lib/rate-limit.ts`, calling the `check_rate_limit` RPC. See `supabase/migrations/0007_rate_limiting.sql` for why the bucket key is always derived from `auth.uid()` server-side rather than accepted as a parameter — that's what stops one user from being able to lock out another's bucket.
- **Public API requests** (`/api/v1/*`): a separate bucket namespace, gated by `rateLimitApiKey()` in `src/lib/rate-limit.ts` calling the `check_api_key_rate_limit` RPC. It reuses the same `rate_limit_buckets` table as `check_rate_limit`, but the key is `api:<key_id>:<action>` — keyed off the API key resolved by `validate_api_key`, not `auth.uid()` (there is no Supabase Auth session on an API-key request) — so a session-based bucket and an API-key-based bucket for the same person never collide, and one API key can never be throttled by (or throttle) another.

## Security notes

- CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy are set in `next.config.ts`. CSP's `connect-src` is scoped to the project's own Supabase origin, derived from `NEXT_PUBLIC_SUPABASE_URL` at build/serve time.
- Server Actions get Next.js's built-in CSRF protection (Origin/Host header check) for free — no extra CSRF token handling needed.
- **Manual step, not automatable from here**: enable "Leaked Password Protection" in Supabase Dashboard → Authentication → Policies. The linter flags it as off; there's no MCP tool or SQL path to toggle it.
- Running `get_advisors` (security) against the live project after any schema change is worth doing — the RPCs it flags as "callable by authenticated users" (`create_organization_with_owner`, `get_org_members`, `check_rate_limit`) are all intentional and individually safe (each only acts on the caller's own `auth.uid()`); anything else that shows up there should get the same private-schema treatment as `0006` gave the RLS helpers.

## Test account

`qa.tester@meridianqa.dev` is a confirmed account with seeded org/project/test-case/run/issue data, for validating the app end-to-end. (New self-serve signups are also fully supported via `/signup`, subject to Supabase's own email-sending rate limit on this free-tier project.)

## Explicitly deferred (Phase 2/3 per the PRD)

- GitHub/GitLab two-way issue sync (Jira now works — see "What's implemented" above), CI-triggered automated run ingestion via webhook
- Requirements management / traceability
- AI features (duplicate detection, test-value signal)
- Billing/plan tiers, regional data residency, SSO/SAML
- Richer custom fields beyond text/number/select (checkbox, date types), org-wide (cross-project) field definitions, and a "manage visible columns" control for projects with many fields — the core text/number/select engine itself now ships (see "Custom fields" above)
- Outbound webhook delivery (Meridian-initiated notifications to third-party URLs)
- Source-specific webhook processing (CI results, Jira/GitHub payloads) — the receiving/signature scaffold exists, specific integrations are separate future projects

## Notes for further development

- `src/lib/types/database.ts` is generated from the live schema plus a few hand-added convenience type aliases at the bottom — see the comment at the top of that file.
- RLS policies assume every table-scoped query goes through the normal `anon`/`authenticated` Supabase client (`src/lib/supabase/{client,server}.ts`). Don't add a service-role client to the app; if you need to bypass RLS for a legitimate bootstrap-style operation, write a `SECURITY DEFINER` Postgres function (see `create_organization_with_owner`) rather than a service-role key in application code.
- `src/proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`) refreshes the Supabase session and gates unauthenticated access.
