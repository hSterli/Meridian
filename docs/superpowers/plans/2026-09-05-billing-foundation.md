# Billing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every org gets a 14-day trial (no card required) that's tracked in the database and actually enforced — once it lapses with no payment, every content-mutating action across the app is blocked, surfaced inline or via a banner depending on how that action already reports results.

**Architecture:** A migration adds `billing_status`/`trial_end_date`/`plan_type` to `organizations` and a `billing_events` audit table, with trial expiry computed on every read (never a stored transition, so no scheduler is needed). `getUserContext()` gains a centrally-computed `isReadOnly` boolean. Every one of the ~35 mutating Server Actions across 13 files gets a one-line gate checking that boolean, using whichever error-surfacing mechanism that action already has (`ActionState` inline error, or a `redirect(...+"?error=read-only")` for void actions). Two new UI components — a trial countdown banner and a generic `?error=` banner — live in the shared `(app)/layout.tsx`.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-billing-foundation-design.md` — read it first for full rationale on every decision below.

---

## Known repo quirk

Check `tail -3 <file>` after every file write for a stray literal `</content>` line; strip with `sed -i '' -e '/^<\/content>$/d' <file>` if present.

## Environment notes

- **git**: prepend `/Library/Developer/CommandLineTools/usr/bin` to `PATH`.
- **Node/npm/npx**: prepend `/Users/heathersterling/.local/node-v24.19.0/bin` to `PATH`. Run every Verify step for real.
- **Browser-pane preview tool is broken this session** (cross-wires to an unrelated sibling project) — don't route Verify steps through it. Use `tsc`/`eslint`/`vitest`/`build`, plus the Supabase MCP `execute_sql` tool for live manual checks.
- **Supabase project ref**: `ucnfcsosbdgknmzyuqbw` (name `meridian-qa`) — use this with the Supabase MCP `apply_migration`/`execute_sql`/`get_advisors` tools. Don't guess or look up a different ref.

---

### Task 1: Migration — schema + trial initialization

**Files:**
- Create: `supabase/migrations/0026_billing_foundation.sql`

- [x] **Step 1: Write the migration**

```sql
-- Billing Foundation: trial state on organizations, plus an audit trail.
-- Trial expiry is never a stored transition (see design spec scope decision
-- 1) — billing_status stays 'trial' for the whole 14 days and beyond;
-- every read compares trial_end_date to now() to decide if the trial has
-- actually lapsed. The other three billing_status values, and most of
-- billing_event_type, aren't written by anything yet — they're declared now
-- because Postgres enum values are awkward to add later and the eventual
-- state machine is already known (see spec scope decisions 2-3).

create type billing_status as enum ('trial', 'active', 'past_due', 'cancelled');
create type billing_plan_type as enum ('monthly', 'annual');
create type billing_event_type as enum (
  'trial_started',
  'upgrade_started',
  'subscription_created',
  'subscription_renewed',
  'invoice_issued',
  'payment_succeeded',
  'payment_failed',
  'seat_added_mid_year',
  'plan_changed',
  'subscription_cancelled'
);

alter table organizations
  add column billing_status billing_status not null default 'trial',
  add column trial_end_date timestamptz,
  add column plan_type billing_plan_type;

create table billing_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  event_type billing_event_type not null,
  created_at timestamptz not null default now()
);

create index billing_events_org_id_idx on billing_events(org_id);

alter table billing_events enable row level security;

create policy "org members can view their org's billing events"
  on billing_events for select
  using (private.is_org_member(org_id));

-- Replaces the function from 0005_create_org_rpc.sql — same signature, same
-- RLS-bootstrapping trick (org + owner membership created atomically in one
-- SECURITY DEFINER call), now also setting trial_end_date and logging the
-- first billing event in the same transaction.
create or replace function create_organization_with_owner(org_name text, org_slug text)
returns organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org organizations;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into organizations (name, slug, created_by, trial_end_date)
  values (org_name, org_slug, auth.uid(), now() + interval '14 days')
  returning * into v_org;

  insert into organization_members (org_id, user_id, role)
  values (v_org.id, auth.uid(), 'owner');

  insert into billing_events (org_id, event_type)
  values (v_org.id, 'trial_started');

  return v_org;
end;
$$;
```

- [x] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool against project ref `ucnfcsosbdgknmzyuqbw`, with `name` `billing_foundation` and the SQL above as `query`.

- [x] **Step 3: Verify the schema landed correctly**

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'organizations' and column_name in ('billing_status', 'trial_end_date', 'plan_type');
```
Expected: 3 rows — `billing_status` (`USER-DEFINED`, default `'trial'::billing_status`), `trial_end_date` (`timestamp with time zone`, no default), `plan_type` (`USER-DEFINED`, no default).

```sql
select count(*) from billing_events;
```
Expected: `0` (table exists, empty).

- [x] **Step 4: Verify existing orgs weren't broken, and that new orgs get a trial**

```sql
select id, name, billing_status, trial_end_date from organizations limit 5;
```
Expected: every existing row now has `billing_status = 'trial'` and `trial_end_date = null` (the column has no default expression, so pre-existing rows are `null` — this is expected and fine, since `isReadOnly`'s trial branch in Task 2 only evaluates `trial_end_date < now()` when `trial_end_date` is non-null, so existing orgs are correctly never read-only until this migration's forward-looking behavior applies to *newly created* orgs).

- [x] **Step 5: Run security advisors**

Use the Supabase MCP `get_advisors` tool (type `security`) against `ucnfcsosbdgknmzyuqbw`. Expected: no new findings beyond the same class of pre-existing accepted ones from earlier migrations (SECURITY DEFINER functions already known and accepted).

- [x] **Step 6: Regenerate TypeScript types**

Use the Supabase MCP `generate_typescript_types` tool against `ucnfcsosbdgknmzyuqbw`, and write the result to `src/lib/types/database.ts`, replacing its current content. Confirm `billing_status`, `billing_plan_type`, `billing_event_type`, and `billing_events` all appear somewhere in the new file (`grep -n "billing_status\|billing_events" src/lib/types/database.ts`).

- [x] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (the regenerated types file may cause errors elsewhere if hand-written type aliases were dropped — if so, re-add them; there should be none relevant to this change specifically).

- [x] **Step 8: Commit**

```bash
git add supabase/migrations/0026_billing_foundation.sql src/lib/types/database.ts
git commit -m "Add billing_status/trial_end_date/plan_type to organizations, plus billing_events audit table"
```

---

### Task 2: `isReadOnly` on `UserContext`

**Files:**
- Modify: `src/lib/org-context.ts`

- [x] **Step 1: Replace the full file contents**

```ts
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/lib/types/database";

const ACTIVE_ORG_COOKIE = "meridian_active_org";

export interface OrgMembership {
  org_id: string;
  role: OrgRole;
  organizations: {
    id: string;
    name: string;
    slug: string;
    billing_status: "trial" | "active" | "past_due" | "cancelled";
    trial_end_date: string | null;
  };
}

export interface UserContext {
  userId: string;
  email: string | null;
  fullName: string | null;
  memberships: OrgMembership[];
  activeOrgId: string | null;
  activeRole: OrgRole | null;
  isReadOnly: boolean;
}

export async function getUserContext(): Promise<UserContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("org_id, role, organizations(id, name, slug, billing_status, trial_end_date)")
    .eq("user_id", user.id);

  const typedMemberships = (memberships ?? []) as unknown as OrgMembership[];

  const cookieStore = await cookies();
  const cookieOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null;

  const active =
    typedMemberships.find((m) => m.org_id === cookieOrgId) ?? typedMemberships[0] ?? null;

  const rawFullName = user.user_metadata?.full_name;

  const billingStatus = active?.organizations.billing_status;
  const trialEndDate = active?.organizations.trial_end_date;
  const isReadOnly =
    billingStatus === "past_due" ||
    billingStatus === "cancelled" ||
    (billingStatus === "trial" && !!trialEndDate && new Date(trialEndDate) < new Date());

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: typeof rawFullName === "string" && rawFullName.trim() ? rawFullName.trim() : null,
    memberships: typedMemberships,
    activeOrgId: active?.org_id ?? null,
    activeRole: active?.role ?? null,
    isReadOnly,
  };
}

export { ACTIVE_ORG_COOKIE };
```

- [x] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 src/lib/org-context.ts`
Strip if present.

- [x] **Step 3: Write the unit test for `isReadOnly`**

This is the one piece of pure, testable logic in this phase. Since `getUserContext()` itself does I/O (Supabase + cookies), extract nothing new — instead test the boolean expression directly by constructing the same shape inline, mirroring how simple pure-logic tests are written elsewhere in this codebase (fixed input, exact output).

Create `src/lib/org-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";

type BillingStatus = "trial" | "active" | "past_due" | "cancelled";

function computeIsReadOnly(billingStatus: BillingStatus | undefined, trialEndDate: string | null | undefined): boolean {
  return (
    billingStatus === "past_due" ||
    billingStatus === "cancelled" ||
    (billingStatus === "trial" && !!trialEndDate && new Date(trialEndDate) < new Date())
  );
}

describe("computeIsReadOnly (mirrors getUserContext's isReadOnly logic)", () => {
  it("is false for a trial with a future trial_end_date", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(computeIsReadOnly("trial", future)).toBe(false);
  });

  it("is true for a trial with a past trial_end_date", () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(computeIsReadOnly("trial", past)).toBe(true);
  });

  it("is false for active regardless of trial_end_date", () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(computeIsReadOnly("active", past)).toBe(false);
  });

  it("is true for past_due", () => {
    expect(computeIsReadOnly("past_due", null)).toBe(true);
  });

  it("is true for cancelled", () => {
    expect(computeIsReadOnly("cancelled", null)).toBe(true);
  });

  it("is false for trial with a null trial_end_date (pre-existing orgs from before this migration)", () => {
    expect(computeIsReadOnly("trial", null)).toBe(false);
  });
});
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run --project unit src/lib/org-context.test.ts`
Expected: 6 passed.

- [x] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output. If it reports errors in other files that read `ctx.memberships[...].organizations` expecting the old 3-field shape, add the two new fields to that call site's own type usage — there should be very few, since most other pages only read `.organizations.name`/`.id`/`.slug`, which are unaffected by adding fields.

Run: `npx eslint src/lib/org-context.ts src/lib/org-context.test.ts`
Expected: no output.

- [x] **Step 6: Commit**

```bash
git add src/lib/org-context.ts src/lib/org-context.test.ts
git commit -m "Add isReadOnly to UserContext, computed from billing_status and trial_end_date"
```

---

### Task 3: Trial banner + read-only error banner

**Files:**
- Create: `src/components/layout/trial-banner.tsx`
- Create: `src/components/layout/action-error-banner.tsx`
- Modify: `src/app/(app)/layout.tsx`

- [x] **Step 1: Write the trial countdown banner**

Server Component — no client state needed, it just renders based on `UserContext` fields already available to the layout.

Create `src/components/layout/trial-banner.tsx`:

```tsx
export function TrialBanner({
  billingStatus,
  trialEndDate,
}: {
  billingStatus: "trial" | "active" | "past_due" | "cancelled";
  trialEndDate: string | null;
}) {
  if (billingStatus !== "trial" || !trialEndDate) return null;

  const msRemaining = new Date(trialEndDate).getTime() - Date.now();
  const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));

  if (daysRemaining <= 0) {
    return (
      <div className="bg-fail px-4 py-2 text-center text-sm font-semibold text-white">
        Your trial has ended — the org is read-only until payment is added.
      </div>
    );
  }

  const urgent = daysRemaining <= 3;

  return (
    <div
      className={
        urgent
          ? "bg-blocked px-4 py-2 text-center text-sm font-semibold text-white"
          : "bg-surface-container-highest px-4 py-2 text-center text-sm text-ink-secondary"
      }
    >
      {daysRemaining === 1
        ? "Trial ends tomorrow."
        : `Trial — ${daysRemaining} days left.`}
    </div>
  );
}
```

- [x] **Step 2: Check for the stray `</content>` line, then write the error banner**

Run: `tail -3 src/components/layout/trial-banner.tsx` and strip if present.

This one needs client state (reading `useSearchParams()` and dismissing via `router.replace`).

Create `src/components/layout/action-error-banner.tsx`:

```tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const MESSAGES: Record<string, string> = {
  "read-only": "Your trial has ended — add payment to continue. That action was blocked.",
};

export function ActionErrorBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  if (!error || !MESSAGES[error]) return null;

  function dismiss() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("error");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="flex items-center justify-between gap-4 bg-fail-soft px-4 py-2 text-sm text-fail">
      <span>{MESSAGES[error]}</span>
      <button type="button" onClick={dismiss} className="font-semibold hover:underline">
        Dismiss
      </button>
    </div>
  );
}
```

- [x] **Step 3: Check for the stray `</content>` line**

Run: `tail -3 src/components/layout/action-error-banner.tsx` and strip if present.

- [x] **Step 4: Wire both banners into the shared app layout**

`(app)/layout.tsx` currently reads:

```tsx
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { Sidebar } from "@/components/layout/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (ctx.memberships.length === 0) redirect("/onboarding");

  const activeOrg = ctx.memberships.find((m) => m.org_id === ctx.activeOrgId);

  return (
    <div className="flex min-h-screen bg-paper-surface">
      <Sidebar
        orgs={ctx.memberships.map((m) => ({
          id: m.organizations.id,
          name: m.organizations.name,
        }))}
        activeOrgId={ctx.activeOrgId}
        activeOrgName={activeOrg?.organizations.name ?? ""}
        activeRole={ctx.activeRole}
        userEmail={ctx.email}
        userName={ctx.fullName}
      />
      <main className="flex-1 overflow-y-auto p-8 print:overflow-visible print:p-0">
        {children}
      </main>
    </div>
  );
}
```

Replace it with:

```tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { Sidebar } from "@/components/layout/sidebar";
import { TrialBanner } from "@/components/layout/trial-banner";
import { ActionErrorBanner } from "@/components/layout/action-error-banner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (ctx.memberships.length === 0) redirect("/onboarding");

  const activeOrg = ctx.memberships.find((m) => m.org_id === ctx.activeOrgId);

  return (
    <div className="flex min-h-screen flex-col bg-paper-surface">
      {activeOrg && (
        <TrialBanner
          billingStatus={activeOrg.organizations.billing_status}
          trialEndDate={activeOrg.organizations.trial_end_date}
        />
      )}
      <Suspense fallback={null}>
        <ActionErrorBanner />
      </Suspense>
      <div className="flex flex-1">
        <Sidebar
          orgs={ctx.memberships.map((m) => ({
            id: m.organizations.id,
            name: m.organizations.name,
          }))}
          activeOrgId={ctx.activeOrgId}
          activeOrgName={activeOrg?.organizations.name ?? ""}
          activeRole={ctx.activeRole}
          userEmail={ctx.email}
          userName={ctx.fullName}
        />
        <main className="flex-1 overflow-y-auto p-8 print:overflow-visible print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
```

Note the `<Suspense>` wrapper around `ActionErrorBanner` — Next.js requires any component calling `useSearchParams()` in a page that can be statically rendered to be wrapped in `Suspense`, otherwise the build fails with a "should be wrapped in a suspense boundary" error. `fallback={null}` means nothing renders while the (essentially instant) client hydration happens.

- [x] **Step 5: Check for the stray `</content>` line**

Run: `tail -3 "src/app/(app)/layout.tsx"` and strip if present.

- [x] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/layout/trial-banner.tsx src/components/layout/action-error-banner.tsx "src/app/(app)/layout.tsx"`
Expected: no output.

- [x] **Step 7: Build, to catch the Suspense requirement specifically**

Run: `npm run build`
Expected: succeeds. If it fails specifically citing `useSearchParams()` needing a Suspense boundary, confirm Step 4's `<Suspense>` wrapper is present exactly as shown.

- [x] **Step 8: Commit**

```bash
git add src/components/layout/trial-banner.tsx src/components/layout/action-error-banner.tsx "src/app/(app)/layout.tsx"
git commit -m "Add trial countdown banner and read-only action-error banner to the app layout"
```

---

### Task 4: Gate `api-keys.ts` and `attachments.ts`

**Files:**
- Modify: `src/lib/actions/api-keys.ts`
- Modify: `src/lib/actions/attachments.ts`

- [x] **Step 1: `createApiKey` (already has `ctx`, `ActionState`)**

In `src/lib/actions/api-keys.ts`, find:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can create API keys." };
  }
```

Replace with:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can create API keys." };
  }
```

- [x] **Step 2: `revokeApiKey` (no `ctx` today, void, no redirect)**

In the same file, find:

```ts
export async function revokeApiKey(orgId: string, keyId: string) {
  const supabase = await createClient();
```

Replace with:

```ts
export async function revokeApiKey(orgId: string, keyId: string) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect("/settings/api?error=read-only");

  const supabase = await createClient();
```

Add `redirect` to the existing `next/navigation`-less import block — this file currently has no `redirect` import, so add:

```ts
import { redirect } from "next/navigation";
```
right after the existing `import { revalidatePath } from "next/cache";` line.

- [x] **Step 3: `uploadAttachment` (already has `ctx`, `ActionState`)**

In `src/lib/actions/attachments.ts`, find:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("upload_attachment", 30, 3600);
```

Replace with:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const limitError = await rateLimit("upload_attachment", 30, 3600);
```

- [x] **Step 4: `deleteAttachment` (already has `ctx`, void, no redirect)**

In the same file, find:

```ts
export async function deleteAttachment(
  projectId: string,
  testCaseId: string,
  attachmentId: string,
  storagePath: string
) {
  const ctx = await getUserContext();
  if (!ctx) return;

  const supabase = await createClient();
```

Replace with:

```ts
export async function deleteAttachment(
  projectId: string,
  testCaseId: string,
  attachmentId: string,
  storagePath: string
) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) {
    redirect(`/projects/${projectId}/test-cases/${testCaseId}?error=read-only`);
  }

  const supabase = await createClient();
```

Add `import { redirect } from "next/navigation";` to this file too (it currently has no `redirect` import).

- [x] **Step 5: Check for stray `</content>` lines**

Run: `tail -3 src/lib/actions/api-keys.ts src/lib/actions/attachments.ts` and strip any found.

- [x] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/api-keys.ts src/lib/actions/attachments.ts`
Expected: no output.

- [x] **Step 7: Commit**

```bash
git add src/lib/actions/api-keys.ts src/lib/actions/attachments.ts
git commit -m "Gate api-keys.ts and attachments.ts mutations behind isReadOnly"
```

---

### Task 5: Gate `custom-fields.ts` and `issue-tracker.ts`

**Files:**
- Modify: `src/lib/actions/custom-fields.ts`
- Modify: `src/lib/actions/issue-tracker.ts`

- [x] **Step 1: `createCustomField` and `updateCustomField` (both already have `ctx`, `ActionState`)**

In `src/lib/actions/custom-fields.ts`, both functions have the identical shape:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit(
```

(once with `"create_custom_field"`, once with `"update_custom_field"` as the rate-limit key — this text differs between the two call sites, so treat the snippet above as matching up to the shared prefix and insert on both occurrences). Using `replace_all` for the shared prefix isn't safe here since the rate-limit key differs; instead, in each function individually, change:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
```
to
```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };
```
in both `createCustomField` and `updateCustomField` (this exact two-line snippet is identical and appears twice in the file — once per function).

- [x] **Step 2: `deleteCustomField` (no `ctx` today, void, no redirect)**

In the same file, find:

```ts
export async function deleteCustomField(projectId: string, fieldId: string) {
  const supabase = await createClient();
```

Replace with:

```ts
export async function deleteCustomField(projectId: string, fieldId: string) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) {
    redirect(`/projects/${projectId}/test-cases/custom-fields?error=read-only`);
  }

  const supabase = await createClient();
```

Add `import { redirect } from "next/navigation";` to this file (not currently imported).

- [x] **Step 3: `connectJiraTracker`, `sendIssueToJira`, `connectGithubTracker`, `sendIssueToGithub` (all already have `ctx`, `ActionState`)**

In `src/lib/actions/issue-tracker.ts`, each of these four functions has a `const ctx = await getUserContext(); if (!ctx) return { error: "Not authenticated." };` block (verify exact surrounding text per function since two of them — `connectJiraTracker` and `connectGithubTracker` — also have a role check immediately after). Add the gate line immediately after the `if (!ctx) return { error: "Not authenticated." };` line and before any role check, in all four functions:

```ts
if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };
```

For example, `connectJiraTracker`'s block becomes:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can connect an issue tracker." };
  }
```

`sendIssueToJira`'s (no role check) becomes:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const limitError = await rateLimit("send_issue_to_jira", 30, 3600);
```

`connectGithubTracker`'s (find):
```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can connect an issue tracker." };
  }

  const limitError = await rateLimit("connect_issue_tracker", 10, 3600);
```
becomes:
```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can connect an issue tracker." };
  }

  const limitError = await rateLimit("connect_issue_tracker", 10, 3600);
```

`sendIssueToGithub`'s (find):
```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("send_issue_to_github", 30, 3600);
```
becomes:
```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const limitError = await rateLimit("send_issue_to_github", 30, 3600);
```

- [x] **Step 4: `disconnectJiraTracker` and `disconnectSlackNotifications`-style void actions with no project/org param**

`disconnectJiraTracker(connectionId: string)` has no `ctx`, no redirect, and — unlike every other function so far — no `projectId`/`orgId` parameter at all, since it's only ever called from the single global `/settings/integrations/jira` page. Find:

```ts
export async function disconnectJiraTracker(connectionId: string) {
  const supabase = await createClient();
```

Replace with:

```ts
export async function disconnectJiraTracker(connectionId: string) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect("/settings/integrations/jira?error=read-only");

  const supabase = await createClient();
```

- [x] **Step 5: `disconnectGithubTracker` (same shape, different target page)**

Find:

```ts
export async function disconnectGithubTracker(
  connectionId: string,
  repoOwner: string,
  repoName: string,
  webhookId: number | null
) {
  const supabase = await createClient();
```

Replace with:

```ts
export async function disconnectGithubTracker(
  connectionId: string,
  repoOwner: string,
  repoName: string,
  webhookId: number | null
) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect("/settings/integrations/github?error=read-only");

  const supabase = await createClient();
```

This file does not import `redirect` today — add `import { redirect } from "next/navigation";` alongside the existing `import { revalidatePath } from "next/cache";` line at the top.

- [x] **Step 6: Check for stray `</content>` lines**

Run: `tail -3 src/lib/actions/custom-fields.ts src/lib/actions/issue-tracker.ts` and strip any found.

- [x] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/custom-fields.ts src/lib/actions/issue-tracker.ts`
Expected: no output.

- [x] **Step 8: Commit**

```bash
git add src/lib/actions/custom-fields.ts src/lib/actions/issue-tracker.ts
git commit -m "Gate custom-fields.ts and issue-tracker.ts mutations behind isReadOnly"
```

---

### Task 6: Gate `issues.ts` and `members.ts`

**Files:**
- Modify: `src/lib/actions/issues.ts`
- Modify: `src/lib/actions/members.ts`

- [x] **Step 1: `createIssue` (already has `ctx`, `ActionState`)**

In `src/lib/actions/issues.ts`, find:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("create_issue", 60, 60);
```

Replace with:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const limitError = await rateLimit("create_issue", 60, 60);
```

- [x] **Step 2: `updateIssueStatus` (no `ctx` today, void, no redirect)**

Find:

```ts
export async function updateIssueStatus(projectId: string, issueId: string, status: IssueStatus) {
  const supabase = await createClient();
```

Replace with:

```ts
export async function updateIssueStatus(projectId: string, issueId: string, status: IssueStatus) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect(`/projects/${projectId}/issues/${issueId}?error=read-only`);

  const supabase = await createClient();
```

`redirect` is already imported in this file (used by `createIssue` and `deleteIssue`).

- [x] **Step 3: `deleteIssue` (no `ctx` today, already redirects on success)**

Find:

```ts
export async function deleteIssue(projectId: string, issueId: string) {
  const supabase = await createClient();
```

Replace with:

```ts
export async function deleteIssue(projectId: string, issueId: string) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect(`/projects/${projectId}/issues?error=read-only`);

  const supabase = await createClient();
```

- [x] **Step 4: `inviteMember` (already has `ctx`, `ActionState`)**

In `src/lib/actions/members.ts`, find:

```ts
  const ctx = await getUserContext();
  if (!ctx || !ctx.activeOrgId) return { error: "No active team selected." };

  const limitError = await rateLimit("invite_member", 20, 3600);
```

Replace with:

```ts
  const ctx = await getUserContext();
  if (!ctx || !ctx.activeOrgId) return { error: "No active team selected." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const limitError = await rateLimit("invite_member", 20, 3600);
```

- [x] **Step 5: `cancelInvite`, `updateMemberRole`, `removeMember` (none have `ctx` today, all void, none redirect)**

All three share the exact same fix shape — add `ctx`/`isReadOnly` before the existing `const supabase = await createClient();` line, redirecting to `/settings/members` (the one page all three are called from) on block.

Find:

```ts
export async function cancelInvite(inviteId: string) {
  const supabase = await createClient();
```
Replace with:
```ts
export async function cancelInvite(inviteId: string) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect("/settings/members?error=read-only");

  const supabase = await createClient();
```

Find:
```ts
export async function updateMemberRole(orgId: string, userId: string, role: OrgRole) {
  const supabase = await createClient();
```
Replace with:
```ts
export async function updateMemberRole(orgId: string, userId: string, role: OrgRole) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect("/settings/members?error=read-only");

  const supabase = await createClient();
```

Find:
```ts
export async function removeMember(orgId: string, userId: string) {
  const supabase = await createClient();
```
Replace with:
```ts
export async function removeMember(orgId: string, userId: string) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect("/settings/members?error=read-only");

  const supabase = await createClient();
```

Add `import { redirect } from "next/navigation";` to this file (not currently imported). Leave `acceptPendingInvites` untouched entirely — it's explicitly excluded (spec scope decision 8; it has no single org to check `isReadOnly` against).

- [x] **Step 6: Check for stray `</content>` lines**

Run: `tail -3 src/lib/actions/issues.ts src/lib/actions/members.ts` and strip any found.

- [x] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/issues.ts src/lib/actions/members.ts`
Expected: no output.

- [x] **Step 8: Commit**

```bash
git add src/lib/actions/issues.ts src/lib/actions/members.ts
git commit -m "Gate issues.ts and members.ts mutations behind isReadOnly"
```

---

### Task 7: Gate `projects.ts` and `slack.ts`

**Files:**
- Modify: `src/lib/actions/projects.ts`
- Modify: `src/lib/actions/slack.ts`

- [x] **Step 1: `createProject` (already has `ctx`, `ActionState`)**

In `src/lib/actions/projects.ts`, find:

```ts
  const ctx = await getUserContext();
  if (!ctx || !ctx.activeOrgId) return { error: "No active team selected." };

  const supabase = await createClient();
```

Replace with:

```ts
  const ctx = await getUserContext();
  if (!ctx || !ctx.activeOrgId) return { error: "No active team selected." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const supabase = await createClient();
```

- [x] **Step 2: `connectSlackNotifications` (already has `ctx`, `ActionState`)**

In `src/lib/actions/slack.ts`, find:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can connect Slack notifications." };
  }
```

Replace with:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can connect Slack notifications." };
  }
```

- [x] **Step 3: `disconnectSlackNotifications` (no `ctx` today, void, no redirect, no project param)**

Find:

```ts
export async function disconnectSlackNotifications(connectionId: string) {
  const supabase = await createClient();
```

Replace with:

```ts
export async function disconnectSlackNotifications(connectionId: string) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect("/settings/integrations/slack?error=read-only");

  const supabase = await createClient();
```

Add `import { redirect } from "next/navigation";` to this file (not currently imported).

- [x] **Step 4: Check for stray `</content>` lines**

Run: `tail -3 src/lib/actions/projects.ts src/lib/actions/slack.ts` and strip any found.

- [x] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/projects.ts src/lib/actions/slack.ts`
Expected: no output.

- [x] **Step 6: Commit**

```bash
git add src/lib/actions/projects.ts src/lib/actions/slack.ts
git commit -m "Gate projects.ts and slack.ts mutations behind isReadOnly"
```

---

### Task 8: Gate `runs.ts`

**Files:**
- Modify: `src/lib/actions/runs.ts`

- [x] **Step 1: `createRunFolder` and `createRun` (both already have `ctx`, `ActionState`)**

Find (appears once, in `createRunFolder`):

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("create_run_folder", 30, 3600);
```
Replace with:
```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const limitError = await rateLimit("create_run_folder", 30, 3600);
```

Find (in `createRun`):
```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("create_run", 30, 3600);
```
Replace with:
```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const limitError = await rateLimit("create_run", 30, 3600);
```

- [x] **Step 2: `setRunCaseStatus` (already has `ctx`, void, no redirect)**

Find:

```ts
export async function setRunCaseStatus(
  projectId: string,
  runId: string,
  runCaseId: string,
  status: RunCaseStatus,
  notes: string
) {
  const ctx = await getUserContext();
  if (!ctx) return;

  const limitError = await rateLimit("set_run_case_status", 300, 300);
```

Replace with:

```ts
export async function setRunCaseStatus(
  projectId: string,
  runId: string,
  runCaseId: string,
  status: RunCaseStatus,
  notes: string
) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect(`/projects/${projectId}/runs/${runId}?error=read-only`);

  const limitError = await rateLimit("set_run_case_status", 300, 300);
```

- [x] **Step 3: `deleteRun` (no `ctx` today, already redirects on success)**

Find:

```ts
export async function deleteRun(projectId: string, runId: string) {
  const supabase = await createClient();
```

Replace with:

```ts
export async function deleteRun(projectId: string, runId: string) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect(`/projects/${projectId}/runs?error=read-only`);

  const supabase = await createClient();
```

- [x] **Step 4: `addTestCasesToRun` (already has `ctx`, void, no redirect)**

Find:

```ts
export async function addTestCasesToRun(
  projectId: string,
  runId: string,
  formData: FormData
) {
  const testCaseIds = formData.getAll("testCaseIds").map(String);
  const ctx = await getUserContext();
  if (!ctx || testCaseIds.length === 0) return;

  const limitError = await rateLimit("edit_run_membership", 60, 60);
```

Replace with:

```ts
export async function addTestCasesToRun(
  projectId: string,
  runId: string,
  formData: FormData
) {
  const testCaseIds = formData.getAll("testCaseIds").map(String);
  const ctx = await getUserContext();
  if (!ctx || testCaseIds.length === 0) return;
  if (ctx.isReadOnly) redirect(`/projects/${projectId}/runs/${runId}?error=read-only`);

  const limitError = await rateLimit("edit_run_membership", 60, 60);
```

- [x] **Step 5: `bulkDeleteRuns` (already has `ctx`, void, no redirect)**

Find:

```ts
export async function bulkDeleteRuns(projectId: string, runIds: string[]) {
  const ctx = await getUserContext();
  if (!ctx || runIds.length === 0) return;

  const limitError = await rateLimit("bulk_run_action", 30, 60);
  if (limitError) return;

  const supabase = await createClient();
  await supabase.from("test_runs").delete().in("id", runIds);
```

Replace with:

```ts
export async function bulkDeleteRuns(projectId: string, runIds: string[]) {
  const ctx = await getUserContext();
  if (!ctx || runIds.length === 0) return;
  if (ctx.isReadOnly) redirect(`/projects/${projectId}/runs?error=read-only`);

  const limitError = await rateLimit("bulk_run_action", 30, 60);
  if (limitError) return;

  const supabase = await createClient();
  await supabase.from("test_runs").delete().in("id", runIds);
```

- [x] **Step 6: `bulkMoveRunsToFolder` (already has `ctx`, void, no redirect)**

Find:

```ts
export async function bulkMoveRunsToFolder(
  projectId: string,
  runIds: string[],
  folderId: string | null
) {
  const ctx = await getUserContext();
  if (!ctx || runIds.length === 0) return;

  const limitError = await rateLimit("bulk_run_action", 30, 60);
```

Replace with:

```ts
export async function bulkMoveRunsToFolder(
  projectId: string,
  runIds: string[],
  folderId: string | null
) {
  const ctx = await getUserContext();
  if (!ctx || runIds.length === 0) return;
  if (ctx.isReadOnly) redirect(`/projects/${projectId}/runs?error=read-only`);

  const limitError = await rateLimit("bulk_run_action", 30, 60);
```

`redirect` is already imported at the top of this file (used by `createRun`) — no new import needed.

- [x] **Step 7: Check for the stray `</content>` line**

Run: `tail -3 src/lib/actions/runs.ts` and strip if present.

- [x] **Step 8: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/runs.ts`
Expected: no output.

- [x] **Step 9: Commit**

```bash
git add src/lib/actions/runs.ts
git commit -m "Gate runs.ts mutations behind isReadOnly"
```

---

### Task 9: Gate `suites.ts`

**Files:**
- Modify: `src/lib/actions/suites.ts`

- [x] **Step 1: `createSuite` (already has `ctx`, `ActionState`)**

Find:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("create_suite", 30, 3600);
```

Replace with:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const limitError = await rateLimit("create_suite", 30, 3600);
```

- [x] **Step 2: `addTestCasesToSuite` (already has `ctx`, void, no redirect)**

Find:

```ts
export async function addTestCasesToSuite(
  projectId: string,
  suiteId: string,
  formData: FormData
) {
  const testCaseIds = formData.getAll("testCaseIds").map(String);
  const ctx = await getUserContext();
  if (!ctx || testCaseIds.length === 0) return;

  const limitError = await rateLimit("edit_suite_membership", 60, 60);
```

Replace with:

```ts
export async function addTestCasesToSuite(
  projectId: string,
  suiteId: string,
  formData: FormData
) {
  const testCaseIds = formData.getAll("testCaseIds").map(String);
  const ctx = await getUserContext();
  if (!ctx || testCaseIds.length === 0) return;
  if (ctx.isReadOnly) redirect(`/projects/${projectId}/suites/${suiteId}?error=read-only`);

  const limitError = await rateLimit("edit_suite_membership", 60, 60);
```

- [x] **Step 3: `removeTestCaseFromSuite` (already has `ctx`, void, no redirect)**

Find:

```ts
export async function removeTestCaseFromSuite(
  projectId: string,
  suiteId: string,
  testCaseId: string
) {
  const ctx = await getUserContext();
  if (!ctx) return;

  const limitError = await rateLimit("edit_suite_membership", 60, 60);
```

Replace with:

```ts
export async function removeTestCaseFromSuite(
  projectId: string,
  suiteId: string,
  testCaseId: string
) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect(`/projects/${projectId}/suites/${suiteId}?error=read-only`);

  const limitError = await rateLimit("edit_suite_membership", 60, 60);
```

- [x] **Step 4: `runSuiteNow` (already has `ctx`, redirects only on success today)**

Find:

```ts
export async function runSuiteNow(projectId: string, suiteId: string) {
  const ctx = await getUserContext();
  if (!ctx) return;

  const limitError = await rateLimit("create_run", 30, 3600);
```

Replace with:

```ts
export async function runSuiteNow(projectId: string, suiteId: string) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect(`/projects/${projectId}/suites/${suiteId}?error=read-only`);

  const limitError = await rateLimit("create_run", 30, 3600);
```

- [x] **Step 5: `deleteSuite` (no `ctx` today, already redirects on success)**

Find:

```ts
export async function deleteSuite(projectId: string, suiteId: string) {
  const supabase = await createClient();
```

Replace with:

```ts
export async function deleteSuite(projectId: string, suiteId: string) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect(`/projects/${projectId}/suites?error=read-only`);

  const supabase = await createClient();
```

`redirect` and `getUserContext` are already imported at the top of this file.

- [x] **Step 6: Check for the stray `</content>` line**

Run: `tail -3 src/lib/actions/suites.ts` and strip if present.

- [x] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/suites.ts`
Expected: no output.

- [x] **Step 8: Commit**

```bash
git add src/lib/actions/suites.ts
git commit -m "Gate suites.ts mutations behind isReadOnly"
```

---

### Task 10: Gate `test-cases.ts`

**Files:**
- Modify: `src/lib/actions/test-cases.ts`

- [x] **Step 1: `createTestCase` (already has `ctx`, `ActionState`)**

Find:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("create_test_case", 120, 60);
```

Replace with:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const limitError = await rateLimit("create_test_case", 120, 60);
```

- [x] **Step 2: `updateTestCase` (already has `ctx`, `ActionState`)**

Find:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("update_test_case", 120, 60);
```

Replace with:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const limitError = await rateLimit("update_test_case", 120, 60);
```

- [x] **Step 3: `deleteTestCase` (no `ctx` today, already redirects on success)**

Find:

```ts
export async function deleteTestCase(projectId: string, testCaseId: string) {
  const supabase = await createClient();
```

Replace with:

```ts
export async function deleteTestCase(projectId: string, testCaseId: string) {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect(`/projects/${projectId}/test-cases?error=read-only`);

  const supabase = await createClient();
```

- [x] **Step 4: `bulkImportTestCases` (already has `ctx`, `ActionState`)**

Find:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("bulk_import_test_cases", 10, 3600);
```

Replace with:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const limitError = await rateLimit("bulk_import_test_cases", 10, 3600);
```

`redirect` and `getUserContext` are already imported at the top of this file.

- [x] **Step 5: Check for the stray `</content>` line**

Run: `tail -3 src/lib/actions/test-cases.ts` and strip if present.

- [x] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/test-cases.ts`
Expected: no output.

- [x] **Step 7: Commit**

```bash
git add src/lib/actions/test-cases.ts
git commit -m "Gate test-cases.ts mutations behind isReadOnly"
```

---

### Task 11: Gate `weekly-reports.ts`

**Files:**
- Modify: `src/lib/actions/weekly-reports.ts`

- [x] **Step 1: `updateWeeklyReportDraft` (already has `ctx`, `ActionState`)**

Find:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("update_weekly_report_draft", 60, 3600);
```

Replace with:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const limitError = await rateLimit("update_weekly_report_draft", 60, 3600);
```

- [x] **Step 2: `updateDailyPlan` (already has `ctx`, void, no redirect)**

Find:

```ts
export async function updateDailyPlan(
  projectId: string,
  planDate: string,
  plannedCount: number
): Promise<void> {
  const ctx = await getUserContext();
  if (!ctx) return;

  const limitError = await rateLimit("update_daily_plan", 120, 3600);
```

Replace with:

```ts
export async function updateDailyPlan(
  projectId: string,
  planDate: string,
  plannedCount: number
): Promise<void> {
  const ctx = await getUserContext();
  if (!ctx) return;
  if (ctx.isReadOnly) redirect(`/projects/${projectId}/reports?error=read-only`);

  const limitError = await rateLimit("update_daily_plan", 120, 3600);
```

This file has no `redirect` import today — add `import { redirect } from "next/navigation";` alongside the existing `import { revalidatePath } from "next/cache";` line at the top.

- [x] **Step 3: `captureWeeklyReportSnapshot` (already has `ctx`, `ActionState`)**

Find:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("capture_weekly_report_snapshot", 20, 3600);
```

Replace with:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const limitError = await rateLimit("capture_weekly_report_snapshot", 20, 3600);
```

- [x] **Step 4: `updateSnapshotEditorialFields` (already has `ctx`, `ActionState`)**

Find:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("update_snapshot_editorial", 60, 3600);
```

Replace with:

```ts
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };

  const limitError = await rateLimit("update_snapshot_editorial", 60, 3600);
```

- [x] **Step 5: Check for the stray `</content>` line**

Run: `tail -3 src/lib/actions/weekly-reports.ts` and strip if present.

- [x] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/weekly-reports.ts`
Expected: no output.

- [x] **Step 7: Commit**

```bash
git add src/lib/actions/weekly-reports.ts
git commit -m "Gate weekly-reports.ts mutations behind isReadOnly"
```

---

### Task 12: Full verification pass

**Files:** none (verification only)

- [x] **Step 1: Run the full automated suite**

```bash
npx tsc --noEmit
```
Expected: no output.

```bash
npx eslint .
```
Expected: no errors (the same pre-existing `_prevState`/`_formData` unused-var warnings from `issue-tracker.ts` are fine — they predate this plan).

```bash
npm test
```
Expected: all existing tests pass, plus the 6 new `org-context.test.ts` tests.

```bash
npm run build
```
Expected: production build succeeds, every route still present, no "should be wrapped in a suspense boundary" error.

```bash
git status --short
```
Expected: clean.

- [x] **Step 2: Manually verify enforcement actually works, using a real org**

This is the one piece of behavior that can't be verified by `tsc`/`eslint`/`vitest`/`build` alone — it needs a live org whose trial has actually lapsed.

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw` to find an org to test against and confirm the columns behave as expected:

```sql
select id, name, billing_status, trial_end_date from organizations order by created_at desc limit 5;
```

Pick one org's `id` from the result (ideally a test/seed org, not one you know is in active real use), then set its trial into the past:

```sql
update organizations set trial_end_date = now() - interval '1 day' where id = '<paste-an-org-id-here>';
```

Confirm it took effect:

```sql
select id, billing_status, trial_end_date from organizations where id = '<same-org-id>';
```
Expected: `trial_end_date` is now in the past; `billing_status` is still `'trial'` (unchanged — expiry is derived, not stored, per Task 1/2).

Then, signed in as a user who belongs to that org (or via the dev server if one can be started per this session's environment notes), confirm:
- The trial banner at the top of the app now reads "Your trial has ended — the org is read-only until payment is added."
- An `ActionState`-pattern action (e.g. creating a test case) returns the inline error "Your trial has ended — add payment to continue." instead of succeeding.
- A void-pattern action (e.g. deleting a run) redirects back to the runs list with `?error=read-only` in the URL, and the dismissible red banner from Task 3 appears with the message "Your trial has ended — add payment to continue. That action was blocked."

Afterward, restore the org so it isn't left in a broken state:

```sql
update organizations set trial_end_date = now() + interval '14 days' where id = '<same-org-id>';
```

- [x] **Step 3: Confirm every scope decision from the spec is actually reflected**

Re-read `docs/superpowers/specs/2026-09-05-billing-foundation-design.md`'s 10 scope decisions and confirm each is covered:
1. Trial expiry fully derived, no stored transition — confirmed by Task 2's `isReadOnly` computation and Task 1's migration never writing anything but `'trial'`.
2. `billing_status` is the full 4-value enum — confirmed in Task 1.
3. `billing_events.event_type` is the full future set, only `'trial_started'` ever inserted — confirmed in Task 1.
4. Read-only wired up now, not deferred — confirmed by Tasks 4-11 actually gating every action rather than just building an unused helper.
5. Read-only blocks everything that writes, no destructive/additive distinction — confirmed by Tasks 4-11 gating deletes/disconnects/revokes identically to creates/updates.
6. `isReadOnly` computed once, centrally, on `UserContext` — confirmed by Task 2.
7. Two response patterns matching each action's existing error-reporting style — confirmed throughout Tasks 4-11.
8. Three exclusion categories (auth.ts, orgs.ts, `acceptPendingInvites`) — confirmed: none of these were touched in any task.
9. Trial banner visible the whole 14 days, scaling styling — confirmed by Task 3's `TrialBanner`.
10. Banner above the sidebar+content row — confirmed by Task 3's layout restructure.

- [x] **Step 4: Commit the plan checkbox updates**

```bash
git add docs/superpowers/plans/2026-09-05-billing-foundation.md
git commit -m "docs: mark Billing Foundation plan complete"
```
