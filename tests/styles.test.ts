import { Platform } from "obsidian";
import { beforeAll, describe, expect, it } from "vitest";

let styles = "";

async function readStyles(): Promise<string> {
  if (!Platform.isDesktop) {
    throw new Error("Stylesheet tests require the desktop runtime.");
  }

  const { readFileSync } = await import("node:fs");
  return readFileSync(new URL("../styles.css", import.meta.url), "utf8");
}

function declarationsFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m").exec(styles)?.[1] ?? "";
}

describe("subscription layout styles", () => {
  beforeAll(async () => {
    styles = await readStyles();
  });

  it("OBS-36 lets the visible state override both positional transforms", () => {
    expect(
      declarationsFor(
        ".subscription-calculator-summary-overlay .subscription-calculator-summary-floating.is-visible"
      )
    ).toMatch(/transform:\s*translateY\(0\)/);
  });

  it("OBS-37 keeps summary-table names left-sized while card names retain truncation", () => {
    expect(declarationsFor(".subscription-calculator-table-name span")).not.toMatch(
      /flex:\s*1\s+1\s+auto/
    );
    expect(declarationsFor(".subscription-calculator-card-name")).toMatch(
      /text-overflow:\s*ellipsis/
    );
  });

  it("OBS-37 supports measured countdown wrapping without a fixed always-wrap breakpoint", () => {
    expect(styles).toContain(".subscription-calculator-card.is-next-payment-wrapped");
    expect(styles).not.toMatch(
      /@container\s*\(max-width:\s*480px\)[\s\S]*?\.subscription-calculator-next-payment/
    );
  });

  it("OBS-37 reserves visible space after the truncated card name", () => {
    expect(declarationsFor(".subscription-calculator-card-name")).toMatch(
      /margin-inline-end:\s*3px/
    );
  });
});
