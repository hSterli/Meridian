# Meridian QA — Build Status Report

**As of**: 2026-07-26 · **Latest commit**: `8fc5a23` · **Live project**: `meridian-qa` (`ucnfcsosbdgknmzyuqbw`)

Purpose: a single place to see what's actually shipped, what's stubbed but
not real, what's explicitly out of scope, and what to prioritize next. Written
because the Flaky Test Detective work was paused mid-scoping and it was a
good moment to take stock before picking the next thread.

---

## 1. Shipped and working

Everything below is implemented, RLS-secured, and passes `tsc`/`eslint`/`build`.

### Auth, orgs, RBAC
- Email/password auth (Supabase Auth), guided onboarding (signup → create org → create first project from a starter template)
- Owner/admin/member roles, invite-by-email (auto-joins on next login if the email matches a pending invite), role changes, member removal
- Multi-org support with an active-org switcher (cookie-based)

### Test case management
- CRUD with version history (every edit snapshots the prior version)
- Required structured **Feature** field (project-managed list, pick-existing-or-add-new)
- Optional **sprint number**, free-form tags, priority (low/medium/high/critical), status (active/draft/deprecated)
- **Ownership & automation tracking** (added this session): assignable owner distinct from creator, automation status (manual only / to be automated / automated) with an optional script reference, optional external reference link (e.g. a Jira ticket URL)
- **Real file attachments**: upload/download/delete via a private Supabase Storage bucket, path-gated RLS (`${projectId}/${testCaseId}/${filename}`)
- Native drag-and-drop step reordering
- Dynamic filters (search, feature, priority, status, tag), grouping the library by feature or by sprint
- Stable per-project display IDs (`{PROJECT_KEY}-{n}`), owner avatar + last-execution-result column, Suites sidebar filter, pill-style tag filters
- CSV import/export (round-trips all fields including sprint number)
- All native `<select>` dropdowns replaced with a shared, custom-styled `Select` component; sprint number uses a custom stepper instead of the browser-default number spinner

### Test execution
- Run creation from a test-case picker, with optional folder and/or suite assignment
- Keyboard-driven execution UI (P/F/B/S shortcuts, arrow-key navigation), notes per result
- "Add test cases" to append more cases to an already-created run
- Runs list: sortable table (name, status, instances, last updated), per-run segmented pass/fail/blocked/skipped status bar, folder sidebar, multi-select bulk delete/move-to-folder

### Test Suites
- Reusable, named test case groupings (e.g. "Regression") that can be re-run on demand
- "Run now" snapshots current membership into a fresh run (past results don't shift if membership changes later)
- Last-run date, pass rate, and full run history per suite
- Can now create a brand-new test case directly from an (empty or non-empty) suite screen, auto-assigned into that suite

### Issues
- Native lightweight tracker, linkable to a test case and/or a specific run result
- Status workflow: open → in progress → resolved → closed

### Dashboard
- Stat tiles (projects, test cases, runs this week, open issues)
- Recent-run pass/fail trend
- **Flaky-test tracker v0**: flags test cases with both a pass and a fail somewhere in history, top 5, sorted by fail count — this is the seed the paused Flaky Test Detective work was meant to replace with real scoring (see §4)
- Coverage by project
- Filterable to a single project via `?project=` dropdown

### Design system
- Full "Paper/Ink" token set (colors, fonts via `next/font/google`, no CDN) applied consistently via Tailwind v4 `@theme`
- Shared primitives (`Card`, `Badge`, `Button`, `Input`, `Select`, `NumberStepper`, `Label`) so new pages inherit the look for free

### Security & rate limiting
- RLS on every table; helper functions (`is_org_member`, `is_org_admin`, `project_org_id`) live in a non-exposed `private` schema so they can't be called directly via REST
- Per-user Postgres-backed rate limiting (`check_rate_limit`) on all authenticated writes, bucket key always derived server-side from `auth.uid()`
- CSP/HSTS/security headers in `next.config.ts`, correctly scoped dev vs. prod
- Supabase security advisors clean except four known, reviewed, intentional items (see README → Security notes)

---

## 2. Built but not real yet (UI stubs / placeholders)

These render in the app today but don't do anything — visible "Coming soon" badges, not hidden:

| Location | What's stubbed |
|---|---|
| `/reports` | Pass/fail trend, coverage-by-requirement, team velocity, flaky-test deep dive — all placeholder cards |
| `/settings` | Organization settings, Integrations (Jira/GitHub/GitLab/Slack/CI), Billing — all placeholder rows |
| Test Cases sidebar | "Coverage" card (requirement coverage metrics) — placeholder |
| Test Cases sidebar | "AI Case Generation" — placeholder Pro-tier upsell card, disabled button |
| `test_cases.custom_fields` | jsonb column exists in schema, reserved for a future custom-field engine, unused in any UI |

None of these have backing logic. They exist so the nav/IA reads correctly and so upgrade paths are visible, not because anything is half-wired.

---

## 3. Explicitly deferred (per the original PRD, Phase 2/3)

Carried forward from README, still accurate:

- Jira/GitHub/GitLab two-way issue sync
- CI-triggered automated run ingestion via webhook
- Requirements management / traceability
- AI features (duplicate detection, test-value signal)
- Billing/plan tiers, regional data residency, SSO/SAML
- Full custom-field engine

**Why**: the PRD's own strategic positioning explicitly defers this depth to a Phase 3 enterprise tier, to avoid recreating the complexity PractiTest is criticized for. Not started, not partially started.

---

## 4. Raised mid-session, not yet built

### Waterfall / compliance-heavy documentation (raised, scoped, deliberately not built)
Full writeup in `docs/session-notes.md`. Summary of what's still missing if/when this gets prioritized:
- **Risk register** — no entity for this yet; nothing in the schema models risk/severity/mitigation tracking
- **Multiple/categorized defect lists** — today there's one flat `issues` list per project; would reuse the Suites/Folders pattern (grouping table + membership), not a schema rewrite
- **Scheduled daily/weekly reports** — the underlying pass/fail trend and flaky-test data already exist; missing piece is delivery (cron/schedule + digest template, email or Slack)
- **Evidence-heavy documentation** — **partially resolved this session**: test cases now support real file attachments via Storage. Test *run results* (`test_run_cases`) still have no attachment path — the same bucket/RLS pattern would extend directly to that
- **External integration** — never resolved what "some level of integration" meant (compliance export? two-way defect sync? something else). Needs a follow-up conversation before scoping.

### Flaky Test Detective (paused mid-brainstorm)
A large external PRD (`Flaky_Test_Detective_PRD_with_Azure.md`) was supplied as "to be integrated, expected to be a paid feature." On review, that document specs an entire **separate CI-observability SaaS business** — GitHub Actions/CircleCI/Jenkins/Azure Pipelines webhook ingestion, its own AWS infrastructure, Slack/email digest systems, Azure AD SSO, on-premise Docker deployment, SOC2/HIPAA compliance programs, and its own sales/marketing/pricing plan for a $14M ARR business. Almost none of that matches Meridian as it exists: **Meridian has no CI pipeline integration today** — tests are executed manually by a person inside a Test Run, not by an external CI system, so no branch/commit/agent/OS data ever enters Meridian.

**Status**: paused before the first scoping question was answered. The live open question, unresolved:

> Should the feature (a) compute flakiness purely from Meridian's own existing `test_run_cases` history — ships fast, no new integrations, but root-cause detection is limited to what Meridian already tracks — or (b) additionally build CI webhook ingestion so external systems can push automated results in, unlocking richer root-cause signals (branch/commit/agent) but effectively adding a second product surface that needs its own separate scoping pass?

Also unresolved: how "paid feature" gating should work at all, since Meridian has **no plan/billing infrastructure** yet (see §3 — billing is explicitly deferred). A minimal gate (e.g. a plan flag per org, manually settable) is a very different lift than real Stripe billing, and that choice hasn't been made either.

**Nothing has been built for this feature** — no schema, no code. Pick up by resuming the paused clarifying-question flow whenever it's prioritized again.

---

## 5. Known gaps outside the PRD checklist

Things worth knowing even though no one explicitly asked for them yet:

- **No automated test suite for Meridian itself.** There's no Jest/Vitest/Playwright configured (`package.json` only has `dev`/`build`/`start`/`lint`). All verification this whole build has relied on `tsc --noEmit`, `eslint`, `next build`, Supabase advisors, and manual/browser smoke checks. Fine for a fast-moving solo build; a real risk if more contributors join or the surface area keeps growing.
- **No staging environment.** One live Supabase project (free tier) serves as the only environment. Schema changes go straight to what is effectively production.
- **Leaked Password Protection** is still off in Supabase Auth — a one-click Dashboard setting, no code/MCP path exists to toggle it, flagged every session, never actioned.
- **Manual-only test execution** is a real product-shape decision, not an oversight: Meridian assumes a human runs the test case. Any future feature that wants CI-originated signal (flaky test detection chief among them) runs into this immediately.
- **Single point of ownership.** No CI/CD pipeline deploys Meridian itself; deploys and migrations are applied by hand via the Supabase MCP tools in this session.

---

## 6. Suggested next priorities

Roughly in order of value-for-effort, not a commitment:

1. **Resume Flaky Test Detective scoping** — answer the data-source question above, then design the paid-gate mechanism. Highest-leverage unfinished thread; a scoped version (§4, option a) is genuinely buildable in the current architecture.
2. **Evidence attachments on run results** — small lift given the test-case attachment work just landed; directly extends the same Storage/RLS pattern to `test_run_cases`.
3. **Reports page: make one real** — the flaky-test deep dive is the closest to already having its data model; would also retire the dashboard's "top 5" limit.
4. **Decide the billing/plan story** — even a minimal `org.plan` flag unblocks every "paid feature" conversation (Flaky Test Detective, AI Case Generation, Coverage) that's currently stuck behind disabled UI.
5. **Settings → Organization** — currently 100% stub; likely low effort (name/slug edit already exists as data, just needs a form) and removes one of the more visible "fake" surfaces in the app.
