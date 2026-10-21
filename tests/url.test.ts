import { describe, expect, it } from "vitest";
import { getOpenableServiceUrl, normalizeUrlInput } from "../src/icons/url";

describe("openable service URLs", () => {
  it.each([
    ["an empty value", "", undefined],
    ["a malformed URL", "not a url", undefined],
    ["a bare host", "example.com", "https://example.com/"],
    ["an HTTP URL", "http://example.com/path", "http://example.com/path"],
    ["an HTTPS URL", "https://example.com/path", "https://example.com/path"],
    ["a non-HTTP(S) URL", "ftp://example.com", undefined],
    ["a mailto URL", "mailto:hello@example.com", undefined],
  ])("returns an openable URL for %s", (description, input, expected) => {
    expect(getOpenableServiceUrl(input)).toBe(expected);
  });
  it("returns stable results for repeated, alternating and undefined inputs", () => {
    expect(getOpenableServiceUrl("example.com")).toBe("https://example.com/");
    expect(getOpenableServiceUrl("example.com/path")).toBe("https://example.com/path");
    expect(getOpenableServiceUrl("example.com")).toBe("https://example.com/");
    expect(getOpenableServiceUrl(undefined)).toBeUndefined();
    expect(getOpenableServiceUrl(undefined)).toBeUndefined();
    expect(getOpenableServiceUrl("bad host with space")).toBeUndefined();
    expect(getOpenableServiceUrl("example.com")).toBe("https://example.com/");
    expect(normalizeUrlInput("example.com")).toBe("https://example.com/");
    expect(normalizeUrlInput("example.com:443")).toBe("https://example.com/");
  });
});
