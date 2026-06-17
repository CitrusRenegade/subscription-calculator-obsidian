"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SubscriptionCalculatorPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian10 = require("obsidian");

// src/constants.ts
var SCHEMA_VERSION = 1;
var VIEW_TYPE_SUBSCRIPTIONS = "subscription-calculator-view";
var DISABLE_GRACE_PERIOD_MS = 1500;

// src/data/SubscriptionStore.ts
var import_obsidian = require("obsidian");

// src/date/Clock.ts
var systemClock = {
  now: () => /* @__PURE__ */ new Date()
};

// src/date/dateOnly.ts
function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
function parseDateOnly(value) {
  if (typeof value !== "string") return null;
  return isValidDateOnly(value) ? value : null;
}
function todayLocalDate(clock = { now: () => /* @__PURE__ */ new Date() }) {
  return formatLocalDate(clock.now());
}

// src/icons/url.ts
function normalizeUrlInput(value) {
  const trimmed = value == null ? void 0 : value.trim();
  if (!trimmed) return void 0;
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).toString();
  } catch (e) {
    return trimmed;
  }
}
function getDomainFromUrl(value) {
  const normalized = normalizeUrlInput(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).hostname.replace(/^www\./i, "");
  } catch (e) {
    return null;
  }
}

// src/money/formatMoney.ts
function formatMoney(money, registry) {
  var _a;
  const currency = (_a = registry.get(money.currencyCode)) != null ? _a : registry.getDefault();
  const factor = 10 ** currency.scale;
  const amount = money.amountMinor / factor;
  const formatter = new Intl.NumberFormat(void 0, {
    minimumFractionDigits: currency.scale,
    maximumFractionDigits: currency.scale
  });
  const formatted = formatter.format(amount);
  return currency.symbol.length === 1 ? `${currency.symbol}${formatted}` : `${formatted} ${currency.symbol}`;
}
function moneyToInputValue(money, registry) {
  var _a;
  const currency = (_a = registry.get(money.currencyCode)) != null ? _a : registry.getDefault();
  const factor = 10 ** currency.scale;
  return (money.amountMinor / factor).toFixed(currency.scale);
}

// src/money/parseMoneyInput.ts
function parseMoneyInput(value, currencyCode, registry) {
  const currency = registry.get(currencyCode);
  if (!currency) return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const [majorPart, fractionPart = ""] = normalized.split(".");
  if (fractionPart.length > currency.scale) return null;
  const paddedFraction = fractionPart.padEnd(currency.scale, "0");
  const majorMinor = Number(majorPart) * 10 ** currency.scale;
  const fractionMinor = paddedFraction ? Number(paddedFraction) : 0;
  const amountMinor = majorMinor + fractionMinor;
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return null;
  return { amountMinor, currencyCode: currency.code };
}

// src/money/totals.ts
function getPaymentsPerYear(period, customDays) {
  switch (period) {
    case "weekly":
      return 52;
    case "monthly":
      return 12;
    case "quarterly":
      return 4;
    case "yearly":
      return 1;
    case "custom":
      return customDays && customDays > 0 ? 365 / customDays : 0;
  }
}
function getPerYearMinor(item) {
  return Math.round(
    item.price.amountMinor * getPaymentsPerYear(item.billingPeriod, item.customBillingPeriodDays)
  );
}
function calculateTotalsByCurrency(subscriptions) {
  var _a;
  const totals = /* @__PURE__ */ new Map();
  for (const item of subscriptions) {
    totals.set(
      item.price.currencyCode,
      ((_a = totals.get(item.price.currencyCode)) != null ? _a : 0) + getPerYearMinor(item)
    );
  }
  return Array.from(totals.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([currencyCode, perYearMinor]) => ({
    currencyCode,
    perYearMinor,
    perMonthMinor: Math.round(perYearMinor / 12)
  }));
}
function moneyFromMinor(amountMinor, currencyCode) {
  return { amountMinor, currencyCode };
}

// src/data/SubscriptionStore.ts
function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function sortByName(items) {
  return [...items].sort(
    (a, b) => a.name.localeCompare(b.name, void 0, { sensitivity: "base" })
  );
}
function isBillingPeriod(value) {
  return value === "weekly" || value === "monthly" || value === "quarterly" || value === "yearly" || value === "custom";
}
var SubscriptionStore = class {
  constructor(data, currencyRegistry, iconService, saveData, clock = systemClock) {
    this.data = data;
    this.currencyRegistry = currencyRegistry;
    this.iconService = iconService;
    this.saveData = saveData;
    this.clock = clock;
    this.listeners = /* @__PURE__ */ new Set();
    this.disableGracePeriods = /* @__PURE__ */ new Map();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  dispose() {
    for (const gracePeriod of this.disableGracePeriods.values()) {
      window.clearTimeout(gracePeriod.timeoutId);
    }
    this.disableGracePeriods.clear();
    this.listeners.clear();
  }
  async flushDisableGracePeriods() {
    if (!this.disableGracePeriods.size) return;
    for (const gracePeriod of this.disableGracePeriods.values()) {
      window.clearTimeout(gracePeriod.timeoutId);
    }
    const subscriptionIds = Array.from(this.disableGracePeriods.keys());
    this.disableGracePeriods.clear();
    let changed = false;
    for (const id of subscriptionIds) {
      changed = this.disableSubscriptionNow(id) || changed;
    }
    if (changed) {
      await this.saveData();
      this.notify();
    }
  }
  notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
  async saveSettings() {
    await this.saveData();
    this.notify();
  }
  findItem(id) {
    var _a;
    return (_a = this.data.subscriptions.find((item) => item.id === id)) != null ? _a : null;
  }
  getEffectiveStatus(item) {
    return this.disableGracePeriods.has(item.id) ? "disabled" : item.status;
  }
  toViewItem(item) {
    return {
      ...item,
      effectiveStatus: this.getEffectiveStatus(item),
      inDisableGracePeriod: this.disableGracePeriods.has(item.id)
    };
  }
  async addSubscription(input) {
    var _a, _b, _c, _d, _e;
    const name = input.name.trim();
    if (!name) throw new Error("Subscription name is required.");
    const currencyCode = input.currencyCode.trim().toUpperCase();
    const money = parseMoneyInput(input.priceText, currencyCode, this.currencyRegistry);
    if (!money) throw new Error("Enter a valid price for the selected currency.");
    if (!isBillingPeriod(input.billingPeriod)) {
      throw new Error("Select a valid billing period.");
    }
    if (input.billingPeriod === "custom" && (!input.customBillingPeriodDays || input.customBillingPeriodDays <= 0)) {
      throw new Error("Custom billing period must be greater than 0 days.");
    }
    const today = todayLocalDate(this.clock);
    const item = {
      id: createId(),
      name,
      status: "enabled",
      price: money,
      billingPeriod: input.billingPeriod,
      customBillingPeriodDays: input.billingPeriod === "custom" ? input.customBillingPeriodDays : void 0,
      serviceUrl: normalizeUrlInput(input.serviceUrl),
      cancelUrl: normalizeUrlInput(input.cancelUrl),
      icon: {
        mode: (_b = (_a = input.icon) == null ? void 0 : _a.mode) != null ? _b : "auto",
        manualUrl: normalizeUrlInput((_c = input.icon) == null ? void 0 : _c.manualUrl),
        emoji: ((_e = (_d = input.icon) == null ? void 0 : _d.emoji) == null ? void 0 : _e.trim()) || void 0
      },
      createdOn: today,
      updatedOn: today
    };
    this.data.subscriptions.push(item);
    await this.tryEnsureIcon(item);
    await this.saveData();
    this.notify();
  }
  async updateSubscription(id, patch) {
    var _a, _b, _c;
    const item = this.findItem(id);
    if (!item) return;
    if (typeof patch.name === "string") {
      const name = patch.name.trim();
      if (!name) throw new Error("Subscription name is required.");
      item.name = name;
    }
    const nextCurrency = (_b = (_a = patch.currencyCode) == null ? void 0 : _a.trim().toUpperCase()) != null ? _b : item.price.currencyCode;
    if (typeof patch.priceText === "string" || patch.currencyCode) {
      const priceText = typeof patch.priceText === "string" ? patch.priceText : moneyToInputValue(item.price, this.currencyRegistry);
      const money = parseMoneyInput(priceText, nextCurrency, this.currencyRegistry);
      if (!money) throw new Error("Enter a valid price for the selected currency.");
      item.price = money;
    }
    if (patch.billingPeriod) {
      if (!isBillingPeriod(patch.billingPeriod)) {
        throw new Error("Select a valid billing period.");
      }
      item.billingPeriod = patch.billingPeriod;
    }
    if (patch.customBillingPeriodDays !== void 0) {
      item.customBillingPeriodDays = patch.customBillingPeriodDays > 0 ? patch.customBillingPeriodDays : void 0;
    }
    if (item.billingPeriod !== "custom") {
      item.customBillingPeriodDays = void 0;
    }
    let shouldRefreshIcon = false;
    if (patch.serviceUrl !== void 0) {
      const serviceUrl = normalizeUrlInput(patch.serviceUrl);
      shouldRefreshIcon = serviceUrl !== item.serviceUrl;
      item.serviceUrl = serviceUrl;
      if (shouldRefreshIcon) this.iconService.clearIcon(item);
    }
    if (patch.cancelUrl !== void 0) {
      item.cancelUrl = normalizeUrlInput(patch.cancelUrl);
    }
    if (patch.icon) {
      item.icon = {
        ...item.icon,
        ...patch.icon,
        manualUrl: normalizeUrlInput(patch.icon.manualUrl),
        emoji: ((_c = patch.icon.emoji) == null ? void 0 : _c.trim()) || void 0
      };
      if (item.icon.mode !== "auto") {
        this.iconService.clearIcon(item);
      }
      shouldRefreshIcon = item.icon.mode === "auto";
    }
    item.updatedOn = todayLocalDate(this.clock);
    if (shouldRefreshIcon) await this.tryEnsureIcon(item);
    await this.saveData();
    this.notify();
  }
  async setSubscriptionEnabled(id, enabled) {
    const item = this.findItem(id);
    if (!item) return;
    if (enabled) {
      const gracePeriod = this.disableGracePeriods.get(id);
      if (gracePeriod) {
        window.clearTimeout(gracePeriod.timeoutId);
        this.disableGracePeriods.delete(id);
        this.notify();
        return;
      }
      if (item.status === "disabled") {
        item.status = "enabled";
        item.disabledOn = void 0;
        item.updatedOn = todayLocalDate(this.clock);
        await this.saveData();
        this.notify();
      }
      return;
    }
    if (item.status === "disabled" || this.disableGracePeriods.has(id)) return;
    const timeoutId = window.setTimeout(() => {
      this.disableGracePeriods.delete(id);
      if (!this.disableSubscriptionNow(id)) {
        this.notify();
        return;
      }
      void this.saveData().catch((e) => {
        console.error("Failed to save disabled subscription:", e);
        new import_obsidian.Notice("Failed to save disabled subscription");
      });
      this.notify();
    }, DISABLE_GRACE_PERIOD_MS);
    this.disableGracePeriods.set(id, { subscriptionId: id, timeoutId });
    this.notify();
  }
  async deleteSubscription(id) {
    const gracePeriod = this.disableGracePeriods.get(id);
    if (gracePeriod) {
      window.clearTimeout(gracePeriod.timeoutId);
      this.disableGracePeriods.delete(id);
    }
    const before = this.data.subscriptions.length;
    this.data.subscriptions = this.data.subscriptions.filter((item) => item.id !== id);
    if (this.data.subscriptions.length !== before) {
      await this.saveData();
      this.notify();
    }
  }
  async refreshIcon(id) {
    const item = this.findItem(id);
    if (!item) return false;
    const refreshed = await this.tryRefreshIcon(item);
    if (refreshed) {
      item.updatedOn = todayLocalDate(this.clock);
      await this.saveData();
      this.notify();
    }
    return refreshed;
  }
  async clearIcon(id) {
    const item = this.findItem(id);
    if (!item) return;
    this.iconService.clearIcon(item);
    item.updatedOn = todayLocalDate(this.clock);
    await this.saveData();
    this.notify();
  }
  getVisibleSubscriptions() {
    const viewItems = this.data.subscriptions.map((item) => this.toViewItem(item));
    return sortByName(
      viewItems.filter(
        (item) => item.effectiveStatus === "enabled" || this.data.settings.showDisabled
      )
    );
  }
  getEnabledSubscriptions() {
    return sortByName(
      this.data.subscriptions.filter((item) => this.getEffectiveStatus(item) === "enabled")
    );
  }
  getDisabledSubscriptions() {
    return sortByName(
      this.data.subscriptions.map((item) => this.toViewItem(item)).filter((item) => item.effectiveStatus === "disabled")
    );
  }
  getTotalsByCurrency() {
    return calculateTotalsByCurrency(this.getEnabledSubscriptions());
  }
  async tryEnsureIcon(item) {
    try {
      await this.iconService.ensureAutoIcon(item);
    } catch (e) {
      console.warn("Failed to fetch subscription icon:", e);
    }
  }
  async tryRefreshIcon(item) {
    try {
      return await this.iconService.refreshAutoIcon(item);
    } catch (e) {
      console.warn("Failed to refresh subscription icon:", e);
      return false;
    }
  }
  disableSubscriptionNow(id) {
    const current = this.findItem(id);
    if (!current || current.status === "disabled") return false;
    current.status = "disabled";
    current.disabledOn = todayLocalDate(this.clock);
    current.updatedOn = current.disabledOn;
    return true;
  }
};

// src/data/defaultData.ts
var DEFAULT_SETTINGS = {
  openMode: "right-sidebar",
  defaultCurrency: "USD",
  showDisabled: false,
  faviconProvider: "google-s2",
  confirmBeforeDelete: true
};
function createDefaultData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    subscriptions: [],
    iconCache: {}
  };
}

// src/data/migrations.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value) {
  return typeof value === "string" ? value : null;
}
function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function asOpenMode(value) {
  return value === "main-tab" || value === "right-sidebar" ? value : DEFAULT_SETTINGS.openMode;
}
function asFaviconProvider(value) {
  return value === "none" || value === "google-s2" ? value : DEFAULT_SETTINGS.faviconProvider;
}
function asStatus(value) {
  return value === "disabled" ? "disabled" : "enabled";
}
function asPeriod(value) {
  if (value === "weekly" || value === "monthly" || value === "quarterly" || value === "yearly" || value === "custom") {
    return value;
  }
  return "monthly";
}
function asIconMode(value) {
  if (value === "manual-url" || value === "emoji" || value === "none") return value;
  return "auto";
}
function asSafeInteger(value, fallback) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}
function migrateSettings(value) {
  var _a;
  const raw = isRecord(value) ? value : {};
  const defaultCurrency = (_a = asString(raw.defaultCurrency)) == null ? void 0 : _a.trim().toUpperCase();
  return {
    openMode: asOpenMode(raw.openMode),
    defaultCurrency: defaultCurrency || DEFAULT_SETTINGS.defaultCurrency,
    showDisabled: asBoolean(raw.showDisabled, DEFAULT_SETTINGS.showDisabled),
    faviconProvider: asFaviconProvider(raw.faviconProvider),
    confirmBeforeDelete: asBoolean(
      raw.confirmBeforeDelete,
      DEFAULT_SETTINGS.confirmBeforeDelete
    )
  };
}
function migrateSubscription(value) {
  var _a, _b, _c, _d, _e, _f, _g, _h;
  if (!isRecord(value)) return null;
  const id = (_a = asString(value.id)) == null ? void 0 : _a.trim();
  const name = (_b = asString(value.name)) == null ? void 0 : _b.trim();
  const price = isRecord(value.price) ? value.price : null;
  const amountMinor = price ? asSafeInteger(price.amountMinor, Number.NaN) : Number.NaN;
  const currencyCode = price ? (_c = asString(price.currencyCode)) == null ? void 0 : _c.trim().toUpperCase() : null;
  const createdOn = parseDateOnly(value.createdOn);
  const updatedOn = parseDateOnly(value.updatedOn);
  if (!id || !name || !Number.isSafeInteger(amountMinor) || !currencyCode || !createdOn || !updatedOn) {
    return null;
  }
  const rawIcon = isRecord(value.icon) ? value.icon : {};
  const status = asStatus(value.status);
  const disabledOn = parseDateOnly(value.disabledOn);
  return {
    id,
    name,
    status,
    price: { amountMinor, currencyCode },
    billingPeriod: asPeriod(value.billingPeriod),
    customBillingPeriodDays: typeof value.customBillingPeriodDays === "number" && value.customBillingPeriodDays > 0 ? value.customBillingPeriodDays : void 0,
    serviceUrl: ((_d = asString(value.serviceUrl)) == null ? void 0 : _d.trim()) || void 0,
    cancelUrl: ((_e = asString(value.cancelUrl)) == null ? void 0 : _e.trim()) || void 0,
    icon: {
      mode: asIconMode(rawIcon.mode),
      manualUrl: ((_f = asString(rawIcon.manualUrl)) == null ? void 0 : _f.trim()) || void 0,
      emoji: ((_g = asString(rawIcon.emoji)) == null ? void 0 : _g.trim()) || void 0,
      cacheKey: ((_h = asString(rawIcon.cacheKey)) == null ? void 0 : _h.trim()) || void 0
    },
    createdOn,
    updatedOn,
    disabledOn: status === "disabled" ? disabledOn != null ? disabledOn : updatedOn : void 0
  };
}
function migrateIconCache(value) {
  if (!isRecord(value)) return {};
  const result = {};
  for (const [key, rawIcon] of Object.entries(value)) {
    if (!isRecord(rawIcon)) continue;
    const sourceUrl = asString(rawIcon.sourceUrl);
    const serviceDomain = asString(rawIcon.serviceDomain);
    const dataUrl = asString(rawIcon.dataUrl);
    const contentType = asString(rawIcon.contentType);
    const fetchedOn = parseDateOnly(rawIcon.fetchedOn);
    if (!sourceUrl || !serviceDomain || !dataUrl || !contentType || !fetchedOn) continue;
    result[key] = {
      cacheKey: key,
      sourceUrl,
      serviceDomain,
      dataUrl,
      contentType,
      fetchedOn,
      width: typeof rawIcon.width === "number" && rawIcon.width > 0 ? rawIcon.width : void 0,
      height: typeof rawIcon.height === "number" && rawIcon.height > 0 ? rawIcon.height : void 0
    };
  }
  return result;
}
function migratePluginData(value) {
  const raw = isRecord(value) ? value : {};
  const data = createDefaultData();
  data.schemaVersion = SCHEMA_VERSION;
  data.settings = migrateSettings(raw.settings);
  data.subscriptions = Array.isArray(raw.subscriptions) ? raw.subscriptions.flatMap((item) => {
    const migrated = migrateSubscription(item);
    return migrated ? [migrated] : [];
  }) : [];
  data.iconCache = migrateIconCache(raw.iconCache);
  return data;
}

// src/icons/IconService.ts
var import_obsidian2 = require("obsidian");

// src/icons/faviconProviders.ts
function buildGoogleS2FaviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

// src/icons/IconService.ts
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
var IconService = class {
  constructor(data, getProvider) {
    this.data = data;
    this.getProvider = getProvider;
  }
  getCachedIcon(item) {
    var _a;
    const key = item.icon.cacheKey;
    if (!key) return null;
    return (_a = this.data.iconCache[key]) != null ? _a : null;
  }
  clearIcon(item) {
    const key = item.icon.cacheKey;
    if (key) {
      delete this.data.iconCache[key];
    }
    item.icon = { ...item.icon, cacheKey: void 0 };
  }
  async refreshAutoIcon(item) {
    var _a, _b;
    if (this.getProvider() === "none") return false;
    const domain = getDomainFromUrl(item.serviceUrl);
    if (!domain) return false;
    const sourceUrl = buildGoogleS2FaviconUrl(domain);
    const response = await (0, import_obsidian2.requestUrl)({ url: sourceUrl });
    const contentType = (_b = (_a = response.headers["content-type"]) != null ? _a : response.headers["Content-Type"]) != null ? _b : "image/png";
    const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(
      response.arrayBuffer
    )}`;
    const cacheKey = `google-s2:${domain}`;
    this.data.iconCache[cacheKey] = {
      cacheKey,
      sourceUrl,
      serviceDomain: domain,
      dataUrl,
      contentType,
      fetchedOn: todayLocalDate()
    };
    item.icon = { ...item.icon, mode: "auto", cacheKey };
    return true;
  }
  async ensureAutoIcon(item) {
    if (item.icon.mode !== "auto") return false;
    const key = item.icon.cacheKey;
    if (key && this.data.iconCache[key]) return false;
    return this.refreshAutoIcon(item);
  }
};

// src/money/currencies.ts
var BUILTIN_CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$", scale: 2, source: "builtin" },
  { code: "EUR", name: "Euro", symbol: "\u20AC", scale: 2, source: "builtin" },
  { code: "RUB", name: "Russian Ruble", symbol: "\u20BD", scale: 2, source: "builtin" },
  { code: "GBP", name: "British Pound", symbol: "\xA3", scale: 2, source: "builtin" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", scale: 2, source: "builtin" },
  { code: "JPY", name: "Japanese Yen", symbol: "\xA5", scale: 0, source: "builtin" }
];

// src/money/CurrencyRegistry.ts
var BuiltinCurrencyRegistry = class {
  constructor(defaultCode = "USD", currencies = BUILTIN_CURRENCIES) {
    var _a;
    this.currencies = currencies;
    this.defaultCurrency = (_a = currencies.find((currency) => currency.code === defaultCode)) != null ? _a : currencies[0];
  }
  get(code) {
    var _a;
    const normalized = code.trim().toUpperCase();
    return (_a = this.currencies.find((currency) => currency.code === normalized)) != null ? _a : null;
  }
  list() {
    return [...this.currencies];
  }
  getDefault() {
    return this.defaultCurrency;
  }
};

// src/settings/SubscriptionSettingTab.ts
var import_obsidian3 = require("obsidian");
var SubscriptionSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian3.Setting(containerEl).setName("Open subscriptions in").setDesc("The same view is used in both placements.").addDropdown(
      (dropdown) => dropdown.addOption("right-sidebar", "Right sidebar").addOption("main-tab", "Main tab").setValue(this.plugin.data.settings.openMode).onChange(async (value) => {
        this.plugin.data.settings.openMode = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Default currency").addDropdown((dropdown) => {
      for (const currency of this.plugin.currencyRegistry.list()) {
        dropdown.addOption(currency.code, `${currency.code} ${currency.symbol}`);
      }
      dropdown.setValue(this.plugin.data.settings.defaultCurrency);
      dropdown.onChange(async (value) => {
        this.plugin.data.settings.defaultCurrency = value;
        await this.plugin.savePluginData();
      });
    });
    new import_obsidian3.Setting(containerEl).setName("Favicon provider").setDesc("Auto icons are cached in plugin data and are not fetched during normal render.").addDropdown(
      (dropdown) => dropdown.addOption("google-s2", "Google S2").addOption("none", "Disabled").setValue(this.plugin.data.settings.faviconProvider).onChange(async (value) => {
        this.plugin.data.settings.faviconProvider = value;
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Confirm before delete").addToggle(
      (toggle) => toggle.setValue(this.plugin.data.settings.confirmBeforeDelete).onChange(async (value) => {
        this.plugin.data.settings.confirmBeforeDelete = value;
        await this.plugin.savePluginData();
      })
    );
  }
};

// src/ui/AddSubscriptionModal.ts
var import_obsidian4 = require("obsidian");
var AddSubscriptionModal = class extends import_obsidian4.Modal {
  constructor(app, store, registry, defaultCurrency) {
    super(app);
    this.store = store;
    this.registry = registry;
    this.name = "";
    this.price = "";
    this.billingPeriod = "monthly";
    this.customDays = 30;
    this.serviceUrl = "";
    this.cancelUrl = "";
    this.currencyCode = defaultCurrency;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("subscription-calculator-modal");
    contentEl.createEl("h2", { text: "Add subscription" });
    new import_obsidian4.Setting(contentEl).setName("Name").addText(
      (text) => text.setPlaceholder("ChatGPT").onChange((value) => {
        this.name = value;
      })
    );
    new import_obsidian4.Setting(contentEl).setName("Price").addText(
      (text) => text.setPlaceholder("20").onChange((value) => {
        this.price = value;
      })
    );
    new import_obsidian4.Setting(contentEl).setName("Currency").addDropdown((dropdown) => {
      for (const currency of this.registry.list()) {
        dropdown.addOption(currency.code, `${currency.code} ${currency.symbol}`);
      }
      dropdown.setValue(this.currencyCode);
      dropdown.onChange((value) => {
        this.currencyCode = value;
      });
    });
    new import_obsidian4.Setting(contentEl).setName("Billing period").addDropdown((dropdown) => {
      dropdown.addOption("weekly", "Weekly").addOption("monthly", "Monthly").addOption("quarterly", "Quarterly").addOption("yearly", "Yearly").addOption("custom", "Custom").setValue(this.billingPeriod).onChange((value) => {
        this.billingPeriod = value;
        this.onOpen();
      });
    });
    if (this.billingPeriod === "custom") {
      new import_obsidian4.Setting(contentEl).setName("Custom period days").addText(
        (text) => text.setPlaceholder("30").setValue(String(this.customDays)).onChange((value) => {
          this.customDays = Number(value);
        })
      );
    }
    new import_obsidian4.Setting(contentEl).setName("Service URL").setDesc("Used for favicon lookup. Optional.").addText(
      (text) => text.setPlaceholder("https://example.com").onChange((value) => {
        this.serviceUrl = value;
      })
    );
    new import_obsidian4.Setting(contentEl).setName("Cancel URL").setDesc("Optional.").addText(
      (text) => text.setPlaceholder("https://example.com/account").onChange((value) => {
        this.cancelUrl = value;
      })
    );
    new import_obsidian4.Setting(contentEl).addButton(
      (button) => button.setButtonText("Add").setCta().onClick(() => void this.submit())
    );
  }
  async submit() {
    try {
      await this.store.addSubscription({
        name: this.name,
        priceText: this.price,
        currencyCode: this.currencyCode,
        billingPeriod: this.billingPeriod,
        customBillingPeriodDays: this.billingPeriod === "custom" ? this.customDays : void 0,
        serviceUrl: this.serviceUrl,
        cancelUrl: this.cancelUrl
      });
      this.close();
    } catch (e) {
      new import_obsidian4.Notice(e instanceof Error ? e.message : "Failed to add subscription");
    }
  }
};

// src/ui/SubscriptionsView.ts
var import_obsidian9 = require("obsidian");

// src/ui/ConfirmDeleteModal.ts
var import_obsidian5 = require("obsidian");
function applyDestructiveButtonStyle(button) {
  var _a;
  if (button.setDestructive) {
    button.setDestructive();
    return;
  }
  (_a = button.setWarning) == null ? void 0 : _a.call(button);
}
var ConfirmDeleteModal = class extends import_obsidian5.Modal {
  constructor(app, subscriptionName, onConfirm) {
    super(app);
    this.subscriptionName = subscriptionName;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("subscription-calculator-modal");
    contentEl.createEl("h2", { text: "Delete subscription?" });
    contentEl.createEl("p", {
      text: `${this.subscriptionName} will be removed permanently.`
    });
    new import_obsidian5.Setting(contentEl).addButton(
      (button) => button.setButtonText("Cancel").onClick(() => this.close())
    ).addButton(
      (button) => button.setButtonText("Delete").then(applyDestructiveButtonStyle).onClick(() => {
        this.onConfirm();
        this.close();
      })
    );
  }
};

// src/ui/EditSubscriptionModal.ts
var import_obsidian6 = require("obsidian");
var EditSubscriptionModal = class extends import_obsidian6.Modal {
  constructor(app, store, registry, item) {
    var _a, _b, _c, _d;
    super(app);
    this.store = store;
    this.registry = registry;
    this.item = item;
    this.name = item.name;
    this.serviceUrl = (_a = item.serviceUrl) != null ? _a : "";
    this.cancelUrl = (_b = item.cancelUrl) != null ? _b : "";
    this.iconMode = item.icon.mode;
    this.manualIconUrl = (_c = item.icon.manualUrl) != null ? _c : "";
    this.emoji = (_d = item.icon.emoji) != null ? _d : "";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("subscription-calculator-modal");
    contentEl.createEl("h2", { text: "Edit subscription" });
    new import_obsidian6.Setting(contentEl).setName("Name").addText(
      (text) => text.setValue(this.name).onChange((value) => {
        this.name = value;
      })
    );
    new import_obsidian6.Setting(contentEl).setName("Service URL").addText(
      (text) => text.setValue(this.serviceUrl).onChange((value) => {
        this.serviceUrl = value;
      })
    );
    new import_obsidian6.Setting(contentEl).setName("Cancel URL").addText(
      (text) => text.setValue(this.cancelUrl).onChange((value) => {
        this.cancelUrl = value;
      })
    );
    new import_obsidian6.Setting(contentEl).setName("Icon mode").addDropdown(
      (dropdown) => dropdown.addOption("auto", "Auto favicon").addOption("manual-url", "Manual URL").addOption("emoji", "Emoji").addOption("none", "None").setValue(this.iconMode).onChange((value) => {
        this.iconMode = value;
        this.onOpen();
      })
    );
    if (this.iconMode === "manual-url") {
      new import_obsidian6.Setting(contentEl).setName("Manual icon URL").addText(
        (text) => text.setValue(this.manualIconUrl).onChange((value) => {
          this.manualIconUrl = value;
        })
      );
    }
    if (this.iconMode === "emoji") {
      new import_obsidian6.Setting(contentEl).setName("Emoji").addText(
        (text) => text.setValue(this.emoji).onChange((value) => {
          this.emoji = value;
        })
      );
    }
    new import_obsidian6.Setting(contentEl).setName("Icon cache").setDesc("Fetching happens only on add, URL changes, or this explicit refresh.").addButton(
      (button) => button.setButtonText("Refresh icon").onClick(() => void this.refreshIcon())
    ).addButton(
      (button) => button.setButtonText("Clear icon").onClick(() => void this.clearIcon())
    );
    new import_obsidian6.Setting(contentEl).addButton(
      (button) => button.setButtonText("Save").setCta().onClick(() => void this.save())
    );
  }
  async save() {
    try {
      await this.store.updateSubscription(this.item.id, {
        name: this.name,
        serviceUrl: this.serviceUrl,
        cancelUrl: this.cancelUrl,
        icon: {
          mode: this.iconMode,
          manualUrl: this.manualIconUrl,
          emoji: this.emoji
        }
      });
      this.close();
    } catch (e) {
      new import_obsidian6.Notice(e instanceof Error ? e.message : "Failed to save subscription");
    }
  }
  async refreshIcon() {
    await this.save();
    const refreshed = await this.store.refreshIcon(this.item.id);
    new import_obsidian6.Notice(refreshed ? "Icon refreshed" : "No icon fetched");
  }
  async clearIcon() {
    await this.store.clearIcon(this.item.id);
    new import_obsidian6.Notice("Icon cleared");
    this.close();
  }
};

// src/ui/components/AddSubscriptionCard.ts
var import_obsidian7 = require("obsidian");
function renderAddSubscriptionCard(container, onClick) {
  const button = container.createEl("button", {
    cls: "subscription-calculator-add-card"
  });
  const icon = button.createSpan({ cls: "subscription-calculator-add-icon" });
  (0, import_obsidian7.setIcon)(icon, "plus");
  button.createSpan({ text: "Add subscription" });
  button.addEventListener("click", onClick);
}

// src/ui/components/SubscriptionCard.ts
var import_obsidian8 = require("obsidian");

// src/ui/components/FormControls.ts
var PERIOD_LABELS = {
  weekly: "weekly",
  monthly: "monthly",
  quarterly: "quarterly",
  yearly: "yearly",
  custom: "custom"
};
function setFieldTextWidth(element, text, minCh, maxCh) {
  element.style.setProperty("--subscription-field-ch", String(Math.max(text.length, minCh)));
  element.style.setProperty("--subscription-field-min-ch", String(minCh));
  element.style.setProperty("--subscription-field-max-ch", String(maxCh));
}
function updateSelectTextWidth(select, minCh, maxCh) {
  var _a, _b;
  setFieldTextWidth(select, (_b = (_a = select.selectedOptions[0]) == null ? void 0 : _a.text) != null ? _b : select.value, minCh, maxCh);
}
function createMoneyInput(container, money, registry, onCommit) {
  const input = container.createEl("input", {
    cls: "subscription-calculator-money-input",
    attr: {
      type: "number",
      min: "0",
      step: "any",
      inputmode: "decimal",
      value: moneyToInputValue(money, registry)
    }
  });
  const updateWidth = () => setFieldTextWidth(input, input.value || "0", 5, 14);
  const commit = () => onCommit(input.value);
  updateWidth();
  input.addEventListener("input", updateWidth);
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  return input;
}
function createCurrencySelect(container, registry, selectedCode, onChange) {
  const select = container.createEl("select", {
    cls: "subscription-calculator-select"
  });
  for (const currency of registry.list()) {
    const option = select.createEl("option", {
      text: `${currency.code} ${currency.symbol}`,
      attr: { value: currency.code }
    });
    option.selected = currency.code === selectedCode;
  }
  updateSelectTextWidth(select, 5, 10);
  select.addEventListener("change", () => {
    updateSelectTextWidth(select, 5, 10);
    onChange(select.value);
  });
  return select;
}
function createPeriodSelect(container, selectedPeriod, onChange) {
  const select = container.createEl("select", {
    cls: "subscription-calculator-select subscription-calculator-period-select"
  });
  for (const [period, label] of Object.entries(PERIOD_LABELS)) {
    const option = select.createEl("option", {
      text: label,
      attr: { value: period }
    });
    option.selected = period === selectedPeriod;
  }
  updateSelectTextWidth(select, 5, 10);
  select.addEventListener("change", () => {
    updateSelectTextWidth(select, 5, 10);
    onChange(select.value);
  });
  return select;
}
function createToggleSwitch(container, checked, onChange) {
  const label = container.createEl("label", {
    cls: "subscription-calculator-toggle"
  });
  const input = label.createEl("input", {
    attr: { type: "checkbox" }
  });
  input.checked = checked;
  label.createSpan({ cls: "subscription-calculator-toggle-track" });
  input.addEventListener("change", () => onChange(input.checked));
  return label;
}

// src/ui/components/SubscriptionCard.ts
function renderSubscriptionIcon(container, item, iconService) {
  const icon = container.createSpan({ cls: "subscription-calculator-icon" });
  if (item.icon.mode === "emoji" && item.icon.emoji) {
    icon.setText(item.icon.emoji);
    return;
  }
  if (item.icon.mode === "manual-url" && item.icon.manualUrl) {
    icon.createEl("img", { attr: { src: item.icon.manualUrl, alt: "" } });
    return;
  }
  const cached = iconService.getCachedIcon(item);
  if (item.icon.mode === "auto" && cached) {
    icon.createEl("img", { attr: { src: cached.dataUrl, alt: "" } });
    return;
  }
  icon.setText(item.name.slice(0, 1).toUpperCase() || "?");
}
function stretchPeriodSelectWhenWrapped(controls, periodSelect) {
  let resizeObserver = null;
  const sync = () => {
    window.requestAnimationFrame(() => {
      if (!controls.isConnected) {
        resizeObserver == null ? void 0 : resizeObserver.disconnect();
        resizeObserver = null;
        return;
      }
      const firstControl = controls.firstElementChild;
      const controlsBeforePeriod = Array.from(controls.children).slice(0, Array.from(controls.children).indexOf(periodSelect)).filter((element) => element.instanceOf(HTMLElement));
      periodSelect.classList.remove("is-row-fill");
      periodSelect.style.removeProperty("--subscription-period-row-width");
      const shouldFillRow = Boolean(firstControl && periodSelect.offsetTop > firstControl.offsetTop);
      if (!shouldFillRow) return;
      const rows = /* @__PURE__ */ new Map();
      for (const control of controlsBeforePeriod) {
        const rect = control.getBoundingClientRect();
        const row = rows.get(control.offsetTop);
        rows.set(control.offsetTop, {
          left: row ? Math.min(row.left, rect.left) : rect.left,
          right: row ? Math.max(row.right, rect.right) : rect.right
        });
      }
      const rowWidth = Math.max(
        ...Array.from(rows.values()).map((row) => row.right - row.left),
        periodSelect.getBoundingClientRect().width
      );
      periodSelect.style.setProperty("--subscription-period-row-width", `${Math.ceil(rowWidth)}px`);
      periodSelect.classList.add("is-row-fill");
    });
  };
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(controls);
  }
  sync();
}
function renderSubscriptionCard(container, item, store, registry, iconService, onEdit, onDelete) {
  var _a, _b;
  const card = container.createDiv({ cls: "subscription-calculator-card" });
  card.classList.toggle("is-disabled", item.effectiveStatus === "disabled");
  card.classList.toggle("is-disable-grace-period", item.inDisableGracePeriod);
  const top = card.createDiv({ cls: "subscription-calculator-card-top" });
  const title = top.createDiv({ cls: "subscription-calculator-card-title" });
  renderSubscriptionIcon(title, item, iconService);
  title.createSpan({ cls: "subscription-calculator-card-name", text: item.name });
  const actions = card.createDiv({ cls: "subscription-calculator-card-actions" });
  const edit = actions.createEl("button", {
    cls: "clickable-icon subscription-calculator-icon-button",
    attr: { "aria-label": "Edit subscription", title: "Edit subscription" }
  });
  (0, import_obsidian8.setIcon)(edit, "pencil");
  edit.addEventListener("click", onEdit);
  const remove = actions.createEl("button", {
    cls: "clickable-icon subscription-calculator-icon-button",
    attr: { "aria-label": "Delete subscription", title: "Delete subscription" }
  });
  (0, import_obsidian8.setIcon)(remove, "trash-2");
  remove.addEventListener("click", onDelete);
  createToggleSwitch(
    actions,
    item.effectiveStatus === "enabled",
    (enabled) => void store.setSubscriptionEnabled(item.id, enabled)
  );
  const controls = card.createDiv({ cls: "subscription-calculator-card-controls" });
  createMoneyInput(controls, item.price, registry, (priceText) => {
    void store.updateSubscription(item.id, { priceText, currencyCode: item.price.currencyCode }).catch((e) => new import_obsidian8.Notice(e instanceof Error ? e.message : "Failed to update price"));
  });
  createCurrencySelect(controls, registry, item.price.currencyCode, (currencyCode) => {
    var _a2;
    const priceInput = controls.querySelector(
      ".subscription-calculator-money-input"
    );
    void store.updateSubscription(item.id, {
      priceText: (_a2 = priceInput == null ? void 0 : priceInput.value) != null ? _a2 : "0",
      currencyCode
    }).catch((e) => new import_obsidian8.Notice(e instanceof Error ? e.message : "Failed to update currency"));
  });
  const periodSelect = createPeriodSelect(controls, item.billingPeriod, (billingPeriod) => {
    void store.updateSubscription(item.id, { billingPeriod }).catch((e) => new import_obsidian8.Notice(e instanceof Error ? e.message : "Failed to update period"));
  });
  stretchPeriodSelectWhenWrapped(controls, periodSelect);
  if (item.billingPeriod === "custom") {
    const customInput = controls.createEl("input", {
      cls: "subscription-calculator-custom-days",
      attr: {
        type: "number",
        min: "1",
        step: "1",
        value: String((_a = item.customBillingPeriodDays) != null ? _a : 30),
        title: "Days"
      }
    });
    customInput.addEventListener("change", () => {
      void store.updateSubscription(item.id, {
        customBillingPeriodDays: Number(customInput.value)
      }).catch((e) => new import_obsidian8.Notice(e instanceof Error ? e.message : "Failed to update custom period"));
    });
  }
  if (item.effectiveStatus === "disabled") {
    card.createDiv({
      cls: "subscription-calculator-disabled-note",
      text: item.inDisableGracePeriod ? "disable grace period" : `disabled on ${(_b = item.disabledOn) != null ? _b : item.updatedOn}`
    });
  }
}

// src/ui/components/SubscriptionSummaryTable.ts
function renderSubscriptionSummaryTable(container, items, registry, iconService) {
  const section = container.createDiv({ cls: "subscription-calculator-table" });
  const header = section.createDiv({ cls: "subscription-calculator-table-row is-header" });
  header.createDiv({ text: "What you pay for" });
  header.createDiv({ text: "Per year" });
  if (items.length === 0) {
    const empty = section.createDiv({
      cls: "subscription-calculator-table-empty",
      text: "Enabled subscriptions will appear here."
    });
    empty.setAttr("aria-live", "polite");
    return;
  }
  for (const item of items) {
    const row = section.createDiv({ cls: "subscription-calculator-table-row" });
    const name = row.createDiv({ cls: "subscription-calculator-table-name" });
    renderSubscriptionIcon(name, item, iconService);
    name.createSpan({ text: item.name });
    row.createDiv({
      cls: "subscription-calculator-table-money",
      text: formatMoney(
        moneyFromMinor(getPerYearMinor(item), item.price.currencyCode),
        registry
      )
    });
  }
}

// src/ui/components/SummaryHeader.ts
function renderSummaryHeader(container, totals, registry) {
  const header = container.createDiv({ cls: "subscription-calculator-summary" });
  const title = header.createDiv({ cls: "subscription-calculator-summary-title" });
  title.setText(totals.length === 0 ? "No enabled subscriptions" : "Per year");
  const yearly = header.createDiv({ cls: "subscription-calculator-summary-values" });
  if (totals.length === 0) {
    yearly.createDiv({ text: formatMoney(moneyFromMinor(0, registry.getDefault().code), registry) });
  } else {
    for (const total of totals) {
      yearly.createDiv({
        text: formatMoney(moneyFromMinor(total.perYearMinor, total.currencyCode), registry)
      });
    }
  }
  const monthlyLabel = header.createDiv({
    cls: "subscription-calculator-summary-subtitle",
    text: "Average per month"
  });
  monthlyLabel.classList.toggle("is-empty", totals.length === 0);
  const monthly = header.createDiv({ cls: "subscription-calculator-summary-monthly" });
  if (totals.length === 0) {
    monthly.createDiv({ text: formatMoney(moneyFromMinor(0, registry.getDefault().code), registry) });
  } else {
    for (const total of totals) {
      monthly.createDiv({
        text: formatMoney(moneyFromMinor(total.perMonthMinor, total.currencyCode), registry)
      });
    }
  }
}

// src/ui/SubscriptionsView.ts
var SubscriptionsView = class extends import_obsidian9.ItemView {
  constructor(leaf, store, registry, iconService, getSettings) {
    super(leaf);
    this.store = store;
    this.registry = registry;
    this.iconService = iconService;
    this.getSettings = getSettings;
    this.unsubscribe = null;
  }
  getViewType() {
    return VIEW_TYPE_SUBSCRIPTIONS;
  }
  getDisplayText() {
    return "Subscriptions";
  }
  getIcon() {
    return "receipt-text";
  }
  async onOpen() {
    this.unsubscribe = this.store.subscribe(() => this.render());
    this.render();
  }
  async onClose() {
    var _a;
    (_a = this.unsubscribe) == null ? void 0 : _a.call(this);
    this.unsubscribe = null;
  }
  render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("subscription-calculator-view");
    renderSummaryHeader(container, this.store.getTotalsByCurrency(), this.registry);
    const toolbar = container.createDiv({ cls: "subscription-calculator-toolbar" });
    const showDisabledButton = toolbar.createEl("button", {
      cls: "subscription-calculator-secondary-button",
      text: this.getSettings().showDisabled ? "Hide disabled" : "Show disabled"
    });
    showDisabledButton.addEventListener("click", () => {
      const settings = this.getSettings();
      settings.showDisabled = !settings.showDisabled;
      void this.store.saveSettings();
    });
    const cards = container.createDiv({ cls: "subscription-calculator-cards" });
    for (const item of this.store.getVisibleSubscriptions()) {
      renderSubscriptionCard(
        cards,
        item,
        this.store,
        this.registry,
        this.iconService,
        () => this.openEditModal(item),
        () => this.confirmDelete(item)
      );
    }
    renderAddSubscriptionCard(
      cards,
      () => new AddSubscriptionModal(
        this.app,
        this.store,
        this.registry,
        this.getSettings().defaultCurrency
      ).open()
    );
    renderSubscriptionSummaryTable(
      container,
      this.store.getEnabledSubscriptions(),
      this.registry,
      this.iconService
    );
  }
  openEditModal(item) {
    new EditSubscriptionModal(this.app, this.store, this.registry, item).open();
  }
  confirmDelete(item) {
    const remove = () => {
      void this.store.deleteSubscription(item.id).catch(() => new import_obsidian9.Notice("Failed to delete subscription"));
    };
    if (this.getSettings().confirmBeforeDelete) {
      new ConfirmDeleteModal(this.app, item.name, remove).open();
    } else {
      remove();
    }
  }
};

// src/main.ts
var SubscriptionCalculatorPlugin = class extends import_obsidian10.Plugin {
  async onload() {
    this.data = migratePluginData(await this.loadData());
    this.currencyRegistry = new BuiltinCurrencyRegistry(
      this.data.settings.defaultCurrency
    );
    this.iconService = new IconService(
      this.data,
      () => this.data.settings.faviconProvider
    );
    this.store = new SubscriptionStore(
      this.data,
      this.currencyRegistry,
      this.iconService,
      () => this.savePluginData()
    );
    this.registerView(
      VIEW_TYPE_SUBSCRIPTIONS,
      (leaf) => new SubscriptionsView(
        leaf,
        this.store,
        this.currencyRegistry,
        this.iconService,
        () => this.data.settings
      )
    );
    this.addSettingTab(new SubscriptionSettingTab(this.app, this));
    this.addRibbonIcon("receipt-text", "Open subscriptions", () => {
      void this.openSubscriptions();
    });
    this.addCommand({
      id: "open-subscriptions",
      name: "Open subscriptions",
      callback: () => {
        void this.openSubscriptions();
      }
    });
    this.addCommand({
      id: "add-subscription",
      name: "Add subscription",
      callback: () => {
        void this.openAddSubscriptionModal();
      }
    });
    this.registerDomEvent(window, "beforeunload", () => {
      void this.store.flushDisableGracePeriods().catch((e) => console.error("Failed to save delayed subscription changes:", e));
    });
    this.register(() => this.store.dispose());
  }
  onunload() {
    void this.store.flushDisableGracePeriods().catch((e) => console.error("Failed to save delayed subscription changes:", e));
  }
  async savePluginData() {
    await this.saveData(this.data);
  }
  async openAddSubscriptionModal() {
    await this.openSubscriptions();
    new AddSubscriptionModal(
      this.app,
      this.store,
      this.currencyRegistry,
      this.data.settings.defaultCurrency
    ).open();
  }
  async openSubscriptions() {
    const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SUBSCRIPTIONS)[0];
    if (existingLeaf) {
      this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
      return;
    }
    const leaf = this.getTargetLeaf();
    if (!leaf) {
      new import_obsidian10.Notice("Unable to open subscriptions view");
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_SUBSCRIPTIONS, active: true });
    if (this.data.settings.openMode === "right-sidebar") {
      this.app.workspace.rightSplit.expand();
    }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }
  getTargetLeaf() {
    if (this.data.settings.openMode === "right-sidebar") {
      return this.app.workspace.getRightLeaf(false);
    }
    return this.app.workspace.getLeaf(true);
  }
};
