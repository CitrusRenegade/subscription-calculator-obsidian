import { describe, expect, it } from "vitest";
import { formatLocalDate, isValidDateOnly, parseDateOnly, todayLocalDate } from "../src/date/dateOnly";

describe("dateOnly helpers", () => {
  it("formats dates with local calendar fields", () => {
    expect(formatLocalDate(new Date(2026, 5, 16))).toBe("2026-06-16");
  });

  it("validates real calendar dates", () => {
    expect(isValidDateOnly("2026-02-28")).toBe(true);
    expect(isValidDateOnly("2026-02-31")).toBe(false);
    expect(parseDateOnly("not-a-date")).toBeNull();
  });

  it("uses the provided clock for today", () => {
    expect(todayLocalDate({ now: () => new Date(2026, 5, 16) })).toBe("2026-06-16");
  });
});

