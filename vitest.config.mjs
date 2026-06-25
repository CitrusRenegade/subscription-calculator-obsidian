import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: new URL("./tests/obsidianMock.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
  },
});
