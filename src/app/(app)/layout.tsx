import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { Sidebar } from "@/components/layout/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (ctx.memberships.length === 0) redirect("/onboarding");

  const activeOrg = ctx.memberships.find((m) => m.org_id === ctx.activeOrgId);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        orgs={ctx.memberships.map((m) => ({
          id: m.organizations.id,
          name: m.organizations.name,
        }))}
        activeOrgId={ctx.activeOrgId}
        activeOrgName={activeOrg?.organizations.name ?? ""}
        activeRole={ctx.activeRole}
        userEmail={ctx.email}
      />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
