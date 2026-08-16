# Meridian QA — Project Status & Recovery Notes

**Last updated:** 2026-08-16 (now on GitHub: `https://github.com/hSterli/Meridian`)
**Purpose of this document:** originally written as a recovery memory-dump after the local working tree briefly appeared to go missing (resolved — see below, it was an iCloud sync hiccup, not real data loss). Now doubles as a general status/onboarding doc for the project, since it's pushed to GitHub alongside the code. Facts marked "verified live" were confirmed directly against Supabase or GitHub, not just recalled from memory.

---

## Resolved: the "missing project" scare (2026-08-15/16)

**Nothing was ever lost.** Mid-session, `/Users/heathersterling/Meridian` (the path this session had been working in the whole time) suddenly appeared to contain only an empty `.next/dev/` folder — no source, no `.git`, nothing. That triggered a full incident writeup (preserved in git history of this file if you want the blow-by-blow).

**Real cause:** `/Users/heathersterling/Meridian` was a symlink into this real project directory (`~/Documents/Claude/PASSIVE/Meridian/`), which lives under iCloud Drive sync ("Desktop & Documents Folders"). An iCloud sync hiccup made the symlink's target briefly appear empty. The actual repo here was completely untouched the entire time — confirmed via `git log`/`git rev-parse HEAD`, which matched the expected commit history exactly (latest commit `7db547d`, the Jira integration crash fix) the moment this real path was found.

**Practical implication going forward:** git operations that touch a lot of files (`git status`, broad diffs) can hang for a long time in this directory because iCloud may need to re-download ("hydrate") files on first access. `git log`, `git rev-parse`, and single-file reads are fast (metadata-only or already-hydrated). If a real editor/terminal session working in `~/Meridian` (the symlink) is still around, it's equivalent to working here directly — but consider whether this project should live outside iCloud sync to avoid a repeat of this scare.

---

## Where things live

| What | Where |
|---|---|
| Real project path | `/Users/heathersterling/Documents/Claude/PASSIVE/Meridian/` — full source, fully intact, confirmed via `git log` |
| Symlink used during the session | `/Users/heathersterling/Meridian` → the real path above (this is what briefly appeared empty during an iCloud sync hiccup — see "Resolved" section above) |
| Git remote | **`origin` → `https://github.com/hSterli/Meridian.git`** (`main` branch). Pushed 2026-08-16, full history through commit `7db547d`, verified with matching SHAs on both sides. Auth is via `gh` (GitHub CLI), logged in as `hSterli`. |
| Database | Supabase project ref **`ucnfcsosbdgknmzyuqbw`** — fully intact, 24 migrations applied (verified live, list below) |
| Design specs / plans | `docs/superpowers/specs/*.md` and `docs/superpowers/plans/*.md` — present and intact in the repo (confirmed: 11 specs, 11 plans on disk). |

---

## Credentials — what you need, not what they are

I never had plaintext credentials in this conversation and this document does not (and should not) contain any secret values. What you'll need to re-obtain to run the app again:

- **`NEXT_PUBLIC_SUPABASE_URL`** and **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** — from the Supabase dashboard → Project Settings → API, for project `ucnfcsosbdgknmzyuqbw`.
- **Supabase service role key** — same dashboard page, used by `src/lib/supabase/service.ts` (the service-role client used by `/api/v1/*` routes and webhook handlers).
- **`NEXT_PUBLIC_APP_URL`** — your local/deployed base URL (used to build webhook callback URLs and links in emails/PR comments).
- **No GitHub PAT or Jira API token is stored anywhere** — live-verified via SQL that `issue_tracker_connections` has **zero rows**. Nobody ever actually connected a real Jira or GitHub account during this session; both integrations were built and unit/type-tested but never exercised against a real external account. You'll need your own PAT/token to manually verify those features once the app is running again.
- **Test account:** `qa.tester@meridianqa.dev` — a confirmed Supabase Auth user with seeded org/project/test-case/run/issue data (org "TEST QA", `org_id 404fdb0b-b740-4e64-b78f-a4d606481adc`, project "Customer Portal Revamp", `project_id 3c89de27-9337-47ac-9061-95742b7ae10b`). I do not know this account's password — it was created via the real signup flow earlier in the session and never written down in a way I retained.

To get the current database types back immediately (no source needed), run the Supabase MCP `generate_typescript_types` tool (or `npx supabase gen types typescript --project-id ucnfcsosbdgknmzyuqbw`) against the project above — this reconstructs `src/lib/types/database.ts` from the live schema exactly.

---

## Tech stack

- Next.js 16 App Router, Turbopack, Server Actions + Route Handlers
- Supabase: Postgres, Auth, Row-Level Security, Storage (attachments), Vault (external API tokens)
- TypeScript, Tailwind v4 ("Paper/Ink" design system — color/font tokens as a `@theme` block, self-hosted fonts via `next/font/google`: Archivo, Fraunces, IBM Plex Mono)
- Vitest for unit tests (colocated `*.test.ts`, `vitest.config.ts` had two projects: `unit` and a planned `integration`)
- Playwright was planned for e2e but never installed/wired up (see "Automated test suite" below)

---

## What's been completed — verified live via Supabase migrations

24 migrations are applied to `ucnfcsosbdgknmzyuqbw` (confirmed via `list_migrations` at write time), grouped by feature:

**Core platform (migrations 1-9, ~`init` through `test_case_features`):** orgs, org membership/roles (owner/admin/member), invites, `private` schema of RLS helper functions (`is_org_member`, `is_org_admin`, `project_org_id` — hardened in `private_schema_hardening`), projects, rate limiting (`rate_limiting` — `check_rate_limit` RPC, bucket keyed off `auth.uid()` server-side), test case features/tagging.

**Test management core (`run_folders`, `test_suites`, `test_case_sprint`, `test_case_ownership_automation`, `test_case_attachments`, `test_run_cases_test_case_id_index`, `test_case_custom_fields`):** run folders, reusable test suites with run-now snapshotting, sprint numbers, owner/automation-status fields on test cases, file attachments (Storage-backed), a missing index fixed as a scalability pass, and a text/number/select custom-fields engine.

**Public API + integrations (`api_keys_and_webhooks`, `issue_tracker_jira_sync`, `lock_down_jira_functions`, `link_attachments_to_run_cases`, `ci_run_ingestion`, `github_integration`, `pr_feedback_ingestion`):**
- Versioned `/api/v1` REST API, `Bearer` API-key auth (`api_keys` table, `validate_api_key`/`check_api_key_rate_limit` RPCs), generic signed inbound webhook receiver.
- Two-way **Jira** issue sync: one connection per org, PAT/API-token in Supabase Vault, inbound webhook, outbound status push.
- **Run evidence attachments**: screenshots attachable per run-case (`run_case_id` on `test_case_attachments`), also visible on the test case's own Attachments panel.
- **CI-triggered run ingestion**: `POST /api/v1/runs/ingest` — bulk one-call result reporting, auto-creates draft test cases under a "CI Imported" feature for unmatched titles, 20/hour rate limit.
- **GitHub integration + PR/MR feedback** (most recently shipped): two-way GitHub issue sync mirroring Jira but **project-scoped** (not org-scoped, since a PR's repo ties to one codebase), PAT-based auth via Vault, webhook auto-created via GitHub's API on connect, HMAC-SHA256 inbound webhook verification. `POST /api/v1/runs/ingest` extended with an optional `prNumber` that triggers a best-effort find-and-update PR comment summarizing pass/fail counts (never fails the ingest itself on GitHub-side failure).

**Reporting (`weekly_status_reports`):** live per-project dashboard (RAG status, key metrics, daily execution planned/variance, module breakdown) plus non-destructive snapshot history.

---

## Feature checklist status (the "7 must-haves + 4 TestRail differentiators" this session was closing)

| Item | Status |
|---|---|
| Test case management | ✅ Done (pre-existing before this checklist work started) |
| Test execution tracking | ✅ Done |
| Analytics dashboard | ✅ Done |
| Jira integration | ✅ Done |
| GitHub/GitLab integration | ✅ **GitHub done this session.** GitLab still not built — was explicitly deferred as a "near-mechanical follow-up" once GitHub shipped (same `issue_tracker_connections` table, new `provider` enum value, new API client file). |
| CI/CD pipeline integration | ✅ Done this session (CI-triggered run ingestion) |
| Slack integration | ❌ **Not started.** Was roadmap item 3 of 6, next up when the source was lost. |
| Flaky Test Detection (differentiator) | 🟡 Partial/paused — brainstorming was started (project context explored) then paused mid-clarifying-questions before this session's checklist work took over. Needs to resume from scratch (brainstorming skill, clarifying questions phase). |
| Real-Time Visibility Dashboard (differentiator) | 🟡 Partial — the existing analytics dashboard covers some of this; no dedicated design pass done. |
| PR/MR Integrated Feedback (differentiator) | ✅ Done this session, as part of GitHub integration. |
| Test Bottleneck Identification (differentiator) | ❌ Not started. |

**Roadmap sequencing at time of loss** (6-item plan, agreed with the user): 1) CI ingestion ✅, 2) GitHub integration + PR feedback ✅, 3) Slack integration ❌ next, 4) Flaky Test Detection (resume paused work), 5) Real-Time Visibility Dashboard enhancements, 6) Test Bottleneck Identification.

---

## Paused / deferred work (separate from the roadmap above)

- **`automated-test-suite` plan** — paused at Task 5 of 14. Tasks 1-4 done (Vitest installed and configured, first unit tests written for CSV/step-parsing helpers). Remaining: local test-Supabase env loading, integration test helpers/fixtures, smoke test, cross-org isolation test, Playwright setup, one e2e golden-path spec, README updates.
- **Performance NFR validation** — never started.
- **Reports module parts 2-5** — Defect Log view, Risks & Blockers, Action Items, PDF export/charts — all explicitly deferred as future sub-projects. PDF export for Weekly Report snapshots specifically deferred as its own design pass.
- **Test Cases page mobile-responsive two-column layout** — flagged, never scheduled.

---

## Architecture patterns worth knowing before rebuilding

- **`api_*` SECURITY DEFINER function pattern**: every public-API-facing Postgres function takes an already-validated `org_id`, does its own scoping check inline, and is `revoke all ... from public, anon, authenticated` — callable only via `createServiceClient()` (service-role client), never exposed to normal PostgREST/browser sessions.
- **`private` schema helpers**: `private.is_org_member(org_id)`, `private.is_org_admin(org_id)`, `private.project_org_id(project_id)` — the canonical RLS-policy and internal-function building blocks since the `private_schema_hardening` migration. Use these, not ad-hoc `auth.uid()` checks.
- **External-service connections** (Jira, GitHub): `issue_tracker_connections` table, one row per connection, secret stored via `vault.create_secret`, retrieved via a `security definer` function scoped by `is_org_admin`/`is_org_member`. Jira is org-scoped; GitHub is project-scoped (`project_id` column, two partial unique indexes instead of one simple constraint).
- **`Json` type casts**: a TypeScript interface without an index signature isn't structurally assignable to the generated `Json` type — always `import type { Json } from "@/lib/types/database"` + `as unknown as Json` at the call site when passing structured data into a `jsonb` RPC param.
- **`"use server"` file constraint**: every export from a file with `"use server"` at the top must be async (Next.js treats every export as a potential Server Action reference). Pure helper functions needing unit tests must live in a separate file with no directive (see `src/lib/actions/test-cases-helpers.ts` pattern).
- **Server Component → Client Component function props**: only real Server Actions (marked `"use server"`, or `.bind()`'d versions of them) can cross this boundary as callable props — a plain inline `async () => {}` defined in a Server Component's render body will crash at runtime ("Functions cannot be passed directly to Client Components"). This actually broke the Jira integration page this session — fixed by passing `null` instead of a dummy function when there's no connection yet, and typing the prop as `(() => void) | null`. **If rebuilding this page, don't reintroduce the inline-dummy-function pattern.**
- **`RETURNS TABLE (col_name ...)` in plpgsql** implicitly declares a variable with that name — qualify with the table name in correlated subqueries elsewhere in the function body to avoid "ambiguous column" errors (bit this once in the CI-ingestion `order_index` calculation).
- **Hydration-safe dates**: always pass explicit `"en-US"` locale + `timeZone: "UTC"` to `toLocaleDateString`/`toLocaleString` in Client Components that get SSR'd and hydrated.
- **SSR-safe `localStorage` reads**: use `useSyncExternalStore`, not `useEffect` + `setState` (the latter trips the `react-hooks/set-state-in-effect` lint rule and risks hydration mismatches).

---

## Testing status (as of loss)

- Vitest installed and working (`npm test` → `vitest run --project unit`), unit tests existed for: CSV/step-parsing helpers, clipboard image extraction, weekly-report metrics, GitHub HMAC signature verification, ingest request validation. All test *files* are gone with the source — the *specs* for what they covered are listed above so they can be rewritten quickly.
- No integration test harness ever got built (the `automated-test-suite` plan's Tasks 5+ were never reached) — every "integration-shaped" verification in this project was done manually against the live Supabase project instead.
- No e2e tests (Playwright) were ever actually installed, despite being planned.

---

## If you're picking this up cold

1. Confirm whether the source is truly unrecoverable (see recovery steps at the top) before rebuilding from scratch.
2. If rebuilding: start by running `generate_typescript_types` against `ucnfcsosbdgknmzyuqbw` to get the real, current `database.ts` — this tells you the exact current shape of every table and RPC function, which is more reliable than reconstructing it from memory.
3. `list_migrations` (shown above) gives you the exact sequence of schema changes in order — each migration's SQL can be pulled from Supabase directly if you need the literal DDL (the schema itself is live; only the migration *files* on disk are gone).
4. This document's "Architecture patterns" section captures the non-obvious conventions that took real debugging to discover — worth preserving in whatever replaces this file.
