import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.eslint.json" },
    },
    rules: {
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          enforceCamelCaseLower: true,
          ignoreRegex: ["^ChatGPT$", "^Google S2$", "^https?://"],
        },
      ],
    },
  },
  {
    files: ["tests/versionBump.test.ts"],
    languageOptions: {
      globals: { process: "readonly" },
    },
    rules: {
      "obsidianmd/no-nodejs-modules": "off",
    },
  },
  {
    files: ["src/settings/SubscriptionSettingTab.ts"],
    rules: {
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
    },
  },
  {
    files: ["tests/SubscriptionSettingTab.test.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
]);
