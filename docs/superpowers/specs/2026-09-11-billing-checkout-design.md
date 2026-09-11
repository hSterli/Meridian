# Billing Checkout & Webhooks — Design

**Date**: 2026-09-11
**Status**: Approved, pending implementation
**Context**: Phase 2 of the billing initiative. Phase 1 (Foundation, PR #7) added `organizations.billing_status`/`trial_end_date`/`plan_type`, a `billing_events` audit table, and `UserContext.isReadOnly` gating every mutating Server Action. This is the first phase where real money moves: Stripe Checkout, a webhook handler, and the actual trial-to-paid conversion. Recurring billing (monthly and annual renewal), mid-year seat changes, plan switching, cancellation, and the full billing settings UI are each their own later phase — this phase only needs the minimal UI to trigger the *first* payment.

## Problem

Right now `isReadOnly` can only ever be `true` once a trial lapses — there is no way for an org to actually pay and become `active`. This phase closes that gap for the first payment only.

## Scope decisions

1. **Minimal checkout UI is a dedicated `/billing/upgrade` page, not inline in the banners.** The trial banner and the read-only action-error banner both link to it. The full Settings → Billing management page (showing current plan, next charge, Stripe portal link, cancel button) is Phase 5 — this page is deliberately smaller: just the monthly/annual choice and a price breakdown, not a placeholder to be thrown away later.
2. **Stripe Customer objects are created lazily**, on first checkout attempt — not eagerly at org creation. With no free tier, most trial orgs may never convert; creating a Stripe Customer (and the API call that requires) for every signup would be wasted work for orgs that lapse without ever reaching checkout.
3. **Both monthly and annual use Stripe Checkout in `mode: 'payment'` (a one-time charge) — neither uses a Stripe Subscription object.** This directly follows the external spec's own stated philosophy ("don't use Stripe's usage-based metering — calculate seats locally and invoice via the API each cycle"). A fixed-quantity Stripe Subscription would need active syncing every time someone's added or removed from an org anyway, working against Stripe's model instead of with it. Unifying monthly and annual onto the same mechanism (an initial one-time payment now, Phase 3's cron re-charging on whatever cadence the plan calls for) means one billing mechanism to reason about, not two.
4. **Price is computed server-side via Stripe Checkout's dynamic `price_data`**, not a pre-created catalog of Stripe Price objects. The exact charge depends on the org's current `organization_members` count at the moment of checkout (`$99 + $19×seats` monthly, `× 12 × 0.80` annual) — a variable amount that doesn't map onto a fixed set of pre-created Prices without either creating a new Price per possible seat count or (the simpler, standard Stripe pattern for variable-amount one-time charges) computing the exact amount and passing it inline via `price_data`.
5. **Only `checkout.session.completed` is handled — not the fuller webhook list from the original external spec** (`customer.created`, `payment_intent.succeeded`, `customer.subscription.created`, etc.). This is Stripe's own recommended fulfillment event for Checkout: it fires once, right after a successful checkout of either mode, and carries everything needed (customer id, mode, and — via Checkout Session metadata — the org id and chosen plan type). The other events in the original list matter more for recurring/subscription billing, which is Phase 3's concern, not this one; handling events this phase has no use for would just be more untested code paths.
6. **The org id and chosen plan type travel as Checkout Session `metadata`**, not `client_reference_id`. `client_reference_id` is a single string field; this phase needs two values (`orgId` and `planType`) available when the webhook fires, which `metadata` (an arbitrary key-value map) accommodates directly.
7. **Idempotency is handled by checking `webhook_events` for a prior row with the same Stripe event id before processing**, not by adding a new dedicated column. The Stripe event's own `id` (present in every webhook payload) is queried out of the existing `payload` JSONB column (`payload->>'id'`) — Stripe explicitly warns webhooks can be redelivered, and reusing the existing audit table for the dedup check avoids a schema change for something already derivable from data already being stored.
8. **On success, the org is updated to `billing_status = 'active'`, `plan_type` set from the metadata, and `stripe_customer_id` stored** (a new column on `organizations` — the one schema addition this phase needs). A `billing_events` row is logged with `event_type = 'payment_succeeded'` — this enum value already exists from Foundation, unused until now.
9. **`stripe_subscription_id` is deliberately not added to the schema.** Since scope decision 3 means no Stripe Subscription object is ever created in this phase (or, per that same reasoning, in the eventual design of Phase 3), there is nothing to store.
10. **The Checkout success redirect goes to a small polling page (`/billing/upgrade/success`), not straight into the app.** Stripe's redirect back to Meridian happens synchronously right after the user pays, but the *webhook* that actually flips `billing_status` to `'active'` can arrive slightly before or after that redirect completes — a real race, not a hypothetical one. This page shows "Setting up your account…" and polls (re-checks billing status client-side every ~2 seconds, up to a ~15-second timeout) until `billing_status` reads `active`, then proceeds into the app; if the timeout is hit, it proceeds anyway with a note that it may take a moment to fully reflect, rather than blocking the user indefinitely on a webhook that's unusually slow. This directly matches the external spec's own anticipated UX for this exact moment ("show 'processing…' while waiting for webhook").
11. **The Checkout `cancel_url` needs no special handling.** It returns to `/billing/upgrade` — nothing was charged, no state changed, and no webhook fires for an abandoned Checkout Session in this phase's minimal event handling (scope decision 5).

## Architecture

### Migration: `supabase/migrations/0027_billing_checkout.sql`

```sql
alter table organizations
  add column stripe_customer_id text;
```

That's the only schema change this phase needs (scope decisions 8-9).

### New dependency

`stripe` (the official Node SDK) gets added to `package.json`. No other new dependency.

### New env vars

Added to `.env.local.example`, alongside the existing `WEBHOOK_SHARED_SECRET` line:
```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```
Both are platform-level credentials for Meridian's own single Stripe merchant account — architecturally distinct from the per-org Vault-stored credentials the Jira/GitHub/Slack integrations use, where each *org* brings its own token. There is no Vault storage here; these are read directly from `process.env` at request time, the same way `WEBHOOK_SHARED_SECRET` already is in the generic webhook route.

### `src/lib/stripe/client.ts`

A thin wrapper, mirroring the existing per-provider client modules (`src/lib/github/client.ts`, `src/lib/slack/client.ts`) in spirit: a single shared `Stripe` SDK instance, plus the pricing math as a pure, tested function.

```ts
// src/lib/stripe/client.ts
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

`computePrice` is pure (no I/O — seat count is passed in, not queried inside it), matching this codebase's established `compute*` convention, and is the one piece of this phase with real branching logic worth unit-testing directly.

### `src/lib/actions/billing.ts` — the checkout Server Action

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
```

Note this function does not itself follow the `isReadOnly` gating convention from Foundation — starting checkout is exactly the one action a read-only org must still be able to take (it's the way *out* of read-only), so it's deliberately excluded, the same way `auth.ts`/`orgs.ts` were excluded in Foundation for their own reasons.

### `src/app/(app)/billing/upgrade/page.tsx` — the plan-choice page

A Server Component reading the org's current seat count (same `organization_members` count query) and rendering `computePrice` for both plan types side by side, with a form bound to `startCheckout` via `useActionState` (through a small client component, matching the established `ProfileForm`/`ApiKeyManager` pattern of a Server Component page + a `"use client"` form component).

### `src/app/(app)/billing/upgrade/success/page.tsx` — the polling success page

A client component. On mount, and every ~2 seconds thereafter (via `setInterval`), it calls a new small read-only Server Action, `checkBillingStatus()` (added to `src/lib/actions/billing.ts` alongside `startCheckout`), and redirects to `/dashboard` once it reports `'active'`. After ~15 seconds with no change, it redirects anyway with a query param (`?pending=1`) that the dashboard can optionally read later (not required to render anything different this phase — just future-proofing the hook, not new scope).

`checkBillingStatus()` mirrors the read-style Server Action precedent already in this codebase (`getAttachmentDownloadUrl` in `attachments.ts` — a Server Action that only reads and returns data, no mutation, no `ActionState` shape):

```ts
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

A dedicated Server Action rather than a new `/api/v1/*` route, since that prefix is reserved for the public, API-key-authenticated surface external CI tools call — this is an internal read for the currently signed-in user, matching every other internal data-fetch in this codebase.

### `src/app/api/v1/webhooks/stripe/route.ts`

Mirrors `src/app/api/v1/webhooks/github/route.ts`'s exact shape:

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

One deliberate difference from the GitHub route: the GitHub route logs to `webhook_events` *before* checking validity (since signature validity there is a boolean computed inline, cheap to check first). Here, `stripe.webhooks.constructEvent` itself throws on an invalid signature — there is no parsed `event` to log if verification fails, so the log write necessarily happens after a successful `constructEvent` call, with the early `401` return on the `catch` block happening before any log write for a genuinely invalid signature. This is a structural necessity of the Stripe SDK's verification API, not a scope decision.

## Testing

- `src/lib/stripe/client.test.ts`: unit tests for `computePrice` — monthly at 1/5/10 seats matches `$99 + $19×seats` exactly in cents; annual matches `(monthly subtotal) × 12 × 0.80` exactly in cents (rounded to the nearest cent); zero seats still charges the `$99` base.
- No test coverage is planned for the Server Action or the webhook route itself (matching this codebase's established convention throughout every prior integration this session — Jira/GitHub/Slack/GitLab client functions are unit-tested, but the Server Actions and webhook routes that call them are verified manually/via `tsc`+`eslint`+`build`, not unit tests, since they're thin orchestration over already-tested pure logic and external SDKs that would need extensive mocking to test meaningfully).

## Explicitly out of scope

- Recurring monthly re-charging and annual renewal (Phase 3 — needs a scheduler, which doesn't exist in this codebase yet).
- Mid-year seat additions/removals affecting billing, plan switching (monthly ↔ annual), cancellation/reactivation (Phase 4).
- The full Settings → Billing management page — current plan, next charge, Stripe Billing Portal link, cancel button (Phase 5).
- Any Stripe Subscription object, ever, in this design (scope decisions 3/9).
- `checkout.session.expired` or any webhook event beyond `checkout.session.completed` (scope decision 5).
- Transactional email (still no provider chosen, unchanged from Foundation's own out-of-scope list).
