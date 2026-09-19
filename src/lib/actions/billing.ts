"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { stripe, computePrice, computeMidYearSeatCharge, type BillingPlanType } from "@/lib/stripe/client";
import { nextBillingDateAfter, remainingMonthsUntil } from "@/lib/stripe/billing-cycle";
import type { ActionState } from "@/lib/actions/auth";

export async function startCheckout(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const planType = String(formData.get("planType") ?? "") as BillingPlanType;
  if (planType !== "monthly" && planType !== "annual") {
    return { error: "Choose a plan." };
  }

  const ctx = await getUserContext();
  if (!ctx || !ctx.activeOrgId) return { error: "No active team selected." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can add payment." };
  }

  const supabase = await createClient();

  const { count: seats } = await supabase
    .from("organization_members")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", ctx.activeOrgId);

  const { data: org } = await supabase
    .from("organizations")
    .select("name, stripe_customer_id")
    .eq("id", ctx.activeOrgId)
    .single();

  if (!org) return { error: "Organization not found." };

  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: org.name,
      metadata: { orgId: ctx.activeOrgId },
    });
    customerId = customer.id;
    await supabase
      .from("organizations")
      .update({ stripe_customer_id: customerId })
      .eq("id", ctx.activeOrgId);
  }

  const price = computePrice(planType, seats ?? 0);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    payment_intent_data: {
      setup_future_usage: "off_session",
    },
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: price.totalCents,
          product_data: {
            name:
              planType === "monthly"
                ? `Meridian QA — Monthly (${price.seats} seats)`
                : `Meridian QA — Annual (${price.seats} seats)`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: { orgId: ctx.activeOrgId, planType },
    success_url: `${appUrl}/billing/upgrade/success`,
    cancel_url: `${appUrl}/billing/upgrade`,
  });

  if (!session.url) return { error: "Could not start checkout." };

  redirect(session.url);
}

export async function checkBillingStatus(): Promise<{ billingStatus: string | null }> {
  const ctx = await getUserContext();
  if (!ctx?.activeOrgId) return { billingStatus: null };

  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("billing_status")
    .eq("id", ctx.activeOrgId)
    .single();

  return { billingStatus: data?.billing_status ?? null };
}

/**
 * Best-effort mid-year top-up for one seat on an annual plan. No-op for
 * monthly plans (Phase 3's cron already recomputes seats fresh every
 * cycle) and for anything other than a plain active annual subscription.
 * A failure here is logged and swallowed, never thrown — it must not block
 * the caller (acceptPendingInvites, part of sign-in), and it's self-healing:
 * the org's next annual renewal recomputes seats fresh via computePrice.
 */
export async function chargeMidYearAnnualSeat(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string
): Promise<void> {
  const { data: org } = await supabase
    .from("organizations")
    .select("plan_type, billing_status, stripe_customer_id, next_billing_date, cancel_at")
    .eq("id", orgId)
    .single();

  if (!org) return;
  if (org.plan_type !== "annual" || org.billing_status !== "active") return;
  if (org.cancel_at || !org.stripe_customer_id || !org.next_billing_date) return;

  try {
    const months = remainingMonthsUntil(new Date(), new Date(org.next_billing_date));
    const amount = computeMidYearSeatCharge(months);

    const methods = await stripe.paymentMethods.list({
      customer: org.stripe_customer_id,
      type: "card",
    });
    const paymentMethod = methods.data[0];
    if (!paymentMethod) throw new Error("no saved payment method");

    await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      customer: org.stripe_customer_id,
      payment_method: paymentMethod.id,
      off_session: true,
      confirm: true,
    });

    await supabase.from("billing_events").insert({ org_id: orgId, event_type: "seat_added_mid_year" });
  } catch {
    await supabase.from("billing_events").insert({ org_id: orgId, event_type: "payment_failed" });
  }
}
