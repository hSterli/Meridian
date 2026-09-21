import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { BillingManager } from "@/components/settings/billing-manager";
import { computePrice } from "@/lib/stripe/client";
import { switchPlan, requestCancellation } from "@/lib/actions/billing";

export default async function BillingSettingsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const isAdmin = ctx.activeRole === "owner" || ctx.activeRole === "admin";
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("billing_status, plan_type, trial_end_date, next_billing_date, cancel_at")
    .eq("id", ctx.activeOrgId)
    .single();

  const { count: seats } = await supabase
    .from("organization_members")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", ctx.activeOrgId);

  const price =
    org?.plan_type != null
      ? computePrice(org.plan_type as "monthly" | "annual", seats ?? 0)
      : null;

  return (
    <div className="max-w-2xl">
      <Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "Billing" }]} />
      <PageHeader title="Billing" description="Plan, seats, and payment status." />
      <BillingManager
        org={org ?? null}
        price={price}
        isAdmin={isAdmin}
        switchPlanAction={switchPlan}
        requestCancellationAction={requestCancellation}
      />
    </div>
  );
}
