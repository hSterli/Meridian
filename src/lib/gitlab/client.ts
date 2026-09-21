import "server-only";

export interface GitlabConnectionCredentials {
  instanceUrl: string;
  projectPath: string;
  token: string;
}

function gitlabApiBase(instanceUrl: string): string {
  return `${instanceUrl.replace(/\/$/, "")}/api/v4`;
}

function encodedPath(projectPath: string): string {
  return encodeURIComponent(projectPath);
}

function gitlabHeaders(token: string): Record<string, string> {
  return {
    "PRIVATE-TOKEN": token,
    "Content-Type": "application/json",
  };
}

export async function verifyGitlabProjectAccess(
  connection: GitlabConnectionCredentials
): Promise<{ ok: true } | { error: string }> {
  const response = await fetch(
    `${gitlabApiBase(connection.instanceUrl)}/projects/${encodedPath(connection.projectPath)}`,
    { headers: gitlabHeaders(connection.token) }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `Could not access project (${response.status}): ${body}` };
  }

  return { ok: true };
}

export async function createGitlabIssue(
  connection: GitlabConnectionCredentials,
  title: string,
  description: string,
  severity: string
): Promise<{ iid: number; id: string } | { error: string }> {
  const response = await fetch(
    `${gitlabApiBase(connection.instanceUrl)}/projects/${encodedPath(connection.projectPath)}/issues`,
    {
      method: "POST",
      headers: gitlabHeaders(connection.token),
      body: JSON.stringify({
        title,
        description: `${description || "(no description)"}\n\n**Severity:** ${severity}`,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitLab issue create failed (${response.status}): ${body}` };
  }

  const data = (await response.json()) as { iid: number; id: number };
  return { iid: data.iid, id: String(data.id) };
}

export async function updateGitlabIssueFields(
  connection: GitlabConnectionCredentials,
  issueIid: number,
  title: string,
  description: string,
  severity: string
): Promise<{ error?: string }> {
  const response = await fetch(
    `${gitlabApiBase(connection.instanceUrl)}/projects/${encodedPath(connection.projectPath)}/issues/${issueIid}`,
    {
      method: "PUT",
      headers: gitlabHeaders(connection.token),
      body: JSON.stringify({
        title,
        description: `${description || "(no description)"}\n\n**Severity:** ${severity}`,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitLab issue update failed (${response.status}): ${body}` };
  }

  return {};
}

// GitLab issues only have opened/closed states — same lossy mapping as
// GitHub's. GitLab's API takes a state *event* (an action to perform: close
// or reopen) rather than the target state directly.
const GITLAB_STATE_EVENT_FOR_STATUS: Record<string, "close" | "reopen"> = {
  open: "reopen",
  in_progress: "reopen",
  resolved: "close",
  closed: "close",
};

export async function setGitlabIssueState(
  connection: GitlabConnectionCredentials,
  issueIid: number,
  meridianStatus: string
): Promise<{ error?: string }> {
  const stateEvent = GITLAB_STATE_EVENT_FOR_STATUS[meridianStatus];
  if (!stateEvent) return { error: `No GitLab state mapping for status "${meridianStatus}".` };

  const response = await fetch(
    `${gitlabApiBase(connection.instanceUrl)}/projects/${encodedPath(connection.projectPath)}/issues/${issueIid}`,
    {
      method: "PUT",
      headers: gitlabHeaders(connection.token),
      body: JSON.stringify({ state_event: stateEvent }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitLab issue state update failed (${response.status}): ${body}` };
  }

  return {};
}

export async function createGitlabWebhook(
  connection: GitlabConnectionCredentials,
  callbackUrl: string,
  token: string
): Promise<{ hookId: number } | { error: string }> {
  const response = await fetch(
    `${gitlabApiBase(connection.instanceUrl)}/projects/${encodedPath(connection.projectPath)}/hooks`,
    {
      method: "POST",
      headers: gitlabHeaders(connection.token),
      body: JSON.stringify({
        url: callbackUrl,
        token,
        issues_events: true,
        merge_requests_events: true,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitLab webhook create failed (${response.status}): ${body}` };
  }

  const data = (await response.json()) as { id: number };
  return { hookId: data.id };
}

export async function deleteGitlabWebhook(
  connection: GitlabConnectionCredentials,
  hookId: number
): Promise<{ ok: true } | { error: string }> {
  const response = await fetch(
    `${gitlabApiBase(connection.instanceUrl)}/projects/${encodedPath(connection.projectPath)}/hooks/${hookId}`,
    { method: "DELETE", headers: gitlabHeaders(connection.token) }
  );

  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    return { error: `GitLab webhook delete failed (${response.status}): ${body}` };
  }

  return { ok: true };
}

function mrCommentMarker(projectId: string): string {
  return `<!-- meridian-run:${projectId} -->`;
}

export interface MrRunSummary {
  projectId: string;
  runName: string;
  runUrl: string;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
}

function mrCommentBody(summary: MrRunSummary): string {
  return [
    mrCommentMarker(summary.projectId),
    `**Meridian: ${summary.runName}**`,
    "",
    `✅ ${summary.passed} passed · ❌ ${summary.failed} failed · 🚫 ${summary.blocked} blocked · ⏭️ ${summary.skipped} skipped`,
    "",
    `[View full run in Meridian](${summary.runUrl})`,
  ].join("\n");
}

// Finds an existing note on the MR carrying this project's hidden marker
// and updates it in place; otherwise posts a new one. Same idempotency
// trick as GitHub's postOrUpdatePrComment.
export async function postOrUpdateMrComment(
  connection: GitlabConnectionCredentials,
  mrIid: number,
  summary: MrRunSummary
): Promise<{ ok: true } | { error: string }> {
  const marker = mrCommentMarker(summary.projectId);
  const body = mrCommentBody(summary);
  const base = `${gitlabApiBase(connection.instanceUrl)}/projects/${encodedPath(connection.projectPath)}/merge_requests/${mrIid}/notes`;

  const listResponse = await fetch(base, { headers: gitlabHeaders(connection.token) });

  if (!listResponse.ok) {
    const text = await listResponse.text();
    return { error: `Could not list MR notes (${listResponse.status}): ${text}` };
  }

  const notes = (await listResponse.json()) as { id: number; body: string }[];
  const existing = notes.find((n) => n.body.includes(marker));

  const response = existing
    ? await fetch(`${base}/${existing.id}`, {
        method: "PUT",
        headers: gitlabHeaders(connection.token),
        body: JSON.stringify({ body }),
      })
    : await fetch(base, {
        method: "POST",
        headers: gitlabHeaders(connection.token),
        body: JSON.stringify({ body }),
      });

  if (!response.ok) {
    const text = await response.text();
    return { error: `Could not post MR note (${response.status}): ${text}` };
  }

  return { ok: true };
}

// Pure — GitLab's webhook auth model is a static token sent back verbatim
// in X-Gitlab-Token, compared directly (no HMAC-over-payload the way
// GitHub's X-Hub-Signature-256 works — this is GitLab's actual mechanism,
// not a simplified stand-in for it).
export function verifyGitlabWebhookToken(
  headerValue: string | null,
  storedToken: string
): boolean {
  if (!headerValue) return false;
  return headerValue === storedToken;
}
