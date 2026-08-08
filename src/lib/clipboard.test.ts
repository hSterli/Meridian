import { describe, expect, it } from "vitest";
import { clipboardItemsToImageFile } from "./clipboard";

describe("clipboardItemsToImageFile", () => {
  it("returns the file from the first image item", () => {
    const imageFile = {} as File;
    const items = [
      { type: "text/plain", getAsFile: () => null },
      { type: "image/png", getAsFile: () => imageFile },
    ];
    expect(clipboardItemsToImageFile(items)).toBe(imageFile);
  });

  it("returns null when no item is an image", () => {
    const items = [
      { type: "text/plain", getAsFile: () => null },
      { type: "text/html", getAsFile: () => null },
    ];
    expect(clipboardItemsToImageFile(items)).toBeNull();
  });

  it("returns null for an empty items array", () => {
    expect(clipboardItemsToImageFile([])).toBeNull();
  });

  it("matches image subtypes generically (png, gif, webp, etc.)", () => {
    const gifFile = {} as File;
    const items = [{ type: "image/gif", getAsFile: () => gifFile }];
    expect(clipboardItemsToImageFile(items)).toBe(gifFile);
  });

  it("skips a null getAsFile result for a matching image item and returns null", () => {
    const items = [{ type: "image/png", getAsFile: () => null }];
    expect(clipboardItemsToImageFile(items)).toBeNull();
  });
});
