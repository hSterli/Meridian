"use client";

import { useEffect, useState } from "react";
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
//
// lastRefreshedAt/elapsedLabel are state, not refs read during render —
// React's purity rules (react-hooks/purity) forbid calling Date.now() or
// reading a ref's .current during render itself. The initial Date.now() call
// uses a lazy useState initializer (React only ever invokes it once, on
// mount) rather than a bare `useEffect(() => setState(...), [])`, which
// this codebase's own conventions already flag as the react-hooks/set-state-
// in-effect anti-pattern (see the SSR-safe localStorage note elsewhere in
// this repo) — every other Date.now() call happens inside an interval
// callback, which also runs outside render.
export function AutoRefresh({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number }) {
  const router = useRouter();
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() => Date.now());
  const [elapsedLabel, setElapsedLabel] = useState("just now");

  useEffect(() => {
    const refreshInterval = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
        setLastRefreshedAt(Date.now());
      }
    }, intervalMs);

    return () => clearInterval(refreshInterval);
  }, [intervalMs, router]);

  useEffect(() => {
    const updateLabel = () => setElapsedLabel(formatElapsed(Date.now() - lastRefreshedAt));
    updateLabel();
    const labelInterval = setInterval(updateLabel, LABEL_TICK_MS);
    return () => clearInterval(labelInterval);
  }, [lastRefreshedAt]);

  return <span className="text-xs text-ink-tertiary">Last refreshed: {elapsedLabel}</span>;
}
