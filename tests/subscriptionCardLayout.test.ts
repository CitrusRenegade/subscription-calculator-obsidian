import { describe, expect, it } from "vitest";
import { getNextPaymentLayout } from "../src/ui/subscriptionCardLayout";

/** The fixed card geometry shared by every layout case. */
const cardGeometry = {
  cardLeft: 10,
  cardTop: 20,
  nameRight: 150,
  actionsLeft: 250,
  actionsTop: 24,
  actionsBottom: 56,
};

describe("getNextPaymentLayout", () => {
  it.each([
    ["keeps the countdown inline and centered in the actual gap when it fits", 80, 150, { wrapped: false, left: 190, top: 20 }],
    ["keeps 3px of clearance on both sides of an inline countdown", 94, 150, { wrapped: false, left: 190, top: 20 }],
    ["wraps when the countdown would violate either 3px clearance", 95, 150, { wrapped: true }],
    ["moves the countdown to its own row only when it collides", 80, 190, { wrapped: true }],
  ] as const)("OBS-37 %s", (_title, countdownWidth, nameRight, expected) => {
    expect(getNextPaymentLayout({ ...cardGeometry, countdownWidth, nameRight })).toEqual(expected);
  });
});
