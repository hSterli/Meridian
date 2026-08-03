# Automated Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Note for this repo**: neither named sub-skill is installed here — execute via a fresh general-purpose subagent per task, with the orchestrator reviewing each task's actual diff before dispatching the next (same approach used for the three prior plans this session).

**Goal:** Give Meridian its first automated test infrastructure — unit tests for pure logic, integration tests that exercise real RLS policies and Server Actions against a local Postgres, and one e2e browser test — proving the whole stack works and establishing the pattern for all coverage added after this.

**Architecture:** `colima` + `docker` (installed via Homebrew, since the Supabase org is on the free plan with no database branching, and Docker wasn't previously installed) unlocks `supabase start` — a full local, ephemeral Postgres/Auth/Storage stack that auto-applies all 18 existing migrations. Vitest runs unit tests (no external dependency) and integration tests (against the local stack) as two projects in one config. Playwright drives one real browser flow end-to-end. Integration tests authenticate as a real signed-in local user (via `supabase-js`, not faked cookies) and call Server Actions with `@/lib/supabase/server`'s `createClient` mocked to return that authenticated client — this is a concrete refinement of the approved design's "fake cookie jar" idea, chosen during planning because hand-encoding `@supabase/ssr`'s internal cookie serialization format is fragile and version-dependent, while mocking the client factory directly achieves the identical goal (Server Actions see a real authenticated client, so RLS applies exactly as it would for a genuine request) far more robustly.

**Tech Stack:** Vitest (unit + integration), Playwright (e2e), Supabase CLI via `npx` (already proven to work in this repo — see README's existing `npx supabase gen types` workflow), colima + docker (system-level, via Homebrew).

**Known repo quirk to watch for:** every `Write` tool call in this project has a history of appending a stray literal `</content>` line at the end of the file. After every `Write` call below, run `tail -3 <file>` to check for it and strip it with `sed -i '' -e '/^<\/content>$/d' <file>` if present, before moving on.

**A meta-note specific to this plan:** every prior plan this session substituted `npx tsc --noEmit` / `npx eslint <file>` / `npm run build` for the write-test/run-test/pass loop, because no test runner existed. This plan is *about* installing that runner — its own early tasks (before Vitest is installed and proven working) still use that same substitution, but Task 4 onward can and does use real `vitest run` commands as its verification step, exactly like the "Step 2: Run test to verify it fails" / "Step 4: Run test to verify it passes" shape this skill normally expects. Every plan written *after* this one ships can rely on a real test runner from Task 1.

**Directory layout confirmed still valid**: the codebase has grown substantially since this design was approved (7 more migrations, `src/app/api/v1/**`, `src/lib/jira/**`, `src/lib/api/**`, `src/lib/supabase/service.ts`), but none of that changes the layout decision — colocated unit tests next to any source file, `tests/integration/**`, and `e2e/**` at the repo root all still make sense regardless of how many source directories exist under `src/`.

---

### Task 1: Install colima + docker, start the local Docker daemon

**Files:** none (system-level installation)

- [ ] **Step 1: Verify current state**

Run: `which docker colima`
Expected: both `not found` (confirmed during planning — re-verify in case time has passed since then).

- [ ] **Step 2: Install via Homebrew**

Run: `brew install colima docker`
Expected: both install successfully. This is a real, user-visible system change (installing software via Homebrew) — if running this plan interactively rather than via a pre-authorized agent, confirm with the user before running Step 2, the same way any other install step in this project would need confirmation.

- [ ] **Step 3: Start colima**

Run: `colima start`
Expected: takes a minute or two on first run (downloads a VM image). Succeeds with output ending in something like `INFO[0100] done`.

- [ ] **Step 4: Verify Docker works**

Run: `docker info`
Expected: no "Cannot connect to the Docker daemon" error — prints real daemon info (containers, images, server version).

- [ ] **Step 5: No commit needed**

This task has no repo file changes — nothing to commit. Proceed to Task 2.

---

### Task 2: Initialize and start the local Supabase stack

**Files:**
- Create: `supabase/config.toml` (via `supabase init`)
- Modify: `.gitignore`

- [ ] **Step 1: Initialize the Supabase CLI project config**

Run: `npx supabase init`
Expected: creates `supabase/config.toml` (and possibly `supabase/.gitignore`, `supabase/seed.sql` if not present). Since `supabase/migrations/` already exists with 18 files, the CLI should detect and preserve it — if prompted about an existing migrations directory, keep it as-is.

- [ ] **Step 2: Add Supabase CLI local artifacts to `.gitignore`**

Add to the end of `.gitignore`:

```

# supabase local dev
/supabase/.branches
/supabase/.temp
```

- [ ] **Step 3: Start the local stack**

Run: `npx supabase start`
Expected: takes a while on first run (pulls Postgres/GoTrue/Storage/etc. Docker images). Succeeds with output listing local URLs — `API URL`, `DB URL`, `Studio URL`, `anon key`, `service_role key`. **Save this output** — Task 5 needs these values.

- [ ] **Step 4: Verify all 18 migrations applied**

Run: `npx supabase status -o json | grep -c "public\." || true` (a loose sanity check) — better: connect directly:

Run: `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "select count(*) from supabase_migrations.schema_migrations;"`

Expected: `18` (one row per applied migration file). If `psql` isn't installed locally, instead run: `npx supabase migration list` and confirm all 18 files show as applied locally (not just remotely).

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml .gitignore
git commit -m "Initialize local Supabase CLI project config"
```

(Do not commit anything under `supabase/.branches` or `supabase/.temp` — the `.gitignore` addition in Step 2 already prevents this.)

---

### Task 3: Install Vitest and configure the unit test project

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install Vitest**

Run: `npm install --save-dev vitest`

- [ ] **Step 2: Write the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          testTimeout: 20000,
          hookTimeout: 20000,
        },
      },
    ],
  },
});
```

The `resolve.alias` entry mirrors `tsconfig.json`'s `"@/*": ["./src/*"]` mapping exactly — Vitest doesn't read `tsconfig.json` path mappings automatically, so this needs to be declared here too. (`tests/integration/global-setup.ts` doesn't exist yet — that's Task 6 — but it's fine to reference it now; Vitest only errors if you actually run the `integration` project before that file exists, and this task only runs the `unit` project.)

- [ ] **Step 3: Add the `test` script**

In `package.json`, change:
```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  },
```
to:
```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run --project unit"
  },
```

- [ ] **Step 4: Verify Vitest runs (even with zero test files yet)**

Run: `npm test`
Expected: Vitest starts, reports "No test files found" for the `unit` project — this confirms the config itself is valid before any test files exist. (Task 4 adds the first real test file.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "Install Vitest and configure the unit test project"
```

---

### Task 4: First unit tests — CSV/step parsing helpers

**Files:**
- Modify: `src/lib/actions/test-cases.ts` (export the previously-private helper functions so they're testable)
- Create: `src/lib/actions/test-cases.test.ts`

- [ ] **Step 1: Export the helpers under test**

Read the current `src/lib/actions/test-cases.ts` first (it's evolved across three prior projects this session). Find `parseCsvLine`, `decodeSteps`, `parseSteps`, `resolveFeatureName`, and `parseSprintNumber` — each is currently declared as a plain (non-exported) `function`. Change each declaration from `function name(...)` to `export function name(...)`, leaving everything else about them untouched. Do not export anything else in this file — only these five.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/actions/test-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parseCsvLine,
  decodeSteps,
  parseSteps,
  resolveFeatureName,
  parseSprintNumber,
} from "./test-cases";

describe("parseCsvLine", () => {
  it("splits a simple comma-separated line", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields containing commas", () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(parseCsvLine('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
  });

  it("returns a single field for a line with no commas", () => {
    expect(parseCsvLine("solo")).toEqual(["solo"]);
  });
});

describe("decodeSteps", () => {
  it("returns an empty array for an empty string", () => {
    expect(decodeSteps("")).toEqual([]);
  });

  it("decodes a single step", () => {
    expect(decodeSteps("Click login|User is logged in")).toEqual([
      { step: "Click login", expected: "User is logged in" },
    ]);
  });

  it("decodes multiple steps separated by ;;", () => {
    expect(decodeSteps("Step one|Expected one;;Step two|Expected two")).toEqual([
      { step: "Step one", expected: "Expected one" },
      { step: "Step two", expected: "Expected two" },
    ]);
  });

  it("defaults expected to empty string when missing", () => {
    expect(decodeSteps("Just a step")).toEqual([{ step: "Just a step", expected: "" }]);
  });
});

describe("parseSteps", () => {
  it("parses valid JSON steps", () => {
    const raw = JSON.stringify([{ step: "Do a thing", expected: "It works" }]);
    expect(parseSteps(raw)).toEqual([{ step: "Do a thing", expected: "It works" }]);
  });

  it("defaults expected to empty string when missing from the object", () => {
    const raw = JSON.stringify([{ step: "Do a thing" }]);
    expect(parseSteps(raw)).toEqual([{ step: "Do a thing", expected: "" }]);
  });

  it("filters out entries without a string step field", () => {
    const raw = JSON.stringify([{ step: "Valid" }, { notStep: "Invalid" }, { step: 123 }]);
    expect(parseSteps(raw)).toEqual([{ step: "Valid", expected: "" }]);
  });

  it("returns an empty array for invalid JSON", () => {
    expect(parseSteps("not json")).toEqual([]);
  });

  it("returns an empty array when the JSON isn't an array", () => {
    expect(parseSteps('{"not": "an array"}')).toEqual([]);
  });
});

describe("resolveFeatureName", () => {
  it("returns the selected feature when not the new-feature sentinel", () => {
    const formData = new FormData();
    formData.set("feature", "Checkout");
    expect(resolveFeatureName(formData)).toBe("Checkout");
  });

  it("returns the trimmed newFeature value when the sentinel is selected", () => {
    const formData = new FormData();
    formData.set("feature", "__new__");
    formData.set("newFeature", "  Payments  ");
    expect(resolveFeatureName(formData)).toBe("Payments");
  });

  it("returns an empty string when nothing is selected", () => {
    const formData = new FormData();
    expect(resolveFeatureName(formData)).toBe("");
  });
});

describe("parseSprintNumber", () => {
  it("parses a valid non-negative integer", () => {
    const formData = new FormData();
    formData.set("sprintNumber", "14");
    expect(parseSprintNumber(formData)).toBe(14);
  });

  it("returns null for an empty value", () => {
    const formData = new FormData();
    formData.set("sprintNumber", "");
    expect(parseSprintNumber(formData)).toBeNull();
  });

  it("returns null when the field is missing entirely", () => {
    const formData = new FormData();
    expect(parseSprintNumber(formData)).toBeNull();
  });

  it("returns null for a negative number", () => {
    const formData = new FormData();
    formData.set("sprintNumber", "-1");
    expect(parseSprintNumber(formData)).toBeNull();
  });

  it("returns null for a non-numeric value", () => {
    const formData = new FormData();
    formData.set("sprintNumber", "abc");
    expect(parseSprintNumber(formData)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they pass**

Run: `npm test`
Expected: all tests in `src/lib/actions/test-cases.test.ts` pass (these are testing existing, already-correct logic — this is characterization testing of working code, not TDD-from-scratch, so "pass immediately" is the correct and expected outcome here, not a red flag). If any fail, that's a real, previously-undetected bug in the parsing logic — fix the implementation in `src/lib/actions/test-cases.ts` (not the test) unless the test itself is wrong about the function's documented/intended behavior.

- [ ] **Step 3: Verify nothing else broke**

Run: `npx tsc --noEmit`
Expected: no output — confirms the new `export` keywords didn't break anything (they can't, since exporting a previously-private function is strictly additive, but verify anyway).

Run: `npx eslint src/lib/actions/test-cases.ts src/lib/actions/test-cases.test.ts`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/test-cases.ts src/lib/actions/test-cases.test.ts
git commit -m "Add unit tests for CSV/step parsing helpers"
```

---

### Task 5: Local test-Supabase env var loading

**Files:**
- Create: `tests/integration/helpers/supabase-status.ts`

- [ ] **Step 1: Write the status-parsing helper**

This avoids hardcoding local Supabase URLs/keys (which, while technically fixed/predictable for local dev, would silently break if a developer's `supabase/config.toml` ever changes ports) by shelling out to `supabase status` and parsing its JSON output at test-setup time.

```ts
import { execSync } from "child_process";

export interface LocalSupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export function getLocalSupabaseConfig(): LocalSupabaseConfig {
  let raw: string;
  try {
    raw = execSync("npx supabase status -o json", { encoding: "utf8" });
  } catch {
    throw new Error(
      "Could not reach the local Supabase stack. Run `npm run test:db:start` first."
    );
  }

  const status = JSON.parse(raw) as {
    API_URL: string;
    ANON_KEY: string;
    SERVICE_ROLE_KEY: string;
  };

  if (!status.API_URL || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
    throw new Error("Local Supabase status output is missing expected fields.");
  }

  return {
    url: status.API_URL,
    anonKey: status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
  };
}
```

- [ ] **Step 2: Verify (manual, no automated test for this helper itself)**

With the local stack still running from Task 2, run:

```bash
node -e "
const { execSync } = require('child_process');
console.log(execSync('npx supabase status -o json', { encoding: 'utf8' }));
"
```

Expected: valid JSON printed containing `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` fields (confirms the shape this helper assumes is accurate for the installed CLI version — if the field names differ, fix Step 1's code now before continuing).

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/helpers/supabase-status.ts
git commit -m "Add helper to load local Supabase connection details"
```

---

### Task 6: Integration test global setup + auth helper

**Files:**
- Create: `tests/integration/global-setup.ts`
- Create: `tests/integration/helpers/test-auth.ts`

- [ ] **Step 1: Write the global setup**

Fails fast with a clear message if the local stack isn't running, rather than every individual test failing with a confusing connection error.

Create `tests/integration/global-setup.ts`:

```ts
import { getLocalSupabaseConfig } from "./helpers/supabase-status";

export default function setup() {
  // Throws a clear error if the local stack isn't reachable — see
  // supabase-status.ts. Vitest surfaces this before any test file runs.
  getLocalSupabaseConfig();
}
```

- [ ] **Step 2: Write the test-auth helper**

This resolves the design's "Server Actions in isolation" pattern concretely: rather than hand-encoding `@supabase/ssr`'s internal cookie serialization (fragile, version-dependent), it mocks `@/lib/supabase/server`'s `createClient` export directly to return a plain `supabase-js` client with the test user's session already set via `setSession()` — Server Actions call this mocked `createClient()` exactly as they call the real one, and RLS applies identically either way, since RLS only cares about the request's auth token, not how the client was constructed.

Create `tests/integration/helpers/test-auth.ts`:

```ts
import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import { getLocalSupabaseConfig } from "./supabase-status";
import type { Database } from "@/lib/types/database";

export interface TestSession {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

/** Creates a confirmed throwaway user directly against the local Supabase
 * instance's admin API and signs in as them, returning real session tokens.
 * This is the test suite's own operation against local, ephemeral,
 * throwaway infrastructure — not a real user's credentials. */
export async function createTestUser(): Promise<TestSession> {
  const { url, anonKey, serviceRoleKey } = getLocalSupabaseConfig();
  const email = `test-${randomUUID()}@example.com`;
  const password = randomUUID();

  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(`Failed to create test user: ${createError?.message}`);
  }

  const anon = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !session.session) {
    throw new Error(`Failed to sign in test user: ${signInError?.message}`);
  }

  return {
    userId: created.user.id,
    email,
    accessToken: session.session.access_token,
    refreshToken: session.session.refresh_token,
  };
}

/** Returns a real supabase-js client already authenticated as the given
 * session, against the local instance. RLS applies exactly as it would for
 * that user in the real app. Async because setSession is — always await
 * this before making requests with the returned client. */
export async function clientForSession(session: TestSession): Promise<SupabaseClient<Database>> {
  const { url, anonKey } = getLocalSupabaseConfig();
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await client.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });
  return client;
}

/** Mocks @/lib/supabase/server so Server Actions under test see an
 * authenticated client for the given session, without needing to
 * reverse-engineer @supabase/ssr's cookie encoding. Call this BEFORE
 * importing the action under test (see integration test files for the
 * required import order). */
export function mockAuthenticatedServerClient(session: TestSession) {
  vi.doMock("@/lib/supabase/server", () => ({
    createClient: () => clientForSession(session),
  }));
}

/** Mocks next/cache's revalidatePath/revalidateTag as no-ops — they
 * require a request-scoped context that doesn't exist in a test process. */
export function mockNextCache() {
  vi.doMock("next/cache", () => ({
    revalidatePath: vi.fn(),
    revalidateTag: vi.fn(),
  }));
}

/** Mocks next/navigation's redirect to throw a predictable, assertable
 * error instead of relying on Next.js's real redirect() working outside
 * an actual request context (which it may not). Tests assert on the
 * thrown message rather than a return value. */
export function mockNextRedirect() {
  vi.doMock("next/navigation", () => ({
    redirect: (url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    },
  }));
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint tests/integration/global-setup.ts tests/integration/helpers/test-auth.ts tests/integration/helpers/supabase-status.ts`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/global-setup.ts tests/integration/helpers/test-auth.ts
git commit -m "Add integration test global setup and Server Action auth mocking helpers"
```

---

### Task 7: Test fixtures helper (throwaway org/project)

**Files:**
- Create: `tests/integration/helpers/test-fixtures.ts`

- [ ] **Step 1: Write the fixture helper**

Reuses the existing `create_organization_with_owner` RPC (the same one the app's own onboarding flow uses) rather than inserting into `organizations`/`organization_members` directly, so fixtures stay consistent with how orgs are actually created in the real app. Does not seed a default "Feature" — `upsertFeature` inside `createTestCase` already get-or-creates one, so tests exercising that path don't need it pre-seeded.

```ts
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export interface TestOrgAndProject {
  orgId: string;
  projectId: string;
  projectKey: string;
}

export async function createTestOrgAndProject(
  client: SupabaseClient<Database>
): Promise<TestOrgAndProject> {
  const suffix = randomUUID().slice(0, 8);

  const { data: org, error: orgError } = await client.rpc("create_organization_with_owner", {
    org_name: `Test Org ${suffix}`,
    org_slug: `test-org-${suffix}`,
  });
  if (orgError || !org) {
    throw new Error(`Failed to create test org: ${orgError?.message}`);
  }

  const projectKey = `T${suffix.slice(0, 3).toUpperCase()}`;
  const { data: project, error: projectError } = await client
    .from("projects")
    .insert({
      org_id: org.id,
      name: `Test Project ${suffix}`,
      key: projectKey,
      created_by: org.created_by,
    })
    .select("id")
    .single();
  if (projectError || !project) {
    throw new Error(`Failed to create test project: ${projectError?.message}`);
  }

  return { orgId: org.id, projectId: project.id, projectKey };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint tests/integration/helpers/test-fixtures.ts`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/helpers/test-fixtures.ts
git commit -m "Add test fixture helper for creating throwaway orgs/projects"
```

---

### Task 8: Add the `test:integration` script and prove the helpers work

**Files:**
- Modify: `package.json`
- Create: `tests/integration/smoke.test.ts` (a minimal test proving the whole helper chain works, deleted in Task 9 once the real tests subsume it)

- [ ] **Step 1: Add the script**

In `package.json`, change:
```json
    "test": "vitest run --project unit"
```
to:
```json
    "test": "vitest run --project unit",
    "test:integration": "vitest run --project integration",
    "test:db:start": "supabase start",
    "test:db:stop": "supabase stop"
```

- [ ] **Step 2: Write a throwaway smoke test**

Create `tests/integration/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestUser, clientForSession } from "./helpers/test-auth";
import { createTestOrgAndProject } from "./helpers/test-fixtures";

describe("integration test infrastructure smoke test", () => {
  it("can create a user, sign in, and create an org/project", async () => {
    const session = await createTestUser();
    const client = await clientForSession(session);

    const { orgId, projectId } = await createTestOrgAndProject(client);

    expect(orgId).toBeTruthy();
    expect(projectId).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run it**

Ensure the local stack is running (`npm run test:db:start` if not already up from Task 2).

Run: `npm run test:integration`
Expected: 1 test passes. If it fails, the error message should point directly at which helper broke (user creation, sign-in, org RPC, or project insert) — fix that helper before continuing, since Tasks 9-10's real tests depend on this chain working.

- [ ] **Step 4: Delete the smoke test**

It's served its purpose (proving the chain works in isolation); Task 9's real cross-org-isolation test exercises the same chain plus real assertions, making this redundant.

```bash
rm tests/integration/smoke.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add package.json tests/integration/smoke.test.ts
git commit -m "Add test:integration script and verify the fixture chain works"
```

(Committing the deletion along with the script addition in one commit is intentional — the smoke test never needs its own history entry since it's immediately superseded.)

---

### Task 9: Integration test — cross-org RLS isolation

**Files:**
- Create: `tests/integration/cross-org-isolation.test.ts`

- [ ] **Step 1: Write the test**

This is the single highest-stakes security property in the app: a member of org A must never be able to read or write org B's data.

```ts
import { describe, expect, it } from "vitest";
import { createTestUser, clientForSession } from "./helpers/test-auth";
import { createTestOrgAndProject } from "./helpers/test-fixtures";

describe("cross-org RLS isolation", () => {
  it("cannot read another org's project", async () => {
    const userA = await createTestUser();
    const clientA = await clientForSession(userA);
    const { projectId: projectAId } = await createTestOrgAndProject(clientA);

    const userB = await createTestUser();
    const clientB = await clientForSession(userB);
    await createTestOrgAndProject(clientB);

    const { data, error } = await clientB.from("projects").select("*").eq("id", projectAId);

    // RLS makes this look like "not found" (zero rows), not a permission
    // error — that's the correct, intentional behavior (see
    // supabase/migrations/0006_private_schema_hardening.sql).
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot create a test case in another org's project", async () => {
    const userA = await createTestUser();
    const clientA = await clientForSession(userA);
    const { projectId: projectAId } = await createTestOrgAndProject(clientA);

    const userB = await createTestUser();
    const clientB = await clientForSession(userB);

    const { error } = await clientB.from("test_cases").insert({
      project_id: projectAId,
      title: "Should never be created",
      feature_id: "00000000-0000-0000-0000-000000000000",
      created_by: userB.userId,
    });

    // RLS's with-check clause on test_cases rejects this — the insert
    // fails (either RLS violation or the feature_id foreign key, but
    // either way, nothing gets created).
    expect(error).not.toBeNull();

    const { data: leaked } = await clientA
      .from("test_cases")
      .select("*")
      .eq("title", "Should never be created");
    expect(leaked).toEqual([]);
  });

  it("cannot read another org's members via get_org_members", async () => {
    const userA = await createTestUser();
    const clientA = await clientForSession(userA);
    const { orgId: orgAId } = await createTestOrgAndProject(clientA);

    const userB = await createTestUser();
    const clientB = await clientForSession(userB);

    const { data } = await clientB.rpc("get_org_members", { check_org_id: orgAId });

    // is_org_member(check_org_id) inside get_org_members returns false for
    // userB, so the function's own where clause yields zero rows — not an
    // error, just nothing (see 0006_private_schema_hardening.sql).
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test:integration`
Expected: all 3 tests pass. If any fail, that indicates a real RLS gap — do not weaken the test to make it pass; fix the actual RLS policy in a new migration instead, since this test exists specifically to catch that class of bug.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint tests/integration/cross-org-isolation.test.ts`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/cross-org-isolation.test.ts
git commit -m "Add integration tests for cross-org RLS isolation"
```

---

### Task 10: Integration test — `createTestCase` happy path + rate limit

**Files:**
- Create: `tests/integration/create-test-case.test.ts`

- [ ] **Step 1: Write the test**

Uses the `mockAuthenticatedServerClient`/`mockNextCache`/`mockNextRedirect` helpers from Task 6 to call the real `createTestCase` Server Action directly, exactly as the app's own form submission would.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestUser,
  clientForSession,
  mockAuthenticatedServerClient,
  mockNextCache,
  mockNextRedirect,
  type TestSession,
} from "./helpers/test-auth";
import { createTestOrgAndProject } from "./helpers/test-fixtures";

describe("createTestCase", () => {
  let session: TestSession;
  let projectId: string;

  beforeEach(async () => {
    vi.resetModules();
    session = await createTestUser();
    const client = await clientForSession(session);
    const fixture = await createTestOrgAndProject(client);
    projectId = fixture.projectId;

    mockAuthenticatedServerClient(session);
    mockNextCache();
    mockNextRedirect();
  });

  it("creates a test case and redirects to the list on success", async () => {
    const { createTestCase } = await import("@/lib/actions/test-cases");

    const formData = new FormData();
    formData.set("title", "Login works");
    formData.set("feature", "__new__");
    formData.set("newFeature", "Auth");
    formData.set("priority", "medium");
    formData.set("status", "active");
    formData.set("steps", "[]");

    await expect(createTestCase(projectId, {}, formData)).rejects.toThrow(
      `NEXT_REDIRECT:/projects/${projectId}/test-cases`
    );

    const client = await clientForSession(session);
    const { data: testCases } = await client
      .from("test_cases")
      .select("title")
      .eq("project_id", projectId);

    expect(testCases).toEqual([{ title: "Login works" }]);
  });

  it("rejects an empty title without creating a row", async () => {
    const { createTestCase } = await import("@/lib/actions/test-cases");

    const formData = new FormData();
    formData.set("title", "");
    formData.set("feature", "__new__");
    formData.set("newFeature", "Auth");

    const result = await createTestCase(projectId, {}, formData);
    expect(result).toEqual({ error: "Title is required." });
  });

  it("returns a rate-limit error once the bucket is exhausted", async () => {
    const { createTestCase } = await import("@/lib/actions/test-cases");

    // create_test_case is limited to 120 per 60s (see
    // src/lib/actions/test-cases.ts) — exhaust it directly against the
    // rate-limit RPC rather than actually calling the action 121 times.
    const client = await clientForSession(session);
    for (let i = 0; i < 120; i++) {
      await client.rpc("check_rate_limit", {
        p_action: "create_test_case",
        p_limit: 120,
        p_window_seconds: 60,
      });
    }

    const formData = new FormData();
    formData.set("title", "Should be rate limited");
    formData.set("feature", "__new__");
    formData.set("newFeature", "Auth");
    formData.set("priority", "medium");
    formData.set("status", "active");
    formData.set("steps", "[]");

    const result = await createTestCase(projectId, {}, formData);
    expect(result).toEqual({
      error: "You're doing that too often — please wait a bit and try again.",
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test:integration`
Expected: all 3 tests in this file pass, alongside the 3 from Task 9 (6 total). If the redirect assertion fails, double check `mockNextRedirect()` is being called *before* the dynamic `import("@/lib/actions/test-cases")` in each test — `vi.doMock` only affects imports that happen after it's called.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint tests/integration/create-test-case.test.ts`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/create-test-case.test.ts
git commit -m "Add integration tests for createTestCase happy path and rate limiting"
```

---

### Task 11: Install Playwright and configure e2e

**Files:**
- Modify: `package.json`
- Create: `playwright.config.ts`
- Create: `e2e/global-setup.ts`

- [ ] **Step 1: Install Playwright**

Run: `npm install --save-dev @playwright/test`
Run: `npx playwright install chromium`

- [ ] **Step 2: Write the e2e global setup**

Creates one fixed, confirmed local test user directly against the local instance's admin API and writes its credentials to a gitignored JSON file the e2e spec reads — Playwright's `globalSetup` runs once before the whole suite, separate from Vitest's. The password is written (not just the email) because the e2e spec drives a real browser and has to type it into the login form — this is the test suite's own operation against local, throwaway infrastructure, written fresh on every run and never persisted beyond that.

Create `e2e/global-setup.ts`:

```ts
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { getLocalSupabaseConfig } from "../tests/integration/helpers/supabase-status";
import type { Database } from "../src/lib/types/database";

export default async function globalSetup() {
  const { url, serviceRoleKey } = getLocalSupabaseConfig();
  const email = `e2e-${randomUUID()}@example.com`;
  const password = randomUUID();

  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    throw new Error(`Failed to create e2e test user: ${error.message}`);
  }

  const authDir = path.join(__dirname, ".auth");
  mkdirSync(authDir, { recursive: true });
  writeFileSync(
    path.join(authDir, "test-user.json"),
    JSON.stringify({ email, password }),
    "utf8"
  );
}
```

This file is written fresh on every `npx playwright test` run (a new random user each time) and is gitignored — see Step 4.

- [ ] **Step 3: Write the Playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 30000,
  },
});
```

`reuseExistingServer: true` means if a dev server is already running on port 3000 (common in this repo's workflow this session), Playwright uses it instead of failing or double-starting one.

- [ ] **Step 4: Add e2e artifacts to `.gitignore`**

Add to the end of `.gitignore`:

```

# playwright
/test-results/
/playwright-report/
/e2e/.auth/
```

- [ ] **Step 5: Add scripts**

In `package.json`, change:
```json
    "test:db:stop": "supabase stop"
```
to:
```json
    "test:db:stop": "supabase stop",
    "test:e2e": "playwright test",
    "test:all": "npm test && npm run test:integration && npm run test:e2e"
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add package.json playwright.config.ts e2e/global-setup.ts .gitignore
git commit -m "Install Playwright and configure e2e test setup"
```

---

### Task 12: E2E golden path — log in, create a test case, see it in the list

**Files:**
- Create: `e2e/create-test-case.spec.ts`

- [ ] **Step 1: Write the spec**

The e2e test needs an org + project to exist for the logged-in user before it can create a test case — the app's own onboarding wizard handles that on first login, so this spec drives the real onboarding flow first, then the real test-case-creation flow, rather than pre-seeding data behind the browser's back.

```ts
import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";

function getTestUser(): { email: string; password: string } {
  const raw = readFileSync(path.join(__dirname, ".auth", "test-user.json"), "utf8");
  return JSON.parse(raw);
}

test("golden path: log in, create a test case, see it in the list", async ({ page }) => {
  const { email, password } = getTestUser();

  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();

  // First login for a brand-new user goes through onboarding.
  await page.waitForURL("**/onboarding");
  await page.getByLabel("Team name").fill("E2E Test Team");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Project name").fill("E2E Test Project");
  await page.getByRole("radio", { name: "Blank" }).check();
  await page.getByRole("button", { name: "Create project" }).click();

  await page.waitForURL(/\/projects\/[^/]+$/);
  const projectUrl = page.url();
  const projectId = projectUrl.split("/projects/")[1];

  await page.goto(`/projects/${projectId}/test-cases/new`);
  await page.getByLabel("Title").fill("E2E created test case");
  await page.getByLabel("Feature").selectOption({ label: "+ Add new feature…" });
  await page.getByPlaceholder("e.g. Checkout, Payments, Onboarding").fill("E2E Feature");
  await page.getByRole("button", { name: "Create test case" }).click();

  await page.waitForURL(/\/test-cases$/);
  await expect(page.getByText("E2E created test case")).toBeVisible();
});
```

**This step's exact selectors/labels/flow are a best-effort based on the plan author's knowledge of the onboarding and test-case-creation UI — they have NOT been run yet.** Step 2 below is not optional polish; it's where this spec gets made to actually match the real UI.

- [ ] **Step 2: Run it and fix selectors against the real app**

Ensure the local Supabase stack is running (`npm run test:db:start`) and either let Playwright's `webServer` start the dev server or have `npm run dev` already running.

Run: `npm run test:e2e`
Expected: likely fails on the first run at whichever selector doesn't match the real onboarding/project-creation/test-case-creation UI exactly (label text, button text, field order can all differ from what's guessed above). Use `npx playwright test --headed --debug` to step through and correct each selector against the actual rendered page, iterating until the full flow passes. This is expected, normal e2e-authoring work, not a sign the plan or the app is broken.

- [ ] **Step 3: Commit**

```bash
git add e2e/create-test-case.spec.ts
git commit -m "Add e2e golden path test: login, create test case, see it in list"
```

---

### Task 13: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Testing" section**

Read the current README first (it's been edited by every prior project's doc task this session). Add a new `## Testing` section (a sensible placement: after "## Security notes", before "## Test account", matching the document's existing top-to-bottom flow from setup → features → security → test account):

```markdown
## Testing

Three layers, all local-only (no CI wiring yet):

- **Unit** (`npm test`): pure-function tests colocated with their source (`*.test.ts` beside `*.ts`). No external dependency — fast, safe to run anytime.
- **Integration** (`npm run test:integration`): exercises real RLS policies and Server Actions against a local Postgres. Requires the local Supabase stack running (`npm run test:db:start`, needs `colima`/`docker` installed via `brew install colima docker` + `colima start` once per machine). Signs in real throwaway users via `supabase-js` rather than mocking auth, so RLS is tested as it actually behaves for a real session — see `tests/integration/helpers/test-auth.ts`.
- **E2E** (`npm run test:e2e`): one Playwright browser test, full golden path (login → onboarding → create a test case → see it in the list). Needs the local Supabase stack running; starts its own dev server via Playwright's `webServer` config if one isn't already up.

Run everything: `npm run test:all`. Stop the local stack when done: `npm run test:db:stop`.

This is a first coverage slice, not exhaustive coverage — see `docs/superpowers/specs/2026-07-26-automated-test-suite-design.md` for what's deliberately out of scope (CI wiring, coverage gates, broad coverage of every action) and why.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document the test suite"
```

---

### Task 14: Full verification pass

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 2: Lint the whole repo**

Run: `npx eslint .`
Expected: no output (aside from the two pre-existing, already-accepted warnings in `src/lib/actions/issue-tracker.ts` from the Jira sync project — unrelated to this plan).

- [ ] **Step 3: Run the full test suite end-to-end**

Ensure the local Supabase stack is running: `npm run test:db:start` (skip if already up from earlier tasks).

Run: `npm run test:all`
Expected: unit tests pass, integration tests pass (9 total: 3 cross-org isolation + 3 createTestCase + wait — recount: Task 9 has 3 tests, Task 10 has 3 tests = 6 integration tests, plus whatever unit tests Task 4 added), e2e test passes.

- [ ] **Step 4: Production build still works**

Check for and kill any leftover `next-server` process on port 3000 first.

Run: `npm run build`
Expected: `✓ Compiled successfully`, same route list as before (this plan added no app routes, only test infrastructure).

- [ ] **Step 5: Confirm nothing test-related leaked into version control**

Run: `git status --short`
Expected: clean (nothing untracked/modified) — specifically confirm `e2e/.auth/`, `test-results/`, `playwright-report/`, and `supabase/.branches`/`supabase/.temp` do NOT appear, proving the `.gitignore` additions from Tasks 2 and 11 are working.

- [ ] **Step 6: Final commit if any verification step required fixes**

If any step above required a fix, commit it now describing what was fixed. If everything passed clean, there's nothing to commit — the tree should already be clean from Task 13.

- [ ] **Step 7: Write out a one-time setup note for the user**

In the final report (not a file), remind the user this needs a one-time local setup they haven't done yet: `brew install colima docker && colima start`, then `npm run test:db:start`. Every subsequent session just needs `npm run test:db:start`/`npm run test:db:stop` around test runs — the `brew install` is once per machine.
