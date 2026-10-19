// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { getOpenableServiceUrl } from "../src/icons/url";

afterEach(() => vi.unstubAllGlobals());

it("rejects hostname whitespace even when the host URL constructor accepts malformed hosts", () => {
  const NativeUrl = URL;
  vi.stubGlobal("URL", class extends NativeUrl {
    constructor(value: string) {
      super(value.includes("not a url") ? "https://not-a-url/" : value);
    }
  });
  expect(getOpenableServiceUrl("https://not a url")).toBeUndefined();
  expect(getOpenableServiceUrl("not a url")).toBeUndefined();
  expect(getOpenableServiceUrl("https://not%20a%20url")).toBeUndefined();
  expect(getOpenableServiceUrl("https://example.com/a path")).toBe("https://example.com/a%20path");
  expect(getOpenableServiceUrl("example.com")).toBe("https://example.com/");
});
