# Billing Recurring Charges & Dunning — Design

**Date**: 2026-09-12
**Status**: Approved, pending implementation
**Context**: Phase 3 of the billing initiative. Phase 1 (Foundation) built the trial/`isReadOnly` state machine. Phase 2 (Checkout) gets an org from `trial` to `active` via a single Stripe Checkout payment, deliberately in `mode: 'payment'` rather than creating a Stripe Subscription — that phase's spec explicitly left re-charging on a cadence to this phase. This phase is that re-charging, plus the payment-failure retry/dunning schedule from the external planning docs: Day 1 of failure (retry-link notice, org stays active), Day 3 (warning notice), Day 5 (`billing_status = 'past_due'`, org becomes read-only), Day 30 (`billing_status = 'cancelled'`). Mid-year seat changes, plan switching, and the Settings → Billing management page remain out of scope — Phase 4/5.

## Problem

Right now an org that pays via Phase 2's Checkout becomes `active` exactly once and is never charged again — there's no mechanism that revisits it a month or a year later. There's also no infrastructure in this codebase for running anything on a schedule at all.

## Scope decisions

1. **A retroactive fix to Phase 2's `startCheckout` is bundled into this phase, not deferred**: `payment_intent_data: { setup_future_usage: 'off_session' }` gets added to the Checkout Session. Research during this phase's brainstorm confirmed Stripe Checkout in `mode: 'payment'` does **not** save a reusable payment method by default — without this parameter, there would be no saved card for anything in this phase to charge. This phase cannot function without it, so it's this phase's first task rather than a separate fix elsewhere.
2. **Scheduling is pg_cron + pg_net calling into a new internal Next.js route, not a platform-specific scheduler.** Both extensions are confirmed available on the live Supabase project (`pg_cron` 1.6.4, `pg_net` 0.20.4) but neither is enabled yet. No deployment-platform config (e.g. `vercel.json`) exists anywhere in this repo, so a platform-specific scheduler (Vercel Cron, etc.) can't be assumed to exist — Supabase itself is the one piece of infrastructure this app is confirmed to depend on regardless of where the Next.js app is actually hosted.
3. **The new route is `POST /api/internal/billing/run-cycle`**, authenticated by a new dedicated `CRON_SECRET` env var (checked against an `x-cron-secret` header), not `/api/v1/*` (reserved for the public, API-key-authenticated surface external CI tools call) and not reusing `WEBHOOK_SHARED_SECRET` (a different trust boundary — external senders vs. Supabase's own cron calling back into this app).
4. **`organizations` gains `next_billing_date`** (timestamptz, nullable) — set to one month or one year out (matching `plan_type`) after every successful charge, including the very first one from Phase 2's Checkout (this phase's migration back-fills it for any org already `active` from Phase 2, and Phase 2's `startCheckout`/the webhook route both get a small follow-up to set it going forward — see Architecture). One field drives both cadences: the daily cron just asks "is `next_billing_date <= now()`," with no separate monthly-vs-annual branching in the *scheduling* logic (only in what gets added to it after a successful charge).
5. **`organizations` gains `payment_failed_since`** (timestamptz, nullable) — set on the first failure in a streak, cleared on the next success. Dunning is inherently a multi-run, stateful process (unlike trial expiry, which is one fixed known date derivable at read time) — it needs an anchor point, and deriving one from `billing_events` on every cron run for every org would be meaningfully more complex than comparing one indexed column.
6. **The "retry" is not a separate mechanism — it's the natural consequence of a failed charge not advancing `next_billing_date`.** An org whose charge fails stays "due" (`next_billing_date` unchanged) and is simply included again in the next day's due-orgs query, where the cron attempts to charge it again automatically. `payment_failed_since` only governs when to escalate *consequences* (see decision 7), not whether a retry happens.
7. **Escalation only fires once per threshold, not once per day past it.** The cron computes `daysSinceFailure = floor((now() - payment_failed_since) / 1 day)` and only acts when `daysSinceFailure` exactly equals 1, 3, 5, or 30 — logging the appropriate `billing_events` row (and, at day 5 and day 30, actually changing `billing_status`) on that one matching day, not every day the org remains in a failed state past a threshold it already crossed.
8. **No email actually sends at any dunning stage.** Every point where the external spec's schedule calls for an email (Day 1/3/5/30) still gets a `billing_events` row logged with accurate timing — the state machine itself is fully real and correct — but actual delivery is still out of scope, exactly as it's been since Foundation (no email provider has been chosen in this codebase at any point in this initiative).
9. **Existing `billing_events.event_type` enum values are reused rather than adding new ones**: `invoice_issued` (a charge was attempted), `payment_succeeded` / `payment_failed` (the outcome), `subscription_renewed` (a recurring cycle succeeded — used for its intent even though no literal Stripe Subscription object exists, per Phase 2's deliberate design), `subscription_cancelled` (the Day-30 auto-cancellation). All five were already declared in Foundation's migration and, apart from `payment_succeeded`, unused until now.
10. **The recurring charge explicitly lists the customer's saved payment methods (`stripe.paymentMethods.list`) rather than relying on an implicit Stripe "default payment method."** Whether `setup_future_usage: 'off_session'` reliably sets a customer's default payment method is a Stripe implementation detail this design doesn't want to depend on — explicitly fetching and using the customer's most recent saved card is unambiguous regardless of that behavior.
11. **One daily cron run processes every active org in a single pass — no per-org locking or double-fire protection beyond pg_cron's own single-fire-per-schedule guarantee.** A manually-triggered second invocation of the same day's run could theoretically double-charge an org whose `next_billing_date` hadn't yet been updated from the first pass — an accepted, low-probability operational risk for this phase (mitigated in practice by pg_cron firing once), not solved with a distributed lock here. Matches the external spec's own "keep it simple" posture on billing mechanics.

## Architecture

### Migration: `supabase/migrations/0028_billing_recurring.sql`

```sql
alter table organizations
  add column next_billing_date timestamptz,
  add column payment_failed_since timestamptz;

-- Back-fill next_billing_date for any org already active from Phase 2's
-- one-time Checkout payment, so this phase's cron has something to compare
-- against for orgs that paid before this migration ran. Monthly gets +1
-- month from now, annual +1 year — an approximation for pre-existing paid
-- orgs (there's no stored payment date to compute the *exact* next-due date
-- from), acceptable since this only affects orgs that converted during the
-- narrow window between Phase 2 shipping and this migration running.
update organizations
set next_billing_date = case
  when plan_type = 'monthly' then now() + interval '1 month'
  when plan_type = 'annual' then now() + interval '1 year'
  else null
end
where billing_status = 'active' and next_billing_date is null;
```

### Env var

`.env.local.example` gains `CRON_SECRET=`, alongside `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`.

### Phase 2 follow-up: `startCheckout` and the Stripe webhook route both set `next_billing_date`

`src/lib/actions/billing.ts`'s `startCheckout` Checkout Session creation gains:

```ts
payment_intent_data: {
  setup_future_usage: "off_session",
},
```

`src/app/api/v1/webhooks/stripe/route.ts`'s `checkout.session.completed` handler's `organizations` update gains `next_billing_date`, computed the same way as the migration's back-fill (one month or one year out from *now*, i.e. from whenever the webhook actually lands — since this is the very first charge, "now" is the correct anchor, unlike the migration's back-fill which is an approximation for pre-existing orgs):

```ts
const nextBillingDate = new Date();
if (planType === "monthly") nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
else nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);

await supabase
  .from("organizations")
  .update({
    billing_status: "active",
    plan_type: planType,
    stripe_customer_id: (session.customer as string) ?? null,
    next_billing_date: nextBillingDate.toISOString(),
  })
  .eq("id", orgId);
```

### `src/lib/stripe/billing-cycle.ts` — the pure day-count/threshold logic

Mirroring this codebase's `compute*` convention: the *decision* of what a given org's cron pass should do is pure and testable; the actual Stripe/Supabase I/O around it isn't.

```ts
// src/lib/stripe/billing-cycle.ts
export type DunningAction =
  | { type: "none" }
  | { type: "notice"; day: 1 | 3 }
  | { type: "downgrade" } // day 5: billing_status -> past_due
  | { type: "cancel" }; // day 30: billing_status -> cancelled

export function computeDunningAction(paymentFailedSince: Date, now: Date): DunningAction {
  const daysSince = Math.floor((now.getTime() - paymentFailedSince.getTime()) / (24 * 60 * 60 * 1000));

  if (daysSince === 1) return { type: "notice", day: 1 };
  if (daysSince === 3) return { type: "notice", day: 3 };
  if (daysSince === 5) return { type: "downgrade" };
  if (daysSince === 30) return { type: "cancel" };
  return { type: "none" };
}

export function nextBillingDateAfter(planType: "monthly" | "annual", from: Date): Date {
  const next = new Date(from);
  if (planType === "monthly") next.setMonth(next.getMonth() + 1);
  else next.setFullYear(next.getFullYear() + 1);
  return next;
}
```

### `src/app/api/internal/billing/run-cycle/route.ts`

```ts
import { stripe, computePrice } from "@/lib/stripe/client";
import { computeDunningAction, nextBillingDateAfter } from "@/lib/stripe/billing-cycle";
import { createServiceClient } from "@/lib/supabase/service";
import type { BillingPlanType } from "@/lib/stripe/client";

export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();

  // Pass 1: charge every org whose next_billing_date has arrived. A failed
  // charge leaves next_billing_date untouched, so a failing org simply
  // reappears in this same query on every subsequent day until it succeeds
  // (scope decision 6) — that's the entire "retry" mechanism, no separate
  // scheduling needed. payment_failed_since is read here specifically so a
  // *repeat* failure doesn't reset the dunning clock: it's only set when
  // currently null (the first failure in a streak); every failure after
  // that preserves the original timestamp so Pass 2's day-count can
  // actually advance toward day 5/30 instead of restarting at zero daily.
  // Includes 'past_due', not just 'active': the external spec explicitly
  // calls for a 30-day retry window after an org goes past_due at day 5,
  // not a stop-retrying-immediately cutoff — retries continue all the way
  // to the day-30 auto-cancellation in Pass 2.
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

      // billing_status is explicitly reset to 'active' here even though
      // it's a no-op for orgs that were never past_due — an org that *was*
      // past_due and just paid successfully during its retry window needs
      // this to actually leave read-only, not just have its dates updated.
      await supabase
        .from("organizations")
        .update({
          billing_status: "active",
          next_billing_date: nextBillingDateAfter(org.plan_type as BillingPlanType, now).toISOString(),
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

  return Response.json({ status: "ok", processed: (dueOrgs ?? []).length, failing: (failingOrgs ?? []).length });
}
```

Note: an org that goes `past_due` at day 5 stays in *both* queries through day 30 (both use `.in("billing_status", ["active", "past_due"])`) — it keeps getting retried by Pass 1 and keeps being checked for escalation by Pass 2, matching the external spec's explicit "30-day retry window." `isReadOnly` from Foundation already treats `past_due` as read-only for everything *else* in the app regardless of this cron's own activity, so a `past_due` org is still fully blocked from normal use while these background retries continue. Only once it reaches `billing_status = 'cancelled'` at day 30 (or pays successfully and gets reset to `'active'`) does it stop matching either query.

### `pg_cron` schedule, and where its secrets actually live

SQL running inside a `pg_cron` job has no access to the Next.js process's `process.env` — it needs `CRON_SECRET` and the app's URL some other way. **Those values must never be embedded as literal text in a migration file** (migrations are committed to git; a real secret checked into source control defeats the point of having one). This codebase already has an established pattern for exactly this situation — Vault-stored secrets, read at execution time by a `SECURITY DEFINER` function — used throughout the Jira/GitHub/Slack integrations for their connection tokens. This phase reuses that same mechanism for two platform-level (not per-org) values instead.

The migration creates the extensions and the job, with the job's SQL body reading both values from `vault.decrypted_secrets` by name rather than containing them directly:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'billing-run-cycle',
  '0 6 * * *', -- daily, 6 AM UTC — matches the external spec's own stated cron timing
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

The migration does **not** populate `cron_app_url`/`cron_secret` itself — those two Vault secrets are created once, out-of-band, the same operational step as configuring the real `STRIPE_SECRET_KEY` (already flagged as something this session cannot do without live credentials). The implementation plan's final task states this explicitly as a manual step for whoever has access to the live environment: create both secrets via `select vault.create_secret('<value>', 'cron_app_url')` and `select vault.create_secret('<value>', 'cron_secret')` (the latter's value must match `CRON_SECRET` in the deployed app's actual environment variables, not `.env.local.example`'s blank placeholder).

One accepted limitation: `net.http_post` is asynchronous from Postgres's perspective (it queues the request via a background worker and returns immediately) — a failure to reach the app (wrong URL, network issue) isn't surfaced back to the `cron.schedule` call itself. Monitoring that layer is beyond this phase's minimal scope; `webhook_events`/`billing_events` still capture everything the *route itself* successfully processes once reached.

## Testing

- `src/lib/stripe/billing-cycle.test.ts`: unit tests for `computeDunningAction` — exactly day 1/3/5/30 produce their respective actions, every other day count (0, 2, 4, 6, 29, 31) produces `none`; and `nextBillingDateAfter` — monthly adds exactly one month, annual adds exactly one year, both preserving the day-of-month/leap-year edge cases JavaScript's `Date` already handles correctly via `setMonth`/`setFullYear`.
- No test coverage for `run-cycle/route.ts` itself, matching this codebase's established convention (thin orchestration over already-tested pure logic and the Stripe SDK, verified manually/via `tsc`+`eslint`+`build`, not unit tests) — same reasoning Phase 2's spec gave for not testing `startCheckout` or the webhook route directly.

## Explicitly out of scope

- Mid-year seat additions/removals affecting the price of the *next* charge before it's naturally recomputed at cycle time (Phase 4) — this phase's `run-cycle` route already recomputes seat count fresh every cycle via `computePrice`, so seat changes are naturally reflected at the *next* billing date; what's out of scope is any *immediate* mid-cycle charge for an added seat.
- Plan switching (monthly ↔ annual) — Phase 4.
- Cancellation initiated by the customer (only the Day-30 automatic cancellation from non-payment exists in this phase) — Phase 4.
- The Settings → Billing management page showing next-charge date, payment method, cancel button (Phase 5).
- Actually sending any dunning email (scope decision 8).
- Distributed locking / double-fire protection beyond pg_cron's own guarantees (scope decision 11).
