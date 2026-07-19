# Meridian QA

A test-management SaaS positioned as a lighter, cheaper alternative to PractiTest for mid-market teams: fast onboarding, cross-project reporting that doesn't require manual setup, and no "call sales" wall for core features. See the source PRD for full product context.

This is the **Phase 1 MVP** build — the P0 scope from the PRD's roadmap. Scope decisions and what's deferred are listed at the bottom.

## Stack

- **Next.js 16** (App Router, TypeScript, Turbopack) + **Tailwind CSS 4**
- **Supabase**: Postgres, Auth (email/password), and RLS for multi-tenancy — no separate backend
- Live project: `meridian-qa` (`ucnfcsosbdgknmzyuqbw`) in the Sterling LLC. Supabase org, free tier

## Local setup

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase URL + anon key (see below)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll land on `/login`; sign up, then the onboarding wizard creates your team and first project.

### Environment variables

`.env.local` needs:

```
NEXT_PUBLIC_SUPABASE_URL=https://ucnfcsosbdgknmzyuqbw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

Get these from the Supabase dashboard → Project Settings → API, or ask whoever set up the project. To point at a **different** Supabase project instead, create one and run the migrations below against it.

### Database schema

All schema is in `supabase/migrations/`, applied in order:

| Migration | What it does |
|---|---|
| `0001_init.sql` | Core schema: orgs, members, projects, test cases, runs, issues, RLS policies |
| `0002_invites.sql` | Team invite-by-email flow |
| `0003_member_rpc.sql` | `get_org_members` RPC (lists a team with email, since `auth.users` isn't in the exposed API) |
| `0004_lock_down_function_execute.sql` | Revokes public/anon EXECUTE on internal RLS helper functions |
| `0005_create_org_rpc.sql` | `create_organization_with_owner` RPC — see note below |

Apply them via the Supabase SQL editor, the Supabase CLI (`supabase db push`), or the Supabase MCP tools, in filename order, against a fresh project.

After schema changes, regenerate types:
```bash
npx supabase gen types typescript --project-id <project-id> > src/lib/types/database.ts
```
(then re-add the hand-written convenience aliases at the bottom of that file — `OrgRole`, `TestStep`, etc.)

**Why org creation goes through an RPC, not a plain insert:** creating an org hits a chicken-and-egg RLS problem — the policy that lets you *see* an org requires org membership, which can't exist until *after* the org row does. `supabase-js`'s `.insert().select()` re-selects the row it just inserted (via `Prefer: return=representation`), and that re-select fails RLS even though the insert itself succeeded — reported as a generic "violates row-level security policy" error with no indication that INSERT actually worked. `create_organization_with_owner` creates the org and the owner's membership atomically in one `SECURITY DEFINER` function, so no intermediate state is ever queried through the normal RLS-gated path. If you add other multi-step "create X, then immediately need to read X back" bootstrap flows, use the same pattern rather than chaining `.insert().select()`.

## What's implemented (Phase 1 MVP / P0)

- **Onboarding**: guided signup → create team → create first project from a starter template (web/mobile/API/blank), with seeded sample test cases
- **Test case management**: CRUD, tags, priority/status, version history, dynamic filters, CSV import/export
- **Test execution**: run creation from a test-case picker, keyboard-driven execution UI (P/F/B/S shortcuts, arrow-key navigation), notes per result
- **Issue tracking**: native lightweight tracker, linkable to a test case and/or a specific run result, status workflow (open → in progress → resolved → closed)
- **Cross-project dashboard**: stat tiles, recent-run pass/fail trend, flaky-test tracker (tests with both a pass and a fail in history), coverage by project
- **RBAC**: owner/admin/member roles, invite-by-email (auto-joins on next login/onboarding if the email matches a pending invite), role changes, member removal

## Explicitly deferred (Phase 2/3 per the PRD)

- Jira/GitHub/GitLab two-way issue sync, CI-triggered automated run ingestion via webhook
- Requirements management / traceability
- AI features (duplicate detection, test-value signal)
- Billing/plan tiers, regional data residency, SSO/SAML
- Full custom-field engine (test cases have a `custom_fields` jsonb column reserved for this, unused in the UI for now)

## Notes for further development

- `src/lib/types/database.ts` is generated from the live schema plus a few hand-added convenience type aliases at the bottom — see the comment at the top of that file.
- RLS policies assume every table-scoped query goes through the normal `anon`/`authenticated` Supabase client (`src/lib/supabase/{client,server}.ts`). Don't add a service-role client to the app; if you need to bypass RLS for a legitimate bootstrap-style operation, write a `SECURITY DEFINER` Postgres function (see `create_organization_with_owner`) rather than a service-role key in application code.
- `src/proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`) refreshes the Supabase session and gates unauthenticated access.
