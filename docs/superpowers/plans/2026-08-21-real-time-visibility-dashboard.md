# Real-Time Visibility Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The per-project Weekly Status Report auto-refreshes every 10 minutes (not just on manual reload), so it stays current when left open on a shared screen.

**Architecture:** One new client component, `AutoRefresh`, mounted once in the existing Weekly Status Report page. It calls Next.js's `router.refresh()` on a timer to re-run the page's Server Component, skips the refresh (but keeps ticking) while the tab is hidden, and renders a small "Last refreshed" label. No schema change, no new Server Action, no new page.

**Tech Stack:** Next.js 16 App Router (Client Component, `next/navigation`'s `useRouter`), React (`useEffect`/`useRef`/`useState`), TypeScript, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-21-real-time-visibility-dashboard-design.md` — read it first for the full rationale, including why no unit tests are planned for this component.

---

## Known repo quirk

Check `tail -3 <file>` after every file write for a stray literal `</content>` line; strip with `sed -i '' -e '/^<\/content>$/d' <file>` if present.

## Environment notes

- **git**: works in this session via `/Library/Developer/CommandLineTools/usr/bin/git` (the earlier Xcode CLT license block is resolved). If a future session hits `git --version` failing with an Xcode license error again, prepend that path to `PATH` rather than running `sudo xcodebuild -license` (that needs a human at an interactive prompt).
- **Node/npm/npx**: unavailable in the authoring session. Every `Verify` step needing `tsc`/`eslint`/`build` needs an environment with Node available — run it there, don't assume it already ran.
- **No unit tests for `AutoRefresh`**: deliberate, per the spec (scope decision / Testing section) — it's a thin wrapper around browser-only APIs (`useRouter().refresh()`, `document.visibilityState`) with no existing pattern in this codebase for testing client-side timer effects. Verification is the manual browser check in Task 2.

---

### Task 1: `AutoRefresh` component

**Files:**
- Create: `src/components/reports/auto-refresh.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/reports/auto-refresh.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const LABEL_TICK_MS = 60 * 1000; // 1 minute

function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  return `${minutes}m ago`;
}

// Periodically re-runs this page's Server Component via router.refresh(),
// without a full page reload. Skips the refresh call (but keeps its own
// timer running, so the label below stays accurate) while the tab isn't
// visible — see docs/superpowers/specs/2026-08-21-real-time-visibility-dashboard-design.md.
//
// Safe to mount alongside RagEditor/DailyExecutionTable: both use mount-only
// local/uncontrolled state that doesn't resync from fresh props on a
// router.refresh()-triggered re-render, so an in-progress edit in either
// survives a background refresh.
export function AutoRefresh({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number }) {
  const router = useRouter();
  const lastRefreshedRef = useRef(Date.now());
  const [, forceLabelTick] = useState(0);

  useEffect(() => {
    const refreshInterval = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
        lastRefreshedRef.current = Date.now();
      }
    }, intervalMs);

    const labelInterval = setInterval(() => {
      forceLabelTick((n) => n + 1);
    }, LABEL_TICK_MS);

    return () => {
      clearInterval(refreshInterval);
      clearInterval(labelInterval);
    };
  }, [intervalMs, router]);

  return (
    <span className="text-xs text-ink-tertiary">
      Last refreshed: {formatElapsed(Date.now() - lastRefreshedRef.current)}
    </span>
  );
}
```

- [ ] **Step 2: Check for the stray `</content>` line**

Run: `tail -3 src/components/reports/auto-refresh.tsx`
Strip with `sed -i '' -e '/^<\/content>$/d' src/components/reports/auto-refresh.tsx` if present.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output. (Skip and note if Node isn't available in this environment.)

Run: `npx eslint src/components/reports/auto-refresh.tsx`
Expected: no output. (Skip and note if Node isn't available in this environment.)

- [ ] **Step 4: Commit**

```bash
git add src/components/reports/auto-refresh.tsx
git commit -m "Add AutoRefresh: 10-minute router.refresh() timer with a last-refreshed label"
```

---

### Task 2: Mount it on the Weekly Status Report page

**Files:**
- Modify: `src/app/(app)/projects/[projectId]/reports/page.tsx`

- [ ] **Step 1: Add the import**

In `src/app/(app)/projects/[projectId]/reports/page.tsx`, add alongside the other `@/components/reports/*` imports:

```ts
import { AutoRefresh } from "@/components/reports/auto-refresh";
```

So the top of the file reads:

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RagEditor } from "@/components/reports/rag-editor";
import { DailyExecutionTable } from "@/components/reports/daily-execution-table";
import { AutoRefresh } from "@/components/reports/auto-refresh";
import { computeWeeklyReportMetrics, getWeekdayRange } from "@/lib/weekly-report-metrics";
import { captureWeeklyReportSnapshot } from "@/lib/actions/weekly-reports";
```

- [ ] **Step 2: Mount `<AutoRefresh />` in the page header's action row**

Change the `PageHeader`'s `action` prop from:

```tsx
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${projectId}/reports/history`}
              className="text-sm font-medium text-primary hover:text-primary"
            >
              View history
            </Link>
            <form action={captureAction}>
              <Button type="submit" variant="primary">
                Capture this week&rsquo;s report
              </Button>
            </form>
          </div>
        }
```

to:

```tsx
        action={
          <div className="flex items-center gap-2">
            <AutoRefresh />
            <Link
              href={`/projects/${projectId}/reports/history`}
              className="text-sm font-medium text-primary hover:text-primary"
            >
              View history
            </Link>
            <form action={captureAction}>
              <Button type="submit" variant="primary">
                Capture this week&rsquo;s report
              </Button>
            </form>
          </div>
        }
```

No other line in the file changes — every other Card, the metrics grid, the daily execution table, and the module breakdown table stay exactly as they are.

- [ ] **Step 3: Check for the stray `</content>` line**

Run: `tail -3 "src/app/(app)/projects/[projectId]/reports/page.tsx"`
Strip if present.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output. (Skip and note if Node isn't available.)

Run: `npx eslint "src/app/(app)/projects/[projectId]/reports/page.tsx"`
Expected: no output. (Skip and note if Node isn't available.)

- [ ] **Step 5: Manual browser verification**

This is the real verification for this feature (see "No unit tests" above) — needs a running dev server (`npm run dev`) and a signed-in session (`qa.tester@meridianqa.dev`, or any account with a project). Requires Node, so run this from an environment that has it.

1. Open a project's Weekly Status Report (`/projects/[projectId]/reports`). Confirm "Last refreshed: just now" appears next to "View history" in the header.
2. Wait a couple of minutes (or temporarily edit `DEFAULT_INTERVAL_MS` down to e.g. `10_000` for a faster manual check, then revert before committing). Confirm the label counts up ("1m ago", "2m ago", ...).
3. Type something into the "Key Highlights" textarea but don't click Save. Wait for a refresh tick to fire (or trigger one manually via the browser console: `window.location.reload()` is NOT equivalent — instead, temporarily lower the interval as in step 2, or call `router.refresh()` yourself via React DevTools if comfortable doing so). Confirm the typed text is still there after the tick, unsaved.
4. Edit a "Planned" count in the Daily Test Execution table (don't wait for the debounced save to necessarily land first). Confirm a refresh tick doesn't visibly reset the input back to its old value.
5. Switch to a different browser tab (making this one hidden) for longer than one refresh interval, then switch back. Confirm the "Last refreshed" label shows a correspondingly larger elapsed time (proving the tick was skipped while hidden), and that the very next visible tick refreshes normally.

If any of these fail, stop and report which one rather than marking this task done.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/projects/[projectId]/reports/page.tsx"
git commit -m "Mount AutoRefresh on the Weekly Status Report page"
```

---

### Task 3: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated verification suite**

```bash
npx tsc --noEmit
```
Expected: no output. (Skip and note if Node isn't available.)

```bash
npx eslint src/components/reports/auto-refresh.tsx "src/app/(app)/projects/[projectId]/reports/page.tsx"
```
Expected: no output. (Skip and note if Node isn't available.)

```bash
npm run build
```
Expected: production build succeeds; the project reports route still appears in the route list. (Skip and note if Node isn't available.)

```bash
git status --short
```
Expected: clean.

- [ ] **Step 2: Confirm the design spec is fully addressed**

Re-read `docs/superpowers/specs/2026-08-21-real-time-visibility-dashboard-design.md`'s 6 scope decisions and confirm each is reflected:
1. Extends the existing report page — confirmed, no new page or data model created anywhere in this plan.
2. 10-minute client timer via `router.refresh()`, no websockets/Realtime — confirmed, `AutoRefresh`'s only mechanism.
3. No cross-project scope, no project switcher — confirmed, nothing in `AutoRefresh` or the page touches project scoping.
4. No per-executor breakdown — confirmed, untouched.
5. No new schema, no new Server Action — confirmed, only one new component file and one edit to an existing page.
6. Verified safe against `RagEditor`/`DailyExecutionTable` — confirmed by Task 2 Step 5's manual check (steps 3 and 4 specifically).

- [ ] **Step 3: Commit the plan checkbox updates**

```bash
git add docs/superpowers/plans/2026-08-21-real-time-visibility-dashboard.md
git commit -m "docs: mark real-time visibility dashboard plan complete"
```
