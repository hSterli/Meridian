# CI-Triggered Run Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Note for this repo**: neither named sub-skill is installed here — execute via a fresh general-purpose subagent per task, with the orchestrator reviewing each task's actual diff before dispatching the next (same approach used for every prior plan this session).

**Goal:** Let a CI pipeline report an entire test run's results to Meridian in one API call, auto-creating the run and any unmatched test cases, without a human pre-creating anything through the UI.

**Architecture:** One new SECURITY DEFINER SQL function (`api_ingest_run_results`) doing all the work in a single transaction — verify the project, create the run, get-or-create a "CI Imported" feature, then for each result get-or-create a test case by title and insert its run-case row — fronted by one new `POST /api/v1/runs/ingest` route following the exact auth/rate-limit/RPC-call/response shape every other `/api/v1` route already uses.

**Tech Stack:** Next.js 16 Route Handlers, Supabase (Postgres SECURITY DEFINER functions, service-role client), TypeScript.

**Known repo quirk to watch for:** every `Write` tool call in this project has a history of appending a stray literal `</content>` line at the end of the file. After every `Write` call below, run `tail -3 <file>` to check for it and strip it with `sed -i '' -e '/^<\/content>$/d' <file>` if present, before moving on.

**Supabase project ref for MCP tools:** `ucnfcsosbdgknmzyuqbw`.

---

### Task 1: Migration — `api_ingest_run_results`

**Files:**
- Create: `supabase/migrations/00XX_ci_run_ingestion.sql` (see Step 1 for how to determine `XX`)

- [x] **Step 1: Confirm the next free migration number**

Run: `ls supabase/migrations/ | tail -5`
As of this plan being written, `0020_weekly_status_reports.sql` is the latest applied — expect `0021` to be free, but use whatever the actual latest number + 1 is if something else has landed since. Name the file `supabase/migrations/0021_ci_run_ingestion.sql` (adjusting the number to match).

- [x] **Step 2: Write the migration**

```sql
-- CI-triggered run ingestion: lets a CI pipeline report an entire test
-- run's results in one call, without a human pre-creating the run. See
-- docs/superpowers/specs/2026-08-09-ci-triggered-run-ingestion-design.md.
--
-- p_key_id is the API key making the request (already resolved by
-- validate_api_key in the route handler, never caller-supplied) — its
-- created_by is what test_runs.created_by / test_cases.created_by get set
-- to, since both are NOT NULL and there's no signed-in human (auth.uid())
-- in an API-key-authenticated request.
create or replace function api_ingest_run_results(
  p_org_id uuid,
  p_key_id uuid,
  p_project_id uuid,
  p_run_name text,
  p_results jsonb
)
returns table (run_id uuid, matched integer, auto_created integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid;
  v_run_id uuid;
  v_feature_id uuid;
  v_result jsonb;
  v_test_case_id uuid;
  v_matched integer := 0;
  v_auto_created integer := 0;
begin
  if not exists (select 1 from projects where id = p_project_id and org_id = p_org_id) then
    raise exception 'Project not found in this organization.';
  end if;

  select ak.created_by into v_creator
  from api_keys ak
  where ak.id = p_key_id and ak.org_id = p_org_id;

  if v_creator is null then
    raise exception 'API key not found in this organization.';
  end if;

  insert into test_runs (project_id, name, status, created_by, completed_at)
  values (p_project_id, p_run_name, 'completed', v_creator, now())
  returning id into v_run_id;

  -- Get-or-create the "CI Imported" feature. This is safe to do atomically
  -- with ON CONFLICT (unlike the equivalent TypeScript upsertFeature helper
  -- in src/lib/actions/test-cases.ts, which needs a manual
  -- select-insert-reselect-on-23505 dance specifically because it's split
  -- across multiple round-trips from a client) since this whole function
  -- runs as one statement-level transaction.
  insert into test_case_features (project_id, name)
  values (p_project_id, 'CI Imported')
  on conflict (project_id, name) do nothing;

  select id into v_feature_id
  from test_case_features
  where project_id = p_project_id and name = 'CI Imported';

  for v_result in select * from jsonb_array_elements(p_results)
  loop
    select id into v_test_case_id
    from test_cases
    where project_id = p_project_id and title = (v_result->>'title');

    if v_test_case_id is null then
      insert into test_cases (project_id, title, feature_id, created_by, status)
      values (p_project_id, v_result->>'title', v_feature_id, v_creator, 'draft')
      returning id into v_test_case_id;
      v_auto_created := v_auto_created + 1;
    else
      v_matched := v_matched + 1;
    end if;

    insert into test_run_cases (run_id, test_case_id, status, notes, executed_at, order_index)
    values (
      v_run_id,
      v_test_case_id,
      (v_result->>'status')::run_case_status,
      v_result->>'notes',
      now(),
      coalesce((select max(order_index) + 1 from test_run_cases where run_id = v_run_id), 0)
    );
  end loop;

  return query select v_run_id, v_matched, v_auto_created;
end;
$$;

revoke all on function api_ingest_run_results(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
```

- [x] **Step 3: Apply the migration to the live project**

Use the Supabase MCP `apply_migration` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`, `name: "ci_run_ingestion"`, and the SQL above as `query`.

- [x] **Step 4: Manual verification against the live project**

There's no way to make a real authenticated HTTP request from this environment (no way to generate and use a real API key end-to-end), so verify the function directly via SQL — this also proves the whole get-or-create/matching flow works correctly before the route even exists.

First, get a real org id, project id, and a throwaway API key to test with. Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select id as org_id from organizations where name = 'TEST QA';
```

```sql
select id as project_id from projects where name = 'Customer Portal Revamp';
```

```sql
insert into api_keys (org_id, name, key_hash, created_by)
select o.id, 'ingestion-test-key', 'test-hash-not-a-real-key', u.id
from organizations o, auth.users u
where o.name = 'TEST QA' and u.email = 'qa.tester@meridianqa.dev'
returning id as key_id;
```

Save the returned `org_id`, `project_id`, and `key_id`. Then call the function with a mix of a title that already exists in that project (any real test case title from "Customer Portal Revamp" — e.g. `'User can log in with valid credentials'`) and one that doesn't (a made-up title), to exercise both the matched and auto-created paths in one call:

```sql
select * from api_ingest_run_results(
  '<org_id>'::uuid,
  '<key_id>'::uuid,
  '<project_id>'::uuid,
  'CI: main @ verification-test',
  '[
    {"title": "User can log in with valid credentials", "status": "passed"},
    {"title": "A brand new CI-only test nobody has seen before", "status": "failed", "notes": "Simulated failure for verification"}
  ]'::jsonb
);
```

Expected: one row, `matched = 1`, `auto_created = 1`. Then verify the side effects:

```sql
select name, status from test_runs where name = 'CI: main @ verification-test';
```
Expected: one row, `status = 'completed'`.

```sql
select tc.title, tc.status, tcf.name as feature
from test_cases tc join test_case_features tcf on tcf.id = tc.feature_id
where tc.title = 'A brand new CI-only test nobody has seen before';
```
Expected: one row, `status = 'draft'`, `feature = 'CI Imported'`.

```sql
select trc.status, trc.notes
from test_run_cases trc
join test_runs tr on tr.id = trc.run_id
where tr.name = 'CI: main @ verification-test'
order by trc.order_index;
```
Expected: two rows — `passed`/null-notes, then `failed`/`'Simulated failure for verification'`.

This verification's rows (the throwaway API key, the new run, the new draft test case) are fine to leave in place — the "Customer Portal Revamp" project already serves as this app's realistic seeded demo data, and a CI-originated run/draft-case is a natural, harmless addition to that story rather than something that needs cleanup.

- [x] **Step 5: Run the security advisor check**

Use the Supabase MCP `get_advisors` tool with `type: "security"` against `ucnfcsosbdgknmzyuqbw`. Expected: only pre-existing, already-reviewed items — no new warning for `api_ingest_run_results`, since it's revoked from `public`/`anon`/`authenticated` exactly like every other `api_*` function.

- [x] **Step 6: Commit**

```bash
git add supabase/migrations/0021_ci_run_ingestion.sql
git commit -m "Add api_ingest_run_results for CI-triggered run ingestion"
```

(Adjust the migration filename in this command if the actual number determined in Step 1 differs from 0021.)

---

### Task 2: Regenerate TypeScript types

**Files:**
- Modify: `src/lib/types/database.ts`

- [x] **Step 1: Regenerate types from the live schema**

Use the Supabase MCP `generate_typescript_types` tool with `project_id: "ucnfcsosbdgknmzyuqbw"`.

- [x] **Step 2: Add the new function's entry to the `Functions` block**

In `src/lib/types/database.ts`, the `Functions` block (currently starting around line 1009) lists each RPC function alphabetically — `api_create_run_result`, `api_get_run`, `api_get_test_case`, `api_list_runs`, then (alphabetically) `api_get_run` comes before `api_get_test_case` and `api_ingest_run_results` sorts between `api_get_test_case` and `api_list_runs`. Insert it there. This function returns a plain `table(...)`, not `setof <existing table>`, so — unlike `api_create_run_result`/`api_get_run`/etc., which have a `SetofOptions` block — this entry should have no `SetofOptions`, matching the shape any other plain `returns table(...)` function in this codebase has (check the actually-generated output from Step 1 for the exact real shape rather than assuming — this is a prediction to verify against, not to copy blindly):

```ts
      api_ingest_run_results: {
        Args: {
          p_key_id: string
          p_org_id: string
          p_project_id: string
          p_results: Json
          p_run_name: string
        }
        Returns: {
          auto_created: number
          matched: number
          run_id: string
        }[]
      }
```

- [x] **Step 3: Verify the type compiles**

Run: `npx tsc --noEmit`
Expected: no output.

- [x] **Step 4: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "Regenerate types for api_ingest_run_results"
```

---

### Task 3: The `POST /api/v1/runs/ingest` route

**Files:**
- Create: `src/app/api/v1/runs/ingest/route.ts`

- [ ] **Step 1: Write the route**

This mirrors `src/app/api/v1/runs/[id]/results/route.ts`'s exact structure (read that file in full first — auth → rate limit → parse/validate JSON body → call the RPC via the service client → shape the response), extended for a batch payload instead of a single result.

Create `src/app/api/v1/runs/ingest/route.ts`:

```ts
import { authenticateApiRequest } from "@/lib/api/auth";
import { rateLimitApiKey } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

const VALID_STATUSES = ["passed", "failed", "blocked", "skipped"] as const;

interface IngestResult {
  title?: string;
  status?: string;
  notes?: string;
}

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

  const { projectId, runName, results } = (body ?? {}) as {
    projectId?: string;
    runName?: string;
    results?: IngestResult[];
  };

  if (!projectId) {
    return Response.json({ error: "projectId is required." }, { status: 400 });
  }
  if (!runName) {
    return Response.json({ error: "runName is required." }, { status: 400 });
  }
  if (!Array.isArray(results) || results.length === 0) {
    return Response.json({ error: "results must be a non-empty array." }, { status: 400 });
  }

  for (const r of results) {
    if (!r.title) {
      return Response.json({ error: "Each result requires a title." }, { status: 400 });
    }
    if (!r.status || !(VALID_STATUSES as readonly string[]).includes(r.status)) {
      return Response.json(
        { error: `Each result's status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("api_ingest_run_results", {
    p_org_id: auth.orgId,
    p_key_id: auth.keyId,
    p_project_id: projectId,
    p_run_name: runName,
    p_results: results,
  });

  if (error) return Response.json({ error: error.message }, { status: 400 });
  const row = data?.[0];
  return Response.json(
    { data: { runId: row?.run_id, matched: row?.matched, autoCreated: row?.auto_created } },
    { status: 201 }
  );
}
```

Check for the stray `</content>` line: `tail -3 src/app/api/v1/runs/ingest/route.ts`.

Note: `results` accepts `pending` nowhere in `VALID_STATUSES` here — deliberately narrower than the existing single-result endpoint's list, since a CI report describes results that already happened (per the design spec, scope decision — `pending` doesn't make sense as an ingested status).

- [ ] **Step 2: Verify types, lint, and build**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/app/api/v1/runs/ingest/route.ts`
Expected: no output.

Run: `npm run build`
Expected: build succeeds, and the route list includes `ƒ /api/v1/runs/ingest`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/runs/ingest/route.ts
git commit -m "Add POST /api/v1/runs/ingest for CI-triggered run ingestion"
```

---

### Task 4: README documentation with CI config examples

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read the current README's API documentation section in full**

Find where the existing `/api/v1` endpoints are documented (search for "Public REST API" or `/api/v1`) — read the surrounding section fully to match its existing style before adding to it.

- [ ] **Step 2: Add the new endpoint's documentation**

Add a bullet or subsection (matching the style of what's already there) documenting `POST /api/v1/runs/ingest`: its request/response shape, and that it auto-creates the run plus any unmatched test cases (tagged under a "CI Imported" feature, `status: draft`).

- [ ] **Step 3: Add GitHub Actions and GitLab CI example snippets**

Add a short "CI Integration" section with copy-pasteable examples. GitHub Actions step (assumes a JSON test report already exists at `results.json` in the shape Meridian expects — the example focuses on the upload call, not on generating that JSON, since that step is framework-specific):

```yaml
      - name: Report results to Meridian
        run: |
          curl -X POST https://your-meridian-instance.example.com/api/v1/runs/ingest \
            -H "Authorization: Bearer ${{ secrets.MERIDIAN_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d @results.json
```

GitLab CI equivalent:

```yaml
report_to_meridian:
  stage: report
  script:
    - >
      curl -X POST https://your-meridian-instance.example.com/api/v1/runs/ingest
      -H "Authorization: Bearer $MERIDIAN_API_KEY"
      -H "Content-Type: application/json"
      -d @results.json
```

And a short note showing the exact `results.json` shape both examples assume:

```json
{
  "projectId": "your-meridian-project-id",
  "runName": "CI: main @ ${CI_COMMIT_SHORT_SHA}",
  "results": [
    { "title": "test name matching a Meridian test case", "status": "passed" },
    { "title": "another test", "status": "failed", "notes": "why it failed" }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document CI-triggered run ingestion with GitHub Actions/GitLab CI examples"
```

---

### Task 5: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full verification suite**

```bash
npx tsc --noEmit
```
Expected: no output.

```bash
git ls-files '*.ts' '*.tsx' | xargs npx eslint
```
Expected: no new errors/warnings beyond the one pre-existing accepted warning in `src/lib/actions/issue-tracker.ts`.

```bash
npm test
```
Expected: all existing unit tests still pass (this task adds no new unit-testable pure logic — the new code is a thin route handler plus SQL, matching the design spec's own Testing section).

```bash
npm run build
```
Expected: production build succeeds, `/api/v1/runs/ingest` appears in the route list.

```bash
git status --short
```
Expected: clean.

- [ ] **Step 2: Confirm task #38 is fully addressed**

Re-read `docs/superpowers/specs/2026-08-09-ci-triggered-run-ingestion-design.md`'s scope decisions one more time and confirm each is reflected: bulk ingestion in one call (Task 3), title-match-or-auto-create (Task 1's function), "CI Imported" feature tagging (Task 1), JSON-only/no JUnit (Task 3 — no XML parsing exists), no per-key scoping (unchanged), each trigger creates a new run (Task 1 — no update-existing-run path exists). No gaps expected; this step is a final sanity check, not new work.
