// Favicons are small local raster images, never remote render-time URLs.
export const MAX_ICON_BYTES = 512 * 1024;
const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon", "image/vnd.microsoft.icon", "image/bmp", "image/avif"]);

export function normalizeImageContentType(value: string): string | null {
  const mime = value.split(";", 1)[0].trim().toLowerCase();
  return imageTypes.has(mime) ? mime : null;
}

export function isLocalImageData(value: string): boolean {
  if (value.length > Math.ceil(MAX_ICON_BYTES / 3) * 4 + 80) return false;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match || !normalizeImageContentType(match[1]) || match[2].length % 4 !== 0) return false;
  const bytes = match[2].length / 4 * 3 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  return bytes > 0 && bytes <= MAX_ICON_BYTES;
}
