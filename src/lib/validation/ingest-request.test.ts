import { describe, expect, it } from "vitest";
import { validateIngestRequestBody } from "./ingest-request";

describe("validateIngestRequestBody", () => {
  const validBody = {
    projectId: "proj-1",
    runName: "CI: main",
    results: [{ title: "test one", status: "passed" }],
  };

  it("accepts a valid body with no prNumber", () => {
    const result = validateIngestRequestBody(validBody);
    expect("data" in result).toBe(true);
  });

  it("accepts a valid body with a positive integer prNumber", () => {
    const result = validateIngestRequestBody({ ...validBody, prNumber: 42 });
    expect("data" in result).toBe(true);
    if ("data" in result) expect(result.data.prNumber).toBe(42);
  });

  it("rejects a non-integer prNumber", () => {
    const result = validateIngestRequestBody({ ...validBody, prNumber: 4.5 });
    expect(result).toEqual({ error: "prNumber must be a positive integer." });
  });

  it("rejects a zero or negative prNumber", () => {
    const result = validateIngestRequestBody({ ...validBody, prNumber: 0 });
    expect(result).toEqual({ error: "prNumber must be a positive integer." });
  });

  it("rejects a missing projectId", () => {
    const { projectId: _projectId, ...rest } = validBody;
    expect(validateIngestRequestBody(rest)).toEqual({ error: "projectId is required." });
  });

  it("rejects an empty results array", () => {
    expect(validateIngestRequestBody({ ...validBody, results: [] })).toEqual({
      error: "results must be a non-empty array.",
    });
  });

  it("rejects a result with an invalid status", () => {
    const result = validateIngestRequestBody({
      ...validBody,
      results: [{ title: "x", status: "unknown" }],
    });
    expect("error" in result).toBe(true);
  });
});
