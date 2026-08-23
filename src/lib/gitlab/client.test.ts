import { describe, expect, it } from "vitest";
import { verifyGitlabWebhookToken } from "./client";

describe("verifyGitlabWebhookToken", () => {
  it("returns true when the header matches the stored token", () => {
    expect(verifyGitlabWebhookToken("secret-123", "secret-123")).toBe(true);
  });

  it("returns false when the header doesn't match", () => {
    expect(verifyGitlabWebhookToken("wrong", "secret-123")).toBe(false);
  });

  it("returns false when the header is missing", () => {
    expect(verifyGitlabWebhookToken(null, "secret-123")).toBe(false);
  });
});
