import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

export interface GithubConnectionCredentials {
  repoOwner: string;
  repoName: string;
  token: string;
}

const GITHUB_API = "https://api.github.com";

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

export async function verifyGithubRepoAccess(
  connection: GithubConnectionCredentials
): Promise<{ ok: true } | { error: string }> {
  const response = await fetch(`${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}`, {
    headers: githubHeaders(connection.token),
  });

  if (!response.ok) {
    const body = await response.text();
    return { error: `Could not access repo (${response.status}): ${body}` };
  }

  return { ok: true };
}

export async function createGithubIssue(
  connection: GithubConnectionCredentials,
  title: string,
  description: string,
  severity: string
): Promise<{ number: number; id: string } | { error: string }> {
  const response = await fetch(
    `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/issues`,
    {
      method: "POST",
      headers: githubHeaders(connection.token),
      body: JSON.stringify({
        title,
        body: `${description || "(no description)"}\n\n**Severity:** ${severity}`,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitHub issue create failed (${response.status}): ${body}` };
  }

  const data = (await response.json()) as { number: number; id: number };
  return { number: data.number, id: String(data.id) };
}

export async function updateGithubIssueFields(
  connection: GithubConnectionCredentials,
  issueNumber: number,
  title: string,
  description: string,
  severity: string
): Promise<{ error?: string }> {
  const response = await fetch(
    `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/issues/${issueNumber}`,
    {
      method: "PATCH",
      headers: githubHeaders(connection.token),
      body: JSON.stringify({
        title,
        body: `${description || "(no description)"}\n\n**Severity:** ${severity}`,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitHub issue update failed (${response.status}): ${body}` };
  }

  return {};
}

// GitHub issues only have open/closed states — no equivalent of Meridian's
// "in progress". open/in_progress both map to GitHub "open";
// resolved/closed both map to GitHub "closed".
const GITHUB_STATE_FOR_STATUS: Record<string, "open" | "closed"> = {
  open: "open",
  in_progress: "open",
  resolved: "closed",
  closed: "closed",
};

export async function setGithubIssueState(
  connection: GithubConnectionCredentials,
  issueNumber: number,
  meridianStatus: string
): Promise<{ error?: string }> {
  const state = GITHUB_STATE_FOR_STATUS[meridianStatus];
  if (!state) return { error: `No GitHub state mapping for status "${meridianStatus}".` };

  const response = await fetch(
    `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/issues/${issueNumber}`,
    {
      method: "PATCH",
      headers: githubHeaders(connection.token),
      body: JSON.stringify({ state }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitHub issue state update failed (${response.status}): ${body}` };
  }

  return {};
}

export async function createGithubWebhook(
  connection: GithubConnectionCredentials,
  callbackUrl: string,
  secret: string
): Promise<{ hookId: number } | { error: string }> {
  const response = await fetch(
    `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/hooks`,
    {
      method: "POST",
      headers: githubHeaders(connection.token),
      body: JSON.stringify({
        name: "web",
        active: true,
        events: ["issues"],
        config: { url: callbackUrl, content_type: "json", secret },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return { error: `GitHub webhook create failed (${response.status}): ${body}` };
  }

  const data = (await response.json()) as { id: number };
  return { hookId: data.id };
}

export async function deleteGithubWebhook(
  connection: GithubConnectionCredentials,
  hookId: number
): Promise<{ ok: true } | { error: string }> {
  const response = await fetch(
    `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/hooks/${hookId}`,
    { method: "DELETE", headers: githubHeaders(connection.token) }
  );

  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    return { error: `GitHub webhook delete failed (${response.status}): ${body}` };
  }

  return { ok: true };
}

function prCommentMarker(projectId: string): string {
  return `<!-- meridian-run:${projectId} -->`;
}

export interface PrRunSummary {
  projectId: string;
  runName: string;
  runUrl: string;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
}

function prCommentBody(summary: PrRunSummary): string {
  return [
    prCommentMarker(summary.projectId),
    `**Meridian: ${summary.runName}**`,
    "",
    `✅ ${summary.passed} passed · ❌ ${summary.failed} failed · 🚫 ${summary.blocked} blocked · ⏭️ ${summary.skipped} skipped`,
    "",
    `[View full run in Meridian](${summary.runUrl})`,
  ].join("\n");
}

// Finds an existing comment on the PR carrying this project's hidden
// marker and updates it in place; otherwise posts a new one. Keeps a
// re-run of the same CI job against the same PR from spamming a fresh
// comment every time.
export async function postOrUpdatePrComment(
  connection: GithubConnectionCredentials,
  prNumber: number,
  summary: PrRunSummary
): Promise<{ ok: true } | { error: string }> {
  const marker = prCommentMarker(summary.projectId);
  const body = prCommentBody(summary);

  const listResponse = await fetch(
    `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/issues/${prNumber}/comments`,
    { headers: githubHeaders(connection.token) }
  );

  if (!listResponse.ok) {
    const text = await listResponse.text();
    return { error: `Could not list PR comments (${listResponse.status}): ${text}` };
  }

  const comments = (await listResponse.json()) as { id: number; body: string }[];
  const existing = comments.find((c) => c.body.includes(marker));

  const response = existing
    ? await fetch(
        `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/issues/comments/${existing.id}`,
        { method: "PATCH", headers: githubHeaders(connection.token), body: JSON.stringify({ body }) }
      )
    : await fetch(
        `${GITHUB_API}/repos/${connection.repoOwner}/${connection.repoName}/issues/${prNumber}/comments`,
        { method: "POST", headers: githubHeaders(connection.token), body: JSON.stringify({ body }) }
      );

  if (!response.ok) {
    const text = await response.text();
    return { error: `Could not post PR comment (${response.status}): ${text}` };
  }

  return { ok: true };
}

// Pure — verifies GitHub's HMAC-SHA256 webhook signature
// (X-Hub-Signature-256 header) against the connection's stored secret.
// Uses a constant-time comparison to avoid leaking timing information.
export function verifyGithubSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);

  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
