// Test-only runtime instrumentation injected into the live page over CDP.
// It never touches production sources or the built bundle: wrappers are installed
// on the loaded plugin instance and always removed in cleanup. Restores touch
// only the owning instance; a reloaded plugin or an unrelated replacement is
// reported, never overwritten.
//
// The store calls its injected save callback as `() => plugin.savePluginData()`,
// so wrapping the instance method observes every persisted save. "hold" mode
// defers the store's await until the suite releases it, giving delayed-operation
// scenarios an explicit completion signal instead of guessed sleeps.
//
// Date injection changes the observed day while leaving timer APIs running.
// The self-contained shim is reversible across repeated runs without installing
// Playwright's broader clock instrumentation on the shared renderer.
//
// This module's page probes are callback functions, including argument handling.
// The observed `app` warnings are
// inherent to test probes and documented in tests/README.md.
import { setTimeout as sleep } from "node:timers/promises";

const installGate = (mode) => {
  const plugin = app.plugins.plugins["subscription-calculator"];
  if (!plugin) return { ok: false, error: "plugin not loaded" };
  const existing = window.__subcalcSmokeGate;
  if (existing) {
    if (existing.plugin !== plugin) {
      return {
        ok: false,
        error: "stale save gate state belongs to a different plugin instance; restore or restart before installing",
      };
    }
    if (plugin.savePluginData !== existing.wrapper) {
      return {
        ok: false,
        error: "save gate state matches this instance but its wrapper was replaced; restore before installing",
      };
    }
    return { ok: true, already: true };
  }
  if (typeof plugin.savePluginData !== "function") {
    return { ok: false, error: "plugin has no savePluginData method to gate" };
  }
  const state = {
    installed: true,
    plugin,
    wrapper: null,
    original: plugin.savePluginData,
    originalDescriptor: Object.getOwnPropertyDescriptor(plugin, "savePluginData"),
    mode,
    calls: 0,
    inflight: 0,
    pending: [],
  };
  const wrapper = function (...args) {
    state.calls += 1;
    state.inflight += 1;
    const underlying = Promise.resolve(state.original.apply(this, args)).finally(() => {
      state.inflight -= 1;
    });
    if (state.mode !== "hold") return underlying;
    return new Promise((resolve, reject) => {
      let released = false;
      state.pending.push(() => {
        if (released) return;
        released = true;
        underlying.then(resolve, reject);
      });
    });
  };
  state.wrapper = wrapper;
  plugin.savePluginData = wrapper;
  window.__subcalcSmokeGate = state;
  return { ok: true };
};

const uninstallGate = () => {
  const state = window.__subcalcSmokeGate;
  if (!state) return { ok: true, already: true };
  for (const release of state.pending.splice(0)) release();
  const plugin = app.plugins.plugins["subscription-calculator"];
  const owner = state.plugin;
  const result = { calls: state.calls };
  let failure = null;
  if (!owner) {
    failure = "save gate state has no owner instance recorded";
  } else {
    const onOwner = Object.getOwnPropertyDescriptor(owner, "savePluginData");
    if (onOwner && onOwner.value === state.wrapper) {
      if (state.originalDescriptor) Object.defineProperty(owner, "savePluginData", state.originalDescriptor);
      else delete owner.savePluginData;
    } else {
      failure = "the gate's wrapper is no longer installed on its owner; an unrelated value is left untouched";
    }
  }
  if (!failure && plugin !== owner) {
    result.instanceChanged = true;
    result.note = plugin
      ? "plugin registry names a different instance; original restored on the owning instance only, new instance untouched"
      : "plugin registry entry is gone; original restored on the owning instance only";
  }
  const finalResult = failure ? { ...result, ok: false, error: failure } : { ...result, ok: true };
  delete window.__subcalcSmokeGate;
  return finalResult;
};

// Minimal reversible Date-only injection. The original Date is backed up; a subclass
// serves the injected instant for `new Date()` and `Date.now()` while argumented
// construction and all statics keep native behavior.
const installFixedDateProbe = (injectedMs) => {
  if (window.__subcalcSmokeDateBackup) {
    return { ok: false, error: "a previous Date injection was never restored" };
  }
  const OriginalDate = window.Date;
  class SmokeDate extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) super(injectedMs);
      else super(...args);
    }
    static now() {
      return injectedMs;
    }
  }
  SmokeDate.parse = OriginalDate.parse;
  SmokeDate.UTC = OriginalDate.UTC;
  window.Date = SmokeDate;
  window.__subcalcSmokeDateBackup = { original: OriginalDate, injectedMs };
  return { ok: true };
};

const restoreRealDateProbe = () => {
  const backup = window.__subcalcSmokeDateBackup;
  if (!backup) return { ok: false, error: "no Date injection backup exists; nothing to restore" };
  window.Date = backup.original;
  const mismatches = [];
  if (window.Date !== backup.original) mismatches.push("Date");
  if (typeof Date.now() !== "number") mismatches.push("Date.now");
  const now = new window.Date();
  if (Number.isNaN(now.getTime())) mismatches.push("new Date()");
  delete window.__subcalcSmokeDateBackup;
  return mismatches.length ? { ok: false, error: `identities still replaced: ${mismatches.join(", ")}` } : { ok: true };
};

export class SaveGate {
  constructor(page, log = () => {}) {
    this.page = page;
    this.log = log;
    this.installed = false;
  }

  async install(mode = "pass") {
    const result = await this.page.evaluate(installGate, mode);
    if (!result.ok) throw new Error(`Cannot install save gate: ${result.error}`);
    this.installed = true;
    this.log(`save gate installed (mode: ${mode})`);
  }

  async calls() {
    if (!this.installed) return 0;
    return this.page.evaluate(() => window.__subcalcSmokeGate?.calls ?? 0);
  }

  /** Explicit completion signal: bounded wait until the store attempted N saves. */
  async waitForCalls(count, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const calls = await this.calls();
      if (calls >= count) return calls;
      if (Date.now() > deadline) {
        throw new Error(`save gate recorded ${calls} calls, expected >= ${count} within ${timeoutMs}ms`);
      }
      await sleep(100);
    }
  }

  async setMode(mode) {
    if (!this.installed) return;
    await this.page.evaluate((value) => {
      window.__subcalcSmokeGate.mode = value;
    }, mode);
  }

  async releaseAll() {
    if (!this.installed) return;
    await this.page.evaluate(() => {
      const state = window.__subcalcSmokeGate;
      for (const release of state.pending.splice(0)) release();
      state.mode = "pass";
    });
  }

  /** Bounded wait until every released underlying save has settled. */
  async awaitSettlement(timeoutMs = 8000) {
    if (!this.installed) return;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const inflight = await this.page.evaluate(() => window.__subcalcSmokeGate?.inflight ?? 0).catch(() => 0);
      if (inflight === 0) return;
      if (Date.now() > deadline) {
        const callsNow = await this.calls();
        throw new Error(`save gate still has ${inflight} in-flight save(s) after ${timeoutMs}ms (calls=${callsNow})`);
      }
      await sleep(100);
    }
  }

  /** Throws on failed restore; the gate stays installed so cleanup can retry. */
  async uninstall() {
    if (!this.installed) return;
    const result = await this.page.evaluate(uninstallGate).catch((error) => ({ ok: false, error: String(error) }));
    this.log(`save gate uninstalled (${JSON.stringify(result)})`);
    if (!result.ok) throw new Error(`save gate uninstall failed: ${result.error}`);
    this.installed = false;
    return result;
  }
}

/** Install the reversible fixed-Date shim; repeat-safe on the same page. */
export async function installFixedDate(page, injectedMs) {
  return page.evaluate(installFixedDateProbe, injectedMs).catch((error) => ({ ok: false, error: String(error) }));
}

/** Restore the original Date and verify the identity/behavior is genuinely back. */
export async function restoreRealDate(page) {
  if (page.isClosed?.()) return { ok: false, error: "page closed" };
  return page.evaluate(restoreRealDateProbe).catch((error) => ({ ok: false, error: String(error) }));
}
