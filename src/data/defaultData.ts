import { SCHEMA_VERSION } from "../constants";
import type { PluginData, PluginSettings } from "../types";

export const DEFAULT_SETTINGS: PluginSettings = {
  openMode: "right-sidebar",
  defaultCurrency: "USD",
  showDisabled: false,
  faviconProvider: "google-s2",
  confirmBeforeDelete: true,
  sortMode: "alphabetical",
  sortDirection: "ascending",
};

export function createDefaultData(): PluginData {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    subscriptions: [],
    iconCache: {},
  };
}
