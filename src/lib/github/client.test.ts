import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifyGithubSignature } from "./client";

function sign(payload: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

describe("verifyGithubSignature", () => {
  it("returns true for a valid signature", () => {
    const payload = JSON.stringify({ action: "closed" });
    const secret = "test-secret";
    expect(verifyGithubSignature(payload, sign(payload, secret), secret)).toBe(true);
  });

  it("returns false for a signature computed with the wrong secret", () => {
    const payload = JSON.stringify({ action: "closed" });
    expect(verifyGithubSignature(payload, sign(payload, "wrong-secret"), "test-secret")).toBe(
      false
    );
  });

  it("returns false when the payload doesn't match the signature", () => {
    const secret = "test-secret";
    const signature = sign(JSON.stringify({ action: "closed" }), secret);
    expect(
      verifyGithubSignature(JSON.stringify({ action: "reopened" }), signature, secret)
    ).toBe(false);
  });

  it("returns false when the signature header is missing", () => {
    expect(verifyGithubSignature("{}", null, "test-secret")).toBe(false);
  });
});
