# Billing Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an org's owner/admin a real Settings → Billing page showing plan, price, and next charge, with working switch-plan and cancel-subscription controls — the final phase of the billing initiative, pure UI wiring onto Phases 2-4's existing Server Actions.

**Architecture:** A server component (`settings/billing/page.tsx`) reads the org's billing fields directly and passes them to a client component (`billing-manager.tsx`) that renders one of five states (`trial`/`active`+no-pending-cancel/`active`+pending-cancel/`past_due`/`cancelled`) and binds `switchPlan`/`requestCancellation` via `useActionState`, mirroring the existing `upgrade-form.tsx` pattern. One line in `settings/page.tsx` turns the disabled "Billing" row into a real link.

**Tech Stack:** Next.js Server Components/Actions, `useActionState`, existing `Card`/`Button` UI components.

---

### Task 1: `BillingManager` client component

**Files:**
- Create: `src/components/settings/billing-manager.tsx`

- [ ] **Step 1: Write the component**

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: this file alone won't type-check cleanly yet if nothing imports it (unused-file errors don't occur in TS, so this should already be clean) — confirm no errors reference `billing-manager.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/billing-manager.tsx
git commit -m "$(cat <<'EOF'
Add BillingManager component

Renders one of five views by billing_status (trial/active/active with
pending cancellation/past_due/cancelled), binding the existing
switchPlan and requestCancellation Server Actions via useActionState.
Not yet rendered anywhere — wired into a page next.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `/settings/billing` page

**Files:**
- Create: `src/app/(app)/settings/billing/page.tsx`

- [ ] **Step 1: Write the page**

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

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/\(app\)/settings/billing/page.tsx src/components/settings/billing-manager.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/settings/billing/page.tsx"
git commit -m "$(cat <<'EOF'
Add Settings > Billing page

Reads the org's billing fields directly (billing_status, plan_type,
trial_end_date, next_billing_date, cancel_at) and seat count, passes
them to BillingManager. Not yet linked from anywhere — Settings' index
page still shows Billing as disabled.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Link Billing from the Settings index

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`

- [ ] **Step 1: Remove `Billing` from the disabled list**

Change the disabled-items array from:

```tsx
        {[
          {
            icon: Building2,
            title: "Organization",
            description: "Name, slug, and workspace-wide defaults.",
          },
          {
            icon: CreditCard,
            title: "Billing",
            description: "Plan, seats, and payment details.",
          },
        ].map((s) => (
```

to:

```tsx
        {[
          {
            icon: Building2,
            title: "Organization",
            description: "Name, slug, and workspace-wide defaults.",
          },
        ].map((s) => (
```

- [ ] **Step 2: Add a real `Billing` link**

Insert a new `<Link>` immediately after the existing `/settings/integrations` link and before the disabled-items `.map()` block:

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

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint "src/app/(app)/settings/page.tsx"`
Expected: clean. (`CreditCard` is already imported at the top of this file for the old disabled row — no import changes needed.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/settings/page.tsx"
git commit -m "$(cat <<'EOF'
Link Billing from the Settings index

Replaces the disabled "Coming soon" Billing row with a real link to
/settings/billing, matching how Integrations is already linked.
Organization stays disabled — unrelated to this phase.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Full verification pass, including manual multi-state browser testing

**Files:** none (verification only)

- [ ] **Step 1: Automated checks**

Run: `npm test && npx tsc --noEmit && npx eslint . && npm run build`
Expected: all clean. (No new unit tests are expected from this phase — `npm test`'s count should be unchanged from Phase 4's 97.)

- [ ] **Step 2: Manual browser verification of all five states**

Start the dev server and sign in as the test account. Using the Supabase MCP `execute_sql` tool against `ucnfcsosbdgknmzyuqbw`, temporarily set the test org's row to each state in turn, reloading `/settings/billing` after each:

```sql
-- trial (with days remaining)
update organizations set billing_status = 'trial', trial_end_date = now() + interval '5 days' where slug = '<test org slug>';
```
Expected: "5 days left in your trial." + "Add payment" button linking to `/billing/upgrade`.

```sql
-- active, no pending cancellation
update organizations set billing_status = 'active', plan_type = 'monthly', next_billing_date = now() + interval '20 days', cancel_at = null where slug = '<test org slug>';
```
Expected: "Monthly plan", price line, "Next charge: <date>", "Switch to annual" and "Cancel subscription" buttons both visible (as the signed-in test user, confirm they're an owner/admin first).

```sql
-- active, pending cancellation
update organizations set cancel_at = next_billing_date where slug = '<test org slug>';
```
Expected: "Your plan cancels on <date>." replaces both buttons.

```sql
-- past_due
update organizations set billing_status = 'past_due', cancel_at = null where slug = '<test org slug>';
```
Expected: red "Your last payment failed…" message, no buttons.

```sql
-- cancelled
update organizations set billing_status = 'cancelled' where slug = '<test org slug>';
```
Expected: "Your subscription has ended." + "Resubscribe" button linking to `/billing/upgrade`.

- [ ] **Step 3: Restore the test org's original state**

```sql
update organizations set billing_status = 'trial', plan_type = null, trial_end_date = now() + interval '14 days', next_billing_date = null, cancel_at = null where slug = '<test org slug>';
```

Confirm via `execute_sql` that the row matches whatever its state was before Step 2 started (check first, before running Step 2, what the actual pre-existing values are, and restore exactly those rather than assuming defaults).

- [ ] **Step 4: Re-check the spec's scope decisions against the code**

Confirm each of the 7 scope decisions in `docs/superpowers/specs/2026-09-19-billing-settings-ui-design.md` is reflected:
1. One page, `/settings/api`-shaped. ✓ (Task 2.)
2. No new Server Actions/schema — only `startCheckout` (existing, linked), `switchPlan`, `requestCancellation` used. ✓
3. Five distinct conditional states, no shared generic card. ✓ (Task 1.)
4. No update-payment-method flow. ✓ (Not present anywhere in this plan.)
5. No confirmation dialogs on cancel/switch. ✓ (Task 1 — direct form submits.)
6. Settings index Billing row is now a real link. ✓ (Task 3.)
7. Seat count/price computed fresh on every load, not cached. ✓ (Task 2's `computePrice` call.)

- [ ] **Step 5: Confirm working tree is clean**

Run: `git status --short`
Expected: empty output.
