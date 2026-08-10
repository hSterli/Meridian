# CI-Triggered Run Ingestion — Design

**Date**: 2026-08-09
**Status**: Approved, pending implementation
**Context**: First of six sequenced projects addressing the remaining "must have" and TestRail-differentiator gaps identified from a competitive feature checklist. This is task #38 from the original V1/P0 backlog — explicitly anticipated when the public API/webhook infrastructure was designed (`docs/superpowers/specs/2026-08-03-public-api-webhook-infrastructure-design.md` §7.3), which reused `api_create_run_result` as its foundation but never built the create-run or bulk-ingestion pieces this needs.

## Problem

Today, recording a test run in Meridian always requires a human: create the run through the UI, then either execute it interactively or (via the existing public API) call `POST /api/v1/runs/[id]/results` once per test against an already-existing run. There's no way for a CI pipeline (GitHub Actions, GitLab CI, CircleCI, Jenkins, etc.) to report results unattended — it would need a human to have pre-created a run before every single CI execution, which defeats the purpose of automation.

## Scope decisions

1. **Bulk ingestion, one call per CI run** — a single `POST` carries the run name and every result together, rather than requiring CI scripts to create a run then loop calling the existing single-result endpoint hundreds of times. Matches how CI naturally produces output: one test suite execution, one report.
2. **Match test results to Meridian test cases by exact title; auto-create a stub if no match exists.** CI frameworks report tests by their own name (pytest ID, Jest `describe`/`it` string, etc.), which won't correspond to a Meridian `test_case` UUID. Requiring CI to already know Meridian's internal IDs would mean manual per-test setup before CI integration is useful at all — auto-creating a minimal stub (title only, `status = 'draft'`) means CI ingestion works immediately, and unmatched tests surface as new draft cases a human can flesh out later rather than being silently dropped.
3. **Auto-created stub cases go into a "CI Imported" feature**, get-or-created per project the first time it's needed — satisfies `test_cases.feature_id`'s `NOT NULL` constraint (every test case must belong to a feature) without inventing a new schema concept, and gives CI-originated cases a clear, filterable label rather than dumping them into whatever feature happens to already exist.
4. **Custom JSON only for this pass, not JUnit XML.** JUnit XML is the de facto standard most frameworks can emit natively, and would mean zero conversion work for CI — a real, meaningful future improvement — but it's a genuinely separate scope of work (an XML parser, JUnit's framework-specific quirks) better done as its own follow-up once the core ingestion path is proven.
5. **No per-key read/write scoping.** `api_keys` has no scope/permission column today — every key can already do everything the API supports, including the existing write endpoint. Adding scoping is a bigger, separate change untouched by this design.
6. **Each CI trigger always creates a new run** — there's no "append more results to an already-ingested CI run" concept. A re-run of the same CI job produces a new Meridian run, mirroring how CI itself treats each pipeline execution as independent.

## API

**`POST /api/v1/runs/ingest`** (new route, same Bearer-API-key auth as every other `/api/v1` endpoint via `authenticateApiRequest`):

Request:
```json
{
  "projectId": "uuid",
  "runName": "CI: main @ a1b2c3d",
  "results": [
    { "title": "test_login_success", "status": "passed" },
    { "title": "test_login_invalid_password", "status": "failed", "notes": "AssertionError: ..." }
  ]
}
```
`status` must be one of the existing `run_case_status` values (`passed`/`failed`/`blocked`/`skipped` — `pending` doesn't make sense for a result CI is actively reporting, and is rejected). `results` must be a non-empty array; a missing/empty `projectId`, `runName`, or `results` is a 400, matching the existing validation style in `runs/[id]/results/route.ts`.

Response (201):
```json
{ "data": { "runId": "uuid", "matched": 8, "autoCreated": 2 } }
```

**Rate limit**: 20 requests per hour per key (`rateLimitApiKey(keyId, "api_ingest_run_results", 20, 3600)`) — this is one call per CI run, not one per test, so it needs nowhere near the existing single-result endpoint's 300/300s.

## Backend

One new SECURITY DEFINER function, `api_ingest_run_results(p_org_id uuid, p_project_id uuid, p_run_name text, p_results jsonb)`, following the exact grant pattern already established for every `api_*` function (`revoke all ... from public, anon, authenticated`, callable only via the service-role client from the API route):

1. Verify `p_project_id` belongs to `p_org_id` (same defense-in-depth check every other `api_*` function already does) — raise if not.
2. Look up the API key's `created_by` (join through `api_keys` via a `p_key_id` the route also passes in) to use as the attribution for every row this function creates.
3. Insert the `test_runs` row directly with `status = 'completed'` and `completed_at = now()` — a CI report describes a run that already finished, not one just starting, so there's no `'planned'`/`'in_progress'` phase to pass through. `created_by` is the API key's own creator (see below).
4. Get-or-create the project's "CI Imported" feature: `insert into test_case_features (project_id, name) values (p_project_id, 'CI Imported') on conflict (project_id, name) do nothing`, then select its id — atomic within the function, no separate race-condition handling needed the way the equivalent TypeScript `upsertFeature` helper needs (that one has a select→insert→re-select-on-23505 dance specifically because it's split across two round-trips from a client; a single plpgsql function can just use `on conflict ... do nothing` directly).
5. Loop over `p_results` (`jsonb_array_elements`): for each, look up an existing `test_case` by `(project_id, title)`; if none, insert one with the "CI Imported" feature id, `status = 'draft'`, `created_by` = the API key's creator. Then insert the corresponding `test_run_case` (`status`, `notes`, `executed_at = now()`, `order_index` auto-incremented per run — same `coalesce(max(order_index)+1, 0)` pattern `api_create_run_result` already uses).
6. Return the run id plus counts of matched-vs-auto-created test cases, for the response summary.

**On `created_by` (`test_runs.created_by` and `test_cases.created_by` are both `NOT NULL` references to `auth.users`, and there's no real human in a CI-triggered request):** attribute every row this function creates to the API key's own `created_by` — the admin who issued the key. No schema change needed, and it's a reasonable "this happened on behalf of whoever issued this credential" semantic, consistent across both tables.

## Deliverable: CI config examples

Short, copy-pasteable snippets for GitHub Actions and GitLab CI showing a script step that converts native test output (e.g. `pytest --json-report` or a Jest reporter's JSON output) into this endpoint's request shape and posts it with `curl`, added to the README's API section alongside the existing endpoint documentation.

## Explicitly out of scope

- JUnit XML ingestion (deferred, see scope decision 4).
- Per-key read/write/project scoping.
- Re-ingesting additional results into an already-created CI run.
- Any UI treatment distinguishing CI-created runs from UI-created ones beyond the run's name and the "CI Imported" feature tag on auto-created cases (no new "source" column).

## Testing

Fits the automated-test-suite infrastructure already in this repo: the request-body validation (rejecting empty `results`, invalid `status` values) is pure and unit-testable the same way the CSV/step-parsing helpers already are. The get-or-create/matching logic itself lives in SQL and is best verified manually against the live Supabase project (matching how every other `api_*` function in this codebase has been verified this session — no integration test harness exists yet for API-key-authenticated requests).
