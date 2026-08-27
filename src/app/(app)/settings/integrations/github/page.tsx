import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { GithubConnectionManager } from "@/components/settings/github-connection-manager";
import { connectGithubTracker, disconnectGithubTracker } from "@/lib/actions/issue-tracker";

export default async function GithubIntegrationPage() {
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
    .select("id, project_id, github_repo_owner, github_repo_name, github_webhook_id, projects(name)")
    .eq("org_id", ctx.activeOrgId)
    .eq("provider", "github");

  return (
    <div className="max-w-2xl px-6 py-8">
      <PageHeader title="GitHub" description="Two-way issue sync and PR/MR feedback, per project." />
      <GithubConnectionManager
        connections={connections ?? []}
        projects={projects ?? []}
        isAdmin={isAdmin}
        connectAction={connectGithubTracker}
        disconnectAction={disconnectGithubTracker}
      />
    </div>
  );
}
