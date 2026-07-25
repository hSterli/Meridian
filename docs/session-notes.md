# Meridian QA — Session Notes (2026-07-24)

Working notes from the build/reskin session that took the existing Phase 1
MVP (see `README.md`) from a bare Next.js scaffold with default styling
through to a design-matched, security-hardened app with several new
features. Full detail for any item below is in the corresponding commit.

## What changed this session

| Commit | What |
|---|---|
| `02902a1` | Restored the working tree from git, applied the Paper/Ink design system across every page, moved RLS helper functions into a non-exposed `private` schema (closing a cross-tenant org-id disclosure), added per-user Postgres-backed rate limiting on writes |
| `4b2bcc8` | Added a required, structured **Feature** field on test cases (project-managed, distinct from free-form tags), a project filter on the dashboard, fixed the post-create redirect for test cases, and stopped sending `Strict-Transport-Security` in dev (it was making browsers refuse to load `http://localhost` at all) |
| `ca6e971` | Surfaced the Feature badge in the Test Runner view (it had only reached the test case library) |
| `5af8641` | Rebuilt the Runs list as a sortable table with a segmented pass/fail/blocked/skipped status bar, optional folders, and multi-select batch delete/move — modeled on the PractiTest "Test Sets & Runs" reference screen |
| `8da0987` | Added **Reports** and **Settings** to the sidebar (placeholder pages; Team already existed and is now linked from Settings) |
| `3464ef3` | Added "Add test cases" to an already-created run, and a new **Test Suites** concept — reusable, named test case groupings that can be re-run on demand, with last-run pass rate and full run history |

Security posture established this session: CSP/HSTS/security headers scoped
correctly for dev vs. prod, RLS on every table verified via Supabase's
advisor, and a documented rationale for why the remaining advisor warnings
(a few SECURITY DEFINER RPCs callable by authenticated users) are
intentional and individually safe — see `README.md` → Security notes.

## Manual follow-ups (not automatable from here)

- Enable **Leaked Password Protection** in Supabase Dashboard → Authentication
  → Policies. No MCP tool or SQL path exposes this setting.
- Consider Supabase's built-in email-sending rate limit if faster iteration
  on test signups is needed (it's what blocked a couple of test accounts
  mid-session — confirms it's live, not a bug).

## Future consideration: waterfall / compliance-heavy documentation

**Not being built now.** Raised as "we will need this eventually," so
recording the shape of it here rather than in a fix-it-later code comment.

**The ask:** support for QA teams running waterfall-style processes with
heavy documentation obligations — test evidence, highlighted risks, daily
and weekly status reports, multiple/categorized defect lists, and some
level of integration with whatever the team already uses for records.

**Why it's deliberately out of scope for now:** the PRD's own strategic
positioning (§1, §11) explicitly defers this depth to a Phase 3 enterprise
tier — audit-grade traceability, a custom workflow/state-machine engine,
fine-grained governance. Building it into V1 risks recreating the exact
complexity problem ("steep learning curve," "a lot") that PractiTest
reviewers cite and that this product exists to fix. The PRD flags this
directly as "parity-creep risk" (§11) and recommends validating real
audit-grade needs with 2–3 target enterprise prospects during Phase 2,
not building speculatively ahead of that signal.

**What it would likely require, when prioritized:**

- **Risk register** — a new entity: risks linked to requirements and/or
  test cases, with severity/likelihood and mitigation status. Nothing in
  the current schema models this yet.
- **Multiple/categorized defect lists** — today there's one flat `issues`
  list per project. Supporting named, separate defect lists would follow
  the same pattern already established for Suites/Folders (a grouping
  table + membership), not a schema rewrite.
- **Scheduled daily/weekly reports** — the PRD already scopes "scheduled
  report delivery (email/Slack digest)" as V1 (§7.6), and the Dashboard
  already computes the underlying pass/fail trend and flaky-test data.
  The `/reports` placeholder page anticipates deeper report types
  (coverage by requirement, team velocity, flaky-test deep dive) but none
  are wired up yet. This is the cheapest of these items to build later —
  mostly plumbing (a cron/schedule + digest template) on top of data that
  already exists.
- **Evidence-heavy documentation** — the Test Runner mockup already shows
  an "Evidence" drop zone for screenshots/video, but no file storage or
  upload handling exists in the app yet (would need Supabase Storage + an
  `evidence` table linked to `test_run_cases`).
- **Integration** — the user's phrasing trailed off here; worth a follow-up
  conversation on whether they mean exporting to an external compliance
  system, two-way defect sync (the PRD already scopes Jira/GitHub/GitLab
  issue sync as Phase 2, §7.4/§7.7), or something else entirely.

**When to revisit:** when a specific customer or prospect actually asks for
this, per the PRD's own guidance — not speculatively.
