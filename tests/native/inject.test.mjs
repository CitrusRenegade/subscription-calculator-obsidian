// Regression tests for the test-only save gate in lib/inject.mjs.
// The page probes run in-process against a fake CDP page and stubbed
// `app`/`window` globals, so the gate's instance-ownership contract is
// verified without a live Obsidian renderer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { SaveGate } from "./lib/inject.mjs";

const PLUGIN_ID = "subscription-calculator";

const fakePage = () => ({ evaluate: (probe, arg) => Promise.resolve(probe(arg)) });

const makeOwnPlugin = () => {
  const original = vi.fn(async () => "saved");
  return { instance: { savePluginData: original }, original };
};

const makeProtoPlugin = () => {
  class Prototype {
    async savePluginData() {
      return "saved";
    }
  }
  return { instance: new Prototype(), original: Prototype.prototype.savePluginData };
};

const setPlugin = (instance) => {
  globalThis.app.plugins.plugins[PLUGIN_ID] = instance;
};

const stubEnvironment = () => {
  globalThis.window = new JSDOM("").window;
  globalThis.app = { plugins: { plugins: {} } };
};

afterEach(() => {
  delete globalThis.window;
  delete globalThis.app;
});

describe("save gate ownership", () => {
  it("restores an own savePluginData descriptor on the owning instance", async () => {
    stubEnvironment();
    const { instance, original } = makeOwnPlugin();
    setPlugin(instance);
    const gate = new SaveGate(fakePage());
    await gate.install("pass");
    expect(instance.savePluginData).not.toBe(original);
    await expect(instance.savePluginData()).resolves.toBe("saved");
    await expect(gate.uninstall()).resolves.toMatchObject({ ok: true, calls: 1 });
    expect(instance.savePluginData).toBe(original);
    expect(Object.hasOwn(instance, "savePluginData")).toBe(true);
    expect(globalThis.window.__subcalcSmokeGate).toBeUndefined();
  });

  it("removes the own wrapper when the original was inherited", async () => {
    stubEnvironment();
    const { instance, original } = makeProtoPlugin();
    setPlugin(instance);
    const gate = new SaveGate(fakePage());
    await gate.install("pass");
    expect(Object.hasOwn(instance, "savePluginData")).toBe(true);
    await gate.uninstall();
    expect(Object.hasOwn(instance, "savePluginData")).toBe(false);
    expect(instance.savePluginData).toBe(original);
  });

  it("restores the original on the owner after a reload and reports the mismatch", async () => {
    stubEnvironment();
    const first = makeOwnPlugin();
    setPlugin(first.instance);
    const gate = new SaveGate(fakePage());
    await gate.install("pass");
    const reloaded = makeProtoPlugin();
    setPlugin(reloaded.instance);
    await expect(gate.uninstall()).resolves.toMatchObject({ ok: true, instanceChanged: true });
    expect(first.instance.savePluginData).toBe(first.original);
    expect(Object.hasOwn(first.instance, "savePluginData")).toBe(true);
    expect(Object.hasOwn(reloaded.instance, "savePluginData")).toBe(false);
    expect(reloaded.instance.savePluginData).toBe(reloaded.original);
    expect(globalThis.window.__subcalcSmokeGate).toBeUndefined();
  });

  it("does not overwrite an unrelated replacement on the owner", async () => {
    stubEnvironment();
    const { instance } = makeOwnPlugin();
    setPlugin(instance);
    const gate = new SaveGate(fakePage());
    await gate.install("pass");
    const foreign = async () => "foreign";
    instance.savePluginData = foreign;
    await expect(gate.uninstall()).rejects.toThrow(/wrapper/i);
    expect(instance.savePluginData).toBe(foreign);
    expect(globalThis.window.__subcalcSmokeGate).toBeUndefined();
  });

  it("rejects stale gate state that belongs to another instance", async () => {
    stubEnvironment();
    const first = makeOwnPlugin();
    setPlugin(first.instance);
    const gate = new SaveGate(fakePage());
    await gate.install("pass");
    // The true owner still short-circuits a second install.
    await expect(new SaveGate(fakePage()).install("hold")).resolves.toBeUndefined();
    const reloaded = makeOwnPlugin();
    setPlugin(reloaded.instance);
    await expect(new SaveGate(fakePage()).install("hold")).rejects.toThrow(/stale/i);
    // Cleanup still restores the true owner and reports the registry mismatch.
    await expect(gate.uninstall()).resolves.toMatchObject({ ok: true, instanceChanged: true });
    expect(first.instance.savePluginData).toBe(first.original);
    expect(reloaded.instance.savePluginData).toBe(reloaded.original);
  });

  it("rejects a same-owner install whose wrapper was replaced", async () => {
    stubEnvironment();
    const { instance } = makeOwnPlugin();
    setPlugin(instance);
    const gate = new SaveGate(fakePage());
    await gate.install("pass");
    const foreign = async () => "foreign";
    instance.savePluginData = foreign;
    await expect(new SaveGate(fakePage()).install("hold")).rejects.toThrow(/wrapper/i);
    expect(instance.savePluginData).toBe(foreign);
  });

  it("surfaces a page.evaluate rejection and allows a retry to succeed", async () => {
    stubEnvironment();
    const { instance } = makeOwnPlugin();
    setPlugin(instance);
    const gate = new SaveGate(fakePage());
    await gate.install("pass");
    gate.page = { evaluate: () => Promise.reject(new Error("page closed")) };
    await expect(gate.uninstall()).rejects.toThrow(/page closed/);
    expect(gate.installed).toBe(true);
    gate.page = fakePage();
    await expect(gate.uninstall()).resolves.toMatchObject({ ok: true });
    expect(gate.installed).toBe(false);
  });

  it("keeps hold mode deferring the underlying save until release", async () => {
    stubEnvironment();
    const { instance } = makeOwnPlugin();
    setPlugin(instance);
    const gate = new SaveGate(fakePage());
    await gate.install("hold");
    let settled = false;
    const savePromise = instance.savePluginData().then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(false);
    await gate.releaseAll();
    await expect(savePromise).resolves.toBe("saved");
    await gate.uninstall();
  });
});
