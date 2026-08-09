import { describe, expect, it } from "vitest";
import {
  parseCsvLine,
  decodeSteps,
  parseSteps,
  resolveFeatureName,
  parseSprintNumber,
} from "./test-cases-helpers";

describe("parseCsvLine", () => {
  it("splits a simple comma-separated line", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields containing commas", () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(parseCsvLine('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
  });

  it("returns a single field for a line with no commas", () => {
    expect(parseCsvLine("solo")).toEqual(["solo"]);
  });
});

describe("decodeSteps", () => {
  it("returns an empty array for an empty string", () => {
    expect(decodeSteps("")).toEqual([]);
  });

  it("decodes a single step", () => {
    expect(decodeSteps("Click login|User is logged in")).toEqual([
      { step: "Click login", expected: "User is logged in" },
    ]);
  });

  it("decodes multiple steps separated by ;;", () => {
    expect(decodeSteps("Step one|Expected one;;Step two|Expected two")).toEqual([
      { step: "Step one", expected: "Expected one" },
      { step: "Step two", expected: "Expected two" },
    ]);
  });

  it("defaults expected to empty string when missing", () => {
    expect(decodeSteps("Just a step")).toEqual([{ step: "Just a step", expected: "" }]);
  });
});

describe("parseSteps", () => {
  it("parses valid JSON steps", () => {
    const raw = JSON.stringify([{ step: "Do a thing", expected: "It works" }]);
    expect(parseSteps(raw)).toEqual([{ step: "Do a thing", expected: "It works" }]);
  });

  it("defaults expected to empty string when missing from the object", () => {
    const raw = JSON.stringify([{ step: "Do a thing" }]);
    expect(parseSteps(raw)).toEqual([{ step: "Do a thing", expected: "" }]);
  });

  it("filters out entries without a string step field", () => {
    const raw = JSON.stringify([{ step: "Valid" }, { notStep: "Invalid" }, { step: 123 }]);
    expect(parseSteps(raw)).toEqual([{ step: "Valid", expected: "" }]);
  });

  it("returns an empty array for invalid JSON", () => {
    expect(parseSteps("not json")).toEqual([]);
  });

  it("returns an empty array when the JSON isn't an array", () => {
    expect(parseSteps('{"not": "an array"}')).toEqual([]);
  });
});

describe("resolveFeatureName", () => {
  it("returns the selected feature when not the new-feature sentinel", () => {
    const formData = new FormData();
    formData.set("feature", "Checkout");
    expect(resolveFeatureName(formData)).toBe("Checkout");
  });

  it("returns the trimmed newFeature value when the sentinel is selected", () => {
    const formData = new FormData();
    formData.set("feature", "__new__");
    formData.set("newFeature", "  Payments  ");
    expect(resolveFeatureName(formData)).toBe("Payments");
  });

  it("returns an empty string when nothing is selected", () => {
    const formData = new FormData();
    expect(resolveFeatureName(formData)).toBe("");
  });
});

describe("parseSprintNumber", () => {
  it("parses a valid non-negative integer", () => {
    const formData = new FormData();
    formData.set("sprintNumber", "14");
    expect(parseSprintNumber(formData)).toBe(14);
  });

  it("returns null for an empty value", () => {
    const formData = new FormData();
    formData.set("sprintNumber", "");
    expect(parseSprintNumber(formData)).toBeNull();
  });

  it("returns null when the field is missing entirely", () => {
    const formData = new FormData();
    expect(parseSprintNumber(formData)).toBeNull();
  });

  it("returns null for a negative number", () => {
    const formData = new FormData();
    formData.set("sprintNumber", "-1");
    expect(parseSprintNumber(formData)).toBeNull();
  });

  it("returns null for a non-numeric value", () => {
    const formData = new FormData();
    formData.set("sprintNumber", "abc");
    expect(parseSprintNumber(formData)).toBeNull();
  });
});
