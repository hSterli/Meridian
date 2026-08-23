"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { GitlabConnectionActionState } from "@/lib/actions/issue-tracker";

export interface GitlabConnectionRow {
  id: string;
  project_id: string | null;
  gitlab_instance_url: string | null;
  gitlab_project_path: string | null;
  gitlab_webhook_id: number | null;
  projects: { name: string } | { name: string }[] | null;
}

export interface GitlabProjectOption {
  id: string;
  name: string;
}

export function GitlabConnectionManager({
  connections,
  projects,
  isAdmin,
  connectAction,
  disconnectAction,
}: {
  connections: GitlabConnectionRow[];
  projects: GitlabProjectOption[];
  isAdmin: boolean;
  connectAction: (
    prevState: GitlabConnectionActionState,
    formData: FormData
  ) => Promise<GitlabConnectionActionState>;
  disconnectAction: (
    connectionId: string,
    instanceUrl: string,
    projectPath: string,
    webhookId: number | null
  ) => void;
}) {
  const [state, formAction, isPending] = useActionState<GitlabConnectionActionState, FormData>(
    connectAction,
    {}
  );

  const connectedProjectIds = new Set(connections.map((c) => c.project_id));
  const availableProjects = projects.filter((p) => !connectedProjectIds.has(p.id));

  return (
    <div className="space-y-4">
      {connections.length > 0 && (
        <Card className="divide-y divide-border-light">
          {connections.map((connection) => {
            const projectName = Array.isArray(connection.projects)
              ? connection.projects[0]?.name
              : connection.projects?.name;
            return (
              <div key={connection.id} className="p-4">
                <p className="text-sm font-medium text-ink-primary">
                  {projectName ?? "Unknown project"} → {connection.gitlab_instance_url}/
                  {connection.gitlab_project_path}
                </p>
                {!connection.gitlab_webhook_id && (
                  <p className="mt-1 text-xs text-fail">
                    Automatic status updates from GitLab aren&apos;t set up — disconnect and
                    reconnect to retry.
                  </p>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() =>
                      disconnectAction(
                        connection.id,
                        connection.gitlab_instance_url ?? "",
                        connection.gitlab_project_path ?? "",
                        connection.gitlab_webhook_id
                      )
                    }
                    className="mt-2 text-xs font-medium text-fail hover:underline"
                  >
                    Disconnect
                  </button>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {!isAdmin && connections.length === 0 && (
        <Card className="p-4 text-sm text-ink-tertiary">No GitLab connections configured.</Card>
      )}

      {isAdmin && availableProjects.length > 0 && (
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold text-ink-primary">Connect a project</p>
          <form action={formAction} className="space-y-3">
            <div>
              <Label htmlFor="projectId">Project</Label>
              <Select id="projectId" name="projectId" required defaultValue="">
                <option value="" disabled>
                  Select a project
                </option>
                {availableProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="instanceUrl">GitLab instance URL</Label>
              <Input id="instanceUrl" name="instanceUrl" placeholder="https://gitlab.com" />
            </div>
            <div>
              <Label htmlFor="projectPath">Project path</Label>
              <Input id="projectPath" name="projectPath" required placeholder="group/project" />
            </div>
            <div>
              <Label htmlFor="token">Personal access token</Label>
              <Input id="token" name="token" type="password" required />
            </div>
            {state.error && <p className="text-xs text-fail">{state.error}</p>}
            {state.webhookWarning && <p className="text-xs text-fail">{state.webhookWarning}</p>}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Connecting…" : "Connect GitLab"}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
