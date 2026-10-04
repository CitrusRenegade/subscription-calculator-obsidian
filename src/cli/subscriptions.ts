import type { CliData, Plugin } from "obsidian";
import { createBackup } from "../data/backup";
import type { SubscriptionStore } from "../data/SubscriptionStore";
import { DataBackedCurrencyRegistry, type CurrencyRegistry } from "../money/CurrencyRegistry";
import type { SubscriptionViewItem } from "../types";

class QueryError extends Error {
  constructor(readonly code: string, message: string, readonly matches?: { id: string; name: string }[]) {
    super(message);
  }
}

function validateFlags(params: CliData, allowed: string[]): void {
  for (const key of Object.keys(params)) {
    if (!allowed.includes(key)) throw new QueryError("INVALID_ARGUMENT", `Unknown parameter: ${key}.`);
    if (!params[key]?.trim()) throw new QueryError("INVALID_ARGUMENT", `${key} must not be empty.`);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function terminalText(value: string): string {
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/gu, " ");
}

function formatList(items: { name: string; id: string }[]): string {
  if (!items.length) return "No subscriptions found.";
  const names = items.map((item) => terminalText(item.name));
  const width = names.reduce((width, name) => Math.max(width, name.length), 4);
  return [
    `${"Name".padEnd(width)}  ID`,
    ...items.map((item, index) => `${names[index].padEnd(width)}  ${terminalText(item.id)}`),
  ].join("\n");
}

function formatDetails(item: SubscriptionViewItem, registry: CurrencyRegistry): string {
  const scale = registry.get(item.price.currencyCode)?.scale;
  const digits = String(item.price.amountMinor).padStart((scale ?? 0) + 1, "0");
  const amount = scale === undefined
    ? `${item.price.amountMinor} minor units`
    : scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  const period = item.billingPeriod === "custom"
    ? `every ${item.customBillingPeriodDays} days`
    : ({ weekly: "weekly", monthly: "monthly", quarterly: "quarterly", yearly: "yearly" })[item.billingPeriod];
  return [
    terminalText(item.name),
    `ID: ${terminalText(item.id)}`,
    `Status: ${item.effectiveStatus}${item.inDisableGracePeriod ? " (pending disable; undo available)" : ""}`,
    `Price: ${amount} ${terminalText(item.price.currencyCode)} (${period})`,
    ...(item.startDate ? [`Start date: ${terminalText(item.startDate)}`] : []),
    ...(item.serviceUrl ? [`URL: ${terminalText(item.serviceUrl)}`] : []),
  ].join("\n");
}

export async function querySubscriptions(
  action: "list" | "get",
  params: CliData,
  store: SubscriptionStore,
  registry: CurrencyRegistry
): Promise<string> {
  try {
    validateFlags(params, action === "list" ? ["status", "currency"] : ["id", "name"]);
    if (action === "get" && Boolean(params.id) === Boolean(params.name)) {
      throw new QueryError("INVALID_ARGUMENT", "Specify either id or name.");
    }
    if (params.status && !["enabled", "disabled"].includes(params.status)) {
      throw new QueryError("INVALID_ARGUMENT", "status must be enabled or disabled.");
    }
    const snapshot = await store.readSnapshot();
    const snapshotRegistry = new DataBackedCurrencyRegistry(
      () => snapshot.data.settings.defaultCurrency,
      () => snapshot.data.customCurrencies,
      registry.list().filter((currency) => currency.source === "builtin")
    );
    if (params.currency && !snapshotRegistry.get(params.currency)) {
      throw new QueryError("INVALID_ARGUMENT", "Unknown currency.");
    }
    const items = snapshot.subscriptions.sort((a, b) =>
      compareText(a.name.toLowerCase(), b.name.toLowerCase()) || compareText(a.id, b.id)
    );
    if (action === "get") {
      const matches = items.filter((item) => params.id
        ? item.id === params.id
        : item.name.toLowerCase() === params.name.trim().toLowerCase());
      if (!matches.length) throw new QueryError("NOT_FOUND", "Subscription not found.");
      if (matches.length > 1) {
        throw new QueryError("AMBIGUOUS_NAME", "Several subscriptions have this name. Specify id.",
          matches.map(({ id, name }) => ({ id, name })));
      }
      return formatDetails(matches[0], snapshotRegistry);
    }
    const filtered = items.filter((item) =>
      (!params.status || item.effectiveStatus === params.status) &&
      (!params.currency || item.price.currencyCode === params.currency.trim().toUpperCase())
    );
    return formatList(filtered);
  } catch (error) {
    const known = error instanceof QueryError;
    const message = known ? terminalText(error.message) : "Unable to read subscriptions.";
    return `Error: ${message}${known && error.matches ? `\n${formatList(error.matches)}` : ""}`;
  }
}

export async function exportBackup(store: SubscriptionStore): Promise<string> {
  const snapshot = await store.readSnapshot();
  // Match UI backups: persisted status, including the still-undoable disable state.
  return JSON.stringify(createBackup(snapshot.data), null, 2);
}

export function registerSubscriptionCli(plugin: Plugin, store: SubscriptionStore, registry: CurrencyRegistry): void {
  plugin.registerCliHandler("subscription-calculator:list", "List subscription names and IDs", {
    status: { description: "enabled or disabled", value: "status" },
    currency: { description: "Currency code", value: "code" },
  }, (params) => querySubscriptions("list", params, store, registry));
  plugin.registerCliHandler("subscription-calculator", "Read a subscription by ID or exact name", {
    id: { description: "Stable subscription ID", value: "id" },
    name: { description: "Exact name, ignoring case", value: "name" },
  }, (params) => querySubscriptions("get", params, store, registry));
  plugin.registerCliHandler("subscription-calculator:export", "Export a restorable JSON backup to stdout", null, (params) => {
    validateFlags(params, []);
    return exportBackup(store);
  });
}
