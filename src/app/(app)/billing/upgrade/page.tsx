import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { computePrice } from "@/lib/stripe/client";
import { UpgradeForm } from "@/components/billing/upgrade-form";

export default async function BillingUpgradePage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const supabase = await createClient();
  const { count: seats } = await supabase
    .from("organization_members")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", ctx.activeOrgId);

  const monthly = computePrice("monthly", seats ?? 0);
  const annual = computePrice("annual", seats ?? 0);

  return (
    <div className="max-w-2xl">
      <PageHeader title="Add payment" description="Choose monthly or annual billing to continue." />
      <Card className="p-5">
        <UpgradeForm monthly={monthly} annual={annual} />
      </Card>
    </div>
  );
}
