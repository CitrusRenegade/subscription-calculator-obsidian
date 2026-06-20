import { describe, expect, it } from "vitest";
import {
  formatPaymentCountdown,
  getDaysUntil,
  getNextPaymentDate,
} from "../src/date/paymentSchedule";

describe("payment schedule", () => {
  it("finds the next weekly and custom payments", () => {
    expect(getNextPaymentDate("2026-06-01", "weekly", "2026-06-20")).toBe("2026-06-22");
    expect(getNextPaymentDate("2026-06-01", "custom", "2026-06-20", 10)).toBe("2026-06-21");
  });

  it("preserves the original monthly anchor after a short month", () => {
    expect(getNextPaymentDate("2026-01-31", "monthly", "2026-02-20")).toBe("2026-02-28");
    expect(getNextPaymentDate("2026-01-31", "monthly", "2026-03-01")).toBe("2026-03-31");
  });

  it("supports quarterly and leap-day yearly schedules", () => {
    expect(getNextPaymentDate("2026-01-31", "quarterly", "2026-04-01")).toBe("2026-04-30");
    expect(getNextPaymentDate("2024-02-29", "yearly", "2026-01-01")).toBe("2026-02-28");
  });

  it("includes a payment due today", () => {
    expect(getNextPaymentDate("2026-06-01", "monthly", "2026-07-01")).toBe("2026-07-01");
  });

  it("formats relative countdown labels", () => {
    expect(getDaysUntil("2026-06-25", "2026-06-20")).toBe(5);
    expect(formatPaymentCountdown(0)).toBe("today");
    expect(formatPaymentCountdown(1)).toBe("tomorrow");
    expect(formatPaymentCountdown(5)).toBe("in 5 days");
  });
});
