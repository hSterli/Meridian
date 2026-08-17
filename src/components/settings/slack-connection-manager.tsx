"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ActionState } from "@/lib/actions/auth";

export interface SlackConnectionRow {
  id: string;
  project_id: string;
  channel_id: string;
  projects: { name: string } | { name: string }[] | null;
}

export interface SlackProjectOption {
  id: string;
  name: string;
}

export function SlackConnectionManager({
  connections,
  projects,
  isAdmin,
  connectAction,
  disconnectAction,
}: {
  connections: SlackConnectionRow[];
  projects: SlackProjectOption[];
  isAdmin: boolean;
  connectAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  disconnectAction: (connectionId: string) => void;
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(connectAction, {});

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
                  {projectName ?? "Unknown project"} → #{connection.channel_id}
                </p>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => disconnectAction(connection.id)}
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
        <Card className="p-4 text-sm text-ink-tertiary">No Slack connections configured.</Card>
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
              <Label htmlFor="channelId">Channel ID</Label>
              <Input id="channelId" name="channelId" required placeholder="C0123456789" />
            </div>
            <div>
              <Label htmlFor="botToken">Bot token</Label>
              <Input id="botToken" name="botToken" type="password" required placeholder="xoxb-..." />
            </div>
            {state.error && <p className="text-xs text-fail">{state.error}</p>}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Connecting…" : "Connect Slack"}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
