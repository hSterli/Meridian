"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { GithubConnectionActionState } from "@/lib/actions/issue-tracker";

export interface GithubConnectionRow {
  id: string;
  project_id: string | null;
  github_repo_owner: string | null;
  github_repo_name: string | null;
  github_webhook_id: number | null;
  projects: { name: string } | { name: string }[] | null;
}

export interface GithubProjectOption {
  id: string;
  name: string;
}

export function GithubConnectionManager({
  connections,
  projects,
  isAdmin,
  connectAction,
  disconnectAction,
}: {
  connections: GithubConnectionRow[];
  projects: GithubProjectOption[];
  isAdmin: boolean;
  connectAction: (
    prevState: GithubConnectionActionState,
    formData: FormData
  ) => Promise<GithubConnectionActionState>;
  disconnectAction: (
    connectionId: string,
    repoOwner: string,
    repoName: string,
    webhookId: number | null
  ) => void;
}) {
  const [state, formAction, isPending] = useActionState<GithubConnectionActionState, FormData>(
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
                  {projectName ?? "Unknown project"} → {connection.github_repo_owner}/
                  {connection.github_repo_name}
                </p>
                {!connection.github_webhook_id && (
                  <p className="mt-1 text-xs text-fail">
                    Automatic status updates from GitHub aren&apos;t set up — disconnect and
                    reconnect to retry.
                  </p>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() =>
                      disconnectAction(
                        connection.id,
                        connection.github_repo_owner ?? "",
                        connection.github_repo_name ?? "",
                        connection.github_webhook_id
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
        <Card className="p-4 text-sm text-ink-tertiary">No GitHub connections configured.</Card>
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
              <Label htmlFor="repoOwner">Repo owner</Label>
              <Input id="repoOwner" name="repoOwner" required placeholder="your-org" />
            </div>
            <div>
              <Label htmlFor="repoName">Repo name</Label>
              <Input id="repoName" name="repoName" required placeholder="your-repo" />
            </div>
            <div>
              <Label htmlFor="token">Personal access token</Label>
              <Input id="token" name="token" type="password" required />
            </div>
            {state.error && <p className="text-xs text-fail">{state.error}</p>}
            {state.webhookWarning && <p className="text-xs text-fail">{state.webhookWarning}</p>}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Connecting…" : "Connect GitHub"}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
