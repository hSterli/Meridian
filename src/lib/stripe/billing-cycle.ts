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
