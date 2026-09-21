import Stripe from "stripe";

// The installed Stripe SDK (v22.x) requires a truthy apiKey at construction
// time — it throws "Neither apiKey nor config.authenticator provided" for
// both `undefined` and `""`, even though no API call is made yet. No live
// Stripe account exists in this environment, so STRIPE_SECRET_KEY is unset;
// fall back to a placeholder so this module (and computePrice) can be
// imported and tested without a live key. A real key, once configured,
// takes over automatically.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "no-stripe-key-configured");

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

// Pure — no I/O. Callers pass in the seat count (read from
// organization_members) rather than this function querying it itself, same
// separation the rest of this codebase's compute* functions keep between
// data-fetching and calculation.
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
