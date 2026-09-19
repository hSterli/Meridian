# Billing Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give organizations on a paid plan a way to add seats mid-cycle without losing revenue on annual plans, switch between monthly and annual billing, and cancel — without introducing a new `billing_status` value.

**Architecture:** One new nullable `organizations.cancel_at` column represents a pending cancellation without touching `billing_status` until it actually takes effect. Two new pure functions (`computeMidYearSeatCharge`, `remainingMonthsUntil`) compute the mid-year top-up charge. Three new/modified pieces of I/O wire it up: a best-effort charge hooked into `acceptPendingInvites` (the only place seat count increases), a `switchPlan` Server Action, and a `requestCancellation` Server Action. Phase 3's existing daily cron gains one filter (exclude orgs with a pending cancellation from the charge pass — closes a same-day double-charge race) and one new pass (finalize cancellations whose paid-through date has arrived).

**Tech Stack:** Next.js Server Actions, Supabase (Postgres + RLS), Stripe Node SDK (`paymentMethods.list` / `paymentIntents.create`, reusing Phase 3's off-session charge pattern), Vitest.

---

### Task 1: Migration — add `cancel_at`

**Files:**
- Create: `supabase/migrations/0029_billing_lifecycle.sql`

- [ ] **Step 1: Write the migration**

```sql
alter table organizations
  add column cancel_at timestamptz;
```

No new enum values — `billing_event_type` already has `seat_added_mid_year`, `plan_changed`, and `subscription_cancelled` from Foundation's migration, unused until this phase.

- [ ] **Step 2: Apply via Supabase MCP**

Use the `apply_migration` MCP tool against project ref `ucnfcsosbdgknmzyuqbw` with this file's content.

- [ ] **Step 3: Verify live**

Use the `execute_sql` MCP tool:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'organizations' and column_name = 'cancel_at';
```

Expected: one row, `cancel_at`, `timestamp with time zone`, `YES`.

- [ ] **Step 4: Run security advisors**

Use the `get_advisors` MCP tool (type `security`). Confirm no new findings beyond the already-accepted `pg_net`-in-public warning from Phase 3.

- [ ] **Step 5: Regenerate TypeScript types**

Use the `generate_typescript_types` MCP tool against `ucnfcsosbdgknmzyuqbw`. Overwrite `src/lib/types/database.ts`. **Check the diff for a dropped "App-level convenience aliases" block** (this has happened in every prior phase's Task 1) — if the generator's output doesn't include it, re-add it from git history (`git show HEAD:src/lib/types/database.ts` and copy the block back in).

Run: `npx tsc --noEmit`
Expected: no new errors. If there are ~40 errors mentioning missing aliases, that's the dropped block — fix per above and re-run.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0029_billing_lifecycle.sql src/lib/types/database.ts
git commit -m "$(cat <<'EOF'
Add organizations.cancel_at for pending cancellation

No new billing_status value needed — access continues until cancel_at
(the org's current paid-through date) arrives, then the existing daily
cron flips billing_status to 'cancelled'.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `computeMidYearSeatCharge`

**Files:**
- Modify: `src/lib/stripe/client.ts`
- Test: `src/lib/stripe/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/stripe/client.test.ts`:

```ts
import { computeMidYearSeatCharge } from "./client";
```

(add to the existing `import { computePrice } from "./client";` line instead — change it to `import { computeMidYearSeatCharge, computePrice } from "./client";`)

```ts
describe("computeMidYearSeatCharge", () => {
  it("charges one seat-month at the monthly per-seat rate", () => {
    expect(computeMidYearSeatCharge(1)).toBe(1900);
  });

  it("charges ten seat-months for a March-to-December top-up", () => {
    expect(computeMidYearSeatCharge(10)).toBe(1900 * 10);
  });

  it("applies no discount regardless of month count", () => {
    expect(computeMidYearSeatCharge(12)).toBe(1900 * 12);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/lib/stripe/client.test.ts`
Expected: FAIL — `computeMidYearSeatCharge` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/stripe/client.ts`, after `computePrice`:

```ts
// Marginal monthly cost of one seat for `remainingMonths` months, no annual
// discount — used only for a mid-year top-up charge on an annual plan when
// a seat is added between renewals, never for a full renewal (which still
// goes through computePrice).
export function computeMidYearSeatCharge(remainingMonths: number): number {
  return PER_SEAT_MONTHLY_CENTS * remainingMonths;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/lib/stripe/client.test.ts`
Expected: PASS, all tests including the pre-existing `computePrice` ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stripe/client.ts src/lib/stripe/client.test.ts
git commit -m "$(cat <<'EOF'
Add computeMidYearSeatCharge

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `remainingMonthsUntil`

**Files:**
- Modify: `src/lib/stripe/billing-cycle.ts`
- Test: `src/lib/stripe/billing-cycle.test.ts`

- [ ] **Step 1: Write the failing tests**

Change the import line in `src/lib/stripe/billing-cycle.test.ts`:

```ts
import { computeDunningAction, nextBillingDateAfter, remainingMonthsUntil } from "./billing-cycle";
```

Append:

```ts
describe("remainingMonthsUntil", () => {
  it("matches the worked example: March to December inclusive is 10 months", () => {
    const from = new Date("2026-03-05T00:00:00Z");
    const until = new Date("2026-12-01T00:00:00Z");
    expect(remainingMonthsUntil(from, until)).toBe(10);
  });

  it("counts the current partial month as a full month", () => {
    const from = new Date("2026-01-31T23:00:00Z");
    const until = new Date("2026-02-01T01:00:00Z");
    expect(remainingMonthsUntil(from, until)).toBe(2);
  });

  it("floors at a minimum of 1 for the same month", () => {
    const from = new Date("2026-06-01T00:00:00Z");
    const until = new Date("2026-06-28T00:00:00Z");
    expect(remainingMonthsUntil(from, until)).toBe(1);
  });

  it("floors at a minimum of 1 even if until is before from", () => {
    const from = new Date("2026-06-15T00:00:00Z");
    const until = new Date("2026-01-01T00:00:00Z");
    expect(remainingMonthsUntil(from, until)).toBe(1);
  });

  it("counts a full year apart as 13 (12 plus the inclusive current month)", () => {
    const from = new Date("2026-01-15T00:00:00Z");
    const until = new Date("2027-01-15T00:00:00Z");
    expect(remainingMonthsUntil(from, until)).toBe(13);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/lib/stripe/billing-cycle.test.ts`
Expected: FAIL — `remainingMonthsUntil` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/stripe/billing-cycle.ts`, after `nextBillingDateAfter`:

```ts
// Inclusive of the current calendar month already in progress — a seat
// added any time in March against a December renewal is 10 months (March
// through December), not 9. No day-of-month proration below month
// granularity: only the month/year components matter.
export function remainingMonthsUntil(from: Date, until: Date): number {
  const months =
    (until.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (until.getUTCMonth() - from.getUTCMonth()) +
    1;
  return Math.max(1, months);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/lib/stripe/billing-cycle.test.ts`
Expected: PASS, all tests including the pre-existing `computeDunningAction`/`nextBillingDateAfter` ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stripe/billing-cycle.ts src/lib/stripe/billing-cycle.test.ts
git commit -m "$(cat <<'EOF'
Add remainingMonthsUntil

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `chargeMidYearAnnualSeat`

**Files:**
- Modify: `src/lib/actions/billing.ts`

No test file — this is I/O orchestration over already-tested pure functions and the Stripe SDK, matching this codebase's established convention for `startCheckout`/the webhook/cron routes (verified via `tsc`/`eslint`/`build`, not unit tests).

- [ ] **Step 1: Update imports**

In `src/lib/actions/billing.ts`, change:

```ts
import { stripe, computePrice, type BillingPlanType } from "@/lib/stripe/client";
```

to:

```ts
import { stripe, computePrice, computeMidYearSeatCharge, type BillingPlanType } from "@/lib/stripe/client";
import { nextBillingDateAfter, remainingMonthsUntil } from "@/lib/stripe/billing-cycle";
```

- [ ] **Step 2: Add the function**

Append to `src/lib/actions/billing.ts`, after `checkBillingStatus`:

```ts
/**
 * Best-effort mid-year top-up for one seat on an annual plan. No-op for
 * monthly plans (Phase 3's cron already recomputes seats fresh every
 * cycle) and for anything other than a plain active annual subscription.
 * A failure here is logged and swallowed, never thrown — it must not block
 * the caller (acceptPendingInvites, part of sign-in), and it's self-healing:
 * the org's next annual renewal recomputes seats fresh via computePrice.
 */
export async function chargeMidYearAnnualSeat(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string
): Promise<void> {
  const { data: org } = await supabase
    .from("organizations")
    .select("plan_type, billing_status, stripe_customer_id, next_billing_date, cancel_at")
    .eq("id", orgId)
    .single();

  if (!org) return;
  if (org.plan_type !== "annual" || org.billing_status !== "active") return;
  if (org.cancel_at || !org.stripe_customer_id || !org.next_billing_date) return;

  try {
    const months = remainingMonthsUntil(new Date(), new Date(org.next_billing_date));
    const amount = computeMidYearSeatCharge(months);

    const methods = await stripe.paymentMethods.list({
      customer: org.stripe_customer_id,
      type: "card",
    });
    const paymentMethod = methods.data[0];
    if (!paymentMethod) throw new Error("no saved payment method");

    await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      customer: org.stripe_customer_id,
      payment_method: paymentMethod.id,
      off_session: true,
      confirm: true,
    });

    await supabase.from("billing_events").insert({ org_id: orgId, event_type: "seat_added_mid_year" });
  } catch {
    await supabase.from("billing_events").insert({ org_id: orgId, event_type: "payment_failed" });
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/billing.ts
git commit -m "$(cat <<'EOF'
Add chargeMidYearAnnualSeat

Best-effort top-up charge for one seat on an annual plan, at the monthly
per-seat rate for the remaining months until renewal, no discount. Not
yet called from anywhere — wired into acceptPendingInvites next.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Hook the charge into `acceptPendingInvites`

**Files:**
- Modify: `src/lib/actions/members.ts`

- [ ] **Step 1: Add the import**

In `src/lib/actions/members.ts`, add to the top:

```ts
import { chargeMidYearAnnualSeat } from "@/lib/actions/billing";
```

- [ ] **Step 2: Call it per org inside the loop**

Change `acceptPendingInvites`'s loop from:

```ts
  for (const invite of invites ?? []) {
    await supabase
      .from("organization_members")
      .insert({ org_id: invite.org_id, user_id: user.id, role: invite.role });
    await supabase.from("organization_invites").delete().eq("id", invite.id);
  }
```

to:

```ts
  for (const invite of invites ?? []) {
    await supabase
      .from("organization_members")
      .insert({ org_id: invite.org_id, user_id: user.id, role: invite.role });
    await supabase.from("organization_invites").delete().eq("id", invite.id);

    await chargeMidYearAnnualSeat(supabase, invite.org_id);
  }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. (This also confirms no import cycle at the type level — `billing.ts` imports `ActionState` from `auth.ts` with `import type`, which is erased at compile time, so `auth.ts → members.ts → billing.ts` stays a one-way chain at runtime.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/members.ts
git commit -m "$(cat <<'EOF'
Charge mid-year annual seat top-ups on invite acceptance

acceptPendingInvites is the only place seat count actually increases in
this app, and the only place that can join one user to multiple orgs in
a single call — the charge is checked per org it touches.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `switchPlan` Server Action

**Files:**
- Modify: `src/lib/actions/billing.ts`

- [ ] **Step 1: Add the import**

Add `revalidatePath` to `src/lib/actions/billing.ts`'s imports — change:

```ts
import { redirect } from "next/navigation";
```

to:

```ts
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
```

- [ ] **Step 2: Add the function**

Append to `src/lib/actions/billing.ts`:

```ts
export async function switchPlan(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const targetPlan = String(formData.get("planType") ?? "") as BillingPlanType;
  if (targetPlan !== "monthly" && targetPlan !== "annual") return { error: "Choose a plan." };

  const ctx = await getUserContext();
  if (!ctx || !ctx.activeOrgId) return { error: "No active team selected." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can change plans." };
  }

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("plan_type, billing_status, stripe_customer_id, cancel_at")
    .eq("id", ctx.activeOrgId)
    .single();

  if (!org) return { error: "Organization not found." };
  if (org.billing_status !== "active") return { error: "Only an active subscription can switch plans." };
  if (org.cancel_at) return { error: "Cancellation is already pending — nothing to switch." };
  if (org.plan_type === targetPlan) return { error: "Already on that plan." };

  if (targetPlan === "monthly") {
    await supabase.from("organizations").update({ plan_type: "monthly" }).eq("id", ctx.activeOrgId);
    await supabase.from("billing_events").insert({ org_id: ctx.activeOrgId, event_type: "plan_changed" });
    revalidatePath("/billing");
    return { success: true };
  }

  if (!org.stripe_customer_id) return { error: "No payment method on file." };

  const { count: seats } = await supabase
    .from("organization_members")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", ctx.activeOrgId);

  const price = computePrice("annual", seats ?? 0);

  const methods = await stripe.paymentMethods.list({ customer: org.stripe_customer_id, type: "card" });
  const paymentMethod = methods.data[0];
  if (!paymentMethod) return { error: "No payment method on file." };

  try {
    await stripe.paymentIntents.create({
      amount: price.totalCents,
      currency: "usd",
      customer: org.stripe_customer_id,
      payment_method: paymentMethod.id,
      off_session: true,
      confirm: true,
    });
  } catch {
    return { error: "Payment failed. Please try again or update your payment method." };
  }

  await supabase
    .from("organizations")
    .update({
      plan_type: "annual",
      next_billing_date: nextBillingDateAfter("annual", new Date()).toISOString(),
    })
    .eq("id", ctx.activeOrgId);
  await supabase.from("billing_events").insert({ org_id: ctx.activeOrgId, event_type: "plan_changed" });

  revalidatePath("/billing");
  return { success: true };
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/actions/billing.ts`
Expected: clean (one accepted `_prevState`-unused-var warning, same class as this codebase's other `ActionState` actions).

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/billing.ts
git commit -m "$(cat <<'EOF'
Add switchPlan Server Action

Monthly to annual charges the full annual price immediately via the
saved payment method. Annual to monthly takes no immediate action — it
flips plan_type now and leaves next_billing_date untouched, so the
existing cron naturally starts charging the monthly rate at the date
the org already paid through.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `requestCancellation` Server Action

**Files:**
- Modify: `src/lib/actions/billing.ts`

- [ ] **Step 1: Add the function**

Append to `src/lib/actions/billing.ts`:

```ts
export async function requestCancellation(
  _prevState: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const ctx = await getUserContext();
  if (!ctx || !ctx.activeOrgId) return { error: "No active team selected." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can cancel." };
  }

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("billing_status, next_billing_date, cancel_at")
    .eq("id", ctx.activeOrgId)
    .single();

  if (!org) return { error: "Organization not found." };
  if (org.billing_status !== "active") return { error: "Only an active subscription can be cancelled." };
  if (org.cancel_at) return { error: "Cancellation is already pending." };
  if (!org.next_billing_date) return { error: "No billing period found." };

  await supabase
    .from("organizations")
    .update({ cancel_at: org.next_billing_date })
    .eq("id", ctx.activeOrgId);

  revalidatePath("/billing");
  return { success: true };
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/actions/billing.ts`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/billing.ts
git commit -m "$(cat <<'EOF'
Add requestCancellation Server Action

Sets cancel_at to the org's current next_billing_date rather than
flipping billing_status immediately — access continues through the
already-paid-for period. billing_status only becomes 'cancelled' once
cancel_at arrives, via the existing daily cron (next task).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Cron route — exclude pending cancellations from charging, finalize them once due

**Files:**
- Modify: `src/app/api/internal/billing/run-cycle/route.ts`

- [ ] **Step 1: Add the `cancel_at is null` filter to Pass 1**

Change:

```ts
  const { data: dueOrgs } = await supabase
    .from("organizations")
    .select("id, plan_type, stripe_customer_id, payment_failed_since")
    .in("billing_status", ["active", "past_due"])
    .lte("next_billing_date", now.toISOString());
```

to:

```ts
  const { data: dueOrgs } = await supabase
    .from("organizations")
    .select("id, plan_type, stripe_customer_id, payment_failed_since")
    .in("billing_status", ["active", "past_due"])
    .is("cancel_at", null)
    .lte("next_billing_date", now.toISOString());
```

Also update the comment block directly above it (currently explaining Pass 1's `past_due` inclusion and `payment_failed_since` handling) to add one sentence: `cancel_at is null` excludes any org with a pending cancellation — otherwise, on the exact day cancel_at arrives (it starts out equal to next_billing_date), this query would still see next_billing_date <= now() and charge the org for a fresh period moments before Pass 3 below cancels it.

- [ ] **Step 2: Add Pass 3 after the existing dunning-escalation pass**

Append, after the closing `}` of the `for (const org of failingOrgs ?? [])` loop and before the final `return Response.json(...)`:

```ts
  // Pass 3: finalize any pending cancellation whose paid-through period has
  // now elapsed. cancel_at was set by requestCancellation to the org's
  // next_billing_date at request time — access continues until that date
  // arrives, then this pass (reusing this existing daily job rather than a
  // new one) flips billing_status, matching Foundation's isReadOnly
  // treatment of 'cancelled'. Pass 1 already excludes these orgs via
  // cancel_at is null, so there's no race with a fresh charge on the
  // cutover day.
  const { data: cancelingOrgs } = await supabase
    .from("organizations")
    .select("id")
    .not("cancel_at", "is", null)
    .lte("cancel_at", now.toISOString());

  for (const org of cancelingOrgs ?? []) {
    await supabase
      .from("organizations")
      .update({ billing_status: "cancelled", cancel_at: null })
      .eq("id", org.id);
    await supabase.from("billing_events").insert({
      org_id: org.id,
      event_type: "subscription_cancelled",
    });
  }
```

- [ ] **Step 3: Add the cancelled count to the response**

Change:

```ts
  return Response.json({
    status: "ok",
    processed: (dueOrgs ?? []).length,
    failing: (failingOrgs ?? []).length,
  });
```

to:

```ts
  return Response.json({
    status: "ok",
    processed: (dueOrgs ?? []).length,
    failing: (failingOrgs ?? []).length,
    cancelled: (cancelingOrgs ?? []).length,
  });
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/api/internal/billing/run-cycle/route.ts`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/internal/billing/run-cycle/route.ts
git commit -m "$(cat <<'EOF'
Finalize pending cancellations in the daily billing cron

Pass 1 now excludes orgs with a pending cancellation, closing a
same-day race where the old query would charge for a fresh period
moments before cancellation took effect. A new Pass 3 flips
billing_status to 'cancelled' once cancel_at has arrived.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, including the new `computeMidYearSeatCharge` and `remainingMonthsUntil` suites.

- [ ] **Step 2: Type-check, lint, build**

Run: `npx tsc --noEmit && npx eslint . && npm run build`
Expected: all clean.

- [ ] **Step 3: Confirm live schema**

Use the `execute_sql` MCP tool against `ucnfcsosbdgknmzyuqbw`:

```sql
select count(*) from organizations where cancel_at is not null;
```

Expected: `0` (no org has requested cancellation yet in this environment).

- [ ] **Step 4: Re-check the spec's scope decisions against the code**

Confirm each of the 12 scope decisions in `docs/superpowers/specs/2026-09-19-billing-lifecycle-design.md` is actually reflected:
1. Monthly plans untouched — no new code path for them. ✓ (Tasks 2-5 only ever branch on `plan_type === "annual"`.)
2. Trigger is `acceptPendingInvites`, per-org. ✓ (Task 5.)
3. Charge = monthly rate × remaining full months, no discount. ✓ (Task 2, Task 4.)
4. Failed mid-year charge is non-blocking, no retry. ✓ (Task 4's try/catch swallows and logs.)
5. Plan switching is asymmetric (monthly→annual charges now; annual→monthly doesn't). ✓ (Task 6.)
6. Cancellation uses `cancel_at`, not a new `billing_status` value. ✓ (Task 1, Task 7.)
7. No `billing_events` row at cancellation *request* time. ✓ (Task 7 — only Task 8's Pass 3 logs `subscription_cancelled`.)
8. Pass 1 excludes pending-cancellation orgs. ✓ (Task 8, Step 1.)
9. `switchPlan`/`chargeMidYearAnnualSeat` both refuse to act when `cancel_at` is set. ✓ (Task 4, Task 6.)
10. All three new actions gate on `billing_status === 'active'` explicitly, not via `isReadOnly`. ✓
11. No new UI. ✓ (No `.tsx`/page files touched by this plan.)
12. No "undo cancellation" action. ✓ (Not present in any task.)

- [ ] **Step 5: State what remains manual**

No live Stripe credentials exist in this session (same as every prior phase) — `chargeMidYearAnnualSeat`'s and `switchPlan`'s actual `stripe.paymentMethods.list`/`paymentIntents.create` calls are verified via `tsc`/`eslint`/`build` and the pure-function unit tests only, not a live charge. This is explicitly flagged here rather than silently assumed to have been tested end-to-end.

- [ ] **Step 6: Confirm working tree is clean**

Run: `git status --short`
Expected: empty output (everything committed).
