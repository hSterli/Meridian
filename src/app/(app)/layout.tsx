import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { Sidebar } from "@/components/layout/sidebar";
import { TrialBanner } from "@/components/layout/trial-banner";
import { ActionErrorBanner } from "@/components/layout/action-error-banner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (ctx.memberships.length === 0) redirect("/onboarding");

  const activeOrg = ctx.memberships.find((m) => m.org_id === ctx.activeOrgId);

  return (
    <div className="flex min-h-screen flex-col bg-paper-surface">
      {activeOrg && (
        <TrialBanner
          billingStatus={activeOrg.organizations.billing_status}
          trialEndDate={activeOrg.organizations.trial_end_date}
        />
      )}
      <Suspense fallback={null}>
        <ActionErrorBanner />
      </Suspense>
      <div className="flex flex-1">
        <Sidebar
          orgs={ctx.memberships.map((m) => ({
            id: m.organizations.id,
            name: m.organizations.name,
          }))}
          activeOrgId={ctx.activeOrgId}
          activeOrgName={activeOrg?.organizations.name ?? ""}
          activeRole={ctx.activeRole}
          userEmail={ctx.email}
          userName={ctx.fullName}
        />
        <main className="flex-1 overflow-y-auto p-8 print:overflow-visible print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
