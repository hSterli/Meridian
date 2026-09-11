import { describe, expect, it } from "vitest";
import { computePrice } from "./client";

describe("computePrice", () => {
  it("charges the base plus per-seat rate for monthly", () => {
    expect(computePrice("monthly", 1).totalCents).toBe(9900 + 1900 * 1);
    expect(computePrice("monthly", 5).totalCents).toBe(9900 + 1900 * 5);
    expect(computePrice("monthly", 10).totalCents).toBe(9900 + 1900 * 10);
  });

  it("charges just the base for zero seats", () => {
    expect(computePrice("monthly", 0).totalCents).toBe(9900);
  });

  it("computes annual as 12 months at a 20% discount", () => {
    const result = computePrice("annual", 5);
    const monthlySubtotal = 9900 + 1900 * 5;
    const annualSubtotal = monthlySubtotal * 12;
    const expectedDiscount = Math.round(annualSubtotal * 0.2);
    expect(result.subtotalCents).toBe(annualSubtotal);
    expect(result.discountCents).toBe(expectedDiscount);
    expect(result.totalCents).toBe(annualSubtotal - expectedDiscount);
  });

  it("monthly has no discount", () => {
    expect(computePrice("monthly", 5).discountCents).toBe(0);
  });

  it("carries the seat count through unchanged", () => {
    expect(computePrice("monthly", 7).seats).toBe(7);
    expect(computePrice("annual", 7).seats).toBe(7);
  });
});
