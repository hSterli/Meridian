# Billing Lifecycle: Mid-Year Seats, Plan Switching, Cancellation — Design

**Date**: 2026-09-19
**Status**: Approved, pending implementation
**Context**: Phase 4 of the billing initiative. Phase 1 (Foundation) built the trial/`isReadOnly` state machine. Phase 2 (Checkout) gets an org to `active` via a one-time Stripe Checkout payment (`mode: 'payment'`, never a Subscription object), saving the card via `setup_future_usage: 'off_session'`. Phase 3 (Recurring) added a daily `pg_cron` job that recharges every org via `next_billing_date`, with a `payment_failed_since`-anchored Day 1/3/5/30 dunning schedule, and — critically for this phase — already recomputes seat count fresh via `computePrice` at *every* cycle, for both monthly and annual plans. This phase covers what's left: seats added mid-cycle on an annual plan, switching between monthly and annual, and customer-initiated cancellation. The Settings → Billing management page (Phase 5) is out of scope — this phase is Server Actions + schema + one cron addition only.

## Problem

Three gaps remain before an org can actually live on a paid plan day-to-day:

1. **Monthly plans already self-correct for seat changes** — Phase 3's cron recomputes `computePrice(plan_type, seats)` fresh every cycle, so a seat added mid-month is simply reflected at the next (at most ~1-month-away) charge. **Annual plans don't**: an org that adds a seat in month 3 of a 12-month term would otherwise get that seat for free until the next annual renewal, 9 months later.
2. There's no way to switch between monthly and annual at all.
3. There's no way for a customer to cancel — the only path to `billing_status = 'cancelled'` today is Phase 3's Day-30 non-payment auto-cancellation.

## Scope decisions

1. **Mid-year seat charging only applies to annual plans.** Monthly plans need no new code — confirmed by re-reading Phase 3's `run-cycle` route: Pass 1 already calls `computePrice(org.plan_type, seats)` with a fresh count from `organization_members` on every due charge, for every plan type. This is a real simplification the external planning docs didn't call out explicitly (they described seat billing as one general problem); it's called out here because assuming otherwise would mean building redundant logic.
2. **The trigger point is `acceptPendingInvites`**, the only place in this codebase seat count actually increases (`inviteMember` only inserts a pending `organization_invites` row — no seat exists until the invite is accepted on sign-in). It can join one user to multiple orgs in a single call, so the charge check runs per-org, once for each org that call just added a member to.
3. **The charge is the monthly per-seat rate × remaining full months until the org's `next_billing_date`, no discount** — the annual discount only applies to the full-term renewal price, not to a partial-term top-up. "Remaining full months" is computed by calendar month difference, **inclusive of the current month already in progress** (no day-of-month proration): `(untilYear - fromYear) * 12 + (untilMonth - fromMonth) + 1`, floored at a minimum of 1. This exact formula is what makes a March seat-add against a December renewal come out to 10 months (Mar–Dec inclusive), matching the external spec's own worked example.
4. **A failed mid-year charge is non-blocking and doesn't retry.** Unlike Phase 3's main recurring charge, this charge has no `billing_status`/read-only consequence — it's purely incremental revenue collection, and it's self-healing: the org's next annual renewal recomputes seats fresh via `computePrice` (decision 1), which naturally collects for any under-charged seat at that point. A failure here must never block `acceptPendingInvites` itself (a user's sign-in flow), so it's wrapped the same way `tryPostPrComment`/`trySendSlackNotification` wrap their own best-effort I/O elsewhere in this codebase — logged as a `payment_failed` billing event, swallowed, sign-in proceeds.
5. **Plan switching is asymmetric, and that asymmetry is load-bearing, not an inconsistency:**
   - **Monthly → annual** charges the full annual price immediately (`computePrice("annual", seats)`, using the org's saved card the same way Phase 3's cron charges it — `stripe.paymentMethods.list` + an `off_session` `PaymentIntent`), then sets `plan_type = 'annual'` and `next_billing_date = now + 1 year`.
   - **Annual → monthly takes no payment action at all** — it just flips `plan_type` to `'monthly'` immediately. `next_billing_date` is left untouched, so the org keeps its already-paid-for annual access exactly as long as it was paid for, and Phase 3's cron naturally starts charging the monthly rate the next time that date arrives. This is the external spec's own "continues until period end, then switches" behavior, arrived at for free because `next_billing_date` already means exactly that — no new field needed.
6. **Cancellation resolves a real conflict between the external spec's 5-status model and this codebase's actual 4-value `billing_status` enum (`trial | active | past_due | cancelled` — no `downgraded`).** The external spec wants two distinct moments: cancel-requested (access continues) and cancel-effective (access cut off). Naively setting `billing_status = 'cancelled'` at request time would immediately trigger Foundation's `isReadOnly` (which already treats `cancelled` as read-only), locking the customer out of access they already paid for. **Resolution: a new `organizations.cancel_at` column, not a new status.** Cancelling sets `cancel_at = next_billing_date` (the org's current paid-through date) — nothing else changes, access continues uninterrupted. Reusing Phase 3's existing daily cron rather than a new job, `billing_status` only actually flips to `'cancelled'` once `cancel_at` arrives.
7. **No `billing_events` row is logged at cancellation *request* time.** The pending state is fully visible by reading `cancel_at` directly (non-null = pending); the event worth auditing is the moment it actually takes effect (`subscription_cancelled`, already logged by the cron, reused — not a new event type).
8. **An org with a pending cancellation is excluded from Pass 1's charge query** (`cancel_at is null` added to the existing filter). This is a real bug that self-review caught before writing any code: `cancel_at` starts out equal to `next_billing_date`, so on the exact day cancellation takes effect, the *unmodified* Pass 1 query would still see `next_billing_date <= now()` and attempt to charge the org for a fresh period seconds before Pass 3 (below) cancels it — charging a customer for access they explicitly said they didn't want. Excluding pending-cancellation orgs from Pass 1 entirely closes this.
9. **Plan switching and mid-year seat charging both refuse to act on an org with a pending cancellation** (`cancel_at is not null`) — switching plans or charging for extra months on a subscription that's ending anyway makes no sense, and both would otherwise race against Pass 3 finalizing the cancellation.
10. **All three new/changed actions require `billing_status = 'active'`** (checked explicitly, not via the generic `isReadOnly` flag) — there's no active subscription to cancel or switch on a trial, past-due, or already-cancelled org. These actions are therefore **not** added to Foundation's blanket `isReadOnly`-gated action list; like `startCheckout`, they're billing's own actions with their own state preconditions.
11. **Backend-only this phase**: three Server Actions (`requestCancellation`, `switchPlan`, and the `acceptPendingInvites` hook) plus the schema/cron changes. No Settings → Billing page, no cancel/switch buttons anywhere yet — Phase 5 wires UI to these.
12. **Resuming (undoing) a pending cancellation is explicitly out of scope for this phase** — straightforward to add later (null out `cancel_at` while still `active`) but not asked for by the external spec and not needed until Phase 5 has a page to put the button on.

## Architecture

### Migration: `supabase/migrations/0029_billing_lifecycle.sql`

```sql
alter table organizations
  add column cancel_at timestamptz;
```

No new enum values needed — `billing_event_type` already has `seat_added_mid_year`, `plan_changed`, and `subscription_cancelled`, declared upfront in Foundation's migration and unused until now (the same pattern Phase 3 followed for `subscription_renewed`/`invoice_issued`).

### `src/lib/stripe/client.ts` — new pure helper

```ts
// Marginal monthly cost of one seat for `remainingMonths` months, no annual
// discount — used only for mid-year top-up charges on annual plans, never
// for a full renewal (which goes through computePrice as before).
export function computeMidYearSeatCharge(remainingMonths: number): number {
  return PER_SEAT_MONTHLY_CENTS * remainingMonths;
}
```

### `src/lib/stripe/billing-cycle.ts` — new pure helper

```ts
// Inclusive of the current calendar month already in progress — a seat
// added any time in March against a December renewal is 10 months (Mar
// through Dec), not 9. No day-of-month proration below month granularity.
export function remainingMonthsUntil(from: Date, until: Date): number {
  const months =
    (until.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (until.getUTCMonth() - from.getUTCMonth()) +
    1;
  return Math.max(1, months);
}
```

### `src/lib/actions/billing.ts` — three additions

`chargeMidYearAnnualSeat`, called by `acceptPendingInvites` once per org it just added a member to — best-effort, never throws:

```ts
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

`switchPlan`:

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

`requestCancellation`:

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

(All three read/write via the user-scoped `createClient()`, the same pattern `startCheckout` already uses for its own `organizations` update — no new RLS policy needed.)

### `src/lib/actions/members.ts` — hook into `acceptPendingInvites`

```ts
export async function acceptPendingInvites() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return;

  const { data: invites } = await supabase
    .from("organization_invites")
    .select("id, org_id, role")
    .ilike("email", user.email);

  for (const invite of invites ?? []) {
    await supabase
      .from("organization_members")
      .insert({ org_id: invite.org_id, user_id: user.id, role: invite.role });
    await supabase.from("organization_invites").delete().eq("id", invite.id);

    await chargeMidYearAnnualSeat(supabase, invite.org_id);
  }
}
```

### `src/app/api/internal/billing/run-cycle/route.ts` — two changes

Pass 1's query gains a `cancel_at is null` filter (scope decision 8):

```ts
const { data: dueOrgs } = await supabase
  .from("organizations")
  .select("id, plan_type, stripe_customer_id, payment_failed_since")
  .in("billing_status", ["active", "past_due"])
  .is("cancel_at", null)
  .lte("next_billing_date", now.toISOString());
```

A new Pass 3, appended after the existing dunning-escalation pass:

```ts
// Pass 3: finalize any pending cancellation whose paid-through period has
// now elapsed. cancel_at was set by requestCancellation to the org's
// next_billing_date at request time — access continues until that date
// arrives, then this pass (reusing the existing daily job, not a new one)
// flips billing_status, matching Foundation's existing isReadOnly treatment
// of 'cancelled'. Pass 1 already excludes these orgs via cancel_at is null,
// so there's no race with a fresh charge on the cutover day.
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

The route's final response gains a `cancelled: (cancelingOrgs ?? []).length` count alongside the existing `processed`/`failing`.

## Testing

- `src/lib/stripe/client.test.ts`: `computeMidYearSeatCharge` — 1 month = one seat-month, 10 months matches the worked example's expected total.
- `src/lib/stripe/billing-cycle.test.ts`: `remainingMonthsUntil` — same month = 1 (floor), March→December same year = 10 (the worked example), a full year apart = 13 (12 + the inclusive current month), `until` before `from` still floors at 1 rather than going negative.
- No new test coverage for `switchPlan`/`requestCancellation`/`chargeMidYearAnnualSeat`/the route changes themselves — matching this codebase's established convention (thin orchestration over already-tested pure logic and the Stripe SDK, verified via `tsc`/`eslint`/`build`, not unit tests), the same reasoning every prior phase's spec gave for `startCheckout` and the webhook/cron routes.

## Explicitly out of scope

- Any UI — Settings → Billing page, cancel button, plan-switch control (Phase 5).
- Resuming/undoing a pending cancellation (scope decision 12).
- Seat *removal* affecting price mid-cycle in either direction (not asked for by the external spec; monthly self-corrects at next cycle per decision 1, annual has no analogous "give money back" mechanism and isn't being built one).
- Retrying a failed mid-year seat charge (decision 4 — it's non-blocking and self-heals at the next annual renewal).
- Actually sending any email at any of these transitions (out of scope since Foundation, no provider chosen).
- Live end-to-end Stripe testing (no live Stripe credentials in this session, flagged in every phase so far).
