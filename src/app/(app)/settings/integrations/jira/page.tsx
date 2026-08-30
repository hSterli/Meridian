import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { JiraConnectionManager } from "@/components/settings/jira-connection-manager";
import { connectJiraTracker, disconnectJiraTracker } from "@/lib/actions/issue-tracker";

export default async function JiraIntegrationPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const isAdmin = ctx.activeRole === "owner" || ctx.activeRole === "admin";
  const supabase = await createClient();

  const { data: connection } = await supabase
    .from("issue_tracker_connections")
    .select("id, jira_base_url, jira_email, jira_project_key")
    .eq("org_id", ctx.activeOrgId)
    .eq("provider", "jira")
    .maybeSingle();

  const connectAction = connectJiraTracker.bind(null, ctx.activeOrgId);
  const disconnectAction = connection ? disconnectJiraTracker.bind(null, connection.id) : null;

  return (
    <div className="max-w-3xl">
      <Breadcrumbs
        items={[
          { label: "Settings", href: "/settings" },
          { label: "Integrations", href: "/settings/integrations" },
          { label: "Jira" },
        ]}
      />
      <PageHeader title="Jira" description="Two-way sync between Meridian issues and Jira." />
      <JiraConnectionManager
        connection={connection ?? null}
        isAdmin={isAdmin}
        connectAction={connectAction}
        disconnectAction={disconnectAction}
      />
    </div>
  );
}
