// Scenario step recorder. Failed expectations produce Failed; unmet environment or
// precondition requirements produce Blocked. Nothing silently downgrades to a pass.

export class StepFailure extends Error {
  constructor(message) {
    super(message);
    this.name = "StepFailure";
  }
}

export class ScenarioBlocked extends Error {
  constructor(message) {
    super(message);
    this.name = "ScenarioBlocked";
  }
}

export class ScenarioTimeout extends Error {
  constructor(message) {
    super(message);
    this.name = "ScenarioTimeout";
  }
}

export function scenarioStatusOf(error) {
  if (error instanceof ScenarioBlocked) return "Blocked";
  if (error instanceof StepFailure) return "Failed";
  if (error instanceof ScenarioTimeout) return "Failed";
  return "Failed";
}

/** Ordered step log for the report; `expect` failures abort the scenario. */
export class Steps {
  constructor() {
    this.entries = [];
  }

  record(name, ok, detail) {
    this.entries.push({ name, ok, detail: detail ?? null });
  }

  /** Run one named step; its result is recorded and rethrown on failure. */
  async do(name, fn) {
    try {
      const detail = await fn();
      this.record(name, true, typeof detail === "object" ? JSON.stringify(detail) : (detail ?? null));
      return detail;
    } catch (error) {
      this.record(name, false, error.message);
      throw error;
    }
  }

  expect(condition, message) {
    if (!condition) throw new StepFailure(message);
  }

  /** Environment/precondition unmet: the scenario cannot even be attempted. */
  block(reason) {
    throw new ScenarioBlocked(reason);
  }
}
