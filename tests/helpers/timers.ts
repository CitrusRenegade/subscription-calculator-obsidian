import { vi } from "vitest";

/** Fake timers with recorded window timer delays; `fire` invokes captured callbacks manually. */
export function useRecordedTimers() {
  vi.useFakeTimers({ now: new Date("2026-06-27T12:00:00Z") });
  // Captured after the fake clock is installed so the stubs delegate to it.
  const clockSetTimeout = setTimeout;
  const clockClearTimeout = clearTimeout;
  const delays: number[] = [];
  const fire: Array<() => void> = [];
  vi.stubGlobal("window", {
    setTimeout: (callback: () => void, delay: number) => {
      delays.push(delay);
      fire.push(() => void callback());
      return clockSetTimeout(callback, delay);
    },
    clearTimeout: (timeoutId: number) => clockClearTimeout(timeoutId),
  });
  return { delays, fire };
}

/** Stub `window` with mock timers that never fire; `record` collects callbacks for manual firing. */
export function stubWindowTimers(record = false) {
  const timerCallbacks: Array<() => void> = [];
  const setTimeout = vi.fn((callback: () => void) => {
    if (record) timerCallbacks.push(callback);
    return record ? timerCallbacks.length : 1;
  });
  const clearTimeout = vi.fn();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  return { setTimeout, clearTimeout, timerCallbacks };
}
