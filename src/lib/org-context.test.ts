import { describe, expect, it } from "vitest";

type BillingStatus = "trial" | "active" | "past_due" | "cancelled";

function computeIsReadOnly(billingStatus: BillingStatus | undefined, trialEndDate: string | null | undefined): boolean {
  return (
    billingStatus === "past_due" ||
    billingStatus === "cancelled" ||
    (billingStatus === "trial" && !!trialEndDate && new Date(trialEndDate) < new Date())
  );
}

describe("computeIsReadOnly (mirrors getUserContext's isReadOnly logic)", () => {
  it("is false for a trial with a future trial_end_date", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(computeIsReadOnly("trial", future)).toBe(false);
  });

  it("is true for a trial with a past trial_end_date", () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(computeIsReadOnly("trial", past)).toBe(true);
  });

  it("is false for active regardless of trial_end_date", () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(computeIsReadOnly("active", past)).toBe(false);
  });

  it("is true for past_due", () => {
    expect(computeIsReadOnly("past_due", null)).toBe(true);
  });

  it("is true for cancelled", () => {
    expect(computeIsReadOnly("cancelled", null)).toBe(true);
  });

  it("is false for trial with a null trial_end_date (pre-existing orgs from before this migration)", () => {
    expect(computeIsReadOnly("trial", null)).toBe(false);
  });
});
