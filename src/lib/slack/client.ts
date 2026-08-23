import "server-only";

export interface SlackConnectionCredentials {
  botToken: string;
  channelId: string;
}

const SLACK_API = "https://slack.com/api";

function slackHeaders(botToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${botToken}`,
    "Content-Type": "application/json; charset=utf-8",
  };
}

// Slack's Web API returns HTTP 200 even for auth/permission failures — the
// real success/failure signal is the `ok` boolean in the JSON body plus an
// `error` code string (https://api.slack.com/web#responses). Every helper
// below checks that field, not response.ok.
interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

export async function postSlackMessage(
  connection: SlackConnectionCredentials,
  text: string
): Promise<{ ok: true } | { error: string }> {
  const response = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: slackHeaders(connection.botToken),
    body: JSON.stringify({ channel: connection.channelId, text }),
  });

  const data = (await response.json()) as SlackApiResponse;
  if (!data.ok) {
    return { error: `Slack message post failed: ${data.error ?? "unknown error"}` };
  }

  return { ok: true };
}

// Validates a bot token and channel access with only the chat:write scope:
// auth.test confirms the token itself is valid, then a real confirmation
// message is posted to the channel (rather than a read-only lookup, which
// would need channels:read/groups:read — scopes outside this integration's
// locked-in chat:write-only auth model). This also surfaces the most common
// Slack integration mistake (valid token, bot not yet invited to the
// channel) as an actionable error before the connection is saved.
export async function verifySlackBotAccess(
  botToken: string,
  channelId: string
): Promise<{ ok: true } | { error: string }> {
  const authResponse = await fetch(`${SLACK_API}/auth.test`, {
    method: "POST",
    headers: slackHeaders(botToken),
  });
  const authData = (await authResponse.json()) as SlackApiResponse;
  if (!authData.ok) {
    return { error: `Slack token is invalid (${authData.error ?? "unknown error"}).` };
  }

  const messageResult = await postSlackMessage(
    { botToken, channelId },
    "✅ Meridian is now connected to this channel. Test run notifications will be posted here."
  );
  if ("error" in messageResult) {
    return {
      error: `Token is valid, but could not post to channel "${channelId}": ${messageResult.error}. Make sure the bot has been invited to the channel (/invite @your-bot-name).`,
    };
  }

  return { ok: true };
}

export interface RunNotificationSummary {
  runName: string;
  runUrl: string;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
}

// Pure — builds the notification text, unit-testable without hitting
// Slack's API. Directly analogous to prCommentBody in
// src/lib/github/client.ts, using Slack's mrkdwn syntax instead of GitHub's
// Markdown (*bold* instead of **bold**, <url|text> instead of [text](url)).
export function formatRunNotification(summary: RunNotificationSummary): string {
  return [
    `*Meridian: ${summary.runName}*`,
    `✅ ${summary.passed} passed · ❌ ${summary.failed} failed · 🚫 ${summary.blocked} blocked · ⏭️ ${summary.skipped} skipped`,
    `<${summary.runUrl}|View full run in Meridian>`,
  ].join("\n");
}
