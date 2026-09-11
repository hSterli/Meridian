import { describe, expect, it } from "vitest";
import { computeDunningAction, nextBillingDateAfter } from "./billing-cycle";

describe("computeDunningAction", () => {
  const failedAt = new Date("2026-01-01T00:00:00Z");

  it("returns a day-1 notice exactly one day after the failure", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    expect(computeDunningAction(failedAt, now)).toEqual({ type: "notice", day: 1 });
  });

  it("returns a day-3 notice exactly three days after the failure", () => {
    const now = new Date("2026-01-04T00:00:00Z");
    expect(computeDunningAction(failedAt, now)).toEqual({ type: "notice", day: 3 });
  });

  it("returns a downgrade exactly five days after the failure", () => {
    const now = new Date("2026-01-06T00:00:00Z");
    expect(computeDunningAction(failedAt, now)).toEqual({ type: "downgrade" });
  });

  it("returns a cancel exactly thirty days after the failure", () => {
    const now = new Date("2026-01-31T00:00:00Z");
    expect(computeDunningAction(failedAt, now)).toEqual({ type: "cancel" });
  });

  it("returns none for every day count that isn't 1, 3, 5, or 30", () => {
    for (const days of [0, 2, 4, 6, 10, 29, 31]) {
      const now = new Date(failedAt.getTime() + days * 24 * 60 * 60 * 1000);
      expect(computeDunningAction(failedAt, now)).toEqual({ type: "none" });
    }
  });
});

describe("nextBillingDateAfter", () => {
  it("adds exactly one month for monthly", () => {
    const from = new Date("2026-01-15T12:00:00Z");
    const result = nextBillingDateAfter("monthly", from);
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(1); // February, 0-indexed
    expect(result.getUTCDate()).toBe(15);
  });

  it("adds exactly one year for annual", () => {
    const from = new Date("2026-01-15T12:00:00Z");
    const result = nextBillingDateAfter("annual", from);
    expect(result.getUTCFullYear()).toBe(2027);
    expect(result.getUTCMonth()).toBe(0); // January
    expect(result.getUTCDate()).toBe(15);
  });
});
