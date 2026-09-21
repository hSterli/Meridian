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
