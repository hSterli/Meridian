export interface ClipboardImageItem {
  type: string;
  getAsFile: () => File | null;
}

export function clipboardItemsToImageFile(items: ClipboardImageItem[]): File | null {
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}
