# Billing Settings UI — Design

**Date**: 2026-09-19
**Status**: Approved, pending implementation
**Context**: Phase 5, the final phase of the billing initiative. Phases 1-4 built the entire backend state machine (trial/`isReadOnly`, Checkout, recurring charges + dunning, mid-year seats/plan switching/cancellation) with zero UI beyond the minimal `/billing/upgrade` page Phase 2 needed for its own narrow purpose (starting the first checkout). This phase is the first (and only) general billing-management page: Settings → Billing, wiring existing Server Actions to buttons.

## Problem

An org's owner/admin currently has no way to see their plan, next charge date, or seat price, and no way to cancel or switch plans except by calling a Server Action directly (impossible from the UI). Settings' own index page still shows Billing as a disabled "Coming soon" row.

## Scope decisions

1. **One page**: `/settings/billing`, following the exact structure of `/settings/api` (a server component that loads data, gates on org membership/`onboarding`, renders a client "manager" component bound to Server Actions) — this codebase's established pattern for every real settings sub-page.
2. **No new Server Actions or schema** — this phase is purely UI wiring `startCheckout` (existing, reused for trial/cancelled states), `switchPlan`, `requestCancellation`, and a direct `organizations` read (existing pattern, not the existing `checkBillingStatus` action, since the page needs more fields than that action returns).
3. **Content is entirely conditional on `billing_status`**, five distinct states, no shared "generic" billing card:
   - `trial`: days-remaining text (reusing `TrialBanner`'s exact `daysUntil()` day-math) plus a link to the existing `/billing/upgrade` page. No new checkout UI — Phase 2 already built it.
   - `active`, `cancel_at` null: plan type, seat count, current price via `computePrice`, next charge date, a "Switch to monthly"/"Switch to annual" button (whichever `switchPlan` target applies) and a "Cancel subscription" button.
   - `active`, `cancel_at` set: a plain "Your plan cancels on `<date>`" notice. The switch/cancel controls are not rendered at all — both `switchPlan` and `requestCancellation` already refuse server-side when `cancel_at` is set (Phase 4), so hiding them client-side is purely a UX nicety, not a security boundary.
   - `past_due`: a status message — payment failed, Phase 3's daily cron retries automatically — with no "update payment method" action.
   - `cancelled`: a link back to `/billing/upgrade` to resubscribe. `startCheckout` doesn't check prior `billing_status`, so no new action is needed — a cancelled org starting a fresh Checkout session works exactly like a trial org's first one.
4. **No "update payment method" flow.** Recovering a `past_due` org today relies entirely on Phase 3's cron retrying the same saved card — there's no way to swap in a different card without going through `/billing/upgrade` again (which would re-run Checkout, but `startCheckout` doesn't distinguish "first payment" from "replace failing card," so this already technically works as an unintended side door). Building a purpose-made "update card" control needs a Stripe SetupIntent flow — a meaningfully separate feature, not requested by the external spec, and explicitly deferred here the same way every prior phase has flagged its own out-of-scope items rather than silently building or silently skipping them.
5. **Destructive actions fire directly on click, no confirmation dialog.** This mirrors an existing precedent already in the codebase: `ApiKeyManager`'s "Revoke" button calls its Server Action immediately with no modal, despite revocation also being irreversible. A `Modal` component exists in this codebase but is used in exactly one place (CSV import) for an unrelated purpose — introducing a new confirm-dialog pattern here would be inconsistent with how this app already treats its one other irreversible settings action.
6. **The Settings index page's disabled "Billing" row becomes a real `Link`** to `/settings/billing`, exactly matching how `/settings/integrations` is already linked from that same list — no other changes to that file.
7. **Seat count and price are read fresh on every page load** (via the same `organization_members` count + `computePrice` pattern `startCheckout`/`switchPlan` already use), not cached or derived from any stored field — matching how every other billing computation in this codebase treats seat count as always-live, never stored.

## Architecture

### `src/app/(app)/settings/billing/page.tsx` (new)

Server component, following `src/app/(app)/settings/api/page.tsx`'s exact shape:

```tsx
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { BillingManager } from "@/components/settings/billing-manager";
import { computePrice } from "@/lib/stripe/client";
import { switchPlan, requestCancellation } from "@/lib/actions/billing";

export default async function BillingSettingsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const isAdmin = ctx.activeRole === "owner" || ctx.activeRole === "admin";
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("billing_status, plan_type, trial_end_date, next_billing_date, cancel_at")
    .eq("id", ctx.activeOrgId)
    .single();

  const { count: seats } = await supabase
    .from("organization_members")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", ctx.activeOrgId);

  const price =
    org?.plan_type != null
      ? computePrice(org.plan_type as "monthly" | "annual", seats ?? 0)
      : null;

  return (
    <div className="max-w-2xl">
      <Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "Billing" }]} />
      <PageHeader title="Billing" description="Plan, seats, and payment status." />
      <BillingManager
        org={org ?? null}
        price={price}
        isAdmin={isAdmin}
        switchPlanAction={switchPlan}
        requestCancellationAction={requestCancellation}
      />
    </div>
  );
}
```

### `src/components/settings/billing-manager.tsx` (new)

Client component, mirroring `upgrade-form.tsx`'s `useActionState` wiring but with two independent actions/forms instead of one:

```tsx
"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/actions/auth";
import type { PriceBreakdown, BillingPlanType } from "@/lib/stripe/client";

interface OrgBillingFields {
  billing_status: "trial" | "active" | "past_due" | "cancelled";
  plan_type: BillingPlanType | null;
  trial_end_date: string | null;
  next_billing_date: string | null;
  cancel_at: string | null;
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export function BillingManager({
  org,
  price,
  isAdmin,
  switchPlanAction,
  requestCancellationAction,
}: {
  org: OrgBillingFields | null;
  price: PriceBreakdown | null;
  isAdmin: boolean;
  switchPlanAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  requestCancellationAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [switchState, switchFormAction, switchPending] = useActionState<ActionState, FormData>(
    switchPlanAction,
    {}
  );
  const [cancelState, cancelFormAction, cancelPending] = useActionState<ActionState, FormData>(
    requestCancellationAction,
    {}
  );

  if (!org) {
    return (
      <Card className="p-5">
        <p className="text-sm text-ink-secondary">No billing information found.</p>
      </Card>
    );
  }

  if (org.billing_status === "trial") {
    const daysRemaining = org.trial_end_date ? daysUntil(org.trial_end_date) : 0;
    return (
      <Card className="p-5 space-y-4">
        <p className="text-sm text-ink-secondary">
          {daysRemaining > 0
            ? `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left in your trial.`
            : "Your trial has ended."}
        </p>
        <Link href="/billing/upgrade">
          <Button type="button">Add payment</Button>
        </Link>
      </Card>
    );
  }

  if (org.billing_status === "cancelled") {
    return (
      <Card className="p-5 space-y-4">
        <p className="text-sm text-ink-secondary">Your subscription has ended.</p>
        <Link href="/billing/upgrade">
          <Button type="button">Resubscribe</Button>
        </Link>
      </Card>
    );
  }

  if (org.billing_status === "past_due") {
    return (
      <Card className="p-5">
        <p className="text-sm text-fail">
          Your last payment failed. We&apos;ll automatically retry your card on file over the
          next several days.
        </p>
      </Card>
    );
  }

  // active
  const otherPlan: BillingPlanType = org.plan_type === "monthly" ? "annual" : "monthly";

  return (
    <Card className="p-5 space-y-4">
      <div>
        <p className="font-ui-label font-semibold text-ink-primary capitalize">
          {org.plan_type} plan
        </p>
        {price && (
          <p className="text-sm text-ink-secondary">
            ${(price.totalCents / 100).toFixed(2)}/{org.plan_type === "monthly" ? "month" : "year"}{" "}
            for {price.seats} seat{price.seats === 1 ? "" : "s"}
          </p>
        )}
        {org.next_billing_date && (
          <p className="text-sm text-ink-secondary">
            Next charge: {new Date(org.next_billing_date).toLocaleDateString()}
          </p>
        )}
      </div>

      {org.cancel_at ? (
        <p className="text-sm text-ink-secondary">
          Your plan cancels on {new Date(org.cancel_at).toLocaleDateString()}.
        </p>
      ) : isAdmin ? (
        <div className="flex gap-3">
          <form action={switchFormAction}>
            <input type="hidden" name="planType" value={otherPlan} />
            <Button type="submit" variant="secondary" disabled={switchPending}>
              {switchPending ? "Switching…" : `Switch to ${otherPlan}`}
            </Button>
          </form>
          <form action={cancelFormAction}>
            <Button type="submit" variant="danger" disabled={cancelPending}>
              {cancelPending ? "Cancelling…" : "Cancel subscription"}
            </Button>
          </form>
        </div>
      ) : null}

      {switchState.error && <p className="text-sm text-fail">{switchState.error}</p>}
      {cancelState.error && <p className="text-sm text-fail">{cancelState.error}</p>}
    </Card>
  );
}
```

(`Button`'s `variant` prop is `"primary" | "secondary" | "ghost" | "danger"`, confirmed by reading `src/components/ui/button.tsx` directly — `secondary` for "Switch to…" and `danger` for "Cancel subscription" are both existing variants, not new ones.)

### `src/app/(app)/settings/page.tsx` — one row changed

The existing disabled `Billing` entry (currently inside the "Coming soon" `.map()` block alongside `Organization`) is pulled out into its own real `<Link>`, styled identically to the `Integrations` link immediately above it:

```tsx
<Link
  href="/settings/billing"
  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-paper-surface"
>
  <div className="rounded-lg bg-meridian-soft p-2 text-primary">
    <CreditCard size={18} />
  </div>
  <div className="flex-1">
    <p className="font-ui-label font-semibold text-ink-primary">Billing</p>
    <p className="text-sm text-ink-secondary">Plan, seats, and payment details.</p>
  </div>
  <ChevronRight size={18} className="text-ink-tertiary" />
</Link>
```

`Organization` stays in the disabled/"Coming soon" list unchanged — it's unrelated to this phase.

## Testing

No new unit tests — this phase adds only Server/Client Components with no new pure logic (the one small pure helper, `daysUntil`, is a verbatim copy of `TrialBanner`'s already-tested-by-inspection logic, not new code). Verified via `tsc`/`eslint`/`build` and manual browser testing of all five `billing_status` states (achievable in this environment by directly editing test rows via `execute_sql`, the same technique used to verify Foundation's `isReadOnly` logic live).

## Explicitly out of scope

- Update-payment-method / replace-card flow (scope decision 4) — needs a Stripe SetupIntent, a separate feature.
- Confirmation dialogs on cancel/switch (scope decision 5) — matches existing API-key-revoke precedent.
- Billing history / past invoices list — never requested by the external spec at any point in this initiative.
- Any change to `Organization`'s "Coming soon" status on the Settings index.
