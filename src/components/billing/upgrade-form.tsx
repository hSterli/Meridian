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
