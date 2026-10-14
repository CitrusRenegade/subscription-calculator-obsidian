import type { CliData, CliFlags, Plugin } from "obsidian";
import { createBackup } from "../data/backup";
import type { SubscriptionStore } from "../data/SubscriptionStore";
import { DataBackedCurrencyRegistry, type CurrencyRegistry } from "../money/CurrencyRegistry";
import { StoreCommandError } from "../data/subscriptionCommands";
import { getCurrencySelectLabel } from "../money/currencyDisplay";
import { minorToDecimal } from "../money/formatMoney";
import { calculateTotalsByCurrency } from "../money/totals";
import type { BillingPeriod, CurrencyMeta, PluginData, SubscriptionCommandResult, SubscriptionCreateCommand, SubscriptionItem, SubscriptionSetCommand, SubscriptionStatus, SubscriptionViewItem } from "../types";

class QueryError extends Error {
  constructor(readonly code: string, message: string, readonly matches?: { id: string; name: string }[], readonly field?: string) {
    super(message);
  }
}

function validateFlags(params: CliData, allowed: string[]): void {
  for (const key of Object.keys(params)) {
    if (!allowed.includes(key)) throw new QueryError("INVALID_ARGUMENT", `Unknown parameter: ${key}.`);
    if (typeof params[key] !== "string" || !params[key].trim()) throw new QueryError("INVALID_ARGUMENT", `${key} must not be empty.`, undefined, key);
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

function periodLabel(item: Pick<SubscriptionItem, "billingPeriod" | "customBillingPeriodDays">): string {
  if (item.billingPeriod === "custom") {
    return `every ${item.customBillingPeriodDays} days`;
  }
  return item.billingPeriod;
}

function formatDetails(item: SubscriptionViewItem, registry: CurrencyRegistry): string {
  // requireScale already validated this currency, so the scale always resolves.
  const amount = minorToDecimal(item.price.amountMinor, requireScale(registry, item.price.currencyCode));
  const period = periodLabel(item);
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
  return runCommand(action, params, async () => {
    validateFlags(params, action === "list" ? ["status", "currency", "format"] : ["id", "name", "format"]);
    if (action === "get" && Boolean(params.id) === Boolean(params.name)) {
      throw new QueryError("INVALID_ARGUMENT", "Specify either id or name.");
    }
    if (params.status && !["enabled", "disabled"].includes(params.status)) {
      throw new QueryError("INVALID_ARGUMENT", "status must be enabled or disabled.");
    }
    const snapshot = await store.readSnapshot();
    const { registry: snapshotRegistry } = readRegistry(snapshot, registry);
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
      return { data: viewItemDto(matches[0], requireScale(snapshotRegistry, matches[0].price.currencyCode)), text: formatDetails(matches[0], snapshotRegistry) };
    }
    const filtered = items.filter((item) =>
      (!params.status || item.effectiveStatus === params.status) &&
      (!params.currency || item.price.currencyCode === params.currency.trim().toUpperCase())
    );
    return { data: { subscriptions: filtered.map((item) => viewItemDto(item, requireScale(snapshotRegistry, item.price.currencyCode))) }, text: formatList(filtered) };
  });
}

function exactAmount(amountMinor: number, scale: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !Number.isInteger(scale) || scale < 0 || scale > 8) {
    throw new QueryError("VALIDATION_FAILED", "Amount cannot be represented safely.", undefined, "price");
  }
  return minorToDecimal(amountMinor, scale);
}

function requireScale(registry: CurrencyRegistry, code: string): number {
  const meta = registry.get(code);
  if (!meta) throw new QueryError("VALIDATION_FAILED", "Unknown currency.", undefined, "currency");
  return meta.scale;
}

/** Snapshot-backed read registry plus the builtin slice reused by the currencies listing. */
function readRegistry(
  snapshot: { data: PluginData },
  registry: CurrencyRegistry
): { registry: DataBackedCurrencyRegistry; builtins: CurrencyMeta[] } {
  const builtins = registry.list().filter((currency) => currency.source === "builtin");
  return {
    builtins,
    registry: new DataBackedCurrencyRegistry(
      () => snapshot.data.settings.defaultCurrency,
      () => snapshot.data.customCurrencies,
      builtins
    ),
  };
}

/** The shared DTO shape; every caller states its status fields explicitly. */
function subscriptionDto(item: SubscriptionItem, scale: number, id: string | null,
  effectiveStatus: SubscriptionStatus, pending: boolean) {
  return { id, name: item.name, status: item.status, effectiveStatus, inDisableGracePeriod: pending,
    price: { decimal: exactAmount(item.price.amountMinor, scale), amountMinor: item.price.amountMinor, currencyCode: item.price.currencyCode, scale },
    period: item.billingPeriod, days: item.customBillingPeriodDays ?? null, startDate: item.startDate ?? null,
    url: item.serviceUrl ?? null, createdOn: item.createdOn, updatedOn: item.updatedOn, disabledOn: item.disabledOn ?? null };
}

/** Read DTO: snapshot view items carry their runtime status fields. */
function viewItemDto(item: SubscriptionViewItem, scale: number) {
  return subscriptionDto(item, scale, item.id, item.effectiveStatus, item.inDisableGracePeriod);
}

/** Write DTO: a command result carries the detached status fields for its own item. */
function commandResultDto(result: SubscriptionCommandResult) {
  return subscriptionDto(result.item, result.currencyScale, result.id, result.effectiveStatus, result.statusPending);
}

async function runCommand(command: string, params: CliData, operation: () => Promise<{ data: unknown; text: string }>): Promise<string> {
  const json = params.format === "json";
  try {
    if (params.format !== undefined && params.format !== "text" && !json) {
      throw new QueryError("INVALID_ARGUMENT", "format must be text or json.", undefined, "format");
    }
    const result = await operation();
    return json ? JSON.stringify({ apiVersion: 1, ok: true, command, data: result.data, warnings: [] }) : result.text;
  } catch (error) {
    const known = error instanceof QueryError || error instanceof StoreCommandError;
    if (!known || (error instanceof StoreCommandError && ["INTERNAL_ERROR", "SAVE_FAILED"].includes(error.code))) {
      console.error(`Subscription CLI ${command} failed:`, error);
    }
    const message = known ? error.message : "Unable to complete subscription command.";
    const matches = error instanceof QueryError ? error.matches : undefined;
    const detail = { code: known ? error.code : "INTERNAL_ERROR", message,
      ...(known && error.field ? { field: error.field } : {}), ...(matches ? { matches } : {}) };
    return json ? JSON.stringify({ apiVersion: 1, ok: false, command, error: detail, warnings: [] })
      : `Error: ${terminalText(message)}${matches ? `\n${formatList(matches)}` : ""}`;
  }
}

const writeFields = ["name", "price", "currency", "period", "days", "start-date", "url", "status"];

function assertCommonHumanFields(params: CliData): void {
  if (params.days !== undefined && (!/^\d+$/.test(params.days) || !Number.isSafeInteger(Number(params.days)))) {
    throw new QueryError("INVALID_ARGUMENT", "days must be a positive whole number.", undefined, "days");
  }
  for (const flag of ["dry-run", "clear-url", "clear-start-date"]) {
    if (params[flag] !== undefined && params[flag] !== "true") throw new QueryError("INVALID_ARGUMENT", `${flag} must be a bare switch.`, undefined, flag);
  }
}

function humanOptionalChanges(params: CliData) {
  return {
    ...(params.currency !== undefined ? { currencyCode: params.currency } : {}),
    ...(params.period !== undefined ? { billingPeriod: params.period as BillingPeriod } : {}),
    ...(params.days !== undefined ? { customBillingPeriodDays: Number(params.days) } : {}),
    ...(params["start-date"] !== undefined ? { startDate: params["start-date"] } : {}),
    ...(params.url !== undefined ? { serviceUrl: params.url } : {}),
    ...(params.status !== undefined ? { status: params.status as SubscriptionStatus } : {}),
  };
}

function humanCreateChanges(params: CliData): SubscriptionCreateCommand {
  assertCommonHumanFields(params);
  if (params.name === undefined) throw new QueryError("INVALID_ARGUMENT", "name is required.", undefined, "name");
  if (params.price === undefined) throw new QueryError("INVALID_ARGUMENT", "price is required.", undefined, "price");
  return { name: params.name, priceText: params.price, ...humanOptionalChanges(params) };
}

function humanSetChanges(params: CliData): SubscriptionSetCommand {
  assertCommonHumanFields(params);
  return { ...(params.name !== undefined ? { name: params.name } : {}),
    ...(params.price !== undefined ? { priceText: params.price } : {}),
    ...humanOptionalChanges(params),
    ...(params["clear-url"] !== undefined ? { clearServiceUrl: true } : {}),
    ...(params["clear-start-date"] !== undefined ? { clearStartDate: true } : {}) };
}

async function writeSubscription(action: "new" | "set", params: CliData, store: SubscriptionStore): Promise<string> {
  return runCommand(action, params, async () => {
    validateFlags(params, [...writeFields, "format", "dry-run", ...(action === "set" ? ["id", "clear-url", "clear-start-date"] : [])]);
    let result: SubscriptionCommandResult;
    const options = { dryRun: params["dry-run"] === "true" };
    if (action === "new") {
      result = await store.createSubscription(humanCreateChanges(params), options);
    } else {
      if (params.id === undefined) throw new QueryError("INVALID_ARGUMENT", "id is required.", undefined, "id");
      result = await store.setSubscription(params.id, humanSetChanges(params), options);
    }
    const subscription = commandResultDto(result);
    const verb = !result.changed
      ? "Unchanged"
      : result.dryRun
        ? (action === "new" ? "Would create" : "Would update")
        : (action === "new" ? "Created" : "Updated");
    const name = terminalText(result.item.name);
    const idText = result.id === null ? "(not allocated)" : terminalText(result.id);
    const statusText = `${result.effectiveStatus}${result.statusPending ? " (pending disable; undo available)" : ""}`;
    const priceText = `${subscription.price.decimal} ${terminalText(subscription.price.currencyCode)} (${periodLabel(result.item)})`;
    const text = `${result.dryRun ? "Dry run: " : ""}${verb}: ${name}\nID: ${idText}\nStatus: ${statusText}\nPrice: ${priceText}`;
    return { data: { subscription, changed: result.changed, dryRun: result.dryRun }, text };
  });
}

async function discoverOrSummarize(action: "currencies" | "summary", params: CliData, store: SubscriptionStore, registry: CurrencyRegistry): Promise<string> {
  return runCommand(action, params, async () => {
    validateFlags(params, ["format"]);
    const snapshot = await store.readSnapshot();
    const { registry: snapshotRegistry, builtins } = readRegistry(snapshot, registry);
    if (action === "currencies") {
      const currencies = [...builtins, ...snapshot.data.customCurrencies].sort((a, b) => compareText(a.code, b.code)).map((currency) => ({
        code: currency.code, label: currency.label, amountMarker: currency.amountMarker ?? null,
        display: getCurrencySelectLabel(currency), scale: currency.scale, source: currency.source,
        archived: currency.isArchived === true, selectable: currency.isArchived !== true,
        isDefault: currency.code === snapshot.data.settings.defaultCurrency,
      }));
      return { data: { defaultCurrency: snapshot.data.settings.defaultCurrency, currencies },
        text: currencies.map((currency) => `${terminalText(currency.code)}  ${terminalText(currency.display)}  scale=${currency.scale}${currency.isDefault ? " (default)" : ""}${currency.archived ? " (archived)" : ""}`).join("\n") || "No currencies found." };
    }
    const enabled = snapshot.subscriptions.filter((item) => item.effectiveStatus === "enabled");
    const totals = calculateTotalsByCurrency(enabled)
      .sort((a, b) => compareText(a.currencyCode, b.currencyCode))
      .map((total) => {
        if (!Number.isSafeInteger(total.perYearMinor) || total.perYearMinor < 0 || !Number.isSafeInteger(total.perMonthMinor)) {
          throw new QueryError("VALIDATION_FAILED", "Summary exceeds the safe amount range.", undefined, "price");
        }
        const scale = requireScale(snapshotRegistry, total.currencyCode);
        return {
          currencyCode: total.currencyCode, scale,
          perYear: { decimal: exactAmount(total.perYearMinor, scale), amountMinor: total.perYearMinor },
          perMonth: { decimal: exactAmount(total.perMonthMinor, scale), amountMinor: total.perMonthMinor },
        };
      });
    return { data: { totals }, text: totals.map((total) => `${terminalText(total.currencyCode)}: ${total.perMonth.decimal} per month; ${total.perYear.decimal} per year`).join("\n") || "No enabled subscriptions found." };
  });
}

export async function exportBackup(store: SubscriptionStore): Promise<string> {
  const snapshot = await store.readSnapshot();
  // Match UI backups: persisted status, including the still-undoable disable state.
  return JSON.stringify(createBackup(snapshot.data), null, 2);
}

export function registerSubscriptionCli(plugin: Plugin, store: SubscriptionStore, registry: CurrencyRegistry): void {
  const format = { description: "text (default) or json", value: "format" };
  plugin.registerCliHandler("subscription-calculator:list", "List subscription names and IDs", {
    status: { description: "enabled or disabled", value: "status" },
    currency: { description: "Currency code", value: "code" },
    format,
  }, (params) => querySubscriptions("list", params, store, registry));
  const getFlags: CliFlags = {
    id: { description: "Stable subscription ID", value: "id" },
    name: { description: "Exact name, ignoring case", value: "name" },
    format,
  };
  plugin.registerCliHandler("subscription-calculator:get", "Read a subscription by ID or exact name", getFlags,
    (params) => querySubscriptions("get", params, store, registry));
  plugin.registerCliHandler("subscription-calculator:export", "Export a restorable JSON backup to stdout", null, (params) => {
    return runCommand("export", {}, async () => {
      validateFlags(params, []);
      const text = await exportBackup(store);
      return { data: null, text };
    });
  });
  const fields: CliFlags = {
    name: { description: "Subscription name (required for new)", value: "name" },
    price: { description: "Exact decimal price (required for new)", value: "amount" },
    currency: { description: "Unique currency code; discover with :currencies", value: "code" },
    period: { description: "weekly, monthly, quarterly, yearly or custom", value: "period" },
    days: { description: "Whole days for custom period", value: "days" },
    "start-date": { description: "YYYY-MM-DD", value: "date" },
    url: { description: "http(s) URL or domain", value: "url" },
    status: { description: "enabled or disabled (immediate)", value: "status" },
    "dry-run": { description: "Validate and preview without saving" }, format,
  };
  plugin.registerCliHandler("subscription-calculator:new", "Create a subscription from human fields", fields,
    (params) => writeSubscription("new", params, store));
  plugin.registerCliHandler("subscription-calculator:set", "Edit provided fields of an exact subscription ID", {
    ...fields, id: { description: "Exact subscription ID (required)", value: "id" },
    "clear-url": { description: "Remove the URL" }, "clear-start-date": { description: "Remove the start date" },
  }, (params) => writeSubscription("set", params, store));
  for (const action of ["currencies", "summary"] as const) {
    plugin.registerCliHandler(`subscription-calculator:${action}`, action === "currencies" ? "Discover unique currency codes, including archived currencies" : "Summarize enabled costs separately by currency", { format },
      (params) => discoverOrSummarize(action, params, store, registry));
  }
}
