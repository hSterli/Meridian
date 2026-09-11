# Billing Checkout & Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An org can go from `trial` to `active` by choosing monthly or annual billing, paying through Stripe Checkout, and having a webhook flip its `billing_status` — the first point real money moves in this app.

**Architecture:** A one-column migration (`stripe_customer_id` on `organizations`), a small Stripe SDK wrapper with the pure pricing math, a Server Action that lazily creates a Stripe Customer and a Checkout Session, a minimal plan-choice page, a polling success page that waits for the webhook, and a dedicated `/api/v1/webhooks/stripe` route mirroring the existing GitHub webhook route's shape.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS), Stripe Node SDK, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-billing-checkout-design.md` — read it first for full rationale on every decision below.

---

## Known repo quirk

Check `tail -3 <file>` after every file write for a stray literal `</content>` line; strip with `sed -i '' -e '/^<\/content>$/d' <file>` if present.

## Environment notes

- **git**: prepend `/Library/Developer/CommandLineTools/usr/bin` to `PATH`.
- **Node/npm/npx**: prepend `/Users/heathersterling/.local/node-v24.19.0/bin` to `PATH`. Run every Verify step for real.
- **Browser-pane preview tool is broken this session** — don't route Verify steps through it.
- **Supabase project ref**: `ucnfcsosbdgknmzyuqbw` — use with the Supabase MCP `apply_migration`/`execute_sql`/`get_advisors` tools.
- **No live Stripe account or API keys exist in this session.** `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` will be blank in `.env.local` — the actual Stripe API calls (`stripe.customers.create`, `stripe.checkout.sessions.create`, `stripe.webhooks.constructEvent`) cannot be exercised end-to-end live this session. Every Verify step in this plan relies on `tsc`/`eslint`/`vitest`/`build` — proving the code compiles and the Stripe SDK's types are used correctly — plus the `computePrice` unit tests, which are the one piece of real logic in this feature that's pure and fully verifiable without live credentials. Task 8 states this limitation explicitly rather than pretending a live checkout was performed.

---

### Task 1: Add the Stripe dependency and env vars

**Files:**
- Modify: `package.json`
- Modify: `.env.local.example`

- [ ] **Step 1: Install the Stripe SDK**

Run: `npm install stripe`
Expected: `package.json`'s `dependencies` gains a `"stripe": "^<version>"` line (npm resolves the current version — don't hand-edit a version number).

- [ ] **Step 2: Add the two new env vars**

`.env.local.example` currently reads:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WEBHOOK_SHARED_SECRET=
```

Replace with:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WEBHOOK_SHARED_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

- [ ] **Step 3: Check for the stray `</content>` line**

Run: `tail -3 .env.local.example`
Strip if present.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.local.example
git commit -m "Add stripe dependency and Stripe env vars"
```

---

### Task 2: Migration — `stripe_customer_id` on `organizations`

**Files:**
- Create: `supabase/migrations/0027_billing_checkout.sql`

- [ ] **Step 1: Write the migration**

```sql
alter table organizations
  add column stripe_customer_id text;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool against project ref `ucnfcsosbdgknmzyuqbw`, with `name` `billing_checkout` and the SQL above as `query`.

- [ ] **Step 3: Verify the column landed**

Use the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select column_name, data_type from information_schema.columns
where table_name = 'organizations' and column_name = 'stripe_customer_id';
```
Expected: one row — `stripe_customer_id`, `text`.

- [ ] **Step 4: Run security advisors**

Use the Supabase MCP `get_advisors` tool (type `security`) against `ucnfcsosbdgknmzyuqbw`. Expected: no new findings — this migration adds a plain nullable column with no RLS-relevant surface.

- [ ] **Step 5: Regenerate TypeScript types**

Use the Supabase MCP `generate_typescript_types` tool against `ucnfcsosbdgknmzyuqbw`, write the result to `src/lib/types/database.ts` (full replace). Confirm `stripe_customer_id` appears (`grep -n "stripe_customer_id" src/lib/types/database.ts`).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0027_billing_checkout.sql src/lib/types/database.ts
git commit -m "Add stripe_customer_id to organizations"
```

---

### Task 3: `computePrice` — the pricing function

**Files:**
- Create: `src/lib/stripe/client.ts`
- Test: `src/lib/stripe/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/stripe/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computePrice } from "./client";

describe("computePrice", () => {
  it("charges the base plus per-seat rate for monthly", () => {
    expect(computePrice("monthly", 1).totalCents).toBe(9900 + 1900 * 1);
    expect(computePrice("monthly", 5).totalCents).toBe(9900 + 1900 * 5);
    expect(computePrice("monthly", 10).totalCents).toBe(9900 + 1900 * 10);
  });

  it("charges just the base for zero seats", () => {
    expect(computePrice("monthly", 0).totalCents).toBe(9900);
  });

  it("computes annual as 12 months at a 20% discount", () => {
    const result = computePrice("annual", 5);
    const monthlySubtotal = 9900 + 1900 * 5;
    const annualSubtotal = monthlySubtotal * 12;
    const expectedDiscount = Math.round(annualSubtotal * 0.2);
    expect(result.subtotalCents).toBe(annualSubtotal);
    expect(result.discountCents).toBe(expectedDiscount);
    expect(result.totalCents).toBe(annualSubtotal - expectedDiscount);
  });

  it("monthly has no discount", () => {
    expect(computePrice("monthly", 5).discountCents).toBe(0);
  });

  it("carries the seat count through unchanged", () => {
    expect(computePrice("monthly", 7).seats).toBe(7);
    expect(computePrice("annual", 7).seats).toBe(7);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project unit src/lib/stripe/client.test.ts`
Expected: FAIL — `src/lib/stripe/client.ts` doesn't exist yet.

- [ ] **Step 3: Write `src/lib/stripe/client.ts`**

```ts
import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export type BillingPlanType = "monthly" | "annual";

export interface PriceBreakdown {
  seats: number;
  baseCents: number;
  perSeatCents: number;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

const BASE_MONTHLY_CENTS = 9900;
const PER_SEAT_MONTHLY_CENTS = 1900;
const ANNUAL_DISCOUNT = 0.2;

// Pure — no I/O. Callers pass in the seat count (read from
// organization_members) rather than this function querying it itself, same
// separation the rest of this codebase's compute* functions keep between
// data-fetching and calculation.
export function computePrice(planType: BillingPlanType, seats: number): PriceBreakdown {
  const monthlySubtotal = BASE_MONTHLY_CENTS + PER_SEAT_MONTHLY_CENTS * seats;

  if (planType === "monthly") {
    return {
      seats,
      baseCents: BASE_MONTHLY_CENTS,
      perSeatCents: PER_SEAT_MONTHLY_CENTS,
      subtotalCents: monthlySubtotal,
      discountCents: 0,
      totalCents: monthlySubtotal,
    };
  }

  const annualSubtotal = monthlySubtotal * 12;
  const discountCents = Math.round(annualSubtotal * ANNUAL_DISCOUNT);
  return {
    seats,
    baseCents: BASE_MONTHLY_CENTS,
    perSeatCents: PER_SEAT_MONTHLY_CENTS,
    subtotalCents: annualSubtotal,
    discountCents,
    totalCents: annualSubtotal - discountCents,
  };
}
```

- [ ] **Step 4: Check for the stray `</content>` line**

Run: `tail -3 src/lib/stripe/client.ts`
Strip if present. Repeat for the test file.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project unit src/lib/stripe/client.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output. If it errors on `new Stripe(process.env.STRIPE_SECRET_KEY!)` because `STRIPE_SECRET_KEY` is undefined at type-check time — it won't; the `!` non-null assertion tells TypeScript to trust it, and `tsc` doesn't evaluate env vars, only types. This is the same pattern already used for `NEXT_PUBLIC_SUPABASE_URL!` in `src/lib/supabase/server.ts`.

Run: `npx eslint src/lib/stripe/client.ts src/lib/stripe/client.test.ts`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/stripe/client.ts src/lib/stripe/client.test.ts
git commit -m "Add computePrice: monthly/annual pricing math, and the shared Stripe SDK instance"
```

---

### Task 4: `startCheckout` and `checkBillingStatus` Server Actions

**Files:**
- Create: `src/lib/actions/billing.ts`

- [ ] **Step 1: Write the file**

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { stripe, computePrice, type BillingPlanType } from "@/lib/stripe/client";
import type { ActionState } from "@/lib/actions/auth";

export async function startCheckout(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const planType = String(formData.get("planType") ?? "") as BillingPlanType;
  if (planType !== "monthly" && planType !== "annual") {
    return { error: "Choose a plan." };
  }

  const ctx = await getUserContext();
  if (!ctx || !ctx.activeOrgId) return { error: "No active team selected." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can add payment." };
  }

  const supabase = await createClient();

  const { count: seats } = await supabase
    .from("organization_members")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", ctx.activeOrgId);

  const { data: org } = await supabase
    .from("organizations")
    .select("name, stripe_customer_id")
    .eq("id", ctx.activeOrgId)
    .single();

  if (!org) return { error: "Organization not found." };

  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: org.name,
      metadata: { orgId: ctx.activeOrgId },
    });
    customerId = customer.id;
    await supabase
      .from("organizations")
      .update({ stripe_customer_id: customerId })
      .eq("id", ctx.activeOrgId);
  }

  const price = computePrice(planType, seats ?? 0);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: price.totalCents,
          product_data: {
            name:
              planType === "monthly"
                ? `Meridian QA — Monthly (${price.seats} seats)`
                : `Meridian QA — Annual (${price.seats} seats)`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: { orgId: ctx.activeOrgId, planType },
    success_url: `${appUrl}/billing/upgrade/success`,
    cancel_url: `${appUrl}/billing/upgrade`,
  });

  if (!session.url) return { error: "Could not start checkout." };

  redirect(session.url);
}

export async function checkBillingStatus(): Promise<{ billingStatus: string | null }> {
  const ctx = await getUserContext();
  if (!ctx?.activeOrgId) return { billingStatus: null };

  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("billing_status")
    .eq("id", ctx.activeOrgId)
    .single();

  return { billingStatus: data?.billing_status ?? null };
}
```

Note `startCheckout` deliberately does **not** check `ctx.isReadOnly` — starting checkout is exactly the action a read-only org must still be able to take, since it's the way out of read-only. This mirrors why `auth.ts` and `orgs.ts` were excluded from the Foundation phase's gating.

- [ ] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 src/lib/actions/billing.ts`
Strip if present.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/lib/actions/billing.ts`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/billing.ts
git commit -m "Add startCheckout and checkBillingStatus Server Actions"
```

---

### Task 5: `/billing/upgrade` — the plan-choice page

**Files:**
- Create: `src/components/billing/upgrade-form.tsx`
- Create: `src/app/(app)/billing/upgrade/page.tsx`

- [ ] **Step 1: Write the client form component**

Create `src/components/billing/upgrade-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { startCheckout } from "@/lib/actions/billing";
import type { ActionState } from "@/lib/actions/auth";
import type { PriceBreakdown } from "@/lib/stripe/client";

export function UpgradeForm({
  monthly,
  annual,
}: {
  monthly: PriceBreakdown;
  annual: PriceBreakdown;
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(startCheckout, {});

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label className="flex items-center gap-3 rounded-lg border border-border-medium p-4">
          <input type="radio" name="planType" value="monthly" defaultChecked />
          <span className="flex-1">
            <span className="block font-ui-label font-semibold text-ink-primary">Monthly</span>
            <span className="block text-sm text-ink-secondary">
              ${(monthly.totalCents / 100).toFixed(2)}/month for {monthly.seats} seat
              {monthly.seats === 1 ? "" : "s"}
            </span>
          </span>
        </label>
        <label className="flex items-center gap-3 rounded-lg border border-border-medium p-4">
          <input type="radio" name="planType" value="annual" />
          <span className="flex-1">
            <span className="block font-ui-label font-semibold text-ink-primary">Annual</span>
            <span className="block text-sm text-ink-secondary">
              ${(annual.totalCents / 100).toFixed(2)}/year for {annual.seats} seat
              {annual.seats === 1 ? "" : "s"} — 20% off
            </span>
          </span>
        </label>
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Redirecting…" : "Continue to payment"}
      </Button>
      {state.error && <p className="text-sm text-fail">{state.error}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 src/components/billing/upgrade-form.tsx`
Strip if present.

- [ ] **Step 3: Write the page**

Create `src/app/(app)/billing/upgrade/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { computePrice } from "@/lib/stripe/client";
import { UpgradeForm } from "@/components/billing/upgrade-form";

export default async function BillingUpgradePage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const supabase = await createClient();
  const { count: seats } = await supabase
    .from("organization_members")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", ctx.activeOrgId);

  const monthly = computePrice("monthly", seats ?? 0);
  const annual = computePrice("annual", seats ?? 0);

  return (
    <div className="max-w-2xl">
      <PageHeader title="Add payment" description="Choose monthly or annual billing to continue." />
      <Card className="p-5">
        <UpgradeForm monthly={monthly} annual={annual} />
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Check for the stray `</content>` line**

Run: `tail -3 "src/app/(app)/billing/upgrade/page.tsx"`
Strip if present.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint src/components/billing/upgrade-form.tsx "src/app/(app)/billing/upgrade/page.tsx"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/billing/upgrade-form.tsx "src/app/(app)/billing/upgrade/page.tsx"
git commit -m "Add /billing/upgrade plan-choice page"
```

---

### Task 6: `/billing/upgrade/success` — the polling success page

**Files:**
- Create: `src/app/(app)/billing/upgrade/success/page.tsx`

- [ ] **Step 1: Write the page**

This is a Client Component (needs `setInterval` and `useRouter`), directly under `(app)/` — the shared `(app)/layout.tsx` already handles the auth/org redirect at a higher level, so this page doesn't re-check `ctx` itself.

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { checkBillingStatus } from "@/lib/actions/billing";

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 15000;

export default function BillingUpgradeSuccessPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Setting up your account…");

  useEffect(() => {
    const startedAt = Date.now();

    const interval = setInterval(async () => {
      const { billingStatus } = await checkBillingStatus();

      if (billingStatus === "active") {
        clearInterval(interval);
        router.push("/dashboard");
        return;
      }

      if (Date.now() - startedAt > MAX_WAIT_MS) {
        clearInterval(interval);
        setMessage("This is taking longer than expected — continuing anyway.");
        router.push("/dashboard?pending=1");
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [router]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-ink-secondary">{message}</p>
    </div>
  );
}
```

- [ ] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 "src/app/(app)/billing/upgrade/success/page.tsx"`
Strip if present.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/(app)/billing/upgrade/success/page.tsx"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/billing/upgrade/success/page.tsx"
git commit -m "Add polling success page for the checkout-redirect vs webhook race"
```

---

### Task 7: Stripe webhook route

**Files:**
- Create: `src/app/api/v1/webhooks/stripe/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { stripe } from "@/lib/stripe/client";
import { createServiceClient } from "@/lib/supabase/service";
import type Stripe from "stripe";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature ?? "",
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from("webhook_events")
    .select("id")
    .eq("source", "stripe")
    .eq("payload->>id", event.id)
    .maybeSingle();

  if (existing) {
    return Response.json({ status: "already processed" });
  }

  let orgId: string | null = null;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    orgId = (session.metadata?.orgId as string | undefined) ?? null;
    const planType = session.metadata?.planType;

    if (orgId && (planType === "monthly" || planType === "annual")) {
      await supabase
        .from("organizations")
        .update({
          billing_status: "active",
          plan_type: planType,
          stripe_customer_id: (session.customer as string) ?? null,
        })
        .eq("id", orgId);

      await supabase.from("billing_events").insert({
        org_id: orgId,
        event_type: "payment_succeeded",
      });
    }
  }

  await supabase.from("webhook_events").insert({
    source: "stripe",
    org_id: orgId,
    payload: event as unknown as never,
    signature_valid: true,
  });

  return Response.json({ status: "received" });
}
```

Note the ordering here differs from the GitHub webhook route on purpose: GitHub logs to `webhook_events` *before* checking validity, since its signature check is a cheap inline boolean. Stripe's `stripe.webhooks.constructEvent` itself throws on an invalid signature — there's no parsed `event` to log if verification fails — so the early `401` return happens in the `catch` block before any log write, and the log write for a *valid* event happens after processing. This is a structural consequence of the Stripe SDK's verification API, not a deviation from the established pattern for its own sake.

- [ ] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 "src/app/api/v1/webhooks/stripe/route.ts"`
Strip if present.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx eslint "src/app/api/v1/webhooks/stripe/route.ts"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/v1/webhooks/stripe/route.ts"
git commit -m "Add Stripe webhook route: activate org on checkout.session.completed"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated suite**

```bash
npx tsc --noEmit
```
Expected: no output.

```bash
npx eslint .
```
Expected: no errors (pre-existing `_prevState`/`_formData` warnings in `issue-tracker.ts` are fine — they predate this plan).

```bash
npm test
```
Expected: all existing tests pass, plus the 5 new `computePrice` tests.

```bash
npm run build
```
Expected: production build succeeds, every route present including `/billing/upgrade`, `/billing/upgrade/success`, and `/api/v1/webhooks/stripe`.

```bash
git status --short
```
Expected: clean.

- [ ] **Step 2: State the live-Stripe verification gap explicitly**

**No live Stripe account or API keys exist in this session.** The following cannot be exercised end-to-end here, and this step is not a checklist to fake-pass — it's a record of what's left for whoever has real Stripe credentials to verify before this ships to real users:

- Creating a real Stripe Customer via `stripe.customers.create` and confirming `stripe_customer_id` gets stored.
- Creating a real Checkout Session and completing a test-mode payment.
- Confirming Stripe actually delivers a `checkout.session.completed` webhook to `/api/v1/webhooks/stripe`, that `stripe.webhooks.constructEvent` correctly verifies it against a real `STRIPE_WEBHOOK_SECRET`, and that the org flips to `active`.
- Confirming the `/billing/upgrade/success` polling page actually observes that flip and redirects within the 15-second window under real network/webhook-delivery latency.
- Confirming Stripe's webhook redelivery behavior is actually deduped correctly by the `payload->>id` check (this can only be forced by triggering a real redelivery from the Stripe dashboard's own webhook logs, or by simulating two POSTs with the same `event.id` locally using the Stripe CLI's `stripe trigger checkout.session.completed` against a local dev server with `STRIPE_WEBHOOK_SECRET` set to the CLI's own signing secret — worth doing once real Stripe test-mode credentials are available).

What **is** verified: the pricing math (`computePrice`, fully unit-tested), that every file type-checks and lints cleanly (proving correct usage of the Stripe SDK's TypeScript types, correct Next.js Server Action/route conventions, and no typos in field names against the real Supabase schema), and that the production build succeeds with every new route present.

- [ ] **Step 3: Confirm every scope decision from the spec is reflected**

Re-read `docs/superpowers/specs/2026-09-11-billing-checkout-design.md`'s 11 scope decisions and confirm each is covered:
1. `/billing/upgrade` is a dedicated minimal page, not inline in banners — Task 5.
2. Stripe Customer created lazily, only inside `startCheckout` — Task 4.
3. Both plan types use `mode: 'payment'`, no Subscription object anywhere — Task 4.
4. Price computed via dynamic `price_data`, not a Price catalog — Task 4.
5. Only `checkout.session.completed` is handled — Task 7.
6. Org id and plan type travel via Checkout Session `metadata` — Task 4 (write), Task 7 (read).
7. Idempotency via `webhook_events.payload->>id`, no new column — Task 7.
8. On success: `billing_status='active'`, `plan_type` set, `stripe_customer_id` stored, `billing_events` logged with `payment_succeeded` — Task 7.
9. No `stripe_subscription_id` column added — Task 2 (only `stripe_customer_id`).
10. Polling success page, ~2s interval, ~15s timeout — Task 6.
11. `cancel_url` needs no special handling — confirmed in Task 4's `startCheckout` (`cancel_url` just points back to `/billing/upgrade`, no other logic).

- [ ] **Step 4: Commit the plan checkbox updates**

```bash
git add docs/superpowers/plans/2026-09-11-billing-checkout.md
git commit -m "docs: mark Billing Checkout plan complete"
```
