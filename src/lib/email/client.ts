import "server-only";

interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
}

// Mirrors postSlackMessage's shape: a thin fetch wrapper that can throw (on
// a network failure or malformed response) rather than catching internally
// — the caller (trySendBillingEmail) owns the best-effort try/catch, same
// division of responsibility as Slack's client vs. trySendSlackNotification.
export async function sendEmail({
  to,
  subject,
  text,
}: SendEmailParams): Promise<{ ok: true } | { error: string }> {
  const from = process.env.RESEND_FROM_EMAIL || "billing@meridianqa.dev";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { error: `Resend API error (${response.status}): ${body}` };
  }

  return { ok: true };
}

export function formatDunningNoticeEmail(orgName: string, day: 1 | 3): { subject: string; text: string } {
  return {
    subject: `Action needed: payment failed for ${orgName}`,
    text: `We tried to charge your card on file for ${orgName} and it didn't go through (attempt ${
      day === 1 ? "yesterday" : "over the last few days"
    }). We'll keep retrying automatically — no action needed yet, but you may want to check your card details in Settings > Billing.`,
  };
}

export function formatDowngradeEmail(orgName: string): { subject: string; text: string } {
  return {
    subject: `${orgName} is now read-only — payment failed`,
    text: `We haven't been able to charge your card on file for ${orgName} after several attempts. Your org is now read-only until payment is added. We'll keep retrying automatically, or you can update your payment method any time in Settings > Billing.`,
  };
}

export function formatDunningCancelledEmail(orgName: string): { subject: string; text: string } {
  return {
    subject: `${orgName}'s subscription has been cancelled`,
    text: `After repeated failed payment attempts, ${orgName}'s subscription has been cancelled. You can resubscribe any time from Settings > Billing.`,
  };
}

export function formatVoluntaryCancelledEmail(orgName: string): { subject: string; text: string } {
  return {
    subject: `${orgName}'s subscription has ended`,
    text: `As requested, ${orgName}'s subscription has now ended. You can resubscribe any time from Settings > Billing.`,
  };
}

export function formatTrialReminderEmail(orgName: string): { subject: string; text: string } {
  return {
    subject: `${orgName}'s trial ends in 3 days`,
    text: `${orgName}'s trial ends in 3 days. Add payment in Settings > Billing to keep access without interruption.`,
  };
}

export function formatTrialExpiredEmail(orgName: string): { subject: string; text: string } {
  return {
    subject: `${orgName}'s trial has ended`,
    text: `${orgName}'s trial has ended and the org is now read-only. Add payment in Settings > Billing to restore access.`,
  };
}
