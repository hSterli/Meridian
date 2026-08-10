export const VALID_RESULT_STATUSES = ["passed", "failed", "blocked", "skipped"] as const;

export interface IngestResultInput {
  title?: string;
  status?: string;
  notes?: string;
}

export interface ValidatedIngestRequest {
  projectId: string;
  runName: string;
  results: IngestResultInput[];
  prNumber?: number;
}

export function validateIngestRequestBody(
  body: unknown
): { data: ValidatedIngestRequest } | { error: string } {
  const { projectId, runName, results, prNumber } = (body ?? {}) as {
    projectId?: string;
    runName?: string;
    results?: IngestResultInput[];
    prNumber?: unknown;
  };

  if (!projectId) return { error: "projectId is required." };
  if (!runName) return { error: "runName is required." };
  if (!Array.isArray(results) || results.length === 0) {
    return { error: "results must be a non-empty array." };
  }

  for (const r of results) {
    if (!r.title) return { error: "Each result requires a title." };
    if (!r.status || !(VALID_RESULT_STATUSES as readonly string[]).includes(r.status)) {
      return {
        error: `Each result's status must be one of: ${VALID_RESULT_STATUSES.join(", ")}`,
      };
    }
  }

  if (prNumber !== undefined) {
    if (typeof prNumber !== "number" || !Number.isInteger(prNumber) || prNumber <= 0) {
      return { error: "prNumber must be a positive integer." };
    }
  }

  return {
    data: {
      projectId,
      runName,
      results,
      prNumber: typeof prNumber === "number" ? prNumber : undefined,
    },
  };
}
