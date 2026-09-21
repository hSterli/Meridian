# Billing Recurring Charges & Dunning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orgs that paid via Phase 2's Checkout get charged again automatically — monthly every month, annual every year — with a Day 1/3/5/30 retry-and-downgrade schedule for payment failures, driven by a daily `pg_cron` job.

**Architecture:** A migration adds two date columns to `organizations`, enables `pg_cron`/`pg_net`, and schedules a daily job that HTTP-POSTs into a new internal route (secrets read from Supabase Vault, never from the migration file itself). That route recomputes each due org's price via the existing `computePrice`, attempts an off-session Stripe charge against the org's saved payment method, and updates billing state. A small pure module holds the day-count/date-math logic so it's independently testable. Two prior-phase files get a small retroactive fix each.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS + pg_cron/pg_net + Vault), Stripe Node SDK, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-12-billing-recurring-design.md` — read it first for full rationale, including three real bugs the spec's own self-review found and fixed before this plan was written (don't "simplify" the `past_due` inclusion in the cron queries or the `payment_failed_since`-preservation logic — both exist for specific, spec-documented reasons).

---

## Known repo quirk

Check `tail -3 <file>` after every file write for a stray literal `</content>` line; strip with `sed -i '' -e '/^<\/content>$/d' <file>` if present.

## Environment notes

- **git**: prepend `/Library/Developer/CommandLineTools/usr/bin` to `PATH`.
- **Node/npm/npx**: prepend `/Users/heathersterling/.local/node-v24.19.0/bin` to `PATH`. Run every Verify step for real.
- **Browser-pane preview tool is broken this session** — don't route Verify steps through it.
- **Supabase project ref**: `ucnfcsosbdgknmzyuqbw` — use with the Supabase MCP `apply_migration`/`execute_sql`/`get_advisors` tools.
- **No live Stripe account or API keys exist in this session.** The actual `stripe.paymentMethods.list`/`stripe.paymentIntents.create` calls in the new route cannot be exercised end-to-end. Verified instead via `tsc`/`eslint`/`build` plus unit tests for the pure logic.
- **The two Supabase Vault secrets the cron job's SQL depends on (`cron_app_url`, `cron_secret`) cannot be created with real values in this session either** — `cron_app_url` needs this app's real deployed URL, `cron_secret` needs to match a real `CRON_SECRET` set in a real deployment's environment. The migration still creates the `pg_cron` job itself (that succeeds regardless of whether the Vault secrets exist yet) — Task 7 states populating those two secrets as an explicit manual step for whoever has a real environment, not something this plan can complete.

---

### Task 1: Migration — schema, pg_cron/pg_net, and the scheduled job

**Files:**
- Create: `supabase/migrations/0028_billing_recurring.sql`

- [x] **Step 1: Write the migration**

```sql
alter table organizations
  add column next_billing_date timestamptz,
  add column payment_failed_since timestamptz;

-- Back-fill next_billing_date for any org already active from Phase 2's
-- one-time Checkout payment, so this phase's cron has something to compare
-- against for orgs that paid before this migration ran. An approximation
-- (there's no stored payment date to compute the *exact* next-due date
-- from) — acceptable since it only affects orgs that converted during the
-- narrow window between Phase 2 shipping and this migration running.
update organizations
set next_billing_date = case
  when plan_type = 'monthly' then now() + interval '1 month'
  when plan_type = 'annual' then now() + interval '1 year'
  else null
end
where billing_status = 'active' and next_billing_date is null;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- cron_app_url and cron_secret are read from Supabase Vault by name, not
-- embedded here — this file is committed to git, and a real secret checked
-- into source control defeats the point of having one. Neither Vault
-- secret is created by this migration; see the plan's Task 7 for that
-- manual, out-of-band step.
select cron.schedule(
  'billing-run-cycle',
  '0 6 * * *', -- daily, 6 AM UTC
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_app_url')
      || '/api/internal/billing/run-cycle',
    headers := jsonb_build_object(
      'x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

- [x] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool against project ref `ucnfcsosbdgknmzyuqbw`, with `name` `billing_recurring` and the SQL above as `query`.

- [x] **Step 3: Verify the schema and the cron job both landed**

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select column_name, data_type from information_schema.columns
where table_name = 'organizations' and column_name in ('next_billing_date', 'payment_failed_since');
```
Expected: 2 rows, both `timestamp with time zone`.

```sql
select jobname, schedule, active from cron.job where jobname = 'billing-run-cycle';
```
Expected: 1 row — `billing-run-cycle`, `0 6 * * *`, `active = true`. (The job existing and being active is independent of whether the Vault secrets it reads are populated yet — it'll simply produce a request to a URL that resolves to an empty string until Task 7's manual step happens.)

- [x] **Step 4: Run security advisors**

Use the Supabase MCP `get_advisors` tool (type `security`) against `ucnfcsosbdgknmzyuqbw`. Expected: no new findings beyond the same class of pre-existing accepted ones (SECURITY DEFINER warnings on existing integration functions, RLS-enabled-no-policy on `webhook_events`/`rate_limit_buckets`, leaked-password-protection).

- [x] **Step 5: Regenerate TypeScript types**

Use the Supabase MCP `generate_typescript_types` tool against `ucnfcsosbdgknmzyuqbw`, write the result to `src/lib/types/database.ts` — **full replace, but this file also has a hand-written "App-level convenience aliases" block below the generated output that the generator's own output doesn't include; if the regenerated content doesn't have it, restore it from the pre-replace version rather than leaving it dropped** (this exact situation happened during Phase 2's migration task — confirm by running `npx tsc --noEmit` after replacing and checking for undefined-type errors across many unrelated files, which is the signature of this block having been dropped). Confirm `next_billing_date` and `payment_failed_since` both appear (`grep -n "next_billing_date\|payment_failed_since" src/lib/types/database.ts`).

- [x] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [x] **Step 7: Commit**

```bash
git add supabase/migrations/0028_billing_recurring.sql src/lib/types/database.ts
git commit -m "Add next_billing_date/payment_failed_since to organizations, schedule the daily billing cron"
```

---

### Task 2: `CRON_SECRET` env var

**Files:**
- Modify: `.env.local.example`

- [x] **Step 1: Add the new line**

`.env.local.example` currently reads:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WEBHOOK_SHARED_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

Replace with:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WEBHOOK_SHARED_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
CRON_SECRET=
```

- [x] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 .env.local.example`
Strip if present.

- [x] **Step 3: Commit**

```bash
git add .env.local.example
git commit -m "Add CRON_SECRET env var"
```

---

### Task 3: `computeDunningAction` and `nextBillingDateAfter`

**Files:**
- Create: `src/lib/stripe/billing-cycle.ts`
- Test: `src/lib/stripe/billing-cycle.test.ts`

- [x] **Step 1: Write the failing tests**

Create `src/lib/stripe/billing-cycle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeDunningAction, nextBillingDateAfter } from "./billing-cycle";

describe("computeDunningAction", () => {
  const failedAt = new Date("2026-01-01T00:00:00Z");

  it("returns a day-1 notice exactly one day after the failure", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    expect(computeDunningAction(failedAt, now)).toEqual({ type: "notice", day: 1 });
  });

  it("returns a day-3 notice exactly three days after the failure", () => {
    const now = new Date("2026-01-04T00:00:00Z");
    expect(computeDunningAction(failedAt, now)).toEqual({ type: "notice", day: 3 });
  });

  it("returns a downgrade exactly five days after the failure", () => {
    const now = new Date("2026-01-06T00:00:00Z");
    expect(computeDunningAction(failedAt, now)).toEqual({ type: "downgrade" });
  });

  it("returns a cancel exactly thirty days after the failure", () => {
    const now = new Date("2026-01-31T00:00:00Z");
    expect(computeDunningAction(failedAt, now)).toEqual({ type: "cancel" });
  });

  it("returns none for every day count that isn't 1, 3, 5, or 30", () => {
    for (const days of [0, 2, 4, 6, 10, 29, 31]) {
      const now = new Date(failedAt.getTime() + days * 24 * 60 * 60 * 1000);
      expect(computeDunningAction(failedAt, now)).toEqual({ type: "none" });
    }
  });
});

describe("nextBillingDateAfter", () => {
  it("adds exactly one month for monthly", () => {
    const from = new Date("2026-01-15T12:00:00Z");
    const result = nextBillingDateAfter("monthly", from);
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(1); // February, 0-indexed
    expect(result.getUTCDate()).toBe(15);
  });

  it("adds exactly one year for annual", () => {
    const from = new Date("2026-01-15T12:00:00Z");
    const result = nextBillingDateAfter("annual", from);
    expect(result.getUTCFullYear()).toBe(2027);
    expect(result.getUTCMonth()).toBe(0); // January
    expect(result.getUTCDate()).toBe(15);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project unit src/lib/stripe/billing-cycle.test.ts`
Expected: FAIL — `src/lib/stripe/billing-cycle.ts` doesn't exist yet.

- [x] **Step 3: Write `src/lib/stripe/billing-cycle.ts`**

```ts
export type DunningAction =
  | { type: "none" }
  | { type: "notice"; day: 1 | 3 }
  | { type: "downgrade" } // day 5: billing_status -> past_due
  | { type: "cancel" }; // day 30: billing_status -> cancelled

// Pure — no I/O. Only fires an action on the exact day a threshold is
// crossed (1, 3, 5, or 30 days since the failure streak began), not on
// every day past it — the caller is expected to run this once per day per
// failing org, so "exactly day 5" only ever matches once per streak.
export function computeDunningAction(paymentFailedSince: Date, now: Date): DunningAction {
  const daysSince = Math.floor(
    (now.getTime() - paymentFailedSince.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (daysSince === 1) return { type: "notice", day: 1 };
  if (daysSince === 3) return { type: "notice", day: 3 };
  if (daysSince === 5) return { type: "downgrade" };
  if (daysSince === 30) return { type: "cancel" };
  return { type: "none" };
}

export function nextBillingDateAfter(planType: "monthly" | "annual", from: Date): Date {
  const next = new Date(from);
  if (planType === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}
```

- [x] **Step 4: Check for the stray `</content>` line**

Run: `tail -3 src/lib/stripe/billing-cycle.ts`
Strip if present. Repeat for the test file.

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project unit src/lib/stripe/billing-cycle.test.ts`
Expected: 7 passed.

- [x] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/stripe/billing-cycle.ts src/lib/stripe/billing-cycle.test.ts`
Expected: no output.

- [x] **Step 7: Commit**

```bash
git add src/lib/stripe/billing-cycle.ts src/lib/stripe/billing-cycle.test.ts
git commit -m "Add computeDunningAction and nextBillingDateAfter"
```

---

### Task 4: Retroactive fix — save the payment method during Checkout

**Files:**
- Modify: `src/lib/actions/billing.ts`

- [x] **Step 1: Add `payment_intent_data` to the Checkout Session**

Find:

```ts
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [
```

Replace with:

```ts
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    payment_intent_data: {
      setup_future_usage: "off_session",
    },
    line_items: [
```

Without this, Stripe Checkout in `mode: 'payment'` does not save a reusable payment method — nothing in this phase's recurring-charge logic (Task 6) would have a saved card to charge.

- [x] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 src/lib/actions/billing.ts`
Strip if present.

- [x] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/billing.ts`
Expected: no output.

- [x] **Step 4: Commit**

```bash
git add src/lib/actions/billing.ts
git commit -m "Save the customer's payment method during Checkout for future recurring charges"
```

---

### Task 5: Set `next_billing_date` when a checkout completes

**Files:**
- Modify: `src/app/api/v1/webhooks/stripe/route.ts`

- [x] **Step 1: Import `nextBillingDateAfter` and compute the date**

Find:

```ts
import { stripe } from "@/lib/stripe/client";
import { createServiceClient } from "@/lib/supabase/service";
import type Stripe from "stripe";
```

Replace with:

```ts
import { stripe } from "@/lib/stripe/client";
import { nextBillingDateAfter } from "@/lib/stripe/billing-cycle";
import { createServiceClient } from "@/lib/supabase/service";
import type Stripe from "stripe";
```

- [x] **Step 2: Include `next_billing_date` in the organizations update**

Find:

```ts
    if (orgId && (planType === "monthly" || planType === "annual")) {
      await supabase
        .from("organizations")
        .update({
          billing_status: "active",
          plan_type: planType,
          stripe_customer_id: (session.customer as string) ?? null,
        })
        .eq("id", orgId);
```

Replace with:

```ts
    if (orgId && (planType === "monthly" || planType === "annual")) {
      await supabase
        .from("organizations")
        .update({
          billing_status: "active",
          plan_type: planType,
          stripe_customer_id: (session.customer as string) ?? null,
          next_billing_date: nextBillingDateAfter(planType, new Date()).toISOString(),
        })
        .eq("id", orgId);
```

- [x] **Step 3: Check for the stray `</content>` line**

Run: `tail -3 "src/app/api/v1/webhooks/stripe/route.ts"`
Strip if present.

- [x] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/api/v1/webhooks/stripe/route.ts"`
Expected: no output.

- [x] **Step 5: Commit**

```bash
git add "src/app/api/v1/webhooks/stripe/route.ts"
git commit -m "Set next_billing_date when a Checkout session completes"
```

---

### Task 6: The recurring-billing cron route

**Files:**
- Create: `src/app/api/internal/billing/run-cycle/route.ts`

- [x] **Step 1: Write the route**

```ts
import { stripe, computePrice, type BillingPlanType } from "@/lib/stripe/client";
import { computeDunningAction, nextBillingDateAfter } from "@/lib/stripe/billing-cycle";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();

  // Pass 1: charge every org whose next_billing_date has arrived. Includes
  // 'past_due', not just 'active' — the external spec calls for a 30-day
  // retry window after an org goes past_due at day 5, not an immediate
  // stop, so retries continue all the way to the day-30 cancellation in
  // Pass 2. A failed charge leaves next_billing_date untouched, so a
  // failing org simply reappears in this same query on every subsequent
  // day until it succeeds — that's the entire "retry" mechanism, no
  // separate scheduling needed. payment_failed_since is read here so a
  // *repeat* failure doesn't reset the dunning clock: it's only set when
  // currently null (the first failure in a streak); every failure after
  // that preserves the original timestamp so Pass 2's day-count can
  // actually advance toward day 5/30 instead of restarting at zero daily.
  const { data: dueOrgs } = await supabase
    .from("organizations")
    .select("id, plan_type, stripe_customer_id, payment_failed_since")
    .in("billing_status", ["active", "past_due"])
    .lte("next_billing_date", now.toISOString());

  for (const org of dueOrgs ?? []) {
    if (!org.stripe_customer_id || !org.plan_type) continue;

    const { count: seats } = await supabase
      .from("organization_members")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", org.id);

    const price = computePrice(org.plan_type as BillingPlanType, seats ?? 0);

    const methods = await stripe.paymentMethods.list({
      customer: org.stripe_customer_id,
      type: "card",
    });
    const paymentMethod = methods.data[0];

    if (!paymentMethod) {
      await supabase
        .from("organizations")
        .update({ payment_failed_since: org.payment_failed_since ?? now.toISOString() })
        .eq("id", org.id);
      await supabase.from("billing_events").insert({ org_id: org.id, event_type: "payment_failed" });
      continue;
    }

    await supabase.from("billing_events").insert({ org_id: org.id, event_type: "invoice_issued" });

    try {
      await stripe.paymentIntents.create({
        amount: price.totalCents,
        currency: "usd",
        customer: org.stripe_customer_id,
        payment_method: paymentMethod.id,
        off_session: true,
        confirm: true,
      });

      // billing_status is explicitly reset to 'active' even though it's a
      // no-op for orgs that were never past_due — an org that *was*
      // past_due and just paid successfully during its retry window needs
      // this to actually leave read-only, not just have its dates updated.
      await supabase
        .from("organizations")
        .update({
          billing_status: "active",
          next_billing_date: nextBillingDateAfter(
            org.plan_type as BillingPlanType,
            now
          ).toISOString(),
          payment_failed_since: null,
        })
        .eq("id", org.id);

      await supabase.from("billing_events").insert({
        org_id: org.id,
        event_type: "payment_succeeded",
      });
      await supabase.from("billing_events").insert({
        org_id: org.id,
        event_type: "subscription_renewed",
      });
    } catch {
      await supabase
        .from("organizations")
        .update({ payment_failed_since: org.payment_failed_since ?? now.toISOString() })
        .eq("id", org.id);
      await supabase.from("billing_events").insert({ org_id: org.id, event_type: "payment_failed" });
    }
  }

  // Pass 2: escalate any org already in a failure streak. Also includes
  // 'past_due' — an org downgraded at day 5 must still be checked here on
  // days 6-29 so the day-30 auto-cancellation actually fires; otherwise it
  // would stay past_due (and in Pass 1's retry loop) forever.
  const { data: failingOrgs } = await supabase
    .from("organizations")
    .select("id, payment_failed_since")
    .in("billing_status", ["active", "past_due"])
    .not("payment_failed_since", "is", null);

  for (const org of failingOrgs ?? []) {
    const action = computeDunningAction(new Date(org.payment_failed_since!), now);

    if (action.type === "notice") {
      await supabase.from("billing_events").insert({ org_id: org.id, event_type: "payment_failed" });
    } else if (action.type === "downgrade") {
      await supabase.from("organizations").update({ billing_status: "past_due" }).eq("id", org.id);
      await supabase.from("billing_events").insert({ org_id: org.id, event_type: "payment_failed" });
    } else if (action.type === "cancel") {
      await supabase
        .from("organizations")
        .update({ billing_status: "cancelled", payment_failed_since: null })
        .eq("id", org.id);
      await supabase.from("billing_events").insert({
        org_id: org.id,
        event_type: "subscription_cancelled",
      });
    }
  }

  return Response.json({
    status: "ok",
    processed: (dueOrgs ?? []).length,
    failing: (failingOrgs ?? []).length,
  });
}
```

- [x] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 "src/app/api/internal/billing/run-cycle/route.ts"`
Strip if present.

- [x] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/api/internal/billing/run-cycle/route.ts"`
Expected: no output.

- [x] **Step 4: Commit**

```bash
git add "src/app/api/internal/billing/run-cycle/route.ts"
git commit -m "Add the recurring-billing cron route: charge due orgs, escalate dunning"
```

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [x] **Step 1: Run the full automated suite**

```bash
npx tsc --noEmit
```
Expected: no output.

```bash
npx eslint .
```
Expected: no errors (pre-existing warnings in `issue-tracker.ts` predate this plan).

```bash
npm test
```
Expected: all existing tests pass, plus the 7 new `billing-cycle.test.ts` tests.

```bash
npm run build
```
Expected: production build succeeds, `/api/internal/billing/run-cycle` present in the route list alongside every route from prior phases.

```bash
git status --short
```
Expected: clean.

- [x] **Step 2: State the two live-environment gaps explicitly**

**No live Stripe account or API keys exist in this session.** `stripe.paymentMethods.list` and `stripe.paymentIntents.create` in `run-cycle/route.ts` have never been called against real Stripe — verified instead via the `computeDunningAction`/`nextBillingDateAfter` unit tests (the pure day-count/date-math logic, fully testable without live credentials) plus `tsc`/`eslint`/`build` proving correct Stripe SDK typing and Supabase field usage.

**The two Supabase Vault secrets the cron job depends on (`cron_app_url`, `cron_secret`) do not exist with real values.** The `pg_cron` job itself was created successfully in Task 1 (confirmed via `select * from cron.job`), but until someone with access to a real deployment runs:

```sql
select vault.create_secret('https://<the real deployed app URL>', 'cron_app_url');
select vault.create_secret('<a real random secret, matching CRON_SECRET in the deployed environment>', 'cron_secret');
```

...the scheduled job will fire daily but its `net.http_post` call will resolve to a URL built from an empty string, so nothing will actually happen. This is a required manual step before this phase does anything in a real environment — not something this plan can complete without live infrastructure access.

- [x] **Step 3: Confirm every scope decision from the spec is reflected**

Re-read `docs/superpowers/specs/2026-09-12-billing-recurring-design.md`'s 11 scope decisions and confirm each is covered:
1. `setup_future_usage: "off_session"` added to `startCheckout` — Task 4.
2. Scheduling via `pg_cron`/`pg_net`, not a platform-specific scheduler — Task 1.
3. New route at `/api/internal/billing/run-cycle` (not `/api/v1/*`), authenticated by `CRON_SECRET` via `x-cron-secret` header — Task 6.
4. `next_billing_date` added, one field drives both cadences — Task 1 (schema), Task 5 (set on first payment), Task 6 (set on every renewal).
5. `payment_failed_since` added — Task 1.
6. Retry is implicit in the due-orgs query, not a separate mechanism — Task 6, Pass 1.
7. Escalation fires only on the exact threshold day — `computeDunningAction`'s equality checks, Task 3.
8. No email actually sends — confirmed, `run-cycle/route.ts` only ever writes `billing_events` rows, never calls any email API.
9. Existing `billing_events` enum values reused (`invoice_issued`, `payment_succeeded`, `payment_failed`, `subscription_renewed`, `subscription_cancelled`) — Task 6, no new enum values added anywhere in this plan.
10. Payment method fetched explicitly via `stripe.paymentMethods.list`, not an implicit default — Task 6.
11. No distributed locking — confirmed, `run-cycle/route.ts` has no locking mechanism, matches the accepted risk in the spec.

- [x] **Step 4: Commit the plan checkbox updates**

```bash
git add docs/superpowers/plans/2026-09-12-billing-recurring.md
git commit -m "docs: mark Billing Recurring plan complete"
```
