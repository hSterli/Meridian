import type { TestStep } from "@/lib/types/database";

export function parseSteps(raw: string): TestStep[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.step === "string")
      .map((s) => ({ step: s.step, expected: s.expected ?? "" }));
  } catch {
    return [];
  }
}

/** Resolves the "feature" form field: the `newFeature` text wins when the
 * `feature` select is set to the "add new" sentinel, otherwise the selected
 * existing feature name is used. */
export function resolveFeatureName(formData: FormData): string {
  const selected = String(formData.get("feature") ?? "");
  if (selected === "__new__") {
    return String(formData.get("newFeature") ?? "").trim();
  }
  return selected.trim();
}

export function parseSprintNumber(formData: FormData): number | null {
  const raw = String(formData.get("sprintNumber") ?? "").trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export function decodeSteps(raw: string): TestStep[] {
  if (!raw) return [];
  return raw
    .split(";;")
    .filter(Boolean)
    .map((chunk) => {
      const [step, expected = ""] = chunk.split("|");
      return { step: step ?? "", expected };
    });
}
