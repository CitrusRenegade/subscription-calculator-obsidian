import { migratePluginData } from "./migrations";
import type {
  CurrencyMeta,
  PluginData,
  PluginSettings,
  SubscriptionIcon,
  SubscriptionItem,
} from "../types";

export const BACKUP_FORMAT = "subscription-calculator-backup";
export const BACKUP_VERSION = 1;

type BackupIcon = Omit<SubscriptionIcon, "cacheKey">;
type BackupSubscription = Omit<SubscriptionItem, "icon"> & { icon: BackupIcon };

export interface BackupPayload {
  settings: PluginSettings;
  subscriptions: BackupSubscription[];
  customCurrencies: CurrencyMeta[];
}

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  payload: BackupPayload;
}

export interface BackupImportReport {
  subscriptions: { imported: number; skipped: number };
  customCurrencies: { imported: number; skipped: number };
}

export interface ParsedBackup {
  data: PluginData;
  report: BackupImportReport;
}

export interface BackupRestoreActions {
  confirm: (report: BackupImportReport) => boolean;
  flush: () => Promise<void>;
  save: () => Promise<void>;
  notify: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneSubscriptionForBackup(item: SubscriptionItem): BackupSubscription {
  return {
    ...item,
    price: { ...item.price },
    icon: {
      mode: item.icon.mode,
      emoji: item.icon.emoji,
    },
  };
}

function migrateBackupPayload(version: number, payload: unknown): unknown {
  switch (version) {
    case 1:
      return payload;
    default:
      throw new Error(`Backup version ${version} is not supported.`);
  }
}

function readEnvelope(value: unknown): BackupPayload {
  if (!isRecord(value)) throw new Error("Backup file must contain an object.");
  if (value.format !== BACKUP_FORMAT) {
    throw new Error("This file is not a Subscription Calculator backup.");
  }
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) {
    throw new Error("Backup version must be a positive integer.");
  }
  const version = value.version as number;
  if (version > BACKUP_VERSION) {
    throw new Error(`Backup version ${version} is newer than this plugin supports.`);
  }
  if (typeof value.exportedAt !== "string" || Number.isNaN(Date.parse(value.exportedAt))) {
    throw new Error("Backup export date is invalid.");
  }

  const payload = migrateBackupPayload(version, value.payload);
  if (!isRecord(payload) || !isRecord(payload.settings)) {
    throw new Error("Backup settings are missing or invalid.");
  }
  if (!Array.isArray(payload.subscriptions) || !Array.isArray(payload.customCurrencies)) {
    throw new Error("Backup subscriptions or custom currencies are invalid.");
  }
  return payload as unknown as BackupPayload;
}

export function createBackup(data: PluginData, exportedAt = new Date().toISOString()): BackupEnvelope {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    payload: {
      settings: { ...data.settings },
      subscriptions: data.subscriptions.map(cloneSubscriptionForBackup),
      customCurrencies: data.customCurrencies.map((currency) => ({ ...currency })),
    },
  };
}

export function parseBackup(text: string): ParsedBackup {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new Error("Backup file is not valid JSON.");
  }

  const payload = readEnvelope(decoded);
  const data = migratePluginData({
    settings: payload.settings,
    subscriptions: payload.subscriptions,
    customCurrencies: payload.customCurrencies,
    iconCache: {},
  });
  data.subscriptions = data.subscriptions.map((item) => ({
    ...item,
    icon: { mode: item.icon.mode, emoji: item.icon.emoji },
  }));
  data.iconCache = {};

  return {
    data,
    report: {
      subscriptions: {
        imported: data.subscriptions.length,
        skipped: payload.subscriptions.length - data.subscriptions.length,
      },
      customCurrencies: {
        imported: data.customCurrencies.length,
        skipped: payload.customCurrencies.length - data.customCurrencies.length,
      },
    },
  };
}

export function replacePluginData(target: PluginData, replacement: PluginData): void {
  // Store and icon services retain this root object, so its identity must remain stable.
  // Nested references are deliberately replaced because consumers reach them through it.
  target.schemaVersion = replacement.schemaVersion;
  target.settings = replacement.settings;
  target.subscriptions = replacement.subscriptions;
  target.customCurrencies = replacement.customCurrencies;
  target.iconCache = {};
}

function clonePluginData(data: PluginData): PluginData {
  return {
    schemaVersion: data.schemaVersion,
    settings: { ...data.settings },
    subscriptions: data.subscriptions.map((item) => ({
      ...item,
      price: { ...item.price },
      icon: { ...item.icon },
    })),
    iconCache: Object.fromEntries(
      Object.entries(data.iconCache).map(([key, icon]) => [key, { ...icon }])
    ),
    customCurrencies: data.customCurrencies.map((currency) => ({ ...currency })),
  };
}

export async function restoreBackupData(
  target: PluginData,
  text: string,
  actions: BackupRestoreActions
): Promise<BackupImportReport | null> {
  const parsed = parseBackup(text);
  if (!actions.confirm(parsed.report)) return null;

  const beforeFlush = clonePluginData(target);
  try {
    await actions.flush();
  } catch (error) {
    replacePluginData(target, beforeFlush);
    target.iconCache = beforeFlush.iconCache;
    actions.notify();
    throw error;
  }

  const previous = clonePluginData(target);
  replacePluginData(target, parsed.data);

  try {
    await actions.save();
  } catch (error) {
    replacePluginData(target, previous);
    target.iconCache = previous.iconCache;
    actions.notify();
    throw error;
  }

  actions.notify();
  return parsed.report;
}
