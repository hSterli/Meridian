# Billing Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send real email (via Resend) for the dunning/cancellation transitions the billing cron already computes, plus a new proactive trial-ending-reminder check — closing the "logged but never delivered" gap left open since Foundation.

**Architecture:** A fetch-based `src/lib/email/client.ts` (mirroring the existing Slack client) holds a thin `sendEmail` I/O function and six pure `format*Email` functions. One new pure function, `computeTrialReminderAction`, joins `computeDunningAction` in `billing-cycle.ts`. The cron route (`run-cycle/route.ts`) gains a best-effort `trySendBillingEmail` helper, four new call sites inside its existing Pass 2/3 branches, and a new Pass 4 for trial reminders.

**Tech Stack:** Next.js Route Handler, `fetch` (Resend REST API), Supabase service-role client (`auth.admin.getUserById`), Vitest.

---

### Task 1: Email client — `sendEmail` + six formatters

**Files:**
- Create: `src/lib/email/client.ts`
- Test: `src/lib/email/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/email/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  formatDunningNoticeEmail,
  formatDowngradeEmail,
  formatDunningCancelledEmail,
  formatVoluntaryCancelledEmail,
  formatTrialReminderEmail,
  formatTrialExpiredEmail,
} from "./client";

describe("formatDunningNoticeEmail", () => {
  it("mentions the org name and day-1 phrasing", () => {
    const { subject, text } = formatDunningNoticeEmail("Acme QA", 1);
    expect(subject).toContain("Acme QA");
    expect(text).toContain("Acme QA");
    expect(text).toContain("yesterday");
  });

  it("uses day-3 phrasing for day 3", () => {
    const { text } = formatDunningNoticeEmail("Acme QA", 3);
    expect(text).not.toContain("yesterday");
  });
});

describe("formatDowngradeEmail", () => {
  it("mentions the org name and read-only", () => {
    const { subject, text } = formatDowngradeEmail("Acme QA");
    expect(subject).toContain("Acme QA");
    expect(text.toLowerCase()).toContain("read-only");
  });
});

describe("formatDunningCancelledEmail", () => {
  it("mentions the org name and cancellation", () => {
    const { subject, text } = formatDunningCancelledEmail("Acme QA");
    expect(subject).toContain("Acme QA");
    expect(text.toLowerCase()).toContain("cancelled");
  });
});

describe("formatVoluntaryCancelledEmail", () => {
  it("mentions the org name and does not blame a payment failure", () => {
    const { subject, text } = formatVoluntaryCancelledEmail("Acme QA");
    expect(subject).toContain("Acme QA");
    expect(text.toLowerCase()).not.toContain("failed");
  });
});

describe("formatTrialReminderEmail", () => {
  it("mentions the org name and 3 days", () => {
    const { subject, text } = formatTrialReminderEmail("Acme QA");
    expect(subject).toContain("Acme QA");
    expect(text).toContain("3 days");
  });
});

describe("formatTrialExpiredEmail", () => {
  it("mentions the org name and read-only", () => {
    const { subject, text } = formatTrialExpiredEmail("Acme QA");
    expect(subject).toContain("Acme QA");
    expect(text.toLowerCase()).toContain("read-only");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/lib/email/client.test.ts`
Expected: FAIL — `./client` module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/lib/email/client.ts`:

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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/lib/email/client.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/client.ts src/lib/email/client.test.ts
git commit -m "$(cat <<'EOF'
Add fetch-based Resend email client with six pure formatters

Mirrors the Slack client's shape: sendEmail is a thin, throwable fetch
wrapper; formatting is pure and unit-tested. Not yet called from
anywhere — wired into the billing cron next.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `computeTrialReminderAction`

**Files:**
- Modify: `src/lib/stripe/billing-cycle.ts`
- Test: `src/lib/stripe/billing-cycle.test.ts`

- [ ] **Step 1: Write the failing tests**

Change the import line in `src/lib/stripe/billing-cycle.test.ts`:

```ts
import {
  computeDunningAction,
  nextBillingDateAfter,
  remainingMonthsUntil,
  computeTrialReminderAction,
} from "./billing-cycle";
```

Append:

```ts
describe("computeTrialReminderAction", () => {
  it("fires a reminder exactly 3 days before trial_end_date", () => {
    const trialEndDate = new Date("2026-01-15T00:00:00Z");
    const now = new Date("2026-01-12T00:00:00Z");
    expect(computeTrialReminderAction(trialEndDate, now)).toEqual({ type: "reminder" });
  });

  it("fires expired on the first day after trial_end_date has passed", () => {
    const trialEndDate = new Date("2026-01-15T00:00:00Z");
    const now = new Date("2026-01-15T12:00:00Z");
    expect(computeTrialReminderAction(trialEndDate, now)).toEqual({ type: "expired" });
  });

  it("returns none for every other day count, including well past expiry", () => {
    const trialEndDate = new Date("2026-01-15T00:00:00Z");
    for (const days of [10, 5, 4, 2, 1, -1, -5, -30]) {
      const now = new Date(trialEndDate.getTime() - days * 24 * 60 * 60 * 1000);
      expect(computeTrialReminderAction(trialEndDate, now)).toEqual({ type: "none" });
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/lib/stripe/billing-cycle.test.ts`
Expected: FAIL — `computeTrialReminderAction` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/stripe/billing-cycle.ts`, after `remainingMonthsUntil`:

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

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/lib/stripe/billing-cycle.test.ts`
Expected: PASS, all tests including the pre-existing `computeDunningAction`/`nextBillingDateAfter`/`remainingMonthsUntil` ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stripe/billing-cycle.ts src/lib/stripe/billing-cycle.test.ts
git commit -m "$(cat <<'EOF'
Add computeTrialReminderAction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Env var placeholders

**Files:**
- Modify: `.env.local.example`

- [ ] **Step 1: Add the two new lines**

Current file ends with `CRON_SECRET=`. Append:

```
RESEND_API_KEY=
RESEND_FROM_EMAIL=
```

- [ ] **Step 2: Commit**

```bash
git add .env.local.example
git commit -m "$(cat <<'EOF'
Add RESEND_API_KEY/RESEND_FROM_EMAIL env var placeholders

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `trySendBillingEmail` + dunning/cancellation call sites

**Files:**
- Modify: `src/app/api/internal/billing/run-cycle/route.ts`

- [ ] **Step 1: Update imports**

Change:

```ts
import { stripe, computePrice, type BillingPlanType } from "@/lib/stripe/client";
import { computeDunningAction, nextBillingDateAfter } from "@/lib/stripe/billing-cycle";
import { createServiceClient } from "@/lib/supabase/service";
```

to:

```ts
import { stripe, computePrice, type BillingPlanType } from "@/lib/stripe/client";
import { computeDunningAction, nextBillingDateAfter } from "@/lib/stripe/billing-cycle";
import { createServiceClient } from "@/lib/supabase/service";
import {
  sendEmail,
  formatDunningNoticeEmail,
  formatDowngradeEmail,
  formatDunningCancelledEmail,
  formatVoluntaryCancelledEmail,
} from "@/lib/email/client";
```

- [ ] **Step 2: Add `trySendBillingEmail` after the `POST` function's opening auth check, before Pass 1**

Insert this function above `export async function POST`:

```ts
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

- [ ] **Step 3: Add `name` to Pass 2's and Pass 3's `.select()` calls**

Change Pass 2's query from:

```ts
  const { data: failingOrgs } = await supabase
    .from("organizations")
    .select("id, payment_failed_since")
    .in("billing_status", ["active", "past_due"])
    .not("payment_failed_since", "is", null);
```

to:

```ts
  const { data: failingOrgs } = await supabase
    .from("organizations")
    .select("id, name, payment_failed_since")
    .in("billing_status", ["active", "past_due"])
    .not("payment_failed_since", "is", null);
```

Change Pass 3's query from:

```ts
  const { data: cancelingOrgs } = await supabase
    .from("organizations")
    .select("id")
    .not("cancel_at", "is", null)
    .lte("cancel_at", now.toISOString());
```

to:

```ts
  const { data: cancelingOrgs } = await supabase
    .from("organizations")
    .select("id, name")
    .not("cancel_at", "is", null)
    .lte("cancel_at", now.toISOString());
```

- [ ] **Step 4: Call `trySendBillingEmail` in Pass 2's three branches**

Change:

```ts
    if (action.type === "notice") {
      await supabase.from("billing_events").insert({ org_id: org.id, event_type: "payment_failed" });
    } else if (action.type === "downgrade") {
      await supabase.from("organizations").update({ billing_status: "past_due" }).eq("id", org.id);
      await supabase.from("billing_events").insert({ org_id: org.id, event_type: "payment_failed" });
    } else if (action.type === "cancel") {
      await supabase
        .from("organizations")
        .update({ billing_status: "cancelled", payment_failed_since: null })
        .eq("id", org.id);
      await supabase.from("billing_events").insert({
        org_id: org.id,
        event_type: "subscription_cancelled",
      });
    }
```

to:

```ts
    if (action.type === "notice") {
      await supabase.from("billing_events").insert({ org_id: org.id, event_type: "payment_failed" });
      const { subject, text } = formatDunningNoticeEmail(org.name, action.day);
      await trySendBillingEmail(supabase, org.id, subject, text);
    } else if (action.type === "downgrade") {
      await supabase.from("organizations").update({ billing_status: "past_due" }).eq("id", org.id);
      await supabase.from("billing_events").insert({ org_id: org.id, event_type: "payment_failed" });
      const { subject, text } = formatDowngradeEmail(org.name);
      await trySendBillingEmail(supabase, org.id, subject, text);
    } else if (action.type === "cancel") {
      await supabase
        .from("organizations")
        .update({ billing_status: "cancelled", payment_failed_since: null })
        .eq("id", org.id);
      await supabase.from("billing_events").insert({
        org_id: org.id,
        event_type: "subscription_cancelled",
      });
      const { subject, text } = formatDunningCancelledEmail(org.name);
      await trySendBillingEmail(supabase, org.id, subject, text);
    }
```

- [ ] **Step 5: Call `trySendBillingEmail` in Pass 3's loop**

Change:

```ts
  for (const org of cancelingOrgs ?? []) {
    await supabase
      .from("organizations")
      .update({ billing_status: "cancelled", cancel_at: null })
      .eq("id", org.id);
    await supabase.from("billing_events").insert({
      org_id: org.id,
      event_type: "subscription_cancelled",
    });
  }
```

to:

```ts
  for (const org of cancelingOrgs ?? []) {
    await supabase
      .from("organizations")
      .update({ billing_status: "cancelled", cancel_at: null })
      .eq("id", org.id);
    await supabase.from("billing_events").insert({
      org_id: org.id,
      event_type: "subscription_cancelled",
    });
    const { subject, text } = formatVoluntaryCancelledEmail(org.name);
    await trySendBillingEmail(supabase, org.id, subject, text);
  }
```

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/api/internal/billing/run-cycle/route.ts`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/internal/billing/run-cycle/route.ts
git commit -m "$(cat <<'EOF'
Send real email on dunning notices, downgrade, and cancellation

trySendBillingEmail looks up the org owner via organization_members +
auth.admin.getUserById (service role) and sends through the new Resend
client — best-effort, never affects billing_status or fails the cron.
Wired into Pass 2's notice/downgrade/cancel branches and Pass 3's
voluntary-cancellation finalization.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Pass 4 — trial-ending reminders

**Files:**
- Modify: `src/app/api/internal/billing/run-cycle/route.ts`

- [ ] **Step 1: Update imports**

Add `computeTrialReminderAction` to the `billing-cycle` import and the two trial formatters to the `email/client` import:

```ts
import {
  computeDunningAction,
  nextBillingDateAfter,
  computeTrialReminderAction,
} from "@/lib/stripe/billing-cycle";
import {
  sendEmail,
  formatDunningNoticeEmail,
  formatDowngradeEmail,
  formatDunningCancelledEmail,
  formatVoluntaryCancelledEmail,
  formatTrialReminderEmail,
  formatTrialExpiredEmail,
} from "@/lib/email/client";
```

- [ ] **Step 2: Add Pass 4 after Pass 3's loop, before the final `return Response.json(...)`**

```ts
  // Pass 4: trial-ending reminders. Disjoint from Pass 1-3 (billing_status
  // = 'trial' here vs. ['active', 'past_due'] there) — order relative to
  // them doesn't matter. Nothing else in this codebase proactively checks
  // trial_end_date; isReadOnly (Foundation) only derives expiry lazily on
  // read, so this is the first place a trial's approach/lapse is ever
  // acted on rather than just silently enforced.
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

- [ ] **Step 3: Add a `trialRemindersChecked` count to the response**

Change:

```ts
  return Response.json({
    status: "ok",
    processed: (dueOrgs ?? []).length,
    failing: (failingOrgs ?? []).length,
    cancelled: (cancelingOrgs ?? []).length,
  });
```

to:

```ts
  return Response.json({
    status: "ok",
    processed: (dueOrgs ?? []).length,
    failing: (failingOrgs ?? []).length,
    cancelled: (cancelingOrgs ?? []).length,
    trialsChecked: (trialOrgs ?? []).length,
  });
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/api/internal/billing/run-cycle/route.ts`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/internal/billing/run-cycle/route.ts
git commit -m "$(cat <<'EOF'
Add trial-ending reminder emails (Pass 4)

New proactive check — nothing previously watched trial_end_date; expiry
was only ever derived lazily on read for isReadOnly. Sends a reminder
at exactly 3 days remaining and an expired notice on the first day
past it, mirroring computeDunningAction's exact-day-only philosophy.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, including the new `client.test.ts` (8 tests) and `computeTrialReminderAction` suite (3 tests) — total should be 103 (current main) + 11 = 114.

- [ ] **Step 2: Type-check, lint, build**

Run: `npx tsc --noEmit && npx eslint . && npm run build`
Expected: all clean.

- [ ] **Step 3: Re-check the spec's scope decisions against the code**

Confirm each of the 9 scope decisions in `docs/superpowers/specs/2026-09-23-billing-email-notifications-design.md` is reflected:
1. Fetch-based, no `resend` npm dependency. ✓ (`package.json` untouched by this plan — confirm no new dependency was added.)
2. Recipient resolved via `organization_members` + `auth.admin.getUserById`, no new migration. ✓ (Task 4.)
3. Six email types mapped onto existing/new pure decisions. ✓ (Task 1, Task 4, Task 5.)
4. New `computeTrialReminderAction`, no new column. ✓ (Task 2.)
5. `trySendBillingEmail` is best-effort, never throws, never touches billing state. ✓ (Task 4, Step 2.)
6. No new `billing_events` types for email delivery itself. ✓ (Confirm no `supabase/migrations/*.sql` file was added by this plan.)
7. Plain text only, no HTML templating. ✓ (Task 1.)
8. `RESEND_API_KEY`/`RESEND_FROM_EMAIL` env vars, unset in this environment. ✓ (Task 3.)
9. Pass 4 appended, not inserted at the top. ✓ (Task 5.)

- [ ] **Step 4: State what remains manual**

No live Resend account/API key exists in this session — `sendEmail`'s actual `fetch` call to Resend's API is verified via `tsc`/`eslint`/`build` and the pure-formatter unit tests only, not a live send. This is explicitly flagged here rather than silently assumed to have been tested end-to-end, the same posture as every Stripe call since Phase 2.

- [ ] **Step 5: Confirm working tree is clean**

Run: `git status --short`
Expected: empty output.
