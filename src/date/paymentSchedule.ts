import type { BillingPeriod, DateOnly } from "../types";
import { isValidDateOnly } from "./dateOnly";

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseCalendarDate(value: DateOnly): CalendarDate {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function formatCalendarDate({ year, month, day }: CalendarDate): DateOnly {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toUtcMilliseconds(value: DateOnly): number {
  const { year, month, day } = parseCalendarDate(value);
  return Date.UTC(year, month - 1, day);
}

function addDays(value: DateOnly, days: number): DateOnly {
  const date = new Date(toUtcMilliseconds(value));
  date.setUTCDate(date.getUTCDate() + days);
  return formatCalendarDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function addMonthsFromAnchor(anchor: DateOnly, months: number): DateOnly {
  const { year, month, day } = parseCalendarDate(anchor);
  const monthIndex = year * 12 + month - 1 + months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = monthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return formatCalendarDate({
    year: targetYear,
    month: targetMonth + 1,
    day: Math.min(day, lastDay),
  });
}

function nextDayBasedPayment(
  startDate: DateOnly,
  today: DateOnly,
  intervalDays: number
): DateOnly {
  if (startDate >= today) return startDate;
  const elapsedDays = Math.floor(
    (toUtcMilliseconds(today) - toUtcMilliseconds(startDate)) / 86_400_000
  );
  return addDays(startDate, Math.ceil(elapsedDays / intervalDays) * intervalDays);
}

function nextMonthBasedPayment(
  startDate: DateOnly,
  today: DateOnly,
  intervalMonths: number
): DateOnly {
  if (startDate >= today) return startDate;
  const start = parseCalendarDate(startDate);
  const current = parseCalendarDate(today);
  const elapsedMonths =
    (current.year - start.year) * 12 + current.month - start.month;
  let intervals = Math.max(0, Math.floor(elapsedMonths / intervalMonths));
  let candidate = addMonthsFromAnchor(startDate, intervals * intervalMonths);
  if (candidate < today) {
    intervals += 1;
    candidate = addMonthsFromAnchor(startDate, intervals * intervalMonths);
  }
  return candidate;
}

export function getNextPaymentDate(
  startDate: DateOnly,
  billingPeriod: BillingPeriod,
  today: DateOnly,
  customBillingPeriodDays?: number
): DateOnly | null {
  if (!isValidDateOnly(startDate) || !isValidDateOnly(today)) return null;

  if (billingPeriod === "weekly") return nextDayBasedPayment(startDate, today, 7);
  if (billingPeriod === "monthly") return nextMonthBasedPayment(startDate, today, 1);
  if (billingPeriod === "quarterly") return nextMonthBasedPayment(startDate, today, 3);
  if (billingPeriod === "yearly") return nextMonthBasedPayment(startDate, today, 12);
  if (!customBillingPeriodDays || customBillingPeriodDays <= 0) return null;
  return nextDayBasedPayment(startDate, today, customBillingPeriodDays);
}

export function getDaysUntil(date: DateOnly, today: DateOnly): number {
  return Math.round((toUtcMilliseconds(date) - toUtcMilliseconds(today)) / 86_400_000);
}

export function formatPaymentCountdown(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
