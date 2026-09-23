# Billing Email Notifications — Design

**Date**: 2026-09-23
**Status**: Approved, pending implementation
**Context**: Every prior billing phase (Foundation through Settings UI) deliberately deferred actually sending email — `billing_events` rows were logged with accurate timing at every dunning/trial/cancellation transition, but nothing was ever delivered to a real inbox. This phase closes that gap: it wires real email delivery (via Resend) onto the transitions that already exist, plus one new proactive check (trial-ending reminders) that nothing in this codebase currently performs at all.

## Problem

An org whose card fails, or whose trial is about to lapse, currently finds out only by noticing the in-app banner or discovering they're locked out — there is no proactive notification. This is a real product gap: a payment-failure or trial-expiry surprise is exactly the kind of moment that should reach an inbox, not just a `billing_events` row nobody looks at.

## Scope decisions

1. **Provider is Resend, called via raw `fetch()`, not the official `resend` npm package.** Every other external integration in this codebase (Slack, GitHub, GitLab, Jira) is a thin fetch-based client with no SDK dependency — Stripe is the sole exception, justified by the complexity of payment flows. Resend's API is a single simple POST endpoint, so it follows the dominant pattern rather than the Stripe exception.
2. **Recipient is the org's owner**, found via `organization_members` (service role bypasses RLS — the cron route already queries this table directly) filtered to `role = 'owner'`, then `supabase.auth.admin.getUserById()` for the email address. **This is a new pattern for this codebase** — no existing code reads `auth.users` from a service-role context (`get_org_members`, the only existing email-lookup path, depends on `auth.uid()` via `is_org_member()`, which is null under service role and would return zero rows). No new migration/RPC needed — `auth.admin.getUserById` is already available on any client constructed with the service-role key, which `createServiceClient()` already uses.
3. **Six email types**, mapped directly onto states this codebase's pure billing-logic functions already compute — no new state machine, only new email hooks onto existing decisions:
   - `computeDunningAction` → `"notice"` (day 1, day 3): a heads-up that the card failed and will be retried
   - `computeDunningAction` → `"downgrade"` (day 5): the org is now read-only
   - `computeDunningAction` → `"cancel"` (day 30): subscription cancelled for non-payment
   - Pass 3's voluntary-cancellation finalization (`cancel_at` elapsed): a separate, lower-urgency "cancellation complete" email — different copy from the non-payment cancellation, since the customer asked for this one
   - A **new** trial-reminder check (see decision 4): "3 days left" and "trial has ended"
4. **Trial-ending reminders need a new proactive check — nothing currently watches `trial_end_date`.** Foundation's design deliberately never stores a trial-expiry transition (`billing_status` stays `'trial'` forever, `isReadOnly` derives expiry lazily on every read) — correct for enforcement, but it means no cron pass currently *notices* a trial approaching or crossing its end date. This phase adds one: a new pure function, `computeTrialReminderAction(trialEndDate, now)`, mirroring `computeDunningAction`'s exact-day-only philosophy —
   - fires `"reminder"` when `floor((trialEndDate - now) / 1 day) === 3`
   - fires `"expired"` when `floor((trialEndDate - now) / 1 day) === 0` (the first day it's in the past)
   - fires `"none"` on every other day
   This relies on the same accepted assumption Phase 3's dunning schedule already relies on — the cron runs once daily at a fixed time, so each org's day-count decrements by exactly one per run, making an exact-day match fire exactly once per org. No new column needed (unlike `payment_failed_since`, which needed a stored anchor because a failure streak's *start* isn't otherwise derivable — a trial's end date is already a fixed, known timestamp).
5. **Every email send is best-effort and non-blocking**, via a new `trySendBillingEmail(supabase, orgId, subject, text)` helper in the cron route — structurally identical to `trySendSlackNotification`'s existing convention (owner-lookup + formatting + send all wrapped in one try/catch, returns a boolean, never throws, never affects `billing_status`/`cancel_at`/any other billing state). A Resend outage or an org with no resolvable owner email must never break the cron's actual billing logic.
6. **No new `billing_events` entries for email delivery itself** (sent or failed) — email is a side effect of states this codebase already logs (`payment_failed`, `subscription_cancelled`, etc.); a separate "email_sent"/"email_failed" audit trail isn't asked for and would need new enum values for a concern the existing events already cover in spirit.
7. **Plain text, not HTML.** Every email is a single formatted string — no HTML templating system, matching Slack's plain-`mrkdwn`-string approach elsewhere in this codebase. Six pure formatting functions (`format*Email`, each returning `{ subject, text }`) live in the new email client module and are unit-tested the same way `formatRunNotification` is.
8. **New env vars**: `RESEND_API_KEY` (used directly in the fetch call's `Authorization` header — no construction-time validation needed, unlike Stripe's SDK, since a bare `fetch()` has nothing to construct) and `RESEND_FROM_EMAIL`, defaulting to `billing@meridianqa.dev` if unset (matching the `meridianqa.dev` domain already used for this project's seed/test accounts). Neither is set in this dev environment — sends will fail in practice, verified via unit tests on the pure formatters and `tsc`/`eslint`/`build` on the I/O wiring, the same posture as every Stripe call before it.
9. **The new trial-reminder pass is appended to the cron route, not inserted at the top**, to keep the diff against the existing three passes minimal — ordering has no functional effect since it operates on `billing_status = 'trial'` orgs, entirely disjoint from Pass 1-3's `['active', 'past_due']` orgs.

## Architecture

### `src/lib/email/client.ts` (new)

```ts
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
export async function sendEmail({ to, subject, text }: SendEmailParams): Promise<{ ok: true } | { error: string }> {
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
    text: `We tried to charge your card on file for ${orgName} and it didn't go through (attempt ${day === 1 ? "yesterday" : "over the last few days"}). We'll keep retrying automatically — no action needed yet, but you may want to check your card details in Settings > Billing.`,
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
```

### `src/lib/stripe/billing-cycle.ts` — one new pure function

```ts
export type TrialReminderAction = { type: "none" } | { type: "reminder" } | { type: "expired" };

// Mirrors computeDunningAction's exact-day-only philosophy — fires once per
// org, relying on the cron running once daily at a fixed time so each org's
// day-count decrements by exactly one per run.
export function computeTrialReminderAction(trialEndDate: Date, now: Date): TrialReminderAction {
  const daysRemaining = Math.floor((trialEndDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  if (daysRemaining === 3) return { type: "reminder" };
  if (daysRemaining === 0) return { type: "expired" };
  return { type: "none" };
}
```

### `src/app/api/internal/billing/run-cycle/route.ts` — `trySendBillingEmail` + four call sites + a new Pass 4

```ts
import {
  sendEmail,
  formatDunningNoticeEmail,
  formatDowngradeEmail,
  formatDunningCancelledEmail,
  formatVoluntaryCancelledEmail,
  formatTrialReminderEmail,
  formatTrialExpiredEmail,
} from "@/lib/email/client";
import { computeTrialReminderAction } from "@/lib/stripe/billing-cycle";

// Best-effort — an org with no owner, a Resend outage, or a malformed
// response must never affect billing_status/cancel_at or fail the cron.
// Mirrors trySendSlackNotification's exact division of responsibility.
async function trySendBillingEmail(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string,
  subject: string,
  text: string
): Promise<boolean> {
  try {
    const { data: owner } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("role", "owner")
      .single();

    if (!owner) return false;

    const { data: userData } = await supabase.auth.admin.getUserById(owner.user_id);
    const email = userData?.user?.email;
    if (!email) return false;

    const result = await sendEmail({ to: email, subject, text });
    return "ok" in result;
  } catch {
    return false;
  }
}
```

Call sites (org `name` is added to each pass's existing `.select()` so a formatter has it):

- Pass 2, `action.type === "notice"` branch → `trySendBillingEmail(supabase, org.id, ...formatDunningNoticeEmail(org.name, action.day))`
- Pass 2, `action.type === "downgrade"` branch → `...formatDowngradeEmail(org.name)`
- Pass 2, `action.type === "cancel"` branch → `...formatDunningCancelledEmail(org.name)`
- Pass 3 (voluntary cancellation, per finalized org) → `...formatVoluntaryCancelledEmail(org.name)`

New Pass 4, appended after Pass 3:

```ts
// Pass 4: trial-ending reminders. Disjoint from Pass 1-3 (billing_status =
// 'trial' here vs. ['active', 'past_due'] there) — order relative to them
// doesn't matter. Nothing else in this codebase proactively checks
// trial_end_date; isReadOnly (Foundation) only derives expiry lazily on
// read, so this is the first place a trial's approach/lapse is ever acted
// on rather than just silently enforced.
const { data: trialOrgs } = await supabase
  .from("organizations")
  .select("id, name, trial_end_date")
  .eq("billing_status", "trial")
  .not("trial_end_date", "is", null);

for (const org of trialOrgs ?? []) {
  const action = computeTrialReminderAction(new Date(org.trial_end_date!), now);

  if (action.type === "reminder") {
    const { subject, text } = formatTrialReminderEmail(org.name);
    await trySendBillingEmail(supabase, org.id, subject, text);
  } else if (action.type === "expired") {
    const { subject, text } = formatTrialExpiredEmail(org.name);
    await trySendBillingEmail(supabase, org.id, subject, text);
  }
}
```

`trySendBillingEmail` takes plain positional `(supabase, orgId, subject, text)` args — every call site destructures a formatter's `{ subject, text }` return value first, then passes both through. Same pattern at the Pass 2/Pass 3 call sites listed above.

### `.env.local.example` — two new lines

```
RESEND_API_KEY=
RESEND_FROM_EMAIL=
```

## Testing

- `src/lib/email/client.test.ts`: all six `format*Email` functions — fixed org name (and day, for the notice variant) → fixed subject/text, no network. `sendEmail` itself is not unit-tested (thin I/O wrapper over `fetch`, matching `postSlackMessage`'s own untested status).
- `src/lib/stripe/billing-cycle.test.ts`: `computeTrialReminderAction` — day 3 exactly → `"reminder"`, day 0 exactly → `"expired"`, every other day count (including negative, i.e. well past expiry) → `"none"`.
- No test coverage for `trySendBillingEmail` or the route's new call sites — matches this codebase's established convention for cron/webhook I/O orchestration, verified via `tsc`/`eslint`/`build` only.

## Explicitly out of scope

- HTML email templates / `react-email` — plain text only (scope decision 7).
- A "welcome" email on trial start — not asked for, and Foundation's spec explicitly deferred all email at every phase; this phase adds only what's needed to close the payment-failure and trial-expiry notification gap.
- An email-delivery audit trail (`billing_events` rows for sent/failed emails) — scope decision 6.
- Live end-to-end delivery testing — no Resend account/API key in this environment, same class of caveat as every Stripe call since Phase 2.
- Any UI change — this phase is entirely backend (email client + cron route wiring).
