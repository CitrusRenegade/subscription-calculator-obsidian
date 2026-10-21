import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { Fixtures } from "./lib/fixtures.mjs";
import { ScenarioBlocked } from "./lib/steps.mjs";
import { getReadinessProblems } from "./lib/readiness.mjs";

const readyBackgroundWindow = {
  native: { visible: true, minimized: false, focused: false },
  renderer: { visible: true, rafAlive: true },
};

describe("native smoke readiness", () => {
  it("allows a visible, painting renderer when another app owns native foreground focus", () => {
    expect(getReadinessProblems(readyBackgroundWindow)).toEqual([]);
  });

  it.each([
    ["hidden native window", { native: { visible: false, minimized: false }, renderer: { visible: true, rafAlive: true } }],
    ["minimized native window", { native: { visible: true, minimized: true }, renderer: { visible: true, rafAlive: true } }],
    ["hidden renderer", { native: { visible: true, minimized: false }, renderer: { visible: false, rafAlive: true } }],
    ["non-painting renderer", { native: { visible: true, minimized: false }, renderer: { visible: true, rafAlive: false } }],
  ])("blocks a %s", (_description, state) => {
    expect(getReadinessProblems(state)).not.toEqual([]);
  });

  it("still reports Blocked when a modal fails to focus its expected input", async () => {
    const document = new JSDOM('<div id="modal"><button>Cancel</button></div>').window.document;
    const modal = document.querySelector("#modal");
    modal.querySelector("button").focus();
    const locator = { evaluate: (probe, expected) => probe(modal, expected) };

    await expect(
      Fixtures.prototype.expectInitialFocus.call({}, locator, "Name", "Add dialog")
    ).rejects.toBeInstanceOf(ScenarioBlocked);
  });
});

describe("requested placement gating", () => {
  it("blocks the scenario when requested placement did not complete", () => {
    const problems = getReadinessProblems({
      ...readyBackgroundWindow,
      placement: { requested: true, established: false },
    });
    expect(problems.some((problem) => problem.includes("placement"))).toBe(true);
  });

  it("does not require placement for a --skip-place run", () => {
    expect(
      getReadinessProblems({
        ...readyBackgroundWindow,
        placement: { requested: false, established: false },
      })
    ).toEqual([]);
  });

  it("accepts an established requested placement", () => {
    expect(
      getReadinessProblems({
        ...readyBackgroundWindow,
        placement: { requested: true, established: true },
      })
    ).toEqual([]);
  });

  it("still allows a background window without OS foreground focus", () => {
    expect(
      getReadinessProblems({
        ...readyBackgroundWindow,
        placement: { requested: true, established: true },
        native: { visible: true, minimized: false, focused: false },
      })
    ).toEqual([]);
  });
});
