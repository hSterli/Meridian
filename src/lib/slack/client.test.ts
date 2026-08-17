import { describe, expect, it } from "vitest";
import { formatRunNotification } from "./client";

describe("formatRunNotification", () => {
  it("formats a run summary as Slack mrkdwn", () => {
    const text = formatRunNotification({
      runName: "CI: main @ abc123",
      runUrl: "https://app.meridianqa.dev/projects/p1/runs/r1",
      passed: 8,
      failed: 1,
      blocked: 0,
      skipped: 2,
    });

    expect(text).toContain("*Meridian: CI: main @ abc123*");
    expect(text).toContain("✅ 8 passed · ❌ 1 failed · 🚫 0 blocked · ⏭️ 2 skipped");
    expect(text).toContain(
      "<https://app.meridianqa.dev/projects/p1/runs/r1|View full run in Meridian>"
    );
  });
});
