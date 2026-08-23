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
