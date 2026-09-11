"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { stripe, computePrice, type BillingPlanType } from "@/lib/stripe/client";
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
