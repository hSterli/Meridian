# Automated Test Suite for Meridian QA — Design

**Date**: 2026-07-26
**Status**: Approved, pending implementation plan
**Context**: First of three infra priorities requested (test suite → staging environment → billing infra), chosen first specifically because it's foundational and de-risks the other two.

## Problem

Meridian has zero automated testing today. `package.json` only defines `dev`/`build`/`start`/`lint`. Every change in this project has been verified via `tsc --noEmit`, `eslint`, `next build`, Supabase security advisors, and manual/browser smoke checks — no regression safety net exists for business logic or, more importantly, for RLS policies, which are the app's core multi-tenant security boundary.

## Constraints discovered during scoping

- **Supabase org (`Sterling LLC.`) is on the free plan.** `get_organization` confirms `"plan":"free"`, and `list_branches` fails outright — **database branching is not available**. This rules out using a Supabase branch as an ephemeral test database.
- **Docker is not installed** on the development machine, so `supabase start` (the standard local dev/test stack) isn't viable out of the box.
- **Homebrew is available**, and `colima` + `docker` CLI (both free, open source) can be installed via Homebrew to unblock `supabase start` without needing Docker Desktop's GUI/licensing flow.
- No CI/CD pipeline exists yet for Meridian itself (that's the next project — the staging-environment work). This test suite must stand on its own without CI.

## Decisions

1. **Local Supabase via colima**, not live-project testing and not skipping real-Postgres testing. Install `colima` + `docker` via Homebrew, then use the Supabase CLI's `supabase start` to get a full local, ephemeral Postgres + Auth + Storage stack. This auto-applies all 13 existing migrations in `supabase/migrations/`, so tests run against the real schema and the real RLS engine — fully isolated from the live project, at zero cost.
2. **Coverage scope: unit + integration + e2e**, not unit-only. Given RLS policies are the highest-stakes part of this app, integration tests that exercise them for real (not mocked) are considered essential, not a stretch goal.
3. **Local-only for this pass — no CI workflow yet.** Wiring the suite into GitHub Actions belongs to the staging-environment project, once there's an actual pipeline/deployment target to attach it to. This project delivers `npm` scripts that run great locally.

## Frameworks

- **Vitest** — unit and integration tests. Native ESM, fast, works cleanly with Next.js 16 + TypeScript without extra Babel config.
- **Playwright** — e2e tests. Industry standard; this environment already has Playwright tooling available, so the mental model carries over directly.
- **colima + docker + Supabase CLI** — local database stack for integration and e2e tests.

## Layout & scripts

```
src/lib/actions/test-cases.ts
src/lib/actions/test-cases.test.ts     ← unit tests, colocated with source

tests/integration/
  cross-org-isolation.test.ts          ← RLS: org A cannot see/write org B's data
  create-test-case.test.ts             ← Server Action happy path + rate-limit rejection
  helpers/
    test-auth.ts                       ← shared "sign in as a real local user" helper
    test-fixtures.ts                   ← shared "create throwaway org/project" helpers

e2e/
  create-test-case.spec.ts             ← golden path: log in → create test case → see it in list
```

Unit tests live next to the source they test (`*.test.ts` beside `*.ts`) so they're easy to find and keep in sync. Integration tests get their own top-level directory and their own Vitest project config, since they require the local Supabase stack to be running and are meaningfully slower than unit tests — this lets `npm test` (fast, no external dependency) stay separate from `npm run test:integration`.

**`package.json` additions**:
- `test` — Vitest, unit project only. Fast default for iteration; no local Supabase required.
- `test:integration` — Vitest, integration project only. Requires the local stack to be running.
- `test:e2e` — `playwright test`. Requires the local stack and a running dev server (Playwright's own `webServer` config starts/stops this automatically).
- `test:all` — runs all three in sequence.
- `test:db:start` / `test:db:stop` — thin wrappers around `supabase start` / `supabase stop`.

## Testing Server Actions and RLS for real

Two patterns make the integration/e2e layers meaningful rather than hollow, since Server Actions and RLS don't have an obvious "unit test" seam:

1. **RLS-as-a-real-user**: Integration tests sign in a throwaway test user against the *local* Supabase instance via `supabase-js` (`signInWithPassword`, using a user created via the local instance's admin API). That authenticated client is then used directly against Postgres, so RLS policies are exercised exactly as a real logged-in user would experience them — not just read as SQL text or verified via `get_advisors`.

2. **Server Actions in isolation**: Server Actions currently read the session via `next/headers`' `cookies()`, which doesn't exist outside a real Next.js request. A shared test helper (`tests/integration/helpers/test-auth.ts`) will:
   - Sign in the throwaway test user (per point 1) and obtain its Supabase session tokens.
   - Stub `next/headers`'s `cookies()` to return a fake cookie jar seeded with those tokens in the `@supabase/ssr` cookie format, so `createClient()` in `src/lib/supabase/server.ts` picks up a real, valid session.
   - Stub `next/cache`'s `revalidatePath`/`revalidateTag` as no-ops (they require a request context that doesn't exist in a test process).
   - Treat `redirect()`'s thrown `NEXT_REDIRECT` signal as an expected success outcome (Next.js implements redirects as a thrown/caught special error, not a return value) rather than an unhandled exception.

   This is a known, if slightly fiddly, pattern for testing Next.js Server Actions in isolation. Building it once as a shared helper means individual integration tests stay short — call the action, assert on the result or the caught redirect target.

## Initial coverage slice

"Automated test suite" for a zero-coverage app is unbounded scope if taken literally. This project delivers the **infrastructure**, plus one meaningful test per layer to prove the whole stack works end-to-end and establish the pattern for all coverage added after this:

- **Unit**: the CSV/step parsing helpers in `src/lib/actions/test-cases.ts` — `parseCsvLine`, `decodeSteps`, `parseSteps`, `resolveFeatureName`, `parseSprintNumber`. Pure logic, zero setup, genuine bug risk (hand-rolled CSV parsing, sprint-number coercion).
- **Integration**:
  - Cross-org isolation: a member of org A cannot read or write org B's projects, test cases, or any RLS-protected table. This is the single highest-stakes security property in the app.
  - `createTestCase`: happy path (creates the row, redirects to the list) and the rate-limit rejection path (returns an error instead of creating a row once the bucket is exhausted).
- **E2E**: one golden path — log in as the seeded local test user → create a test case → see it in the test case list.

Test data isolation within a run uses unique-per-test identifiers (e.g. a `crypto.randomUUID()` suffix in org slugs/emails) rather than a full database reset between every individual test — `supabase db reset` (fresh schema, fresh data) happens once before a test run, not per-test, to keep the suite fast.

## Explicitly out of scope for this pass

- Full coverage of every Server Action, page, or component — this establishes the pattern; broadening coverage is ongoing work done the same way afterward.
- Coverage-percentage gates or enforcement.
- CI wiring (GitHub Actions or similar) — belongs to the staging-environment project.
- Mutation testing, visual regression testing, load/performance testing.

## Open items for the implementation plan

- Exact Vitest config shape for running two "projects" (unit vs. integration) from one config file vs. two separate config files.
- Whether the local test user (for integration + e2e) is created once via a `supabase/seed.sql` fixture or created/torn down per test file — leaning toward per-test-file creation for isolation, to be confirmed during planning.
- Playwright's `webServer` config needs the local Supabase stack already running (it only manages the Next dev server) — document the required `npm run test:db:start && npm run test:e2e` sequence, or investigate a `globalSetup` that starts both.
