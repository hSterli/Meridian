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
