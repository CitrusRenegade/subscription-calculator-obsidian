import { describe, expect, it } from "vitest";
import { createToggleSwitch } from "../src/ui/components/FormControls";

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  checked = false;

  createEl(): FakeElement {
    const child = new FakeElement();
    this.children.push(child);
    return child;
  }

  createSpan(): FakeElement {
    const child = new FakeElement();
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(_event: string, _listener: () => void): void {}
}

describe("createToggleSwitch", () => {
  it("labels the checkbox for assistive technology", () => {
    const container = new FakeElement();

    createToggleSwitch(
      container as unknown as HTMLElement,
      true,
      () => undefined,
      "Enable or disable Netflix"
    );

    expect(container.children[0]?.children[0]?.attributes.get("aria-label")).toBe(
      "Enable or disable Netflix"
    );
  });
});
