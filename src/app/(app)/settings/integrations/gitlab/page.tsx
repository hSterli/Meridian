import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { GitlabConnectionManager } from "@/components/settings/gitlab-connection-manager";
import { connectGitlabTracker, disconnectGitlabTracker } from "@/lib/actions/issue-tracker";

export default async function GitlabIntegrationPage() {
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
    .from("issue_tracker_connections")
    .select(
      "id, project_id, gitlab_instance_url, gitlab_project_path, gitlab_webhook_id, projects(name)"
    )
    .eq("org_id", ctx.activeOrgId)
    .eq("provider", "gitlab");

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PageHeader title="GitLab" description="Two-way issue sync and MR test-result feedback, per project." />
      <GitlabConnectionManager
        connections={connections ?? []}
        projects={projects ?? []}
        isAdmin={isAdmin}
        connectAction={connectGitlabTracker}
        disconnectAction={disconnectGitlabTracker}
      />
    </div>
  );
}
