import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Generic HMAC-SHA256 webhook signature check. Source-specific integrations
 * (CI ingestion, Jira/GitHub sync — separate, later projects) will each
 * bring their own secret storage and possibly their own signature scheme;
 * this is the shared-secret placeholder that proves the receive-and-store
 * pipeline end-to-end for this pass. Uses a constant-time comparison so
 * response timing can't be used to guess the correct signature byte by byte.
 */
export function isValidWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;

  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");

  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
