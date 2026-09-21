import { stripe, computePrice, type BillingPlanType } from "@/lib/stripe/client";
import { computeDunningAction, nextBillingDateAfter } from "@/lib/stripe/billing-cycle";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();

  // Pass 1: charge every org whose next_billing_date has arrived. Includes
  // 'past_due', not just 'active' — the external spec calls for a 30-day
  // retry window after an org goes past_due at day 5, not an immediate
  // stop, so retries continue all the way to the day-30 cancellation in
  // Pass 2. A failed charge leaves next_billing_date untouched, so a
  // failing org simply reappears in this same query on every subsequent
  // day until it succeeds — that's the entire "retry" mechanism, no
  // separate scheduling needed. payment_failed_since is read here so a
  // *repeat* failure doesn't reset the dunning clock: it's only set when
  // currently null (the first failure in a streak); every failure after
  // that preserves the original timestamp so Pass 2's day-count can
  // actually advance toward day 5/30 instead of restarting at zero daily.
  // cancel_at is null excludes any org with a pending cancellation —
  // otherwise, on the exact day cancel_at arrives (it starts out equal to
  // next_billing_date), this query would still see next_billing_date <=
  // now() and charge the org for a fresh period moments before Pass 3
  // below cancels it.
  const { data: dueOrgs } = await supabase
    .from("organizations")
    .select("id, plan_type, stripe_customer_id, payment_failed_since")
    .in("billing_status", ["active", "past_due"])
    .is("cancel_at", null)
    .lte("next_billing_date", now.toISOString());

  for (const org of dueOrgs ?? []) {
    if (!org.stripe_customer_id || !org.plan_type) continue;

    const { count: seats } = await supabase
      .from("organization_members")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", org.id);

    const price = computePrice(org.plan_type as BillingPlanType, seats ?? 0);

    const methods = await stripe.paymentMethods.list({
      customer: org.stripe_customer_id,
      type: "card",
    });
    const paymentMethod = methods.data[0];

    if (!paymentMethod) {
      await supabase
        .from("organizations")
        .update({ payment_failed_since: org.payment_failed_since ?? now.toISOString() })
        .eq("id", org.id);
      await supabase.from("billing_events").insert({ org_id: org.id, event_type: "payment_failed" });
      continue;
    }

    await supabase.from("billing_events").insert({ org_id: org.id, event_type: "invoice_issued" });

    try {
      await stripe.paymentIntents.create({
        amount: price.totalCents,
        currency: "usd",
        customer: org.stripe_customer_id,
        payment_method: paymentMethod.id,
        off_session: true,
        confirm: true,
      });

      // billing_status is explicitly reset to 'active' even though it's a
      // no-op for orgs that were never past_due — an org that *was*
      // past_due and just paid successfully during its retry window needs
      // this to actually leave read-only, not just have its dates updated.
      await supabase
        .from("organizations")
        .update({
          billing_status: "active",
          next_billing_date: nextBillingDateAfter(
            org.plan_type as BillingPlanType,
            now
          ).toISOString(),
          payment_failed_since: null,
        })
        .eq("id", org.id);

      await supabase.from("billing_events").insert({
        org_id: org.id,
        event_type: "payment_succeeded",
      });
      await supabase.from("billing_events").insert({
        org_id: org.id,
        event_type: "subscription_renewed",
      });
    } catch {
      await supabase
        .from("organizations")
        .update({ payment_failed_since: org.payment_failed_since ?? now.toISOString() })
        .eq("id", org.id);
      await supabase.from("billing_events").insert({ org_id: org.id, event_type: "payment_failed" });
    }
  }

  // Pass 2: escalate any org already in a failure streak. Also includes
  // 'past_due' — an org downgraded at day 5 must still be checked here on
  // days 6-29 so the day-30 auto-cancellation actually fires; otherwise it
  // would stay past_due (and in Pass 1's retry loop) forever.
  const { data: failingOrgs } = await supabase
    .from("organizations")
    .select("id, payment_failed_since")
    .in("billing_status", ["active", "past_due"])
    .not("payment_failed_since", "is", null);

  for (const org of failingOrgs ?? []) {
    const action = computeDunningAction(new Date(org.payment_failed_since!), now);

    if (action.type === "notice") {
      await supabase.from("billing_events").insert({ org_id: org.id, event_type: "payment_failed" });
    } else if (action.type === "downgrade") {
      await supabase.from("organizations").update({ billing_status: "past_due" }).eq("id", org.id);
      await supabase.from("billing_events").insert({ org_id: org.id, event_type: "payment_failed" });
    } else if (action.type === "cancel") {
      await supabase
        .from("organizations")
        .update({ billing_status: "cancelled", payment_failed_since: null })
        .eq("id", org.id);
      await supabase.from("billing_events").insert({
        org_id: org.id,
        event_type: "subscription_cancelled",
      });
    }
  }

  // Pass 3: finalize any pending cancellation whose paid-through period has
  // now elapsed. cancel_at was set by requestCancellation to the org's
  // next_billing_date at request time — access continues until that date
  // arrives, then this pass (reusing this existing daily job rather than a
  // new one) flips billing_status, matching Foundation's isReadOnly
  // treatment of 'cancelled'. Pass 1 already excludes these orgs via
  // cancel_at is null, so there's no race with a fresh charge on the
  // cutover day.
  const { data: cancelingOrgs } = await supabase
    .from("organizations")
    .select("id")
    .not("cancel_at", "is", null)
    .lte("cancel_at", now.toISOString());

  for (const org of cancelingOrgs ?? []) {
    await supabase
      .from("organizations")
      .update({ billing_status: "cancelled", cancel_at: null })
      .eq("id", org.id);
    await supabase.from("billing_events").insert({
      org_id: org.id,
      event_type: "subscription_cancelled",
    });
  }

  return Response.json({
    status: "ok",
    processed: (dueOrgs ?? []).length,
    failing: (failingOrgs ?? []).length,
    cancelled: (cancelingOrgs ?? []).length,
  });
}
