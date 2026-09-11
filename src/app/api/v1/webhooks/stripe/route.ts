import { stripe } from "@/lib/stripe/client";
import { nextBillingDateAfter } from "@/lib/stripe/billing-cycle";
import { createServiceClient } from "@/lib/supabase/service";
import type Stripe from "stripe";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature ?? "",
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from("webhook_events")
    .select("id")
    .eq("source", "stripe")
    .eq("payload->>id", event.id)
    .maybeSingle();

  if (existing) {
    return Response.json({ status: "already processed" });
  }

  let orgId: string | null = null;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    orgId = (session.metadata?.orgId as string | undefined) ?? null;
    const planType = session.metadata?.planType;

    if (orgId && (planType === "monthly" || planType === "annual")) {
      await supabase
        .from("organizations")
        .update({
          billing_status: "active",
          plan_type: planType,
          stripe_customer_id: (session.customer as string) ?? null,
          next_billing_date: nextBillingDateAfter(planType, new Date()).toISOString(),
        })
        .eq("id", orgId);

      await supabase.from("billing_events").insert({
        org_id: orgId,
        event_type: "payment_succeeded",
      });
    }
  }

  await supabase.from("webhook_events").insert({
    source: "stripe",
    org_id: orgId,
    payload: event as unknown as never,
    signature_valid: true,
  });

  return Response.json({ status: "received" });
}
