export function normalizeUrlInput(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    return new URL(withProtocol).toString();
  } catch {
    return trimmed;
  }
}

export function getOpenableServiceUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return undefined;

  const normalized = scheme ? trimmed : `https://${trimmed}`;
  // Obsidian's host parser can encode an invalid hostname instead of rejecting it.
  // Check the original authority before normalization; spaces in a path are valid.
  const authority = /^https?:\/\/([^/?#]*)/i.exec(normalized)?.[1] ?? normalized.split(/[/?#]/)[0];
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  const invalidHostWhitespace = /\s|%(?:0[0-9a-f]|1[0-9a-f]|20|7f)/i;
  if (invalidHostWhitespace.test(host)) return undefined;

  try {
    const url = new URL(normalized);
    return url.hostname && !invalidHostWhitespace.test(url.hostname) &&
      (url.protocol === "http:" || url.protocol === "https:")
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function getDomainFromUrl(value: string | undefined): string | null {
  const normalized = normalizeUrlInput(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}
