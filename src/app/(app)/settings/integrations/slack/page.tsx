import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { SlackConnectionManager } from "@/components/settings/slack-connection-manager";
import { connectSlackNotifications, disconnectSlackNotifications } from "@/lib/actions/slack";

export default async function SlackIntegrationPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const isAdmin = ctx.activeRole === "owner" || ctx.activeRole === "admin";
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("org_id", ctx.activeOrgId)
    .order("name");

  const { data: connections } = await supabase
    .from("slack_connections")
    .select("id, project_id, channel_id, projects(name)")
    .eq("org_id", ctx.activeOrgId);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PageHeader
        title="Slack"
        description="Post a message to a channel when a CI-ingested test run completes."
      />
      <SlackConnectionManager
        connections={connections ?? []}
        projects={projects ?? []}
        isAdmin={isAdmin}
        connectAction={connectSlackNotifications}
        disconnectAction={disconnectSlackNotifications}
      />
    </div>
  );
}
