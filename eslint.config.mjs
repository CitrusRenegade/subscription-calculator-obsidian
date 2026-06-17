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
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
]);
