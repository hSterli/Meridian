# Billing Foundation — Design

**Date**: 2026-09-05
**Status**: Approved, pending implementation
**Context**: Phase 1 of a larger billing initiative. The full pricing model, mechanics, and rationale live in three external planning documents the user provided (`pricing_summary_onepager.md`, `meridian_billing_spec.md`, `billing_implementation_timeline.md`) — hybrid pricing ($99/mo base + $19/seat/mo), 20% annual prepay discount, 14-day trial with no card required, **no free tier** (trial-only — this explicitly supersedes an earlier tentative Free+Pro/seat-cap/feature-gating plan from an earlier brainstorm this session, confirmed final by the user), **no feature gates** (every plan gets every integration/feature). Those docs assume a generic stack that doesn't match this codebase (a single `Org.owner_id` field instead of role-based membership, REST endpoints instead of Server Actions, "systemd timer, Kubernetes cronjob, or cloud scheduler" for cron). This spec adapts the parts of those docs that don't depend on Stripe or a scheduler to Meridian's actual schema and conventions. Stripe checkout/webhooks, recurring billing cron, mid-year seat billing, plan switching, the billing settings UI, and all transactional email are each their own separate future spec — explicitly out of scope here.

## Problem

Right now every org has unlimited, permanent free access — there's no trial, no plan state, and nothing anywhere tracks or enforces a billing relationship. Before Stripe checkout (Phase 2) can mean anything, orgs need a trial that actually starts, actually ends, and actually restricts access when it does.

## Scope decisions

1. **Trial expiry is fully derived, never a stored transition.** `organizations.billing_status` stays `'trial'` for the entire 14 days and beyond — nothing flips it to a `'trial_expired'` value. Every read computes "is this org actually still within its trial" from `trial_end_date` vs. `now()`. This avoids needing any scheduled job for Foundation (none exists in this codebase today), and there's no window where a stored status is stale because a job hasn't run yet.
2. **`billing_status` is a 4-value enum defined in full now — `trial | active | past_due | cancelled`** — even though Foundation's own code only ever writes `'trial'`. Postgres enum values are cheap to declare and awkward to add later (`ALTER TYPE ... ADD VALUE`), and the eventual state machine is already known from the approved external spec. The other three values simply sit unused until Phase 2/3 write to them.
3. **`billing_events.event_type` follows the same reasoning** — the full future set from the external spec (`trial_started, upgrade_started, subscription_created, subscription_renewed, invoice_issued, payment_succeeded, payment_failed, seat_added_mid_year, plan_changed, subscription_cancelled`) is defined now, but Foundation only ever inserts `'trial_started'`, once, at org creation. There is deliberately no `'trial_expired'` event — because expiry is never a discrete transition (scope decision 1), there's no moment in code where one would fire.
4. **Read-only enforcement is real and wired up in this phase**, not deferred to Phase 2 — even though Stripe checkout (the only self-serve way out of read-only) doesn't exist yet. Accepted tradeoff: until Phase 2 ships, any org whose trial expires has no self-serve path back and needs a manual `UPDATE organizations SET billing_status = 'active'` as an interim operational workaround. This was chosen deliberately over shipping unenforced state-tracking, so read-only is real from day one rather than a second pass through the same ~35 files later.
5. **Read-only blocks every mutating action uniformly — creates, updates, *and* deletes/disconnects/revokes.** No case-by-case classification of which mutations are "safe" to leave open. Simpler rule, simpler to explain, and avoids a genuinely subjective judgment call on individual actions (e.g., is disconnecting a Slack integration destructive or a config change?).
6. **`isReadOnly` is computed once, centrally, on `UserContext`** — `getUserContext()` gains a boolean field: `billing_status IN ('past_due', 'cancelled')` OR (`billing_status = 'trial'` AND `trial_end_date < now()`). Only the trial branch is reachable today (nothing sets the other two statuses yet), but the full boolean is written correctly now rather than patched later.
7. **Blocked actions surface differently depending on how each action already reports errors** — not retrofitting every action onto one uniform mechanism:
   - Actions that already return `ActionState` (or a subtype of it) and are driven by `useActionState` on the client show the block as an inline `{error: "..."}`, exactly like any other validation error they already produce.
   - Actions that are void/fire-and-forget (bound directly to `<form action={fn}>` or a `.bind()` call, with no existing error-display path) instead `redirect()` back to the current page with `?error=read-only` appended; a new small shared component reads that param and renders a dismissible banner. This is additive to those pages, not a retrofit of the actions themselves onto the `ActionState` pattern (that retrofit was explicitly considered and rejected as unnecessary scope for this phase).
8. **Three categories of Server Action are excluded from the read-only gate entirely**, because "read-only for an org" doesn't meaningfully apply to them:
   - `auth.ts`'s `signUp`, `signIn`, `signOut`, `updateProfile` — none of these mutate a specific org's content; the first three aren't even org-scoped, and `updateProfile` changes the signed-in user's own name, not anything belonging to an org.
   - `orgs.ts`'s `createOrganizationAndProject` and `switchActiveOrg` — creating a *new* org gives that org its own fresh trial, so the *current* org's read-only status is irrelevant; switching which org is active mutates no org's content at all.
   - `members.ts`'s `acceptPendingInvites` — takes no org parameter and processes a signed-in user's pending invites across however many orgs invited them, so there's no single org's `billing_status` to check against.
9. **The trial banner is visible for the entire 14 days, not just the final stretch**, with styling intensity scaling with days remaining: low-key (e.g. "Trial — 12 days left") early on, more prominent (amber/red, "Trial ends tomorrow") in the final days, and a permanent "Trial ended — read-only" banner once expired. One component with one continuously-scaling rule, rather than separate hidden/shown/expired states with an arbitrary cutoff day to pick.
10. **The banner lives in `(app)/layout.tsx`, above the sidebar+content flex row**, not inside `<main>` — so it's visible regardless of whether the sidebar is collapsed, and consistent across every page.

## Architecture

### Migration: `supabase/migrations/0026_billing_foundation.sql`

```sql
create type billing_status as enum ('trial', 'active', 'past_due', 'cancelled');
create type billing_plan_type as enum ('monthly', 'annual');
create type billing_event_type as enum (
  'trial_started',
  'upgrade_started',
  'subscription_created',
  'subscription_renewed',
  'invoice_issued',
  'payment_succeeded',
  'payment_failed',
  'seat_added_mid_year',
  'plan_changed',
  'subscription_cancelled'
);

alter table organizations
  add column billing_status billing_status not null default 'trial',
  add column trial_end_date timestamptz,
  add column plan_type billing_plan_type;

create table billing_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  event_type billing_event_type not null,
  created_at timestamptz not null default now()
);

create index billing_events_org_id_idx on billing_events(org_id);

alter table billing_events enable row level security;

create policy "org members can view their org's billing events"
  on billing_events for select
  using (private.is_org_member(org_id));
```

`billing_events` is insert-only from `SECURITY DEFINER` functions (matching this schema's existing convention for org-mutating writes) — no `insert`/`update`/`delete` policy is needed for `authenticated`, only the `select` policy for org members to view their own org's history.

### `create_organization_with_owner` gains trial initialization

`supabase/migrations/0026_billing_foundation.sql` also replaces this function (from `0005_create_org_rpc.sql`) to set `trial_end_date` and log the first `billing_events` row, inside the same transaction as org + owner-membership creation:

```sql
create or replace function create_organization_with_owner(org_name text, org_slug text)
returns organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org organizations;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into organizations (name, slug, created_by, trial_end_date)
  values (org_name, org_slug, auth.uid(), now() + interval '14 days')
  returning * into v_org;

  insert into organization_members (org_id, user_id, role)
  values (v_org.id, auth.uid(), 'owner');

  insert into billing_events (org_id, event_type)
  values (v_org.id, 'trial_started');

  return v_org;
end;
$$;
```

(Grants stay unchanged from `0005` — this is a `create or replace`, not a new function, so no new `revoke`/`grant` statements are needed.)

### `UserContext` gains `isReadOnly`

`src/lib/org-context.ts`'s `getUserContext()` fetches `billing_status` and `trial_end_date` alongside the existing organization fields it already selects, and computes:

```ts
const isReadOnly =
  active?.organizations.billing_status === "past_due" ||
  active?.organizations.billing_status === "cancelled" ||
  (active?.organizations.billing_status === "trial" &&
    !!active?.organizations.trial_end_date &&
    new Date(active.organizations.trial_end_date) < new Date());
```

added to the returned `UserContext`, and to the `OrgMembership.organizations` shape (which needs `billing_status`/`trial_end_date` added to its own `select` and type).

### Gating every mutating Server Action

Every exported function below gets one line added, immediately after its existing `getUserContext()` call: `if (ctx.isReadOnly) return { error: "Your trial has ended — add payment to continue." };` for the `ActionState`-pattern ones, or the `redirect` equivalent for the void ones (exact classification per function — which pattern each currently uses — is determined by reading that specific function during implementation, not guessed here).

**Files and functions in scope** (all exports except the excluded ones in scope decision 8):

- `api-keys.ts`: `createApiKey`, `revokeApiKey`
- `attachments.ts`: `uploadAttachment`, `deleteAttachment`
- `custom-fields.ts`: `createCustomField`, `updateCustomField`, `deleteCustomField`
- `issue-tracker.ts`: `connectJiraTracker`, `disconnectJiraTracker`, `sendIssueToJira`, `connectGithubTracker`, `disconnectGithubTracker`, `sendIssueToGithub`
- `issues.ts`: `createIssue`, `updateIssueStatus`, `deleteIssue`
- `members.ts`: `inviteMember`, `cancelInvite`, `updateMemberRole`, `removeMember`
- `projects.ts`: `createProject`
- `runs.ts`: `createRunFolder`, `createRun`, `setRunCaseStatus`, `deleteRun`, `addTestCasesToRun`, `bulkDeleteRuns`, `bulkMoveRunsToFolder`
- `slack.ts`: `connectSlackNotifications`, `disconnectSlackNotifications`
- `suites.ts`: `createSuite`, `addTestCasesToSuite`, `removeTestCaseFromSuite`, `runSuiteNow`, `deleteSuite`
- `test-cases.ts`: `createTestCase`, `updateTestCase`, `deleteTestCase`, `bulkImportTestCases`
- `weekly-reports.ts`: `updateWeeklyReportDraft`, `updateDailyPlan`, `captureWeeklyReportSnapshot`, `updateSnapshotEditorialFields`

**Explicitly excluded** (scope decision 8): `auth.ts` (`signUp`, `signIn`, `signOut`, `updateProfile`), `orgs.ts` (`createOrganizationAndProject`, `switchActiveOrg`), `members.ts`'s `acceptPendingInvites`.

`getAttachmentDownloadUrl` (in `attachments.ts`) and every other read-only query function in these files are unaffected — this feature only ever gates writes.

### `?error=read-only` banner component

A new small client component (e.g. `src/components/layout/action-error-banner.tsx`) reads `?error=` via `useSearchParams()` and renders a dismissible banner when the value is `"read-only"` (dismissal just clears the query param via `router.replace`, no other state). Placed once, in `(app)/layout.tsx`, so every void action's redirect target shows it regardless of which page it lands on.

### Trial countdown banner

A new component (e.g. `src/components/layout/trial-banner.tsx`), a Server Component reading the active org's `billing_status`/`trial_end_date` (via the same `getUserContext()` call `(app)/layout.tsx` already makes — no new fetch), rendered above the existing `<div className="flex min-h-screen ...">` row that wraps `Sidebar` + `<main>`. Three visual states based on days remaining: `> 3` days (neutral/quiet), `<= 3` days (amber, more prominent), expired (persistent red "read-only" state, matching `isReadOnly`).

## Testing

- `src/lib/org-context.test.ts` (new, or added to an existing test file if `org-context.ts` doesn't have one yet): unit tests for the `isReadOnly` computation specifically — trial with future `trial_end_date` → `false`; trial with past `trial_end_date` → `true`; `active` → `false` regardless of `trial_end_date`; `past_due` → `true`; `cancelled` → `true`. This is the one piece of pure, testable logic in this phase; everything else is either SQL (verified via Supabase MCP `execute_sql` after applying the migration) or straightforward one-line action gates (verified by the full `npm test`/`tsc`/`eslint`/`build` pass plus a manual check that a deliberately-expired test org's mutations are actually blocked).
- Manual verification: use Supabase MCP to directly set a test org's `trial_end_date` to a past timestamp, confirm the banner shows "read-only," and confirm at least one representative `ActionState`-pattern action and one void-pattern action both correctly block with the expected UX.

## Explicitly out of scope

- Stripe checkout, webhooks, or any payment processing (Phase 2).
- Recurring monthly billing, annual renewal, mid-year seat billing — all require a scheduler this codebase doesn't have yet (Phase 3).
- Plan switching (monthly ↔ annual) and cancellation/reactivation flows (Phase 4).
- The Settings → Billing page showing plan/next-charge/payment-method/Stripe-portal-link (Phase 5).
- Any transactional email (trial welcome/expiring/expired, etc.) — no email provider is chosen yet; this is its own future decision, not bundled into any one phase above.
- An MRR/churn analytics dashboard.
