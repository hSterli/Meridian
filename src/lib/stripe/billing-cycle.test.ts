import { describe, expect, it } from "vitest";
import {
  computeDunningAction,
  nextBillingDateAfter,
  remainingMonthsUntil,
  computeTrialReminderAction,
} from "./billing-cycle";

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

describe("remainingMonthsUntil", () => {
  it("matches the worked example: March to December inclusive is 10 months", () => {
    const from = new Date("2026-03-05T00:00:00Z");
    const until = new Date("2026-12-01T00:00:00Z");
    expect(remainingMonthsUntil(from, until)).toBe(10);
  });

  it("counts the current partial month as a full month", () => {
    const from = new Date("2026-01-31T23:00:00Z");
    const until = new Date("2026-02-01T01:00:00Z");
    expect(remainingMonthsUntil(from, until)).toBe(2);
  });

  it("floors at a minimum of 1 for the same month", () => {
    const from = new Date("2026-06-01T00:00:00Z");
    const until = new Date("2026-06-28T00:00:00Z");
    expect(remainingMonthsUntil(from, until)).toBe(1);
  });

  it("floors at a minimum of 1 even if until is before from", () => {
    const from = new Date("2026-06-15T00:00:00Z");
    const until = new Date("2026-01-01T00:00:00Z");
    expect(remainingMonthsUntil(from, until)).toBe(1);
  });

  it("counts a full year apart as 13 (12 plus the inclusive current month)", () => {
    const from = new Date("2026-01-15T00:00:00Z");
    const until = new Date("2027-01-15T00:00:00Z");
    expect(remainingMonthsUntil(from, until)).toBe(13);
  });
});

describe("computeTrialReminderAction", () => {
  it("fires a reminder exactly 3 days before trial_end_date", () => {
    const trialEndDate = new Date("2026-01-15T00:00:00Z");
    const now = new Date("2026-01-12T00:00:00Z");
    expect(computeTrialReminderAction(trialEndDate, now)).toEqual({ type: "reminder" });
  });

  it("fires expired on the first day after trial_end_date has passed", () => {
    const trialEndDate = new Date("2026-01-15T00:00:00Z");
    const now = new Date("2026-01-15T12:00:00Z");
    expect(computeTrialReminderAction(trialEndDate, now)).toEqual({ type: "expired" });
  });

  it("returns none for every other day count, including well past expiry", () => {
    const trialEndDate = new Date("2026-01-15T00:00:00Z");
    for (const days of [10, 5, 4, 2, 1, -1, -5, -30]) {
      const now = new Date(trialEndDate.getTime() - days * 24 * 60 * 60 * 1000);
      expect(computeTrialReminderAction(trialEndDate, now)).toEqual({ type: "none" });
    }
  });
});
