import "server-only";

export interface JiraConnectionCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

const PRIORITY_MAP: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Highest",
};

// Jira workflow status names vary per project/workflow, so this tries a
// short list of common candidate names per Meridian status rather than
// assuming one exact name. If none match, the caller surfaces an error
// instead of guessing wrong — see transitionJiraIssueStatus below.
const STATUS_TRANSITION_CANDIDATES: Record<string, string[]> = {
  open: ["To Do", "Open", "Backlog"],
  in_progress: ["In Progress", "In Review"],
  resolved: ["Done", "Resolved"],
  closed: ["Done", "Closed"],
};

function authHeader(email: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
}

// Jira Cloud's REST API v3 requires descriptions in Atlassian Document
// Format (a structured JSON doc format), not plain text.
function toADF(text: string) {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: text || " " }] }],
  };
}

export async function createJiraIssue(
  connection: JiraConnectionCredentials,
  title: string,
  description: string,
  severity: string
): Promise<{ key: string; id: string } | { error: string }> {
  const response = await fetch(`${connection.baseUrl}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: authHeader(connection.email, connection.apiToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        project: { key: connection.projectKey },
        summary: title,
        description: toADF(description),
        issuetype: { name: "Task" },
        priority: { name: PRIORITY_MAP[severity] ?? "Medium" },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { error: `Jira create failed (${response.status}): ${body}` };
  }

  const data = (await response.json()) as { key: string; id: string };
  return { key: data.key, id: data.id };
}

export async function updateJiraIssueFields(
  connection: JiraConnectionCredentials,
  issueKey: string,
  title: string,
  description: string,
  severity: string
): Promise<{ error?: string }> {
  const response = await fetch(`${connection.baseUrl}/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    headers: {
      Authorization: authHeader(connection.email, connection.apiToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        summary: title,
        description: toADF(description),
        priority: { name: PRIORITY_MAP[severity] ?? "Medium" },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { error: `Jira update failed (${response.status}): ${body}` };
  }

  return {};
}

export async function transitionJiraIssueStatus(
  connection: JiraConnectionCredentials,
  issueKey: string,
  meridianStatus: string
): Promise<{ error?: string }> {
  const candidates = STATUS_TRANSITION_CANDIDATES[meridianStatus] ?? [];

  const transitionsResponse = await fetch(
    `${connection.baseUrl}/rest/api/3/issue/${issueKey}/transitions`,
    { headers: { Authorization: authHeader(connection.email, connection.apiToken) } }
  );

  if (!transitionsResponse.ok) {
    const body = await transitionsResponse.text();
    return { error: `Could not fetch Jira transitions (${transitionsResponse.status}): ${body}` };
  }

  const { transitions } = (await transitionsResponse.json()) as {
    transitions: { id: string; to: { name: string } }[];
  };

  const match = transitions.find((t) =>
    candidates.some((c) => c.toLowerCase() === t.to.name.toLowerCase())
  );

  if (!match) {
    return {
      error: `No matching Jira transition found for status "${meridianStatus}" (tried: ${candidates.join(", ")}).`,
    };
  }

  const applyResponse = await fetch(
    `${connection.baseUrl}/rest/api/3/issue/${issueKey}/transitions`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(connection.email, connection.apiToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transition: { id: match.id } }),
    }
  );

  if (!applyResponse.ok) {
    const body = await applyResponse.text();
    return { error: `Jira transition failed (${applyResponse.status}): ${body}` };
  }

  return {};
}
