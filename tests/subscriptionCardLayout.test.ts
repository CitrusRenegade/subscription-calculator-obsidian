import { describe, expect, it } from "vitest";
import { getNextPaymentLayout } from "../src/ui/subscriptionCardLayout";

describe("getNextPaymentLayout", () => {
  it("OBS-37 keeps the countdown inline and centered in the actual gap when it fits", () => {
    expect(
      getNextPaymentLayout({
        cardLeft: 10,
        cardTop: 20,
        nameRight: 150,
        actionsLeft: 250,
        actionsTop: 24,
        actionsBottom: 56,
        countdownWidth: 80,
      })
    ).toEqual({ wrapped: false, left: 190, top: 20 });
  });

  it("OBS-37 keeps 3px of clearance on both sides of an inline countdown", () => {
    expect(
      getNextPaymentLayout({
        cardLeft: 10,
        cardTop: 20,
        nameRight: 150,
        actionsLeft: 250,
        actionsTop: 24,
        actionsBottom: 56,
        countdownWidth: 94,
      })
    ).toEqual({ wrapped: false, left: 190, top: 20 });
  });

  it("OBS-37 wraps when the countdown would violate either 3px clearance", () => {
    expect(
      getNextPaymentLayout({
        cardLeft: 10,
        cardTop: 20,
        nameRight: 150,
        actionsLeft: 250,
        actionsTop: 24,
        actionsBottom: 56,
        countdownWidth: 95,
      })
    ).toEqual({ wrapped: true });
  });

  it("OBS-37 moves the countdown to its own row only when it collides", () => {
    expect(
      getNextPaymentLayout({
        cardLeft: 10,
        cardTop: 20,
        nameRight: 190,
        actionsLeft: 250,
        actionsTop: 24,
        actionsBottom: 56,
        countdownWidth: 80,
      })
    ).toEqual({ wrapped: true });
  });
});
